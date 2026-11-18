import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { createInputSystem } from "../../engine/input/input-system.js";
import { getDefinition } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createCassandraDevLabGameplayController } from "../../cassandra/application/dev-lab-gameplay-controller.js";

/**
 * Standalone Dev Lab composition.
 * Uses generic Engine infrastructure plus Cassandra's existing gameplay systems
 * so the established Johny / Draft / Pawn-control behavior remains intact.
 * Cassandra campaign and expedition systems are intentionally not included.
 */
export function createDevLabRuntime({
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
      createColonyControlSystem(),
      {
        id: "dev-lab.world",
        requires: ["core.world-registry", "core.world-runtime"],
        initialize(context) {
          const worlds = context.getService("core.world-registry");
          const worldRuntime = context.getService("core.world-runtime");
          worlds.registerWorld({
            worldId: "world:dev-lab",
            type: "dev-lab.editor",
            dimensions: { width: 1, height: 1 }
          });
          worldRuntime.beginLoading("world:dev-lab");
          worldRuntime.markReady("world:dev-lab");
          worldRuntime.setSimulationEnabled("world:dev-lab", true);
        }
      },
      { id: "dev-lab.free-camera" }
    ],
    simulationTasks: [{
      systemId: "dev-lab.free-camera",
      update({ deltaSeconds, context }) {
        gameplayController ??= createCassandraDevLabGameplayController({
          unitApi: context.getService("game.unit-api"),
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
