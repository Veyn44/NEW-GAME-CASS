import {
  setWorldMarkers,
  setWorldInteraction,
  setSelectedWorldMarker,
  setWorldPlacement,
  cancelWorldPlacement,
  setCameraFollowTarget,
  clearCameraFollowTarget,
  moveCameraBy,
  resetCameraToWorld
} from "../adapters/presentation/dev-world-preview.js";
import { createGameRuntime } from "../host/create-game-runtime.js";
import { LocalFileSaveAdapter, DEV_LAB_SAVE_SLOT } from "../adapters/storage/local-file-save-adapter.js";
import { createUnitSystem } from "../gameplay/unit/unit-system.js";
import { createGameInputSystem } from "../gameplay/input/game-input-system.js";
import { createColonyControlSystem } from "../gameplay/colony/colony-control-system.js";
import { getDefinition } from "./database/definition-registry.js";
import { loadCanonicalDefinitions } from "./database/database-loader.js";
import { createViewportInputController } from "./input/viewport-input-controller.js";
import {
  listDefinitionIndex,
  getCategories,
  loadDefinitionDetail
} from "./database/definition-registry.js";

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
const quickSelect = document.querySelector("#quick-select");
const quickSelectKind = document.querySelector("#quick-select-kind");
const quickSelectArtwork = document.querySelector("#quick-select-artwork");
const quickSelectArtworkEmpty = document.querySelector("#quick-select-artwork-empty");
const quickSelectName = document.querySelector("#quick-select-name");
const quickSelectSummary = document.querySelector("#quick-select-summary");
const quickSelectInfo = document.querySelector("#quick-select-info");
const quickSelectDetails = document.querySelector("#quick-select-details");
const unitProfile = document.querySelector("#unit-profile");
const unitProfileClose = document.querySelector("#unit-profile-close");
const unitProfileName = document.querySelector("#unit-profile-name");
const unitProfileArtwork = document.querySelector("#unit-profile-artwork");
const unitProfileArtworkEmpty = document.querySelector("#unit-profile-artwork-empty");
const unitProfileCategory = document.querySelector("#unit-profile-category");
const unitProfileDescription = document.querySelector("#unit-profile-description");
const unitProfileAttributes = document.querySelector("#unit-profile-attributes");
const unitProfileInstance = document.querySelector("#unit-profile-instance");
const unitProfileLocation = document.querySelector("#unit-profile-location");
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
const inputController = createViewportInputController();
const heldMovementKeys = new Set();

const state = {
  databaseMode: "browse",
  selectedDefinitionId: null,
  selectedDefinition: null,
  detailRequest: 0,
  unitApi: null,
  inputApi: null,
  colonyControlApi: null,
  clock: null,
  worldRegistry: null,
  persistenceApi: null,
  saveAdapter: null,
  paused: true,
  selectedUnitId: null,
  selectedObject: null,
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
  if (!state.paused || !state.unitApi || !state.worldRegistry
    || !definition || !definition.spawnableAs.includes("unit")) return;
  closeViewportDatabase();
  clearUnitSelection();
  state.placementActive = true;
  viewportDatabaseButton.disabled = true;
  worldSizeSelect.disabled = true;
  canvas.focus({ preventScroll: true });
  setWorldPlacement({
    label: definition.name,
    artwork: definition.artwork,
    onPlace: (x, y) => {
      try {
        const unit = state.unitApi.createUnit({
          definitionId: definition.id,
          worldId: state.worldRegistry.activeWorldId,
          position: { x, y }
        });
        if (definition.id === "pawn.johny" && !state.colonyControlApi.getState().leaderId) {
          state.colonyControlApi.setLeader(unit.id);
        }
        state.placementActive = false;
        viewportDatabaseButton.disabled = !state.paused;
        worldSizeSelect.disabled = !state.paused;
        setWorldPlacement(null);
        refreshWorldMarkers();
        inspectUnit(unit.id);
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
  cancelWorldPlacement();
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
    || !definition.spawnableAs.includes("unit");
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
    message.textContent = "Canonical game definitions are loaded from the content database.";
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
  const units = state.unitApi?.listUnits() ?? [];
  setWorldMarkers(units
    .filter((unit) => unit.placement?.type === "world")
    .map((unit) => ({
      id: unit.id,
      x: unit.placement.position.x,
      y: unit.placement.position.y,
      label: getDefinition(unit.definitionId)?.name ?? unit.definitionId
    })));
}

function clearUnitSelection() {
  state.selectedUnitId = null;
  state.selectedObject = null;
  setSelectedWorldMarker(null);
  quickSelect.hidden = true;
  quickSelectInfo.disabled = true;
  quickSelectInfo.textContent = "INFO";
  quickSelectDetails.hidden = true;
  quickSelectDetails.replaceChildren();
  closeUnitProfile();
  quickSelectArtwork.hidden = true;
  quickSelectArtwork.removeAttribute("src");
  quickSelectArtworkEmpty.hidden = false;
  quickSelectName.textContent = "No selection";
  quickSelectSummary.textContent = "Select an object in the world.";
}

function inspectUnit(entityId) {
  const controlState = state.colonyControlApi?.getState();
  if (controlState?.drafted && controlState.leaderId) entityId = controlState.leaderId;
  if (!entityId) {
    clearUnitSelection();
    return;
  }
  const unit = state.unitApi?.getUnit(entityId);
  if (!unit) {
    clearUnitSelection();
    return;
  }
  closeUnitProfile();
  state.selectedUnitId = unit.id;
  state.selectedObject = { id: unit.id, kind: "UNIT", unit };
  setSelectedWorldMarker(unit.id);
  const definition = getDefinition(unit.definitionId);
  quickSelectKind.textContent = "UNIT";
  quickSelectName.textContent = definition?.name ?? "Unknown definition";
  quickSelectSummary.textContent = definition?.description ?? "Live world instance.";
  quickSelectArtwork.hidden = !definition?.artwork;
  quickSelectArtworkEmpty.hidden = Boolean(definition?.artwork);
  if (definition?.artwork) {
    quickSelectArtwork.src = definition.artwork;
    quickSelectArtwork.alt = definition.name;
  } else {
    quickSelectArtwork.removeAttribute("src");
  }
  quickSelectInfo.disabled = !state.paused;
  quickSelectDetails.replaceChildren();
  const details = document.createElement("dl");
  details.className = "attribute-list quick-select-attributes";
  appendAttributeRows(details, {
    "Instance ID": unit.id,
    "Definition": definition?.name ?? unit.definitionId,
    "Definition ID": unit.definitionId,
    "World": unit.placement?.worldId ?? "—",
    "Tile X": unit.placement?.position?.x ?? "—",
    "Tile Y": unit.placement?.position?.y ?? "—"
  });
  appendAttributeRows(details, {
    "Entity type": definition?.entityType ?? "—",
    "Canonical attributes": definition?.attributes ?? {}
  });
  const hint = document.createElement("p");
  hint.className = "dev-note";
  hint.textContent = "Live instance data supplied by Unit and World services.";
  quickSelectDetails.append(details, hint);
  quickSelect.hidden = false;
}

function updateSimulationUi() {
  const controlState = state.colonyControlApi?.getState();
  simulationStatus.textContent = state.paused
    ? `PAUSED · ${controlState?.drafted ? "DRAFT ACTIVE" : "F TO DRAFT"} · Space to resume`
    : `RUNNING · ${controlState?.drafted ? "DRAFT ACTIVE" : "NO DRAFT"} · Space to pause`;
  simulationStatus.dataset.state = state.paused ? "paused" : "running";
  viewportPanel.dataset.paused = String(state.paused);
  viewportPanel.dataset.inputMode = state.paused ? "paused" : "running";
  worldSizeSelect.disabled = !state.paused || state.placementActive;
  gridVisible.disabled = false;
  viewportDatabaseButton.disabled = !state.paused || state.placementActive;
  resetLabButton.disabled = false;
  pointerStatus.textContent = state.paused ? "INSPECTION CURSOR" : (state.colonyControlApi?.getState().drafted ? "PAWN CONTROL" : "FREE CAMERA");
  setWorldInteraction({
    paused: state.paused,
    inspectionEnabled: true,
    onSelect: inspectUnit
  });
  if (controlState?.drafted && controlState.leaderId) {
    inspectUnit(controlState.leaderId);
  } else if (state.selectedUnitId) {
    inspectUnit(state.selectedUnitId);
  }
}

function openPauseMenu() {
  if (state.pauseMenuOpen || document.body.dataset.currentView !== "dev-lab") return;
  heldMovementKeys.clear();
  inputController.suspendForOverlay();
  closeUnitProfile();
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
  if (state.lastFrameTime !== null && state.unitApi) {
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

function updatePausedFreeCamera(deltaSeconds) {
  if (state.pauseMenuOpen || state.colonyControlApi?.getState().drafted || !heldMovementKeys.size) return;
  let x = Number(heldMovementKeys.has("KeyD")) - Number(heldMovementKeys.has("KeyA"));
  let y = Number(heldMovementKeys.has("KeyS")) - Number(heldMovementKeys.has("KeyW"));
  if (!x && !y) return;
  const length = Math.hypot(x, y);
  const speed = 30;
  moveCameraBy((x / length) * speed * deltaSeconds, (y / length) * speed * deltaSeconds);
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
    if (!unitProfile.hidden) { closeUnitProfile(); return; }
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
  if (event.code === "KeyF" && !event.repeat && state.colonyControlApi) {
    event.preventDefault();
    const next = state.colonyControlApi.toggleDraft();
    if (next.drafted && next.leaderId) {
      const leader = state.unitApi?.getUnit(next.leaderId);
      inspectUnit(next.leaderId);
      if (leader?.placement?.type === "world"
        && leader.placement.worldId === state.worldRegistry?.activeWorldId) {
        setCameraFollowTarget(leader.id, leader.placement.position);
      }
    } else {
      clearCameraFollowTarget();
      clearUnitSelection();
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
  clearCameraFollowTarget();
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

function closeUnitProfile() {
  unitProfile.hidden = true;
  quickSelectInfo.textContent = "INFO";
}

function openUnitProfile() {
  if (!state.paused || !state.selectedObject || state.selectedObject.kind !== "UNIT") return;
  const unit = state.unitApi?.getUnit(state.selectedUnitId);
  if (!unit) {
    clearUnitSelection();
    return;
  }
  const definition = getDefinition(unit.definitionId);
  unitProfileName.textContent = definition?.name ?? "Unknown unit";
  unitProfileCategory.textContent = definition?.category ?? "UNIT";
  unitProfileDescription.textContent = definition?.description ?? "No personal record is available.";
  unitProfileArtwork.hidden = !definition?.artwork;
  unitProfileArtworkEmpty.hidden = Boolean(definition?.artwork);
  if (definition?.artwork) {
    unitProfileArtwork.src = definition.artwork;
    unitProfileArtwork.alt = definition.name ?? "Unit portrait";
  } else {
    unitProfileArtwork.removeAttribute("src");
  }
  unitProfileAttributes.replaceChildren();
  const attributes = definition?.attributes ?? {};
  if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
    appendAttributeRows(unitProfileAttributes, attributes);
  } else {
    appendAttributeRows(unitProfileAttributes, { Record: attributes });
  }
  if (!unitProfileAttributes.childElementCount) {
    appendAttributeRows(unitProfileAttributes, { Record: "No personal attributes recorded." });
  }
  unitProfileInstance.textContent = "LIVE WORLD INSTANCE";
  unitProfileLocation.textContent = unit.placement?.position
    ? `LOCATION · ${unit.placement.position.x}, ${unit.placement.position.y}`
    : "LOCATION · UNKNOWN";
  unitProfile.hidden = false;
  quickSelectInfo.textContent = "CLOSE INFO";
}

quickSelectInfo.addEventListener("click", () => {
  if (unitProfile.hidden) openUnitProfile();
  else closeUnitProfile();
});
unitProfileClose.addEventListener("click", closeUnitProfile);

worldSizeSelect.addEventListener("change", () => {
  if (!state.paused || !state.worldRegistry) return;
  const size = Number(worldSizeSelect.value);
  state.worldRegistry.activateWorld(`dev-lab-world-${size}`);
  clearUnitSelection();
});

resetLabButton.addEventListener("click", () => {
  if (!state.unitApi || !state.colonyControlApi || !state.worldRegistry) return;
  const confirmed = window.confirm(
    "Reset Dev Lab? All current Units and unsaved session state will be cleared. Saved .cass files will not be deleted."
  );
  if (!confirmed) return;

  heldMovementKeys.clear();
  inputController.pause();
  inputController.clearForFocusLoss();
  state.clock?.pause("player");
  state.paused = true;
  cancelPlacement();
  closeViewportDatabase();
  closeUnitProfile();

  for (const unit of state.unitApi.listUnits()) {
    state.unitApi.removeUnit(unit.id);
  }
  state.colonyControlApi.setLeader(null);
  clearUnitSelection();
  clearCameraFollowTarget();

  const activeWorld = state.worldRegistry.getActiveWorld();
  if (activeWorld?.dimensions) {
    const { width, height } = activeWorld.dimensions;
    worldSizeSelect.value = String(width);
    document.querySelector("#world-status").textContent = `World: ${width} × ${height}`;
    resetCameraToWorld(Math.min(width, height));
  } else {
    resetCameraToWorld();
  }

  state.saveAdapter?.clearSelection();
  workspaceSaveStatus.textContent = "LAB RESET · NO SAVE SELECTED";
  simulationStatus.textContent = "EMPTY LAB · PAUSED";
  updateSimulationUi();
  canvas.focus({ preventScroll: true });
});


async function persistWorkspace({ chooseFile = false } = {}) {
  if (!state.persistenceApi || !state.saveAdapter) return;
  try {
    if (chooseFile) {
      if (LocalFileSaveAdapter.supportsFileAccess) {
        const fileName = await state.saveAdapter.selectSaveFile();
        if (!fileName) return;
        workspaceSaveStatus.textContent = `SAVING AS · ${fileName}`;
      } else {
        const requestedName = window.prompt("Name this Cassandra save:", state.saveAdapter.selectedFileName || "save.cass");
        if (requestedName === null) return;
        const safeName = requestedName.trim().endsWith(".cass") ? requestedName.trim() : `${requestedName.trim()}.cass`;
        if (!/^[a-zA-Z0-9._ -]+\.cass$/i.test(safeName)) {
          workspaceSaveStatus.textContent = "SAVE FAILED · USE A SIMPLE FILE NAME";
          return;
        }
        state.saveAdapter.setDownloadFileName(safeName);
      }
    } else if (!state.saveAdapter.selectedFileName && LocalFileSaveAdapter.supportsFileAccess) {
      workspaceSaveStatus.textContent = "NO SAVE SELECTED · USE SAVE AS FIRST";
      return;
    }

    const metadata = await state.persistenceApi.save(DEV_LAB_SAVE_SLOT, {
      stateId: "cassandra-dev-lab-workspace",
      kind: "manual"
    });
    const fileName = state.saveAdapter.selectedFileName || "save.cass";
    workspaceSaveStatus.textContent = `SAVED · ${fileName}`;
    simulationStatus.textContent = `WORKSPACE SAVED · ${metadata.createdAt}`;
  } catch (error) {
    if (error?.name === "AbortError") return;
    workspaceSaveStatus.textContent = `SAVE FAILED · ${error.message}`;
    simulationStatus.textContent = `SAVE FAILED · ${error.message}`;
  }
}

function describeLoadFailure(error) {
  const code = error?.code ?? "LOAD_FAILED";
  const descriptions = {
    INVALID_SAVE_FILE: "The file is not valid JSON.",
    INCOMPATIBLE_SAVE_FILE: "This is not a supported Cassandra save file.",
    INCOMPATIBLE_SAVE_FORMAT: "The save format version is not supported.",
    STATE_MISMATCH: "The save belongs to a different workspace.",
    MISSING_REQUIRED_SNAPSHOT: "The save is missing required system data.",
    INVALID_SAVE: "The save is missing required data.",
    SCHEMA_MISMATCH: "A saved system schema is incompatible.",
    INVALID_SNAPSHOT: "A saved system rejected its data.",
    RESTORE_COMMIT_FAILED: "A system failed while restoring the save. The restore was rolled back where possible.",
    SAVE_NOT_FOUND: "No save data was found.",
    SAVE_SOURCE_NOT_SELECTED: "No save file is selected."
  };
  const detail = descriptions[code] ?? error?.message ?? "The save could not be loaded.";
  return `LOAD FAILED · ${code} · ${detail}`;
}

async function restoreWorkspace() {
  if (!state.persistenceApi || !state.saveAdapter) return;
  try {
    if (LocalFileSaveAdapter.supportsFileAccess) {
      const fileName = await state.saveAdapter.selectLoadFile();
      if (!fileName) return;
      workspaceSaveStatus.textContent = `LOADING · ${fileName}`;
    } else {
      workspaceFileInput.click();
      return;
    }
    await state.persistenceApi.load(DEV_LAB_SAVE_SLOT, {
      stateId: "cassandra-dev-lab-workspace"
    });
    synchronizeRestoredWorkspace();
    workspaceSaveStatus.textContent = `LOADED · ${state.saveAdapter.selectedFileName}`;
    simulationStatus.textContent = "WORKSPACE RESTORED";
  } catch (error) {
    if (error?.name === "AbortError") return;
    const message = describeLoadFailure(error);
    workspaceSaveStatus.textContent = message;
    simulationStatus.textContent = message;
  }
}

function synchronizeRestoredWorkspace() {
  // A loaded session always enters a safe, paused inspection state.
  heldMovementKeys.clear();
  inputController.pause();
  inputController.clearForFocusLoss();
  state.clock?.pause("player");
  state.paused = true;
  clearCameraFollowTarget();

  const activeWorld = state.worldRegistry?.get(state.worldRegistry.activeWorldId);
  if (activeWorld?.dimensions?.width && activeWorld?.dimensions?.height) {
    const { width, height } = activeWorld.dimensions;
    worldSizeSelect.value = String(width);
    document.querySelector("#world-status").textContent = `World: ${width} × ${height}`;
    // The preview currently represents square worlds; center on the active
    // world's valid bounds rather than retaining a camera from the old world.
    resetCameraToWorld(Math.min(width, height));
  } else {
    resetCameraToWorld();
  }

  clearUnitSelection();
  refreshWorldMarkers();
  updateSimulationUi();
}

saveWorkspaceButton.addEventListener("click", () => persistWorkspace());
saveWorkspaceAsButton.addEventListener("click", () => persistWorkspace({ chooseFile: true }));
loadWorkspaceButton.addEventListener("click", () => restoreWorkspace());
workspaceFileInput.addEventListener("change", async () => {
  const file = workspaceFileInput.files?.[0];
  workspaceFileInput.value = "";
  if (!file || !state.persistenceApi || !state.saveAdapter) return;
  try {
    await state.saveAdapter.importFile(file);
    await state.persistenceApi.load(DEV_LAB_SAVE_SLOT, {
      stateId: "cassandra-dev-lab-workspace"
    });
    synchronizeRestoredWorkspace();
    workspaceSaveStatus.textContent = `LOADED · ${file.name}`;
    simulationStatus.textContent = "WORKSPACE RESTORED";
  } catch (error) {
    const message = describeLoadFailure(error);
    workspaceSaveStatus.textContent = message;
    simulationStatus.textContent = message;
  }
});

async function startDevLabRuntime() {
  state.saveAdapter = new LocalFileSaveAdapter();
  const runtime = createGameRuntime({
    saveAdapter: state.saveAdapter,
    fixedStepSeconds: 1 / 60,
    maxStepsPerFrame: 120,
    hostSystems: [
      createGameInputSystem({ inputController }),
      createUnitSystem({ definitionLookup: getDefinition }),
      createColonyControlSystem()
    ],
    simulationTasks: [{
      systemId: "game.colony-control",
      update({ deltaSeconds, context }) {
        const control = context.getService("game.colony-control-api");
        const controlState = control.getState();
        if (controlState.drafted) {
          const moved = control.update(deltaSeconds);
          if (moved) {
            refreshWorldMarkers();
            setCameraFollowTarget(moved.entityId, moved.position);
          }
          return;
        }
        let x = Number(heldMovementKeys.has("KeyD")) - Number(heldMovementKeys.has("KeyA"));
        let y = Number(heldMovementKeys.has("KeyS")) - Number(heldMovementKeys.has("KeyW"));
        if (!x && !y) return;
        const length = Math.hypot(x, y);
        const speed = 30;
        moveCameraBy((x / length) * speed * deltaSeconds, (y / length) * speed * deltaSeconds);
      }
    }]
  });
  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    for (const size of [64, 128, 256]) {
      worlds.registerWorld({ worldId: `dev-lab-world-${size}`, type: "dev-lab-test", dimensions: { width: size, height: size }, coordinateSystem: "tiles" });
    }
    worlds.activateWorld(`dev-lab-world-${Number(worldSizeSelect.value)}`);
    state.worldRegistry = worlds;
    state.persistenceApi = context.getService("core.persistence");
    state.unitApi = context.getService("game.unit-api");
    state.inputApi = context.getService("game.input-api");
    state.colonyControlApi = context.getService("game.colony-control-api");
    setWorldMarkers([]);
    clearUnitSelection();
    state.clock = context.getService("core.game-clock");
    advanceRuntime = (deltaSeconds) => runtime.advance(deltaSeconds);
    state.clock.pause("player");
    state.paused = true;
    updateSimulationUi();
    state.animationFrame = requestAnimationFrame(simulationFrame);
    workspaceSaveStatus.textContent = LocalFileSaveAdapter.supportsDirectoryAccess
      ? "NO SAVE FOLDER SELECTED"
      : "FOLDER ACCESS UNAVAILABLE · LOAD .CASS / EXPORT DOWNLOAD";

  } catch (error) {
    simulationStatus.textContent = `DEV LAB STARTUP FAILED · ${error.message}`;
  }
}

loadCanonicalDefinitions();
refreshDatabase();
startDevLabRuntime();
showView("menu");
