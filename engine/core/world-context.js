import { PLACEMENT_AUTHORITY } from "../spatial/placement-authority.js";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const SNAPSHOT_VERSION = 1;

export class WorldContextError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorldContextError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function cloneSnapshotData(value, path = "snapshot", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") {
    throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains a non-serializable value.`);
  }
  if (seen.has(value)) {
    throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains a circular reference.`);
  }

  let prototype;
  let keys;
  let isArray;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    isArray = Array.isArray(value);
  } catch {
    throw new WorldContextError("INVALID_SNAPSHOT", `${path} could not be inspected safely.`);
  }

  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new WorldContextError("INVALID_SNAPSHOT", `${path} must contain only plain objects and arrays.`);
  }

  seen.add(value);
  try {
    if (isArray) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new WorldContextError("INVALID_SNAPSHOT", `${path} has an invalid array length.`);
      }
      const copy = new Array(length);
      const indices = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string") {
          throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains a symbol-keyed array property.`);
        }
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
          throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains an unsupported array property.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains an accessor or hidden array property.`);
        }
        indices.add(index);
        copy[index] = cloneSnapshotData(descriptor.value, `${path}[${index}]`, seen);
      }
      if (indices.size !== length) {
        throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains a sparse array.`);
      }
      return copy;
    }

    const copy = Object.create(prototype);
    for (const key of keys) {
      if (typeof key !== "string") {
        throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains a symbol-keyed property.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new WorldContextError("INVALID_SNAPSHOT", `${path} contains an accessor or hidden property.`);
      }
      Object.defineProperty(copy, key, {
        value: cloneSnapshotData(descriptor.value, `${path}.${key}`, seen),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return copy;
  } catch (error) {
    if (error instanceof WorldContextError) throw error;
    throw new WorldContextError("INVALID_SNAPSHOT", `${path} could not be copied safely.`);
  } finally {
    seen.delete(value);
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new WorldContextError("INVALID_ID", `${label} must be a stable ID.`, { value });
  }
  return value;
}

function clonePosition(position) {
  if (!position || typeof position !== "object" || Array.isArray(position) ||
      !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    throw new WorldContextError("INVALID_POSITION", "World placement requires finite x and y coordinates.");
  }
  return Object.freeze({ x: position.x, y: position.y });
}

function freezePlacement(raw) {
  if (raw.type === "world") {
    return Object.freeze({
      entityId: raw.entityId,
      type: "world",
      worldId: raw.worldId,
      position: clonePosition(raw.position)
    });
  }
  return Object.freeze({
    entityId: raw.entityId,
    type: "store",
    storeId: raw.storeId
  });
}

/**
 * Coordinates exclusive physical placement of registered entities.
 * It does not own entity identity, domain state, map contents, universe data,
 * ownership relationships or world transition side effects.
 */
export class WorldContext {
  #entities;
  #worlds;
  #placements = new Map();
  #spatialCoordinationRequired = false;

  constructor({ entityRegistry, worldRegistry } = {}) {
    if (!entityRegistry || typeof entityRegistry.get !== "function") {
      throw new WorldContextError("INVALID_ENTITY_REGISTRY", "WorldContext requires an EntityRegistry-compatible service.");
    }
    if (!worldRegistry || typeof worldRegistry.get !== "function") {
      throw new WorldContextError("INVALID_WORLD_REGISTRY", "WorldContext requires a WorldRegistry-compatible service.");
    }
    this.#entities = entityRegistry;
    this.#worlds = worldRegistry;
  }

  get size() { return this.#placements.size; }

  requireSpatialCoordination(authority) {
    if (authority !== PLACEMENT_AUTHORITY) throw new WorldContextError("PLACEMENT_AUTHORITY_REQUIRED", "Only Engine placement services may enable grid coordination.");
    this.#spatialCoordinationRequired = true;
  }

  getPlacement(entityId) {
    assertId(entityId, "Entity ID");
    return this.#placements.get(entityId) ?? null;
  }

  listPlacements({ worldId = null, storeId = null, type = null } = {}) {
    if (worldId !== null) assertId(worldId, "World ID");
    if (storeId !== null) assertId(storeId, "Store ID");
    if (type !== null && type !== "world" && type !== "store") {
      throw new WorldContextError("INVALID_FILTER", "Placement type must be world, store or null.");
    }
    return Object.freeze([...this.#placements.values()]
      .filter((item) => type === null || item.type === type)
      .filter((item) => worldId === null || item.worldId === worldId)
      .filter((item) => storeId === null || item.storeId === storeId)
      .sort((a, b) => a.entityId.localeCompare(b.entityId)));
  }

  placeEntity(entityId, worldId, position) {
    if (this.#placements.has(assertId(entityId, "Entity ID"))) {
      throw new WorldContextError("ENTITY_ALREADY_PLACED", `Entity "${entityId}" already has a placement.`, { entityId });
    }
    const world = this.#worlds.get(assertId(worldId, "World ID"));
    if (world?.grid != null) throw new WorldContextError("GRID_COORDINATOR_REQUIRED", "Grid-backed placement must use PlacementCoordinator.", { entityId, worldId });
    const placement = this.#prepareWorldPlacement(entityId, worldId, position);
    this.#placements.set(entityId, placement);
    return placement;
  }

  storeEntity(entityId, storeId) {
    assertId(entityId, "Entity ID");
    const current = this.#placements.get(entityId);
    if (!current || current.type !== "world") {
      throw new WorldContextError("ENTITY_NOT_IN_WORLD", "Only an entity currently placed in a world can be transferred to the persistent storage.", { entityId });
    }
    if (this.#worlds.get(current.worldId)?.grid != null) throw new WorldContextError("GRID_COORDINATOR_REQUIRED", "Grid-backed storage transfer must use PlacementCoordinator.", { entityId });
    const stableStoreId = assertId(storeId, "Store ID");
    const entity = this.#requireActiveEntity(entityId);
    if (entity.scope !== "scoped" || entity.status !== "active") {
      throw new WorldContextError("ENTITY_NOT_STORABLE", "Only an active scoped entity can be transferred to persistent storage.", { entityId, scope: entity.scope, status: entity.status });
    }
    // EntityRegistry.store is the only mutating operation and runs after all validation.
    // The following placement replacement cannot fail, so both registries change in one synchronous operation.
    this.#entities.store(entityId);
    const placement = freezePlacement({ entityId, type: "store", storeId: stableStoreId });
    this.#placements.set(entityId, placement);
    return Object.freeze({ previous: current, current: placement });
  }

  placeInStore(entityId, storeId) {
    assertId(entityId, "Entity ID");
    if (this.#placements.has(entityId)) {
      throw new WorldContextError("ENTITY_ALREADY_PLACED", `Entity "${entityId}" already has a placement.`, { entityId });
    }
    const entity = this.#requireActiveEntity(entityId);
    if (entity.status !== "stored") {
      throw new WorldContextError("ENTITY_NOT_STORED", "Only an entity in stored lifecycle state can be placed in the persistent storage.", { entityId, status: entity.status });
    }
    const placement = freezePlacement({ entityId, type: "store", storeId: assertId(storeId, "Store ID") });
    this.#placements.set(entityId, placement);
    return placement;
  }

  moveEntity(entityId, target) {
    assertId(entityId, "Entity ID");
    const current = this.#placements.get(entityId);
    if (!current) throw new WorldContextError("ENTITY_NOT_PLACED", `Entity "${entityId}" has no current placement.`, { entityId });
    const next = this.#prepareTarget(entityId, target);
    if ((current.type === "world" && this.#worlds.get(current.worldId)?.grid != null) ||
        (next.type === "world" && this.#worlds.get(next.worldId)?.grid != null)) throw new WorldContextError("GRID_COORDINATOR_REQUIRED", "Transfers involving grid-backed placements must use PlacementCoordinator.", { entityId });
    // One synchronous map replacement is the commit point. Validation above is side-effect free.
    this.#placements.set(entityId, next);
    return Object.freeze({ previous: current, current: next });
  }

  removePlacement(entityId) {
    const id = assertId(entityId, "Entity ID");
    const current = this.#placements.get(id);
    if (current?.type === "world" && this.#worlds.get(current.worldId)?.grid != null) throw new WorldContextError("GRID_COORDINATOR_REQUIRED", "Grid-backed placement removal must use PlacementCoordinator.", { entityId: id });
    return this.#placements.delete(id);
  }

  /** Internal prepared mutation; only the Engine placement coordinator has the capability. */
  prepareCoordinatedPlacementChange(entityId, target, authority, { retire = false } = {}) {
    if (authority !== PLACEMENT_AUTHORITY) throw new WorldContextError("PLACEMENT_AUTHORITY_REQUIRED", "Only PlacementCoordinator may prepare coordinated changes.");
    const id = assertId(entityId, "Entity ID"), previous = this.#placements.get(id) ?? null;
    const previousWorld = previous?.type === "world" ? this.#worlds.get(previous.worldId) : null;
    let next = null, lifecycle = null;
    if (retire) {
      if (!previous || previous.type !== "world" || previousWorld?.grid == null) throw new WorldContextError("GRID_PLACEMENT_REQUIRED", "Retirement requires a grid-backed placement.", { entityId: id });
      lifecycle = this.#entities.prepareCoordinatedLifecycleChange(id, "remove", authority);
    } else if (target === null) {
      if (!previous || previous.type !== "world" || previousWorld?.grid == null) throw new WorldContextError("GRID_PLACEMENT_REQUIRED", "Removal requires a grid-backed placement.", { entityId: id });
    } else if (target?.type === "world") {
      const world = this.#worlds.get(assertId(target.worldId, "World ID"));
      if (!world) throw new WorldContextError("UNKNOWN_WORLD", `World "${target.worldId}" is not registered.`);
      if (world.grid == null && previousWorld?.grid == null) throw new WorldContextError("GRID_COORDINATION_NOT_REQUIRED", "At least one transfer side must be grid-backed.");
      const entity = this.#requireActiveEntity(id);
      if (entity.status === "stored") lifecycle = this.#entities.prepareCoordinatedLifecycleChange(id, "activate", authority);
      next = this.#prepareWorldPlacement(id, target.worldId, target.position, { allowStored: entity.status === "stored" });
    } else if (target?.type === "store") {
      if (!previous || previous.type !== "world" || previousWorld?.grid == null) throw new WorldContextError("GRID_PLACEMENT_REQUIRED", "Storage transfer requires a grid-backed source.");
      const entity = this.#requireActiveEntity(id);
      if (entity.scope !== "scoped" || entity.status !== "active") throw new WorldContextError("ENTITY_NOT_STORABLE", "Only active scoped entities can be stored.", { entityId: id });
      next = freezePlacement({ entityId: id, type: "store", storeId: assertId(target.storeId, "Store ID") });
      lifecycle = this.#entities.prepareCoordinatedLifecycleChange(id, "store", authority);
    } else throw new WorldContextError("INVALID_TARGET", "Invalid coordinated placement target.");
    let committed = false;
    return Object.freeze({
      previous, current: next,
      commit: () => {
        if (committed) throw new WorldContextError("TRANSACTION_ALREADY_COMMITTED", "Transaction already committed.");
        lifecycle?.commit();
        if (next === null) this.#placements.delete(id); else this.#placements.set(id, next);
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        if (previous === null) this.#placements.delete(id); else this.#placements.set(id, previous);
        lifecycle?.rollback(); committed = false; return true;
      }
    });
  }

  #prepareTarget(entityId, target) {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      throw new WorldContextError("INVALID_TARGET", "A transfer target must be a world or store placement.");
    }
    if (target.type === "world") return this.#prepareWorldPlacement(entityId, target.worldId, target.position);
    if (target.type === "store") {
      const storeId = assertId(target.storeId, "Store ID");
      const entity = this.#requireActiveEntity(entityId);
      if (entity.status !== "stored") {
        throw new WorldContextError("ENTITY_NOT_STORED", "Only an entity in stored lifecycle state can be placed in the persistent storage.", { entityId, status: entity.status });
      }
      return freezePlacement({ entityId, type: "store", storeId });
    }
    throw new WorldContextError("INVALID_TARGET", "A transfer target must have type world or store.");
  }

  #prepareWorldPlacement(entityId, worldId, position, { allowStored = false } = {}) {
    const entity = this.#requireActiveEntity(entityId);
    const world = this.#worlds.get(assertId(worldId, "World ID"));
    if (!world) throw new WorldContextError("UNKNOWN_WORLD", `World "${worldId}" is not registered.`, { worldId });
    if (world.status === "closed") throw new WorldContextError("WORLD_CLOSED", `World "${worldId}" is closed.`, { worldId });
    if (entity.status === "stored" && !allowStored) {
      throw new WorldContextError("ENTITY_STORED", "A stored entity must be activated before world placement.", { entityId });
    }
    const point = clonePosition(position);
    const bounds = world.grid ?? world.dimensions;
    if (point.x < 0 || point.y < 0 || point.x >= bounds.width || point.y >= bounds.height) {
      throw new WorldContextError("POSITION_OUT_OF_BOUNDS", "Entity position must be inside the target world's spatial bounds.", { entityId, worldId, position: point });
    }
    return freezePlacement({ entityId, type: "world", worldId, position: point });
  }

  #requireActiveEntity(entityId) {
    const entity = this.#entities.get(entityId);
    if (!entity) throw new WorldContextError("UNKNOWN_ENTITY", `Entity "${entityId}" is not registered.`, { entityId });
    if (entity.status === "removed") throw new WorldContextError("ENTITY_REMOVED", `Removed entity "${entityId}" cannot be placed.`, { entityId });
    return entity;
  }

  createPersistenceParticipant({ id = "core.world-context", order = -80 } = {}) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(id)) {
      throw new WorldContextError("INVALID_PARTICIPANT_ID", "Persistence participant ID must be a stable lowercase ID.", { id });
    }
    if (!Number.isSafeInteger(order)) throw new WorldContextError("INVALID_PARTICIPANT_ORDER", "Persistence participant order must be a safe integer.", { order });
    return Object.freeze({
      id, schemaVersion: SNAPSHOT_VERSION, required: true, order,
      captureSnapshot: () => this.captureSnapshot(),
      validateSnapshot: (snapshot) => { try { this.#parseSnapshot(snapshot, { validateReferences: false }); return true; } catch { return false; } },
      prepareRestore: (snapshot) => this.prepareRestore(snapshot, { deferReferenceValidation: true })
    });
  }

  captureSnapshot() {
    return Object.freeze({
      version: SNAPSHOT_VERSION,
      placements: Object.freeze(this.listPlacements().map((item) => item.type === "world"
        ? { entityId: item.entityId, type: "world", worldId: item.worldId, position: { x: item.position.x, y: item.position.y } }
        : { entityId: item.entityId, type: "store", storeId: item.storeId }))
    });
  }

  prepareRestore(snapshot, { deferReferenceValidation = false, authority = null } = {}) {
    const liveGridPlacement = [...this.#placements.values()].some((item) => item.type === "world" && this.#worlds.get(item.worldId)?.grid != null);
    const snapshotHasWorldPlacement = Array.isArray(snapshot?.placements) && snapshot.placements.some((item) => item?.type === "world");
    const snapshotGridPlacement = Array.isArray(snapshot?.placements) && snapshot.placements.some((item) => item?.type === "world" && this.#worlds.get(item.worldId)?.grid != null);
    if ((liveGridPlacement || snapshotGridPlacement || (this.#spatialCoordinationRequired && snapshotHasWorldPlacement)) && authority !== PLACEMENT_AUTHORITY) {
      throw new WorldContextError("GRID_COORDINATOR_REQUIRED", "Restoring grid-backed placements requires the composite Placement Coordinator participant.");
    }
    // Detach untrusted input once. The same immutable-by-ownership copy is
    // validated and later committed, preventing getters and prepare/commit
    // time mutation from changing the staged restore.
    const stableSnapshot = cloneSnapshotData(snapshot);
    this.#parseSnapshot(stableSnapshot, { validateReferences: !deferReferenceValidation });
    const previous = this.#placements;
    let committed = false;
    return Object.freeze({
      commit: () => {
        if (committed) throw new WorldContextError("RESTORE_ALREADY_COMMITTED", "World Context restore transaction was already committed.");
        // Cross-registry references are validated at commit time, after the
        // entity and world participants have committed their staged snapshots.
        const validatedPlacements = this.#parseSnapshot(stableSnapshot, { validateReferences: true });
        this.#placements = validatedPlacements;
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#placements = previous;
        committed = false;
        return true;
      }
    });
  }

  #parseSnapshot(snapshot, { validateReferences = true } = {}) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
        snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.placements)) {
      throw new WorldContextError("INVALID_SNAPSHOT", "World Context snapshot has an unsupported version or shape.");
    }
    const next = new Map();
    for (let index = 0; index < snapshot.placements.length; index += 1) {
      const raw = snapshot.placements[index];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new WorldContextError("INVALID_SNAPSHOT", `Placement at index ${index} must be an object.`);
      }
      const entityId = assertId(raw.entityId, "Entity ID");
      if (next.has(entityId)) throw new WorldContextError("DUPLICATE_PLACEMENT", `Entity "${entityId}" has more than one placement.`, { entityId });
      let placement;
      if (raw.type === "world") {
        const worldId = assertId(raw.worldId, "World ID");
        const position = clonePosition(raw.position);
        if (validateReferences) placement = this.#prepareWorldPlacement(entityId, worldId, position);
        else placement = freezePlacement({ entityId, type: "world", worldId, position });
      } else if (raw.type === "store") {
        const storeId = assertId(raw.storeId, "Store ID");
        if (validateReferences) {
          const entity = this.#requireActiveEntity(entityId);
          if (entity.status !== "stored") throw new WorldContextError("ENTITY_NOT_STORED", "Stored placement requires stored entity lifecycle state.", { entityId });
        }
        placement = freezePlacement({ entityId, type: "store", storeId });
      } else throw new WorldContextError("INVALID_SNAPSHOT", `Placement at index ${index} has an unknown type.`);
      next.set(entityId, placement);
    }
    return next;
  }
}
