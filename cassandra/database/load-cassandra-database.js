import johnyDefinition from "./definitions/pawns/johny.json" with { type: "json" };
import { loadDefinitionPackage } from "../../engine/database/definition-package-loader.js";

const CASSANDRA_DEFINITIONS = Object.freeze([johnyDefinition]);

/** Loads Cassandra-owned content through the Engine's generic package mechanism. */
export function loadCassandraDatabase() {
  return loadDefinitionPackage({
    id: "cassandra.base-content",
    definitions: CASSANDRA_DEFINITIONS
  });
}
