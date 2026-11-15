import test from "node:test";
import assert from "node:assert/strict";

import { WorldRegistry } from "../../engine/core/world-registry.js";

function registerWorld(registry, worldId) {
  return registry.registerWorld({
    worldId,
    type: "test-world",
    dimensions: { width: 16, height: 16 },
    grid: { width: 16, height: 16 },
    coordinateSystem: "tiles"
  });
}

test("World Registry unregisters only closed inactive worlds", () => {
  const registry = new WorldRegistry();
  registerWorld(registry, "world:disposable");
  registry.activateWorld("world:disposable");

  assert.throws(
    () => registry.unregisterWorld("world:disposable"),
    { code: "WORLD_ACTIVE" }
  );
  registry.deactivateWorld("world:disposable");
  assert.throws(
    () => registry.unregisterWorld("world:disposable"),
    { code: "WORLD_NOT_CLOSED" }
  );

  const closed = registry.closeWorld("world:disposable");
  assert.equal(closed, true);
  const removed = registry.unregisterWorld("world:disposable");
  assert.equal(removed.worldId, "world:disposable");
  assert.equal(registry.has("world:disposable"), false);
  assert.equal(registry.size, 0);
});

test("World Registry cannot reactivate or unregister an unknown world", () => {
  const registry = new WorldRegistry();
  assert.throws(
    () => registry.unregisterWorld("world:missing"),
    { code: "UNKNOWN_WORLD" }
  );
});
