import test from "node:test";
import assert from "node:assert/strict";

import { createDevLabPauseMenuController } from "../../dev-lab/application/pause-menu-controller.js";

class FakeElement {
  constructor(hidden = false) {
    this.hidden = hidden;
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

function createHarness({ canOpen = () => true, initiallyOpen = false } = {}) {
  const menu = new FakeElement(!initiallyOpen);
  const resumeButton = new FakeElement();
  const settingsButton = new FakeElement();
  const mainMenuButton = new FakeElement();
  const calls = { settings: [], views: [], opened: 0, closed: 0, visibility: [] };
  const navigation = {
    openSettings(view) { calls.settings.push(view); },
    showView(view) { calls.views.push(view); }
  };
  const controller = createDevLabPauseMenuController({
    elements: { menu, resumeButton, settingsButton, mainMenuButton },
    navigation,
    canOpen,
    onOpen: () => { calls.opened += 1; },
    onClose: () => { calls.closed += 1; },
    onVisibilityChange: (visible) => calls.visibility.push(visible)
  });
  return { controller, menu, resumeButton, settingsButton, mainMenuButton, calls };
}

test("pause menu opens and closes idempotently while notifying the host", () => {
  const h = createHarness();
  assert.equal(h.controller.isOpen(), false);
  assert.equal(h.menu.hidden, true);
  assert.equal(h.controller.open(), true);
  assert.equal(h.controller.open(), false);
  assert.equal(h.controller.isOpen(), true);
  assert.equal(h.menu.hidden, false);
  assert.equal(h.controller.close(), true);
  assert.equal(h.controller.close(), false);
  assert.equal(h.controller.isOpen(), false);
  assert.equal(h.menu.hidden, true);
  assert.deepEqual(h.calls.visibility, [true, false]);
  assert.equal(h.calls.opened, 1);
  assert.equal(h.calls.closed, 1);
});

test("pause menu Resume button closes the overlay", () => {
  const h = createHarness();
  h.controller.open();
  h.resumeButton.click();
  assert.equal(h.controller.isOpen(), false);
  assert.equal(h.menu.hidden, true);
  assert.deepEqual(h.calls.visibility, [true, false]);
});

test("Controls keeps the pause overlay open and routes back to the workspace", () => {
  const h = createHarness();
  h.controller.open();
  h.settingsButton.click();
  assert.deepEqual(h.calls.settings, ["dev-lab"]);
  assert.equal(h.controller.isOpen(), true);
  assert.equal(h.menu.hidden, false);
});

test("Main Menu closes the overlay before navigating away", () => {
  const h = createHarness();
  h.controller.open();
  h.mainMenuButton.click();
  assert.equal(h.controller.isOpen(), false);
  assert.equal(h.menu.hidden, true);
  assert.deepEqual(h.calls.views, ["menu"]);
  assert.deepEqual(h.calls.visibility, [true, false]);
});

test("pause menu cannot open outside the workspace and controls are inert while closed", () => {
  const h = createHarness({ canOpen: () => false });
  assert.equal(h.controller.open(), false);
  h.settingsButton.click();
  h.mainMenuButton.click();
  assert.equal(h.controller.isOpen(), false);
  assert.deepEqual(h.calls.settings, []);
  assert.deepEqual(h.calls.views, []);
  assert.deepEqual(h.calls.visibility, []);
});

test("pause menu can be initialized from an already visible overlay", () => {
  const h = createHarness({ initiallyOpen: true });
  assert.equal(h.controller.isOpen(), true);
  assert.equal(h.menu.hidden, false);
  assert.equal(h.controller.toggle(), true);
  assert.equal(h.controller.isOpen(), false);
});
