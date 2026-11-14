import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("shared application runtime host is independent from application and browser globals", async () => {
  const host = await read("../../shared/application/runtime-host.js");
  assert.ok(host.includes("export function createApplicationRuntimeHost"));
  assert.equal(host.includes("/cassandra/"), false);
  assert.equal(host.includes("/dev-lab/"), false);
  assert.equal(host.includes("requestAnimationFrame"), false);
  assert.equal(host.includes("document."), false);
});

test("Dev Lab delegates runtime lifecycle and frame scheduling to the shared host", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const host = await read("../../shared/application/runtime-host.js");
  assert.ok(shell.includes("createApplicationRuntimeHost"));
  assert.ok(shell.includes("createDevLabRuntimeHost"));
  assert.ok(shell.includes("runtimeHost.start()"));
  assert.ok(shell.includes("runtimeHost.pause("));
  assert.ok(shell.includes("runtimeHost.resume("));
  assert.equal(shell.includes("function simulationFrame"), false);
  assert.equal(shell.includes("requestAnimationFrame(simulationFrame)"), false);
  assert.equal(shell.includes("function runtimeAdvance"), false);
  assert.ok(host.includes("runtime.advance(deltaSeconds)"));
  assert.ok(host.includes("runtime.destroy()"));
});

test("Dev Lab shell has no Cassandra or game-system imports", async () => {
  const source = await read("../../dev-lab/application/application-shell.js");
  assert.equal(source.includes("/cassandra/"), false);
  assert.equal(source.includes("/src/gameplay/"), false);
  assert.equal(source.includes("createUnitSystem"), false);
  assert.equal(source.includes("createColonyControlSystem"), false);
  assert.ok(source.includes("createRuntime = createDevLabRuntime"));
  assert.ok(source.includes("export async function startDevLab("));
});

test("Cassandra composition root owns game systems and adapts them to Dev Lab", async () => {
  const source = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(source.includes("createUnitSystem"));
  assert.ok(source.includes("createColonyControlSystem"));
  assert.ok(source.includes("createInputSystem"));
  assert.ok(source.includes("export function createCassandraRuntime"));
  assert.ok(source.includes("export function resolveCassandraRuntimeServices"));
  assert.ok(source.includes("export async function startCassandraApplication"));
  assert.ok(source.includes("createRuntime: createCassandraRuntime"));
  assert.ok(source.includes("resolveRuntimeServices: resolveCassandraRuntimeServices"));
});

test("Cassandra browser entry delegates to the Cassandra application shell", async () => {
  const source = await read("../../application-entry.js");
  assert.ok(source.includes("cassandra-application-shell"));
  assert.ok(source.includes("startCassandraApplication"));
  assert.equal(source.includes("createUnitSystem"), false);
  assert.equal(source.includes("startDevLab"), false);
});

test("standalone Dev Lab entry and page do not load Cassandra application code", async () => {
  const entry = await read("../../dev-lab/application/standalone-entry.js");
  const html = await read("../../dev-lab.html");
  assert.ok(entry.includes('from "./application-shell.js"'));
  assert.ok(entry.includes("await startDevLab()"));
  assert.equal(entry.toLowerCase().includes("cassandra/"), false);
  assert.ok(html.includes("standalone-entry.js"));
  assert.ok(html.includes('data-view="dev-lab"'));
  assert.equal(html.includes("application-entry.js"), false);
  assert.equal(html.toLowerCase().includes("cassandra/"), false);
});

test("Dev Lab has a standalone Engine runtime without Cassandra gameplay imports", async () => {
  const source = await read("../../dev-lab/application/create-dev-lab-runtime.js");
  assert.ok(source.includes("createGameRuntime"));
  assert.ok(source.includes('systemId: "dev-lab.free-camera"'));
  assert.equal(source.includes("/src/gameplay/"), false);
  assert.equal(source.includes("/cassandra/"), false);
});

test("Dev Lab shell consumes a gameplay adapter instead of Cassandra Unit/Colony APIs", async () => {
  const source = await read("../../dev-lab/application/application-shell.js");
  assert.ok(source.includes("gameplayApi"));
  assert.equal(source.includes("pawn.johny"), false);
  assert.equal(source.includes("game.unit-api"), false);
  assert.equal(source.includes("game.colony-control-api"), false);
});

test("Cassandra gameplay adapter owns Draft binding and Pawn-specific placement policy", async () => {
  const source = await read("../../cassandra/application/dev-lab-gameplay-controller.js");
  assert.ok(source.includes("KeyF"));
  assert.ok(source.includes("pawn.johny"));
  assert.ok(source.includes("toggleDraft"));
});

test("Cassandra application exposes a single gameplay adapter contract to Dev Lab", async () => {
  const source = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(source.includes("createCassandraDevLabGameplayController"));
  assert.ok(source.includes("gameplayApi"));
  const resolver = source.slice(source.indexOf("export function resolveCassandraRuntimeServices"));
  assert.ok(resolver.includes("gameplayApi"));
  const exposedServices = resolver.slice(resolver.indexOf("return {"));
  assert.equal(/^\s{4}(?:unitApi|colonyControlApi|inputApi):/m.test(exposedServices), false);
});

test("Dev Lab delegates Unit inspection UI and contains no Cassandra inspector markup", async () => {
  const source = await read("../../dev-lab/application/application-shell.js");
  assert.ok(source.includes("gameplayUi"));
  assert.ok(source.includes("inspectGameplayEntity"));
  for (const forbidden of ["quickSelect", "unitProfile", "quick-select", "unit-profile", "selectedUnitId", "selectedObject"]) {
    assert.equal(source.includes(forbidden), false);
  }
  const entry = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(entry.includes("createCassandraDevLabUnitInspectorUi"));
  assert.ok(entry.includes("gameplayUi"));
  const ui = await read("../../cassandra/application/dev-lab-unit-inspector-ui.js");
  assert.ok(ui.includes('data-role="quick-select"'));
  assert.ok(ui.includes('data-role="unit-profile"'));
  assert.ok(ui.includes("getSelectedUnitId"));
  assert.ok(ui.includes("isProfileOpen"));
});


test("Dev Lab shell delegates viewport and workspace persistence to owned services", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const viewport = await read("../../dev-lab/presentation/dev-lab-viewport.js");
  const persistence = await read("../../dev-lab/application/workspace-persistence-controller.js");
  assert.ok(shell.includes("createDevLabViewport"));
  assert.ok(shell.includes("createWorkspacePersistenceController"));
  assert.equal(shell.includes('from "../presentation/dev-world-preview.js"'), false);
  assert.equal(shell.includes("DEV_LAB_SAVE_SLOT"), false);
  assert.equal(shell.includes("async function persistWorkspace"), false);
  assert.ok(viewport.includes("export function createDevLabViewport"));
  assert.ok(viewport.includes("setWorldMarkers"));
  assert.ok(viewport.includes("resetCameraToWorld"));
  assert.equal(viewport.includes('document.querySelector("#world-canvas")'), false);
  assert.ok(persistence.includes("export function createWorkspacePersistenceController"));
  assert.ok(persistence.includes('stateId: "cassandra-dev-lab-workspace"'));
});


test("Dev Lab shell delegates definition catalog behavior to its controller", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const catalog = await read("../../dev-lab/application/definition-catalog-controller.js");
  const navigation = await read("../../dev-lab/application/view-navigation-controller.js");
  assert.ok(shell.includes("createDefinitionCatalogController"));
  assert.ok(shell.includes("definitionCatalog.refresh()"));
  assert.ok(shell.includes("createDevLabViewNavigationController"));
  assert.equal(shell.includes("function renderDatabase"), false);
  assert.equal(shell.includes("function inspectDefinition"), false);
  assert.equal(shell.includes("loadDefinitionDetail"), true);
  assert.ok(catalog.includes("export function createDefinitionCatalogController"));
  assert.ok(catalog.includes("listDefinitionIndex"));
  assert.ok(catalog.includes("getCategories"));
  assert.ok(catalog.includes("loadDefinitionDetail"));
  assert.ok(catalog.includes("onSelectDefinition"));
  assert.ok(navigation.includes('definitionCatalog.open("browse")'));
  assert.ok(navigation.includes('definitionCatalog.open("viewport")'));
  assert.ok(navigation.includes("definitionCatalog.close()"));
});


test("Dev Lab navigation behavior is owned by its application controller", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const navigation = await read("../../dev-lab/application/view-navigation-controller.js");
  assert.ok(shell.includes("createDevLabViewNavigationController"));
  assert.ok(shell.includes("navigation.showView"));
  assert.ok(shell.includes("navigation.closeViewportDatabase"));
  assert.equal(shell.includes("function showView"), false);
  assert.equal(shell.includes("function openDatabase"), false);
  assert.equal(shell.includes("function openViewportDatabase"), false);
  assert.equal(shell.includes("function closeViewportDatabase"), false);
  assert.equal(shell.includes("state.settingsReturnView"), false);
  assert.equal(shell.includes("state.viewportDatabaseOpen"), false);
  assert.ok(navigation.includes("export function createDevLabViewNavigationController"));
  assert.equal(navigation.includes("/cassandra/"), false);
  assert.equal(navigation.includes("/src/gameplay/"), false);
});


test("Dev Lab pause menu behavior is owned by its application controller", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const navigation = await read("../../dev-lab/application/view-navigation-controller.js");
  const pauseMenu = await read("../../dev-lab/application/pause-menu-controller.js");
  assert.ok(shell.includes("createDevLabPauseMenuController"));
  assert.ok(shell.includes("pauseMenuController.isOpen()"));
  assert.ok(shell.includes("pauseMenuController.open()"));
  assert.equal(shell.includes("state.pauseMenuOpen"), false);
  assert.equal(shell.includes("function openPauseMenu"), false);
  assert.equal(shell.includes("function closePauseMenu"), false);
  assert.equal(navigation.includes("pauseSettingsButton"), false);
  assert.equal(navigation.includes("pauseMainMenuButton"), false);
  assert.ok(pauseMenu.includes("export function createDevLabPauseMenuController"));
  assert.ok(pauseMenu.includes("navigation.openSettings(\"dev-lab\")"));
  assert.ok(pauseMenu.includes('navigation.showView("menu")'));
  assert.equal(pauseMenu.includes("/cassandra/"), false);
  assert.equal(pauseMenu.includes("/src/gameplay/"), false);
});


test("Dev Lab workspace session transitions are owned by the session controller", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const session = await read("../../dev-lab/application/workspace-session-controller.js");
  assert.ok(shell.includes("createDevLabWorkspaceSessionController"));
  assert.ok(shell.includes("workspaceSession.changeWorld()"));
  assert.ok(shell.includes("workspaceSession.reset()"));
  assert.ok(shell.includes("workspaceSession.synchronizeRestoredWorkspace"));
  assert.equal(shell.includes("function synchronizeRestoredWorkspace"), false);
  assert.ok(session.includes("export function createDevLabWorkspaceSessionController"));
  assert.ok(session.includes("worldRegistry.activateWorld"));
  assert.ok(session.includes("confirmReset"));
  assert.ok(session.includes("clearHeldInputAndPause"));
  assert.ok(session.includes("synchronizeRestoredWorkspace"));
  assert.equal(session.includes("/cassandra/"), false);
  assert.equal(session.includes("/src/gameplay/"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Cassandra owns its runtime host and no longer starts the Dev Lab application", async () => {
  const shell = await read("../../cassandra/application/cassandra-application-shell.js");
  const host = await read("../../cassandra/application/cassandra-runtime-host.js");
  assert.ok(shell.includes("createCassandraRuntimeHost"));
  assert.ok(shell.includes("runtimeHost.start()"));
  assert.equal(shell.includes("startDevLab"), false);
  assert.equal(shell.includes('from "../../dev-lab/application/application-shell.js"'), false);
  assert.ok(host.includes("createApplicationRuntimeHost"));
  assert.ok(host.includes("createCassandraRuntime"));
  assert.ok(host.includes("resolveCassandraRuntimeServices"));
  assert.ok(host.includes("runtime.advance") === false);
});

test("Cassandra runtime host preserves Cassandra gameplay system composition", async () => {
  const host = await read("../../cassandra/application/cassandra-runtime-host.js");
  assert.ok(host.includes("createInputSystem"));
  assert.ok(host.includes("createUnitSystem"));
  assert.ok(host.includes("createColonyControlSystem"));
  assert.ok(host.includes("createCassandraDevLabGameplayController"));
  assert.ok(host.includes("createCassandraDevLabUnitInspectorUi"));
  assert.ok(host.includes("fixedStepSeconds: 1 / 60"));
  assert.ok(host.includes("maxStepsPerFrame: 120"));
});

test("Cassandra app shell owns runtime presentation and does not import the Dev Lab shell", async () => {
  const shell = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(shell.includes("createDevLabViewport"));
  assert.ok(shell.includes("createDefinitionCatalogController"));
  assert.ok(shell.includes("createDevLabViewNavigationController"));
  assert.ok(shell.includes("createDevLabPauseMenuController"));
  assert.ok(shell.includes("createWorkspacePersistenceController"));
  assert.equal(shell.includes("startDevLab"), false);
  assert.equal(shell.includes("createDevLabRuntime"), false);
});
