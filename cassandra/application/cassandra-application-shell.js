import { loadCassandraDatabase } from "../database/load-cassandra-database.js";
import { createCassandraRuntimeHost } from "./cassandra-runtime-host.js";
import { createWorldViewport } from "../../shared/presentation/world-viewport.js";
import { createViewportInputController } from "../../shared/input/viewport-input-controller.js";
import { LocalFileSaveAdapter } from "../../src/adapters/storage/local-file-save-adapter.js";
import { createFilePersistenceController } from "../../shared/application/file-persistence-controller.js";
import { createDefinitionCatalogController } from "../../shared/application/definition-catalog-controller.js";
import { createViewNavigationController } from "../../shared/application/view-navigation-controller.js";
import { createPauseMenuController } from "../../shared/application/pause-menu-controller.js";
import { getDefinition, listDefinitionIndex, getCategories, loadDefinitionDetail } from "../../engine/database/definition-registry.js";

const views = [...document.querySelectorAll("[data-view]")];
const databaseView = document.querySelector('[data-view="database"]');
const databaseHome = document.createComment("database-home");
databaseView.before(databaseHome);
const viewportDatabaseButton = document.querySelector("#open-viewport-database");
const databaseBackButton = databaseView.querySelector("[data-back-menu]");
const databaseSelectButton = document.querySelector("#database-select-definition");
const databaseModeLabel = document.querySelector("#database-mode-label");
const simulationStatus = document.querySelector("#simulation-status");
const pointerStatus = document.querySelector("#pointer-status");
const viewportPanel = document.querySelector(".viewport-panel");
const canvas = document.querySelector("#world-canvas");
const worldSizeSelect = document.querySelector("#world-size");
const gridVisible = document.querySelector("#grid-visible");
const resetLabButton = document.querySelector("#reset-lab");
const saveButton = document.querySelector("#pause-save");
const saveAsButton = document.querySelector("#pause-save-as");
const loadButton = document.querySelector("#pause-load");
const fileInput = document.querySelector("#workspace-file-input");
const saveStatus = document.querySelector("#workspace-save-status");
const pauseMenu = document.querySelector("#pause-menu");
const inputController = createViewportInputController();
const heldMovementKeys = new Set();
const viewport = createWorldViewport({
  canvas,
  sizeSelect: worldSizeSelect,
  gridToggle: gridVisible,
  zoomValue: document.querySelector("#zoom-value"),
  worldStatus: document.querySelector("#world-status"),
  viewStatus: document.querySelector("#view-status"),
  pointerOverlay: viewportPanel,
  pointerCrosshair: document.querySelector(".viewport-crosshair")
});

const state = {
  gameplayApi: null,
  gameplayUi: null,
  clock: null,
  worldRegistry: null,
  worldSessionApi: null,
  persistenceApi: null,
  saveAdapter: null,
  workspacePersistence: null,
  paused: true,
  placementActive: false
};

function clearSelection() {
  state.gameplayUi?.clearSelection();
  viewport.setSelectedWorldMarker(null);
}

function refreshWorldMarkers() {
  const activeWorldId = state.worldRegistry?.activeWorldId;
  const units = state.gameplayApi?.listUnits() ?? [];
  viewport.setWorldMarkers(units
    .filter((unit) => unit.placement?.type === "world" && unit.placement.worldId === activeWorldId)
    .map((unit) => ({
      id: unit.id,
      x: unit.position.x,
      y: unit.position.y,
      label: getDefinition(unit.definitionId)?.name ?? unit.definitionId
    })));
}

function inspectGameplayEntity(entityId) {
  const unit = state.gameplayUi?.inspectUnit(entityId) ?? null;
  viewport.setSelectedWorldMarker(unit?.id ?? null);
  return unit;
}

function updateSimulationUi() {
  const controlState = state.gameplayApi?.getControlState();
  state.gameplayUi?.setPaused(state.paused);
  const controlLabel = state.gameplayApi?.getDraftStatusLabel() ?? "FREE CAMERA";
  simulationStatus.textContent = state.paused
    ? `PAUSED · ${controlLabel} · Space to resume`
    : `RUNNING · ${controlLabel} · Space to pause`;
  simulationStatus.dataset.state = state.paused ? "paused" : "running";
  viewportPanel.dataset.paused = String(state.paused);
  viewportPanel.dataset.inputMode = state.paused ? "paused" : "running";
  worldSizeSelect.disabled = !state.paused || state.placementActive;
  viewportDatabaseButton.disabled = !state.paused || state.placementActive;
  resetLabButton.disabled = !state.worldRegistry;
  pointerStatus.textContent = state.paused
    ? "INSPECTION CURSOR"
    : (state.gameplayApi?.getControlModeLabel() ?? "FREE CAMERA");
  viewport.setWorldInteraction({
    paused: state.paused,
    inspectionEnabled: true,
    onSelect: inspectGameplayEntity
  });
  if (controlState?.drafted && controlState.leaderId) inspectGameplayEntity(controlState.leaderId);
  else if (state.gameplayUi?.getSelectedUnitId()) inspectGameplayEntity(state.gameplayUi.getSelectedUnitId());
}

function cancelPlacement() {
  if (!state.placementActive) return;
  state.placementActive = false;
  viewport.cancelWorldPlacement();
  updateSimulationUi();
}

function beginWorldPlacement(definition) {
  if (!state.paused || !state.gameplayApi?.canPlaceDefinition(definition) || !state.worldRegistry) return;
  navigation.closeViewportDatabase();
  clearSelection();
  state.placementActive = true;
  updateSimulationUi();
  canvas.focus({ preventScroll: true });
  viewport.setWorldPlacement({
    label: definition.name,
    artwork: definition.artwork,
    onPlace(x, y) {
      try {
        const unit = state.gameplayApi.createUnit({
          definitionId: definition.id,
          worldId: state.worldRegistry.activeWorldId,
          position: { x, y }
        });
        state.placementActive = false;
        viewport.setWorldPlacement(null);
        refreshWorldMarkers();
        inspectGameplayEntity(unit.id);
        updateSimulationUi();
        return true;
      } catch (error) {
        simulationStatus.textContent = `PLACEMENT REJECTED · ${error.message}`;
        return false;
      }
    }
  });
  simulationStatus.textContent = `PLACING · ${definition.name} · CLICK A TILE · ESC TO CANCEL`;
}

const definitionCatalog = createDefinitionCatalogController({
  elements: {
    list: document.querySelector("#database-list"),
    search: document.querySelector("#database-search"),
    category: document.querySelector("#database-category"),
    inspector: document.querySelector("#database-inspector"),
    selectButton: databaseSelectButton
  },
  listDefinitionIndex,
  getCategories,
  loadDefinitionDetail,
  canSelectDefinition: (definition) => Boolean(state.gameplayApi?.canPlaceDefinition(definition)),
  onSelectDefinition: beginWorldPlacement
});

const navigation = createViewNavigationController({
  workspaceView: "dev-lab",
  catalogLabels: { browse: "ENGINE / CONTENT CATALOG", viewport: "ENGINE / DEV LAB" },
  elements: {
    views,
    navButtons: [...document.querySelectorAll("[data-navigate]")],
    databaseView,
    databaseHome,
    databaseModeLabel,
    databaseBackButton,
    viewportPanel,
    settingsBackButton: document.querySelector("#settings-back"),
    backMenuButtons: [...document.querySelectorAll("[data-back-menu]")],
    viewportDatabaseButton,
    body: document.body
  },
  definitionCatalog,
  canOpenViewportDatabase: () => state.paused && !state.placementActive,
  beforeLeaveWorkspace() {
    cancelPlacement();
    if (!pauseMenuController?.isOpen() && !state.paused) {
      inputController.pause();
      state.clock?.pause("player");
      state.paused = true;
    }
    inputController.clearForFocusLoss();
    if (state.clock && !state.clock.hasPauseReason?.("player")) state.clock.pause("player");
    updateSimulationUi();
  },
  onSettingsReturn(returnView) {
    if (returnView === "dev-lab") {
      pauseMenuController?.open();
      updateSimulationUi();
    }
  },
  scrollToTop: () => window.scrollTo(0, 0),
  dispatchResize: () => window.dispatchEvent(new Event("resize"))
});

let pauseMenuController;
pauseMenuController = createPauseMenuController({
  workspaceView: "dev-lab",
  elements: {
    menu: pauseMenu,
    resumeButton: document.querySelector("#pause-resume"),
    settingsButton: document.querySelector("#pause-settings"),
    mainMenuButton: document.querySelector("#pause-main-menu")
  },
  navigation,
  canOpen: () => document.body.dataset.currentView === "dev-lab",
  onOpen() {
    heldMovementKeys.clear();
    inputController.suspendForOverlay();
    state.gameplayUi?.closeProfile();
  },
  onClose() {
    if (!state.paused) inputController.resume();
    canvas.focus({ preventScroll: true });
  },
  onVisibilityChange: updateSimulationUi
});

function toggleSimulationPause() {
  if (!state.clock) return;
  if (state.paused) runtimeHost.resume("player");
  else runtimeHost.pause("player");
}

function applyFreeCameraInput(deltaSeconds) {
  const x = Number(heldMovementKeys.has("KeyD")) - Number(heldMovementKeys.has("KeyA"));
  const y = Number(heldMovementKeys.has("KeyS")) - Number(heldMovementKeys.has("KeyW"));
  if (!x && !y) return;
  const length = Math.hypot(x, y);
  viewport.moveCameraBy((x / length) * 30 * deltaSeconds, (y / length) * 30 * deltaSeconds);
}

function isTextEntryTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function isInteractiveTarget(target) {
  return isTextEntryTarget(target) || (target instanceof HTMLElement && target.tagName === "BUTTON");
}

window.addEventListener("keydown", (event) => {
  if (document.body.dataset.currentView !== "dev-lab") return;
  if (event.code === "Escape" && !event.repeat) {
    event.preventDefault();
    if (state.placementActive) { cancelPlacement(); return; }
    if (state.gameplayUi?.isProfileOpen()) { state.gameplayUi.closeProfile(); return; }
    if (navigation.isViewportDatabaseOpen()) { navigation.closeViewportDatabase(); return; }
    if (pauseMenuController.isOpen()) { pauseMenuController.close(); return; }
    pauseMenuController.open();
    return;
  }
  if (isTextEntryTarget(event.target) || pauseMenuController.isOpen()) return;
  if (/^Key[WASD]$/.test(event.code)) {
    heldMovementKeys.add(event.code);
    inputController.keyDown(event.code);
    event.preventDefault();
    if (state.paused) return;
  }
  if (isInteractiveTarget(event.target)) return;
  if (event.code === "Space" && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    toggleSimulationPause();
    return;
  }
  const action = state.gameplayApi?.handleKeyDown(event);
  if (action) {
    event.preventDefault();
    if (action.controlState.drafted && action.controlState.leaderId) {
      inspectGameplayEntity(action.controlState.leaderId);
      if (action.leader?.placement?.type === "world"
        && action.leader.placement.worldId === state.worldRegistry?.activeWorldId) {
        viewport.setCameraFollowTarget(action.leader.id, action.leader.position);
      }
    } else clearSelection();
    updateSimulationUi();
    return;
  }
  if (!state.paused) {
    inputController.keyDown(event.code);
    if (/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right))$/.test(event.code)) event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  heldMovementKeys.delete(event.code);
  inputController.keyUp(event.code);
});
canvas.addEventListener("pointerdown", (event) => {
  if (document.body.dataset.currentView === "dev-lab" && [0, 2].includes(event.button)) {
    inputController.pointerDown(event.button);
  }
}, true);
window.addEventListener("pointerup", (event) => inputController.pointerUp(event.button));
canvas.addEventListener("pointermove", (event) => {
  if (!state.paused) inputController.pointerMove(event.movementX || 0, event.movementY || 0);
});

function handleFocusLoss() {
  heldMovementKeys.clear();
  if (!state.paused && state.clock) {
    inputController.pause();
    state.clock.pause("player");
    state.paused = true;
  }
  inputController.clearForFocusLoss();
  updateSimulationUi();
}
window.addEventListener("blur", handleFocusLoss);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") handleFocusLoss();
});

worldSizeSelect.addEventListener("change", () => {
  if (!state.paused || !state.worldRegistry) return;
  const size = Number(worldSizeSelect.value);
  try {
    state.worldSessionApi.setMainWorldWorld(`cassandra-world-${size}`);
  } catch (error) {
    const session = state.worldSessionApi?.getState();
    const mainWorld = session?.mainWorldId ? state.worldRegistry.get(session.mainWorldId) : null;
    if (mainWorld) worldSizeSelect.value = String(mainWorld.dimensions.width);
    simulationStatus.textContent = `WORLD SWITCH REJECTED · ${error.code ?? error.message}`;
    return;
  }
  viewport.resetCameraToWorld(size);
  clearSelection();
  refreshWorldMarkers();
});
resetLabButton.addEventListener("click", () => {
  if (!state.gameplayApi || !window.confirm("Reset Cassandra workspace? All current units and unsaved session state will be cleared.")) return;
  for (const unit of state.gameplayApi.listUnits()) state.gameplayApi.removeUnit(unit.id);
  state.gameplayApi.setLeader(null);
  state.gameplayApi.setDrafted(false);
  cancelPlacement();
  clearSelection();
  refreshWorldMarkers();
  state.workspacePersistence?.clearSelection();
  saveStatus.textContent = "CASSANDRA RESET · NO SAVE SELECTED";
  updateSimulationUi();
});
saveButton.addEventListener("click", () => state.workspacePersistence?.save());
saveAsButton.addEventListener("click", () => state.workspacePersistence?.saveAs());
loadButton.addEventListener("click", () => state.workspacePersistence?.load());
fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) await state.workspacePersistence?.importFile(file);
});

let runtimeHost = null;

export async function startCassandraApplication() {
  await loadCassandraDatabase();
  definitionCatalog.refresh();
  state.saveAdapter = new LocalFileSaveAdapter();
  runtimeHost = createCassandraRuntimeHost({
    saveAdapter: state.saveAdapter,
    inputController,
    onUnitMoved(moved) {
      refreshWorldMarkers();
      viewport.setCameraFollowTarget(moved.entityId, moved.position);
    },
    updateFreeCamera: applyFreeCameraInput,
    shouldAdvance: () => !pauseMenuController.isOpen(),
    onReady({ services }) {
      if (!services?.worldRegistry || !services?.worldSessionApi || !services?.persistenceApi || !services?.clock || !services?.gameplayApi) {
        throw new TypeError("Cassandra runtime services are incomplete.");
      }
      const worlds = services.worldRegistry;
      for (const size of [64, 128, 256]) {
        worlds.registerWorld({
          worldId: `cassandra-world-${size}`,
          type: "cassandra-world",
          dimensions: { width: size, height: size },
          grid: { width: size, height: size },
          coordinateSystem: "tiles"
        });
      }
      worlds.activateWorld(`cassandra-world-${Number(worldSizeSelect.value)}`);
      services.worldSessionApi.registerMainWorld(worlds.activeWorldId);
      state.worldRegistry = worlds;
      state.worldSessionApi = services.worldSessionApi;
      state.persistenceApi = services.persistenceApi;
      state.gameplayApi = services.gameplayApi;
      state.gameplayUi = services.gameplayUi;
      state.workspacePersistence = createFilePersistenceController({
        persistenceApi: services.persistenceApi,
        saveSlot: "dev-lab-workspace",
        stateId: "cassandra-dev-lab-workspace",
        supportsFileAccess: () => LocalFileSaveAdapter.supportsFileAccess,
        requestFileName: ({ currentFileName, defaultFileName }) =>
          window.prompt("Name this Cassandra save:", currentFileName || defaultFileName),
        fileExtension: ".cass",
        defaultFileName: "save.cass",
        saveAdapter: state.saveAdapter,
        fileInput,
        onRestore() {
          state.worldSessionApi.resumeAfterRestore();
          refreshWorldMarkers();
          clearSelection();
          const session = state.worldSessionApi.getState();
          const mainWorld = worlds.get(session.mainWorldId);
          const activeWorld = worlds.get(worlds.activeWorldId);
          if (mainWorld) worldSizeSelect.value = String(mainWorld.dimensions.width);
          if (activeWorld) viewport.resetCameraToWorld(activeWorld.dimensions.width);
          updateSimulationUi();
        },
        onStatus({ saveStatus: nextSaveStatus, simulationStatus: nextStatus }) {
          saveStatus.textContent = nextSaveStatus;
          simulationStatus.textContent = nextStatus;
        }
      });
      viewport.setWorldMarkers([]);
      clearSelection();
      state.clock = services.clock;
      state.clock.pause("player");
      state.paused = true;
      updateSimulationUi();
      saveStatus.textContent = state.workspacePersistence.initialStatus;
    },
    onFrame(deltaSeconds, { paused }) {
      if (paused && !pauseMenuController.isOpen()) applyFreeCameraInput(deltaSeconds);
    },
    onPauseChange(paused) {
      state.paused = paused;
      if (paused) inputController.pause();
      else inputController.resume();
      updateSimulationUi();
    },
    onError(error) {
      simulationStatus.textContent = `SIMULATION ERROR · ${error.message}`;
      inputController.pause();
      inputController.clearForFocusLoss();
    }
  });
  try {
    await runtimeHost.start();
  } catch (error) {
    simulationStatus.textContent = `CASSANDRA STARTUP FAILED · ${error.message}`;
  }
  navigation.showView("menu");
}
