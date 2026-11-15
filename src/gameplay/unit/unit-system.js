const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const TILE_POSITION_KEYS = ["x", "y"];
const SNAPSHOT_VERSION = 2;
const SINGLE_CELL_FOOTPRINT = Object.freeze([Object.freeze({ x: 0, y: 0 })]);

export class UnitSystemError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "UnitSystemError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new UnitSystemError("INVALID_ID", `${label} must be a stable ID.`, { value });
  }
  return value;
}

function normalizePosition(position, { allowFractional = false } = {}) {
  if (!position || typeof position !== "object" || Array.isArray(position)) {
    throw new UnitSystemError("INVALID_POSITION", "Unit position must be a coordinate object.");
  }
  const keys = Reflect.ownKeys(position);
  if (keys.length !== 2 || TILE_POSITION_KEYS.some((key) => !Object.hasOwn(position, key))) {
    throw new UnitSystemError("INVALID_POSITION", "Unit position must contain only x and y coordinates.");
  }
  const { x, y } = position;
  const valid = allowFractional
    ? Number.isFinite(x) && Number.isFinite(y)
    : Number.isSafeInteger(x) && Number.isSafeInteger(y);
  if (!valid || (!allowFractional && (x < 0 || y < 0))) {
    throw new UnitSystemError("INVALID_POSITION", allowFractional
      ? "Unit coordinates must be finite numbers."
      : "Unit tile coordinates must be non-negative safe integers.", { position });
  }
  return Object.freeze({ x, y });
}

function freezeUnit(entityId, definitionId, position) {
  return Object.freeze({ id: entityId, definitionId, position });
}

function parseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.units)) {
    throw new UnitSystemError("INVALID_SNAPSHOT", "Unit snapshot has an unsupported version or shape.");
  }
  const next = new Map();
  for (const [index, raw] of snapshot.units.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new UnitSystemError("INVALID_SNAPSHOT", `Unit record at index ${index} must be an object.`);
    }
    const entityId = assertId(raw.entityId, "Unit entity ID");
    const definitionId = assertId(raw.definitionId, "Unit definition ID");
    const position = normalizePosition(raw.position, { allowFractional: true });
    if (position.x < 0 || position.y < 0) {
      throw new UnitSystemError("INVALID_SNAPSHOT", `Unit "${entityId}" has a negative position.`);
    }
    if (next.has(entityId)) {
      throw new UnitSystemError("DUPLICATE_UNIT_ID", `Unit snapshot repeats "${entityId}".`, { entityId });
    }
    next.set(entityId, freezeUnit(entityId, definitionId, position));
  }
  return next;
}

/**
 * Cassandra Unit domain layer. Core owns identity and discrete physical
 * placement; Cassandra owns continuous movement progress and interpolation.
 */
export function createUnitSystem({ definitionLookup, movementPolicy = () => true } = {}) {
  if (typeof definitionLookup !== "function") {
    throw new UnitSystemError("INVALID_DEFINITION_LOOKUP", "Unit system requires a definitionLookup(id) function.");
  }
  if (typeof movementPolicy !== "function") {
    throw new UnitSystemError("INVALID_MOVEMENT_POLICY", "Unit system movementPolicy must be a synchronous function.");
  }

  let units = new Map();
  let entities;
  let worlds;
  let worldContext;
  let placementCoordinator;
  let spatialComposition;
  let spatialMovement;
  let persistence;
  let unregisterPersistence = null;

  const api = Object.freeze({
    createUnit({ definitionId, worldId, position } = {}) {
      const stableDefinitionId = assertId(definitionId, "Unit definition ID");
      const stableWorldId = assertId(worldId, "World ID");
      const tile = normalizePosition(position);
      const definition = definitionLookup(stableDefinitionId);
      if (!definition || definition.id !== stableDefinitionId) {
        throw new UnitSystemError("UNKNOWN_DEFINITION", `Unit definition "${stableDefinitionId}" is not registered.`, { definitionId: stableDefinitionId });
      }
      const world = worlds.get(stableWorldId);
      if (!world || world.status === "closed") {
        throw new UnitSystemError("UNKNOWN_OR_CLOSED_WORLD", `World "${stableWorldId}" is not available.`, { worldId: stableWorldId });
      }
      if (tile.x >= world.dimensions.width || tile.y >= world.dimensions.height) {
        throw new UnitSystemError("POSITION_OUT_OF_BOUNDS", "Unit tile position is outside the target world.", { worldId: stableWorldId, position: tile });
      }

      const identity = entities.registerPersistent({ kind: "unit" });
      const initialPosition = world.grid
        ? Object.freeze({ x: tile.x + 0.5, y: tile.y + 0.5 })
        : tile;
      try {
        if (world.grid) {
          placementCoordinator.placeEntity(identity.id, {
            worldId: stableWorldId,
            anchor: tile,
            footprint: SINGLE_CELL_FOOTPRINT,
            orientation: 0
          });
        } else {
          worldContext.placeEntity(identity.id, stableWorldId, tile);
        }
      } catch (error) {
        entities.remove(identity.id);
        throw error;
      }
      const record = freezeUnit(identity.id, stableDefinitionId, initialPosition);
      units.set(identity.id, record);
      return Object.freeze({ ...record, placement: worldContext.getPlacement(identity.id) });
    },

    moveUnit(entityId, position) {
      const id = assertId(entityId, "Unit ID");
      const currentRecord = units.get(id);
      if (!currentRecord) throw new UnitSystemError("UNKNOWN_UNIT", `Unit "${id}" does not exist.`, { entityId: id });
      const target = normalizePosition(position, { allowFractional: true });
      const currentPlacement = worldContext.getPlacement(id);
      if (!currentPlacement || currentPlacement.type !== "world") {
        throw new UnitSystemError("UNIT_NOT_IN_WORLD", `Unit "${id}" has no world placement.`, { entityId: id });
      }
      const world = worlds.get(currentPlacement.worldId);
      if (!world || world.status === "closed") {
        throw new UnitSystemError("UNKNOWN_OR_CLOSED_WORLD", `World "${currentPlacement.worldId}" is not available.`, { worldId: currentPlacement.worldId });
      }
      const bounded = Object.freeze({
        x: Math.max(0, Math.min(target.x, world.dimensions.width - Number.EPSILON * world.dimensions.width)),
        y: Math.max(0, Math.min(target.y, world.dimensions.height - Number.EPSILON * world.dimensions.height))
      });

      if (world.grid) {
        const occupancy = spatialComposition.getEntityOccupancy(id);
        if (!occupancy || occupancy.worldId !== currentPlacement.worldId) {
          throw new UnitSystemError("UNIT_SPATIAL_INTEGRITY", `Unit "${id}" has no matching grid occupancy.`, { entityId: id });
        }
        const anchor = Object.freeze({ x: Math.floor(bounded.x), y: Math.floor(bounded.y) });
        if (anchor.x !== occupancy.anchor.x || anchor.y !== occupancy.anchor.y) {
          const result = spatialMovement.moveEntity(id, {
            worldId: currentPlacement.worldId,
            anchor
          }, movementPolicy);
          if (result.status !== "moved" && result.status !== "unchanged") {
            throw new UnitSystemError(result.code ?? "UNIT_MOVE_REJECTED",
              result.reason ?? `Unit "${id}" could not enter the target grid cell.`,
              { entityId: id, position: bounded, movementStatus: result.status });
          }
        }
      } else {
        try {
          worldContext.moveEntity(id, { type: "world", worldId: currentPlacement.worldId, position: bounded });
        } catch (error) {
          throw new UnitSystemError(error.code ?? "UNIT_MOVE_FAILED", error.message, { entityId: id, position: target });
        }
      }

      const updated = freezeUnit(id, currentRecord.definitionId, bounded);
      units.set(id, updated);
      return Object.freeze({ ...updated, placement: worldContext.getPlacement(id) });
    },

    getUnit(entityId) {
      const id = assertId(entityId, "Unit ID");
      const record = units.get(id);
      return record ? Object.freeze({ ...record, placement: worldContext.getPlacement(id) }) : null;
    },

    listUnits() {
      return Object.freeze([...units.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((record) => Object.freeze({ ...record, placement: worldContext.getPlacement(record.id) })));
    },

    removeUnit(entityId) {
      const id = assertId(entityId, "Unit ID");
      if (!units.has(id)) return false;
      const placement = worldContext.getPlacement(id);
      const world = placement?.type === "world" ? worlds.get(placement.worldId) : null;
      if (world?.grid) {
        placementCoordinator.removeEntity(id);
      } else {
        worldContext.removePlacement(id);
        entities.remove(id);
      }
      units.delete(id);
      return true;
    }
  });

  const persistenceParticipant = Object.freeze({
    id: "game.unit",
    schemaVersion: SNAPSHOT_VERSION,
    required: true,
    order: 0,
    captureSnapshot() {
      return Object.freeze({
        version: SNAPSHOT_VERSION,
        units: Object.freeze([...units.values()]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((record) => Object.freeze({
            entityId: record.id,
            definitionId: record.definitionId,
            position: record.position
          })))
      });
    },
    validateSnapshot(snapshot) {
      try { parseSnapshot(snapshot); return true; }
      catch { return false; }
    },
    prepareRestore(snapshot) {
      const next = parseSnapshot(snapshot);
      const previous = units;
      let committed = false;
      return Object.freeze({
        commit() {
          for (const record of next.values()) {
            const identity = entities.get(record.id);
            const placement = worldContext.getPlacement(record.id);
            if (!identity || identity.kind !== "unit" || identity.status !== "active") {
              throw new UnitSystemError("MISSING_UNIT_IDENTITY", `Restored Unit "${record.id}" has no matching active Core identity.`, { entityId: record.id });
            }
            if (!placement || placement.type !== "world") {
              throw new UnitSystemError("INVALID_UNIT_PLACEMENT", `Restored Unit "${record.id}" has no valid world placement.`, { entityId: record.id });
            }
            const world = worlds.get(placement.worldId);
            if (!world || world.status === "closed"
              || record.position.x >= world.dimensions.width || record.position.y >= world.dimensions.height) {
              throw new UnitSystemError("INVALID_UNIT_PLACEMENT", `Restored Unit "${record.id}" lies outside an available world.`, { entityId: record.id });
            }
            if (world.grid) {
              const occupancy = spatialComposition.getEntityOccupancy(record.id);
              if (!occupancy || occupancy.worldId !== placement.worldId
                || Math.floor(record.position.x) !== occupancy.anchor.x
                || Math.floor(record.position.y) !== occupancy.anchor.y
                || placement.position.x !== occupancy.anchor.x + 0.5
                || placement.position.y !== occupancy.anchor.y + 0.5) {
                throw new UnitSystemError("UNIT_SPATIAL_INTEGRITY", `Restored Unit "${record.id}" progress and grid occupancy disagree.`, { entityId: record.id });
              }
            } else if (placement.position.x !== record.position.x || placement.position.y !== record.position.y) {
              throw new UnitSystemError("INVALID_UNIT_PLACEMENT", `Restored Unit "${record.id}" position and world placement disagree.`, { entityId: record.id });
            }
            const definition = definitionLookup(record.definitionId);
            if (!definition || definition.id !== record.definitionId) {
              throw new UnitSystemError("UNKNOWN_DEFINITION", `Restored Unit definition "${record.definitionId}" is not registered.`, { definitionId: record.definitionId });
            }
          }
          units = next;
          committed = true;
        },
        rollback() {
          if (!committed) return false;
          units = previous;
          committed = false;
          return true;
        }
      });
    }
  });

  return Object.freeze({
    id: "game.unit",
    provides: ["game.unit-api"],
    requires: [
      "core.entity-registry",
      "core.world-registry",
      "core.world-context",
      "core.placement-coordinator",
      "core.spatial-composition",
      "core.spatial-movement",
      "core.persistence"
    ],
    initialize(context) {
      entities = context.getService("core.entity-registry");
      worlds = context.getService("core.world-registry");
      worldContext = context.getService("core.world-context");
      placementCoordinator = context.getService("core.placement-coordinator");
      spatialComposition = context.getService("core.spatial-composition");
      spatialMovement = context.getService("core.spatial-movement");
      persistence = context.getService("core.persistence");
      unregisterPersistence = persistence.registerParticipant(persistenceParticipant);
      return { "game.unit-api": api };
    },
    destroy() {
      unregisterPersistence?.();
      unregisterPersistence = null;
      units = new Map();
    }
  });
}
