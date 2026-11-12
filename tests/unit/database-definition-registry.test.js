import test from "node:test";
import assert from "node:assert/strict";
import { registerDefinition, getDefinition, listDefinitions, getCategories, clearDefinitionsForTests } from "../../src/application/database/definition-registry.js";

test("registers and exposes immutable inspectable definitions", () => {
  clearDefinitionsForTests();
  const entry = registerDefinition({ id: "pawn.worker", name: "Worker", category: "Pawn", description: "A test unit.", attributes: { health: 100, speed: 1.2 } });
  assert.equal(getDefinition("pawn.worker").attributes.health, 100);
  assert.deepEqual(getCategories(), ["Pawn"]);
  assert.equal(listDefinitions({ category: "Pawn" }).length, 1);
  assert.throws(() => { entry.attributes.health = 1; }, TypeError);
});

test("rejects invalid and duplicate definitions", () => {
  clearDefinitionsForTests();
  assert.throws(() => registerDefinition({ id: "", name: "Bad", category: "Pawn" }), TypeError);
  registerDefinition({ id: "wall.steel", name: "Steel Wall", category: "Structure" });
  assert.throws(() => registerDefinition({ id: "wall.steel", name: "Duplicate", category: "Structure" }), /already registered/);
  clearDefinitionsForTests();
});
