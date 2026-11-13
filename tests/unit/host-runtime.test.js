import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../src/host/create-game-runtime.js";
import { MemorySaveAdapter } from "../../src/core/persistence.js";

function createAdapter() {
  return new MemorySaveAdapter();
}

test("host runtime requires an explicit save adapter", () => {
  assert.throws(
    () => createGameRuntime(),
    /requires an explicit saveAdapter/
  );
});

test("host runtime starts and destroys the Core assembly", async () => {
  const runtime = createGameRuntime({ saveAdapter: createAdapter() });

  assert.equal(runtime.state, "created");
  assert.equal(runtime.context, null);

  const context = await runtime.start();

  assert.equal(runtime.state, "running");
  assert.equal(runtime.context, context);
  assert.ok(context.getService("core.entity-registry"));
  assert.ok(context.getService("core.world-registry"));
  assert.ok(context.getService("core.world-context"));
  assert.ok(context.getService("core.scheduler"));
  assert.ok(context.getService("core.persistence"));

  await runtime.destroy();

  assert.equal(runtime.state, "destroyed");
  assert.equal(runtime.context, null);
});

test("host advances registered synchronous tasks through the Core scheduler", async () => {
  const observedSteps = [];
  const probe = {
    id: "game.host-probe",
    provides: ["game.host-probe-api"],
    initialize() {
      return {
        "game.host-probe-api": Object.freeze({ ready: true })
      };
    }
  };

  const runtime = createGameRuntime({
    saveAdapter: createAdapter(),
    fixedStepSeconds: 0.1,
    maxStepsPerFrame: 10,
    hostSystems: [probe],
    simulationTasks: [{
      systemId: "game.host-probe",
      update(step) {
        observedSteps.push(step);
      }
    }]
  });

  await runtime.start();

  const result = runtime.advance(0.25);

  assert.equal(result.processedSteps, 2);
  assert.equal(runtime.context.getService("game.host-probe-api").ready, true);
  assert.deepEqual(observedSteps.map((step) => step.tick), [1, 2]);
  assert.ok(observedSteps.every((step) => step.deltaSeconds === 0.1));

  await runtime.destroy();
});

test("host pause and resume control simulation advancement", async () => {
  let updates = 0;
  const probe = {
    id: "game.pause-probe",
    provides: ["game.pause-probe-api"],
    initialize() {
      return { "game.pause-probe-api": Object.freeze({}) };
    }
  };

  const runtime = createGameRuntime({
    saveAdapter: createAdapter(),
    fixedStepSeconds: 0.1,
    hostSystems: [probe],
    simulationTasks: [{
      systemId: "game.pause-probe",
      update() {
        updates += 1;
      }
    }]
  });

  await runtime.start();
  runtime.advance(0.1);
  assert.equal(updates, 1);

  await runtime.pause();
  const paused = runtime.advance(0.5);
  assert.equal(updates, 1);
  assert.equal(paused.paused, true);

  await runtime.resume();
  runtime.advance(0.1);
  assert.equal(updates, 2);

  await runtime.destroy();
});

test("failed host startup cleans up initialized systems", async () => {
  const cleanup = [];
  const first = {
    id: "game.host-first",
    provides: ["game.host-first-api"],
    initialize() {
      return { "game.host-first-api": Object.freeze({}) };
    },
    start() {
      cleanup.push("first-start");
    },
    destroy() {
      cleanup.push("first-destroy");
    }
  };
  const failing = {
    id: "game.host-failing",
    requires: ["game.host-first-api"],
    initialize() {},
    start() {
      cleanup.push("failing-start");
      throw new Error("deliberate host startup failure");
    },
    destroy() {
      cleanup.push("failing-destroy");
    }
  };

  const runtime = createGameRuntime({
    saveAdapter: createAdapter(),
    hostSystems: [first, failing]
  });

  await assert.rejects(runtime.start(), /deliberate host startup failure/);
  assert.equal(runtime.state, "failed");
  assert.deepEqual(cleanup, [
    "first-start",
    "failing-start",
    "failing-destroy",
    "first-destroy"
  ]);

  await runtime.destroy();
  assert.equal(runtime.state, "destroyed");
});

test("host cannot advance before start or after shutdown begins", async () => {
  const runtime = createGameRuntime({ saveAdapter: createAdapter() });

  assert.throws(() => runtime.advance(0.1), /must be started/);

  await runtime.start();
  const destroying = runtime.destroy();

  assert.throws(() => runtime.advance(0.1), /shutting down/);
  await destroying;
});
