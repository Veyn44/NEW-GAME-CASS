const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
const TYPE_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
let nextBusInstance = 1;

export class EventBusError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EventBusError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new EventBusError("INVALID_ID", `${label} must be a stable lowercase ID.`, { value });
  }
  return value;
}

function invalidPayload(path, reason) {
  throw new EventBusError("INVALID_PAYLOAD", `${path} ${reason}`, { path });
}

/**
 * Copies JSON-like data without invoking accessors or assigning through
 * Object.prototype setters. Only dense arrays and plain data objects are
 * accepted. Shared references are copied independently; cycles are rejected.
 */
function cloneImmutable(value, seen = new WeakSet(), path = "payload") {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") {
    invalidPayload(path, "contains a non-serializable value.");
  }
  if (seen.has(value)) {
    invalidPayload(path, "contains a circular reference.");
  }

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    invalidPayload(path, "could not be inspected as plain data.");
  }

  const isArray = Array.isArray(value);
  if (isArray) {
    if (prototype !== Array.prototype) {
      invalidPayload(path, "must use the standard Array prototype.");
    }
  } else if (prototype !== Object.prototype && prototype !== null) {
    invalidPayload(path, "must contain only plain objects and arrays.");
  }

  seen.add(value);
  try {
    if (isArray) {
      const length = value.length;
      const copy = new Array(length);
      const present = new Set();

      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string") {
          invalidPayload(path, "contains a symbol-keyed array property.");
        }
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
          invalidPayload(path, `contains an unsupported array property (${key}).`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
          invalidPayload(`${path}[${key}]`, "must be an enumerable data property, not an accessor or hidden property.");
        }
        present.add(index);
        copy[index] = cloneImmutable(descriptor.value, seen, `${path}[${index}]`);
      }

      if (present.size !== length) {
        invalidPayload(path, "contains an array hole; arrays must be dense.");
      }
      return Object.freeze(copy);
    }

    const copy = Object.create(prototype);
    for (const key of keys) {
      if (typeof key !== "string") {
        invalidPayload(path, "contains a symbol-keyed object property.");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        invalidPayload(`${path}.${key}`, "must be an enumerable data property, not an accessor or hidden property.");
      }
      const clonedValue = cloneImmutable(descriptor.value, seen, `${path}.${key}`);
      Object.defineProperty(copy, key, {
        value: clonedValue,
        enumerable: true,
        writable: false,
        configurable: false
      });
    }
    return Object.freeze(copy);
  } catch (error) {
    if (error instanceof EventBusError) throw error;
    invalidPayload(path, "could not be safely copied.");
  } finally {
    seen.delete(value);
  }
}

/**
 * Synchronous, queued event delivery.
 * The caller supplies the registered system IDs accepted as event sources.
 */
export class EventBus {
  #sources;
  #logger;
  #subscriptions = new Map();
  #queue = [];
  #sequence = 0;
  #instanceId;
  #draining = false;
  #maxEventsPerDrain;

  constructor({ sources, logger = null, maxEventsPerDrain = 1000 } = {}) {
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new EventBusError("INVALID_SOURCES", "EventBus requires the registered system IDs as a non-empty sources array.");
    }
    if (!Number.isSafeInteger(maxEventsPerDrain) || maxEventsPerDrain < 1) {
      throw new EventBusError("INVALID_DRAIN_LIMIT", "maxEventsPerDrain must be a positive safe integer.", { maxEventsPerDrain });
    }
    this.#sources = new Set(sources.map((id) => assertId(id, "Source system ID")));
    if (this.#sources.size !== sources.length) {
      throw new EventBusError("DUPLICATE_SOURCE", "Event source system IDs must be unique.");
    }
    if (logger !== null && (typeof logger !== "object" || typeof logger.error !== "function")) {
      throw new EventBusError("INVALID_LOGGER", "Logger must expose an error(message, details) method.");
    }
    this.#logger = logger;
    this.#maxEventsPerDrain = maxEventsPerDrain;
    this.#instanceId = nextBusInstance++;
  }

  get sequence() {
    return this.#sequence;
  }

  get pendingCount() {
    return this.#queue.length;
  }

  subscribe(type, systemId, handler) {
    this.#assertType(type);
    assertId(systemId, "Subscriber system ID");
    if (!this.#sources.has(systemId)) {
      throw new EventBusError("UNKNOWN_SUBSCRIBER", `System "${systemId}" is not registered with this EventBus.`, { systemId });
    }
    if (typeof handler !== "function") {
      throw new EventBusError("INVALID_HANDLER", "Event handler must be a function.", { type, systemId });
    }
    let entries = this.#subscriptions.get(type);
    if (!entries) {
      entries = [];
      this.#subscriptions.set(type, entries);
    }
    if (entries.some((entry) => entry.systemId === systemId)) {
      throw new EventBusError("DUPLICATE_SUBSCRIPTION", `System "${systemId}" is already subscribed to "${type}".`, { type, systemId });
    }
    const entry = { systemId, handler, active: true };
    entries.push(entry);
    let subscribed = true;
    return () => {
      if (!subscribed) return false;
      subscribed = false;
      entry.active = false;
      const current = this.#subscriptions.get(type);
      if (current) {
        const index = current.indexOf(entry);
        if (index !== -1) current.splice(index, 1);
        if (current.length === 0) this.#subscriptions.delete(type);
      }
      return true;
    };
  }

  publish({ type, version = 1, source, payload = {} } = {}) {
    this.#assertType(type);
    assertId(source, "Event source ID");
    if (!this.#sources.has(source)) {
      throw new EventBusError("UNKNOWN_SOURCE", `Event source "${source}" is not registered.`, { source, type });
    }
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new EventBusError("INVALID_VERSION", "Event version must be a positive integer.", { version, type });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new EventBusError("INVALID_PAYLOAD", "Event payload must be a data object.", { type });
    }

    // Validate and detach the complete payload before consuming a sequence.
    const immutablePayload = cloneImmutable(payload);
    if (this.#sequence >= Number.MAX_SAFE_INTEGER) {
      throw new EventBusError("SEQUENCE_EXHAUSTED", "Event sequence reached Number.MAX_SAFE_INTEGER.");
    }
    const sequence = this.#sequence + 1;
    const event = Object.freeze({
      id: `event:${this.#instanceId}:${sequence}`,
      type,
      version,
      source,
      sequence,
      payload: immutablePayload
    });

    // Commit the sequence only after the event is fully constructed.
    this.#sequence = sequence;
    this.#queue.push(event);
    if (!this.#draining) this.#drain();
    return event;
  }

  #drain() {
    this.#draining = true;
    let processed = 0;
    try {
      while (this.#queue.length > 0) {
        if (processed >= this.#maxEventsPerDrain) {
          const pending = this.#queue.length;
          this.#queue.length = 0;
          const error = new EventBusError(
            "EVENT_DRAIN_LIMIT",
            `Event delivery exceeded the per-drain limit of ${this.#maxEventsPerDrain}; pending events were discarded to prevent an infinite event chain.`,
            { maxEventsPerDrain: this.#maxEventsPerDrain, pending }
          );
          this.#logError(error, null);
          throw error;
        }
        const event = this.#queue.shift();
        processed += 1;
        // Snapshot once at delivery start. Subscription changes during this
        // delivery affect only subsequent events.
        const recipients = [...(this.#subscriptions.get(event.type) ?? [])];
        for (const recipient of recipients) {
          try {
            recipient.handler(event);
          } catch (error) {
            this.#logError(error, { type: event.type, eventId: event.id, source: event.source, subscriber: recipient.systemId });
          }
        }
      }
    } finally {
      this.#draining = false;
    }
  }

  #assertType(type) {
    if (typeof type !== "string" || !TYPE_PATTERN.test(type)) {
      throw new EventBusError("INVALID_EVENT_TYPE", "Event type must use a stable domain-prefixed name such as pawn.damaged.", { type });
    }
  }

  #logError(error, details) {
    try {
      this.#logger?.error?.("EventBus delivery error", {
        code: error?.code ?? "HANDLER_ERROR",
        message: error?.message ?? String(error),
        ...(details ?? {})
      });
    } catch {
      // Logger failures must not interrupt event delivery.
    }
  }
}
