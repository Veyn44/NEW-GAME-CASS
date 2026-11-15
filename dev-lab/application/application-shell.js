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
import { querySpatialCell, querySpatialNeighbors, querySpatialRadius, querySpatialFootprint } from "./spatial-inspector.js";
import { SpatialTestController } from "./spatial-test-controller.js";

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
const testEntityFootprint = document.querySelector("#test-entity-footprint");
const createTestEntityButton = document.querySelector("#create-spatial-test-entity");
const moveTestEntityButton = document.querySelector("#move-spatial-test-entity");
const removeTestEntityButton = document.querySelector("#remove-spatial-test-entity");
const spatialTestStatus = document.querySelector("#spatial-test-status");
const spatialNeighborsFourButton = document.querySelector("#spatial-neighbors-four");
const spatialNeighborsEightButton = document.querySelector("#spatial-neighbors-eight");
const spatialRadiusManhattanButton = document.querySelector("#spatial-radius-manhattan");
const spatialRadiusChebyshevButton = document.querySelector("#spatial-radius-chebyshev");
const spatialFootprintButton = document.querySelector("#spatial-footprint");
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
  selectedSpatialEntityId: null,
  spatialTestController: null,
  selectedTestEntityId: null,
  moveTestEntityMode: false,
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
  const unitMarkers = units
    .filter((unit) => unit.placement?.type === "world"
      && unit.placement.worldId === activeWorldId)
    .map((unit) => ({
      id: unit.id,
      x: unit.position?.x ?? unit.placement.position.x,
      y: unit.position?.y ?? unit.placement.position.y,
      label: getDefinition(unit.definitionId)?.name ?? unit.definitionId
    }));
  const testMarkers = (state.spatialTestController?.list() ?? [])
    .filter(({ occupancy }) => occupancy.worldId === activeWorldId)
    .map(({ entity, occupancy }) => ({
      id: entity.id,
      x: occupancy.anchor.x + 0.5,
      y: occupancy.anchor.y + 0.5,
      cells: occupancy.cells,
      label: "TEST ENTITY"
    }));
  viewport.setWorldMarkers([...unitMarkers, ...testMarkers]);
}

function clearSelection() {
  state.gameplayUi?.clearSelection();
  state.selectedSpatialEntityId = null;
  state.selectedTestEntityId = null;
  state.moveTestEntityMode = false;
  viewport.setSelectedWorldMarker(null);
  updateSpatialTestControls();
}

function inspectGameplayEntity(entityId) {
  const unit = state.gameplayUi?.inspectUnit(entityId) ?? null;
  if (!unit) {
    viewport.setSelectedWorldMarker(null);
    return null;
  }
  state.selectedSpatialEntityId = unit.id;
  viewport.setSelectedWorldMarker(unit.id);
  updateSpatialTestControls();
  return unit;
}

function handleViewportEntitySelect(entityId) {
  if (state.moveTestEntityMode) return;
  if (!entityId) {
    if (state.moveTestEntityMode) return;
    state.selectedTestEntityId = null;
    updateSpatialTestControls();
    inspectGameplayEntity(null);
    return;
  }
  const testEntity = state.spatialTestController?.list().find(({ entity }) => entity.id === entityId);
  if (testEntity) {
    state.selectedSpatialEntityId = entityId;
    state.selectedTestEntityId = entityId;
    viewport.setSelectedWorldMarker(entityId);
    updateSpatialTestControls();
    inspectSpatialCell(testEntity.occupancy.anchor);
    return;
  }
  state.selectedSpatialEntityId = entityId;
  state.selectedTestEntityId = null;
  updateSpatialTestControls();
  inspectGameplayEntity(entityId);
}

function updateSpatialTestControls() {
  const hasController = Boolean(state.spatialTestController);
  const hasSelection = Boolean(state.selectedTestEntityId
    && state.spatialTestController?.list().some(({ entity }) => entity.id === state.selectedTestEntityId));
  createTestEntityButton.disabled = !hasController || !state.paused || state.placementActive;
  moveTestEntityButton.disabled = !hasSelection || !state.paused;
  removeTestEntityButton.disabled = !hasSelection || !state.paused;
  moveTestEntityButton.textContent = state.moveTestEntityMode ? "CANCEL MOVE" : "MOVE SELECTED";
  moveTestEntityButton.dataset.active = String(state.moveTestEntityMode);
  testEntityFootprint.disabled = !state.paused;
  spatialNeighborsFourButton.disabled = !state.paused || !state.selectedSpatialCell;
  spatialNeighborsEightButton.disabled = !state.paused || !state.selectedSpatialCell;
  spatialRadiusManhattanButton.disabled = !state.paused || !state.selectedSpatialCell;
  spatialRadiusChebyshevButton.disabled = !state.paused || !state.selectedSpatialCell;
  spatialFootprintButton.disabled = !state.paused || !state.selectedSpatialEntityId;
}

function showSpatialQuery(label, result) {
  spatialCellLabel.textContent = label;
  spatialCellData.textContent = JSON.stringify(result, null, 2);
}

function querySelectedSpatialNeighbors(topology) {
  const worldId = state.worldRegistry?.activeWorldId;
  const cell = state.selectedSpatialCell;
  if (!state.paused || !state.spatialApi || !worldId || !cell) return;
  try {
    const result = querySpatialNeighbors(state.spatialApi, worldId, cell, topology);
    showSpatialQuery(`${topology.toUpperCase()} NEIGHBORS · ${worldId} · (${cell.x}, ${cell.y})`, result);
  } catch (error) {
    showSpatialQuery("NEIGHBOR QUERY ERROR", { code: error.code ?? null, message: error.message });
  }
}

function querySelectedSpatialRadius(metric) {
  const worldId = state.worldRegistry?.activeWorldId;
  const cell = state.selectedSpatialCell;
  if (!state.paused || !state.spatialApi || !worldId || !cell) return;
  try {
    const result = querySpatialRadius(state.spatialApi, worldId, cell, 2, metric);
    showSpatialQuery(`RADIUS 2 · ${metric.toUpperCase()} · ${worldId}`, result);
  } catch (error) {
    showSpatialQuery("RADIUS QUERY ERROR", { code: error.code ?? null, message: error.message });
  }
}

function querySelectedSpatialFootprint() {
  const entityId = state.selectedSpatialEntityId;
  if (!state.paused || !state.spatialApi || !entityId) return;
  try {
    const result = querySpatialFootprint(state.spatialApi, entityId);
    showSpatialQuery(`ENTITY FOOTPRINT · ${entityId}`, result);
  } catch (error) {
    showSpatialQuery("FOOTPRINT QUERY ERROR", { code: error.code ?? null, message: error.message });
  }
}

function createSpatialTestEntity() {
  if (!state.paused || !state.spatialTestController || !state.worldRegistry) return;
  const world = state.worldRegistry.get(state.worldRegistry.activeWorldId);
  const footprint = testEntityFootprint.value === "square-2"
    ? [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
    : [{ x: 0, y: 0 }];
  const anchor = state.selectedSpatialCell ?? {
    x: Math.floor(world.grid.width / 2),
    y: Math.floor(world.grid.height / 2)
  };
  try {
    const created = state.spatialTestController.create({ anchor, footprint });
    state.selectedTestEntityId = created.entity.id;
    state.moveTestEntityMode = false;
    refreshWorldMarkers();
    viewport.setSelectedWorldMarker(created.entity.id);
    inspectSpatialCell(anchor);
    spatialTestStatus.textContent = `CREATED · ${created.entity.id} · ${created.occupancy.cells.length} CELLS`;
    updateSpatialTestControls();
  } catch (error) {
    spatialTestStatus.textContent = `CREATE REJECTED · ${error.code ?? error.message}`;
  }
}

function toggleSpatialTestMoveMode() {
  if (!state.paused || !state.selectedTestEntityId) return;
  state.moveTestEntityMode = !state.moveTestEntityMode;
  spatialTestStatus.textContent = state.moveTestEntityMode
    ? "MOVE MODE · CLICK A TARGET GRID CELL"
    : "MOVE MODE CANCELLED";
  updateSpatialTestControls();
}

function removeSelectedSpatialTestEntity() {
  if (!state.paused || !state.selectedTestEntityId || !state.spatialTestController) return;
  const removedId = state.selectedTestEntityId;
  try {
    state.spatialTestController.remove(removedId);
    state.selectedTestEntityId = null;
    state.selectedSpatialEntityId = null;
    state.moveTestEntityMode = false;
    viewport.setSelectedWorldMarker(null);
    refreshWorldMarkers();
    spatialTestStatus.textContent = `RETIRED · ${removedId}`;
    updateSpatialTestControls();
    if (state.selectedSpatialCell) inspectSpatialCell(state.selectedSpatialCell);
  } catch (error) {
    spatialTestStatus.textContent = `REMOVE FAILED · ${error.code ?? error.message}`;
  }
}

function inspectSpatialCell(cell) {
  const worldId = state.worldRegistry?.activeWorldId;
  if (!state.spatialApi || !worldId || !cell) return null;
  if (state.moveTestEntityMode && state.selectedTestEntityId) {
    const result = state.spatialTestController.move(state.selectedTestEntityId, {
      worldId,
      anchor: cell
    });
    if (result.status === "moved" || result.status === "unchanged") {
      refreshWorldMarkers();
      viewport.setSelectedWorldMarker(state.selectedTestEntityId);
      spatialTestStatus.textContent = result.status === "moved"
        ? `MOVED · ${state.selectedTestEntityId} → (${cell.x}, ${cell.y})`
        : "ENTITY ALREADY AT TARGET";
    } else {
      spatialTestStatus.textContent = `MOVE ${result.status.toUpperCase()} · ${result.code}`;
    }
    updateSpatialTestControls();
  }
  try {
    const inspection = querySpatialCell(state.spatialApi, worldId, cell);
    state.selectedSpatialCell = inspection.cell;
    spatialCellLabel.textContent = `${worldId} · (${inspection.cell.x}, ${inspection.cell.y})`;
    spatialCellData.textContent = JSON.stringify({
      contents: inspection.contents,
      entities: inspection.entities
    }, null, 2);
    updateSpatialTestControls();
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
    onSelect: handleViewportEntitySelect,
    onInspectCell: inspectSpatialCell
  });
  updateSpatialTestControls();
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
        viewport.setCameraFollowTarget(leader.id, leader.position);
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


worldSizeSelect.addEventListener("change", () => {
  workspaceSession.changeWorld();
  state.selectedTestEntityId = null;
  state.selectedSpatialCell = null;
  state.moveTestEntityMode = false;
  inspectSpatialCell({ x: 0, y: 0 });
  refreshWorldMarkers();
  updateSpatialTestControls();
});
resetLabButton.addEventListener("click", () => {
  try {
    state.spatialTestController?.removeAll();
  } catch (error) {
    spatialTestStatus.textContent = `RESET CLEANUP FAILED · ${error.code ?? error.message}`;
    return;
  }
  state.selectedTestEntityId = null;
  state.moveTestEntityMode = false;
  workspaceSession.reset();
  refreshWorldMarkers();
  updateSpatialTestControls();
});
createTestEntityButton.addEventListener("click", createSpatialTestEntity);
spatialNeighborsFourButton.addEventListener("click", () => querySelectedSpatialNeighbors("four-way"));
spatialNeighborsEightButton.addEventListener("click", () => querySelectedSpatialNeighbors("eight-way"));
spatialRadiusManhattanButton.addEventListener("click", () => querySelectedSpatialRadius("manhattan"));
spatialRadiusChebyshevButton.addEventListener("click", () => querySelectedSpatialRadius("chebyshev"));
spatialFootprintButton.addEventListener("click", querySelectedSpatialFootprint);
moveTestEntityButton.addEventListener("click", toggleSpatialTestMoveMode);
removeTestEntityButton.addEventListener("click", removeSelectedSpatialTestEntity);

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
    state.spatialTestController = new SpatialTestController({
      entityRegistry: state.entityRegistry,
      worldRegistry: worlds,
      spatialComposition: state.spatialApi,
      placementCoordinator: state.placementCoordinatorApi,
      spatialMovement: state.spatialMovementApi
    });
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
      onRestore() {
        workspaceSession.synchronizeRestoredWorkspace();
        state.selectedTestEntityId = null;
        state.moveTestEntityMode = false;
        refreshWorldMarkers();
        updateSpatialTestControls();
      },
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
