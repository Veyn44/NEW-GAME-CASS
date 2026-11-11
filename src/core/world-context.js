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
 * It does not own entity identity, domain state, map contents, galaxy data,
 * encounter generation, ownership relationships or world transition side effects.
 */
export class WorldContext {
  #entities;
  #worlds;
  #placements = new Map();

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
    const placement = this.#prepareWorldPlacement(entityId, worldId, position);
    this.#placements.set(entityId, placement);
    return placement;
  }

  storeEntity(entityId, storeId) {
    assertId(entityId, "Entity ID");
    const current = this.#placements.get(entityId);
    if (!current || current.type !== "world") {
      throw new WorldContextError("ENTITY_NOT_IN_WORLD", "Only an entity currently placed in a map world can be transferred to the Entity Store.", { entityId });
    }
    const stableStoreId = assertId(storeId, "Store ID");
    const entity = this.#requireActiveEntity(entityId);
    if (entity.scope !== "encounter" || entity.status !== "active") {
      throw new WorldContextError("ENTITY_NOT_STORABLE", "Only an active encounter entity can be transferred to the Entity Store.", { entityId, scope: entity.scope, status: entity.status });
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
      throw new WorldContextError("ENTITY_NOT_STORED", "Only an entity in stored lifecycle state can be placed in the Entity Store.", { entityId, status: entity.status });
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
    // One synchronous map replacement is the commit point. Validation above is side-effect free.
    this.#placements.set(entityId, next);
    return Object.freeze({ previous: current, current: next });
  }

  removePlacement(entityId) {
    assertId(entityId, "Entity ID");
    return this.#placements.delete(entityId);
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
        throw new WorldContextError("ENTITY_NOT_STORED", "Only an entity in stored lifecycle state can be placed in the Entity Store.", { entityId, status: entity.status });
      }
      return freezePlacement({ entityId, type: "store", storeId });
    }
    throw new WorldContextError("INVALID_TARGET", "A transfer target must have type world or store.");
  }

  #prepareWorldPlacement(entityId, worldId, position) {
    const entity = this.#requireActiveEntity(entityId);
    const world = this.#worlds.get(assertId(worldId, "World ID"));
    if (!world) throw new WorldContextError("UNKNOWN_WORLD", `World "${worldId}" is not registered.`, { worldId });
    if (world.status === "closed") throw new WorldContextError("WORLD_CLOSED", `World "${worldId}" is closed.`, { worldId });
    if (entity.status === "stored") {
      throw new WorldContextError("ENTITY_STORED", "A stored entity must be activated before world placement.", { entityId });
    }
    if (entity.scope === "encounter" && (world.type !== "encounter" || entity.encounterId !== world.encounterId)) {
      throw new WorldContextError("ENCOUNTER_SCOPE_MISMATCH", "An encounter-scoped entity may only be placed in its own encounter world.", { entityId, encounterId: entity.encounterId, worldId });
    }
    const point = clonePosition(position);
    if (point.x < 0 || point.y < 0 || point.x >= world.dimensions.width || point.y >= world.dimensions.height) {
      throw new WorldContextError("POSITION_OUT_OF_BOUNDS", "Entity position must be inside the target world's dimensions.", { entityId, worldId, position: point });
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
      validateSnapshot: (snapshot) => { try { this.#parseSnapshot(snapshot); return true; } catch { return false; } },
      prepareRestore: (snapshot) => this.prepareRestore(snapshot)
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

  prepareRestore(snapshot) {
    const next = this.#parseSnapshot(snapshot);
    const previous = this.#placements;
    let committed = false;
    return Object.freeze({
      commit: () => {
        if (committed) throw new WorldContextError("RESTORE_ALREADY_COMMITTED", "World Context restore transaction was already committed.");
        this.#placements = next;
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

  #parseSnapshot(snapshot) {
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
      if (raw.type === "world") placement = this.#prepareWorldPlacement(entityId, raw.worldId, raw.position);
      else if (raw.type === "store") {
        const storeId = assertId(raw.storeId, "Store ID");
        const entity = this.#requireActiveEntity(entityId);
        if (entity.status !== "stored") throw new WorldContextError("ENTITY_NOT_STORED", "Stored placement requires stored entity lifecycle state.", { entityId });
        placement = freezePlacement({ entityId, type: "store", storeId });
      } else throw new WorldContextError("INVALID_SNAPSHOT", `Placement at index ${index} has an unknown type.`);
      next.set(entityId, placement);
    }
    return next;
  }
}
