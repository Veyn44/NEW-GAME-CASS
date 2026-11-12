import { Logger } from "./logger.js";
import { EventBus } from "./event-bus.js";
import { GameClock } from "./game-clock.js";
import { SimulationScheduler } from "./simulation-scheduler.js";
import { EntityRegistry } from "./entity-registry.js";
import { WorldRegistry } from "./world-registry.js";
import { WorldContext } from "./world-context.js";
import { Persistence } from "./persistence.js";
import { SystemBootstrap } from "./system-bootstrap.js";

const SERVICE = Object.freeze({
  logger: "core.logger",
  events: "core.event-bus",
  clock: "core.game-clock",
  entities: "core.entity-registry",
  worlds: "core.world-registry",
  worldContext: "core.world-context",
  scheduler: "core.scheduler",
  persistence: "core.persistence"
});

function required(context, id) {
  return context.getService(id);
}

/**
 * Creates the canonical Core integration assembly.
 * The returned runtime is an executable composition, not a second owner of
 * the underlying registries. All domain state remains in its owning module.
 */
export function createCoreAssembly({
  saveAdapter,
  applicationVersion = "0.1.0",
  formatVersion = 1,
  dayLengthRealSeconds = 86400,
  strategicSecondsPerDay = 86400,
  initialSpeed = 1,
  minimumSpeed = 0.01,
  maximumSpeed = 100,
  fixedStepSeconds = 6,
  maxStepsPerFrame = 120,
  hostSystems = [],
  simulationTasks = [],
  eventSources = []
} = {}) {
  if (!saveAdapter || typeof saveAdapter.read !== "function" || typeof saveAdapter.writeAtomic !== "function") {
    throw new TypeError("Core Assembly requires an explicit saveAdapter implementing read() and writeAtomic().");
  }
  let insideSimulationStep = false;
  let persistenceQueue = Promise.resolve();
  let pendingPersistenceOperations = 0;
  let runtimeDestroying = false;
  let lifecycleQueue = Promise.resolve();
  let startPromise = null;
  let destroyPromise = null;
  let bootstrap = null;

  const enqueueLifecycle = (operation) => {
    const queued = lifecycleQueue.then(operation);
    lifecycleQueue = queued.then(() => undefined, () => undefined);
    return queued;
  };
  let eventBus = null;
  if (!Array.isArray(hostSystems) || !Array.isArray(simulationTasks) || !Array.isArray(eventSources)) throw new TypeError('hostSystems, simulationTasks and eventSources must be arrays.');
  const hostSystemIds = hostSystems.map((system) => system?.id);
  if (hostSystemIds.some((id) => typeof id !== 'string') || new Set(hostSystemIds).size !== hostSystemIds.length) throw new TypeError('Every host system must have a unique ID.');

  const systems = [
    {
      id: "core.logger",
      provides: [SERVICE.logger],
      initialize() {
        const logger = new Logger({ capacity: 500, minimumLevel: "DEBUG" });
        return { [SERVICE.logger]: logger };
      }
    },
    {
      id: "core.event-bus",
      provides: [SERVICE.events],
      requires: [SERVICE.logger],
      initialize(context) {
        eventBus = new EventBus({
          sources: ["core.event-bus", "core.scheduler", ...hostSystemIds, ...eventSources],
          logger: required(context, SERVICE.logger)
        });
        return { [SERVICE.events]: eventBus };
      }
    },
    {
      id: "core.game-clock",
      provides: [SERVICE.clock],
      initialize() {
        return { [SERVICE.clock]: new GameClock({ dayLengthRealSeconds, strategicSecondsPerDay, initialSpeed, minimumSpeed, maximumSpeed }) };
      },
      pause(context) {
        required(context, SERVICE.clock).pause("bootstrap-lifecycle");
      },
      resume(context) {
        required(context, SERVICE.clock).resume("bootstrap-lifecycle");
      }
    },
    {
      id: "core.entity-registry",
      provides: [SERVICE.entities],
      requires: [SERVICE.logger],
      initialize(context) {
        return { [SERVICE.entities]: new EntityRegistry({ logger: required(context, SERVICE.logger) }) };
      }
    },
    {
      id: "core.world-registry",
      provides: [SERVICE.worlds],
      initialize() {
        return { [SERVICE.worlds]: new WorldRegistry() };
      }
    },
    {
      id: "core.world-context",
      provides: [SERVICE.worldContext],
      requires: [SERVICE.entities, SERVICE.worlds],
      initialize(context) {
        return { [SERVICE.worldContext]: new WorldContext({
          entityRegistry: required(context, SERVICE.entities),
          worldRegistry: required(context, SERVICE.worlds)
        }) };
      }
    },
    {
      id: "core.scheduler",
      provides: [SERVICE.scheduler],
      requires: [SERVICE.clock, SERVICE.events, SERVICE.logger],
      initialize(context) {
        const clock = required(context, SERVICE.clock);
        const events = required(context, SERVICE.events);
        const logger = required(context, SERVICE.logger);
        const scheduler = new SimulationScheduler({
          clock,
          systemOrder: [...bootstrap.initializationOrder.filter((id) => hostSystemIds.includes(id)), "core.scheduler"],
          fixedStepSeconds,
          maxStepsPerFrame,
          tasks: [
            ...simulationTasks.map((task) => ({
              ...task,
              update(step) {
                if (events.isFaulted) {
                  const error = new Error("Event Bus is faulted; simulation cannot continue.");
                  error.code = "EVENT_BUS_FAULTED";
                  throw error;
                }
                insideSimulationStep = true;
                try {
                  const result = task.update({ ...step, context });
                  if (result && typeof result.then === "function") {
                    if (typeof result.catch === "function") result.catch(() => {});
                    const error = new Error("Host simulation task returned a Promise; updates must be synchronous.");
                    error.code = "ASYNC_UPDATE_NOT_SUPPORTED";
                    throw error;
                  }
                } finally {
                  insideSimulationStep = false;
                }
              }
            })),
            {
              systemId: "core.scheduler",
              update({ deltaSeconds, tick }) {
                insideSimulationStep = true;
                try {
                  events.publish({
                    type: "core.simulation-step",
                    source: "core.scheduler",
                    payload: { tick, deltaSeconds }
                  });
                } finally {
                  insideSimulationStep = false;
                }
              }
            }
          ],
          onDiagnostic: (diagnostic) => logger.warn("Scheduler diagnostic", diagnostic)
        });
        return { [SERVICE.scheduler]: scheduler };
      }
    },
    {
      id: "core.persistence",
      provides: [SERVICE.persistence],
      requires: [SERVICE.logger, SERVICE.entities, SERVICE.worlds, SERVICE.worldContext, SERVICE.scheduler, SERVICE.events],
      initialize(context) {
        const logger = required(context, SERVICE.logger);
        const entities = required(context, SERVICE.entities);
        const worlds = required(context, SERVICE.worlds);
        const worldContext = required(context, SERVICE.worldContext);
        const scheduler = required(context, SERVICE.scheduler);
        const events = required(context, SERVICE.events);
        const clock = required(context, SERVICE.clock);
        const persistence = new Persistence({
          adapter: saveAdapter,
          applicationVersion,
          formatVersion,
          logger,
          runAtSafeBoundary: async (operation) => {
            if (runtimeDestroying) {
              const error = new Error("Persistence operation rejected because Core Assembly is shutting down.");
              error.code = "RUNTIME_DESTROYING";
              throw error;
            }
            if (insideSimulationStep) {
              const error = new Error("Persistence operation attempted during a simulation step.");
              error.code = "UNSAFE_BOUNDARY";
              throw error;
            }
            if (events.isFaulted || events.isDelivering || events.pendingCount !== 0) {
              const error = new Error("Persistence operation attempted while Event Bus delivery is pending.");
              error.code = "UNSAFE_BOUNDARY";
              throw error;
            }
            if (scheduler.snapshot.faulted) {
              const error = new Error("Persistence operation is blocked while Scheduler is faulted.");
              error.code = "UNSAFE_BOUNDARY";
              throw error;
            }

            // Saving and loading await storage I/O. Serialize them so two
            // overlapping transactions cannot race over the same participants
            // or save slots. Hold one independent clock pause until the entire
            // queue drains; this also preserves unrelated pause reasons.
            pendingPersistenceOperations += 1;
            if (pendingPersistenceOperations === 1) clock.pause("core.persistence");
            const queuedOperation = persistenceQueue.then(() => operation());
            persistenceQueue = queuedOperation.then(() => undefined, () => undefined);
            try {
              return await queuedOperation;
            } finally {
              pendingPersistenceOperations -= 1;
              if (pendingPersistenceOperations === 0) clock.resume("core.persistence");
            }
          }
        });
        persistence.registerParticipant(entities.createPersistenceParticipant());
        persistence.registerParticipant(worlds.createPersistenceParticipant());
        persistence.registerParticipant(worldContext.createPersistenceParticipant());
        return { [SERVICE.persistence]: persistence };
      }
    },

  ];

  bootstrap = new SystemBootstrap({ systems: [...systems, ...hostSystems] });
  let runtimeContext = null;

  return Object.freeze({
    async start() {
      if (runtimeDestroying || destroyPromise) throw new Error("Core assembly is shutting down and cannot be started.");
      if (runtimeContext || startPromise) throw new Error("Core assembly has already been started.");
      startPromise = enqueueLifecycle(() => bootstrap.start()).then((context) => {
        runtimeContext = context;
        return context;
      });
      try {
        return await startPromise;
      } finally {
        startPromise = null;
      }
    },
    get context() { return runtimeContext; },
    get state() { return bootstrap.state; },
    get initializationOrder() { return bootstrap.initializationOrder; },
    async pause() {
      if (runtimeDestroying) throw new Error("Core assembly is shutting down and cannot be paused.");
      return enqueueLifecycle(() => bootstrap.pause());
    },
    async resume() {
      if (runtimeDestroying) throw new Error("Core assembly is shutting down and cannot be resumed.");
      return enqueueLifecycle(() => bootstrap.resume());
    },
    async destroy() {
      if (destroyPromise) return destroyPromise;
      runtimeDestroying = true;
      destroyPromise = enqueueLifecycle(async () => {
        // start() is queued ahead of destroy(), so its promise settles before
        // teardown begins. A failed startup has already run its own cleanup.
        if (startPromise) {
          try { await startPromise; } catch { /* Failed startup already performs its own cleanup. */ }
        }
        // Do not destroy registries or participants while an accepted save/load
        // transaction is still using them. New requests are rejected above.
        await persistenceQueue;
        await bootstrap.destroy();
        runtimeContext = null;
      });
      return destroyPromise;
    },
    services: SERVICE
  });
}
