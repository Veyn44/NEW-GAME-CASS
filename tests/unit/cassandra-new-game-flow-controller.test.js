import test from "node:test";
import assert from "node:assert/strict";

import { createNewGameFlowController } from "../../cassandra/application/new-game-flow-controller.js";

class FakeElement {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }

  click() {
    for (const callback of this.listeners.get("click") ?? []) callback({ type: "click", target: this });
  }
}

function createHarness() {
  const calls = [];
  const navigation = {
    showView(name) {
      calls.push(name);
      return true;
    }
  };
  const elements = {
    openButton: new FakeElement(),
    nextButton: new FakeElement(),
    optionsBackButton: new FakeElement(),
    characterBackButton: new FakeElement()
  };
  const controller = createNewGameFlowController({ navigation, elements });
  return { calls, elements, controller };
}

test("New Game opens the options placeholder from the main menu", () => {
  const h = createHarness();

  h.elements.openButton.click();

  assert.deepEqual(h.calls, ["new-game-options"]);
  assert.equal(h.controller.getCurrentStep(), "options");
});

test("Next advances from options to character selection", () => {
  const h = createHarness();

  h.elements.nextButton.click();

  assert.deepEqual(h.calls, ["character-selection"]);
  assert.equal(h.controller.getCurrentStep(), "character");
});

test("Back from options returns to the main menu", () => {
  const h = createHarness();

  h.elements.optionsBackButton.click();

  assert.deepEqual(h.calls, ["menu"]);
  assert.equal(h.controller.getCurrentStep(), "closed");
});

test("Back from character selection returns to options", () => {
  const h = createHarness();

  h.elements.characterBackButton.click();

  assert.deepEqual(h.calls, ["new-game-options"]);
  assert.equal(h.controller.getCurrentStep(), "options");
});

test("opening New Game again always starts at the options screen", () => {
  const h = createHarness();

  h.elements.nextButton.click();
  h.elements.openButton.click();

  assert.deepEqual(h.calls, ["character-selection", "new-game-options"]);
  assert.equal(h.controller.getCurrentStep(), "options");
});

test("the controller does not create worlds, units or sessions", () => {
  const h = createHarness();

  h.controller.open();
  h.controller.showCharacter();

  assert.deepEqual(h.calls, ["new-game-options", "character-selection"]);
});
