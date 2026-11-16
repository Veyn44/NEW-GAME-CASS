import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";

/**
 * Creates the standalone Dev Lab runtime.
 *
 * This runtime deliberately registers no game-owned host systems. The Dev Lab
 * may supply its own editor-side simulation callbacks, while a game
 * application can inject a separately composed runtime when needed.
 */
export function createDevLabRuntime({ saveAdapter, updateFreeCamera } = {}) {
  return createGameRuntime({
    saveAdapter,
    fixedStepSeconds: 1 / 60,
    maxStepsPerFrame: 120,
    hostSystems: [{
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
    }, {
      id: "dev-lab.free-camera"
    }],
    simulationTasks: [{
      systemId: "dev-lab.free-camera",
      update({ deltaSeconds }) {
        updateFreeCamera?.(deltaSeconds);
      }
    }]
  });
}
