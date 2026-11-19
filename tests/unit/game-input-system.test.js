import test from "node:test";
import assert from "node:assert/strict";
import { createInputSystem } from "../../engine/input/input-system.js";
import { createViewportInputController } from "../../shared/input/viewport-input-controller.js";
import { createActionMappingController } from "../../engine/input/action-mapping-controller.js";

test("Engine input system exposes the injected controller through a read-only service", () => {
  const controller = createViewportInputController();
  const actionController = createActionMappingController();
  const system = createInputSystem({ inputController: controller, actionController });
  const services = system.initialize();
  const api = services["engine.input-api"];

  assert.equal(system.id, "engine.input");
  assert.equal(system.provides[0], "engine.input-api");
  assert.equal(Object.isFrozen(api), true);

  controller.resume();
  controller.keyDown("KeyW");
  actionController.keyDown("KeyW");
  assert.deepEqual(api.getState().keys, ["KeyW"]);
  assert.deepEqual(api.consumeFrameInput().keys, ["KeyW"]);
  assert.equal(api.getActions().moveNorth, true);
  assert.deepEqual(api.getActionBindings().moveNorth, ["KeyW"]);
});

test("Engine input system rejects a missing or invalid controller", () => {
  assert.throws(() => createInputSystem(), /requires a controller with getState\(\) and consumeFrameInput\(\)/);
  assert.throws(() => createInputSystem({ inputController: {} }), /requires a controller with getState\(\) and consumeFrameInput\(\)/);
});
