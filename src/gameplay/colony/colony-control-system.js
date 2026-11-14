const SNAPSHOT_VERSION = 1;
const MOVE_SPEED_TILES_PER_SECOND = 4;

function freezeState(leaderId, drafted) {
  return Object.freeze({ leaderId, drafted: Boolean(drafted) });
}

export function createColonyControlSystem() {
  let units;
  let input;
  let worlds;
  let state = freezeState(null, false);
  let unregisterPersistence = null;

  const api = Object.freeze({
    getState() { return state; },
    setLeader(entityId) {
      if (entityId !== null && !units.getUnit(entityId)) {
        throw new Error(`Cannot appoint missing Unit "${entityId}" as Colony Leader.`);
      }
      state = freezeState(entityId, false);
      return state;
    },
    setDrafted(drafted) {
      state = freezeState(state.leaderId, Boolean(drafted) && Boolean(state.leaderId));
      return state;
    },
    toggleDraft() {
      if (!state.leaderId) return state;
      state = freezeState(state.leaderId, !state.drafted);
      return state;
    },
    update(deltaSeconds) {
      if (!state.drafted || !state.leaderId || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return null;
      const leader = units.getUnit(state.leaderId);
      if (!leader?.placement || leader.placement.type !== "world") {
        state = freezeState(null, false);
        return null;
      }
      if (leader.placement.worldId !== worlds.activeWorldId) {
        state = freezeState(state.leaderId, false);
        return null;
      }
      const keys = new Set(input.getState().keys);
      let x = Number(keys.has("KeyD")) - Number(keys.has("KeyA"));
      let y = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
      if (x === 0 && y === 0) return null;
      const length = Math.hypot(x, y);
      x /= length;
      y /= length;
      const position = leader.placement.position;
      const moved = units.moveUnit(leader.id, {
        x: position.x + x * MOVE_SPEED_TILES_PER_SECOND * deltaSeconds,
        y: position.y + y * MOVE_SPEED_TILES_PER_SECOND * deltaSeconds
      });
      return Object.freeze({ entityId: leader.id, position: moved.placement.position });
    }
  });

  const persistenceParticipant = Object.freeze({
    id: "game.colony-control",
    schemaVersion: SNAPSHOT_VERSION,
    required: true,
    order: 10,
    captureSnapshot() {
      return Object.freeze({ version: SNAPSHOT_VERSION, leaderId: state.leaderId, drafted: state.drafted });
    },
    validateSnapshot(snapshot) {
      return Boolean(snapshot && typeof snapshot === "object"
        && snapshot.version === SNAPSHOT_VERSION
        && (snapshot.leaderId === null || typeof snapshot.leaderId === "string")
        && typeof snapshot.drafted === "boolean"
        && (!snapshot.drafted || Boolean(snapshot.leaderId)));
    },
    prepareRestore(snapshot) {
      if (!this.validateSnapshot(snapshot)) throw new Error("Invalid Colony Control snapshot.");
      const previous = state;
      let committed = false;
      return Object.freeze({
        commit() {
          if (snapshot.leaderId && !units.getUnit(snapshot.leaderId)) {
            throw new Error(`Restored Colony Leader "${snapshot.leaderId}" is missing.`);
          }
          state = freezeState(snapshot.leaderId, snapshot.drafted);
          committed = true;
        },
        rollback() {
          if (!committed) return false;
          state = previous;
          committed = false;
          return true;
        }
      });
    }
  });

  return Object.freeze({
    id: "game.colony-control",
    provides: ["game.colony-control-api"],
    requires: ["game.unit-api", "engine.input-api", "core.world-registry", "core.persistence"],
    initialize(context) {
      units = context.getService("game.unit-api");
      input = context.getService("engine.input-api");
      worlds = context.getService("core.world-registry");
      unregisterPersistence = context.getService("core.persistence").registerParticipant(persistenceParticipant);
      return { "game.colony-control-api": api };
    },
    destroy() {
      unregisterPersistence?.();
      unregisterPersistence = null;
      state = freezeState(null, false);
    }
  });
}

export const COLONY_LEADER_MOVE_SPEED = MOVE_SPEED_TILES_PER_SECOND;
