import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { registerDefinition, getDefinition, clearDefinitionsForTests } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createInputSystem } from "../../engine/input/input-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createViewportInputController } from "../../dev-lab/input/viewport-input-controller.js";

async function setup() {
  clearDefinitionsForTests();
  registerDefinition({
    id: "pawn.johny",
    name: "Johny",
    category: "Pawns",
    description: "Temporary Phase 2 Colony Leader.",
    attributes: {}
  });
  const inputController = createViewportInputController();
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    fixedStepSeconds: 1 / 60,
    hostSystems: [
      createInputSystem({ inputController }),
      createUnitSystem({ definitionLookup: getDefinition }),
      createColonyControlSystem()
    ]
  });
  const context = await runtime.start();
  const worlds = context.getService("core.world-registry");
  worlds.registerWorld({
    worldId: "colony-test-world",
    type: "test",
    dimensions: { width: 128, height: 128 },
    coordinateSystem: "tiles"
  });
  worlds.activateWorld("colony-test-world");
  const units = context.getService("game.unit-api");
  const control = context.getService("game.colony-control-api");
  const leader = units.createUnit({
    definitionId: "pawn.johny",
    worldId: "colony-test-world",
    position: { x: 20, y: 20 }
  });
  return { runtime, context, inputController, units, control, leader };
}

test("Draft targets the Colony Leader by stable Unit ID and moves at four tiles per second", async () => {
  const state = await setup();
  try {
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);
    state.inputController.resume();
    state.inputController.keyDown("KeyD");

    const result = state.control.update(0.25);
    assert.equal(result.entityId, state.leader.id);
    assert.deepEqual(result.position, { x: 21, y: 20 });
    assert.deepEqual(state.units.getUnit(state.leader.id).placement.position, { x: 21, y: 20 });
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Draft supports all four cardinal directions", async () => {
  const state = await setup();
  try {
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);
    state.inputController.resume();

    const cases = [
      ["KeyW", { x: 20, y: 19 }],
      ["KeyS", { x: 20, y: 21 }],
      ["KeyA", { x: 19, y: 20 }],
      ["KeyD", { x: 21, y: 20 }]
    ];

    for (const [key, expected] of cases) {
      state.units.moveUnit(state.leader.id, { x: 20, y: 20 });
      state.inputController.keyDown(key);
      const moved = state.control.update(0.25);
      assert.deepEqual(moved.position, expected, key);
      state.inputController.keyUp(key);
    }
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Draft handles overlapping WASD combinations and independent key release", async () => {
  const state = await setup();
  try {
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);
    state.inputController.resume();

    state.inputController.keyDown("KeyW");
    state.inputController.keyDown("KeyA");
    let moved = state.control.update(0.25);
    assert.ok(Math.abs(moved.position.x - (20 - Math.SQRT1_2)) < 1e-9);
    assert.ok(Math.abs(moved.position.y - (20 - Math.SQRT1_2)) < 1e-9);

    state.inputController.keyUp("KeyW");
    moved = state.control.update(0.25);
    assert.ok(Math.abs(moved.position.x - (19 - Math.SQRT1_2)) < 1e-9);
    assert.ok(Math.abs(moved.position.y - (20 - Math.SQRT1_2)) < 1e-9);

    state.inputController.keyDown("KeyD");
    moved = state.control.update(0.25);
    assert.equal(moved, null);
    const finalPosition = state.units.getUnit(state.leader.id).placement.position;
    assert.ok(Math.abs(finalPosition.x - (19 - Math.SQRT1_2)) < 1e-9);
    assert.ok(Math.abs(finalPosition.y - (20 - Math.SQRT1_2)) < 1e-9);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Diagonal Draft movement is normalized and an inactive Draft does not move", async () => {
  const state = await setup();
  try {
    state.control.setLeader(state.leader.id);
    state.inputController.resume();
    state.inputController.keyDown("KeyW");
    state.inputController.keyDown("KeyD");

    assert.equal(state.control.update(0.5), null);
    assert.deepEqual(state.units.getUnit(state.leader.id).placement.position, { x: 20, y: 20 });

    state.control.setDrafted(true);
    const result = state.control.update(0.5);
    const distance = Math.hypot(result.position.x - 20, result.position.y - 20);
    assert.ok(Math.abs(distance - 2) < 1e-9);
    assert.ok(Math.abs(Math.abs(result.position.x - 20) - Math.abs(result.position.y - 20)) < 1e-9);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Draft state is independent of viewport selection and persists with the Colony Leader", async () => {
  const state = await setup();
  try {
    state.control.setLeader(state.leader.id);
    state.control.toggleDraft();
    assert.deepEqual(state.control.getState(), { leaderId: state.leader.id, drafted: true });

    const persistence = state.context.getService("core.persistence");
    await persistence.save("colony-control", { stateId: "colony-control-state" });
    state.control.setDrafted(false);
    await persistence.load("colony-control", { stateId: "colony-control-state" });
    assert.deepEqual(state.control.getState(), { leaderId: state.leader.id, drafted: true });
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Draft automatically disengages while its leader belongs to an inactive world", async () => {
  const state = await setup();
  try {
    const worlds = state.context.getService("core.world-registry");
    worlds.registerWorld({
      worldId: "colony-test-world-secondary",
      type: "test",
      dimensions: { width: 64, height: 64 },
      coordinateSystem: "tiles"
    });
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);
    state.inputController.resume();
    state.inputController.keyDown("KeyD");

    worlds.activateWorld("colony-test-world-secondary");
    assert.equal(state.control.update(0.25), null);
    assert.deepEqual(state.control.getState(), { leaderId: state.leader.id, drafted: false });
    assert.deepEqual(state.units.getUnit(state.leader.id).placement.position, { x: 20, y: 20 });

    worlds.activateWorld("colony-test-world");
    state.control.setDrafted(true);
    const moved = state.control.update(0.25);
    assert.equal(moved.entityId, state.leader.id);
    assert.deepEqual(moved.position, { x: 21, y: 20 });
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});
