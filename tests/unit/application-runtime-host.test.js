import test from "node:test";
import assert from "node:assert/strict";

import { createApplicationRuntimeHost } from "../../shared/application/runtime-host.js";

function createHarness({ advance = () => {}, onFrame = () => {}, shouldAdvance = () => true } = {}) {
  let clockPaused = false;
  const pauseReasons = new Set();
  const clock = {
    get paused() { return pauseReasons.size > 0; },
    pause(reason) { const before = this.paused; pauseReasons.add(reason); clockPaused = this.paused; return before !== this.paused; },
    resume(reason) { const before = this.paused; pauseReasons.delete(reason); clockPaused = this.paused; return before !== this.paused; }
  };
  const frames = new Map();
  let nextFrameId = 1;
  const cancelled = [];
  const runtimeCalls = { starts: 0, advances: [], destroys: 0 };
  const pauseChanges = [];
  const errors = [];
  const host = createApplicationRuntimeHost({
    createRuntime() {
      return {
        async start() { runtimeCalls.starts += 1; return { marker: "context" }; },
        advance(delta) { runtimeCalls.advances.push(delta); advance(delta); },
        async destroy() { runtimeCalls.destroys += 1; }
      };
    },
    resolveRuntimeServices() { return { clock }; },
    requestFrame(callback) {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) { cancelled.push(id); frames.delete(id); },
    shouldAdvance,
    onFrame,
    onPauseChange(paused) { pauseChanges.push(paused); },
    onError(error) { errors.push(error); }
  });

  return {
    host, frames, cancelled, runtimeCalls, pauseChanges, errors,
    async tick(timestamp) {
      const [id, callback] = frames.entries().next().value ?? [];
      assert.ok(callback, "a frame should be scheduled");
      frames.delete(id);
      callback(timestamp);
    }
  };
}

test("shared runtime host starts once and advances only on scheduled frames", async () => {
  const h = createHarness();
  const first = await h.host.start();
  const second = await h.host.start();

  assert.equal(first.context.marker, "context");
  assert.equal(second.runtime, first.runtime);
  assert.equal(h.runtimeCalls.starts, 1);

  await h.tick(1000);
  await h.tick(1020);
  assert.deepEqual(h.runtimeCalls.advances, [0.02]);
  assert.equal(h.frames.size, 1);

  await h.host.stop();
  assert.equal(h.runtimeCalls.destroys, 1);
  assert.equal(h.frames.size, 0);
  assert.deepEqual(h.cancelled, []);
});

test("shared runtime host clamps frame delta and synchronizes clock pause changes", async () => {
  const h = createHarness();
  await h.host.start();
  h.host.pause("player");
  assert.equal(h.host.isPaused(), true);
  h.host.resume("player");
  assert.equal(h.host.isPaused(), false);

  await h.tick(100);
  await h.tick(900);
  assert.deepEqual(h.runtimeCalls.advances, [0.25]);
  assert.deepEqual(h.pauseChanges, [false, true, false]);

  await h.host.stop();
});

test("shared runtime host respects host advance policy and calls frame callback", async () => {
  const frameCalls = [];
  const h = createHarness({
    shouldAdvance: () => false,
    onFrame(delta, state) { frameCalls.push({ delta, paused: state.paused }); }
  });
  await h.host.start();
  await h.tick(0);
  await h.tick(16);

  assert.deepEqual(h.runtimeCalls.advances, []);
  assert.deepEqual(frameCalls, [{ delta: 0.016, paused: true }]);
  await h.host.stop();
});

test("shared runtime host pauses and reports synchronous simulation failures", async () => {
  const h = createHarness({ advance() { throw new Error("broken frame"); } });
  await h.host.start();
  await h.tick(0);
  await h.tick(16);

  assert.equal(h.host.isPaused(), true);
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /broken frame/);
  await h.host.stop();
});

test("shared runtime host cancels its pending frame when stopped", async () => {
  const h = createHarness();
  await h.host.start();
  const pendingId = h.frames.keys().next().value;
  await h.host.stop();

  assert.deepEqual(h.cancelled, [pendingId]);
  assert.equal(h.frames.size, 0);
  assert.equal(h.runtimeCalls.destroys, 1);
});
