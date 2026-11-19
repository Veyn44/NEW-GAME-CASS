import test from "node:test";
import assert from "node:assert/strict";

import { createCassandraDevLabGameplayController } from "../../cassandra/application/dev-lab-gameplay-controller.js";

function setup({ failPawnInitialization = false } = {}) {
  let drafted = false;
  let leaderId = null;
  let nextId = 0;
  let updates = 0;
  const units = new Map();
  const initializedPawns = new Set();
  const unitApi = {
    createUnit(options) {
      const unit = { id: `unit-${++nextId}`, definitionId: options.definitionId, placement: { type: "world", worldId: options.worldId, position: options.position } };
      units.set(unit.id, unit);
      return unit;
    },
    getUnit(id) { return units.get(id) ?? null; },
    listUnits() { return [...units.values()]; },
    removeUnit(id) { return units.delete(id); }
  };
  const pawnRuntimeApi = {
    initializePawn(id) {
      if (failPawnInitialization) throw new Error("invalid pawn profile");
      initializedPawns.add(id);
      return { entityId: id };
    },
    getPawn(id) { return initializedPawns.has(id) ? { entityId: id } : null; },
    listPawns() { return [...initializedPawns].map((id) => ({ entityId: id })); }
  };
  const colonyControlApi = {
    getState() { return { drafted, leaderId }; },
    setLeader(id) { leaderId = id; return getState(); },
    setDrafted(value) { drafted = Boolean(value); return getState(); },
    toggleDraft() { drafted = !drafted; return getState(); },
    update() { updates += 1; return { entityId: leaderId, position: { x: 3, y: 4 } }; }
  };
  function getState() { return { drafted, leaderId }; }
  const worldRegistry = { activeWorldId: "test-world" };
  const controller = createCassandraDevLabGameplayController({ unitApi, pawnRuntimeApi, colonyControlApi, worldRegistry });
  return { controller, units, initializedPawns, getState, get updates() { return updates; }, get leaderId() { return leaderId; } };
}

test("placing any Pawn initializes Pawn runtime and assigns Colony Leader only when none exists", () => {
  const state = setup();
  const first = state.controller.createUnit({ definitionId: "pawn.johny", worldId: "test-world", position: { x: 1, y: 2 } });
  assert.equal(state.leaderId, first.id);
  assert.ok(state.initializedPawns.has(first.id));

  const second = state.controller.createUnit({ definitionId: "pawn.johny", worldId: "test-world", position: { x: 2, y: 3 } });
  assert.equal(state.leaderId, first.id);
  assert.equal(state.controller.listUnits().length, 2);
  assert.equal(second.definitionId, "pawn.johny");
  assert.deepEqual(state.controller.listPawns().map((pawn) => pawn.entityId).sort(), [first.id, second.id].sort());
});

test("failed Pawn profile initialization removes the just-created Unit", () => {
  const state = setup({ failPawnInitialization: true });
  assert.throws(() => state.controller.createUnit({
    definitionId: "pawn.johny",
    worldId: "test-world",
    position: { x: 1, y: 2 }
  }), /invalid pawn profile/);
  assert.equal(state.controller.listUnits().length, 0);
  assert.equal(state.leaderId, null);
});

test("F toggles Draft through the Cassandra adapter and ignores key repeat", () => {
  const state = setup();
  const pawn = state.controller.createUnit({ definitionId: "pawn.johny", worldId: "test-world", position: { x: 1, y: 2 } });

  assert.equal(state.controller.handleKeyDown({ code: "KeyF", repeat: true }), null);
  assert.equal(state.getState().drafted, false);

  const action = state.controller.handleKeyDown({ code: "KeyF", repeat: false });
  assert.equal(action.controlState.drafted, true);
  assert.equal(action.controlState.leaderId, pawn.id);
  assert.equal(action.leader.id, pawn.id);
  assert.equal(state.controller.getDraftStatusLabel(), "DRAFT ACTIVE");
});

test("movement updates only while Draft is active", () => {
  const state = setup();
  assert.equal(state.controller.update(1 / 60), null);
  assert.equal(state.updates, 0);

  state.controller.setDrafted(true);
  const moved = state.controller.update(1 / 60);
  assert.equal(moved.entityId, null);
  assert.equal(state.updates, 1);
});

test("only definitions explicitly marked as world Units can be spawned from the database", () => {
  const state = setup();
  assert.equal(state.controller.canPlaceDefinition({ id: "pawn.johny", spawnableAs: ["unit"] }), true);
  assert.equal(state.controller.canPlaceDefinition({ id: "attribute.medicine", spawnableAs: [] }), false);
  assert.equal(state.controller.canPlaceDefinition({ id: "attribute.medicine" }), false);
});


test("controlled entity selector locks Draft to a spawned Pawn", () => {
  const state = setup();
  const johny = state.controller.createUnit({ definitionId: "pawn.johny", worldId: "test-world", position: { x: 1, y: 2 } });
  const observer = state.controller.createUnit({ definitionId: "pawn.test.observer", worldId: "test-world", position: { x: 4, y: 5 } });
  const selected = state.controller.setControlledEntity(observer.id);
  assert.equal(selected.leaderId, observer.id);
  assert.equal(selected.drafted, false);
  const action = state.controller.handleKeyDown({ code: "KeyF", repeat: false });
  assert.equal(action.controlState.leaderId, observer.id);
  assert.equal(action.controlState.drafted, true);
  assert.equal(action.leader.id, observer.id);
  assert.notEqual(action.leader.id, johny.id);
});

test("controlled entity selector rejects non-Pawns and clears Draft when reset", () => {
  const state = setup();
  const pawn = state.controller.createUnit({ definitionId: "pawn.johny", worldId: "test-world", position: { x: 1, y: 2 } });
  const notPawn = state.controller.createUnit({ definitionId: "unit.crate", worldId: "test-world", position: { x: 2, y: 3 } });
  assert.throws(() => state.controller.setControlledEntity(notPawn.id), /must be a spawned Pawn/);
  state.controller.setControlledEntity(pawn.id);
  state.controller.setDrafted(true);
  const cleared = state.controller.setControlledEntity(null);
  assert.equal(cleared.leaderId, null);
  assert.equal(cleared.drafted, false);
});
