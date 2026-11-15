import test from "node:test";
import assert from "node:assert/strict";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { SpatialComposition } from "../../engine/spatial/spatial-composition.js";
import { querySpatialCell } from "../../dev-lab/application/spatial-inspector.js";

test("Dev Lab spatial inspector reads empty cells through Engine Spatial Composition", () => {
  const worlds = new WorldRegistry();
  worlds.registerWorld({
    worldId: "dev-lab-grid",
    type: "dev-lab-test",
    dimensions: { width: 64, height: 64 },
    grid: { width: 64, height: 64 }
  });
  const spatial = new SpatialComposition({ worldRegistry: worlds });
  const result = querySpatialCell(spatial, "dev-lab-grid", { x: 12, y: 9 });
  assert.deepEqual(result.cell, { x: 12, y: 9 });
  assert.deepEqual(result.contents, []);
  assert.deepEqual(result.entities, []);
  assert.equal(spatial.size, 0, "Inspecting an empty cell must not materialize content.");
});

test("Dev Lab spatial inspector rejects invalid grid coordinates before querying", () => {
  const spatial = { queryCell() { throw new Error("query should not run"); } };
  assert.throws(() => querySpatialCell(spatial, "dev-lab-grid", { x: 1.5, y: 2 }), /integer cell coordinates/);
  assert.throws(() => querySpatialCell(spatial, " ", { x: 1, y: 2 }), /world ID is required/);
});

test("Dev Lab spatial inspector requires the shared Engine query API", () => {
  assert.throws(() => querySpatialCell({}, "dev-lab-grid", { x: 1, y: 2 }), /Engine Spatial Composition/);
});
