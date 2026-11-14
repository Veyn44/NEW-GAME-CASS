import test from "node:test";
import assert from "node:assert/strict";

import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { createDevLabRuntime } from "../../dev-lab/application/create-dev-lab-runtime.js";

test("standalone Dev Lab runtime starts and advances without Cassandra gameplay systems", async () => {
  let cameraUpdates = 0;
  const runtime = createDevLabRuntime({
    saveAdapter: new MemorySaveAdapter(),
    updateFreeCamera() {
      cameraUpdates += 1;
    }
  });

  try {
    const context = await runtime.start();
    assert.ok(context.getService("core.world-registry"));
    assert.ok(context.getService("core.game-clock"));
    assert.equal(runtime.initializationOrder.includes("dev-lab.free-camera"), true);
    assert.equal(runtime.initializationOrder.includes("game.unit"), false);
    assert.equal(runtime.initializationOrder.includes("game.colony-control"), false);

    runtime.advance(1 / 60);
    assert.equal(cameraUpdates, 1);
  } finally {
    await runtime.destroy();
  }
});
