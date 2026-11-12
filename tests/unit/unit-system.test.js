import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../src/host/create-game-runtime.js";
import { MemorySaveAdapter } from "../../src/core/persistence.js";
import { registerDefinition, getDefinition, clearDefinitionsForTests } from "../../src/application/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";

function setup() {
  clearDefinitionsForTests();
  registerDefinition({
    id: "unit.test-worker",
    name: "Test Worker",
    category: "Units",
    description: "A test-only canonical Unit definition.",
    attributes: {}
  });
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [createUnitSystem({ definitionLookup: getDefinition })]
  });
  return { runtime };
}

async function startWithWorld() {
  const setupResult = setup();
  const context = await setupResult.runtime.start();
  const worlds = context.getService("core.world-registry");
  worlds.registerWorld({
    worldId: "unit-test-world",
    type: "test",
    dimensions: { width: 128, height: 128 },
    coordinateSystem: "tiles"
  });
  worlds.activateWorld("unit-test-world");
  return { ...setupResult, context, units: context.getService("game.unit-api") };
}

test("Unit system creates a Unit with one Core identity and one world placement", async () => {
  const state = await startWithWorld();
  try {
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 12, y: 34 }
    });
    const identity = state.context.getService("core.entity-registry").get(unit.id);

    assert.equal(unit.definitionId, "unit.test-worker");
    assert.equal(identity.kind, "unit");
    assert.equal(identity.status, "active");
    assert.deepEqual(unit.placement.position, { x: 12, y: 34 });
    assert.equal(state.units.listUnits().length, 1);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Unit creation rejects unknown definitions and non-integer/out-of-bounds tiles before identity allocation", async () => {
  const state = await startWithWorld();
  try {
    const entities = state.context.getService("core.entity-registry");
    assert.throws(() => state.units.createUnit({
      definitionId: "unit.missing",
      worldId: "unit-test-world",
      position: { x: 1, y: 1 }
    }), { code: "UNKNOWN_DEFINITION" });
    assert.throws(() => state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 1.5, y: 1 }
    }), { code: "INVALID_POSITION" });
    assert.throws(() => state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 128, y: 1 }
    }), { code: "POSITION_OUT_OF_BOUNDS" });
    assert.equal(entities.list({ kind: "unit" }).length, 0);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Unit removal clears placement and retires its Core identity", async () => {
  const state = await startWithWorld();
  try {
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 4, y: 8 }
    });
    assert.equal(state.units.removeUnit(unit.id), true);
    assert.equal(state.units.removeUnit(unit.id), false);
    assert.equal(state.units.getUnit(unit.id), null);
    assert.equal(state.context.getService("core.world-context").getPlacement(unit.id), null);
    assert.equal(state.context.getService("core.entity-registry").get(unit.id).status, "removed");
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Unit domain records restore transactionally with Core identity and placement", async () => {
  const state = await startWithWorld();
  try {
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 19, y: 21 }
    });
    const persistence = state.context.getService("core.persistence");
    await persistence.save("unit-test", { stateId: "unit-test-state" });
    state.units.removeUnit(unit.id);
    assert.equal(state.units.getUnit(unit.id), null);

    await persistence.load("unit-test", { stateId: "unit-test-state" });
    const restored = state.units.getUnit(unit.id);
    assert.equal(restored.definitionId, "unit.test-worker");
    assert.deepEqual(restored.placement.position, { x: 19, y: 21 });
    assert.equal(state.context.getService("core.entity-registry").get(unit.id).kind, "unit");
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});
