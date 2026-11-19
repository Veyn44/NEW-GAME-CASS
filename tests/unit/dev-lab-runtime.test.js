import test from "node:test";
import assert from "node:assert/strict";

import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { createDevLabRuntime } from "../../dev-lab/application/create-dev-lab-runtime.js";

test("standalone Dev Lab runtime starts with real Pawn gameplay systems and advances free camera", async () => {
  let cameraUpdates = 0;
  const inputController = {
    getState: () => Object.freeze({ keys: [], buttons: [], pointerDelta: { x: 0, y: 0 } }),
    consumeFrameInput: () => Object.freeze({ keys: [], buttons: [], pointerDelta: { x: 0, y: 0 } })
  };
  const runtime = createDevLabRuntime({
    saveAdapter: new MemorySaveAdapter(),
    inputController,
    updateFreeCamera() { cameraUpdates += 1; }
  });

  try {
    const context = await runtime.start();
    assert.ok(context.getService("core.world-registry"));
    assert.ok(context.getService("core.game-clock"));
    assert.ok(context.getService("game.unit-api"));
    assert.ok(context.getService("cassandra.pawn-runtime-api"));
    assert.ok(context.getService("game.colony-control-api"));
    assert.ok(context.getService("engine.input-api"));
    assert.equal(runtime.initializationOrder.includes("dev-lab.free-camera"), true);
    assert.equal(runtime.initializationOrder.includes("game.unit"), true);
    assert.equal(runtime.initializationOrder.includes("cassandra.pawn-runtime"), true);
    assert.equal(runtime.initializationOrder.includes("game.colony-control"), true);

    runtime.advance(1 / 60);
    assert.equal(cameraUpdates, 1);
  } finally {
    await runtime.destroy();
  }
});
