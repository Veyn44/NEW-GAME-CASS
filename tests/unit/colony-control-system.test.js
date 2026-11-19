import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { registerDefinition, getDefinition, clearDefinitionsForTests } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createInputSystem } from "../../engine/input/input-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createViewportInputController } from "../../shared/input/viewport-input-controller.js";
import { createActionMappingController } from "../../engine/input/action-mapping-controller.js";
import { DEFAULT_CASSANDRA_ACTION_BINDINGS } from "../../cassandra/input/default-action-bindings.js";

async function setup({ movementSpeed = 4 } = {}) {
  clearDefinitionsForTests();
  registerDefinition({
    id: "pawn.johny",
    name: "Johny",
    category: "Pawns",
    description: "Temporary Phase 2 Colony Leader.",
    attributes: {}
  });
  const inputController = createViewportInputController();
  const actionController = createActionMappingController({ bindings: DEFAULT_CASSANDRA_ACTION_BINDINGS });
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    fixedStepSeconds: 1 / 60,
    hostSystems: [
      createInputSystem({ inputController, actionController }),
      createUnitSystem({ definitionLookup: getDefinition }),
      createColonyControlSystem({ getMovementSpeed: () => movementSpeed })
    ]
  });
  const context = await runtime.start();
  const worlds = context.getService("core.world-registry");
  worlds.registerWorld({
    worldId: "colony-test-world",
    type: "test",
    dimensions: { width: 128, height: 128 },
    grid: { width: 128, height: 128 },
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
  return { runtime, context, inputController, actionController, units, control, leader };
}

test("Draft uses the Pawn profile movement speed and targets the Colony Leader by stable Unit ID", async () => {
  const state = await setup();
  try {
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);
    state.actionController.keyDown("KeyD");

    const result = state.control.update(0.25);
    assert.equal(result.entityId, state.leader.id);
    assert.deepEqual(result.position, { x: 21.5, y: 20.5 });
    assert.deepEqual(state.units.getUnit(state.leader.id).position, { x: 21.5, y: 20.5 });
    assert.deepEqual(state.units.getUnit(state.leader.id).placement.position, { x: 21.5, y: 20.5 });
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
      state.actionController.keyDown(key);
      const moved = state.control.update(0.25);
      assert.deepEqual(moved.position, expected, key);
      state.actionController.keyUp(key);
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

    state.actionController.keyDown("KeyW");
    state.actionController.keyDown("KeyA");
    let moved = state.control.update(0.25);
    assert.ok(Math.abs(moved.position.x - (20.5 - Math.SQRT1_2)) < 1e-9);
    assert.ok(Math.abs(moved.position.y - (20.5 - Math.SQRT1_2)) < 1e-9);

    state.actionController.keyUp("KeyW");
    moved = state.control.update(0.25);
    assert.ok(Math.abs(moved.position.x - (19.5 - Math.SQRT1_2)) < 1e-9);
    assert.ok(Math.abs(moved.position.y - (20.5 - Math.SQRT1_2)) < 1e-9);

    state.actionController.keyDown("KeyD");
    moved = state.control.update(0.25);
    assert.equal(moved, null);
    const finalPosition = state.units.getUnit(state.leader.id).position;
    assert.ok(Math.abs(finalPosition.x - (19.5 - Math.SQRT1_2)) < 1e-9);
    assert.ok(Math.abs(finalPosition.y - (20.5 - Math.SQRT1_2)) < 1e-9);
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
    state.actionController.keyDown("KeyW");
    state.actionController.keyDown("KeyD");

    assert.equal(state.control.update(0.5), null);
    assert.deepEqual(state.units.getUnit(state.leader.id).position, { x: 20.5, y: 20.5 });

    state.control.setDrafted(true);
    const result = state.control.update(0.5);
    const distance = Math.hypot(result.position.x - 20.5, result.position.y - 20.5);
    assert.ok(Math.abs(distance - 2) < 1e-9);
    assert.ok(Math.abs(Math.abs(result.position.x - 20.5) - Math.abs(result.position.y - 20.5)) < 1e-9);
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
    state.actionController.keyDown("KeyD");

    worlds.activateWorld("colony-test-world-secondary");
    assert.equal(state.control.update(0.25), null);
    assert.deepEqual(state.control.getState(), { leaderId: state.leader.id, drafted: false });
    assert.deepEqual(state.units.getUnit(state.leader.id).position, { x: 20.5, y: 20.5 });

    worlds.activateWorld("colony-test-world");
    state.control.setDrafted(true);
    const moved = state.control.update(0.25);
    assert.equal(moved.entityId, state.leader.id);
    assert.deepEqual(moved.position, { x: 21.5, y: 20.5 });
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});


test("Removing the Colony Leader clears its reference and allows a valid save restore", async () => {
  const state = await setup();
  try {
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);
    assert.deepEqual(state.control.getState(), { leaderId: state.leader.id, drafted: true });

    assert.equal(state.units.removeUnit(state.leader.id), true);
    assert.deepEqual(state.control.getState(), { leaderId: null, drafted: false });

    const persistence = state.context.getService("core.persistence");
    await persistence.save("colony-after-leader-removal", { stateId: "colony-after-leader-removal-state" });

    const replacement = state.units.createUnit({
      definitionId: "pawn.johny",
      worldId: "colony-test-world",
      position: { x: 30, y: 30 }
    });
    state.control.setLeader(replacement.id);
    state.control.setDrafted(true);

    await persistence.load("colony-after-leader-removal", { stateId: "colony-after-leader-removal-state" });
    assert.deepEqual(state.control.getState(), { leaderId: null, drafted: false });
    assert.equal(state.units.getUnit(state.leader.id), null);
    assert.equal(state.units.getUnit(replacement.id), null);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Removing a non-leader Unit does not clear or disengage the Colony Leader", async () => {
  const state = await setup();
  try {
    const other = state.units.createUnit({
      definitionId: "pawn.johny",
      worldId: "colony-test-world",
      position: { x: 40, y: 40 }
    });
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);

    assert.equal(state.units.removeUnit(other.id), true);
    assert.deepEqual(state.control.getState(), { leaderId: state.leader.id, drafted: true });
    assert.ok(state.units.getUnit(state.leader.id));
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Colony Leader movement speed follows the supplied Pawn profile value", async () => {
  const state = await setup({ movementSpeed: 6 });
  try {
    state.control.setLeader(state.leader.id);
    state.control.setDrafted(true);
    state.actionController.keyDown("KeyD");
    const moved = state.control.update(0.25);
    assert.deepEqual(moved.position, { x: 21.5, y: 20.5 });
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});
