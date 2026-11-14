import johnyDefinition from "../../content/database/definitions/pawns/johny.json" with { type: "json" };
import { getDefinition, registerDefinition } from "../../../engine/database/definition-registry.js";

const CANONICAL_DEFINITIONS = Object.freeze([johnyDefinition]);

/**
 * Loads version-controlled canonical content into the runtime definition index.
 * The registry is a read-only runtime cache; the source of truth is the content
 * asset stored in src/content/database.
 */
export function loadCanonicalDefinitions() {
  for (const definition of CANONICAL_DEFINITIONS) {
    const existing = getDefinition(definition.id);
    if (existing) continue;
    registerDefinition(definition);
  }
  return Object.freeze(CANONICAL_DEFINITIONS.map(({ id }) => getDefinition(id)));
}
