import { loadCassandraDatabase } from "./cassandra/database/load-cassandra-database.js";
import { createGameRuntime } from "./engine/runtime/create-game-runtime.js";
import { createInputSystem } from "./engine/input/input-system.js";
import { getDefinition } from "./engine/database/definition-registry.js";
import { createUnitSystem } from "./src/gameplay/unit/unit-system.js";
import { createColonyControlSystem } from "./src/gameplay/colony/colony-control-system.js";
import { createCassandraDevLabGameplayController } from "./cassandra/application/dev-lab-gameplay-controller.js";
import { createCassandraDevLabUnitInspectorUi } from "./cassandra/application/dev-lab-unit-inspector-ui.js";
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
  let gameplayController = null;
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
        gameplayController ??= createCassandraDevLabGameplayController({
          unitApi: context.getService("game.unit-api"),
          colonyControlApi: context.getService("game.colony-control-api"),
          worldRegistry: context.getService("core.world-registry")
        });
        if (gameplayController.getControlState().drafted) {
          const moved = gameplayController.update(deltaSeconds);
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
  const worldRegistry = context.getService("core.world-registry");
  const gameplayApi = createCassandraDevLabGameplayController({
    unitApi: context.getService("game.unit-api"),
    colonyControlApi: context.getService("game.colony-control-api"),
    worldRegistry
  });
  const gameplayUi = createCassandraDevLabUnitInspectorUi({
    root: document.querySelector("[data-application-gameplay-ui]"),
    gameplayApi
  });
  return {
    worldRegistry,
    persistenceApi: context.getService("core.persistence"),
    clock: context.getService("core.game-clock"),
    gameplayApi,
    gameplayUi
  };
}

await startDevLab({
  loadContentPackage: loadCassandraDatabase,
  createRuntime: createCassandraRuntime,
  resolveRuntimeServices: resolveCassandraRuntimeServices
});
