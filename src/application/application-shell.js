import {
  setWorldMarkers,
  setWorldInteraction,
  setSelectedWorldMarker,
  setWorldPlacement,
  cancelWorldPlacement
} from "../adapters/presentation/dev-world-preview.js";
import { createGameRuntime } from "../host/create-game-runtime.js";
import { MemorySaveAdapter } from "../core/persistence.js";
import { createUnitSystem } from "../gameplay/unit/unit-system.js";
import { createGameInputSystem } from "../gameplay/input/game-input-system.js";
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
const viewportPanel = document.querySelector(".viewport-panel");
const canvas = document.querySelector("#world-canvas");
const worldSizeSelect = document.querySelector("#world-size");
const gridVisible = document.querySelector("#grid-visible");
const resetCameraButton = document.querySelector("#reset-camera");
const inputController = createViewportInputController();

const state = {
  databaseMode: "browse",
  selectedDefinitionId: null,
  selectedDefinition: null,
  detailRequest: 0,
  unitApi: null,
  inputApi: null,
  clock: null,
  worldRegistry: null,
  paused: true,
  selectedUnitId: null,
  selectedObject: null,
  viewportDatabaseOpen: false,
  placementActive: false,
  animationFrame: null,
  lastFrameTime: null
};

function showView(name) {
  if (state.viewportDatabaseOpen && name !== "dev-lab") closeViewportDatabase();
  const currentView = document.body.dataset.currentView;
  if (currentView === "dev-lab" && name !== "dev-lab") {
    if (!state.paused) {
      inputController.pause();
      state.clock?.pause("player");
      state.paused = true;
    }
    inputController.clearForFocusLoss();
    if (state.clock && !state.clock.hasPauseReason("player")) state.clock.pause("player");
    if (document.pointerLockElement === canvas) document.exitPointerLock();
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
}

function beginWorldPlacement(definition) {
  if (!state.paused || !state.unitApi || !state.worldRegistry
    || !definition || !definition.spawnableAs.includes("unit")) return;
  closeViewportDatabase();
  clearUnitSelection();
  state.placementActive = true;
  viewportDatabaseButton.disabled = true;
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
        state.placementActive = false;
        viewportDatabaseButton.disabled = !state.paused;
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
  databaseInspector.replaceChildren();

  const loading = document.createElement("p");
  loading.className = "database-inspector-state";
  loading.textContent = "Loading definition details…";
  databaseInspector.append(loading);

  const definition = await loadDefinitionDetail(id);
  if (request !== state.detailRequest || !definition) return;

  state.selectedDefinition = definition;
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

  if (state.databaseMode === "viewport" && definition.spawnableAs.includes("unit")) {
    const actions = document.createElement("div");
    actions.className = "database-selection-actions";
    const select = document.createElement("button");
    select.type = "button";
    select.className = "database-select-button";
    select.textContent = "SELECT";
    select.addEventListener("click", () => beginWorldPlacement(definition));
    actions.append(select);
    databaseInspector.append(actions);
  }
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
    else showView(button.dataset.navigate);
  });
}
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
  quickSelectArtwork.hidden = true;
  quickSelectArtwork.removeAttribute("src");
  quickSelectArtworkEmpty.hidden = false;
  quickSelectName.textContent = "No selection";
  quickSelectSummary.textContent = "Select an object in the paused world.";
}

function inspectUnit(entityId) {
  if (!state.paused) return;
  inputController.beginInspection();
  if (!entityId) {
    clearUnitSelection();
    return;
  }
  const unit = state.unitApi?.getUnit(entityId);
  if (!unit) {
    clearUnitSelection();
    return;
  }
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
  quickSelectInfo.disabled = false;
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
  simulationStatus.textContent = state.paused
    ? "PAUSED · Space to resume"
    : "RUNNING · Space to pause";
  simulationStatus.dataset.state = state.paused ? "paused" : "running";
  viewportPanel.dataset.paused = String(state.paused);
  viewportPanel.dataset.inputMode = state.paused ? "paused" : "running";
  worldSizeSelect.disabled = !state.paused;
  gridVisible.disabled = !state.paused;
  viewportDatabaseButton.disabled = !state.paused || state.placementActive;
  resetCameraButton.disabled = !state.paused;
  pointerStatus.textContent = state.paused
    ? "INSPECTION CURSOR"
    : document.pointerLockElement === canvas ? "POINTER LOCKED" : "CLICK MAP TO CAPTURE POINTER";
  setWorldInteraction({ paused: state.paused, onSelect: inspectUnit });
  if (!state.paused) clearUnitSelection();
}

function failPointerLock() {
  viewportPanel.dataset.pointerLock = "unavailable";
  pointerStatus.textContent = "POINTER LOCK UNAVAILABLE · PAUSED";
  if (!state.paused) {
    inputController.pause();
    state.clock?.pause("player");
    state.paused = true;
    updateSimulationUi();
    pointerStatus.textContent = "POINTER LOCK UNAVAILABLE · PAUSED";
  }
}

function requestViewportPointerLock() {
  canvas.focus({ preventScroll: true });
  if (typeof canvas.requestPointerLock !== "function") {
    failPointerLock();
    return;
  }
  try {
    const request = canvas.requestPointerLock();
    request?.catch?.(failPointerLock);
  } catch {
    failPointerLock();
  }
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
      requestViewportPointerLock();
    }
  } else {
    inputController.pause();
    state.clock.pause("player");
    state.paused = state.clock.paused;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  updateSimulationUi();
}

function simulationFrame(timestamp) {
  if (state.lastFrameTime !== null && state.unitApi) {
    const elapsedSeconds = Math.min(0.25, Math.max(0, (timestamp - state.lastFrameTime) / 1000));
    try {
      // The Core scheduler and Game Clock are the authoritative simulation gate.
      // Rendering and input remain responsive while the clock is paused.
      runtimeAdvance(elapsedSeconds);
      const clockPaused = state.clock?.paused ?? true;
      if (clockPaused !== state.paused) {
        if (clockPaused) {
          inputController.pause();
          if (document.pointerLockElement === canvas) document.exitPointerLock();
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
      if (document.pointerLockElement === canvas) document.exitPointerLock();
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

function isInteractiveTarget(target) {
  return target instanceof HTMLElement && (target.isContentEditable
    || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName));
}

window.addEventListener("keydown", (event) => {
  if (document.body.dataset.currentView !== "dev-lab") return;
  if (state.placementActive && event.code === "Escape") {
    event.preventDefault();
    cancelPlacement();
    return;
  }
  if (isInteractiveTarget(event.target)) return;
  if (event.code === "Space" && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    toggleSimulationPause();
    return;
  }
  if (!state.paused) {
    inputController.keyDown(event.code);
    if (/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right))$/.test(event.code)) {
      event.preventDefault();
    }
  }
});

window.addEventListener("keyup", (event) => {
  inputController.keyUp(event.code);
});

canvas.addEventListener("pointerdown", (event) => {
  if (document.body.dataset.currentView !== "dev-lab" || ![0, 2].includes(event.button)) return;
  inputController.pointerDown(event.button);
  if (!state.paused && event.button === 0 && document.pointerLockElement !== canvas) {
    requestViewportPointerLock();
  }
}, true);

window.addEventListener("pointerup", (event) => {
  inputController.pointerUp(event.button);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.paused) inputController.pointerMove(event.movementX || 0, event.movementY || 0);
});

let pointerLockWasAcquired = false;
document.addEventListener("pointerlockerror", failPointerLock);

document.addEventListener("pointerlockchange", () => {
  const locked = document.pointerLockElement === canvas;
  viewportPanel.dataset.pointerLocked = String(locked);
  if (locked) pointerLockWasAcquired = true;
  pointerStatus.textContent = state.paused
    ? "INSPECTION CURSOR"
    : locked ? "POINTER LOCKED" : "CLICK MAP TO CAPTURE POINTER";

  // Escape or browser-driven Pointer Lock loss must not leave active gameplay
  // running with an unrestricted pointer.
  if (!locked && pointerLockWasAcquired && !state.paused) {
    inputController.pause();
    state.clock?.pause("player");
    state.paused = true;
    updateSimulationUi();
  }
});

function handleFocusLoss() {
  if (!state.paused && state.clock) {
    inputController.pause();
    state.clock.pause("player");
    state.paused = true;
  }
  inputController.clearForFocusLoss();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  updateSimulationUi();
}

window.addEventListener("blur", handleFocusLoss);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") handleFocusLoss();
});

viewportDatabaseButton.addEventListener("click", openViewportDatabase);

quickSelectInfo.addEventListener("click", () => {
  if (!state.paused || !state.selectedObject) return;
  quickSelectDetails.hidden = !quickSelectDetails.hidden;
  quickSelectInfo.textContent = quickSelectDetails.hidden ? "INFO" : "HIDE INFO";
});

worldSizeSelect.addEventListener("change", () => {
  if (!state.paused || !state.worldRegistry) return;
  const size = Number(worldSizeSelect.value);
  state.worldRegistry.activateWorld(`dev-lab-world-${size}`);
  clearUnitSelection();
});

async function startDevLabRuntime() {
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [
      createGameInputSystem({ inputController }),
      createUnitSystem({ definitionLookup: getDefinition })
    ]
  });
  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    for (const size of [64, 128, 256]) {
      worlds.registerWorld({ worldId: `dev-lab-world-${size}`, type: "dev-lab-test", dimensions: { width: size, height: size }, coordinateSystem: "tiles" });
    }
    worlds.activateWorld(`dev-lab-world-${Number(worldSizeSelect.value)}`);
    state.worldRegistry = worlds;
    state.unitApi = context.getService("game.unit-api");
    state.inputApi = context.getService("game.input-api");
    setWorldMarkers([]);
    clearUnitSelection();
    state.clock = context.getService("core.game-clock");
    advanceRuntime = (deltaSeconds) => runtime.advance(deltaSeconds);
    state.clock.pause("player");
    state.paused = true;
    updateSimulationUi();
    state.animationFrame = requestAnimationFrame(simulationFrame);

  } catch (error) {
    simulationStatus.textContent = `DEV LAB STARTUP FAILED · ${error.message}`;
  }
}

loadCanonicalDefinitions();
refreshDatabase();
startDevLabRuntime();
showView("menu");
