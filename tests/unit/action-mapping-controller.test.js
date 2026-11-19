import test from "node:test";
import assert from "node:assert/strict";
import { createActionMappingController } from "../../engine/input/action-mapping-controller.js";
import { DEFAULT_CASSANDRA_ACTION_BINDINGS } from "../../cassandra/input/default-action-bindings.js";

test("physical keys activate named actions without exposing key semantics", () => {
  const input = createActionMappingController({ bindings: DEFAULT_CASSANDRA_ACTION_BINDINGS });
  assert.deepEqual(input.keyDown("KeyW"), ["moveNorth"]);
  assert.equal(input.getState().moveNorth, true);
  assert.equal(input.getState().pause, false);
  input.keyUp("KeyW");
  assert.equal(input.getState().moveNorth, false);
});

test("pause and draft are mapped actions and can be rebound independently", () => {
  const input = createActionMappingController();
  assert.deepEqual(input.keyDown("Space"), ["pause"]);
  input.keyUp("Space");
  input.setBinding("pause", ["KeyP"]);
  assert.deepEqual(input.keyDown("Space"), []);
  assert.deepEqual(input.keyDown("KeyP"), ["pause"]);
});

test("held actions remain active until their physical key is released", () => {
  const input = createActionMappingController();
  input.keyDown("KeyW");
  input.keyDown("KeyD");
  assert.deepEqual(input.getState(), {
    moveNorth: true, moveSouth: false, moveWest: false, moveEast: true,
    toggleDraft: false, pause: false, dodge: false, crouch: false
  });
  input.keyUp("KeyW");
  assert.equal(input.getState().moveNorth, false);
  assert.equal(input.getState().moveEast, true);
});

test("binding conflicts are rejected without changing the current configuration", () => {
  const input = createActionMappingController();
  const before = input.getBindings();
  assert.throws(() => input.setBinding("pause", ["KeyW"]), /conflict/i);
  assert.deepEqual(input.getBindings(), before);
});

test("reset restores the default mapping", () => {
  const input = createActionMappingController();
  input.setBinding("pause", ["KeyP"]);
  input.reset();
  assert.deepEqual(input.getBindings().pause, ["Space"]);
});
