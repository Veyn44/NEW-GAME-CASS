import test from "node:test";
import assert from "node:assert/strict";

import { createViewNavigationController } from "../../shared/application/view-navigation-controller.js";

class FakeElement {
  constructor(view = null) {
    this.dataset = view ? { view } : {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.children = [];
    this.listeners = new Map();
    this.classNames = new Set();
    this.classList = {
      add: (name) => this.classNames.add(name),
      remove: (name) => this.classNames.delete(name),
      contains: (name) => this.classNames.has(name)
    };
  }
  addEventListener(type, callback) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(callback);
    this.listeners.set(type, listeners);
  }
  emit(type) {
    for (const callback of this.listeners.get(type) ?? []) callback({ type, target: this });
  }
  click() { this.emit("click"); }
  append(child) { this.children.push(child); }
  after(child) { this.afterChild = child; }
}

function createHarness({ canOpen = () => true } = {}) {
  const menu = new FakeElement("menu");
  const workspace = new FakeElement("dev-lab");
  const database = new FakeElement("database");
  const settings = new FakeElement("settings");
  const databaseBack = new FakeElement();
  const settingsBack = new FakeElement();
  const viewportDatabase = new FakeElement();
  const body = { dataset: { currentView: "menu" } };
  const viewportPanel = new FakeElement();
  const databaseHome = new FakeElement();
  const navWorkspace = new FakeElement();
  navWorkspace.dataset.navigate = "dev-lab";
  const navDatabase = new FakeElement();
  navDatabase.dataset.navigate = "database";
  const navSettings = new FakeElement();
  navSettings.dataset.navigate = "settings";
  const catalogCalls = [];
  const definitionCatalog = {
    open(mode) { catalogCalls.push(["open", mode]); },
    close() { catalogCalls.push(["close"]); }
  };
  const callbacks = { beforeLeave: [], settingsReturn: [] };
  let scrolled = 0;
  let resized = 0;
  const controller = createViewNavigationController({
    workspaceView: "dev-lab",
    catalogLabels: { browse: "ENGINE / CONTENT CATALOG", viewport: "ENGINE / DEV LAB" },
    elements: {
      views: [menu, workspace, database, settings],
      navButtons: [navWorkspace, navDatabase, navSettings],
      databaseView: database,
      databaseHome,
      databaseModeLabel: new FakeElement(),
      databaseBackButton: databaseBack,
      viewportPanel,
      settingsBackButton: settingsBack,
      backMenuButtons: [databaseBack],
      viewportDatabaseButton: viewportDatabase,
      body
    },
    definitionCatalog,
    canOpenViewportDatabase: canOpen,
    beforeLeaveWorkspace: (name) => callbacks.beforeLeave.push(name),
    onSettingsReturn: (view) => callbacks.settingsReturn.push(view),
    scrollToTop: () => { scrolled += 1; },
    dispatchResize: () => { resized += 1; }
  });
  return {
    controller, menu, workspace, database, settings, databaseBack,
    navWorkspace, navDatabase, navSettings,
    settingsBack, viewportDatabase,
    body, viewportPanel, databaseHome, catalogCalls, callbacks,
    get scrolled() { return scrolled; },
    get resized() { return resized; }
  };
}

test("navigation switches views and runs workspace-leave behavior only when leaving", () => {
  const h = createHarness();
  h.navWorkspace.click();
  assert.equal(h.body.dataset.currentView, "dev-lab");
  assert.equal(h.workspace.hidden, false);
  assert.equal(h.resized, 1);
  h.controller.showView("settings");
  assert.equal(h.body.dataset.currentView, "settings");
  assert.deepEqual(h.callbacks.beforeLeave, ["settings"]);
  assert.equal(h.scrolled, 2);
});

test("catalog browse navigation opens and back returns to the main menu", () => {
  const h = createHarness();
  h.navDatabase.click();
  assert.equal(h.body.dataset.currentView, "database");
  assert.equal(h.database.dataset.mode, "browse");
  assert.deepEqual(h.catalogCalls, [["open", "browse"]]);
  h.databaseBack.click();
  assert.equal(h.body.dataset.currentView, "menu");
});

test("viewport catalog overlay is guarded, opens in place, and closes cleanly", () => {
  const blocked = createHarness({ canOpen: () => false });
  blocked.controller.showView("dev-lab");
  blocked.viewportDatabase.click();
  assert.equal(blocked.controller.isViewportDatabaseOpen(), false);

  const h = createHarness();
  h.controller.showView("dev-lab");
  h.viewportDatabase.click();
  assert.equal(h.controller.isViewportDatabaseOpen(), true);
  assert.equal(h.database.hidden, false);
  assert.equal(h.database.dataset.mode, "viewport");
  assert.equal(h.database.classList.contains("database-overlay"), true);
  assert.equal(h.viewportPanel.children.includes(h.database), true);
  h.databaseBack.click();
  assert.equal(h.controller.isViewportDatabaseOpen(), false);
  assert.equal(h.database.hidden, true);
  assert.equal(h.database.classList.contains("database-overlay"), false);
  assert.equal(h.databaseHome.afterChild, h.database);
  assert.deepEqual(h.catalogCalls, [["open", "viewport"], ["close"]]);
});

test("leaving the workspace closes its open catalog overlay", () => {
  const h = createHarness();
  h.controller.showView("dev-lab");
  h.controller.openViewportDatabase();
  h.controller.showView("menu");
  assert.equal(h.controller.isViewportDatabaseOpen(), false);
  assert.equal(h.database.hidden, true);
  assert.deepEqual(h.callbacks.beforeLeave, ["menu"]);
});

test("settings return preserves the originating view and pause-menu callback", () => {
  const h = createHarness();
  h.controller.openSettings("dev-lab");
  assert.equal(h.body.dataset.currentView, "settings");
  h.settingsBack.click();
  assert.equal(h.body.dataset.currentView, "dev-lab");
  assert.deepEqual(h.callbacks.settingsReturn, ["dev-lab"]);
});
