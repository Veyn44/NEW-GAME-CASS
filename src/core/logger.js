const LEVELS = Object.freeze({ DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, CRITICAL: 50 });
const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
const DEFAULT_CAPACITY = 2000;

export class LoggerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LoggerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function cloneData(value, path = "details", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new LoggerError("INVALID_LOG_DATA", path + " contains a non-finite number.");
    return value;
  }
  if (typeof value !== "object") throw new LoggerError("INVALID_LOG_DATA", path + " contains a non-serializable value.");
  if (seen.has(value)) throw new LoggerError("INVALID_LOG_DATA", path + " contains a circular reference.");

  let prototype;
  let array;
  let keys;
  let length = 0;
  try {
    array = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    if (array) length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  } catch {
    throw new LoggerError("INVALID_LOG_DATA", path + " could not be inspected safely.");
  }
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new LoggerError("INVALID_LOG_DATA", path + " must contain only plain objects and arrays.");
  }
  if (array && (!Number.isSafeInteger(length) || length < 0)) {
    throw new LoggerError("INVALID_LOG_DATA", path + " has an invalid array length.");
  }

  seen.add(value);
  try {
    if (array) {
      const result = new Array(length);
      const indices = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key)) {
          throw new LoggerError("INVALID_LOG_DATA", path + " contains an unsupported array property.");
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index >= length) {
          throw new LoggerError("INVALID_LOG_DATA", path + " contains an unsupported array property.");
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new LoggerError("INVALID_LOG_DATA", path + " contains an accessor or hidden array property.");
        }
        indices.add(index);
        result[index] = cloneData(descriptor.value, path + "[" + key + "]", seen);
      }
      if (indices.size !== length) throw new LoggerError("INVALID_LOG_DATA", path + " contains sparse arrays.");
      return Object.freeze(result);
    }

    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") throw new LoggerError("INVALID_LOG_DATA", path + " contains a symbol key.");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new LoggerError("INVALID_LOG_DATA", path + "." + key + " must be a plain data property.");
      }
      Object.defineProperty(result, key, {
        value: cloneData(descriptor.value, path + "." + key, seen),
        enumerable: true
      });
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof LoggerError) throw error;
    throw new LoggerError("INVALID_LOG_DATA", path + " could not be copied safely.");
  } finally {
    seen.delete(value);
  }
}

/**
 * Bounded, structured technical logger. It never changes game state.
 * Output sinks are optional and are isolated from the caller.
 */
export class Logger {
  #records = [];
  #capacity;
  #minimumLevel;
  #clock;
  #sink;
  #dropped = 0;

  constructor({ capacity = DEFAULT_CAPACITY, minimumLevel = "DEBUG", clock = () => new Date().toISOString(), sink = null } = {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new LoggerError("INVALID_CAPACITY", "Logger capacity must be a positive safe integer.", { capacity });
    }
    if (!Object.hasOwn(LEVELS, minimumLevel)) {
      throw new LoggerError("INVALID_LEVEL", "minimumLevel must be DEBUG, INFO, WARN, ERROR, or CRITICAL.", { minimumLevel });
    }
    if (typeof clock !== "function") throw new LoggerError("INVALID_CLOCK", "Logger clock must be a function.");
    if (sink !== null && typeof sink !== "function") throw new LoggerError("INVALID_SINK", "Logger sink must be a function or null.");
    this.#capacity = capacity;
    this.#minimumLevel = minimumLevel;
    this.#clock = clock;
    this.#sink = sink;
  }

  get size() { return this.#records.length; }
  get droppedCount() { return this.#dropped; }
  get minimumLevel() { return this.#minimumLevel; }

  setMinimumLevel(level) {
    if (!Object.hasOwn(LEVELS, level)) throw new LoggerError("INVALID_LEVEL", "Unknown log level.", { level });
    this.#minimumLevel = level;
  }

  debug(message, details = {}) { return this.#write("DEBUG", message, details); }
  info(message, details = {}) { return this.#write("INFO", message, details); }
  warn(message, details = {}) { return this.#write("WARN", message, details); }
  error(message, details = {}) { return this.#write("ERROR", message, details); }
  critical(message, details = {}) { return this.#write("CRITICAL", message, details); }

  getRecords({ minimumLevel = "DEBUG", category = null, source = null, limit = this.#capacity } = {}) {
    if (!Object.hasOwn(LEVELS, minimumLevel)) throw new LoggerError("INVALID_LEVEL", "Unknown minimum log level.", { minimumLevel });
    if (!Number.isSafeInteger(limit) || limit < 0) throw new LoggerError("INVALID_LIMIT", "limit must be a non-negative safe integer.", { limit });
    return Object.freeze(this.#records
      .filter((record) => LEVELS[record.level] >= LEVELS[minimumLevel])
      .filter((record) => category === null || record.category === category)
      .filter((record) => source === null || record.source === source)
      .slice(limit === 0 ? this.#records.length : -limit));
  }

  clear() {
    const removed = this.#records.length;
    this.#records.length = 0;
    return removed;
  }

  #write(level, message, details) {
    if (LEVELS[level] < LEVELS[this.#minimumLevel]) return null;
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new LoggerError("INVALID_MESSAGE", "Log message must be a non-empty string.");
    }
    if (!details || typeof details !== "object") {
      throw new LoggerError("INVALID_DETAILS", "Log details must be an object.");
    }

    let detailsArray;
    let detailsPrototype;
    let keys;
    try {
      detailsArray = Array.isArray(details);
      detailsPrototype = Object.getPrototypeOf(details);
      keys = Reflect.ownKeys(details);
    } catch {
      throw new LoggerError("INVALID_DETAILS", "Log details could not be inspected safely.");
    }
    if (detailsArray || (detailsPrototype !== Object.prototype && detailsPrototype !== null)) {
      throw new LoggerError("INVALID_DETAILS", "Log details must be a plain object.");
    }

    const values = new Map();
    for (const key of keys) {
      if (typeof key !== "string") throw new LoggerError("INVALID_LOG_DATA", "Log details cannot contain symbol keys.");
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(details, key); }
      catch { throw new LoggerError("INVALID_LOG_DATA", "Log details property could not be inspected safely."); }
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new LoggerError("INVALID_LOG_DATA", "Log details properties must be enumerable data properties.");
      }
      values.set(key, descriptor.value);
    }

    const source = values.get("source") ?? "core";
    const category = values.get("category") ?? "general";
    if (typeof source !== "string" || !ID_PATTERN.test(source)) throw new LoggerError("INVALID_SOURCE", "Log source must be a stable lowercase ID.", { source });
    if (typeof category !== "string" || !ID_PATTERN.test(category)) throw new LoggerError("INVALID_CATEGORY", "Log category must be a stable lowercase ID.", { category });

    let timestamp;
    try { timestamp = this.#clock(); }
    catch { timestamp = null; }
    if (typeof timestamp !== "string" || timestamp.length === 0) timestamp = null;

    const metadata = Object.create(null);
    for (const [key, value] of values) {
      if (key === "source" || key === "category") continue;
      Object.defineProperty(metadata, key, { value, enumerable: true });
    }
    const record = Object.freeze({
      timestamp,
      level,
      source,
      category,
      message,
      details: cloneData(metadata)
    });
    if (this.#records.length === this.#capacity) {
      this.#records.shift();
      this.#dropped += 1;
    }
    this.#records.push(record);
    try { this.#sink?.(record); } catch { /* Output failures must not affect the caller. */ }
    return record;
  }
}
