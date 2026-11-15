import {
  restoreCassandraExpeditionProjection
} from "./cassandra-expedition-projection.js";

const SNAPSHOT_VERSION = 1;

export class CassandraExpeditionProjectionSystemError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CassandraExpeditionProjectionSystemError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new CassandraExpeditionProjectionSystemError(code, message, details);
}

function validateSnapshotShape(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.version !== SNAPSHOT_VERSION
    || !(snapshot.projection === null || (
      snapshot.projection && typeof snapshot.projection === "object"
      && snapshot.projection.version === 1
      && Array.isArray(snapshot.projection.mappings)
    ))) {
    fail("INVALID_EXPEDITION_PROJECTION_SNAPSHOT",
      "Expedition projection persistence snapshot has an unsupported version or shape.");
  }
  return snapshot;
}

/**
 * Persists the session-scoped campaign ↔ Temporary World projection map.
 *
 * Restore validation is intentionally performed during participant commit,
 * after Entity Registry, Unit System and World Session participants have
 * committed their restored identities and world descriptors.
 */
export function createCassandraExpeditionProjectionSystem() {
  let entities;
  let persistence;
  let worldSession;
  let projection = null;
  let unregisterPersistence = null;
  let unregisterTemporaryCleanup = null;

  function restoreProjection(snapshot) {
    if (snapshot === null) return null;
    const session = worldSession.getState();
    if (session.mainWorldId !== snapshot.mainWorldId
      || session.temporaryWorldId !== snapshot.temporaryWorldId) {
      fail("PROJECTION_WORLD_SESSION_MISMATCH",
        "Restored projection mapping does not match the restored Main/Temporary World session.");
    }
    return restoreCassandraExpeditionProjection(snapshot, {
      entityRegistry: entities,
      sessionId: snapshot.sessionId,
      mainWorldId: session.mainWorldId,
      temporaryWorldId: session.temporaryWorldId
    });
  }

  const api = Object.freeze({
    registerProjection(nextProjection) {
      if (projection !== null) {
        fail("EXPEDITION_PROJECTION_ALREADY_REGISTERED",
          "Resolve or restore the existing expedition projection before registering another one.");
      }
      if (!nextProjection || typeof nextProjection.toSnapshot !== "function") {
        fail("INVALID_EXPEDITION_PROJECTION", "A valid Cassandra expedition projection is required.");
      }
      const snapshot = nextProjection.toSnapshot();
      const session = worldSession.getState();
      if (session.mainWorldId !== snapshot.mainWorldId
        || session.temporaryWorldId !== snapshot.temporaryWorldId
        || session.activeWorldId !== snapshot.temporaryWorldId) {
        fail("PROJECTION_WORLD_SESSION_MISMATCH",
          "Projection must match the current Main/Temporary World session and the Temporary World must be active.");
      }
      projection = restoreProjection(snapshot);
      return projection.toSnapshot();
    },

    getProjection() {
      return projection;
    },

    getSnapshot() {
      return projection?.toSnapshot() ?? null;
    },

    hasProjection() {
      return projection !== null;
    }
  });

  const persistenceParticipant = Object.freeze({
    id: "game.expedition-projection",
    schemaVersion: SNAPSHOT_VERSION,
    required: true,
    order: 30,
    captureSnapshot() {
      return Object.freeze({
        version: SNAPSHOT_VERSION,
        projection: projection?.toSnapshot() ?? null
      });
    },
    validateSnapshot(snapshot) {
      try { validateSnapshotShape(snapshot); return true; }
      catch { return false; }
    },
    prepareRestore(snapshot) {
      validateSnapshotShape(snapshot);
      const previous = projection;
      let committed = false;
      return Object.freeze({
        commit() {
          projection = restoreProjection(snapshot.projection);
          committed = true;
        },
        rollback() {
          if (!committed) return false;
          projection = previous;
          committed = false;
          return true;
        }
      });
    }
  });

  return Object.freeze({
    id: "game.expedition-projection",
    provides: ["game.expedition-projection-api"],
    requires: ["core.entity-registry", "core.persistence", "game.world-session-api"],
    initialize(context) {
      entities = context.getService("core.entity-registry");
      persistence = context.getService("core.persistence");
      worldSession = context.getService("game.world-session-api");
      unregisterPersistence = persistence.registerParticipant(persistenceParticipant);
      unregisterTemporaryCleanup = worldSession.registerTemporaryWorldCleanup(({ phase, temporaryWorldId }) => {
        if (phase !== "prepare") {
          fail("INVALID_PROJECTION_CLEANUP_PHASE",
            "Expedition projection cleanup must be prepared before disposal.");
        }
        if (projection && projection.toSnapshot().temporaryWorldId !== temporaryWorldId) {
          fail("PROJECTION_DISPOSAL_WORLD_MISMATCH",
            "Projection cleanup preparation received a different Temporary World ID.");
        }
        // Do not mutate the projection during preflight. The returned commit
        // runs only after the World and all scoped runtime state are removed.
        return () => { projection = null; };
      });
      return { "game.expedition-projection-api": api };
    },
    destroy() {
      unregisterTemporaryCleanup?.();
      unregisterTemporaryCleanup = null;
      unregisterPersistence?.();
      unregisterPersistence = null;
      projection = null;
    }
  });
}
