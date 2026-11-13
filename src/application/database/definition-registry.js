const definitions = new Map();
const INSTANCE_KINDS = new Set(["unit"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeDefinition(definition) {
  if (!definition || typeof definition !== "object") throw new TypeError("A definition object is required.");
  const {
    schemaVersion = 1, id, name, category, description = "", entityType = null,
    attributes = {}, artwork = null, spawnableAs = []
  } = definition;
  for (const [field, value] of Object.entries({ id, name, category })) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError(`Definition ${field} must be a non-empty string.`);
  }
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new TypeError("Definition schemaVersion must be a positive safe integer.");
  if (entityType !== null && (typeof entityType !== "string" || !entityType.trim())) throw new TypeError("Definition entityType must be a non-empty string or null.");
  if (typeof description !== "string") throw new TypeError("Definition description must be a string.");
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) throw new TypeError("Definition attributes must be an object.");
  if (artwork !== null && (typeof artwork !== "string" || !artwork.trim())) throw new TypeError("Definition artwork must be a non-empty path or null.");
  if (!Array.isArray(spawnableAs) || spawnableAs.some((kind) => typeof kind !== "string" || !INSTANCE_KINDS.has(kind))) {
    throw new TypeError("Definition spawnableAs must contain supported instance kinds.");
  }
  return deepFreeze({
    schemaVersion,
    id: id.trim(),
    name: name.trim(),
    category: category.trim(),
    description,
    entityType: entityType?.trim() ?? null,
    attributes: { ...attributes },
    artwork,
    spawnableAs: [...new Set(spawnableAs)]
  });
}

/** Registers the canonical inspectable definition used by gameplay systems. */
export function registerDefinition(definition) {
  const normalized = normalizeDefinition(definition);
  if (definitions.has(normalized.id)) throw new Error(`Definition already registered: ${normalized.id}`);
  definitions.set(normalized.id, normalized);
  return normalized;
}

/** Full canonical definition for gameplay validation and detail inspection. */
export function getDefinition(id) {
  return definitions.get(id) ?? null;
}

/** Lightweight navigation index; artwork and nested attributes are not returned. */
export function listDefinitionIndex({ category, spawnableAs } = {}) {
  return [...definitions.values()]
    .filter((entry) => !category || entry.category === category)
    .filter((entry) => !spawnableAs || entry.spawnableAs.includes(spawnableAs))
    .map(({ id, name, category: entryCategory, description, entityType, spawnableAs: kinds }) =>
      Object.freeze({ id, name, category: entryCategory, description, entityType, spawnableAs: kinds }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** Async detail boundary; can be backed by split files or remote storage later. */
export async function loadDefinitionDetail(id) {
  return getDefinition(id);
}

export function listDefinitions({ category } = {}) {
  return [...definitions.values()]
    .filter((entry) => !category || entry.category === category)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function getCategories({ spawnableAs } = {}) {
  return [...new Set(listDefinitionIndex({ spawnableAs }).map((entry) => entry.category))].sort();
}

export function clearDefinitionsForTests() {
  definitions.clear();
}
