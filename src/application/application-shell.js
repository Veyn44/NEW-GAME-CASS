import "../adapters/presentation/dev-world-preview.js";
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

const state = {
  databaseMode: "browse",
  selectedDefinitionId: null,
  selectedDefinition: null,
  detailRequest: 0
};

function showView(name) {
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
  renderDatabase();
}

function openDatabase(mode = "browse") {
  setDatabaseMode(mode);
  showView("database");
}

function renderValue(value) {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
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
    id: definition.id,
    category: definition.category,
    spawnableAs: definition.spawnableAs
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
  button.addEventListener("click", () => showView(button.dataset.navigate));
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
  spawnStatus.textContent = "Definition selected. Unit spawning will be enabled when Dev Lab owns a running world session.";
  showView("dev-lab");
});

showView("menu");
