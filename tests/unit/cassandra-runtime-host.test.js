import test from "node:test";
import assert from "node:assert/strict";

import { createCassandraRuntimeHost } from "../../cassandra/application/cassandra-runtime-host.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";

test("Cassandra runtime host owns startup, frame lifecycle, pause and teardown", async () => {
  const frameCallbacks = new Map();
  const cancelledFrames = [];
  const calls = { starts: 0, advances: [], destroys: 0, ready: 0, frames: 0, pauseChanges: [] };
  let nextFrameId = 1;
  const pauseReasons = new Set();
  const clock = {
    get paused() { return pauseReasons.size > 0; },
    pause(reason) {
      const before = this.paused;
      pauseReasons.add(reason);
      return before !== this.paused;
    },
    resume(reason) {
      const before = this.paused;
      pauseReasons.delete(reason);
      return before !== this.paused;
    }
  };
  const host = createCassandraRuntimeHost({
    createRuntime() {
      return {
        async start() {
          calls.starts += 1;
          return { marker: "cassandra-context" };
        },
        advance(deltaSeconds) { calls.advances.push(deltaSeconds); },
        async destroy() { calls.destroys += 1; }
      };
    },
    resolveRuntimeServices() { return { clock }; },
    requestFrame(callback) {
      const id = nextFrameId++;
      frameCallbacks.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      cancelledFrames.push(id);
      frameCallbacks.delete(id);
    },
    onReady() { calls.ready += 1; },
    onFrame() { calls.frames += 1; },
    onPauseChange(paused) { calls.pauseChanges.push(paused); }
  });

  const started = await host.start();
  assert.equal(started.context.marker, "cassandra-context");
  assert.equal(calls.starts, 1);
  assert.equal(calls.ready, 1);

  const tick = async (timestamp) => {
    const [id, callback] = frameCallbacks.entries().next().value ?? [];
    assert.ok(callback, "Cassandra should schedule its next frame");
    frameCallbacks.delete(id);
    callback(timestamp);
  };
  await tick(1000);
  await tick(1016);
  assert.deepEqual(calls.advances, [0.016]);
  assert.equal(calls.frames, 1);

  host.pause("player");
  assert.equal(host.isPaused(), true);
  host.resume("player");
  assert.equal(host.isPaused(), false);

  const pendingFrame = frameCallbacks.keys().next().value;
  await host.stop();
  assert.equal(calls.destroys, 1);
  assert.deepEqual(cancelledFrames, [pendingFrame]);
  assert.equal(frameCallbacks.size, 0);
});

test("Cassandra runtime host forwards the authoritative Applied ledger verifier into World Session", async () => {
  const expected = {
    packageId: "package:host-forwarded",
    digest: "a".repeat(64)
  };
  const calls = [];
  const verifier = async (packageId, digest) => {
    calls.push({ packageId, digest });
    return false;
  };
  const host = createCassandraRuntimeHost({
    saveAdapter: new MemorySaveAdapter(),
    isPackageApplied: verifier,
    resolveRuntimeServices(context) {
      return { clock: context.getService("core.game-clock") };
    },
    requestFrame() { return 1; },
    cancelFrame() {}
  });

  try {
    await host.start();
    const context = host.getContext();
    const worlds = context.getService("core.world-registry");
    worlds.registerWorld({
      worldId: "cassandra-main-host-test",
      type: "cassandra-main",
      dimensions: { width: 32, height: 32 },
      grid: { width: 32, height: 32 },
      coordinateSystem: "tiles"
    });
    const session = context.getService("game.world-session-api");
    session.registerMainWorld("cassandra-main-host-test");
    session.beginTemporaryWorld({
      worldId: "encounter:host-forwarded",
      width: 16,
      height: 16
    });
    session.returnToMainWorld();

    await assert.rejects(
      () => session.completeTemporaryWorld(expected),
      { code: "CHANGE_PACKAGE_NOT_APPLIED" }
    );
    assert.deepEqual(calls, [expected]);
    assert.equal(worlds.has("encounter:host-forwarded"), true);
    assert.equal(session.getState().temporaryWorldId, "encounter:host-forwarded");
  } finally {
    await host.stop();
  }
});
