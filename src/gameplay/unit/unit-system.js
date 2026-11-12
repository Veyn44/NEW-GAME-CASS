const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const TILE_POSITION_KEYS = ["x", "y"];
const SNAPSHOT_VERSION = 1;

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

function normalizePosition(position) {
  if (!position || typeof position !== "object" || Array.isArray(position)) {
    throw new UnitSystemError("INVALID_POSITION", "Unit position must be a tile coordinate object.");
  }
  const keys = Reflect.ownKeys(position);
  if (keys.length !== 2 || TILE_POSITION_KEYS.some((key) => !Object.hasOwn(position, key))) {
    throw new UnitSystemError("INVALID_POSITION", "Unit position must contain only x and y coordinates.");
  }
  const { x, y } = position;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || y < 0) {
    throw new UnitSystemError("INVALID_POSITION", "Unit tile coordinates must be non-negative safe integers.", { position });
  }
  return Object.freeze({ x, y });
}

function freezeUnit(entityId, definitionId) {
  return Object.freeze({ id: entityId, definitionId });
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
    if (next.has(entityId)) {
      throw new UnitSystemError("DUPLICATE_UNIT_ID", `Unit snapshot repeats "${entityId}".`, { entityId });
    }
    next.set(entityId, freezeUnit(entityId, definitionId));
  }
  return next;
}

/**
 * Cassandra Unit domain layer. Core owns identity and physical placement;
 * this system owns only the Unit-to-definition relationship.
 */
export function createUnitSystem({ definitionLookup } = {}) {
  if (typeof definitionLookup !== "function") {
    throw new UnitSystemError("INVALID_DEFINITION_LOOKUP", "Unit system requires a definitionLookup(id) function.");
  }

  let units = new Map();
  let entities;
  let worlds;
  let worldContext;
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
      try {
        worldContext.placeEntity(identity.id, stableWorldId, tile);
      } catch (error) {
        entities.remove(identity.id);
        throw error;
      }
      const record = freezeUnit(identity.id, stableDefinitionId);
      units.set(identity.id, record);
      return Object.freeze({ ...record, placement: worldContext.getPlacement(identity.id) });
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
      // Both Core operations are synchronous and validated against this
      // Unit's known identity/placement before the domain record is retired.
      worldContext.removePlacement(id);
      entities.remove(id);
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
          .map((record) => Object.freeze({ entityId: record.id, definitionId: record.definitionId })))
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
            if (!placement || placement.type !== "world"
              || !Number.isSafeInteger(placement.position.x) || !Number.isSafeInteger(placement.position.y)) {
              throw new UnitSystemError("INVALID_UNIT_PLACEMENT", `Restored Unit "${record.id}" has no valid world tile placement.`, { entityId: record.id });
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
      "core.persistence"
    ],
    initialize(context) {
      entities = context.getService("core.entity-registry");
      worlds = context.getService("core.world-registry");
      worldContext = context.getService("core.world-context");
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
