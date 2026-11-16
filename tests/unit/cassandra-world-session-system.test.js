import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { getDefinition } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createInputSystem } from "../../engine/input/input-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createCassandraRuntime } from "../../cassandra/application/cassandra-runtime-host.js";
import { createViewportInputController } from "../../shared/input/viewport-input-controller.js";
import {
  createCassandraWorldSessionSystem
} from "../../src/gameplay/world/cassandra-world-session-system.js";

async function setup({
  isPackageApplied = async () => true,
  definitionLookup = getDefinition,
  extraHostSystems = []
} = {}) {
  const saveAdapter = new MemorySaveAdapter();
  const inputController = createViewportInputController();
  const runtime = createGameRuntime({
    saveAdapter,
    fixedStepSeconds: 1,
    maxStepsPerFrame: 120,
    hostSystems: [
      createInputSystem({ inputController }),
      createUnitSystem({ definitionLookup }),
      createColonyControlSystem(),
      createCassandraWorldSessionSystem({ isPackageApplied }),
      ...extraHostSystems
    ]
  });
  const context = await runtime.start();
  const worlds = context.getService("core.world-registry");
  worlds.registerWorld({
    worldId: "cassandra-main-128",
    type: "cassandra-main",
    dimensions: { width: 128, height: 128 },
    grid: { width: 128, height: 128 },
    coordinateSystem: "tiles"
  });
  worlds.registerWorld({
    worldId: "cassandra-main-256",
    type: "cassandra-main",
    dimensions: { width: 256, height: 256 },
    grid: { width: 256, height: 256 },
    coordinateSystem: "tiles"
  });
  const session = context.getService("game.world-session-api");
  session.registerMainWorld("cassandra-main-128");
  return {
    runtime,
    context,
    worlds,
    session,
    saveAdapter,
    units: context.getService("game.unit-api"),
    colony: context.getService("game.colony-control-api")
  };
}

test("Cassandra runtime advances only the active World's local clock per simulation step", async () => {
  const runtime = createCassandraRuntime({
    saveAdapter: new MemorySaveAdapter(),
    inputController: createViewportInputController()
  });
  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    worlds.registerWorld({
      worldId: "runtime-main",
      type: "cassandra-main",
      dimensions: { width: 32, height: 32 },
      grid: { width: 32, height: 32 }
    });
    const session = context.getService("game.world-session-api");
    session.registerMainWorld("runtime-main");

    runtime.advance(0.25);
    const mainAfterFirstStep = session.getWorldTime("runtime-main");
    assert.ok(Math.abs(mainAfterFirstStep - 0.25) < 1e-8);

    session.beginTemporaryWorld({ worldId: "runtime-temp", width: 32, height: 32 });
    runtime.advance(0.5);
    assert.ok(Math.abs(session.getWorldTime("runtime-temp") - 0.5) < 1e-8);
    assert.ok(Math.abs(session.getWorldTime("runtime-main") - mainAfterFirstStep) < 1e-8);

    session.returnToMainWorld();
    runtime.advance(0.25);
    assert.ok(Math.abs(session.getWorldTime("runtime-main") - 0.5) < 1e-8);
    assert.ok(Math.abs(session.getWorldTime("runtime-temp") - 0.5) < 1e-8);
  } finally {
    await runtime.destroy();
  }
});

test("Cassandra World local time does not commit when a later task faults the simulation step", async () => {
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    fixedStepSeconds: 1 / 60,
    hostSystems: [
      createUnitSystem({ definitionLookup: getDefinition }),
      createCassandraWorldSessionSystem(),
      { id: "test.failure", requires: ["game.world-session-api"], initialize() { return {}; } }
    ],
    simulationTasks: [
      {
        systemId: "test.failure",
        update() {
          throw new Error("intentional test failure");
        }
      }
    ]
  });
  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    worlds.registerWorld({
      worldId: "fault-main",
      type: "cassandra-main",
      dimensions: { width: 16, height: 16 },
      grid: { width: 16, height: 16 }
    });
    const session = context.getService("game.world-session-api");
    session.registerMainWorld("fault-main");
    assert.throws(() => runtime.advance(1 / 60));
    assert.equal(context.getService("core.scheduler").snapshot.tick, 0);
    assert.equal(session.getWorldTime("fault-main"), 0);
  } finally {
    await runtime.destroy();
  }
});

test("Cassandra Main World local time pauses while Temporary World is active", async () => {
  const state = await setup();
  try {
    state.runtime.advance(12);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 12);

    state.session.beginTemporaryWorld({ worldId: "encounter:one", width: 64, height: 64 });
    assert.equal(state.worlds.activeWorldId, "encounter:one");
    state.runtime.advance(30);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 12);
    assert.equal(state.session.getWorldTime("encounter:one"), 30);

    state.session.returnToMainWorld();
    state.runtime.advance(5);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 17);
    assert.equal(state.session.getWorldTime("encounter:one"), 30);
  } finally {
    await state.runtime.destroy();
  }
});

test("Cassandra session allows only one Temporary World and retains it for safe result handling", async () => {
  const state = await setup();
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:one", width: 128, height: 128 });
    assert.throws(
      () => state.session.beginTemporaryWorld({ worldId: "encounter:two" }),
      { code: "TEMPORARY_WORLD_ALREADY_EXISTS" }
    );
    state.session.returnToMainWorld();
    assert.equal(state.session.getState().temporaryWorldId, "encounter:one");
    assert.throws(
      () => state.session.setMainWorldWorld("cassandra-main-256"),
      { code: "TEMPORARY_WORLD_PENDING" }
    );
    state.session.enterTemporaryWorld();
    assert.equal(state.worlds.activeWorldId, "encounter:one");
  } finally {
    await state.runtime.destroy();
  }
});

test("Temporary World disposal requires the exact applied package identity and digest", async () => {
  const expected = {
    packageId: "package:verified-return",
    digest: "b".repeat(64)
  };
  const calls = [];
  const state = await setup({
    isPackageApplied: async (packageId, digest) => {
      calls.push({ packageId, digest });
      return false;
    }
  });
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:unapplied-return", width: 32, height: 32 });
    const spatial = state.context.getService("core.spatial-composition");
    spatial.addCellContent({
      contentId: "content:unapplied-preserve",
      worldId: "encounter:unapplied-return",
      cell: { x: 2, y: 3 },
      categoryId: "terrain",
      layerId: "ground",
      payload: { material: "test-rock" }
    });
    state.session.returnToMainWorld();

    await assert.rejects(
      () => state.session.completeTemporaryWorld(expected),
      { code: "CHANGE_PACKAGE_NOT_APPLIED" }
    );
    assert.deepEqual(calls, [expected]);
    assert.equal(state.worlds.has("encounter:unapplied-return"), true);
    assert.equal(state.session.getState().temporaryWorldId, "encounter:unapplied-return");
    assert.equal(spatial.listContents({ worldId: "encounter:unapplied-return" }).length, 1);
  } finally {
    await state.runtime.destroy();
  }
});

test("Temporary World cleanup preflight failure leaves the World and its contents intact", async () => {
  const state = await setup();
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:preflight", width: 32, height: 32 });
    const spatial = state.context.getService("core.spatial-composition");
    spatial.addCellContent({
      contentId: "content:preflight-preserve",
      worldId: "encounter:preflight",
      cell: { x: 4, y: 5 },
      categoryId: "terrain",
      layerId: "ground",
      payload: { material: "test-rock" }
    });
    state.session.registerTemporaryWorldCleanup(() => {
      throw new Error("cleanup preflight rejected");
    });
    state.session.returnToMainWorld();

    await assert.rejects(
      () => state.session.completeTemporaryWorld({
        packageId: "package:preflight",
        digest: "c".repeat(64)
      }),
      /cleanup preflight rejected/
    );
    assert.equal(state.worlds.has("encounter:preflight"), true);
    assert.equal(state.session.getState().temporaryWorldId, "encounter:preflight");
    assert.equal(spatial.listContents({ worldId: "encounter:preflight" }).length, 1);
  } finally {
    await state.runtime.destroy();
  }
});

test("Temporary World disposal validates every placement before retiring any Unit", async () => {
  const state = await setup({
    definitionLookup: (id) => id === "test.temporary-worker" ? { id } : getDefinition(id)
  });
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:preflight-integrity", width: 32, height: 32 });
    const units = state.context.getService("game.unit-api");
    const unit = units.createUnit({
      definitionId: "test.temporary-worker",
      worldId: "encounter:preflight-integrity",
      position: { x: 3, y: 4 }
    });
    const entities = state.context.getService("core.entity-registry");
    const placements = state.context.getService("core.placement-coordinator");
    const persistent = entities.registerPersistent({ kind: "test-persistent" });
    placements.placeEntity(persistent.id, {
      worldId: "encounter:preflight-integrity",
      anchor: { x: 8, y: 9 },
      footprint: [{ x: 0, y: 0 }]
    });
    state.session.returnToMainWorld();

    await assert.rejects(
      () => state.session.completeTemporaryWorld({
        packageId: "package:preflight-integrity",
        digest: "d".repeat(64)
      }),
      { code: "PERSISTENT_ENTITY_IN_TEMPORARY_WORLD" }
    );
    assert.ok(units.getUnit(unit.id), "the valid Unit must remain after preflight rejection");
    assert.equal(entities.get(unit.id).status, "active");
    assert.ok(state.context.getService("core.world-context").getPlacement(unit.id));
    assert.equal(state.worlds.has("encounter:preflight-integrity"), true);
  } finally {
    await state.runtime.destroy();
  }
});

test("Temporary World disposal rejects concurrent completion attempts", async () => {
  const state = await setup();
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:concurrent-disposal", width: 32, height: 32 });
    state.session.returnToMainWorld();
    const args = {
      packageId: "package:concurrent-disposal",
      digest: "e".repeat(64)
    };
    const first = state.session.completeTemporaryWorld(args);
    assert.throws(
      () => state.session.enterTemporaryWorld(),
      { code: "TEMPORARY_DISPOSAL_IN_PROGRESS" }
    );
    await assert.rejects(
      () => state.session.completeTemporaryWorld(args),
      { code: "TEMPORARY_DISPOSAL_IN_PROGRESS" }
    );
    const result = await first;
    assert.equal(result.temporaryWorldId, null);
    assert.equal(state.worlds.has("encounter:concurrent-disposal"), false);
  } finally {
    await state.runtime.destroy();
  }
});

test("Temporary World disposal rejects asynchronous cleanup preparation without mutation", async () => {
  const state = await setup();
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:async-preflight", width: 32, height: 32 });
    state.session.registerTemporaryWorldCleanup(async () => () => true);
    state.session.returnToMainWorld();
    await assert.rejects(
      () => state.session.completeTemporaryWorld({
        packageId: "package:async-preflight",
        digest: "f".repeat(64)
      }),
      { code: "ASYNC_TEMPORARY_CLEANUP_PREPARATION" }
    );
    assert.equal(state.worlds.has("encounter:async-preflight"), true);
    assert.equal(state.session.getState().temporaryWorldId, "encounter:async-preflight");
  } finally {
    await state.runtime.destroy();
  }
});

test("Temporary World disposal fails closed if its registry descriptor was removed early", async () => {
  const state = await setup();
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:missing-registry", width: 32, height: 32 });
    state.session.returnToMainWorld();
    state.worlds.closeWorld("encounter:missing-registry");
    state.worlds.unregisterWorld("encounter:missing-registry");

    await assert.rejects(
      () => state.session.completeTemporaryWorld({
        packageId: "package:missing-registry",
        digest: "1".repeat(64)
      }),
      { code: "TEMPORARY_WORLD_REGISTRY_MISSING" }
    );
    assert.equal(state.session.getState().temporaryWorldId, "encounter:missing-registry");
    assert.equal(state.worlds.has("encounter:missing-registry"), false);
  } finally {
    await state.runtime.destroy();
  }
});

test("Cassandra can change selected Main World when no Temporary World is pending", async () => {
  const state = await setup();
  try {
    state.runtime.advance(3);
    state.session.setMainWorldWorld("cassandra-main-256");
    assert.equal(state.worlds.activeWorldId, "cassandra-main-256");
    state.runtime.advance(4);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 3);
    assert.equal(state.session.getWorldTime("cassandra-main-256"), 4);
  } finally {
    await state.runtime.destroy();
  }
});

test("Cassandra migrates legacy session-local clocks when an older save has no Engine runtime snapshot", async () => {
  const state = await setup();
  try {
    state.runtime.advance(7);
    await state.context.getService("core.persistence").save("legacy-cassandra-clock", { stateId: "legacy-cassandra" });
    const legacySave = await state.saveAdapter.read("legacy-cassandra-clock");
    delete legacySave.snapshots["core.world-runtime"];
    delete legacySave.schemas["core.world-runtime"];
    await state.saveAdapter.writeAtomic("legacy-cassandra-clock", legacySave);

    state.runtime.advance(5);
    await state.context.getService("core.persistence").load("legacy-cassandra-clock", { stateId: "legacy-cassandra" });
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 7);
    assert.equal(state.context.getService("core.world-runtime").getState("cassandra-main-128").status, "Unloaded");
    state.session.resumeAfterRestore();
    assert.equal(state.context.getService("core.world-runtime").getState("cassandra-main-128").status, "Ready");
    assert.equal(state.context.getService("core.world-runtime").getState("cassandra-main-128").simulationEnabled, true);
  } finally {
    await state.runtime.destroy();
  }
});

test("Cassandra world session state restores with World Registry selection and local clocks", async () => {
  const state = await setup();
  try {
    state.runtime.advance(7);
    state.session.beginTemporaryWorld({ worldId: "encounter:save-test", width: 96, height: 96 });
    state.runtime.advance(11);
    const persistence = state.context.getService("core.persistence");
    await persistence.save("world-session", { stateId: "world-session-state" });

    state.session.returnToMainWorld();
    state.runtime.advance(100);
    assert.equal(state.worlds.activeWorldId, "cassandra-main-128");

    await persistence.load("world-session", { stateId: "world-session-state" });
    assert.equal(state.worlds.activeWorldId, "encounter:save-test");
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 7);
    assert.equal(state.session.getWorldTime("encounter:save-test"), 11);
    assert.equal(state.session.getState().inTemporaryWorld, true);
  } finally {
    await state.runtime.destroy();
  }
});


test("Temporary World disposal clears Colony Leader when it removes Units in bulk", async () => {
  const state = await setup({ definitionLookup: (id) => ({ id }) });
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:leader-disposal", width: 32, height: 32 });
    const first = state.units.createUnit({
      definitionId: "test.temporary-worker",
      worldId: "encounter:leader-disposal",
      position: { x: 3, y: 4 }
    });
    const second = state.units.createUnit({
      definitionId: "test.temporary-worker",
      worldId: "encounter:leader-disposal",
      position: { x: 7, y: 8 }
    });
    state.colony.setLeader(first.id);
    state.colony.setDrafted(true);
    state.session.returnToMainWorld();

    const result = await state.session.completeTemporaryWorld({
      packageId: "package:leader-disposal",
      digest: "2".repeat(64)
    });

    assert.equal(result.temporaryWorldId, null);
    assert.equal(state.worlds.has("encounter:leader-disposal"), false);
    assert.equal(state.units.getUnit(first.id), null);
    assert.equal(state.units.getUnit(second.id), null);
    assert.deepEqual(state.colony.getState(), { leaderId: null, drafted: false });
  } finally {
    await state.runtime.destroy();
  }
});


test("authoritative Engine runtime clocks win over stale legacy session mirrors", async () => {
  const state = await setup();
  try {
    state.runtime.advance(7);
    await state.context.getService("core.persistence").save("authoritative-cassandra-clock", { stateId: "authoritative-cassandra" });
    const save = await state.saveAdapter.read("authoritative-cassandra-clock");
    save.snapshots["game.world-session"].worldTimes = [
      { worldId: "cassandra-main-128", seconds: 2 },
      { worldId: "cassandra-main-256", seconds: 3 }
    ];
    await state.saveAdapter.writeAtomic("authoritative-cassandra-clock", save);

    state.runtime.advance(5);
    await state.context.getService("core.persistence").load("authoritative-cassandra-clock", { stateId: "authoritative-cassandra" });

    const worldRuntime = state.context.getService("core.world-runtime");
    assert.equal(worldRuntime.getState("cassandra-main-128").simulatedSeconds, 7);
    assert.equal(worldRuntime.getState("cassandra-main-256").simulatedSeconds, 0);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 7);
    assert.equal(state.session.getWorldTime("cassandra-main-256"), 0);
  } finally {
    await state.runtime.destroy();
  }
});

test("Temporary World disposal restores every persistence participant after a mid-commit failure", async () => {
  const state = await setup({ definitionLookup: (id) => ({ id }) });
  const worldId = "encounter:atomic-disposal-rollback";
  try {
    state.session.beginTemporaryWorld({ worldId, width: 32, height: 32 });
    const first = state.units.createUnit({
      definitionId: "test.rollback-worker",
      worldId,
      position: { x: 3, y: 4 }
    });
    const second = state.units.createUnit({
      definitionId: "test.rollback-worker",
      worldId,
      position: { x: 7, y: 8 }
    });
    state.colony.setLeader(first.id);
    state.colony.setDrafted(true);

    const spatial = state.context.getService("core.spatial-composition");
    const worldContext = state.context.getService("core.world-context");
    const entities = state.context.getService("core.entity-registry");
    spatial.addCellContent({
      contentId: "content:atomic-disposal-rollback",
      worldId,
      cell: { x: 12, y: 13 },
      categoryId: "terrain",
      layerId: "ground",
      payload: { material: "rollback-test" }
    });
    state.runtime.advance(3);
    state.session.returnToMainWorld();

    const expectedWorldTime = state.session.getWorldTime(worldId);
    const originalUnregisterWorld = state.worlds.unregisterWorld;
    state.worlds.unregisterWorld = function injectedUnregisterFailure() {
      throw new Error("injected failure after scoped cleanup");
    };

    try {
      await assert.rejects(
        () => state.session.completeTemporaryWorld({
          packageId: "package:atomic-disposal-rollback",
          digest: "3".repeat(64)
        }),
        /injected failure after scoped cleanup/
      );
    } finally {
      state.worlds.unregisterWorld = originalUnregisterWorld;
    }

    assert.equal(state.worlds.has(worldId), true);
    assert.equal(state.worlds.get(worldId).status, "inactive");
    assert.equal(state.worlds.activeWorldId, "cassandra-main-128");
    assert.equal(state.session.getState().temporaryWorldId, worldId);
    assert.equal(state.session.getWorldTime(worldId), expectedWorldTime);

    for (const unit of [first, second]) {
      assert.ok(state.units.getUnit(unit.id), `Unit ${unit.id} must be restored`);
      assert.equal(entities.get(unit.id).status, "active");
      assert.equal(worldContext.getPlacement(unit.id).worldId, worldId);
      assert.equal(spatial.getEntityOccupancy(unit.id).worldId, worldId);
    }
    assert.deepEqual(state.colony.getState(), { leaderId: first.id, drafted: true });
    assert.deepEqual(spatial.listContents({ worldId }).map((entry) => entry.contentId), [
      "content:atomic-disposal-rollback"
    ]);
    const restoredRuntimeState = state.context.getService("core.world-runtime").getState(worldId);
    assert.equal(restoredRuntimeState.status, "Ready");
    assert.equal(restoredRuntimeState.simulationEnabled, false);
    assert.equal(state.context.getService("core.event-bus").pendingCount, 0);
  } finally {
    await state.runtime.destroy();
  }
});

test("failed Temporary World rollback faults Persistence and pauses simulation", async () => {
  const rollbackFailureSystem = {
    id: "test.rollback-failure",
    requires: ["core.persistence"],
    initialize(context) {
      context.getService("core.persistence").registerParticipant({
        id: "test.rollback-failure",
        schemaVersion: 1,
        order: 100,
        captureSnapshot: () => ({ version: 1, value: "before" }),
        validateSnapshot: (snapshot) => snapshot?.version === 1 && snapshot.value === "before",
        prepareRestore: () => Object.freeze({
          commit() {
            throw new Error("injected checkpoint restore failure");
          },
          rollback() {
            return true;
          }
        })
      });
      return {};
    }
  };
  const state = await setup({ extraHostSystems: [rollbackFailureSystem] });
  try {
    state.session.beginTemporaryWorld({ worldId: "encounter:fatal-rollback", width: 16, height: 16 });
    state.session.returnToMainWorld();

    const persistence = state.context.getService("core.persistence");
    const clock = state.context.getService("core.game-clock");
    const originalUnregisterWorld = state.worlds.unregisterWorld;
    state.worlds.unregisterWorld = function injectedUnregisterFailure() {
      throw new Error("injected cleanup failure");
    };

    try {
      await assert.rejects(
        () => state.session.completeTemporaryWorld({
          packageId: "package:fatal-rollback",
          digest: "4".repeat(64)
        }),
        { code: "ATOMIC_MUTATION_ROLLBACK_FAILED" }
      );
    } finally {
      state.worlds.unregisterWorld = originalUnregisterWorld;
    }

    assert.equal(persistence.isFaulted, true);
    assert.ok(clock.pauseReasons.includes("core.persistence-integrity-fault"));
    await assert.rejects(
      () => persistence.save("faulted-runtime", { stateId: "faulted-runtime" }),
      { code: "PERSISTENCE_FAULTED" }
    );
  } finally {
    await state.runtime.destroy();
  }
});
