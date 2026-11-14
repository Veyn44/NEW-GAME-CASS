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
    simulationTasks: [{
      systemId: "dev-lab.free-camera",
      update({ deltaSeconds }) {
        updateFreeCamera?.(deltaSeconds);
      }
    }]
  });
}
