const definitions = new Map();

function cloneDefinitionData(value, path = "attributes", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") {
    throw new TypeError(`Definition ${path} must contain only JSON-compatible values.`);
  }
  if (seen.has(value)) throw new TypeError(`Definition ${path} must not contain circular references.`);

  let prototype;
  let keys;
  let isArray;
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
    isArray = Array.isArray(value);
  } catch {
    throw new TypeError(`Definition ${path} could not be inspected safely.`);
  }
  if (isArray ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Definition ${path} must contain only plain objects and arrays.`);
  }

  seen.add(value);
  try {
    if (isArray) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || length < 0) throw new TypeError(`Definition ${path} has an invalid array length.`);
      const copy = new Array(length);
      const indices = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string") throw new TypeError(`Definition ${path} contains a symbol-keyed array property.`);
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) {
          throw new TypeError(`Definition ${path} contains an unsupported array property.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new TypeError(`Definition ${path} contains an accessor or hidden array property.`);
        }
        indices.add(index);
        copy[index] = cloneDefinitionData(descriptor.value, `${path}[${index}]`, seen);
      }
      if (indices.size !== length) throw new TypeError(`Definition ${path} contains a sparse array.`);
      return copy;
    }

    const copy = Object.create(prototype);
    for (const key of keys) {
      if (typeof key !== "string") throw new TypeError(`Definition ${path} contains a symbol-keyed property.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`Definition ${path} contains an accessor or hidden property.`);
      }
      Object.defineProperty(copy, key, {
        value: cloneDefinitionData(descriptor.value, `${path}.${key}`, seen),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return copy;
  } finally {
    seen.delete(value);
  }
}

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
    if (typeof value !== "string" || !value.trim()) throw new TypeError("Definition " + field + " must be a non-empty string.");
  }
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1) throw new TypeError("Definition schemaVersion must be a positive safe integer.");
  if (entityType !== null && (typeof entityType !== "string" || !entityType.trim())) throw new TypeError("Definition entityType must be a non-empty string or null.");
  if (typeof description !== "string") throw new TypeError("Definition description must be a string.");
  if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) throw new TypeError("Definition attributes must be an object.");
  if (artwork !== null && (typeof artwork !== "string" || !artwork.trim())) throw new TypeError("Definition artwork must be a non-empty path or null.");
  const detachedAttributes = cloneDefinitionData(attributes, "attributes");
  const detachedSpawnableAs = cloneDefinitionData(spawnableAs, "spawnableAs");
  if (!Array.isArray(detachedSpawnableAs) || detachedSpawnableAs.some((kind) => typeof kind !== "string" || !kind.trim())) {
    throw new TypeError("Definition spawnableAs must contain non-empty strings.");
  }
  return deepFreeze({
    schemaVersion,
    id: id.trim(),
    name: name.trim(),
    category: category.trim(),
    description,
    entityType: entityType?.trim() ?? null,
    attributes: detachedAttributes,
    artwork,
    spawnableAs: [...new Set(detachedSpawnableAs)]
  });
}

/**
 * Validates and normalizes the complete batch before mutating the registry.
 * A malformed or conflicting definition therefore cannot leave a partially
 * registered package behind.
 */
export function normalizeDefinitions(batch) {
  if (!Array.isArray(batch)) throw new TypeError("Definitions must be provided as an array.");
  return Object.freeze(batch.map(normalizeDefinition));
}

export function registerDefinitions(batch) {
  const normalized = normalizeDefinitions(batch);
  const batchIds = new Set();

  for (const definition of normalized) {
    if (batchIds.has(definition.id)) {
      throw new Error("Duplicate definition ID in registration batch: " + definition.id);
    }
    batchIds.add(definition.id);
    if (definitions.has(definition.id)) {
      throw new Error("Definition already registered: " + definition.id);
    }
  }

  for (const definition of normalized) definitions.set(definition.id, definition);
  return Object.freeze(normalized);
}

/** Registers the canonical inspectable definition used by gameplay systems. */
export function registerDefinition(definition) {
  return registerDefinitions([definition])[0];
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
