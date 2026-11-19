/**
 * Exposes host-provided physical input and mapped actions through Engine services.
 * The Engine consumes action names; it never assigns meaning to physical keys.
 */
export function createInputSystem({ inputController, actionController } = {}) {
  if (!inputController
    || typeof inputController.getState !== "function"
    || typeof inputController.consumeFrameInput !== "function") {
    throw new TypeError("Input system requires a controller with getState() and consumeFrameInput().");
  }
  if (actionController && typeof actionController.getState !== "function") {
    throw new TypeError("Action mapping controller must expose getState().");
  }

  const api = Object.freeze({
    getState: () => inputController.getState(),
    consumeFrameInput: () => inputController.consumeFrameInput(),
    getActions: () => actionController?.getState() ?? Object.freeze({}),
    getActionBindings: () => actionController?.getBindings() ?? Object.freeze({})
  });

  return Object.freeze({
    id: "engine.input",
    provides: ["engine.input-api"],
    initialize() {
      return { "engine.input-api": api };
    }
  });
}
