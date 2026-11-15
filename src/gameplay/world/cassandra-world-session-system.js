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
  let scheduler;
  let entities;
  let worldContext;
  let spatial;
  let placements;
  let unitApi;
  const temporaryWorldCleanupHandlers = new Set();
  let pendingStep = null;
  let mainWorldId = null;
  let temporaryWorldId = null;
  let worldTimes = new Map();
  let unregisterPersistence = null;

  function commitPendingStepIfSuccessful() {
    if (!pendingStep || scheduler.snapshot.tick < pendingStep.tick) return false;
    worldTimes.set(pendingStep.worldId, (worldTimes.get(pendingStep.worldId) ?? 0) + pendingStep.deltaSeconds);
    pendingStep = null;
    return true;
  }

  function requireGridWorld(worldId, label) {
    const world = worlds.get(assertWorldId(worldId));
    if (!world || world.status === "closed" || world.grid == null) {
      throw new CassandraWorldSessionError("GRID_WORLD_REQUIRED", `${label} must be an available grid-backed World.`, { worldId });
    }
    return world;
  }

  const api = Object.freeze({
    registerMainWorld(worldId) {
      commitPendingStepIfSuccessful();
      const id = assertWorldId(worldId, "Main World ID");
      requireGridWorld(id, "Main World");
      if (mainWorldId !== null && mainWorldId !== id) {
        throw new CassandraWorldSessionError("MAIN_WORLD_ALREADY_REGISTERED", "Use setMainWorldWorld() to change the selected Main World.", { current: mainWorldId, requested: id });
      }
      mainWorldId = id;
      if (!worldTimes.has(id)) worldTimes.set(id, 0);
      if (worlds.activeWorldId !== id) worlds.activateWorld(id);
      return api.getState();
    },

    setMainWorldWorld(worldId) {
      commitPendingStepIfSuccessful();
      const id = assertWorldId(worldId, "Main World ID");
      requireGridWorld(id, "Main World");
      if (temporaryWorldId !== null) {
        throw new CassandraWorldSessionError("TEMPORARY_WORLD_PENDING", "Return from or resolve the Temporary World before changing the Main World.");
      }
      mainWorldId = id;
      if (!worldTimes.has(id)) worldTimes.set(id, 0);
      worlds.activateWorld(id);
      return api.getState();
    },

    beginTemporaryWorld({ worldId, width = 128, height = 128 } = {}) {
      commitPendingStepIfSuccessful();
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
      worldTimes.set(id, 0);
      worlds.activateWorld(id);
      return api.getState();
    },

    enterTemporaryWorld() {
      commitPendingStepIfSuccessful();
      if (temporaryWorldId === null) {
        throw new CassandraWorldSessionError("NO_TEMPORARY_WORLD", "There is no Temporary World to enter.");
      }
      requireGridWorld(temporaryWorldId, "Temporary World");
      worlds.activateWorld(temporaryWorldId);
      return api.getState();
    },

    returnToMainWorld() {
      commitPendingStepIfSuccessful();
      if (mainWorldId === null) {
        throw new CassandraWorldSessionError("MAIN_WORLD_NOT_REGISTERED", "No Main World is registered.");
      }
      requireGridWorld(mainWorldId, "Main World");
      if (worlds.activeWorldId === mainWorldId) return api.getState();
      worlds.activateWorld(mainWorldId);
      return api.getState();
    },

    registerTemporaryWorldCleanup(handler) {
      if (typeof handler !== "function") {
        throw new CassandraWorldSessionError("INVALID_TEMPORARY_CLEANUP_HANDLER",
          "Temporary World cleanup handler must be a function.");
      }
      temporaryWorldCleanupHandlers.add(handler);
      return () => temporaryWorldCleanupHandlers.delete(handler);
    },

    async completeTemporaryWorld({ packageId, digest } = {}) {
      commitPendingStepIfSuccessful();
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
      // Cleanup handlers are two-phase: prepare must validate and return a
      // commit callback without mutating live state. This keeps a failed
      // preflight from partially disposing the Temporary World.
      const cleanupCommits = [];
      for (const handler of temporaryWorldCleanupHandlers) {
        const commit = await handler(Object.freeze({
          phase: "prepare", packageId, digest, temporaryWorldId: id
        }));
        if (typeof commit !== "function") {
          throw new CassandraWorldSessionError("INVALID_TEMPORARY_CLEANUP_PLAN",
            "Temporary World cleanup handlers must return a commit function during prepare.");
        }
        cleanupCommits.push(commit);
      }

      if (worlds.has(id)) {
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
        for (const placement of placementsInWorld) {
          const entity = entities.get(placement.entityId);
          if (!entity || entity.scope !== "scoped" || entity.scopeId !== scopeId) {
            throw new CassandraWorldSessionError("PERSISTENT_ENTITY_IN_TEMPORARY_WORLD",
              "Temporary World disposal refuses to remove a placement not owned by this Temporary World scope.",
              { worldId: id, entityId: placement.entityId });
          }
        }
        for (const occupancy of spatial.listEntityOccupancies({ worldId: id })) {
          const entity = entities.get(occupancy.entityId);
          if (!entity || entity.scope !== "scoped" || entity.scopeId !== scopeId) {
            throw new CassandraWorldSessionError("PERSISTENT_OCCUPANCY_IN_TEMPORARY_WORLD",
              "Temporary World disposal refuses to remove occupancy not owned by this Temporary World scope.",
              { worldId: id, entityId: occupancy.entityId });
          }
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
        if (worlds.get(id)?.status !== "closed") worlds.closeWorld(id);
        worlds.unregisterWorld(id);
      }

      // Prepared commits are deliberately tiny, synchronous state swaps.
      for (const commit of cleanupCommits) commit();
      temporaryWorldId = null;
      worldTimes.delete(id);
      pendingStep = null;
      return api.getState();
    },

    advance(deltaSeconds, tick = null) {
      commitPendingStepIfSuccessful();
      if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
        throw new CassandraWorldSessionError("INVALID_TIME_DELTA", "World time delta must be a finite non-negative number.", { deltaSeconds });
      }
      const activeWorldId = worlds.activeWorldId;
      if (!activeWorldId || (activeWorldId !== mainWorldId && activeWorldId !== temporaryWorldId)) return false;
      if (tick !== null) {
        if (!Number.isSafeInteger(tick) || tick <= 0 || tick <= scheduler.snapshot.tick) {
          throw new CassandraWorldSessionError("INVALID_SIMULATION_TICK", "Scheduled world time requires a future positive simulation tick.", { tick });
        }
        if (pendingStep?.tick === tick) {
          throw new CassandraWorldSessionError("DUPLICATE_SIMULATION_TICK", "World local time was scheduled twice for the same simulation tick.", { tick });
        }
        pendingStep = Object.freeze({ tick, worldId: activeWorldId, deltaSeconds });
      } else {
        worldTimes.set(activeWorldId, (worldTimes.get(activeWorldId) ?? 0) + deltaSeconds);
      }
      return true;
    },

    getWorldTime(worldId) {
      commitPendingStepIfSuccessful();
      const id = assertWorldId(worldId);
      if (!worldTimes.has(id)) {
        throw new CassandraWorldSessionError("UNKNOWN_WORLD_CLOCK", `World "${id}" has no Cassandra local clock.`, { worldId: id });
      }
      return worldTimes.get(id);
    },

    getState() {
      commitPendingStepIfSuccessful();
      return Object.freeze({
        mainWorldId,
        temporaryWorldId,
        activeWorldId: worlds.activeWorldId,
        inTemporaryWorld: temporaryWorldId !== null && worlds.activeWorldId === temporaryWorldId,
        worldTimes: Object.freeze([...worldTimes.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([worldId, seconds]) => Object.freeze({ worldId, seconds })))
      });
    }
  });

  const persistenceParticipant = Object.freeze({
    id: "game.world-session",
    schemaVersion: SNAPSHOT_VERSION,
    required: true,
    order: 20,
    captureSnapshot() {
      commitPendingStepIfSuccessful();
      if (mainWorldId === null) {
        throw new CassandraWorldSessionError("MAIN_WORLD_NOT_REGISTERED", "Cannot save a world session without a Main World.");
      }
      if (temporaryWorldId !== null) requireGridWorld(temporaryWorldId, "Temporary World");
      return Object.freeze({
        version: SNAPSHOT_VERSION,
        mainWorldId,
        temporaryWorldId,
        activeWorldId: worlds.activeWorldId,
        worldTimes: Object.freeze([...worldTimes.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([worldId, seconds]) => Object.freeze({ worldId, seconds })))
      });
    },
    validateSnapshot(snapshot) {
      try { parseSnapshot(snapshot); return true; }
      catch { return false; }
    },
    prepareRestore(snapshot) {
      const next = parseSnapshot(snapshot);
      const previous = {
        mainWorldId,
        temporaryWorldId,
        worldTimes,
        pendingStep
      };
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
          worldTimes = new Map(next.worldTimes);
          pendingStep = null;
          committed = true;
        },
        rollback() {
          if (!committed) return false;
          mainWorldId = previous.mainWorldId;
          temporaryWorldId = previous.temporaryWorldId;
          worldTimes = previous.worldTimes;
          pendingStep = previous.pendingStep;
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
      "core.persistence",
      "core.scheduler",
      "core.entity-registry",
      "core.world-context",
      "core.spatial-composition",
      "core.placement-coordinator",
      "game.unit-api"
    ],
    initialize(context) {
      worlds = context.getService("core.world-registry");
      persistence = context.getService("core.persistence");
      scheduler = context.getService("core.scheduler");
      entities = context.getService("core.entity-registry");
      worldContext = context.getService("core.world-context");
      spatial = context.getService("core.spatial-composition");
      placements = context.getService("core.placement-coordinator");
      unitApi = context.getService("game.unit-api");
      unregisterPersistence = persistence.registerParticipant(persistenceParticipant);
      return { "game.world-session-api": api };
    },
    destroy() {
      commitPendingStepIfSuccessful();
      unregisterPersistence?.();
      unregisterPersistence = null;
      mainWorldId = null;
      temporaryWorldId = null;
      worldTimes = new Map();
      pendingStep = null;
      temporaryWorldCleanupHandlers.clear();
    }
  });
}
