import { resolvePawnProfile } from "./pawn-profile-resolver.js";

const SNAPSHOT_VERSION = 1;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;

export class PawnRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PawnRuntimeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new PawnRuntimeError("INVALID_ID", `${label} must be a stable ID.`, { value });
  }
  return value;
}

function normalizeState(raw, profile, entityId) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PawnRuntimeError("INVALID_PAWN_STATE", `Pawn "${entityId}" runtime state must be an object.`);
  }
  const { health, stamina, experience, level } = raw;
  if (![health, stamina, experience, level].every(Number.isFinite)
    || health < 0 || health > profile.endurance.maxHealth
    || stamina < 0 || stamina > profile.endurance.maxStamina
    || experience < 0 || !Number.isSafeInteger(level) || level < 1) {
    throw new PawnRuntimeError("INVALID_PAWN_STATE", `Pawn "${entityId}" has invalid runtime values.`, { entityId });
  }
  return Object.freeze({ health, stamina, experience, level });
}

function parseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.pawns)) {
    throw new PawnRuntimeError("INVALID_SNAPSHOT", "Pawn runtime snapshot has an unsupported version or shape.");
  }
  const records = new Map();
  for (const [index, raw] of snapshot.pawns.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PawnRuntimeError("INVALID_SNAPSHOT", `Pawn record at index ${index} must be an object.`);
    }
    const entityId = assertId(raw.entityId, "Pawn entity ID");
    const definitionId = assertId(raw.definitionId, "Pawn definition ID");
    const profileId = assertId(raw.profileId, "Pawn profile ID");
    if (records.has(entityId)) {
      throw new PawnRuntimeError("DUPLICATE_PAWN_ID", `Pawn snapshot repeats "${entityId}".`, { entityId });
    }
    records.set(entityId, Object.freeze({
      entityId,
      definitionId,
      profileId,
      state: Object.freeze({ health: raw.health, stamina: raw.stamina, experience: raw.experience, level: raw.level })
    }));
  }
  return records;
}

/** Cassandra-owned mutable Pawn state, kept separate from immutable Unit identity and DB definitions. */
export function createPawnRuntimeSystem({ definitionLookup } = {}) {
  if (typeof definitionLookup !== "function") {
    throw new PawnRuntimeError("INVALID_DEFINITION_LOOKUP", "Pawn runtime requires definitionLookup(id).");
  }

  let units;
  let persistence;
  let events;
  let pawns = new Map();
  let unregisterPersistence = null;
  let unsubscribeUnitRemoved = null;

  function getProfileForDefinition(definitionId) {
    return resolvePawnProfile({ definitionId, definitionLookup });
  }

  const api = Object.freeze({
    initializePawn(entityId) {
      const id = assertId(entityId, "Pawn entity ID");
      const unit = units.getUnit(id);
      if (!unit) throw new PawnRuntimeError("UNKNOWN_UNIT", `Cannot initialize Pawn "${id}" because its Unit does not exist.`, { entityId: id });
      const definition = definitionLookup(unit.definitionId);
      if (!definition?.familyId) return null;
      const profile = getProfileForDefinition(unit.definitionId);
      const existing = pawns.get(id);
      if (existing) {
        if (existing.definitionId !== unit.definitionId) {
          throw new PawnRuntimeError("PAWN_DEFINITION_MISMATCH", `Pawn "${id}" is already initialized with another definition.`, { entityId: id });
        }
        return Object.freeze({ entityId: id, definitionId: existing.definitionId, profile, state: existing.state });
      }
      const startingLevel = profile.progression?.startingLevel ?? 1;
      const state = normalizeState({
        health: profile.endurance.maxHealth,
        stamina: profile.endurance.maxStamina,
        experience: 0,
        level: startingLevel
      }, profile, id);
      const record = Object.freeze({
        entityId: id,
        definitionId: unit.definitionId,
        profileId: profile.baseStatsId,
        state
      });
      pawns.set(id, record);
      return Object.freeze({ entityId: id, definitionId: unit.definitionId, profile, state });
    },

    getPawn(entityId) {
      const id = assertId(entityId, "Pawn entity ID");
      const record = pawns.get(id);
      if (!record) return null;
      const profile = getProfileForDefinition(record.definitionId);
      return Object.freeze({ entityId: id, definitionId: record.definitionId, profile, state: record.state });
    },

    listPawns() {
      return Object.freeze([...pawns.keys()].sort().map((id) => api.getPawn(id)));
    },

    consumeStamina(entityId, amount) {
      const id = assertId(entityId, "Pawn entity ID");
      if (!Number.isFinite(amount) || amount < 0) {
        throw new PawnRuntimeError("INVALID_STAMINA_COST", "Stamina cost must be a finite non-negative number.", { amount });
      }
      const record = pawns.get(id);
      if (!record) throw new PawnRuntimeError("UNKNOWN_PAWN", `Pawn "${id}" is not initialized.`, { entityId: id });
      if (record.state.stamina < amount) return false;
      const profile = getProfileForDefinition(record.definitionId);
      const state = normalizeState({ ...record.state, stamina: record.state.stamina - amount }, profile, id);
      pawns.set(id, Object.freeze({ ...record, state }));
      return true;
    },

    applyDamage(entityId, amount) {
      const id = assertId(entityId, "Pawn entity ID");
      if (!Number.isFinite(amount) || amount < 0) {
        throw new PawnRuntimeError("INVALID_DAMAGE", "Damage must be a finite non-negative number.", { amount });
      }
      const record = pawns.get(id);
      if (!record) throw new PawnRuntimeError("UNKNOWN_PAWN", `Pawn "${id}" is not initialized.`, { entityId: id });
      const profile = getProfileForDefinition(record.definitionId);
      const state = normalizeState({ ...record.state, health: Math.max(0, record.state.health - amount) }, profile, id);
      pawns.set(id, Object.freeze({ ...record, state }));
      return state;
    },

    restoreHealth(entityId, amount) {
      const id = assertId(entityId, "Pawn entity ID");
      if (!Number.isFinite(amount) || amount < 0) {
        throw new PawnRuntimeError("INVALID_HEALING", "Healing must be a finite non-negative number.", { amount });
      }
      const record = pawns.get(id);
      if (!record) throw new PawnRuntimeError("UNKNOWN_PAWN", `Pawn "${id}" is not initialized.`, { entityId: id });
      const profile = getProfileForDefinition(record.definitionId);
      const state = normalizeState({ ...record.state, health: Math.min(profile.endurance.maxHealth, record.state.health + amount) }, profile, id);
      pawns.set(id, Object.freeze({ ...record, state }));
      return state;
    },

    removePawn(entityId) {
      return pawns.delete(assertId(entityId, "Pawn entity ID"));
    }
  });

  const persistenceParticipant = Object.freeze({
    id: "cassandra.pawn-runtime",
    schemaVersion: SNAPSHOT_VERSION,
    required: true,
    order: 20,
    captureSnapshot() {
      return Object.freeze({
        version: SNAPSHOT_VERSION,
        pawns: Object.freeze([...pawns.values()].sort((a, b) => a.entityId.localeCompare(b.entityId)).map((record) =>
          Object.freeze({
            entityId: record.entityId,
            definitionId: record.definitionId,
            profileId: record.profileId,
            ...record.state
          })))
      });
    },
    validateSnapshot(snapshot) {
      try { parseSnapshot(snapshot); return true; }
      catch { return false; }
    },
    prepareRestore(snapshot) {
      const next = parseSnapshot(snapshot);
      const previous = pawns;
      let committed = false;
      return Object.freeze({
        commit() {
          const restored = new Map();
          for (const record of next.values()) {
            const unit = units.getUnit(record.entityId);
            if (!unit || unit.definitionId !== record.definitionId) {
              throw new PawnRuntimeError("PAWN_UNIT_MISMATCH", `Restored Pawn "${record.entityId}" has no matching Unit.`, { entityId: record.entityId });
            }
            const profile = getProfileForDefinition(record.definitionId);
            if (profile.baseStatsId !== record.profileId) {
              throw new PawnRuntimeError("PAWN_PROFILE_MISMATCH", `Restored Pawn "${record.entityId}" references a different base stats profile.`, { entityId: record.entityId });
            }
            restored.set(record.entityId, Object.freeze({
              entityId: record.entityId,
              definitionId: record.definitionId,
              profileId: record.profileId,
              state: normalizeState(record.state, profile, record.entityId)
            }));
          }
          pawns = restored;
          committed = true;
        },
        rollback() {
          if (!committed) return false;
          pawns = previous;
          committed = false;
          return true;
        }
      });
    }
  });

  return Object.freeze({
    id: "cassandra.pawn-runtime",
    provides: ["cassandra.pawn-runtime-api"],
    requires: ["game.unit-api", "core.persistence", "core.event-bus"],
    initialize(context) {
      units = context.getService("game.unit-api");
      persistence = context.getService("core.persistence");
      events = context.getService("core.event-bus");
      unregisterPersistence = persistence.registerParticipant(persistenceParticipant);
      unsubscribeUnitRemoved = events.subscribe("game.unit.removed", "cassandra.pawn-runtime", (event) => {
        pawns.delete(event.payload.entityId);
      });
      return { "cassandra.pawn-runtime-api": api };
    },
    destroy() {
      unregisterPersistence?.();
      unregisterPersistence = null;
      unsubscribeUnitRemoved?.();
      unsubscribeUnitRemoved = null;
      pawns = new Map();
      units = null;
      persistence = null;
      events = null;
    }
  });
}
