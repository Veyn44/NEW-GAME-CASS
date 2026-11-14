import { loadCassandraDatabase } from "./cassandra/database/load-cassandra-database.js";
import { createGameRuntime } from "./engine/runtime/create-game-runtime.js";
import { createInputSystem } from "./engine/input/input-system.js";
import { getDefinition } from "./engine/database/definition-registry.js";
import { createUnitSystem } from "./src/gameplay/unit/unit-system.js";
import { createColonyControlSystem } from "./src/gameplay/colony/colony-control-system.js";
import { startDevLab } from "./dev-lab/application/application-shell.js";

/**
 * Cassandra owns the selection and ordering of its gameplay systems.
 * Dev Lab supplies host-owned adapters and presentation callbacks, but does
 * not import or construct Cassandra gameplay.
 */
export function createCassandraRuntime({
  saveAdapter,
  inputController,
  onUnitMoved,
  updateFreeCamera
} = {}) {
  return createGameRuntime({
    saveAdapter,
    fixedStepSeconds: 1 / 60,
    maxStepsPerFrame: 120,
    hostSystems: [
      createInputSystem({ inputController }),
      createUnitSystem({ definitionLookup: getDefinition }),
      createColonyControlSystem()
    ],
    simulationTasks: [{
      systemId: "game.colony-control",
      update({ deltaSeconds, context }) {
        const control = context.getService("game.colony-control-api");
        if (control.getState().drafted) {
          const moved = control.update(deltaSeconds);
          if (moved) onUnitMoved?.(moved);
          return;
        }
        updateFreeCamera?.(deltaSeconds);
      }
    }]
  });
}

/**
 * Resolve game-owned services at the application boundary and expose them to
 * Dev Lab through its application-facing service contract.
 */
export function resolveCassandraRuntimeServices(context) {
  return {
    worldRegistry: context.getService("core.world-registry"),
    persistenceApi: context.getService("core.persistence"),
    clock: context.getService("core.game-clock"),
    unitApi: context.getService("game.unit-api"),
    inputApi: context.getService("engine.input-api"),
    colonyControlApi: context.getService("game.colony-control-api")
  };
}

await startDevLab({
  loadContentPackage: loadCassandraDatabase,
  createRuntime: createCassandraRuntime,
  resolveRuntimeServices: resolveCassandraRuntimeServices
});
