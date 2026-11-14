import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { createInputSystem } from "../../engine/input/input-system.js";
import { getDefinition } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createCassandraDevLabGameplayController } from "./dev-lab-gameplay-controller.js";
import { createCassandraDevLabUnitInspectorUi } from "./dev-lab-unit-inspector-ui.js";
import { createApplicationRuntimeHost } from "../../shared/application/runtime-host.js";

/** Cassandra-owned gameplay runtime composition. */
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

/** Resolve Engine services into Cassandra-owned application contracts. */
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

/**
 * Cassandra's runtime host. Browser frame scheduling and presentation policy
 * are injected by Cassandra's application shell; the shared host owns timing.
 */
export function createCassandraRuntimeHost({
  saveAdapter,
  inputController,
  onUnitMoved,
  updateFreeCamera,
  shouldAdvance = () => true,
  onReady = () => {},
  onFrame = () => {},
  onPauseChange = () => {},
  onError = () => {},
  requestFrame = globalThis.requestAnimationFrame,
  cancelFrame = globalThis.cancelAnimationFrame
} = {}) {
  return createApplicationRuntimeHost({
    createRuntime: (options) => createCassandraRuntime(options),
    resolveRuntimeServices: resolveCassandraRuntimeServices,
    runtimeOptions: { saveAdapter, inputController, onUnitMoved, updateFreeCamera },
    requestFrame,
    cancelFrame,
    shouldAdvance,
    onReady,
    onFrame,
    onPauseChange,
    onError
  });
}
