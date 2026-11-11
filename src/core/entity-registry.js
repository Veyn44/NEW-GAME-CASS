const ENTITY_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const ENTITY_KIND_PATTERN = /^[a-z][a-z0-9.-]*$/;
const SNAPSHOT_VERSION = 1;

export class EntityRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "EntityRegistryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertEntityId(value, label = "Entity ID") {
  if (typeof value !== "string" || !ENTITY_ID_PATTERN.test(value)) {
    throw new EntityRegistryError("INVALID_ENTITY_ID", `${label} must be a stable ID using letters, numbers, colon, dot, underscore or hyphen.`, { value });
  }
  return value;
}

function assertKind(value) {
  if (typeof value !== "string" || !ENTITY_KIND_PATTERN.test(value)) {
    throw new EntityRegistryError("INVALID_ENTITY_KIND", "Entity kind must be a stable lowercase domain ID.", { value });
  }
  return value;
}

/** Copies JSON-like metadata without invoking getters or retaining mutable references. */
function cloneData(value, path = "metadata", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw new EntityRegistryError("INVALID_METADATA", `${path} contains a non-serializable value.`);
  if (seen.has(value)) throw new EntityRegistryError("INVALID_METADATA", `${path} contains a circular reference.`);

  let prototype;
  let keys;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new EntityRegistryError("INVALID_METADATA", `${path} could not be inspected safely.`);
  }
  const isArray = Array.isArray(value);
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new EntityRegistryError("INVALID_METADATA", `${path} must contain only plain objects and arrays.`);
  }

  seen.add(value);
  try {
    if (isArray) {
      const result = new Array(value.length);
      const indices = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\\d*)$/.test(key) || Number(key) >= value.length) {
          throw new EntityRegistryError("INVALID_METADATA", `${path} contains an unsupported array property.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new EntityRegistryError("INVALID_METADATA", `${path} contains an accessor or hidden property.`);
        }
        indices.add(Number(key));
        result[Number(key)] = cloneData(descriptor.value, `${path}[${key}]`, seen);
      }
      if (indices.size !== value.length) throw new EntityRegistryError("INVALID_METADATA", `${path} contains a sparse array.`);
      return Object.freeze(result);
    }

    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") throw new EntityRegistryError("INVALID_METADATA", `${path} contains a symbol key.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new EntityRegistryError("INVALID_METADATA", `${path}.${key} must be an enumerable data property.`);
      }
      Object.defineProperty(result, key, {
        value: cloneData(descriptor.value, `${path}.${key}`, seen),
        enumerable: true
      });
    }
    return Object.freeze(result);
  } finally {
    seen.delete(value);
  }
}

function freezeRecord(record) {
  return Object.freeze({
    id: record.id,
    kind: record.kind,
    scope: record.scope,
    encounterId: record.encounterId,
    originEncounterId: record.originEncounterId ?? null,
    status: record.status,
    metadata: record.metadata
  });
}

function validateRecord(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new EntityRegistryError("INVALID_SNAPSHOT", `Entity record at index ${index} must be an object.`);
  }
  const id = assertEntityId(raw.id);
  const kind = assertKind(raw.kind);
  if (raw.scope !== "persistent" && raw.scope !== "encounter") {
    throw new EntityRegistryError("INVALID_SNAPSHOT", `Entity "${id}" has an invalid scope.`, { id, scope: raw.scope });
  }
  if (!["active", "stored", "removed"].includes(raw.status)) {
    throw new EntityRegistryError("INVALID_SNAPSHOT", `Entity "${id}" has an invalid lifecycle status.`, { id, status: raw.status });
  }
  if (raw.scope === "encounter" && (typeof raw.encounterId !== "string" || !ENTITY_ID_PATTERN.test(raw.encounterId))) {
    throw new EntityRegistryError("INVALID_SNAPSHOT", `Encounter entity "${id}" requires a valid encounterId.`, { id });
  }
  if (raw.scope === "persistent" && raw.encounterId !== null) {
    throw new EntityRegistryError("INVALID_SNAPSHOT", `Persistent entity "${id}" cannot retain an active encounterId.`, { id });
  }
  if (raw.status === "stored" && raw.scope !== "persistent") {
    throw new EntityRegistryError("INVALID_SNAPSHOT", `Stored entity "${id}" must have persistent scope.`, { id });
  }
  if (raw.originEncounterId !== null && raw.originEncounterId !== undefined) {
    assertEntityId(raw.originEncounterId, "Origin encounter ID");
  }
  if (raw.scope === "encounter" && raw.originEncounterId !== null && raw.originEncounterId !== undefined && raw.originEncounterId !== raw.encounterId) {
    throw new EntityRegistryError("INVALID_SNAPSHOT", `Encounter entity "${id}" has inconsistent origin metadata.`, { id });
  }
  const metadata = cloneData(raw.metadata ?? {}, `entities[${index}].metadata`);
  return freezeRecord({
    id, kind, scope: raw.scope, encounterId: raw.encounterId,
    originEncounterId: raw.originEncounterId ?? null,
    status: raw.status, metadata
  });
}

/**
 * Owns stable entity identity and lifecycle metadata only.
 * Domain state, ownership relationships and world placement remain with their
 * respective systems. "active" does not mean that a world instance is loaded.
 */
export class EntityRegistry {
  #entities = new Map();
  #idFactory;
  #encounterCounters = new Map();
  #logger;

  constructor({ idFactory = defaultIdFactory, logger = null } = {}) {
    if (typeof idFactory !== "function") throw new EntityRegistryError("INVALID_ID_FACTORY", "idFactory must be a function.");
    if (logger !== null && typeof logger.error !== "function") {
      throw new EntityRegistryError("INVALID_LOGGER", "Logger must expose error(message, details).");
    }
    this.#idFactory = idFactory;
    this.#logger = logger;
  }

  get size() { return this.#entities.size; }

  registerPersistent({ id = null, kind, metadata = {} } = {}) {
    const entityId = id === null ? this.#newPersistentId() : assertEntityId(id);
    return this.#register({
      id: entityId, kind, scope: "persistent", encounterId: null,
      originEncounterId: null, status: "active", metadata
    });
  }

  registerEncounter({ encounterId, localId = null, kind, metadata = {} } = {}) {
    assertEntityId(encounterId, "Encounter ID");
    let local = localId;
    if (local === null) {
      const next = (this.#encounterCounters.get(encounterId) ?? 0) + 1;
      this.#encounterCounters.set(encounterId, next);
      local = String(next);
    }
    assertEntityId(local, "Encounter-local ID");
    const id = `encounter:${encounterId}:${local}`;
    assertEntityId(id);
    return this.#register({
      id, kind, scope: "encounter", encounterId,
      originEncounterId: encounterId, status: "active", metadata
    });
  }

  has(id) {
    assertEntityId(id);
    return this.#entities.has(id);
  }

  get(id) {
    assertEntityId(id);
    const record = this.#entities.get(id);
    return record ?? null;
  }

  list({ scope = null, status = null, encounterId = null, kind = null } = {}) {
    if (scope !== null && scope !== "persistent" && scope !== "encounter") {
      throw new EntityRegistryError("INVALID_FILTER", "scope must be persistent, encounter or null.", { scope });
    }
    if (status !== null && !["active", "stored", "removed"].includes(status)) {
      throw new EntityRegistryError("INVALID_FILTER", "Unknown entity lifecycle status.", { status });
    }
    if (encounterId !== null) assertEntityId(encounterId, "Encounter ID");
    if (kind !== null) assertKind(kind);
    return Object.freeze([...this.#entities.values()]
      .filter((item) => scope === null || item.scope === scope)
      .filter((item) => status === null || item.status === status)
      .filter((item) => encounterId === null || item.encounterId === encounterId || item.originEncounterId === encounterId)
      .filter((item) => kind === null || item.kind === kind)
      .sort((a, b) => a.id.localeCompare(b.id)));
  }

  /**
   * Explicitly preserves an encounter entity in the campaign Entity Store.
   * Only identity metadata is stored here; its owning domain system must
   * persist the entity's actual state through its own Persistence participant.
   */
  store(id) {
    const current = this.#require(id);
    if (current.status !== "active" || current.scope !== "encounter") {
      throw new EntityRegistryError("ENTITY_NOT_STORABLE", `Entity "${id}" is not an active encounter entity.`, { id, scope: current.scope, status: current.status });
    }
    const updated = freezeRecord({
      ...current, scope: "persistent", encounterId: null,
      originEncounterId: current.encounterId, status: "stored"
    });
    this.#entities.set(id, updated);
    this.#log("info", "Encounter entity explicitly transferred to Entity Store.", { entityId: id, encounterId: current.encounterId });
    return updated;
  }

  /** Marks a stored identity as active again; world placement is handled elsewhere. */
  activateStored(id) {
    const current = this.#require(id);
    if (current.status !== "stored") {
      throw new EntityRegistryError("ENTITY_NOT_STORED", `Entity "${id}" is not stored.`, { id, status: current.status });
    }
    const updated = freezeRecord({ ...current, status: "active" });
    this.#entities.set(id, updated);
    return updated;
  }

  /** Creates a tombstone. IDs are never reusable within this registry. */
  remove(id) {
    const current = this.#require(id);
    if (current.status === "removed") return false;
    this.#entities.set(id, freezeRecord({ ...current, status: "removed" }));
    return true;
  }

  /**
   * Persistence participant contract. The registry snapshots identity records,
   * not domain entity data or world placement.
   */
  createPersistenceParticipant({ id = "core.entity-registry", order = -100 } = {}) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(id)) {
      throw new EntityRegistryError("INVALID_PARTICIPANT_ID", "Persistence participant ID must be a stable lowercase ID.", { id });
    }
    if (!Number.isSafeInteger(order)) throw new EntityRegistryError("INVALID_PARTICIPANT_ORDER", "Persistence participant order must be a safe integer.", { order });
    return Object.freeze({
      id,
      schemaVersion: SNAPSHOT_VERSION,
      required: true,
      order,
      captureSnapshot: () => this.captureSnapshot(),
      validateSnapshot: (snapshot) => {
        try { this.#parseSnapshot(snapshot); return true; }
        catch { return false; }
      },
      prepareRestore: (snapshot) => this.prepareRestore(snapshot)
    });
  }

  captureSnapshot() {
    return Object.freeze({
      version: SNAPSHOT_VERSION,
      entities: Object.freeze([...this.#entities.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((record) => ({
          id: record.id,
          kind: record.kind,
          scope: record.scope,
          encounterId: record.encounterId,
          originEncounterId: record.originEncounterId,
          status: record.status,
          metadata: record.metadata
        })))
    });
  }

  /** Preparation is side-effect-free; commit swaps the complete registry state. */
  prepareRestore(snapshot) {
    const next = this.#parseSnapshot(snapshot);
    const previous = this.#entities;
    let committed = false;
    return Object.freeze({
      commit: () => {
        if (committed) throw new EntityRegistryError("RESTORE_ALREADY_COMMITTED", "Entity Registry restore transaction was already committed.");
        this.#entities = next;
        this.#encounterCounters = new Map();
        for (const record of next.values()) {
          if (record.scope === "encounter") {
            const match = record.id.match(/^encounter:(.+):([a-zA-Z0-9._-]+)$/);
            if (match && /^\d+$/.test(match[2])) {
              this.#encounterCounters.set(match[1], Math.max(this.#encounterCounters.get(match[1]) ?? 0, Number(match[2])));
            }
          }
        }
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#entities = previous;
        this.#encounterCounters = new Map();
        for (const record of previous.values()) {
          if (record.scope === "encounter") {
            const match = record.id.match(/^encounter:(.+):([a-zA-Z0-9._-]+)$/);
            if (match && /^\d+$/.test(match[2])) {
              this.#encounterCounters.set(match[1], Math.max(this.#encounterCounters.get(match[1]) ?? 0, Number(match[2])));
            }
          }
        }
        committed = false;
        return true;
      }
    });
  }

  #register(record) {
    const kind = assertKind(record.kind);
    if (this.#entities.has(record.id)) {
      throw new EntityRegistryError("DUPLICATE_ENTITY_ID", `Entity ID "${record.id}" has already been used.`, { id: record.id });
    }
    const metadata = cloneData(record.metadata);
    const entity = freezeRecord({ ...record, kind, metadata });
    this.#entities.set(entity.id, entity);
    return entity;
  }

  #newPersistentId() {
    const generated = this.#idFactory();
    assertEntityId(generated, "Generated entity ID");
    return generated.startsWith("entity:") ? generated : `entity:${generated}`;
  }

  #require(id) {
    assertEntityId(id);
    const record = this.#entities.get(id);
    if (!record) throw new EntityRegistryError("UNKNOWN_ENTITY", `Entity "${id}" is not registered.`, { id });
    return record;
  }

  #parseSnapshot(snapshot) {
    const safeSnapshot = cloneData(snapshot, "snapshot");
    if (!safeSnapshot || typeof safeSnapshot !== "object" || Array.isArray(safeSnapshot) || safeSnapshot.version !== SNAPSHOT_VERSION || !Array.isArray(safeSnapshot.entities)) {
      throw new EntityRegistryError("INVALID_SNAPSHOT", "Entity Registry snapshot has an unsupported version or shape.");
    }
    const next = new Map();
    safeSnapshot.entities.forEach((raw, index) => {
      const record = validateRecord(raw, index);
      if (next.has(record.id)) throw new EntityRegistryError("DUPLICATE_ENTITY_ID", `Snapshot repeats entity ID "${record.id}".`, { id: record.id });
      next.set(record.id, record);
    });
    return next;
  }

  #log(level, message, details) {
    try { this.#logger?.[level]?.(message, { source: "core.entity-registry", category: "entity-registry", ...details }); }
    catch { /* Diagnostics must not interrupt identity/lifecycle operations. */ }
  }
}

function defaultIdFactory() {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject || typeof cryptoObject.randomUUID !== "function") {
    throw new EntityRegistryError("ID_GENERATION_UNAVAILABLE", "A secure randomUUID implementation is required; provide idFactory when unavailable.");
  }
  return cryptoObject.randomUUID();
}
