import test from "node:test";
import assert from "node:assert/strict";
import { clearDefinitionsForTests, getDefinition } from "../../engine/database/definition-registry.js";
import { clearDefinitionPackagesForTests, loadDefinitionPackage } from "../../engine/database/definition-package-loader.js";

test("Engine loads generic definition packages and is idempotent for the same package", () => {
  clearDefinitionsForTests();
  clearDefinitionPackagesForTests();
  const packageData = {
    id: "test.materials",
    definitions: [
      { id: "material.iron", name: "Iron", category: "Material", spawnableAs: ["material"] }
    ]
  };
  const first = loadDefinitionPackage(packageData);
  const second = loadDefinitionPackage(packageData);
  assert.equal(first, second);
  assert.equal(getDefinition("material.iron").name, "Iron");
});

test("Engine rejects package ID reuse with a different definition set", () => {
  clearDefinitionsForTests();
  clearDefinitionPackagesForTests();
  loadDefinitionPackage({ id: "test.package", definitions: [{ id: "one", name: "One", category: "Test" }] });
  assert.throws(() => loadDefinitionPackage({
    id: "test.package",
    definitions: [{ id: "two", name: "Two", category: "Test" }]
  }), /different contents/);
});

test("Engine rejects duplicate IDs and collisions with already registered definitions", () => {
  clearDefinitionsForTests();
  clearDefinitionPackagesForTests();
  assert.throws(() => loadDefinitionPackage({
    id: "test.duplicates",
    definitions: [
      { id: "same", name: "One", category: "Test" },
      { id: "same", name: "Two", category: "Test" }
    ]
  }), /duplicate definition IDs/);
  loadDefinitionPackage({ id: "test.first", definitions: [{ id: "taken", name: "Taken", category: "Test" }] });
  assert.throws(() => loadDefinitionPackage({
    id: "test.second",
    definitions: [{ id: "taken", name: "Taken Again", category: "Test" }]
  }), /already registered/);
});

test("invalid later definition does not leave a partially registered package", () => {
  clearDefinitionsForTests();
  clearDefinitionPackagesForTests();

  assert.throws(() => loadDefinitionPackage({
    id: "test.atomic",
    definitions: [
      { id: "valid.first", name: "First", category: "Test" },
      { id: "invalid.second", name: "", category: "Test" }
    ]
  }), /Definition name must be a non-empty string/);

  assert.equal(getDefinition("valid.first"), null);
  assert.equal(getDefinition("invalid.second"), null);

  const loaded = loadDefinitionPackage({
    id: "test.atomic",
    definitions: [
      { id: "valid.first", name: "First", category: "Test" }
    ]
  });
  assert.equal(loaded.length, 1);
  assert.equal(getDefinition("valid.first").name, "First");
});
