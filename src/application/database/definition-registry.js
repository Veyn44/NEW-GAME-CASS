const definitions = new Map();

function normalizeDefinition(definition) {
  if (!definition || typeof definition !== "object") throw new TypeError("A definition object is required.");
  const { id, name, category, description = "", attributes = {} } = definition;
  for (const [field, value] of Object.entries({ id, name, category })) {
    if (typeof value !== "string" || !value.trim()) throw new TypeError(`Definition ${field} must be a non-empty string.`);
  }
  if (typeof description !== "string") throw new TypeError("Definition description must be a string.");
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) throw new TypeError("Definition attributes must be an object.");
  return Object.freeze({
    id: id.trim(),
    name: name.trim(),
    category: category.trim(),
    description,
    attributes: Object.freeze({ ...attributes })
  });
}

/**
 * Registers the canonical inspectable definition used by gameplay systems.
 * Runtime instances and their mutable state do not belong in this catalog.
 */
export function registerDefinition(definition) {
  const normalized = normalizeDefinition(definition);
  if (definitions.has(normalized.id)) throw new Error(`Definition already registered: ${normalized.id}`);
  definitions.set(normalized.id, normalized);
  return normalized;
}

export function getDefinition(id) {
  return definitions.get(id) ?? null;
}

export function listDefinitions({ category } = {}) {
  return [...definitions.values()]
    .filter((entry) => !category || entry.category === category)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export function getCategories() {
  return [...new Set([...definitions.values()].map((entry) => entry.category))].sort();
}

export function clearDefinitionsForTests() {
  definitions.clear();
}
