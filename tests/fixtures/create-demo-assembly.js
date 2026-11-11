import { createCoreAssembly as createEngineCoreAssembly } from "../../src/core/core-assembly.js";

/**
 * Cassandra-specific integration fixture. Kept outside src/core so the engine
 * assembly remains independent from demo worlds, entities and game systems.
 */
export function createCoreAssembly({ demoSystem = null, ...options } = {}) {
  let receivedSteps = 0;
  let entityId = null;
  let unsubscribe = null;
  const demo = {
    id: "game.integration-demo",
    provides: ["core.demo-api"],
    requires: ["core.entity-registry", "core.world-registry", "core.world-context", "core.event-bus"],
    initialize(context) {
      const entities = context.getService("core.entity-registry");
      const worlds = context.getService("core.world-registry");
      const placements = context.getService("core.world-context");
      const events = context.getService("core.event-bus");
      worlds.registerWorld({
        worldId: "world:cassandra",
        type: "cassandra",
        dimensions: { width: 128, height: 128 },
        coordinateSystem: "world-units"
      });
      worlds.activateWorld("world:cassandra");
      const entity = entities.registerPersistent({
        id: "entity:integration-pawn",
        kind: "pawn",
        metadata: { role: "integration-demo" }
      });
      entityId = entity.id;
      placements.placeEntity(entity.id, "world:cassandra", { x: 12, y: 18 });
      unsubscribe = events.subscribe("core.simulation-step", "game.integration-demo", () => { receivedSteps += 1; });
      return {
        "core.demo-api": Object.freeze({
          get entityId() { return entityId; },
          get receivedSteps() { return receivedSteps; },
          unsubscribe: () => unsubscribe?.()
        })
      };
    },
    start(context) { demoSystem?.start?.(context); },
    destroy(context) {
      unsubscribe?.();
      demoSystem?.destroy?.(context);
    }
  };
  return createEngineCoreAssembly({
    ...options,
    hostSystems: [...(options.hostSystems ?? []), demo],
    eventSources: [...(options.eventSources ?? [])],
    simulationTasks: [
      ...(options.simulationTasks ?? []),
      {
        systemId: "game.integration-demo",
        update(step) {
          const result = demoSystem?.update?.(step);
          if (result && typeof result.then === "function") return result;
        }
      }
    ]
  });
}
