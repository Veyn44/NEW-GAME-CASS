import { createWorldViewport } from "../../shared/presentation/world-viewport.js";
import { createDevLabRuntime } from "./create-dev-lab-runtime.js";
import { LocalFileSaveAdapter } from "../../src/adapters/storage/local-file-save-adapter.js";
import { createFilePersistenceController } from "../../shared/application/file-persistence-controller.js";
import { createDefinitionCatalogController } from "../../shared/application/definition-catalog-controller.js";
import { createViewNavigationController } from "../../shared/application/view-navigation-controller.js";
import { createPauseMenuController } from "../../shared/application/pause-menu-controller.js";
import { createDevLabWorkspaceSessionController } from "./workspace-session-controller.js";
import { getDefinition, listDefinitionIndex, getCategories, loadDefinitionDetail } from "../../engine/database/definition-registry.js";
import { createViewportInputController } from "../../shared/input/viewport-input-controller.js";
import { createApplicationRuntimeHost } from "../../shared/application/runtime-host.js";
import { querySpatialCell } from "./spatial-inspector.js";

const views = [...document.querySelectorAll("[data-view]")];
const databaseView = document.querySelector('[data-view="database"]');
const databaseHome = document.createComment("database-home");
databaseView.before(databaseHome);
const viewportDatabaseButton = document.querySelector("#open-viewport-database");
const databaseBackButton = databaseView.querySelector("[data-back-menu]");
const databaseSelectButton = databaseView.querySelector("#database-select-definition");
const databaseModeLabel = document.querySelector("#database-mode-label");
const simulationStatus = document.querySelector("#simulation-status");
const spatialCellLabel = document.querySelector("#spatial-cell-label");
const spatialCellData = document.querySelector("#spatial-cell-data");
const pointerStatus = document.querySelector("#pointer-status");
const viewportPanel = document.querySelector(".viewport-panel");
const canvas = document.querySelector("#world-canvas");
const worldSizeSelect = document.querySelector("#world-size");
const gridVisible = document.querySelector("#grid-visible");
const resetLabButton = document.querySelector("#reset-lab");
const saveWorkspaceButton = document.querySelector("#pause-save");
const saveWorkspaceAsButton = document.querySelector("#pause-save-as");
const loadWorkspaceButton = document.querySelector("#pause-load");
const workspaceFileInput = document.querySelector("#workspace-file-input");
const workspaceSaveStatus = document.querySelector("#workspace-save-status");
const pauseMenu = document.querySelector("#pause-menu");
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
const inputController = createViewportInputController();
const heldMovementKeys = new Set();

const state = {
  gameplayApi: null,
  spatialApi: null,
  spatialMovementApi: null,
  placementCoordinatorApi: null,
  entityRegistry: null,
  selectedSpatialCell: null,
  clock: null,
  worldRegistry: null,
  persistenceApi: null,
  saveAdapter: null,
  workspacePersistence: null,
  paused: true,
  gameplayUi: null,
  placementActive: false,
};

function beginWorldPlacement(definition) {
  if (!state.paused || !state.gameplayApi?.canPlaceDefinition(definition)
    || !state.worldRegistry) return;
  navigation.closeViewportDatabase();
  clearSelection();
  state.placementActive = true;
  viewportDatabaseButton.disabled = true;
  worldSizeSelect.disabled = true;
  canvas.focus({ preventScroll: true });
  viewport.setWorldPlacement({
    label: definition.name,
    artwork: definition.artwork,
    onPlace: (x, y) => {
      try {
        const unit = state.gameplayApi.createUnit({
          definitionId: definition.id,
          worldId: state.worldRegistry.activeWorldId,
          position: { x, y }
        });
        state.placementActive = false;
        viewportDatabaseButton.disabled = !state.paused;
        worldSizeSelect.disabled = !state.paused;
        viewport.setWorldPlacement(null);
        refreshWorldMarkers();
        inspectGameplayEntity(unit.id);
        return true;
      } catch (error) {
        simulationStatus.textContent = `PLACEMENT REJECTED · ${error.message}`;
        return false;
      }
    }
  });
  simulationStatus.textContent = `PLACING · ${definition.name} · CLICK A TILE · ESC TO CANCEL`;
}

function cancelPlacement() {
  if (!state.placementActive) return;
  state.placementActive = false;
  viewportDatabaseButton.disabled = !state.paused;
  worldSizeSelect.disabled = !state.paused;
  viewport.cancelWorldPlacement();
  simulationStatus.textContent = "PAUSED · PLACEMENT CANCELLED";
}

const navigation = createViewNavigationController({
  workspaceView: "dev-lab",
  catalogLabels: { browse: "ENGINE / CONTENT CATALOG", viewport: "ENGINE / DEV LAB" },
  elements: {
    views: [...document.querySelectorAll("[data-view]")],
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
    if (!pauseMenuController?.isOpen()) {
      if (!state.paused) {
        inputController.pause();
        state.clock?.pause("player");
        state.paused = true;
      }
      inputController.clearForFocusLoss();
      if (state.clock && !state.clock.hasPauseReason("player")) state.clock.pause("player");
    }
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
function refreshWorldMarkers() {
  const units = state.gameplayApi?.listUnits() ?? [];
  const activeWorldId = state.worldRegistry?.activeWorldId;
  viewport.setWorldMarkers(units
    .filter((unit) => unit.placement?.type === "world"
      && unit.placement.worldId === activeWorldId)
    .map((unit) => ({
      id: unit.id,
      x: unit.placement.position.x,
      y: unit.placement.position.y,
      label: getDefinition(unit.definitionId)?.name ?? unit.definitionId
    })));
}

function clearSelection() {
  state.gameplayUi?.clearSelection();
  viewport.setSelectedWorldMarker(null);
}

function inspectGameplayEntity(entityId) {
  const unit = state.gameplayUi?.inspectUnit(entityId) ?? null;
  if (!unit) {
    viewport.setSelectedWorldMarker(null);
    return null;
  }
  viewport.setSelectedWorldMarker(unit.id);
  return unit;
}

function inspectSpatialCell(cell) {
  const worldId = state.worldRegistry?.activeWorldId;
  if (!state.spatialApi || !worldId || !cell) return null;
  try {
    const inspection = querySpatialCell(state.spatialApi, worldId, cell);
    state.selectedSpatialCell = inspection.cell;
    spatialCellLabel.textContent = `${worldId} · (${inspection.cell.x}, ${inspection.cell.y})`;
    spatialCellData.textContent = JSON.stringify({
      contents: inspection.contents,
      entities: inspection.entities
    }, null, 2);
    return inspection;
  } catch (error) {
    spatialCellLabel.textContent = `${worldId} · (${cell.x}, ${cell.y})`;
    spatialCellData.textContent = `QUERY ERROR · ${error.code ?? error.message}`;
    return null;
  }
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
  gridVisible.disabled = false;
  viewportDatabaseButton.disabled = !state.paused || state.placementActive;
  resetLabButton.disabled = !state.worldRegistry;
  pointerStatus.textContent = state.paused ? "INSPECTION CURSOR" : (state.gameplayApi?.getControlModeLabel() ?? "FREE CAMERA");
  viewport.setWorldInteraction({
    paused: state.paused,
    inspectionEnabled: true,
    onSelect: inspectGameplayEntity,
    onInspectCell: inspectSpatialCell
  });
  if (controlState?.drafted && controlState.leaderId) {
    inspectGameplayEntity(controlState.leaderId);
  } else if (state.gameplayUi?.getSelectedUnitId()) {
    inspectGameplayEntity(state.gameplayUi.getSelectedUnitId());
  }
}

const workspaceSession = createDevLabWorkspaceSessionController({
  elements: { worldSizeSelect, worldStatus: document.querySelector("#world-status") },
  worldRegistry: {
    get activeWorldId() { return state.worldRegistry?.activeWorldId; },
    activateWorld: (worldId) => state.worldRegistry?.activateWorld(worldId),
    get: (worldId) => state.worldRegistry?.get(worldId)
  },
  gameplayApi: {
    getControlState: () => state.gameplayApi?.getControlState() ?? {},
    getUnit: (id) => state.gameplayApi?.getUnit(id),
    setDrafted: (drafted) => state.gameplayApi?.setDrafted(drafted),
    listUnits: () => state.gameplayApi?.listUnits() ?? [],
    removeUnit: (id) => state.gameplayApi?.removeUnit(id),
    setLeader: (id) => state.gameplayApi?.setLeader(id)
  },
  clock: { pause: (reason) => state.clock?.pause(reason) },
  inputController, heldMovementKeys, viewport,
  isPaused: () => state.paused,
  setPaused: (paused) => { state.paused = paused; },
  clearSelection, refreshWorldMarkers, updateSimulationUi, cancelPlacement,
  closeViewportDatabase: () => navigation.closeViewportDatabase(),
  closeUnitProfile: () => state.gameplayUi?.closeProfile(),
  clearSaveSelection: () => state.workspacePersistence?.clearSelection(),
  confirmReset: () => window.confirm(
    "Reset Dev Lab? All current workspace entities and unsaved session state will be cleared. Saved .cass files will not be deleted."
  ),
  onResetStatus() {
    workspaceSaveStatus.textContent = "LAB RESET · NO SAVE SELECTED";
    simulationStatus.textContent = "EMPTY LAB · PAUSED";
  },
  focusCanvas: () => canvas.focus({ preventScroll: true })
});

function toggleSimulationPause() {
  if (!state.clock) return;
  if (state.paused) runtimeHost.resume("player");
  else runtimeHost.pause("player");
}

function applyFreeCameraInput(deltaSeconds) {
  let x = Number(heldMovementKeys.has("KeyD")) - Number(heldMovementKeys.has("KeyA"));
  let y = Number(heldMovementKeys.has("KeyS")) - Number(heldMovementKeys.has("KeyW"));
  if (!x && !y) return;
  const length = Math.hypot(x, y);
  const speed = 30;
  viewport.moveCameraBy((x / length) * speed * deltaSeconds, (y / length) * speed * deltaSeconds);
}

function updatePausedFreeCamera(deltaSeconds) {
  if (pauseMenuController.isOpen() || state.gameplayApi?.getControlState().drafted || !heldMovementKeys.size) return;
  applyFreeCameraInput(deltaSeconds);
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
  if (isTextEntryTarget(event.target)) return;
  if (pauseMenuController.isOpen()) return;
  if (/^Key[WASD]$/.test(event.code)) {
    heldMovementKeys.add(event.code);
    inputController.keyDown(event.code);
    event.preventDefault();
    if (state.paused) {
      event.preventDefault();
      return;
    }
  }
  if (isInteractiveTarget(event.target)) return;
  if (pauseMenuController.isOpen()) return;
  if (event.code === "Space" && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    toggleSimulationPause();
    return;
  }
  const gameplayAction = state.gameplayApi?.handleKeyDown(event);
  if (gameplayAction) {
    event.preventDefault();
    const { controlState, leader } = gameplayAction;
    if (controlState.drafted && controlState.leaderId) {
      inspectGameplayEntity(controlState.leaderId);
      if (leader?.placement?.type === "world"
        && leader.placement.worldId === state.worldRegistry?.activeWorldId) {
        viewport.setCameraFollowTarget(leader.id, leader.placement.position);
      }
    } else {
      clearSelection();
    }
    updateSimulationUi();
    return;
  }
  if (!state.paused && !/^Key[WASD]$/.test(event.code)) {
    inputController.keyDown(event.code);
    if (/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right))$/.test(event.code)) event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  heldMovementKeys.delete(event.code);
  inputController.keyUp(event.code);
});

canvas.addEventListener("pointerdown", (event) => {
  if (document.body.dataset.currentView !== "dev-lab" || ![0, 2].includes(event.button)) return;
  inputController.pointerDown(event.button);

}, true);

window.addEventListener("pointerup", (event) => {
  inputController.pointerUp(event.button);
});

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


worldSizeSelect.addEventListener("change", () => workspaceSession.changeWorld());
resetLabButton.addEventListener("click", () => workspaceSession.reset());

saveWorkspaceButton.addEventListener("click", () => state.workspacePersistence?.save());
saveWorkspaceAsButton.addEventListener("click", () => state.workspacePersistence?.saveAs());
loadWorkspaceButton.addEventListener("click", () => state.workspacePersistence?.load());
workspaceFileInput.addEventListener("change", async () => {
  const file = workspaceFileInput.files?.[0];
  workspaceFileInput.value = "";
  if (file) await state.workspacePersistence?.importFile(file);
});

function resolveDevLabRuntimeServices(context) {
  return {
    worldRegistry: context.getService("core.world-registry"),
    spatialApi: context.getService("core.spatial-composition"),
    spatialMovementApi: context.getService("core.spatial-movement"),
    placementCoordinatorApi: context.getService("core.placement-coordinator"),
    entityRegistry: context.getService("core.entity-registry"),
    persistenceApi: context.getService("core.persistence"),
    clock: context.getService("core.game-clock"),
    unitApi: null,
    inputApi: null,
    colonyControlApi: null
  };
}

let runtimeHost = null;
function createDevLabRuntimeHost({
  createRuntime = createDevLabRuntime,
  resolveRuntimeServices = resolveDevLabRuntimeServices
} = {}) {
  return createApplicationRuntimeHost({
  createRuntime: (options) => createRuntime({ ...options, saveAdapter: state.saveAdapter }),
  resolveRuntimeServices,
  runtimeOptions: {
    inputController,
    onUnitMoved(moved) {
      refreshWorldMarkers();
      viewport.setCameraFollowTarget(moved.entityId, moved.position);
    },
    updateFreeCamera: applyFreeCameraInput
  },
  requestFrame: requestAnimationFrame,
  cancelFrame: cancelAnimationFrame,
  shouldAdvance: () => !pauseMenuController.isOpen(),
  onReady({ services }) {
    if (!services?.worldRegistry || !services?.persistenceApi || !services?.clock) {
      throw new TypeError("Dev Lab runtime services must provide worldRegistry, persistenceApi and clock.");
    }
    const worlds = services.worldRegistry;
    for (const size of [64, 128, 256]) {
      worlds.registerWorld({
        worldId: `dev-lab-world-${size}`,
        type: "dev-lab-test",
        dimensions: { width: size, height: size },
        grid: { width: size, height: size },
        coordinateSystem: "tiles"
      });
    }
    worlds.activateWorld(`dev-lab-world-${Number(worldSizeSelect.value)}`);
    state.worldRegistry = worlds;
    state.spatialApi = services.spatialApi ?? null;
    state.spatialMovementApi = services.spatialMovementApi ?? null;
    state.placementCoordinatorApi = services.placementCoordinatorApi ?? null;
    state.entityRegistry = services.entityRegistry ?? null;
    state.persistenceApi = services.persistenceApi;
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
      fileInput: workspaceFileInput,
      onRestore: workspaceSession.synchronizeRestoredWorkspace,
      onStatus({ saveStatus, simulationStatus: nextSimulationStatus }) {
        workspaceSaveStatus.textContent = saveStatus;
        simulationStatus.textContent = nextSimulationStatus;
      }
    });
    state.gameplayApi = services.gameplayApi ?? null;
    state.gameplayUi = services.gameplayUi ?? null;
    viewport.setWorldMarkers([]);
    clearSelection();
    state.clock = services.clock;
    state.clock.pause("player");
    state.paused = true;
    if (state.spatialApi) inspectSpatialCell({ x: 0, y: 0 });
    else {
      spatialCellLabel.textContent = "SPATIAL API UNAVAILABLE";
      spatialCellData.textContent = "This runtime does not expose Engine Spatial Composition.";
    }
    updateSimulationUi();
    workspaceSaveStatus.textContent = state.workspacePersistence.initialStatus;
  },
  onFrame(deltaSeconds, { paused }) {
    if (paused) updatePausedFreeCamera(deltaSeconds);
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
}

/**
 * Starts the Dev Lab with an optional content-package provider.
 * Dev Lab owns the workspace; the selected application composition root
 * decides which content packages (if any) are registered before startup.
 */
export async function startDevLab({
  loadContentPackage = async () => [],
  createRuntime = createDevLabRuntime,
  resolveRuntimeServices = resolveDevLabRuntimeServices
} = {}) {
  await loadContentPackage();
  definitionCatalog.refresh();
  state.saveAdapter = new LocalFileSaveAdapter();
  runtimeHost = createDevLabRuntimeHost({ createRuntime, resolveRuntimeServices });
  try {
    await runtimeHost.start();
  } catch (error) {
    simulationStatus.textContent = `DEV LAB STARTUP FAILED · ${error.message}`;
  }
  navigation.showView("menu");
}
