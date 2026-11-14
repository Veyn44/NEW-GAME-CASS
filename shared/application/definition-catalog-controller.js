/**
 * Owns a definition catalog UI and asynchronous detail selection.
 * The host supplies registry access and decides what selecting a definition
 * means in its application context.
 */
export function createDefinitionCatalogController({
  elements,
  listDefinitionIndex,
  getCategories,
  loadDefinitionDetail,
  canSelectDefinition = () => false,
  onSelectDefinition = () => {},
  documentRef = globalThis.document
}) {
  if (!elements?.list || !elements?.search || !elements?.category
    || !elements?.inspector || !elements?.selectButton) {
    throw new TypeError("Definition catalog elements are required.");
  }
  if (typeof listDefinitionIndex !== "function"
    || typeof getCategories !== "function"
    || typeof loadDefinitionDetail !== "function") {
    throw new TypeError("Definition catalog registry functions are required.");
  }

  const { list, search, category, inspector, selectButton } = elements;
  let mode = "browse";
  let selectedDefinitionId = null;
  let selectedDefinition = null;
  let detailRequest = 0;

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

  function updateSelectButton() {
    const available = mode === "viewport"
      && Boolean(selectedDefinition)
      && Boolean(canSelectDefinition(selectedDefinition));
    selectButton.hidden = !available;
    selectButton.disabled = !available;
  }

  function showInspectorMessage(message) {
    inspector.replaceChildren();
    const state = documentRef.createElement("p");
    state.className = "database-inspector-state";
    state.textContent = message;
    inspector.append(state);
  }

  function clearSelection() {
    detailRequest += 1;
    selectedDefinitionId = null;
    selectedDefinition = null;
    updateSelectButton();
    showInspectorMessage("Select an entry to inspect its complete definition.");
  }

  async function inspectDefinition(id) {
    const request = ++detailRequest;
    selectedDefinitionId = id;
    selectedDefinition = null;
    updateSelectButton();
    showInspectorMessage("Loading definition details…");

    let definition;
    try {
      definition = await loadDefinitionDetail(id);
    } catch (error) {
      if (request !== detailRequest) return null;
      showInspectorMessage(`Unable to load definition details: ${error?.message ?? String(error)}`);
      return null;
    }

    if (request !== detailRequest) return null;
    if (!definition) {
      showInspectorMessage("Definition details are not available.");
      return null;
    }

    selectedDefinition = definition;
    updateSelectButton();
    inspector.replaceChildren();

    const heading = documentRef.createElement("div");
    heading.className = "database-inspector-heading";
    const categoryLabel = documentRef.createElement("p");
    categoryLabel.className = "eyebrow";
    categoryLabel.textContent = definition.category;
    const title = documentRef.createElement("h2");
    title.textContent = definition.name;
    const identifier = documentRef.createElement("code");
    identifier.textContent = definition.id;
    heading.append(categoryLabel, title, identifier);
    inspector.append(heading);

    if (definition.artwork) {
      const artwork = documentRef.createElement("img");
      artwork.className = "database-artwork";
      artwork.alt = `${definition.name} artwork`;
      artwork.loading = "lazy";
      artwork.src = definition.artwork;
      artwork.addEventListener("error", () => artwork.classList.add("is-unavailable"), { once: true });
      inspector.append(artwork);
    } else {
      const artworkPlaceholder = documentRef.createElement("div");
      artworkPlaceholder.className = "database-artwork-placeholder";
      artworkPlaceholder.textContent = "NO ARTWORK REGISTERED";
      inspector.append(artworkPlaceholder);
    }

    const description = documentRef.createElement("p");
    description.className = "database-description";
    description.textContent = definition.description || "No description provided.";
    inspector.append(description);

    const detailsHeading = documentRef.createElement("h3");
    detailsHeading.className = "database-subheading";
    detailsHeading.textContent = "Complete definition data";
    inspector.append(detailsHeading);

    const attributes = documentRef.createElement("dl");
    attributes.className = "attribute-list database-detail-attributes";
    appendAttributeRows(attributes, definition.attributes);
    if (!attributes.childElementCount) {
      const empty = documentRef.createElement("p");
      empty.className = "database-inspector-state";
      empty.textContent = "No attributes registered.";
      inspector.append(empty);
    } else {
      inspector.append(attributes);
    }

    const metadata = documentRef.createElement("dl");
    metadata.className = "attribute-list database-detail-attributes";
    appendAttributeRows(metadata, {
      "Definition ID": definition.id,
      "Definition schema": definition.schemaVersion,
      "Entity type": definition.entityType ?? "—",
      Category: definition.category,
      "Available for": definition.spawnableAs
    });
    inspector.append(metadata);
    return definition;
  }

  function render() {
    const query = search.value.trim().toLocaleLowerCase();
    const selectedCategory = category.value;
    const entries = listDefinitionIndex().filter((entry) => {
      const matchesCategory = selectedCategory === "all" || entry.category === selectedCategory;
      const haystack = [entry.id, entry.name, entry.description, entry.category]
        .join(" ").toLocaleLowerCase();
      return matchesCategory && (!query || haystack.includes(query));
    });

    list.replaceChildren();
    if (!entries.length) {
      const empty = documentRef.createElement("div");
      empty.className = "database-empty";
      const strong = documentRef.createElement("strong");
      strong.textContent = "Database is ready.";
      const message = documentRef.createElement("span");
      message.textContent = "No definitions are registered in the active content packages.";
      empty.append(strong, message);
      list.append(empty);
      return entries;
    }

    for (const entry of entries) {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "database-index-entry";
      button.setAttribute("aria-pressed", String(selectedDefinitionId === entry.id));
      const title = documentRef.createElement("strong");
      title.textContent = entry.name;
      const categoryLabel = documentRef.createElement("span");
      categoryLabel.textContent = entry.category;
      const description = documentRef.createElement("small");
      description.textContent = entry.description;
      button.append(title, categoryLabel, description);
      button.addEventListener("click", () => {
        for (const sibling of list.querySelectorAll(".database-index-entry")) {
          sibling.setAttribute("aria-pressed", "false");
        }
        button.setAttribute("aria-pressed", "true");
        return inspectDefinition(entry.id);
      });
      list.append(button);
    }
    return entries;
  }

  function populateCategories() {
    category.replaceChildren();
    const all = documentRef.createElement("option");
    all.value = "all";
    all.textContent = "All categories";
    category.append(all);
    for (const item of getCategories()) {
      const option = documentRef.createElement("option");
      option.value = item;
      option.textContent = item;
      category.append(option);
    }
  }

  function refresh() {
    populateCategories();
    return render();
  }

  function open(nextMode = "browse") {
    setMode(nextMode);
    search.value = "";
    category.value = "all";
    refresh();
  }

  function setMode(nextMode) {
    if (nextMode !== "browse" && nextMode !== "viewport") {
      throw new TypeError(`Unsupported definition catalog mode: ${nextMode}`);
    }
    mode = nextMode;
    clearSelection();
  }

  function close() {
    setMode("browse");
    updateSelectButton();
  }

  function selectCurrentDefinition() {
    if (mode !== "viewport" || !selectedDefinition || !canSelectDefinition(selectedDefinition)) return false;
    onSelectDefinition(selectedDefinition);
    return true;
  }

  search.addEventListener("input", render);
  category.addEventListener("change", render);
  selectButton.addEventListener("click", selectCurrentDefinition);

  updateSelectButton();
  return Object.freeze({
    open,
    close,
    refresh,
    render,
    inspectDefinition,
    clearSelection,
    selectCurrentDefinition,
    getMode: () => mode,
    getSelectedDefinition: () => selectedDefinition,
    getSelectedDefinitionId: () => selectedDefinitionId
  });
}
