import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { createInputSystem } from "../../engine/input/input-system.js";
import { getDefinition } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createCassandraWorldSessionSystem } from "../../src/gameplay/world/cassandra-world-session-system.js";
import { createCassandraExpeditionProjectionSystem } from "../../src/gameplay/expedition/cassandra-expedition-projection-system.js";
import { createPawnRuntimeSystem } from "../gameplay/pawn/pawn-runtime-system.js";
import { createCassandraDevLabGameplayController } from "./dev-lab-gameplay-controller.js";
import { createCassandraDevLabUnitInspectorUi } from "./dev-lab-unit-inspector-ui.js";
import { createApplicationRuntimeHost } from "../../shared/application/runtime-host.js";

/** Cassandra-owned gameplay runtime composition. */
export function createCassandraRuntime({
  saveAdapter,
  inputController,
  actionController,
  isPackageApplied = null,
  onUnitMoved,
  updateFreeCamera
} = {}) {
  let gameplayController = null;
  return createGameRuntime({
    saveAdapter,
    fixedStepSeconds: 1 / 60,
    maxStepsPerFrame: 120,
    hostSystems: [
      createInputSystem({ inputController, actionController }),
      createUnitSystem({ definitionLookup: getDefinition }),
      createPawnRuntimeSystem({ definitionLookup: getDefinition }),
      createColonyControlSystem(),
      createCassandraWorldSessionSystem({ isPackageApplied }),
      createCassandraExpeditionProjectionSystem()
    ],
    simulationTasks: [{
      systemId: "game.colony-control",
      update({ deltaSeconds, tick, context }) {
        gameplayController ??= createCassandraDevLabGameplayController({
          unitApi: context.getService("game.unit-api"),
          pawnRuntimeApi: context.getService("cassandra.pawn-runtime-api"),
          colonyControlApi: context.getService("game.colony-control-api"),
          worldRegistry: context.getService("core.world-registry")
        });
        if (gameplayController.getControlState().drafted) {
          const moved = gameplayController.update(deltaSeconds);
          if (moved) onUnitMoved?.(moved);
        } else {
          updateFreeCamera?.(deltaSeconds);
        }
      }
    }]
  });
}

/** Resolve Engine services into Cassandra-owned application contracts. */
export function resolveCassandraRuntimeServices(context) {
  const worldRegistry = context.getService("core.world-registry");
  const gameplayApi = createCassandraDevLabGameplayController({
    unitApi: context.getService("game.unit-api"),
    pawnRuntimeApi: context.getService("cassandra.pawn-runtime-api"),
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
    worldSessionApi: context.getService("game.world-session-api"),
    expeditionProjectionApi: context.getService("game.expedition-projection-api"),
    pawnRuntimeApi: context.getService("cassandra.pawn-runtime-api"),
    gameplayApi,
    gameplayUi
  };
}

/**
 * Cassandra's runtime host. Browser frame scheduling and presentation policy
 * are injected by Cassandra's application shell; the shared host owns timing.
 */
export function createCassandraRuntimeHost({
  createRuntime = createCassandraRuntime,
  resolveRuntimeServices = resolveCassandraRuntimeServices,
  saveAdapter,
  inputController,
  actionController,
  isPackageApplied = null,
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
    createRuntime: (options) => createRuntime(options),
    resolveRuntimeServices,
    runtimeOptions: { saveAdapter, inputController, actionController, isPackageApplied, onUnitMoved, updateFreeCamera },
    requestFrame,
    cancelFrame,
    shouldAdvance,
    onReady,
    onFrame,
    onPauseChange,
    onError
  });
}
