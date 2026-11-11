import { Logger } from "./logger.js";
import { EventBus } from "./event-bus.js";
import { GameClock } from "./game-clock.js";
import { SimulationScheduler } from "./simulation-scheduler.js";
import { EntityRegistry } from "./entity-registry.js";
import { WorldRegistry } from "./world-registry.js";
import { WorldContext } from "./world-context.js";
import { Persistence, MemorySaveAdapter } from "./persistence.js";
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
  saveAdapter = new MemorySaveAdapter(),
  gameVersion = "0.1.0",
  campaignFormatVersion = 1,
  dayLengthRealSeconds = 720,
  fixedStepSeconds = 6,
  maxStepsPerFrame = 120,
  demoSystem = null
} = {}) {
  let insideSimulationStep = false;
  let bootstrap = null;
  let eventBus = null;

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
          sources: ["core.event-bus", "core.demo-system", "core.scheduler"],
          logger: required(context, SERVICE.logger)
        });
        return { [SERVICE.events]: eventBus };
      }
    },
    {
      id: "core.game-clock",
      provides: [SERVICE.clock],
      initialize() {
        return { [SERVICE.clock]: new GameClock({ dayLengthRealSeconds, initialSpeed: 1, minimumSpeed: 1, maximumSpeed: 3 }) };
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
          systemOrder: ["core.demo-system"],
          fixedStepSeconds,
          maxStepsPerFrame,
          tasks: [{
            systemId: "core.demo-system",
            update({ deltaSeconds, tick }) {
              insideSimulationStep = true;
              try {
                const result = demoSystem?.update?.({ deltaSeconds, tick, context });
                if (result && typeof result.then === "function") {
                  // Prevent a rejected async hook from becoming an unhandled rejection;
                  // the scheduler contract itself remains strictly synchronous.
                  if (typeof result.catch === "function") result.catch(() => {});
                  const error = new Error("Demo system update returned a Promise; simulation updates must be synchronous.");
                  error.code = "ASYNC_UPDATE_NOT_SUPPORTED";
                  throw error;
                }
                events.publish({
                  type: "core.simulation-step",
                  source: "core.scheduler",
                  payload: { tick, deltaSeconds }
                });
              } finally {
                insideSimulationStep = false;
              }
            }
          }],
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
        const persistence = new Persistence({
          adapter: saveAdapter,
          gameVersion,
          campaignFormatVersion,
          logger,
          runAtSafeBoundary: async (operation) => {
            if (insideSimulationStep) {
              const error = new Error("Persistence operation attempted during a simulation step.");
              error.code = "UNSAFE_BOUNDARY";
              throw error;
            }
            if (events.pendingCount !== 0) {
              const error = new Error("Persistence operation attempted while Event Bus delivery is pending.");
              error.code = "UNSAFE_BOUNDARY";
              throw error;
            }
            if (scheduler.snapshot.faulted) {
              const error = new Error("Persistence operation is blocked while Scheduler is faulted.");
              error.code = "UNSAFE_BOUNDARY";
              throw error;
            }
            return operation();
          }
        });
        persistence.registerParticipant(entities.createPersistenceParticipant());
        persistence.registerParticipant(worlds.createPersistenceParticipant());
        persistence.registerParticipant(worldContext.createPersistenceParticipant());
        return { [SERVICE.persistence]: persistence };
      }
    },
    {
      id: "core.demo-system",
      provides: ["core.demo-api"],
      requires: [SERVICE.entities, SERVICE.worlds, SERVICE.worldContext, SERVICE.events, SERVICE.clock],
      initialize(context) {
        const entities = required(context, SERVICE.entities);
        const worlds = required(context, SERVICE.worlds);
        const worldContext = required(context, SERVICE.worldContext);
        const events = required(context, SERVICE.events);
        const clock = required(context, SERVICE.clock);
        worlds.registerWorld({
          worldId: "world:cassandra",
          type: "cassandra",
          dimensions: { width: 128, height: 128 },
          coordinateSystem: "world-units",
        });
        worlds.activateWorld("world:cassandra");
        const entity = entities.registerPersistent({ id: "entity:integration-pawn", kind: "pawn", metadata: { role: "integration-demo" } });
        worldContext.placeEntity(entity.id, "world:cassandra", { x: 12, y: 18 });
        let receivedSteps = 0;
        const unsubscribe = events.subscribe("core.simulation-step", "core.demo-system", () => { receivedSteps += 1; });
        return {
          "core.demo-api": Object.freeze({
            entityId: entity.id,
            get receivedSteps() { return receivedSteps; },
            unsubscribe
          })
        };
      },
      start(context) {
        demoSystem?.start?.(context);
      },
      destroy() {
        demoSystem?.destroy?.();
      }
    }
  ];

  bootstrap = new SystemBootstrap({ systems });
  let runtimeContext = null;

  return Object.freeze({
    async start() {
      if (runtimeContext) throw new Error("Core assembly has already been started.");
      runtimeContext = await bootstrap.start();
      return runtimeContext;
    },
    get context() { return runtimeContext; },
    get state() { return bootstrap.state; },
    get initializationOrder() { return bootstrap.initializationOrder; },
    async pause() { return bootstrap.pause(); },
    async resume() { return bootstrap.resume(); },
    async destroy() {
      await bootstrap.destroy();
      runtimeContext = null;
    },
    services: SERVICE
  });
}
