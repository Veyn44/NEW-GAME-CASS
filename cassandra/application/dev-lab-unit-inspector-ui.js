import { getDefinition } from "../../engine/database/definition-registry.js";

const MARKUP = `
  <aside class="quick-select" data-role="quick-select" aria-label="Quick Select" hidden>
    <div class="quick-select-heading"><span class="eyebrow">QUICK SELECT</span><span data-role="quick-select-kind">OBJECT</span></div>
    <div class="quick-select-preview">
      <img data-role="quick-select-artwork" alt="" hidden>
      <span data-role="quick-select-artwork-empty">NO SPRITE</span>
    </div>
    <h2 data-role="quick-select-name">No selection</h2>
    <p data-role="quick-select-summary">Select an object in the paused world.</p>
    <button data-role="quick-select-info" type="button" disabled>INFO</button>
    <section data-role="quick-select-details" class="quick-select-details" hidden></section>
  </aside>
  <aside class="unit-profile" data-role="unit-profile" aria-label="Unit profile" aria-modal="true" role="dialog" hidden>
    <header class="unit-profile-header">
      <div><p class="eyebrow">CASSANDRA / PERSONNEL FILE</p><h2 data-role="unit-profile-name">Unit profile</h2></div>
      <button data-role="unit-profile-close" type="button" aria-label="Close profile">CLOSE ✕</button>
    </header>
    <div class="unit-profile-body">
      <div class="unit-profile-portrait">
        <img data-role="unit-profile-artwork" alt="" hidden>
        <span data-role="unit-profile-artwork-empty">PORTRAIT NOT AVAILABLE</span>
      </div>
      <div class="unit-profile-intro"><span data-role="unit-profile-category" class="unit-profile-tag">UNIT</span><p data-role="unit-profile-description"></p></div>
      <section class="unit-profile-section"><h3>PERSONAL RECORD</h3><dl data-role="unit-profile-attributes" class="unit-profile-attributes"></dl></section>
      <footer class="unit-profile-footer"><span data-role="unit-profile-instance">LIVE WORLD INSTANCE</span><span data-role="unit-profile-location"></span></footer>
    </div>
  </aside>
`;

function renderValue(value) {
  if (value === null) return "—";
  if (Array.isArray(value)) return value.length ? value.map(renderValue).join(", ") : "None";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function appendAttributeRows(documentRef, container, value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (child && typeof child === "object" && !Array.isArray(child)) {
        appendAttributeRows(documentRef, container, child, path);
      } else {
        const term = documentRef.createElement("dt");
        term.textContent = path;
        const detail = documentRef.createElement("dd");
        detail.textContent = renderValue(child);
        container.append(term, detail);
      }
    }
    return;
  }
  const term = documentRef.createElement("dt");
  term.textContent = prefix || "Value";
  const detail = documentRef.createElement("dd");
  detail.textContent = renderValue(value);
  container.append(term, detail);
}

const ROLES = [
  "quick-select", "quick-select-kind", "quick-select-artwork",
  "quick-select-artwork-empty", "quick-select-name", "quick-select-summary",
  "quick-select-info", "quick-select-details", "unit-profile",
  "unit-profile-close", "unit-profile-name", "unit-profile-artwork",
  "unit-profile-artwork-empty", "unit-profile-category",
  "unit-profile-description", "unit-profile-attributes",
  "unit-profile-instance", "unit-profile-location"
];

/**
 * Cassandra-owned Unit inspection UI hosted in a neutral application mount.
 * The Dev Lab receives only the small imperative contract returned here.
 */
export function createCassandraDevLabUnitInspectorUi({
  root,
  gameplayApi,
  documentRef = document,
  definitionLookup = getDefinition,
  elements = null
} = {}) {
  if (!root || !gameplayApi) {
    throw new TypeError("Cassandra Unit inspector UI requires a mount root and gameplay API.");
  }

  if (!elements) {
    root.innerHTML = MARKUP;
    elements = Object.fromEntries(ROLES.map((role) => [
      role.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()),
      root.querySelector(`[data-role="${role}"]`)
    ]));
  }

  const ui = elements;
  for (const role of ROLES) {
    const key = role.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!ui[key]) throw new TypeError(`Cassandra Unit inspector UI is missing "${role}".`);
  }

  let selectedUnitId = null;
  let paused = true;

  function closeProfile() {
    ui.unitProfile.hidden = true;
    ui.quickSelectInfo.textContent = "INFO";
  }

  function clearSelection() {
    selectedUnitId = null;
    ui.quickSelect.hidden = true;
    ui.quickSelectInfo.disabled = true;
    ui.quickSelectDetails.hidden = true;
    ui.quickSelectDetails.replaceChildren();
    closeProfile();
    ui.quickSelectArtwork.hidden = true;
    ui.quickSelectArtwork.removeAttribute("src");
    ui.quickSelectArtworkEmpty.hidden = false;
    ui.quickSelectName.textContent = "No selection";
    ui.quickSelectSummary.textContent = "Select an object in the world.";
    return null;
  }

  function inspectUnit(entityId) {
    const controlState = gameplayApi.getControlState();
    if (controlState?.drafted && controlState.leaderId) entityId = controlState.leaderId;
    if (!entityId) return clearSelection();

    const unit = gameplayApi.getUnit(entityId);
    if (!unit) return clearSelection();

    closeProfile();
    selectedUnitId = unit.id;
    const definition = definitionLookup(unit.definitionId);
    ui.quickSelectKind.textContent = "UNIT";
    ui.quickSelectName.textContent = definition?.name ?? "Unknown definition";
    ui.quickSelectSummary.textContent = definition?.description ?? "Live world instance.";
    ui.quickSelectArtwork.hidden = !definition?.artwork;
    ui.quickSelectArtworkEmpty.hidden = Boolean(definition?.artwork);
    if (definition?.artwork) {
      ui.quickSelectArtwork.src = definition.artwork;
      ui.quickSelectArtwork.alt = definition.name;
    } else {
      ui.quickSelectArtwork.removeAttribute("src");
    }
    ui.quickSelectInfo.disabled = !paused;
    ui.quickSelectDetails.replaceChildren();
    const details = documentRef.createElement("dl");
    details.className = "attribute-list quick-select-attributes";
    appendAttributeRows(documentRef, details, {
      "Instance ID": unit.id,
      "Definition": definition?.name ?? unit.definitionId,
      "Definition ID": unit.definitionId,
      "World": unit.placement?.worldId ?? "—",
      "Tile X": unit.placement?.position?.x ?? "—",
      "Tile Y": unit.placement?.position?.y ?? "—"
    });
    appendAttributeRows(documentRef, details, {
      "Entity type": definition?.entityType ?? "—",
      "Canonical attributes": definition?.attributes ?? {}
    });
    const hint = documentRef.createElement("p");
    hint.className = "dev-note";
    hint.textContent = "Live instance data supplied by Unit and World services.";
    ui.quickSelectDetails.append(details, hint);
    ui.quickSelectDetails.hidden = false;
    ui.quickSelect.hidden = false;
    return unit;
  }

  function openProfile() {
    if (!paused || !selectedUnitId) return;
    const unit = gameplayApi.getUnit(selectedUnitId);
    if (!unit) {
      clearSelection();
      return;
    }
    const definition = definitionLookup(unit.definitionId);
    ui.unitProfileName.textContent = definition?.name ?? "Unknown unit";
    ui.unitProfileCategory.textContent = definition?.category ?? "UNIT";
    ui.unitProfileDescription.textContent = definition?.description ?? "No personal record is available.";
    ui.unitProfileArtwork.hidden = !definition?.artwork;
    ui.unitProfileArtworkEmpty.hidden = Boolean(definition?.artwork);
    if (definition?.artwork) {
      ui.unitProfileArtwork.src = definition.artwork;
      ui.unitProfileArtwork.alt = definition.name ?? "Unit portrait";
    } else {
      ui.unitProfileArtwork.removeAttribute("src");
    }
    ui.unitProfileAttributes.replaceChildren();
    const attributes = definition?.attributes ?? {};
    if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
      appendAttributeRows(documentRef, ui.unitProfileAttributes, attributes);
    } else {
      appendAttributeRows(documentRef, ui.unitProfileAttributes, { Record: attributes });
    }
    if (!ui.unitProfileAttributes.childElementCount) {
      appendAttributeRows(documentRef, ui.unitProfileAttributes, { Record: "No personal attributes recorded." });
    }
    ui.unitProfileInstance.textContent = "LIVE WORLD INSTANCE";
    ui.unitProfileLocation.textContent = unit.placement?.position
      ? `LOCATION · ${unit.placement.position.x}, ${unit.placement.position.y}`
      : "LOCATION · UNKNOWN";
    ui.unitProfile.hidden = false;
    ui.quickSelectInfo.textContent = "CLOSE INFO";
  }

  ui.quickSelectInfo.addEventListener("click", () => {
    if (ui.unitProfile.hidden) openProfile();
    else closeProfile();
  });
  ui.unitProfileClose.addEventListener("click", closeProfile);

  return Object.freeze({
    inspectUnit,
    clearSelection,
    closeProfile,
    isProfileOpen() {
      return !ui.unitProfile.hidden;
    },
    getSelectedUnitId() {
      return selectedUnitId;
    },
    setPaused(value) {
      paused = Boolean(value);
      ui.quickSelectInfo.disabled = !paused || !selectedUnitId;
    }
  });
}
