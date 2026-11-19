import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { clearDefinitionsForTests, getDefinition } from "../../engine/database/definition-registry.js";
import { clearDefinitionPackagesForTests } from "../../engine/database/definition-package-loader.js";
import { loadCassandraDatabase } from "../../cassandra/database/load-cassandra-database.js";
import { resolvePawnProfile } from "../../cassandra/gameplay/pawn/pawn-profile-resolver.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createPawnRuntimeSystem } from "../../cassandra/gameplay/pawn/pawn-runtime-system.js";

async function setup() {
  clearDefinitionsForTests();
  clearDefinitionPackagesForTests();
  loadCassandraDatabase();
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [
      createUnitSystem({ definitionLookup: getDefinition }),
      createPawnRuntimeSystem({ definitionLookup: getDefinition })
    ]
  });
  const context = await runtime.start();
  const worlds = context.getService("core.world-registry");
  worlds.registerWorld({
    worldId: "pawn-runtime-test-world",
    type: "test",
    dimensions: { width: 64, height: 64 },
    grid: { width: 64, height: 64 },
    coordinateSystem: "tiles"
  });
  worlds.activateWorld("pawn-runtime-test-world");
  const units = context.getService("game.unit-api");
  const pawnRuntime = context.getService("cassandra.pawn-runtime-api");
  const unit = units.createUnit({
    definitionId: "pawn.johny",
    worldId: "pawn-runtime-test-world",
    position: { x: 5, y: 6 }
  });
  return { runtime, context, units, pawnRuntime, unit };
}

test("Pawn profile resolves family and base stats without putting Cassandra fields in Engine Unit", async () => {
  const state = await setup();
  try {
    const profile = resolvePawnProfile({ definitionId: "pawn.johny", definitionLookup: getDefinition });
    assert.equal(profile.definitionId, "pawn.johny");
    assert.equal(profile.familyId, "family.pawn");
    assert.equal(profile.baseStatsId, "base-stats.pawn");
    assert.equal(profile.movement.movementSpeed, 4);
    assert.equal(profile.movement.dodgeDistance, 4);
    assert.equal(profile.perception.visionRange, 8);
    assert.equal(profile.perception.visionAngle, 120);
    assert.equal(profile.perception.soundDetectionRange, 8);
    assert.equal(profile.endurance.maxHealth, 100);
    assert.equal(profile.endurance.maxStamina, 10);
    assert.equal(profile.noise.movementNoise, 8);
    assert.equal(profile.physical.carryCapacity, 50);
    assert.equal(profile.physical.carryCapacityUnit, "kg");
    assert.deepEqual(Object.keys(state.units.getUnit(state.unit.id)).sort(), ["definitionId", "id", "placement", "position"]);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
    clearDefinitionPackagesForTests();
  }
});

test("Pawn runtime initializes current health and stamina from the resolved profile", async () => {
  const state = await setup();
  try {
    const pawn = state.pawnRuntime.initializePawn(state.unit.id);
    assert.equal(pawn.state.health, 100);
    assert.equal(pawn.state.stamina, 10);
    assert.equal(pawn.state.experience, 0);
    assert.equal(pawn.state.level, 1);
    assert.equal(pawn.profile.physical.carryCapacity, 50);
    assert.deepEqual(state.pawnRuntime.initializePawn(state.unit.id).state, pawn.state);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
    clearDefinitionPackagesForTests();
  }
});

test("Pawn runtime consumes stamina without regeneration and applies bounded damage/healing", async () => {
  const state = await setup();
  try {
    state.pawnRuntime.initializePawn(state.unit.id);
    assert.equal(state.pawnRuntime.consumeStamina(state.unit.id, 4), true);
    assert.equal(state.pawnRuntime.getPawn(state.unit.id).state.stamina, 6);
    assert.equal(state.pawnRuntime.consumeStamina(state.unit.id, 7), false);
    assert.equal(state.pawnRuntime.getPawn(state.unit.id).state.stamina, 6);

    assert.equal(state.pawnRuntime.applyDamage(state.unit.id, 30).health, 70);
    assert.equal(state.pawnRuntime.restoreHealth(state.unit.id, 100).health, 100);
    assert.equal(state.pawnRuntime.applyDamage(state.unit.id, 150).health, 0);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
    clearDefinitionPackagesForTests();
  }
});

test("Pawn runtime state persists and restores with its Unit", async () => {
  const state = await setup();
  try {
    state.pawnRuntime.initializePawn(state.unit.id);
    state.pawnRuntime.consumeStamina(state.unit.id, 3);
    state.pawnRuntime.applyDamage(state.unit.id, 25);
    const persistence = state.context.getService("core.persistence");
    await persistence.save("pawn-runtime", { stateId: "pawn-runtime-state" });

    state.pawnRuntime.consumeStamina(state.unit.id, 2);
    state.pawnRuntime.applyDamage(state.unit.id, 20);
    assert.equal(state.pawnRuntime.getPawn(state.unit.id).state.stamina, 5);
    assert.equal(state.pawnRuntime.getPawn(state.unit.id).state.health, 55);

    await persistence.load("pawn-runtime", { stateId: "pawn-runtime-state" });
    assert.equal(state.pawnRuntime.getPawn(state.unit.id).state.stamina, 7);
    assert.equal(state.pawnRuntime.getPawn(state.unit.id).state.health, 75);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
    clearDefinitionPackagesForTests();
  }
});

test("removing a Unit also removes its Pawn runtime state", async () => {
  const state = await setup();
  try {
    state.pawnRuntime.initializePawn(state.unit.id);
    assert.equal(state.pawnRuntime.getPawn(state.unit.id) !== null, true);
    state.units.removeUnit(state.unit.id);
    assert.equal(state.pawnRuntime.getPawn(state.unit.id), null);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
    clearDefinitionPackagesForTests();
  }
});
