import test from "node:test";
import assert from "node:assert/strict";
import { createGameInputSystem } from "../../src/gameplay/input/game-input-system.js";
import { createViewportInputController } from "../../src/application/input/viewport-input-controller.js";

test("game input system exposes the injected controller through a read-only service", () => {
  const controller = createViewportInputController();
  const system = createGameInputSystem({ inputController: controller });
  const services = system.initialize();
  const api = services["game.input-api"];

  assert.equal(system.id, "game.input");
  assert.equal(system.provides[0], "game.input-api");
  assert.equal(Object.isFrozen(api), true);

  controller.resume();
  controller.keyDown("KeyW");
  assert.deepEqual(api.getState().keys, ["KeyW"]);
  assert.deepEqual(api.consumeFrameInput().keys, ["KeyW"]);
});

test("game input system rejects a missing or invalid controller", () => {
  assert.throws(() => createGameInputSystem(), /requires a viewport input controller/);
  assert.throws(() => createGameInputSystem({ inputController: {} }), /requires a viewport input controller/);
});
