import { createDevLabViewport } from "../presentation/dev-lab-viewport.js";
import { createDevLabRuntime } from "./create-dev-lab-runtime.js";
import { LocalFileSaveAdapter } from "../../src/adapters/storage/local-file-save-adapter.js";
import { createWorkspacePersistenceController } from "./workspace-persistence-controller.js";
import { getDefinition } from "../../engine/database/definition-registry.js";
import { createViewportInputController } from "../input/viewport-input-controller.js";
import {
  listDefinitionIndex,
  getCategories,
  loadDefinitionDetail
} from "../../engine/database/definition-registry.js";

const views = [...document.querySelectorAll("[data-view]")];
const navButtons = [...document.querySelectorAll("[data-navigate]")];
const databaseView = document.querySelector('[data-view="database"]');
const databaseHome = document.createComment("database-home");
databaseView.before(databaseHome);
const viewportDatabaseButton = document.querySelector("#open-viewport-database");
const databaseBackButton = databaseView.querySelector("[data-back-menu]");
const databaseSelectButton = databaseView.querySelector("#database-select-definition");
const databaseList = document.querySelector("#database-list");
const databaseSearch = document.querySelector("#database-search");
const databaseCategory = document.querySelector("#database-category");
const databaseInspector = document.querySelector("#database-inspector");
const databaseModeLabel = document.querySelector("#database-mode-label");
const simulationStatus = document.querySelector("#simulation-status");
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
const viewport = createDevLabViewport({
  canvas,
  sizeSelect: worldSizeSelect,
  gridToggle: gridVisible,
  zoomValue: document.querySelector("#zoom-value"),
  worldStatus: document.querySelector("#world-status"),
  viewStatus: document.querySelector("#view-status")
});
const inputController = createViewportInputController();
const heldMovementKeys = new Set();

const state = {
  databaseMode: "browse",
  selectedDefinitionId: null,
  selectedDefinition: null,
  detailRequest: 0,
  gameplayApi: null,
  clock: null,
  worldRegistry: null,
  persistenceApi: null,
  saveAdapter: null,
  workspacePersistence: null,
  paused: true,
  gameplayUi: null,
  viewportDatabaseOpen: false,
  placementActive: false,
  animationFrame: null,
  lastFrameTime: null,
  pauseMenuOpen: false,
  settingsReturnView: "menu"
};

function showView(name) {
  if (state.viewportDatabaseOpen && name !== "dev-lab") closeViewportDatabase();
  if (document.body.dataset.currentView === "dev-lab" && name !== "dev-lab") cancelPlacement();
  const currentView = document.body.dataset.currentView;
  if (currentView === "dev-lab" && name !== "dev-lab") {
    if (!state.pauseMenuOpen) {
      if (!state.paused) {
        inputController.pause();
        state.clock?.pause("player");
        state.paused = true;
      }
      inputController.clearForFocusLoss();
      if (state.clock && !state.clock.hasPauseReason("player")) state.clock.pause("player");
    }
    updateSimulationUi();
  }
  for (const view of views) view.hidden = view.dataset.view !== name;
  document.body.dataset.currentView = name;
  window.scrollTo(0, 0);
  if (name === "dev-lab") window.dispatchEvent(new Event("resize"));
}

function openDatabase() {
  if (state.viewportDatabaseOpen) closeViewportDatabase();
  state.databaseMode = "browse";
  databaseView.dataset.mode = "browse";
  databaseModeLabel.textContent = "CASSANDRA / KNOWLEDGE";
  databaseSearch.value = "";
  databaseCategory.value = "all";
  state.selectedDefinitionId = null;
  state.selectedDefinition = null;
  databaseInspector.replaceChildren();
  populateCategories();
  renderDatabase();
  showView("database");
}

function openViewportDatabase() {
  if (!state.paused || state.placementActive || state.viewportDatabaseOpen) return;
  state.databaseMode = "viewport";
  state.selectedDefinitionId = null;
  state.selectedDefinition = null;
  databaseSelectButton.hidden = true;
  databaseSelectButton.disabled = true;
  databaseView.dataset.mode = "viewport";
  databaseView.classList.add("database-overlay");
  databaseModeLabel.textContent = "CASSANDRA / DEV LAB";
  databaseBackButton.textContent = "CLOSE DATABASE";
  databaseSearch.value = "";
  databaseCategory.value = "all";
  databaseInspector.replaceChildren();
  populateCategories();
  renderDatabase();
  viewportPanel.append(databaseView);
  databaseView.hidden = false;
  state.viewportDatabaseOpen = true;
}

function closeViewportDatabase() {
  if (!state.viewportDatabaseOpen) return;
  databaseHome.after(databaseView);
  databaseView.hidden = true;
  databaseView.classList.remove("database-overlay");
  databaseView.dataset.mode = "browse";
  databaseBackButton.textContent = "← Main menu";
  databaseModeLabel.textContent = "CASSANDRA / KNOWLEDGE";
  state.databaseMode = "browse";
  state.viewportDatabaseOpen = false;
  databaseSelectButton.hidden = true;
  databaseSelectButton.disabled = true;
}

function beginWorldPlacement(definition) {
  if (!state.paused || !state.gameplayApi?.canPlaceDefinition(definition)
    || !state.worldRegistry) return;
  closeViewportDatabase();
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

function renderValue(value) {
  if (value === null) return "—";
  if (Array.isArray(value)) return value.length ? value.map(renderValue).join(", ") : "None";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function appendAttributeRows(container, value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child)) {
        appendAttributeRows(container, child, path);
      } else {
        const term = document.createElement("dt");
        term.textContent = path;
        const detail = document.createElement("dd");
        detail.textContent = renderValue(child);
        container.append(term, detail);
      }
    }
    return;
  }
  const term = document.createElement("dt");
  term.textContent = prefix || "Value";
  const detail = document.createElement("dd");
  detail.textContent = renderValue(value);
  container.append(term, detail);
}

async function inspectDefinition(id) {
  const request = ++state.detailRequest;
  state.selectedDefinitionId = id;
  state.selectedDefinition = null;
  databaseSelectButton.hidden = true;
  databaseSelectButton.disabled = true;
  databaseInspector.replaceChildren();

  const loading = document.createElement("p");
  loading.className = "database-inspector-state";
  loading.textContent = "Loading definition details…";
  databaseInspector.append(loading);

  const definition = await loadDefinitionDetail(id);
  if (request !== state.detailRequest || !definition) return;

  state.selectedDefinition = definition;
  databaseSelectButton.hidden = state.databaseMode !== "viewport"
    || !state.gameplayApi?.canPlaceDefinition(definition);
  databaseSelectButton.disabled = databaseSelectButton.hidden;
  databaseInspector.replaceChildren();

  const heading = document.createElement("div");
  heading.className = "database-inspector-heading";
  const category = document.createElement("p");
  category.className = "eyebrow";
  category.textContent = definition.category;
  const title = document.createElement("h2");
  title.textContent = definition.name;
  const identifier = document.createElement("code");
  identifier.textContent = definition.id;
  heading.append(category, title, identifier);
  databaseInspector.append(heading);

  if (definition.artwork) {
    const artwork = document.createElement("img");
    artwork.className = "database-artwork";
    artwork.alt = `${definition.name} artwork`;
    artwork.loading = "lazy";
    artwork.src = definition.artwork;
    artwork.addEventListener("error", () => artwork.classList.add("is-unavailable"), { once: true });
    databaseInspector.append(artwork);
  } else {
    const artworkPlaceholder = document.createElement("div");
    artworkPlaceholder.className = "database-artwork-placeholder";
    artworkPlaceholder.textContent = "NO ARTWORK REGISTERED";
    databaseInspector.append(artworkPlaceholder);
  }

  const description = document.createElement("p");
  description.className = "database-description";
  description.textContent = definition.description || "No description provided.";
  databaseInspector.append(description);

  const detailsHeading = document.createElement("h3");
  detailsHeading.className = "database-subheading";
  detailsHeading.textContent = "Complete definition data";
  databaseInspector.append(detailsHeading);

  const attributes = document.createElement("dl");
  attributes.className = "attribute-list database-detail-attributes";
  appendAttributeRows(attributes, definition.attributes);
  if (!attributes.childElementCount) {
    const empty = document.createElement("p");
    empty.className = "database-inspector-state";
    empty.textContent = "No attributes registered.";
    databaseInspector.append(empty);
  } else {
    databaseInspector.append(attributes);
  }

  const metadata = document.createElement("dl");
  metadata.className = "attribute-list database-detail-attributes";
  appendAttributeRows(metadata, {
    "Definition ID": definition.id,
    "Definition schema": definition.schemaVersion,
    "Entity type": definition.entityType ?? "—",
    Category: definition.category,
    "Available for": definition.spawnableAs
  });
  databaseInspector.append(metadata);


}

function renderDatabase() {
  const query = databaseSearch.value.trim().toLocaleLowerCase();
  const category = databaseCategory.value;
  const entries = listDefinitionIndex().filter((entry) => {
    const matchesCategory = category === "all" || entry.category === category;
    const haystack = [entry.id, entry.name, entry.description, entry.category].join(" ").toLocaleLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });

  databaseList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "database-empty";
    const strong = document.createElement("strong");
    strong.textContent = "Database is ready.";
    const message = document.createElement("span");
    message.textContent = "No definitions are registered in the active content packages.";
    empty.append(strong, message);
    databaseList.append(empty);
    return;
  }

  for (const entry of entries) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "database-index-entry";
    button.setAttribute("aria-pressed", String(state.selectedDefinitionId === entry.id));
    const title = document.createElement("strong");
    title.textContent = entry.name;
    const categoryLabel = document.createElement("span");
    categoryLabel.textContent = entry.category;
    const description = document.createElement("small");
    description.textContent = entry.description;
    button.append(title, categoryLabel, description);
    button.addEventListener("click", () => {
      for (const sibling of databaseList.querySelectorAll(".database-index-entry")) {
        sibling.setAttribute("aria-pressed", "false");
      }
      button.setAttribute("aria-pressed", "true");
      inspectDefinition(entry.id);
    });
    databaseList.append(button);
  }
}

function populateCategories() {
  databaseCategory.replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = "All categories";
  databaseCategory.append(all);
  for (const category of getCategories()) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    databaseCategory.append(option);
  }
}

function refreshDatabase() {
  populateCategories();
  renderDatabase();
}

for (const button of navButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.navigate === "database") openDatabase();
    else if (button.dataset.navigate === "settings") openSettings("menu");
    else showView(button.dataset.navigate);
  });
}
const pauseMenu = document.querySelector("#pause-menu");
document.querySelector("#pause-resume").addEventListener("click", closePauseMenu);
document.querySelector("#pause-settings").addEventListener("click", () => openSettings("dev-lab"));
document.querySelector("#pause-main-menu").addEventListener("click", () => {
  state.pauseMenuOpen = false;
  showView("menu");
});
document.querySelector("#settings-back").addEventListener("click", () => {
  const returnView = state.settingsReturnView;
  showView(returnView);
  if (returnView === "dev-lab") {
    state.pauseMenuOpen = true;
    pauseMenu.hidden = false;
    updateSimulationUi();
  }
});
document.querySelectorAll("[data-back-menu]").forEach((button) =>
  button.addEventListener("click", () => {
    if (button === databaseBackButton && state.viewportDatabaseOpen) closeViewportDatabase();
    else showView("menu");
  })
);
databaseSearch.addEventListener("input", renderDatabase);
databaseCategory.addEventListener("change", renderDatabase);

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
    onSelect: inspectGameplayEntity
  });
  if (controlState?.drafted && controlState.leaderId) {
    inspectGameplayEntity(controlState.leaderId);
  } else if (state.gameplayUi?.getSelectedUnitId()) {
    inspectGameplayEntity(state.gameplayUi.getSelectedUnitId());
  }
}

function openPauseMenu() {
  if (state.pauseMenuOpen || document.body.dataset.currentView !== "dev-lab") return;
  heldMovementKeys.clear();
  inputController.suspendForOverlay();
  state.gameplayUi?.closeProfile();
  state.pauseMenuOpen = true;
  pauseMenu.hidden = false;
  updateSimulationUi();
}

function closePauseMenu() {
  if (!state.pauseMenuOpen) return;
  state.pauseMenuOpen = false;
  pauseMenu.hidden = true;
  if (!state.paused) inputController.resume();
  canvas.focus({ preventScroll: true });
  updateSimulationUi();
}

function openSettings(returnView) {
  state.settingsReturnView = returnView;
  showView("settings");
}

function toggleSimulationPause() {
  if (!state.clock) return;
  if (state.paused) {
    state.clock.resume("player");
    state.paused = state.clock.paused;
    if (state.paused) {
      inputController.pause();
    } else {
      inputController.resume();
    }
  } else {
    inputController.pause();
    state.clock.pause("player");
    state.paused = state.clock.paused;
  

  }
  updateSimulationUi();
}

function simulationFrame(timestamp) {
  if (state.lastFrameTime !== null && state.clock) {
    const elapsedSeconds = Math.min(0.25, Math.max(0, (timestamp - state.lastFrameTime) / 1000));
    try {
      // The Core scheduler and Game Clock are the authoritative simulation gate.
      // Rendering and input remain responsive while the clock is paused.
      if (!state.pauseMenuOpen) runtimeAdvance(elapsedSeconds);
      if (state.paused) updatePausedFreeCamera(elapsedSeconds);
      const clockPaused = state.clock?.paused ?? true;
      if (clockPaused !== state.paused) {
        if (clockPaused) {
          inputController.pause();

        } else {
          inputController.resume();
        }
        state.paused = clockPaused;
        updateSimulationUi();
      }
    } catch (error) {
      simulationStatus.textContent = `SIMULATION ERROR · ${error.message}`;
      inputController.pause();
      inputController.clearForFocusLoss();
      state.clock?.pause("simulation-fault");
      state.paused = true;

      updateSimulationUi();
    }
  }
  state.lastFrameTime = timestamp;
  state.animationFrame = requestAnimationFrame(simulationFrame);
}

let advanceRuntime = null;
function runtimeAdvance(deltaSeconds) {
  advanceRuntime?.(deltaSeconds);
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
  if (state.pauseMenuOpen || state.gameplayApi?.getControlState().drafted || !heldMovementKeys.size) return;
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
    if (state.viewportDatabaseOpen) { closeViewportDatabase(); return; }
    if (state.pauseMenuOpen) { closePauseMenu(); return; }
    openPauseMenu();
    return;
  }
  if (isTextEntryTarget(event.target)) return;
  if (state.pauseMenuOpen) return;
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
  if (state.pauseMenuOpen) return;
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

viewportDatabaseButton.addEventListener("click", openViewportDatabase);
databaseSelectButton.addEventListener("click", () => {
  if (state.databaseMode !== "viewport" || !state.selectedDefinition) return;
  beginWorldPlacement(state.selectedDefinition);
});

worldSizeSelect.addEventListener("change", () => {
  if (!state.paused || !state.worldRegistry) return;
  const size = Number(worldSizeSelect.value);
  state.worldRegistry.activateWorld(`dev-lab-world-${size}`);
  const leaderId = state.gameplayApi?.getControlState().leaderId;
  const leader = leaderId ? state.gameplayApi?.getUnit(leaderId) : null;
  if (leader?.placement && leader.placement.worldId !== state.worldRegistry.activeWorldId) {
    state.gameplayApi.setDrafted(false);
  }
  clearSelection();
  refreshWorldMarkers();
  updateSimulationUi();
});

resetLabButton.addEventListener("click", () => {
  if (!state.worldRegistry) return;
  const confirmed = window.confirm(
    "Reset Dev Lab? All current workspace entities and unsaved session state will be cleared. Saved .cass files will not be deleted."
  );
  if (!confirmed) return;

  heldMovementKeys.clear();
  inputController.pause();
  inputController.clearForFocusLoss();
  state.clock?.pause("player");
  state.paused = true;
  cancelPlacement();
  closeViewportDatabase();
  state.gameplayUi?.closeProfile();

  for (const unit of state.gameplayApi?.listUnits() ?? []) {
    state.gameplayApi.removeUnit(unit.id);
  }
  state.gameplayApi?.setLeader(null);
  clearSelection();
  refreshWorldMarkers();

  const activeWorld = state.worldRegistry.getActiveWorld();
  if (activeWorld?.dimensions) {
    const { width, height } = activeWorld.dimensions;
    worldSizeSelect.value = String(width);
    document.querySelector("#world-status").textContent = `World: ${width} × ${height}`;
    viewport.resetCameraToWorld(Math.min(width, height));
  } else {
    viewport.resetCameraToWorld();
  }

  state.workspacePersistence?.clearSelection();
  workspaceSaveStatus.textContent = "LAB RESET · NO SAVE SELECTED";
  simulationStatus.textContent = "EMPTY LAB · PAUSED";
  updateSimulationUi();
  canvas.focus({ preventScroll: true });
});


function synchronizeRestoredWorkspace() {
  // A loaded session always enters a safe, paused inspection state.
  heldMovementKeys.clear();
  inputController.pause();
  inputController.clearForFocusLoss();
  state.clock?.pause("player");
  state.paused = true;

  const activeWorld = state.worldRegistry?.get(state.worldRegistry.activeWorldId);
  if (activeWorld?.dimensions?.width && activeWorld?.dimensions?.height) {
    const { width, height } = activeWorld.dimensions;
    worldSizeSelect.value = String(width);
    document.querySelector("#world-status").textContent = `World: ${width} × ${height}`;
    viewport.resetCameraToWorld(Math.min(width, height));
  } else {
    viewport.resetCameraToWorld();
  }

  clearSelection();
  refreshWorldMarkers();
  updateSimulationUi();
}

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
    persistenceApi: context.getService("core.persistence"),
    clock: context.getService("core.game-clock"),
    unitApi: null,
    inputApi: null,
    colonyControlApi: null
  };
}

async function startDevLabRuntime({
  createRuntime = createDevLabRuntime,
  resolveRuntimeServices = resolveDevLabRuntimeServices
} = {}) {
  state.saveAdapter = new LocalFileSaveAdapter();
  const runtime = createRuntime({
    saveAdapter: state.saveAdapter,
    inputController,
    onUnitMoved(moved) {
      refreshWorldMarkers();
      viewport.setCameraFollowTarget(moved.entityId, moved.position);
    },
    updateFreeCamera: applyFreeCameraInput
  });
  if (!runtime || typeof runtime.start !== "function" || typeof runtime.advance !== "function") {
    throw new TypeError("Dev Lab runtime factory must return a runtime with start() and advance().");
  }

  try {
    const context = await runtime.start();
    const services = resolveRuntimeServices(context);
    if (!services?.worldRegistry || !services?.persistenceApi || !services?.clock) {
      throw new TypeError("Dev Lab runtime services must provide worldRegistry, persistenceApi and clock.");
    }
    const worlds = services.worldRegistry;
    for (const size of [64, 128, 256]) {
      worlds.registerWorld({ worldId: `dev-lab-world-${size}`, type: "dev-lab-test", dimensions: { width: size, height: size }, coordinateSystem: "tiles" });
    }
    worlds.activateWorld(`dev-lab-world-${Number(worldSizeSelect.value)}`);
    state.worldRegistry = worlds;
    state.persistenceApi = services.persistenceApi;
    state.workspacePersistence = createWorkspacePersistenceController({
      persistenceApi: services.persistenceApi,
      saveAdapter: state.saveAdapter,
      fileInput: workspaceFileInput,
      onRestore: synchronizeRestoredWorkspace,
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
    advanceRuntime = (deltaSeconds) => runtime.advance(deltaSeconds);
    state.clock.pause("player");
    state.paused = true;
    updateSimulationUi();
    state.animationFrame = requestAnimationFrame(simulationFrame);
    workspaceSaveStatus.textContent = state.workspacePersistence.initialStatus;

  } catch (error) {
    simulationStatus.textContent = `DEV LAB STARTUP FAILED · ${error.message}`;
  }
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
  refreshDatabase();
  await startDevLabRuntime({ createRuntime, resolveRuntimeServices });
  showView("menu");
}
