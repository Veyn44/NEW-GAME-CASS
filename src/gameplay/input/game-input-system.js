/**
 * Exposes the host-owned viewport input state to gameplay systems through a
 * stable service contract. The input controller itself remains an adapter and
 * is injected by the application composition root.
 */
export function createGameInputSystem({ inputController } = {}) {
  if (!inputController
    || typeof inputController.getState !== "function"
    || typeof inputController.consumeFrameInput !== "function") {
    throw new TypeError("Game input system requires a viewport input controller.");
  }

  const api = Object.freeze({
    getState() {
      return inputController.getState();
    },
    consumeFrameInput() {
      return inputController.consumeFrameInput();
    }
  });

  return Object.freeze({
    id: "game.input",
    provides: ["game.input-api"],
    initialize() {
      return { "game.input-api": api };
    }
  });
}
