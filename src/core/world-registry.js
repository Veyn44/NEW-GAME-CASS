const WORLD_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const WORLD_TYPE_PATTERN = /^[a-z][a-z0-9.-]*$/;
const SNAPSHOT_VERSION = 2;

export class WorldRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorldRegistryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertId(value, label = "World ID") {
  if (typeof value !== "string" || !WORLD_ID_PATTERN.test(value)) {
    throw new WorldRegistryError("INVALID_WORLD_ID", `${label} must be a stable ID using letters, numbers, colon, dot, underscore or hyphen.`, { value });
  }
  return value;
}

function assertType(value) {
  if (typeof value !== "string" || !WORLD_TYPE_PATTERN.test(value)) {
    throw new WorldRegistryError("INVALID_WORLD_TYPE", "World type must be a stable lowercase domain ID.", { value });
  }
  return value;
}

function clonePlain(value, path = "snapshot", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} contains an unsupported or circular value.`);
  }
  let prototype;
  let keys;
  let array;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    array = Array.isArray(value);
  } catch {
    throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} could not be inspected safely.`);
  }
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} must contain only plain objects and arrays.`);
  }
  seen.add(value);
  try {
    if (array) {
      const result = new Array(value.length);
      const indices = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} contains an unsupported array property.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} contains an accessor or hidden property.`);
        }
        indices.add(Number(key));
        result[Number(key)] = clonePlain(descriptor.value, `${path}[${key}]`, seen);
      }
      if (indices.size !== value.length) throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} contains a sparse array.`);
      return Object.freeze(result);
    }
    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} contains a symbol key.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new WorldRegistryError("INVALID_SNAPSHOT", `${path} contains an accessor or hidden property.`);
      }
      Object.defineProperty(result, key, {
        value: clonePlain(descriptor.value, `${path}.${key}`, seen),
        enumerable: true
      });
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof WorldRegistryError) throw error;
    throw new WorldRegistryError("INVALID_SNAPSHOT", path + " could not be copied safely.");
  } finally { seen.delete(value); }
}

function freezeWorld(raw) {
  return Object.freeze({
    worldId: raw.worldId,
    type: raw.type,
    status: raw.status,
    dimensions: Object.freeze({ width: raw.dimensions.width, height: raw.dimensions.height }),
    coordinateSystem: raw.coordinateSystem,
    metadata: clonePlain(raw.metadata ?? {}, "world.metadata")
  });
}

function validateWorld(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WorldRegistryError("INVALID_SNAPSHOT", `World record at index ${index} must be an object.`);
  }
  const worldId = assertId(raw.worldId);
  const type = assertType(raw.type);
  if (!["inactive", "active", "closed"].includes(raw.status)) {
    throw new WorldRegistryError("INVALID_SNAPSHOT", `World "${worldId}" has an invalid lifecycle status.`, { worldId, status: raw.status });
  }
  const width = raw.dimensions?.width;
  const height = raw.dimensions?.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new WorldRegistryError("INVALID_SNAPSHOT", `World "${worldId}" requires positive finite dimensions.`, { worldId });
  }
  if (typeof raw.coordinateSystem !== "string" || raw.coordinateSystem.length < 1 || raw.coordinateSystem.length > 80) {
    throw new WorldRegistryError("INVALID_SNAPSHOT", `World "${worldId}" requires a coordinateSystem label.`, { worldId });
  }
  return freezeWorld({
    worldId, type, status: raw.status,
    dimensions: { width, height },
    coordinateSystem: raw.coordinateSystem,
    metadata: clonePlain(raw.metadata ?? {}, `worlds[${index}].metadata`)
  });
}

/**
 * Owns map-world identity, descriptors and active-world lifecycle.
 * It does not own map contents, entities, universe data, rendering or simulation.
 */
export class WorldRegistry {
  #worlds = new Map();
  #activeWorldId = null;
  #idFactory;

  constructor({ idFactory = defaultIdFactory } = {}) {
    if (typeof idFactory !== "function") {
      throw new WorldRegistryError("INVALID_ID_FACTORY", "idFactory must be a function.");
    }
    this.#idFactory = idFactory;
  }

  get size() { return this.#worlds.size; }
  get activeWorldId() { return this.#activeWorldId; }

  registerWorld({
    worldId = null,
    type,
    dimensions,
    coordinateSystem = "world-units",
    metadata = {}
  } = {}) {
    const worldType = assertType(type);
    const id = worldId === null ? this.#newWorldId() : assertId(worldId);
    if (this.#worlds.has(id)) {
      throw new WorldRegistryError("DUPLICATE_WORLD_ID", `World ID "${id}" has already been used.`, { worldId: id });
    }
    if (!dimensions || typeof dimensions !== "object" || Array.isArray(dimensions)) {
      throw new WorldRegistryError("INVALID_DIMENSIONS", "World dimensions must be an object with positive width and height.");
    }
    const width = dimensions.width;
    const height = dimensions.height;
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new WorldRegistryError("INVALID_DIMENSIONS", "World width and height must be positive finite numbers.", { width, height });
    }
    if (typeof coordinateSystem !== "string" || coordinateSystem.length < 1 || coordinateSystem.length > 80) {
      throw new WorldRegistryError("INVALID_COORDINATE_SYSTEM", "coordinateSystem must be a non-empty label of at most 80 characters.");
    }
    const world = freezeWorld({
      worldId: id, type: worldType, status: "inactive",
      dimensions: { width, height }, coordinateSystem,
      metadata: clonePlain(metadata, "world.metadata")
    });
    this.#worlds.set(id, world);
    return world;
  }

  has(worldId) {
    assertId(worldId);
    return this.#worlds.has(worldId);
  }

  get(worldId) {
    assertId(worldId);
    return this.#worlds.get(worldId) ?? null;
  }

  getActiveWorld() {
    return this.#activeWorldId === null ? null : this.#worlds.get(this.#activeWorldId) ?? null;
  }

  list({ type = null, status = null } = {}) {
    if (type !== null) assertType(type);
    if (status !== null && !["inactive", "active", "closed"].includes(status)) {
      throw new WorldRegistryError("INVALID_FILTER", "Unknown world lifecycle status.", { status });
    }
    return Object.freeze([...this.#worlds.values()]
      .filter((world) => type === null || world.type === type)
      .filter((world) => status === null || world.status === status)
      .sort((a, b) => a.worldId.localeCompare(b.worldId)));
  }

  /** Atomically makes this world active and the previous active world inactive. */
  activateWorld(worldId) {
    const target = this.#require(worldId);
    if (target.status === "closed") {
      throw new WorldRegistryError("WORLD_CLOSED", `Closed world "${worldId}" cannot be activated.`, { worldId });
    }
    if (this.#activeWorldId === worldId) return target;
    if (this.#activeWorldId !== null) {
      const previous = this.#worlds.get(this.#activeWorldId);
      this.#worlds.set(previous.worldId, freezeWorld({ ...previous, status: "inactive" }));
    }
    const active = freezeWorld({ ...target, status: "active" });
    this.#worlds.set(worldId, active);
    this.#activeWorldId = worldId;
    return active;
  }

  deactivateWorld(worldId) {
    const current = this.#require(worldId);
    if (current.status !== "active" || this.#activeWorldId !== worldId) return false;
    this.#worlds.set(worldId, freezeWorld({ ...current, status: "inactive" }));
    this.#activeWorldId = null;
    return true;
  }

  /** A world may be closed after it is no longer active. */
  closeWorld(worldId) {
    const current = this.#require(worldId);
    if (current.status === "closed") return false;
    if (current.status === "active" || this.#activeWorldId === worldId) {
      throw new WorldRegistryError("WORLD_ACTIVE", "An active world must be deactivated before it can be closed.", { worldId });
    }
    this.#worlds.set(worldId, freezeWorld({ ...current, status: "closed" }));
    return true;
  }

  createPersistenceParticipant({ id = "core.world-registry", order = -90 } = {}) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(id)) {
      throw new WorldRegistryError("INVALID_PARTICIPANT_ID", "Persistence participant ID must be a stable lowercase ID.", { id });
    }
    if (!Number.isSafeInteger(order)) {
      throw new WorldRegistryError("INVALID_PARTICIPANT_ORDER", "Persistence participant order must be a safe integer.", { order });
    }
    return Object.freeze({
      id,
      schemaVersion: SNAPSHOT_VERSION,
      required: true,
      order,
      captureSnapshot: () => this.captureSnapshot(),
      migrateSnapshot: (snapshot, fromVersion) => {
        if (fromVersion !== 1 || !snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.worlds)) {
          throw new WorldRegistryError("UNSUPPORTED_MIGRATION", "World Registry can migrate only version-one snapshots.");
        }
        return {
          version: SNAPSHOT_VERSION,
          activeWorldId: snapshot.activeWorldId ?? null,
          worlds: snapshot.worlds.map((world) => {
            const { locationId, encounterId, metadata = {}, ...record } = world;
            return { ...record, metadata: { ...metadata, ...(locationId == null ? {} : { locationId }), ...(encounterId == null ? {} : { encounterId }) } };
          })
        };
      },
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
      activeWorldId: this.#activeWorldId,
      worlds: Object.freeze(this.list().map((world) => ({
        worldId: world.worldId,
        type: world.type,
        status: world.status,
        dimensions: { width: world.dimensions.width, height: world.dimensions.height },
        coordinateSystem: world.coordinateSystem,
        metadata: world.metadata
      })))
    });
  }

  /** Preparation is side-effect-free; commit replaces the complete registry state. */
  prepareRestore(snapshot) {
    const parsed = this.#parseSnapshot(snapshot);
    const previousWorlds = this.#worlds;
    const previousActiveWorldId = this.#activeWorldId;
    let committed = false;
    return Object.freeze({
      commit: () => {
        if (committed) throw new WorldRegistryError("RESTORE_ALREADY_COMMITTED", "World Registry restore transaction was already committed.");
        this.#worlds = parsed.worlds;
        this.#activeWorldId = parsed.activeWorldId;
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#worlds = previousWorlds;
        this.#activeWorldId = previousActiveWorldId;
        committed = false;
        return true;
      }
    });
  }

  #newWorldId() {
    const generated = this.#idFactory();
    assertId(generated, "Generated world ID");
    return generated.startsWith("world:") ? generated : `world:${generated}`;
  }

  #require(worldId) {
    assertId(worldId);
    const world = this.#worlds.get(worldId);
    if (!world) throw new WorldRegistryError("UNKNOWN_WORLD", `World "${worldId}" is not registered.`, { worldId });
    return world;
  }

  #parseSnapshot(snapshot) {
    const safe = clonePlain(snapshot);
    if (!safe || Array.isArray(safe) || safe.version !== SNAPSHOT_VERSION || !Array.isArray(safe.worlds)) {
      throw new WorldRegistryError("INVALID_SNAPSHOT", "World Registry snapshot has an unsupported version or shape.");
    }
    const worlds = new Map();
    let activeWorldId = null;
    for (let index = 0; index < safe.worlds.length; index += 1) {
      const world = validateWorld(safe.worlds[index], index);
      if (worlds.has(world.worldId)) {
        throw new WorldRegistryError("DUPLICATE_WORLD_ID", `Snapshot repeats world ID "${world.worldId}".`, { worldId: world.worldId });
      }
      if (world.status === "active") {
        if (activeWorldId !== null) {
          throw new WorldRegistryError("MULTIPLE_ACTIVE_WORLDS", "Snapshot cannot contain more than one active map world.");
        }
        activeWorldId = world.worldId;
      }
      worlds.set(world.worldId, world);
    }
    if (safe.activeWorldId !== activeWorldId) {
      throw new WorldRegistryError("INVALID_ACTIVE_WORLD", "Snapshot activeWorldId does not match the active world record.", { activeWorldId: safe.activeWorldId, recordActiveWorldId: activeWorldId });
    }
    return { worlds, activeWorldId };
  }
}

function defaultIdFactory() {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject || typeof cryptoObject.randomUUID !== "function") {
    throw new WorldRegistryError("ID_GENERATION_UNAVAILABLE", "A secure randomUUID implementation is required; provide idFactory when unavailable.");
  }
  return cryptoObject.randomUUID();
}
