import pawnFamily from "./families/pawn.json" with { type: "json" };
import combatAttribute from "./definitions/attributes/combat.json" with { type: "json" };
import farmingAttribute from "./definitions/attributes/farming.json" with { type: "json" };
import engineeringAttribute from "./definitions/attributes/engineering.json" with { type: "json" };
import medicineAttribute from "./definitions/attributes/medicine.json" with { type: "json" };
import researchAttribute from "./definitions/attributes/research.json" with { type: "json" };
import johnyDefinition from "./definitions/pawns/johny.json" with { type: "json" };
import { loadDefinitionPackage } from "../../engine/database/definition-package-loader.js";

const CASSANDRA_DEFINITIONS = Object.freeze([
  pawnFamily,
  combatAttribute,
  farmingAttribute,
  engineeringAttribute,
  medicineAttribute,
  researchAttribute,
  johnyDefinition
]);

/** Loads Cassandra-owned families, attributes and entity definitions. */
export function loadCassandraDatabase() {
  return loadDefinitionPackage({
    id: "cassandra.base-content",
    definitions: CASSANDRA_DEFINITIONS
  });
}
