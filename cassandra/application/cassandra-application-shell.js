import { loadCassandraDatabase } from "../database/load-cassandra-database.js";
import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { createInputSystem } from "../../engine/input/input-system.js";
import { getDefinition } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createCassandraDevLabGameplayController } from "./dev-lab-gameplay-controller.js";
import { createCassandraDevLabUnitInspectorUi } from "./dev-lab-unit-inspector-ui.js";
import { startDevLab } from "../../dev-lab/application/application-shell.js";

/**
 * Cassandra's composition root. Dev Lab is injected as a host tool; the
 * standalone Dev Lab entry point never imports this module.
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
 * Adapt Cassandra-owned runtime services to the public Dev Lab host contract.
 * Cassandra UI is mounted only by the Cassandra page.
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

export async function startCassandraApplication() {
  await startDevLab({
    loadContentPackage: loadCassandraDatabase,
    createRuntime: createCassandraRuntime,
    resolveRuntimeServices: resolveCassandraRuntimeServices
  });
}
