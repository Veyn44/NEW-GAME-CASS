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

test("Cassandra runtime host owns game systems and application lifecycle", async () => {
  const source = await read("../../cassandra/application/cassandra-runtime-host.js");
  const shell = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(source.includes("createUnitSystem"));
  assert.ok(source.includes("createColonyControlSystem"));
  assert.ok(source.includes("createInputSystem"));
  assert.ok(source.includes("export function createCassandraRuntime"));
  assert.ok(source.includes("export function resolveCassandraRuntimeServices"));
  assert.ok(source.includes("createApplicationRuntimeHost"));
  assert.ok(shell.includes("export async function startCassandraApplication"));
  assert.ok(shell.includes("createCassandraRuntimeHost"));
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
  assert.ok(entry.includes("../../cassandra/database/load-cassandra-database.js"));
  assert.equal(entry.includes("cassandra-application-shell"), false);
  assert.equal(entry.includes("cassandra-runtime-host"), false);
  assert.ok(html.includes("standalone-entry.js"));
  assert.ok(html.includes('accept=".dlcass,application/vnd.cassandra.dev-lab-save+json"'));
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

test("Cassandra runtime resolver exposes one gameplay adapter contract", async () => {
  const source = await read("../../cassandra/application/cassandra-runtime-host.js");
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
  const runtimeHost = await read("../../cassandra/application/cassandra-runtime-host.js");
  assert.ok(runtimeHost.includes("createCassandraDevLabUnitInspectorUi"));
  assert.ok(runtimeHost.includes("gameplayUi"));
  assert.ok(entry.includes("gameplayUi"));
  const ui = await read("../../cassandra/application/dev-lab-unit-inspector-ui.js");
  assert.ok(ui.includes('data-role="quick-select"'));
  assert.ok(ui.includes('data-role="unit-profile"'));
  assert.ok(ui.includes("getSelectedUnitId"));
  assert.ok(ui.includes("isProfileOpen"));
});


test("Dev Lab shell delegates viewport and workspace persistence to owned services", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const viewport = await read("../../shared/presentation/world-viewport.js");
  const persistence = await read("../../shared/application/file-persistence-controller.js");
  assert.ok(shell.includes("createWorldViewport"));
  assert.ok(shell.includes("createFilePersistenceController"));
  assert.equal(shell.includes('from "../presentation/dev-world-preview.js"'), false);
  assert.ok(viewport.includes("export function createWorldViewport"));
  assert.ok(viewport.includes("setWorldMarkers"));
  assert.ok(viewport.includes("resetCameraToWorld"));
  assert.equal(viewport.includes('document.querySelector("#world-canvas")'), false);
  assert.ok(persistence.includes("export function createFilePersistenceController"));
  assert.ok(persistence.includes("persistenceApi.save(saveSlot"));
  assert.ok(shell.includes("DEV_LAB_SAVE_STATE_ID"));
  assert.ok(shell.includes("DEV_LAB_SAVE_SLOT"));
  assert.ok(shell.includes("DEV_LAB_SAVE_FORMAT"));
  assert.ok(shell.includes("DEV_LAB_SAVE_FILE_EXTENSION"));
  assert.ok(shell.includes("DEV_LAB_SAVE_FILE_NAME"));
  assert.ok(shell.includes("DEV_LAB_SAVE_MIME_TYPE"));
  assert.ok(shell.includes("Name this Dev Lab workspace:"));
  assert.equal(shell.includes("async function persistWorkspace"), false);

  const cassandraShell = await read("../../cassandra/application/cassandra-application-shell.js");
  assert.ok(cassandraShell.includes("CASSANDRA_SAVE_SLOT"));
  assert.ok(cassandraShell.includes("CASSANDRA_SAVE_STATE_ID"));
  assert.ok(cassandraShell.includes("CASSANDRA_SAVE_FILE_EXTENSION"));
  assert.ok(cassandraShell.includes("CASSANDRA_SAVE_FILE_NAME"));

  const saveAdapter = await read("../../src/adapters/storage/local-file-save-adapter.js");
  for (const identity of [
    'CASSANDRA_SAVE_FORMAT = "cassandra.save"',
    'DEV_LAB_SAVE_FORMAT = "cassandra.dev-lab.save"',
    'CASSANDRA_SAVE_SLOT = "cassandra-main-world"',
    'DEV_LAB_SAVE_SLOT = "dev-lab-workspace"',
    'CASSANDRA_SAVE_STATE_ID = "cassandra-main-world"',
    'DEV_LAB_SAVE_STATE_ID = "cassandra-dev-lab-workspace"',
    'CASSANDRA_SAVE_FILE_EXTENSION = ".cass"',
    'DEV_LAB_SAVE_FILE_EXTENSION = ".dlcass"'
  ]) assert.ok(saveAdapter.includes(identity), `Missing save identity: ${identity}`);
});


test("Dev Lab shell delegates definition catalog behavior to its controller", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const catalog = await read("../../shared/application/definition-catalog-controller.js");
  const navigation = await read("../../shared/application/view-navigation-controller.js");
  assert.ok(shell.includes("createDefinitionCatalogController"));
  assert.ok(shell.includes("definitionCatalog.refresh()"));
  assert.ok(shell.includes("createViewNavigationController"));
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
  const navigation = await read("../../shared/application/view-navigation-controller.js");
  assert.ok(shell.includes("createViewNavigationController"));
  assert.ok(shell.includes("navigation.showView"));
  assert.ok(shell.includes("navigation.closeViewportDatabase"));
  assert.equal(shell.includes("function showView"), false);
  assert.equal(shell.includes("function openDatabase"), false);
  assert.equal(shell.includes("function openViewportDatabase"), false);
  assert.equal(shell.includes("function closeViewportDatabase"), false);
  assert.equal(shell.includes("state.settingsReturnView"), false);
  assert.equal(shell.includes("state.viewportDatabaseOpen"), false);
  assert.ok(navigation.includes("export function createViewNavigationController"));
  assert.equal(navigation.includes("/cassandra/"), false);
  assert.equal(navigation.includes("/src/gameplay/"), false);
});


test("Dev Lab pause menu behavior is owned by its application controller", async () => {
  const shell = await read("../../dev-lab/application/application-shell.js");
  const navigation = await read("../../shared/application/view-navigation-controller.js");
  const pauseMenu = await read("../../shared/application/pause-menu-controller.js");
  assert.ok(shell.includes("createPauseMenuController"));
  assert.ok(shell.includes("pauseMenuController.isOpen()"));
  assert.ok(shell.includes("pauseMenuController.open()"));
  assert.equal(shell.includes("state.pauseMenuOpen"), false);
  assert.equal(shell.includes("function openPauseMenu"), false);
  assert.equal(shell.includes("function closePauseMenu"), false);
  assert.equal(navigation.includes("pauseSettingsButton"), false);
  assert.equal(navigation.includes("pauseMainMenuButton"), false);
  assert.ok(pauseMenu.includes("export function createPauseMenuController"));
  assert.ok(pauseMenu.includes("navigation.openSettings(workspaceView)"));
  assert.ok(pauseMenu.includes("navigation.showView(menuView)"));
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
  assert.ok(shell.includes("createWorldViewport"));
  assert.ok(shell.includes("createDefinitionCatalogController"));
  assert.ok(shell.includes("createViewNavigationController"));
  assert.ok(shell.includes("createPauseMenuController"));
  assert.ok(shell.includes("createFilePersistenceController"));
  assert.equal(shell.includes("startDevLab"), false);
  assert.equal(shell.includes("createDevLabRuntime"), false);
  assert.equal(shell.includes("../../dev-lab/"), false);
});
test("shared presentation and application controllers do not depend on either application", async () => {
  const modules = [
    "../../shared/presentation/world-viewport.js",
    "../../shared/presentation/world-viewport-model.js",
    "../../shared/input/viewport-input-controller.js",
    "../../shared/application/definition-catalog-controller.js",
    "../../shared/application/view-navigation-controller.js",
    "../../shared/application/pause-menu-controller.js",
    "../../shared/application/file-persistence-controller.js"
  ];
  for (const path of modules) {
    const source = await read(path);
    assert.equal(source.includes("/dev-lab/"), false, path);
    assert.equal(source.includes("/cassandra/"), false, path);
  }
  const viewport = await read("../../shared/presentation/world-viewport.js");
  const persistence = await read("../../shared/application/file-persistence-controller.js");
  assert.equal(persistence.includes(".cass"), false);
  assert.equal(viewport.includes(".viewport-panel"), false);
  assert.equal(viewport.includes(".viewport-crosshair"), false);
});


test("unrequested spatial inspector and test-entity controls are absent from both application UIs", async () => {
  const cassandraHtml = await read("../../index.html");
  const devLabHtml = await read("../../dev-lab.html");
  const devLabShell = await read("../../dev-lab/application/application-shell.js");
  const forbiddenIds = [
    "spatial-cell-label", "spatial-cell-data", "test-entity-footprint",
    "create-spatial-test-entity", "move-spatial-test-entity", "remove-spatial-test-entity",
    "spatial-test-status", "spatial-neighbors-four", "spatial-neighbors-eight",
    "spatial-radius-manhattan", "spatial-radius-chebyshev", "spatial-footprint",
    "spatial-movement-history", "spatial-region-min-x", "spatial-region-min-y",
    "spatial-region-max-x", "spatial-region-max-y", "spatial-region-categories",
    "spatial-region-layers", "spatial-region-kinds", "spatial-region-query"
  ];
  for (const id of forbiddenIds) {
    assert.equal(devLabHtml.includes(`id="${id}"`), false, `Dev Lab must not expose #${id}`);
    assert.equal(cassandraHtml.includes(`id="${id}"`), false, `Cassandra must not expose #${id}`);
  }
  assert.equal(devLabHtml.includes('id="spatial-inspector"'), false);
  for (const forbidden of [
    "SpatialTestController", "spatial-inspector.js", "spatial-test-controller.js",
    "createSpatialTestEntity", "inspectSpatialCell", "updateSpatialTestControls",
    "querySelectedSpatial", "querySpatialMovementHistory", "setSpatialHighlights"
  ]) assert.equal(devLabShell.includes(forbidden), false, `Dev Lab shell must not include ${forbidden}`);
});

test("standalone Dev Lab registers the existing Cassandra content package without Cassandra gameplay runtime", async () => {
  const entry = await read("../../dev-lab/application/standalone-entry.js");
  const content = await read("../../cassandra/database/load-cassandra-database.js");
  const johny = await read("../../cassandra/database/definitions/pawns/johny.json");
  const shell = await read("../../dev-lab/application/application-shell.js");
  assert.ok(entry.includes("loadCassandraDatabase"));
  assert.ok(entry.includes("loadContentPackage: loadCassandraDatabase"));
  assert.ok(content.includes('id: "cassandra.base-content"'));
  assert.ok(johny.includes('"id": "pawn.johny"'));
  assert.ok(johny.includes('"name": "Johny"'));
  assert.equal(shell.includes("/cassandra/"), false);
  assert.equal(shell.includes("createUnitSystem"), false);
  assert.equal(shell.includes("createColonyControlSystem"), false);
});
