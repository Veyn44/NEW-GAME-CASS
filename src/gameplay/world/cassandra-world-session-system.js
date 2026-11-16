const SNAPSHOT_VERSION = 1;
const WORLD_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;

export class CassandraWorldSessionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CassandraWorldSessionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertWorldId(value, label = "World ID") {
  if (typeof value !== "string" || !WORLD_ID.test(value)) {
    throw new CassandraWorldSessionError("INVALID_WORLD_ID", `${label} must be a stable ID.`, { value });
  }
  return value;
}

function parseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.version !== SNAPSHOT_VERSION
    || !Array.isArray(snapshot.worldTimes)) {
    throw new CassandraWorldSessionError("INVALID_SNAPSHOT", "World session snapshot has an unsupported version or shape.");
  }
  const mainWorldId = assertWorldId(snapshot.mainWorldId, "Main World ID");
  const temporaryWorldId = snapshot.temporaryWorldId === null
    ? null : assertWorldId(snapshot.temporaryWorldId, "Temporary World ID");
  const activeWorldId = assertWorldId(snapshot.activeWorldId, "Active World ID");
  if (temporaryWorldId && temporaryWorldId === mainWorldId) {
    throw new CassandraWorldSessionError("INVALID_SNAPSHOT", "Main and Temporary World IDs must be different.");
  }
  if (activeWorldId !== mainWorldId && activeWorldId !== temporaryWorldId) {
    throw new CassandraWorldSessionError("INVALID_SNAPSHOT", "Active World must be the Main or Temporary World.");
  }
  const worldTimes = new Map();
  for (const [index, entry] of snapshot.worldTimes.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CassandraWorldSessionError("INVALID_SNAPSHOT", `World time at index ${index} must be an object.`);
    }
    const worldId = assertWorldId(entry.worldId);
    if (!Number.isFinite(entry.seconds) || entry.seconds < 0 || worldTimes.has(worldId)) {
      throw new CassandraWorldSessionError("INVALID_SNAPSHOT", `World time for "${worldId}" is invalid or duplicated.`, { worldId });
    }
    worldTimes.set(worldId, entry.seconds);
  }
  if (!worldTimes.has(mainWorldId) || (temporaryWorldId && !worldTimes.has(temporaryWorldId))) {
    throw new CassandraWorldSessionError("INVALID_SNAPSHOT", "World session snapshot is missing a required local clock.");
  }
  return Object.freeze({
    mainWorldId,
    temporaryWorldId,
    activeWorldId,
    worldTimes
  });
}

/**
 * Cassandra-owned Main/Temporary World session policy.
 * Engine World Registry owns descriptors and active selection; this system
 * owns the single temporary-session rule and independent local simulated time.
 */
export function createCassandraWorldSessionSystem({ isPackageApplied = null } = {}) {
  let worlds;
  let persistence;
  let worldRuntime;
  let entities;
  let worldContext;
  let spatial;
  let placements;
  let unitApi;
  const temporaryWorldCleanupHandlers = new Set();
  let mainWorldId = null;
  let temporaryWorldId = null;
  let unregisterPersistence = null;
  let temporaryDisposalInProgress = false;

  function requireGridWorld(worldId, label) {
    const world = worlds.get(assertWorldId(worldId));
    if (!world || world.status === "closed" || world.grid == null) {
      throw new CassandraWorldSessionError("GRID_WORLD_REQUIRED", `${label} must be an available grid-backed World.`, { worldId });
    }
    return world;
  }

  function ensureWorldReady(worldId) {
    const state = worldRuntime.getState(worldId);
    if (state.status === "Unloaded" || state.status === "Disposed") {
      worldRuntime.beginLoading(worldId);
      worldRuntime.markReady(worldId);
    } else if (state.status !== "Ready") {
      throw new CassandraWorldSessionError("WORLD_RUNTIME_NOT_READY",
        `World "${worldId}" cannot be selected while its runtime is ${state.status}.`, { worldId, status: state.status });
    }
  }

  function setWorldParticipation(worldId, enabled) {
    ensureWorldReady(worldId);
    worldRuntime.setSimulationEnabled(worldId, enabled);
  }

  const api = Object.freeze({
    registerMainWorld(worldId) {
      const id = assertWorldId(worldId, "Main World ID");
      requireGridWorld(id, "Main World");
      if (mainWorldId !== null && mainWorldId !== id) {
        throw new CassandraWorldSessionError("MAIN_WORLD_ALREADY_REGISTERED", "Use setMainWorldWorld() to change the selected Main World.", { current: mainWorldId, requested: id });
      }
      if (mainWorldId && mainWorldId !== id && worlds.has(mainWorldId)) {
        worldRuntime.setSimulationEnabled(mainWorldId, false);
      }
      mainWorldId = id;
      setWorldParticipation(id, true);
      if (worlds.activeWorldId !== id) worlds.activateWorld(id);
      return api.getState();
    },

    setMainWorldWorld(worldId) {
      const id = assertWorldId(worldId, "Main World ID");
      requireGridWorld(id, "Main World");
      if (temporaryWorldId !== null) {
        throw new CassandraWorldSessionError("TEMPORARY_WORLD_PENDING", "Return from or resolve the Temporary World before changing the Main World.");
      }
      if (mainWorldId && mainWorldId !== id && worlds.has(mainWorldId)) {
        worldRuntime.setSimulationEnabled(mainWorldId, false);
      }
      mainWorldId = id;
      setWorldParticipation(id, true);
      worlds.activateWorld(id);
      return api.getState();
    },

    beginTemporaryWorld({ worldId, width = 128, height = 128 } = {}) {
      if (mainWorldId === null) {
        throw new CassandraWorldSessionError("MAIN_WORLD_NOT_REGISTERED", "Register the Main World before starting a Temporary World.");
      }
      if (temporaryWorldId !== null) {
        throw new CassandraWorldSessionError("TEMPORARY_WORLD_ALREADY_EXISTS", "Only one Temporary World may belong to a Cassandra session.", { temporaryWorldId });
      }
      requireGridWorld(mainWorldId, "Main World");
      if (worlds.activeWorldId !== mainWorldId) {
        throw new CassandraWorldSessionError("MAIN_WORLD_NOT_ACTIVE", "A Temporary World can only begin from the active Main World.");
      }
      const id = assertWorldId(worldId, "Temporary World ID");
      if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
        throw new CassandraWorldSessionError("INVALID_WORLD_SIZE", "Temporary World grid dimensions must be positive safe integers.", { width, height });
      }
      if (worlds.has(id)) {
        throw new CassandraWorldSessionError("DUPLICATE_WORLD_ID", `World "${id}" already exists.`, { worldId: id });
      }
      worlds.registerWorld({
        worldId: id,
        type: "cassandra-temporary",
        dimensions: { width, height },
        grid: { width, height },
        coordinateSystem: "tiles",
        metadata: { role: "temporary" }
      });
      temporaryWorldId = id;
      setWorldParticipation(mainWorldId, false);
      ensureWorldReady(id);
      worldRuntime.setSimulationEnabled(id, true);
      worlds.activateWorld(id);
      return api.getState();
    },

    enterTemporaryWorld() {
      if (temporaryDisposalInProgress) {
        throw new CassandraWorldSessionError("TEMPORARY_DISPOSAL_IN_PROGRESS",
          "Cannot re-enter a Temporary World while its disposal is in progress.");
      }
      if (temporaryWorldId === null) {
        throw new CassandraWorldSessionError("NO_TEMPORARY_WORLD", "There is no Temporary World to enter.");
      }
      requireGridWorld(temporaryWorldId, "Temporary World");
      setWorldParticipation(mainWorldId, false);
      setWorldParticipation(temporaryWorldId, true);
      worlds.activateWorld(temporaryWorldId);
      return api.getState();
    },

    returnToMainWorld() {
      if (mainWorldId === null) {
        throw new CassandraWorldSessionError("MAIN_WORLD_NOT_REGISTERED", "No Main World is registered.");
      }
      requireGridWorld(mainWorldId, "Main World");
      setWorldParticipation(mainWorldId, true);
      if (temporaryWorldId && worlds.has(temporaryWorldId)) {
        worldRuntime.setSimulationEnabled(temporaryWorldId, false);
      }
      if (worlds.activeWorldId === mainWorldId) return api.getState();
      worlds.activateWorld(mainWorldId);
      return api.getState();
    },

    /**
     * Register a two-phase Temporary World cleanup participant.
     * The handler is called with phase "prepare" and must validate without
     * mutating live state, then return a synchronous, infallible commit
     * callback. Commit callbacks run only after scoped World state is gone.
     */
    registerTemporaryWorldCleanup(handler) {
      if (typeof handler !== "function") {
        throw new CassandraWorldSessionError("INVALID_TEMPORARY_CLEANUP_HANDLER",
          "Temporary World cleanup handler must be a function.");
      }
      temporaryWorldCleanupHandlers.add(handler);
      return () => temporaryWorldCleanupHandlers.delete(handler);
    },

    async completeTemporaryWorld({ packageId, digest } = {}) {
      if (temporaryDisposalInProgress) {
        throw new CassandraWorldSessionError("TEMPORARY_DISPOSAL_IN_PROGRESS",
          "Temporary World disposal is already in progress.");
      }
      temporaryDisposalInProgress = true;
      try {
          if (temporaryWorldId === null) {
          throw new CassandraWorldSessionError("NO_TEMPORARY_WORLD", "There is no Temporary World to complete.");
        }
        if (mainWorldId === null || worlds.activeWorldId !== mainWorldId) {
          throw new CassandraWorldSessionError("MAIN_WORLD_MUST_BE_ACTIVE",
            "Return to the Main World before completing and disposing the Temporary World.");
        }
        if (typeof isPackageApplied !== "function") {
          throw new CassandraWorldSessionError("PACKAGE_APPLICATION_VERIFIER_REQUIRED",
            "Temporary World disposal requires an authoritative Applied ledger verifier.");
        }
        assertWorldId(packageId, "Applied Change Package ID");
        if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
          throw new CassandraWorldSessionError("INVALID_PACKAGE_DIGEST",
            "Temporary World disposal requires the exact applied Change Package digest.");
        }
        if (await isPackageApplied(packageId, digest) !== true) {
          throw new CassandraWorldSessionError("CHANGE_PACKAGE_NOT_APPLIED",
            "Temporary World cannot be disposed until its exact Change Package is durably applied.",
            { packageId });
        }

        const id = temporaryWorldId;
        if (!worlds.has(id)) {
          throw new CassandraWorldSessionError("TEMPORARY_WORLD_REGISTRY_MISSING",
            "Temporary World cannot be completed after its World Registry descriptor was removed.",
            { worldId: id });
        }
        // Cleanup handlers are two-phase: prepare must validate and return a
        // commit callback without mutating live state. This keeps a failed
        // preflight from partially disposing the Temporary World.
        const cleanupCommits = [];
        for (const handler of temporaryWorldCleanupHandlers) {
          const commit = handler(Object.freeze({
            phase: "prepare", packageId, digest, temporaryWorldId: id
          }));
          if (commit && typeof commit.then === "function") {
            throw new CassandraWorldSessionError("ASYNC_TEMPORARY_CLEANUP_PREPARATION",
              "Temporary World cleanup preparation must be synchronous.");
          }
          if (typeof commit !== "function") {
            throw new CassandraWorldSessionError("INVALID_TEMPORARY_CLEANUP_PLAN",
              "Temporary World cleanup handlers must return a commit function during prepare.");
          }
          cleanupCommits.push(commit);
        }

        {
          const scopeId = `world:${id}`;
          const world = worlds.get(id);
          const scopedEntities = entities.list({ scope: "scoped", scopeId });
          // Validate every scoped placement before removing even one Unit.
          for (const entity of scopedEntities) {
            if (entity.status !== "active" && entity.status !== "stored") continue;
            const placement = worldContext.getPlacement(entity.id);
            if (placement?.type === "world" && placement.worldId !== id) {
              throw new CassandraWorldSessionError("TEMPORARY_ENTITY_ESCAPED_WORLD",
                "A Temporary World-scoped entity was placed in another World and must be reconciled before disposal.",
                { entityId: entity.id, worldId: placement.worldId });
            }
          }
          const placementsInWorld = worldContext.listPlacements({ worldId: id });
          const occupanciesInWorld = spatial.listEntityOccupancies({ worldId: id });
          const occupancyByEntity = new Map(occupanciesInWorld.map((entry) => [entry.entityId, entry]));
          // Validate the complete WorldContext ↔ Spatial Composition bijection
          // before the first Unit or Entity is retired. A later per-entity
          // coordinator failure must not discover pre-existing corruption after
          // earlier entities have already been removed.
          for (const placement of placementsInWorld) {
            const entity = entities.get(placement.entityId);
            if (!entity || entity.scope !== "scoped" || entity.scopeId !== scopeId) {
              throw new CassandraWorldSessionError("PERSISTENT_ENTITY_IN_TEMPORARY_WORLD",
                "Temporary World disposal refuses to remove a placement not owned by this Temporary World scope.",
                { worldId: id, entityId: placement.entityId });
            }
            const occupancy = occupancyByEntity.get(placement.entityId);
            if (!occupancy || occupancy.worldId !== id
              || occupancy.anchor.x !== placement.position.x - 0.5
              || occupancy.anchor.y !== placement.position.y - 0.5) {
              throw new CassandraWorldSessionError("TEMPORARY_SPATIAL_INTEGRITY_MISMATCH",
                "Temporary World placement and occupancy must agree before disposal begins.",
                { worldId: id, entityId: placement.entityId });
            }
          }
          for (const occupancy of occupanciesInWorld) {
            const entity = entities.get(occupancy.entityId);
            const placement = worldContext.getPlacement(occupancy.entityId);
            if (!entity || entity.scope !== "scoped" || entity.scopeId !== scopeId) {
              throw new CassandraWorldSessionError("PERSISTENT_OCCUPANCY_IN_TEMPORARY_WORLD",
                "Temporary World disposal refuses to remove occupancy not owned by this Temporary World scope.",
                { worldId: id, entityId: occupancy.entityId });
            }
            if (!placement || placement.type !== "world" || placement.worldId !== id
              || occupancy.anchor.x !== placement.position.x - 0.5
              || occupancy.anchor.y !== placement.position.y - 0.5) {
              throw new CassandraWorldSessionError("TEMPORARY_SPATIAL_INTEGRITY_MISMATCH",
                "Temporary World occupancy and placement must agree before disposal begins.",
                { worldId: id, entityId: occupancy.entityId });
            }
          }
          if (placementsInWorld.length !== occupanciesInWorld.length) {
            throw new CassandraWorldSessionError("TEMPORARY_SPATIAL_INTEGRITY_MISMATCH",
              "Temporary World placements and occupancies must have equal cardinality before disposal begins.",
              { worldId: id, placements: placementsInWorld.length, occupancies: occupanciesInWorld.length });
          }

          for (const unit of unitApi.listUnits()) {
            if (unit.placement?.type === "world" && unit.placement.worldId === id) {
              unitApi.removeUnit(unit.id);
            }
          }

          for (const entity of scopedEntities) {
            if (entity.status !== "active" && entity.status !== "stored") continue;
            const placement = worldContext.getPlacement(entity.id);
            if (placement?.type === "world" && placement.worldId === id && world.grid != null) {
              placements.removeEntity(entity.id);
            } else {
              if (placement) worldContext.removePlacement(entity.id);
              entities.remove(entity.id);
            }
          }

          for (const content of spatial.listContents({ worldId: id })) {
            spatial.removeCellContent(content.contentId);
          }
          if (worldContext.listPlacements({ worldId: id }).length > 0
            || spatial.listEntityOccupancies({ worldId: id }).length > 0
            || spatial.listContents({ worldId: id }).length > 0) {
            throw new CassandraWorldSessionError("TEMPORARY_WORLD_NOT_EMPTY",
              "Temporary World still has placements, occupancy or content after scoped cleanup.",
              { worldId: id });
          }
          if (worlds.has(id)) {
            const runtimeState = worldRuntime.getState(id);
            if (runtimeState.status === "Ready" || runtimeState.status === "Loading" || runtimeState.status === "Unloaded") {
              worldRuntime.beginDisposal(id);
              worldRuntime.finishDisposal(id);
            } else if (runtimeState.status !== "Disposed") {
              throw new CassandraWorldSessionError("TEMPORARY_WORLD_RUNTIME_NOT_DISPOSABLE",
                "Temporary World runtime must be ready, loading or already disposed before registry removal.", { worldId: id, status: runtimeState.status });
            }
            if (worlds.get(id)?.status !== "closed") worlds.closeWorld(id);
            worlds.unregisterWorld(id);
          }
        }

        // Prepared commits are deliberately tiny, synchronous state swaps.
        for (const commit of cleanupCommits) commit();
        temporaryWorldId = null;
        return api.getState();
      } finally {
        temporaryDisposalInProgress = false;
      }
    },

    getWorldTime(worldId) {
      const id = assertWorldId(worldId);
      try { return worldRuntime.getState(id).simulatedSeconds; }
      catch (error) {
        if (error?.code === "UNKNOWN_WORLD" || error?.code === "WORLD_CLOSED") {
          throw new CassandraWorldSessionError("UNKNOWN_WORLD_CLOCK", `World "${id}" has no Cassandra local clock.`, { worldId: id });
        }
        throw error;
      }
    },

    resumeAfterRestore() {
      if (mainWorldId === null) return api.getState();
      const activeWorldId = worlds.activeWorldId;
      ensureWorldReady(mainWorldId);
      if (temporaryWorldId !== null) ensureWorldReady(temporaryWorldId);
      worldRuntime.setSimulationEnabled(mainWorldId, activeWorldId === mainWorldId);
      if (temporaryWorldId !== null) {
        worldRuntime.setSimulationEnabled(temporaryWorldId, activeWorldId === temporaryWorldId);
      }
      return api.getState();
    },

    getState() {
      return Object.freeze({
        mainWorldId,
        temporaryWorldId,
        activeWorldId: worlds.activeWorldId,
        inTemporaryWorld: temporaryWorldId !== null && worlds.activeWorldId === temporaryWorldId,
        worldTimes: Object.freeze(worldRuntime.list()
          .map((world) => Object.freeze({ worldId: world.worldId, seconds: world.simulatedSeconds })))
      });
    }
  });

  const persistenceParticipant = Object.freeze({
    id: "game.world-session",
    schemaVersion: SNAPSHOT_VERSION,
    required: true,
    order: 20,
    captureSnapshot() {
      if (mainWorldId === null) {
        throw new CassandraWorldSessionError("MAIN_WORLD_NOT_REGISTERED", "Cannot save a world session without a Main World.");
      }
      if (temporaryWorldId !== null) requireGridWorld(temporaryWorldId, "Temporary World");
      return Object.freeze({
        version: SNAPSHOT_VERSION,
        mainWorldId,
        temporaryWorldId,
        activeWorldId: worlds.activeWorldId,
        // Compatibility mirror for saves written before core.world-runtime existed.
        // The Engine runtime service is authoritative for all current simulation.
        worldTimes: Object.freeze(worldRuntime.list()
          .map((world) => Object.freeze({ worldId: world.worldId, seconds: world.simulatedSeconds })))
      });
    },
    validateSnapshot(snapshot) {
      try { parseSnapshot(snapshot); return true; }
      catch { return false; }
    },
    prepareRestore(snapshot) {
      const next = parseSnapshot(snapshot);
      const legacyTimeRestore = worldRuntime.prepareLegacyTimeRestore(
        [...next.worldTimes].map(([worldId, seconds]) => ({ worldId, seconds }))
      );
      const previous = { mainWorldId, temporaryWorldId };
      let committed = false;
      return Object.freeze({
        commit() {
          const main = requireGridWorld(next.mainWorldId, "Restored Main World");
          const temporary = next.temporaryWorldId
            ? requireGridWorld(next.temporaryWorldId, "Restored Temporary World") : null;
          if (worlds.activeWorldId !== next.activeWorldId
            || (temporary && temporary.worldId === main.worldId)) {
            throw new CassandraWorldSessionError("WORLD_SESSION_REGISTRY_MISMATCH", "Restored World Registry state does not match the Cassandra session snapshot.");
          }
          for (const worldId of next.worldTimes.keys()) {
            const world = worlds.get(worldId);
            if (!world || world.status === "closed") {
              throw new CassandraWorldSessionError("UNKNOWN_WORLD_CLOCK", `World time references unavailable World "${worldId}".`, { worldId });
            }
          }
          mainWorldId = next.mainWorldId;
          temporaryWorldId = next.temporaryWorldId;
          try {
            legacyTimeRestore.commit();
            committed = true;
          } catch (error) {
            mainWorldId = previous.mainWorldId;
            temporaryWorldId = previous.temporaryWorldId;
            throw error;
          }
        },
        rollback() {
          if (!committed) return false;
          legacyTimeRestore.rollback();
          mainWorldId = previous.mainWorldId;
          temporaryWorldId = previous.temporaryWorldId;
          committed = false;
          return true;
        }
      });
    }
  });

  return Object.freeze({
    id: "game.world-session",
    provides: ["game.world-session-api"],
    requires: [
      "core.world-registry",
      "core.world-runtime",
      "core.persistence",
      "core.entity-registry",
      "core.world-context",
      "core.spatial-composition",
      "core.placement-coordinator",
      "game.unit-api"
    ],
    initialize(context) {
      worlds = context.getService("core.world-registry");
      worldRuntime = context.getService("core.world-runtime");
      persistence = context.getService("core.persistence");
      entities = context.getService("core.entity-registry");
      worldContext = context.getService("core.world-context");
      spatial = context.getService("core.spatial-composition");
      placements = context.getService("core.placement-coordinator");
      unitApi = context.getService("game.unit-api");
      unregisterPersistence = persistence.registerParticipant(persistenceParticipant);
      return { "game.world-session-api": api };
    },
    destroy() {
      unregisterPersistence?.();
      unregisterPersistence = null;
      mainWorldId = null;
      temporaryWorldId = null;
      temporaryWorldCleanupHandlers.clear();
    }
  });
}
