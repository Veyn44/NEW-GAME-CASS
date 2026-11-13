import test from "node:test";
import assert from "node:assert/strict";
import {
  registerDefinition, getDefinition, listDefinitions, listDefinitionIndex,
  loadDefinitionDetail, getCategories, clearDefinitionsForTests
} from "../../src/application/database/definition-registry.js";

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

test("rejects invalid and duplicate definitions and unsupported instance kinds", () => {
  clearDefinitionsForTests();
  assert.throws(() => registerDefinition({ id: "", name: "Bad", category: "Pawn" }), TypeError);
  assert.throws(() => registerDefinition({ id: "bad.kind", name: "Bad", category: "Pawn", spawnableAs: ["material"] }), TypeError);
  registerDefinition({ id: "wall.steel", name: "Steel Wall", category: "Structure" });
  assert.throws(() => registerDefinition({ id: "wall.steel", name: "Duplicate", category: "Structure" }), /already registered/);
  clearDefinitionsForTests();
});
