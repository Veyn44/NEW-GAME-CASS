import { getDefinition, registerDefinition } from "./definition-registry.js";

const loadedPackages = new Map();

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
  const definitionIds = definitions.map((definition) => definition?.id);
  if (definitionIds.some((definitionId) => typeof definitionId !== "string" || !definitionId.trim())) {
    throw new TypeError("Every package definition must have a non-empty id.");
  }
  if (new Set(definitionIds).size !== definitionIds.length) {
    throw new Error(`Definition package "${packageId}" contains duplicate definition IDs.`);
  }

  const existingPackage = loadedPackages.get(packageId);
  if (existingPackage) {
    const sameIds = existingPackage.definitionIds.length === definitionIds.length
      && existingPackage.definitionIds.every((definitionId, index) => definitionId === definitionIds[index]);
    if (!sameIds) throw new Error(`Definition package "${packageId}" was already loaded with different contents.`);
    return existingPackage.definitions;
  }

  for (const definitionId of definitionIds) {
    if (getDefinition(definitionId)) {
      throw new Error(`Definition "${definitionId}" is already registered outside package "${packageId}".`);
    }
  }

  const registered = definitions.map((definition) => registerDefinition(definition));
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
