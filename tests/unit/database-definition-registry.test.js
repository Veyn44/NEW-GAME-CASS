import test from "node:test";
import assert from "node:assert/strict";
import {
  registerDefinition, getDefinition, listDefinitions, listDefinitionIndex,
  loadDefinitionDetail, getCategories, registerDefinitions, clearDefinitionsForTests
} from "../../engine/database/definition-registry.js";

test("registers canonical definitions and exposes a lightweight navigation index", async () => {
  clearDefinitionsForTests();
  const entry = registerDefinition({
    id: "pawn.worker", name: "Worker", category: "Pawn",
    description: "A test unit.", attributes: { health: 100, skills: { mining: 0, research: 5 } },
    artwork: "assets/pawns/worker.png", spawnableAs: ["unit"]
  });
  assert.equal(getDefinition("pawn.worker").attributes.health, 100);
  assert.deepEqual(getCategories(), ["Pawn"]);
  assert.equal(listDefinitions({ category: "Pawn" }).length, 1);
  assert.deepEqual(listDefinitionIndex({ spawnableAs: "unit" }).map(({ id }) => id), ["pawn.worker"]);
  assert.equal(Object.hasOwn(listDefinitionIndex()[0], "artwork"), false);
  assert.equal((await loadDefinitionDetail("pawn.worker")).attributes.skills.research, 5);
  assert.throws(() => { entry.attributes.skills.research = 0; }, TypeError);
  clearDefinitionsForTests();
});

test("filters selection index by supported instance kind", () => {
  clearDefinitionsForTests();
  registerDefinition({ id: "pawn.worker", name: "Worker", category: "Pawn", spawnableAs: ["unit"] });
  registerDefinition({ id: "structure.wall", name: "Wall", category: "Structure" });
  assert.deepEqual(listDefinitionIndex({ spawnableAs: "unit" }).map(({ id }) => id), ["pawn.worker"]);
  assert.deepEqual(getCategories({ spawnableAs: "unit" }), ["Pawn"]);
  clearDefinitionsForTests();
});

test("rejects invalid and duplicate definitions while accepting consumer-defined instance kinds", () => {
  clearDefinitionsForTests();
  assert.throws(() => registerDefinition({ id: "", name: "Bad", category: "Pawn" }), TypeError);
  const material = registerDefinition({ id: "material.iron", name: "Iron", category: "Material", spawnableAs: ["material"] });
  assert.deepEqual(material.spawnableAs, ["material"]);
  assert.throws(() => registerDefinition({ id: "bad.kind", name: "Bad", category: "Pawn", spawnableAs: [""] }), TypeError);
  registerDefinition({ id: "wall.steel", name: "Steel Wall", category: "Structure" });
  assert.throws(() => registerDefinition({ id: "wall.steel", name: "Duplicate", category: "Structure" }), /already registered/);
  clearDefinitionsForTests();
});


test("definition normalization detaches nested input data before deeply freezing it", () => {
  clearDefinitionsForTests();
  const nestedSource = { value: 1 };
  const frozenShallowSource = Object.freeze({ nested: nestedSource });
  const sourceAttributes = {
    mutable: { value: 2 },
    settings: frozenShallowSource
  };

  const definition = registerDefinition({
    id: "pawn.detached",
    name: "Detached",
    category: "Pawn",
    attributes: sourceAttributes
  });

  assert.equal(Object.isFrozen(sourceAttributes), false);
  assert.equal(Object.isFrozen(sourceAttributes.mutable), false);
  sourceAttributes.mutable.value = 99;
  nestedSource.value = 88;

  assert.equal(definition.attributes.mutable.value, 2);
  assert.equal(definition.attributes.settings.nested.value, 1);
  assert.equal(Object.isFrozen(definition.attributes), true);
  assert.equal(Object.isFrozen(definition.attributes.mutable), true);
  assert.equal(Object.isFrozen(definition.attributes.settings), true);
  assert.equal(Object.isFrozen(definition.attributes.settings.nested), true);
  clearDefinitionsForTests();
});

test("definition batches reject cyclic or accessor-backed nested data without partial registration", () => {
  clearDefinitionsForTests();
  const circular = {};
  circular.self = circular;
  const valid = { id: "pawn.valid", name: "Valid", category: "Pawn" };
  const invalid = { id: "pawn.invalid", name: "Invalid", category: "Pawn", attributes: { circular } };

  assert.throws(() => registerDefinitions([valid, invalid]), /circular references/);
  assert.equal(getDefinition("pawn.valid"), null);
  assert.equal(getDefinition("pawn.invalid"), null);

  const accessorAttributes = {};
  Object.defineProperty(accessorAttributes, "value", { enumerable: true, get() { return 1; } });
  assert.throws(() => registerDefinition({
    id: "pawn.accessor", name: "Accessor", category: "Pawn", attributes: accessorAttributes
  }), /accessor or hidden property/);
  assert.equal(getDefinition("pawn.accessor"), null);
  clearDefinitionsForTests();
});
