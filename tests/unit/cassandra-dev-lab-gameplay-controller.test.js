import test from "node:test";
import assert from "node:assert/strict";

import { createCassandraDevLabGameplayController } from "../../cassandra/application/dev-lab-gameplay-controller.js";

function setup() {
  let drafted = false;
  let leaderId = null;
  let nextId = 0;
  let updates = 0;
  const units = new Map();
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
  const colonyControlApi = {
    getState() { return { drafted, leaderId }; },
    setLeader(id) { leaderId = id; return getState(); },
    setDrafted(value) { drafted = Boolean(value); return getState(); },
    toggleDraft() { drafted = !drafted; return getState(); },
    update() { updates += 1; return { entityId: leaderId, position: { x: 3, y: 4 } }; }
  };
  function getState() { return { drafted, leaderId }; }
  const worldRegistry = { activeWorldId: "test-world" };
  const controller = createCassandraDevLabGameplayController({ unitApi, colonyControlApi, worldRegistry });
  return { controller, units, getState, get updates() { return updates; }, get leaderId() { return leaderId; } };
}

test("placing Johny assigns the Colony Leader only when no leader exists", () => {
  const state = setup();
  const first = state.controller.createUnit({ definitionId: "pawn.johny", worldId: "test-world", position: { x: 1, y: 2 } });
  assert.equal(state.leaderId, first.id);

  const second = state.controller.createUnit({ definitionId: "pawn.johny", worldId: "test-world", position: { x: 2, y: 3 } });
  assert.equal(state.leaderId, first.id);
  assert.equal(state.controller.listUnits().length, 2);
  assert.equal(second.definitionId, "pawn.johny");
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
