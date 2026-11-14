import test from "node:test";
import assert from "node:assert/strict";
import { clearDefinitionsForTests, getDefinition } from "../../engine/database/definition-registry.js";
import { loadCassandraDatabase } from "../../cassandra/database/load-cassandra-database.js";

test("Johny is loaded from a version-controlled canonical human definition", () => {
  clearDefinitionsForTests();

  const definitions = loadCassandraDatabase();
  const johny = getDefinition("pawn.johny");

  assert.equal(definitions.length, 1);
  assert.equal(johny.schemaVersion, 1);
  assert.equal(johny.id, "pawn.johny");
  assert.equal(johny.name, "Johny");
  assert.equal(johny.entityType, "human");
  assert.equal(johny.attributes.species, "Human");
  assert.equal(johny.attributes.age, 32);
  assert.equal(johny.attributes.role, null);
  assert.deepEqual(johny.spawnableAs, ["unit"]);
  assert.ok(Object.isFrozen(johny));
  assert.ok(Object.isFrozen(johny.attributes));
});

test("canonical definition loading is idempotent", () => {
  clearDefinitionsForTests();

  loadCassandraDatabase();
  loadCassandraDatabase();

  assert.equal(getDefinition("pawn.johny").attributes.age, 32);
});
