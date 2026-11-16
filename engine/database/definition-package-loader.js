import { normalizeDefinitions, registerDefinitions } from "./definition-registry.js";

const loadedPackages = new Map();

function areDefinitionsEquivalent(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areDefinitionsEquivalent(value, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && areDefinitionsEquivalent(left[key], right[key]));
}

/**
 * Registers a content package in the Engine definition registry.
 * Package identity is stable: loading the same package twice is idempotent,
 * while reusing a package ID for a different definition set is rejected.
 */
export function loadDefinitionPackage({ id, definitions } = {}) {
  if (typeof id !== "string" || !id.trim()) {
    throw new TypeError("Definition package id must be a non-empty string.");
  }
  if (!Array.isArray(definitions)) {
    throw new TypeError("Definition package definitions must be an array.");
  }

  const packageId = id.trim();
  const existingPackage = loadedPackages.get(packageId);
  if (existingPackage) {
    const normalizedDefinitions = normalizeDefinitions(definitions);
    const sameDefinitions = existingPackage.definitions.length === normalizedDefinitions.length
      && existingPackage.definitions.every((definition, index) =>
        areDefinitionsEquivalent(definition, normalizedDefinitions[index]));
    if (!sameDefinitions) {
      throw new Error('Definition package "' + packageId + '" was already loaded with different contents.');
    }
    return existingPackage.definitions;
  }

  // registerDefinitions performs the one normalization pass, validates the
  // complete batch and commits only after every definition has passed.
  const registered = registerDefinitions(definitions);
  const definitionIds = registered.map((definition) => definition.id);
  const result = Object.freeze(registered);
  loadedPackages.set(packageId, Object.freeze({
    definitionIds: Object.freeze([...definitionIds]),
    definitions: result
  }));
  return result;
}

/** Test-only reset; production packages remain registered for the runtime lifetime. */
export function clearDefinitionPackagesForTests() {
  loadedPackages.clear();
}
