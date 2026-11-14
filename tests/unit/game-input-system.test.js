import test from "node:test";
import assert from "node:assert/strict";
import { createInputSystem } from "../../engine/input/input-system.js";
import { createViewportInputController } from "../../dev-lab/input/viewport-input-controller.js";

test("Engine input system exposes the injected controller through a read-only service", () => {
  const controller = createViewportInputController();
  const system = createInputSystem({ inputController: controller });
  const services = system.initialize();
  const api = services["engine.input-api"];

  assert.equal(system.id, "engine.input");
  assert.equal(system.provides[0], "engine.input-api");
  assert.equal(Object.isFrozen(api), true);

  controller.resume();
  controller.keyDown("KeyW");
  assert.deepEqual(api.getState().keys, ["KeyW"]);
  assert.deepEqual(api.consumeFrameInput().keys, ["KeyW"]);
});

test("game input system rejects a missing or invalid controller", () => {
  assert.throws(() => createGameInputSystem(), /requires a controller with getState() and consumeFrameInput()/);
  assert.throws(() => createGameInputSystem({ inputController: {} }), /requires a viewport input controller/);
});
