import test from "node:test";
import assert from "node:assert/strict";
import { createViewportInputController } from "../../src/application/input/viewport-input-controller.js";

test("a plain pause preserves held keys and mouse buttons until resume", () => {
  const input = createViewportInputController();
  input.resume();
  input.keyDown("KeyW");
  input.keyDown("KeyE");
  input.pointerDown(0);
  input.pointerDown(2);

  input.pause();
  assert.deepEqual(input.getState().keys, []);
  assert.deepEqual(input.getState().buttons, []);
  assert.equal(input.getState().resumePending, true);

  input.resume();
  assert.deepEqual(input.getState().keys, ["KeyE", "KeyW"]);
  assert.deepEqual(input.getState().buttons, [0, 2]);
});

test("releasing an input during pause removes only that input from the resume snapshot", () => {
  const input = createViewportInputController();
  input.resume();
  input.keyDown("KeyW");
  input.keyDown("KeyA");
  input.pointerDown(0);
  input.pause();

  input.keyUp("KeyW");
  input.pointerUp(0);
  input.resume();

  assert.deepEqual(input.getState().keys, ["KeyA"]);
  assert.deepEqual(input.getState().buttons, []);
});

test("starting inspection discards the resume snapshot and suppresses held inputs until release", () => {
  const input = createViewportInputController();
  input.resume();
  input.keyDown("KeyW");
  input.pointerDown(0);
  input.pause();

  input.beginInspection();
  assert.equal(input.getState().resumePending, false);
  input.resume();

  assert.deepEqual(input.getState().keys, []);
  assert.deepEqual(input.getState().buttons, []);
  input.keyUp("KeyW");
  input.pointerUp(0);
  input.keyDown("KeyW");
  input.pointerDown(0);

  assert.deepEqual(input.getState().keys, ["KeyW"]);
  assert.deepEqual(input.getState().buttons, [0]);
});

test("new key presses during pause do not become gameplay input after resume", () => {
  const input = createViewportInputController();
  input.pause();
  input.keyDown("KeyW");
  input.resume();
  assert.deepEqual(input.getState().keys, []);

  input.keyUp("KeyW");
  input.keyDown("KeyW");
  assert.deepEqual(input.getState().keys, ["KeyW"]);
});

test("pointer movement is consumed only while running and resets per frame", () => {
  const input = createViewportInputController();
  assert.equal(input.pointerMove(10, 5), false);
  input.resume();
  assert.equal(input.pointerMove(10, -4), true);
  assert.deepEqual(input.consumeFrameInput().pointerDelta, { x: 10, y: -4 });
  assert.deepEqual(input.consumeFrameInput().pointerDelta, { x: 0, y: 0 });
});

test("focus loss clears all held inputs and pending resume state", () => {
  const input = createViewportInputController();
  input.resume();
  input.keyDown("KeyW");
  input.pointerDown(0);
  input.pause();
  input.clearForFocusLoss();
  input.resume();

  assert.deepEqual(input.getState().keys, []);
  assert.deepEqual(input.getState().buttons, []);
  assert.equal(input.getState().resumePending, false);
});

test("a paused left click enters inspection and discards held gameplay input", () => {
  const input = createViewportInputController();
  input.resume();
  input.keyDown("KeyW");
  input.pause();
  input.pointerDown(0);
  assert.equal(input.getState().resumePending, false);
  input.resume();
  assert.deepEqual(input.getState().keys, []);
});
