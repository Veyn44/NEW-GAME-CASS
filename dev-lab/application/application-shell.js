import { createWorldViewport } from "../../shared/presentation/world-viewport.js";
import { createDevLabRuntime } from "./create-dev-lab-runtime.js";
import { LocalFileSaveAdapter, DEV_LAB_SAVE_FORMAT, DEV_LAB_SAVE_SLOT, DEV_LAB_SAVE_STATE_ID, DEV_LAB_SAVE_FILE_EXTENSION, DEV_LAB_SAVE_FILE_NAME, DEV_LAB_SAVE_MIME_TYPE } from "../../src/adapters/storage/local-file-save-adapter.js";
import { createFilePersistenceController } from "../../shared/application/file-persistence-controller.js";
import { createDefinitionCatalogController } from "../../shared/application/definition-catalog-controller.js";
import { createViewNavigationController } from "../../shared/application/view-navigation-controller.js";
import { createPauseMenuController } from "../../shared/application/pause-menu-controller.js";
import { createDevLabWorkspaceSessionController } from "./workspace-session-controller.js";
import { getDefinition, listDefinitionIndex, getCategories, loadDefinitionDetail } from "../../engine/database/definition-registry.js";
import { createViewportInputController } from "../../shared/input/viewport-input-controller.js";
import { createActionMappingController } from "../../engine/input/action-mapping-controller.js";
import { DEFAULT_CASSANDRA_ACTION_BINDINGS } from "../../cassandra/input/default-action-bindings.js";
import { createApplicationRuntimeHost } from "../../shared/application/runtime-host.js";
import { createCassandraDevLabGameplayController } from "../../cassandra/application/dev-lab-gameplay-controller.js";
import { createCassandraDevLabUnitInspectorUi } from "../../cassandra/application/dev-lab-unit-inspector-ui.js";

const views = [...document.querySelectorAll("[data-view]")];
const databaseView = document.querySelector('[data-view="database"]');
const databaseHome = document.createComment("database-home");
databaseView.before(databaseHome);
const viewportDatabaseButton = document.querySelector("#open-viewport-database");
const databaseBackButton = databaseView.querySelector("[data-back-menu]");
const databaseSelectButton = databaseView.querySelector("#database-select-definition");
const databaseModeLabel = document.querySelector("#database-mode-label");
const simulationStatus = document.querySelector("#simulation-status");
const pointerStatus = document.querySelector("#pointer-status");
const viewportPanel = document.querySelector(".viewport-panel");
const canvas = document.querySelector("#world-canvas");
const worldSizeSelect = document.querySelector("#world-size");
const gridVisible = document.querySelector("#grid-visible");
const resetLabButton = document.querySelector("#reset-lab");
const controlledEntitySelect = document.querySelector("#controlled-entity");
const ambientLightToggle = document.querySelector("#ambient-light-enabled");
const testFlashlightToggle = document.querySelector("#test-flashlight-enabled");
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
  onSelectDefinition: beginWorldPlacement,
  allowBrowseSelection: true
});
const inputController = createViewportInputController();
const actionController = createActionMappingController({ bindings: DEFAULT_CASSANDRA_ACTION_BINDINGS });
const heldMovementKeys = new Set();

const state = {
  gameplayApi: null,
  clock: null,
  worldRegistry: null,
  lightingApi: null,
  persistenceApi: null,
  saveAdapter: null,
  workspacePersistence: null,
  paused: true,
  gameplayUi: null,
  placementActive: false,
};

function beginWorldPlacement(definition) {
  if (document.body.dataset.currentView !== "dev-lab") navigation.showView("dev-lab");
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
        refreshControlledEntityOptions();
        inspectGameplayEntity(unit.id);
        simulationStatus.textContent = `SPAWNED · ${definition.name} · (${x}, ${y})`;
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
function refreshLighting() {
  const lightingApi = state.lightingApi;
  const worldRegistry = state.worldRegistry;
  if (!lightingApi || !worldRegistry) return;

  const worldId = worldRegistry.activeWorldId;
  const ambientId = "dev-lab:ambient-test";
  const flashlightId = "dev-lab:flashlight-test";
  let ambient = lightingApi.getLight(ambientId);
  let flashlight = lightingApi.getLight(flashlightId);

  // A light belongs to one world. Recreate test lights after a world switch.
  if (ambient && ambient.worldId !== worldId) {
    lightingApi.removeLight(ambientId);
    ambient = null;
  }
  if (flashlight && flashlight.worldId !== worldId) {
    lightingApi.removeLight(flashlightId);
    flashlight = null;
  }

  if (ambientLightToggle?.checked && !ambient) {
    lightingApi.addLight({
      id: ambientId, worldId, type: "ambient",
      intensity: 0.18, color: { r: 112, g: 132, b: 166 }, enabled: true
    });
  } else if (!ambientLightToggle?.checked && ambient) {
    lightingApi.removeLight(ambientId);
  }

  const gameplayApi = state.gameplayApi;
  const controlState = gameplayApi?.getControlState?.();
  const leaderId = controlState?.leaderId;
  const pawn = leaderId && typeof gameplayApi?.getUnit === "function"
    ? gameplayApi.getUnit(leaderId)
    : null;
  const position = pawn?.position;
  if (testFlashlightToggle?.checked && position) {
    const definition = {
      id: flashlightId, worldId, type: "spot",
      position: { x: position.x, y: position.y },
      direction: typeof gameplayApi?.getFacing === "function" ? gameplayApi.getFacing(leaderId) : 0,
      innerAngle: Math.PI / 5, outerAngle: Math.PI / 2,
      intensity: 1.4, color: { r: 255, g: 222, b: 160 },
      innerRadius: 5, radius: 18, castsShadows: true
    };
    if (flashlight) {
      lightingApi.updateLight(flashlightId, {
        position: definition.position,
        direction: definition.direction
      });
    } else {
      lightingApi.addLight(definition);
    }
  } else if (flashlight) {
    lightingApi.removeLight(flashlightId);
  }

  const bounds = typeof viewport.getVisibleWorldBounds === "function"
    ? viewport.getVisibleWorldBounds()
    : null;
  const result = lightingApi.calculateIllumination({ worldId, bounds });
  viewport.setIllumination(result.cells);
}

let lastFacingAngle = null;
viewport.setWorldPointerMoveHandler((pointerPosition) => {
  const gameplayApi = state.gameplayApi;
  const control = gameplayApi?.getControlState?.();
  if (!control?.drafted || !control.leaderId) return;
  const pawn = gameplayApi.getUnit(control.leaderId);
  if (!pawn?.position) return;
  const dx = pointerPosition.x - pawn.position.x;
  const dy = pointerPosition.y - pawn.position.y;
  if (Math.hypot(dx, dy) < 0.05) return;
  const angle = Math.atan2(dy, dx);
  const previous = gameplayApi.getFacing(control.leaderId);
  const difference = Math.abs(Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous)));
  if (difference < 0.035) return;
  gameplayApi.setFacing(control.leaderId, angle);
  refreshWorldMarkers();
  if (testFlashlightToggle?.checked) refreshLighting();
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
      label: getDefinition(unit.definitionId)?.name ?? unit.definitionId,
      facing: state.gameplayApi?.getFacing(unit.id) ?? 0
    }));
  viewport.setWorldMarkers(unitMarkers);
}

function refreshControlledEntityOptions() {
  if (!controlledEntitySelect) return;
  const controlState = state.gameplayApi?.getControlState() ?? {};
  const pawns = state.gameplayApi?.listPawns() ?? [];
  const activeWorldId = state.worldRegistry?.activeWorldId;
  const options = pawns.map((pawn) => {
    const unit = state.gameplayApi.getUnit(pawn.entityId);
    if (!unit?.placement || unit.placement.type !== "world" || unit.placement.worldId !== activeWorldId) return null;
    const definition = getDefinition(unit.definitionId);
    return { id: pawn.entityId, label: definition?.name ?? unit.definitionId };
  }).filter(Boolean);
  controlledEntitySelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = options.length ? "Select a Pawn…" : "No spawned Pawns";
  controlledEntitySelect.append(placeholder);
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.id;
    element.textContent = option.label + " · " + option.id.slice(-6);
    controlledEntitySelect.append(element);
  }
  controlledEntitySelect.value = options.some((option) => option.id === controlState.leaderId)
    ? controlState.leaderId : "";
  controlledEntitySelect.disabled = options.length === 0;
}

function clearSelection() {
  state.gameplayUi?.clearSelection();
  viewport.setSelectedWorldMarker(null);
}

function inspectGameplayEntity(entityId) {
  const unit = state.gameplayApi?.getUnit(entityId) ?? state.gameplayUi?.inspectUnit(entityId) ?? null;
  viewport.setSelectedWorldMarker(unit?.id ?? null);
  return unit;
}

function handleViewportEntitySelect(entityId) {
  inspectGameplayEntity(entityId);
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
  refreshControlledEntityOptions();
  viewport.setWorldInteraction({
    paused: state.paused,
    inspectionEnabled: true,
    onSelect: handleViewportEntitySelect
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
    "Reset Dev Lab? All current workspace entities and unsaved session state will be cleared. Saved .dlcass files will not be deleted."
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
    actionController.keyDown(event.code);
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
      controlledEntitySelect.value = controlState.leaderId;
      inspectGameplayEntity(controlState.leaderId);
      if (leader?.placement?.type === "world"
        && leader.placement.worldId === state.worldRegistry?.activeWorldId) {
        viewport.setCameraFollowTarget(leader.id, leader.position);
      }
    } else {
      clearSelection();
      refreshLighting();
    }
    refreshControlledEntityOptions();
    updateSimulationUi();
    return;
  }
  if (!state.paused && !/^Key[WASD]$/.test(event.code)) {
    inputController.keyDown(event.code);
    actionController.keyDown(event.code);
    if (/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right))$/.test(event.code)) event.preventDefault();
  }
});

window.addEventListener("keyup", (event) => {
  heldMovementKeys.delete(event.code);
  inputController.keyUp(event.code);
  actionController.keyUp(event.code);
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
  actionController.clearHeld();
  updateSimulationUi();
}

window.addEventListener("blur", handleFocusLoss);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") handleFocusLoss();
});


worldSizeSelect.addEventListener("change", () => {
  workspaceSession.changeWorld();
  refreshWorldMarkers();
});
resetLabButton.addEventListener("click", () => {
  workspaceSession.reset();
  refreshWorldMarkers();
  refreshControlledEntityOptions();
});
ambientLightToggle.addEventListener("change", refreshLighting);
testFlashlightToggle.addEventListener("change", refreshLighting);
controlledEntitySelect.addEventListener("change", () => {
  try {
    const controlState = state.gameplayApi?.setControlledEntity(controlledEntitySelect.value || null);
    if (controlState?.leaderId) {
      inspectGameplayEntity(controlState.leaderId);
      const unit = state.gameplayApi.getUnit(controlState.leaderId);
      if (unit) viewport.setCameraFollowTarget(unit.id, unit.position);
      refreshLighting();
    } else {
      clearSelection();
    }
    refreshControlledEntityOptions();
    updateSimulationUi();
  } catch (error) {
    simulationStatus.textContent = "CONTROLLED ENTITY REJECTED · " + error.message;
    refreshControlledEntityOptions();
  }
});
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
    lightingApi: context.getService("core.lighting"),
    unitApi: context.getService("game.unit-api"),
    inputApi: context.getService("engine.input-api"),
    colonyControlApi: context.getService("game.colony-control-api"),
    pawnRuntimeApi: context.getService("cassandra.pawn-runtime-api"),
    persistenceApi: context.getService("core.persistence"),
    clock: context.getService("core.game-clock")
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
    actionController,
    onUnitMoved(moved) {
      refreshWorldMarkers();
      if (testFlashlightToggle?.checked) refreshLighting();
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
    state.lightingApi = services.lightingApi;
    state.persistenceApi = services.persistenceApi;
    state.gameplayApi = createCassandraDevLabGameplayController({
      unitApi: services.unitApi,
      pawnRuntimeApi: services.pawnRuntimeApi,
      colonyControlApi: services.colonyControlApi,
      worldRegistry: worlds
    });
    state.workspacePersistence = createFilePersistenceController({
      persistenceApi: services.persistenceApi,
      saveSlot: DEV_LAB_SAVE_SLOT,
      stateId: DEV_LAB_SAVE_STATE_ID,
      supportsFileAccess: () => LocalFileSaveAdapter.supportsFileAccess,
      requestFileName: ({ currentFileName, defaultFileName }) =>
        window.prompt("Name this Dev Lab workspace:", currentFileName || defaultFileName),
        fileExtension: DEV_LAB_SAVE_FILE_EXTENSION,
        defaultFileName: DEV_LAB_SAVE_FILE_NAME,
      saveAdapter: state.saveAdapter,
      fileInput: workspaceFileInput,
      onRestore() {
        workspaceSession.synchronizeRestoredWorkspace();
        refreshWorldMarkers();
        refreshControlledEntityOptions();
      },
      onStatus({ saveStatus, simulationStatus: nextSimulationStatus }) {
        workspaceSaveStatus.textContent = saveStatus;
        simulationStatus.textContent = nextSimulationStatus;
      }
    });
    state.gameplayUi = createCassandraDevLabUnitInspectorUi({
      root: document.querySelector("[data-application-gameplay-ui]"),
      gameplayApi: state.gameplayApi
    });
    viewport.setWorldMarkers([]);
    clearSelection();
    refreshControlledEntityOptions();
    refreshLighting();
    state.clock = services.clock;
    state.clock.pause("player");
    state.paused = true;
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
  state.saveAdapter = new LocalFileSaveAdapter({
    format: DEV_LAB_SAVE_FORMAT,
    fileExtension: DEV_LAB_SAVE_FILE_EXTENSION,
    mimeType: DEV_LAB_SAVE_MIME_TYPE,
    fileDescription: "Dev Lab workspace",
    defaultFileName: DEV_LAB_SAVE_FILE_NAME,
    slotId: DEV_LAB_SAVE_SLOT
  });
  runtimeHost = createDevLabRuntimeHost({ createRuntime, resolveRuntimeServices });
  try {
    await runtimeHost.start();
  } catch (error) {
    simulationStatus.textContent = `DEV LAB STARTUP FAILED · ${error.message}`;
  }
  navigation.showView("menu");
}
