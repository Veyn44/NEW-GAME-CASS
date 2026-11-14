/**
 * Exposes host-provided input state through a reusable Engine service.
 * The host owns physical input collection and lifecycle policy; Engine systems
 * consume the stable read-only contract without depending on a browser adapter.
 */
export function createInputSystem({ inputController } = {}) {
  if (!inputController
    || typeof inputController.getState !== "function"
    || typeof inputController.consumeFrameInput !== "function") {
    throw new TypeError("Input system requires a controller with getState() and consumeFrameInput().");
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
    id: "engine.input",
    provides: ["engine.input-api"],
    initialize() {
      return { "engine.input-api": api };
    }
  });
}
