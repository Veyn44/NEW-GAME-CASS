import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { registerDefinition, getDefinition, clearDefinitionsForTests } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";

function setup({ movementPolicy } = {}) {
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
    hostSystems: [createUnitSystem({ definitionLookup: getDefinition, movementPolicy })]
  });
  return { runtime };
}

async function startWithWorld(options = {}) {
  const setupResult = setup(options);
  const context = await setupResult.runtime.start();
  const worlds = context.getService("core.world-registry");
  worlds.registerWorld({
    worldId: "unit-test-world",
    type: "test",
    dimensions: { width: 128, height: 128 },
    grid: { width: 128, height: 128 },
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
    assert.deepEqual(unit.position, { x: 12.5, y: 34.5 });
    assert.deepEqual(unit.placement.position, { x: 12.5, y: 34.5 });
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

test("Unit system preserves continuous World Context placement for non-grid worlds", async () => {
  const state = await startWithWorld();
  try {
    const worlds = state.context.getService("core.world-registry");
    worlds.registerWorld({
      worldId: "unit-test-non-grid",
      type: "test.non-grid",
      dimensions: { width: 40, height: 30 }
    });
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-non-grid",
      position: { x: 5, y: 6 }
    });
    assert.deepEqual(unit.position, { x: 5, y: 6 });
    assert.deepEqual(unit.placement.position, { x: 5, y: 6 });
    assert.equal(state.context.getService("core.spatial-composition").getEntityOccupancy(unit.id), null);

    const moved = state.units.moveUnit(unit.id, { x: 5.25, y: 6.75 });
    assert.deepEqual(moved.position, { x: 5.25, y: 6.75 });
    assert.deepEqual(moved.placement.position, { x: 5.25, y: 6.75 });
    assert.equal(state.units.removeUnit(unit.id), true);
    assert.equal(state.context.getService("core.entity-registry").get(unit.id).status, "removed");
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
    assert.deepEqual(restored.position, { x: 19.5, y: 21.5 });
    assert.deepEqual(restored.placement.position, { x: 19.5, y: 21.5 });
    assert.equal(state.context.getService("core.entity-registry").get(unit.id).kind, "unit");
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});


test("Unit movement accepts fractional world coordinates and persists them across restore", async () => {
  const state = await startWithWorld();
  try {
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 19, y: 21 }
    });
    const moved = state.units.moveUnit(unit.id, { x: 19.25, y: 21.75 });
    assert.deepEqual(moved.position, { x: 19.25, y: 21.75 });
    assert.deepEqual(moved.placement.position, { x: 19.5, y: 21.5 });

    const persistence = state.context.getService("core.persistence");
    await persistence.save("unit-fractional", { stateId: "unit-fractional-state" });
    state.units.moveUnit(unit.id, { x: 30, y: 30 });
    await persistence.load("unit-fractional", { stateId: "unit-fractional-state" });
    assert.deepEqual(state.units.getUnit(unit.id).position, { x: 19.25, y: 21.75 });
    assert.deepEqual(state.units.getUnit(unit.id).placement.position, { x: 19.5, y: 21.5 });
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Grid occupancy advances only when fractional movement crosses a cell boundary", async () => {
  const state = await startWithWorld();
  try {
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 19, y: 21 }
    });
    const spatial = state.context.getService("core.spatial-composition");
    assert.deepEqual(spatial.getCellEntities("unit-test-world", { x: 19, y: 21 }), [unit.id]);

    const withinCell = state.units.moveUnit(unit.id, { x: 19.9, y: 21.9 });
    assert.deepEqual(withinCell.position, { x: 19.9, y: 21.9 });
    assert.deepEqual(withinCell.placement.position, { x: 19.5, y: 21.5 });
    assert.deepEqual(spatial.getCellEntities("unit-test-world", { x: 19, y: 21 }), [unit.id]);

    const crossed = state.units.moveUnit(unit.id, { x: 20.1, y: 21.9 });
    assert.deepEqual(crossed.position, { x: 20.1, y: 21.9 });
    assert.deepEqual(crossed.placement.position, { x: 20.5, y: 21.5 });
    assert.deepEqual(spatial.getCellEntities("unit-test-world", { x: 19, y: 21 }), []);
    assert.deepEqual(spatial.getCellEntities("unit-test-world", { x: 20, y: 21 }), [unit.id]);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Cassandra movement policy can reject a cell transition without changing progress or occupancy", async () => {
  const state = await startWithWorld({ movementPolicy: () => false });
  try {
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 19, y: 21 }
    });
    assert.throws(
      () => state.units.moveUnit(unit.id, { x: 20.1, y: 21.5 }),
      { code: "POLICY_REJECTED" }
    );
    assert.deepEqual(state.units.getUnit(unit.id).position, { x: 19.5, y: 21.5 });
    assert.deepEqual(
      state.context.getService("core.spatial-composition").getCellEntities("unit-test-world", { x: 19, y: 21 }),
      [unit.id]
    );
    assert.deepEqual(
      state.context.getService("core.spatial-composition").getCellEntities("unit-test-world", { x: 20, y: 21 }),
      []
    );
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Unit movement clamps to the world edge without producing an invalid placement", async () => {
  const state = await startWithWorld();
  try {
    const unit = state.units.createUnit({
      definitionId: "unit.test-worker",
      worldId: "unit-test-world",
      position: { x: 127, y: 127 }
    });
    const moved = state.units.moveUnit(unit.id, { x: 140, y: 140 });
    assert.ok(moved.position.x < 128);
    assert.ok(moved.position.y < 128);
    assert.deepEqual(moved.placement.position, { x: 127.5, y: 127.5 });
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});
