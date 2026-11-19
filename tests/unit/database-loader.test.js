import test from "node:test";
import assert from "node:assert/strict";
import { clearDefinitionsForTests, getDefinition } from "../../engine/database/definition-registry.js";
import { loadCassandraDatabase } from "../../cassandra/database/load-cassandra-database.js";
import { clearDefinitionPackagesForTests } from "../../engine/database/definition-package-loader.js";

test("Cassandra loads Pawn base stats, family, five primary attributes and Johny", () => {
  clearDefinitionsForTests();
  clearDefinitionPackagesForTests();

  const definitions = loadCassandraDatabase();
  const family = getDefinition("family.pawn");
  const baseStats = getDefinition("base-stats.pawn");
  const johny = getDefinition("pawn.johny");

  assert.equal(definitions.length, 8);
  assert.equal(family.category, "Families");
  assert.equal(family.attributes.baseStatsId, "base-stats.pawn");
  assert.equal(baseStats.category, "BaseStats");
  assert.deepEqual(baseStats.attributes.movement, {
    movementSpeed: 4,
    dodgeDistance: 4
  });
  assert.deepEqual(baseStats.attributes.perception, {
    visionRange: 8,
    visionAngle: 120,
    soundDetectionRange: 8
  });
  assert.deepEqual(baseStats.attributes.endurance, {
    maxHealth: 100,
    maxStamina: 10
  });
  assert.deepEqual(baseStats.attributes.noise, {
    movementNoise: 8
  });
  assert.equal(baseStats.attributes.physical.carryCapacity, 50);
  assert.equal(baseStats.attributes.physical.carryCapacityUnit, "kg");
  assert.ok(Object.isFrozen(baseStats));
  assert.ok(Object.isFrozen(baseStats.attributes));

  assert.deepEqual(family.attributes.attributeIds, [
    "attribute.combat",
    "attribute.farming",
    "attribute.engineering",
    "attribute.medicine",
    "attribute.research"
  ]);
  assert.equal(family.attributes.progression.startingLevel, 1);
  assert.equal(family.attributes.progression.xpCurve, "quadratic");
  assert.equal(family.attributes.progression.xpBase, 10);
  assert.equal(family.attributes.progression.pointsPerLevel, 1);
  assert.equal(family.attributes.subAttributes.unlockAt, 10);
  assert.deepEqual(family.attributes.subAttributes.definitions, []);

  for (const id of family.attributes.attributeIds) {
    const attribute = getDefinition(id);
    assert.ok(attribute, `Expected ${id} to be registered.`);
    assert.equal(attribute.category, "Attributes");
    assert.equal(attribute.attributes.defaultValue, 0);
    assert.equal(attribute.attributes.minimumValue, 0);
    assert.equal(attribute.attributes.subAttributes.unlockAt, 10);
    assert.deepEqual(attribute.attributes.subAttributes.definitions, []);
    assert.ok(Object.isFrozen(attribute));
  }

  assert.equal(johny.schemaVersion, 1);
  assert.equal(johny.id, "pawn.johny");
  assert.equal(johny.name, "Johny");
  assert.equal(johny.entityType, "human");
  assert.equal(johny.familyId, "family.pawn");
  assert.equal(johny.attributes.species, "Human");
  assert.equal(johny.attributes.age, 32);
  assert.equal(johny.attributes.role, null);
  assert.deepEqual(johny.spawnableAs, ["unit"]);
  assert.ok(Object.isFrozen(johny));
  assert.ok(Object.isFrozen(johny.attributes));
  assert.ok(Object.isFrozen(family));
});

test("Cassandra definition loading is idempotent", () => {
  clearDefinitionsForTests();
  clearDefinitionPackagesForTests();

  loadCassandraDatabase();
  loadCassandraDatabase();

  assert.equal(getDefinition("pawn.johny").familyId, "family.pawn");
  assert.equal(getDefinition("family.pawn").attributes.attributeIds.length, 5);
  assert.equal(getDefinition("family.pawn").attributes.baseStatsId, "base-stats.pawn");
  assert.equal(getDefinition("base-stats.pawn").attributes.endurance.maxHealth, 100);
});
