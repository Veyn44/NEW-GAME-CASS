import {
  setWorldMarkers,
  setWorldInteraction,
  setSelectedWorldMarker,
  beginUnitPlacement,
  cancelUnitPlacement
} from "../adapters/presentation/dev-world-preview.js";
import { createGameRuntime } from "../host/create-game-runtime.js";
import { MemorySaveAdapter } from "../core/persistence.js";
import { createUnitSystem } from "../gameplay/unit/unit-system.js";
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
const databaseList = document.querySelector("#database-list");
const databaseSearch = document.querySelector("#database-search");
const databaseCategory = document.querySelector("#database-category");
const databaseInspector = document.querySelector("#database-inspector");
const databaseSelect = document.querySelector("#database-select");
const databaseCancel = document.querySelector("#database-cancel");
const databaseModeLabel = document.querySelector("#database-mode-label");
const devSelectUnit = document.querySelector("#dev-select-unit");
const devSelectedUnit = document.querySelector("#dev-selected-unit");
const spawnButton = document.querySelector("#spawn-unit");
const spawnStatus = document.querySelector("#spawn-status");
const simulationStatus = document.querySelector("#simulation-status");
const pointerStatus = document.querySelector("#pointer-status");
const unitInspector = document.querySelector("#unit-inspector");
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
  spawnCount: 0,
  placementActive: false,
  clock: null,
  paused: true,
  selectedUnitId: null,
  animationFrame: null,
  lastFrameTime: null
};

function showView(name) {
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
  if (name !== "dev-lab" && state.placementActive) cancelUnitPlacement();
  for (const view of views) view.hidden = view.dataset.view !== name;
  document.body.dataset.currentView = name;
  window.scrollTo(0, 0);
  if (name === "dev-lab") window.dispatchEvent(new Event("resize"));
}

function setDatabaseMode(mode) {
  state.databaseMode = mode;
  databaseView.dataset.mode = mode;
  databaseModeLabel.textContent = mode === "select-unit"
    ? "DEV LAB / SELECT UNIT"
    : "CASSANDRA / KNOWLEDGE";
  databaseSelect.hidden = mode !== "select-unit";
  databaseCancel.hidden = mode !== "select-unit";
  databaseSelect.disabled = true;
  databaseSelect.textContent = "Select";
  databaseSearch.value = "";
  databaseCategory.value = "all";
  state.selectedDefinitionId = null;
  state.selectedDefinition = null;
  databaseInspector.replaceChildren();
  populateCategories();
  renderDatabase();
}

function openDatabase(mode = "browse") {
  setDatabaseMode(mode);
  showView("database");
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
  databaseSelect.disabled = true;
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

  databaseSelect.disabled = state.databaseMode !== "select-unit"
    || !definition.spawnableAs.includes("unit");
  if (state.databaseMode === "select-unit" && !definition.spawnableAs.includes("unit")) {
    databaseSelect.textContent = "Not a Unit";
  } else {
    databaseSelect.textContent = "Select";
  }
}

function renderDatabase() {
  const query = databaseSearch.value.trim().toLocaleLowerCase();
  const category = databaseCategory.value;
  const selectionScope = state.databaseMode === "select-unit" ? "unit" : undefined;
  const entries = listDefinitionIndex({ spawnableAs: selectionScope }).filter((entry) => {
    const matchesCategory = category === "all" || entry.category === category;
    const haystack = [entry.id, entry.name, entry.description, entry.category].join(" ").toLocaleLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });

  databaseList.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "database-empty";
    const strong = document.createElement("strong");
    strong.textContent = state.databaseMode === "select-unit" ? "No Unit definitions available." : "Database is ready.";
    const message = document.createElement("span");
    message.textContent = state.databaseMode === "select-unit"
      ? "Register a canonical definition with spawnableAs: [\"unit\"] to make it available in this picker."
      : "No registered game definitions yet. Real definitions will appear here as gameplay content is added.";
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
  for (const category of getCategories({
    spawnableAs: state.databaseMode === "select-unit" ? "unit" : undefined
  })) {
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
    if (button.dataset.navigate === "database") openDatabase("browse");
    else showView(button.dataset.navigate);
  });
}
document.querySelectorAll("[data-back-menu]").forEach((button) =>
  button.addEventListener("click", () => showView("menu"))
);
databaseSearch.addEventListener("input", renderDatabase);
databaseCategory.addEventListener("change", renderDatabase);

devSelectUnit.addEventListener("click", () => openDatabase("select-unit"));
databaseCancel.addEventListener("click", () => showView("dev-lab"));
databaseSelect.addEventListener("click", () => {
  if (state.databaseMode !== "select-unit" || !state.selectedDefinition
    || !state.selectedDefinition.spawnableAs.includes("unit")) return;
  devSelectedUnit.textContent = state.selectedDefinition.name;
  devSelectedUnit.dataset.definitionId = state.selectedDefinition.id;
  devSelectedUnit.hidden = false;
  spawnButton.disabled = true;
  spawnButton.textContent = "Spawn Unit · RUNTIME NOT CONNECTED";
  spawnButton.disabled = !state.unitApi || !state.paused;
  spawnButton.textContent = state.unitApi ? "Spawn Unit" : "Spawn Unit · STARTING";
  spawnStatus.textContent = state.unitApi ? "Ready to create a Unit instance in the test world." : "Starting the Dev Lab world session…";
  showView("dev-lab");
});

spawnButton.addEventListener("click", () => {
  if (state.placementActive) {
    cancelUnitPlacement();
    return;
  }
  const definitionId = devSelectedUnit.dataset.definitionId;
  const definition = getDefinition(definitionId);
  if (!state.unitApi || !definitionId || !definition) return;

  if (!state.paused) return;
  state.placementActive = true;
  clearUnitSelection();
  spawnButton.textContent = "Stop Placing";
  spawnStatus.textContent = `Placing ${definition.name}: move the cursor and left-click to place. Right-click or Escape to cancel.`;
  beginUnitPlacement({
    label: definition.name,
    onPlace(position) {
      try {
        state.unitApi.createUnit({ definitionId, worldId: "dev-lab-world", position });
        state.spawnCount += 1;
        const units = state.unitApi.listUnits();
        setWorldMarkers(units.map((unit) => ({
          x: unit.placement.position.x,
          y: unit.placement.position.y,
          id: unit.id,
          label: getDefinition(unit.definitionId)?.name ?? unit.definitionId
        })));
        spawnStatus.textContent = `${definition.name} placed at ${position.x}, ${position.y}. ${units.length} Unit instance(s) in world. Continue placing or press Escape to finish.`;
      } catch (error) {
        spawnStatus.textContent = `Cannot place ${definition.name}: ${error.message}`;
      }
    },
    onCancel() {
      state.placementActive = false;
      spawnButton.textContent = "Spawn Unit";
      spawnStatus.textContent = `Placement finished. ${state.spawnCount} Unit instance(s) created in this session.`;
    }
  });
});


function clearUnitSelection() {
  state.selectedUnitId = null;
  setSelectedWorldMarker(null);
  unitInspector.hidden = true;
  unitInspector.replaceChildren();
}

function inspectUnit(entityId) {
  if (!state.paused || state.placementActive) return;
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
  setSelectedWorldMarker(unit.id);
  const definition = getDefinition(unit.definitionId);
  unitInspector.replaceChildren();
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "SELECTED UNIT";
  const title = document.createElement("h3");
  title.textContent = definition?.name ?? "Unknown definition";
  const details = document.createElement("dl");
  details.className = "attribute-list unit-instance-details";
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
  hint.textContent = "Instance data is read from the live Unit and World services.";
  unitInspector.append(eyebrow, title, details, hint);
  unitInspector.hidden = false;
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
  resetCameraButton.disabled = !state.paused;
  pointerStatus.textContent = state.paused
    ? "INSPECTION CURSOR"
    : document.pointerLockElement === canvas ? "POINTER LOCKED" : "CLICK MAP TO CAPTURE POINTER";
  spawnButton.disabled = !state.unitApi || !devSelectedUnit.dataset.definitionId || !state.paused;
  if (!state.paused && state.placementActive) cancelUnitPlacement();
  setWorldInteraction({ paused: state.paused, onSelect: inspectUnit });
  if (!state.paused) clearUnitSelection();
}

function requestViewportPointerLock() {
  canvas.focus({ preventScroll: true });
  if (typeof canvas.requestPointerLock !== "function") {
    viewportPanel.dataset.pointerLock = "unsupported";
    return;
  }
  try {
    const request = canvas.requestPointerLock();
    request?.catch?.(() => {
      viewportPanel.dataset.pointerLock = "unavailable";
      pointerStatus.textContent = "POINTER LOCK UNAVAILABLE";
    });
  } catch {
    viewportPanel.dataset.pointerLock = "unavailable";
    pointerStatus.textContent = "POINTER LOCK UNAVAILABLE";
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
  if (document.body.dataset.currentView !== "dev-lab" || isInteractiveTarget(event.target)) return;
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
  if (document.body.dataset.currentView !== "dev-lab" || event.button !== 0) return;
  inputController.pointerDown(event.button);
  if (!state.paused && document.pointerLockElement !== canvas) requestViewportPointerLock();
}, true);

window.addEventListener("pointerup", (event) => {
  inputController.pointerUp(event.button);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.paused) inputController.pointerMove(event.movementX || 0, event.movementY || 0);
});

let pointerLockWasAcquired = false;
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

async function startDevLabRuntime() {
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [createUnitSystem({ definitionLookup: getDefinition })]
  });
  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    worlds.registerWorld({
      worldId: "dev-lab-world",
      type: "dev-lab-test",
      dimensions: { width: 128, height: 128 },
      coordinateSystem: "tiles"
    });
    worlds.activateWorld("dev-lab-world");
    state.unitApi = context.getService("game.unit-api");
    state.clock = context.getService("core.game-clock");
    advanceRuntime = (deltaSeconds) => runtime.advance(deltaSeconds);
    state.clock.pause("player");
    state.paused = true;
    updateSimulationUi();
    state.animationFrame = requestAnimationFrame(simulationFrame);
    spawnButton.disabled = !devSelectedUnit.dataset.definitionId || !state.paused;
    spawnButton.textContent = "Spawn Unit";
    if (devSelectedUnit.dataset.definitionId) {
      spawnStatus.textContent = "Ready to create a Unit instance in the test world.";
    } else {
      spawnStatus.textContent = "Choose a Unit definition from the shared Database.";
    }
  } catch (error) {
    spawnStatus.textContent = `Dev Lab startup failed: ${error.message}`;
    spawnButton.disabled = true;
    spawnButton.textContent = "Spawn Unit · STARTUP FAILED";
  }
}

loadCanonicalDefinitions();
refreshDatabase();
startDevLabRuntime();
showView("menu");
