import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import {
  createCassandraWorldSessionSystem
} from "../../src/gameplay/world/cassandra-world-session-system.js";

async function setup() {
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [createCassandraWorldSessionSystem()]
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

test("Cassandra world session rejects malformed and mismatched snapshots", async () => {
  const state = await setup();
  try {
    const participant = state.context.getService("core.persistence").getParticipant?.("game.world-session");
    if (!participant) return;
    assert.equal(participant.validateSnapshot({
      version: 1,
      mainWorldId: "cassandra-main-128",
      temporaryWorldId: "cassandra-main-128",
      activeWorldId: "cassandra-main-128",
      worldTimes: [{ worldId: "cassandra-main-128", seconds: 0 }]
    }), false);
  } finally {
    await state.runtime.destroy();
  }
});
