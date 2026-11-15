import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { getDefinition } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createCassandraRuntime } from "../../cassandra/application/cassandra-runtime-host.js";
import { createViewportInputController } from "../../shared/input/viewport-input-controller.js";
import {
  createCassandraWorldSessionSystem
} from "../../src/gameplay/world/cassandra-world-session-system.js";

async function setup({ isPackageApplied = async () => true } = {}) {
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [
      createUnitSystem({ definitionLookup: getDefinition }),
      createCassandraWorldSessionSystem({ isPackageApplied })
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
  return { runtime, context, worlds, session };
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
        systemId: "game.world-session",
        update({ deltaSeconds, tick, context }) {
          context.getService("game.world-session-api").advance(deltaSeconds, tick);
        }
      },
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
    state.session.advance(12);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 12);

    state.session.beginTemporaryWorld({ worldId: "encounter:one", width: 64, height: 64 });
    assert.equal(state.worlds.activeWorldId, "encounter:one");
    state.session.advance(30);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 12);
    assert.equal(state.session.getWorldTime("encounter:one"), 30);

    state.session.returnToMainWorld();
    state.session.advance(5);
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

test("Cassandra can change selected Main World when no Temporary World is pending", async () => {
  const state = await setup();
  try {
    state.session.advance(3);
    state.session.setMainWorldWorld("cassandra-main-256");
    assert.equal(state.worlds.activeWorldId, "cassandra-main-256");
    state.session.advance(4);
    assert.equal(state.session.getWorldTime("cassandra-main-128"), 3);
    assert.equal(state.session.getWorldTime("cassandra-main-256"), 4);
  } finally {
    await state.runtime.destroy();
  }
});

test("Cassandra world session state restores with World Registry selection and local clocks", async () => {
  const state = await setup();
  try {
    state.session.advance(7);
    state.session.beginTemporaryWorld({ worldId: "encounter:save-test", width: 96, height: 96 });
    state.session.advance(11);
    const persistence = state.context.getService("core.persistence");
    await persistence.save("world-session", { stateId: "world-session-state" });

    state.session.returnToMainWorld();
    state.session.advance(100);
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
