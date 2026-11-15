import test from "node:test";
import assert from "node:assert/strict";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { EntityRegistry } from "../../engine/core/entity-registry.js";
import { WorldContext } from "../../engine/core/world-context.js";
import { PlacementCoordinator } from "../../engine/spatial/placement-coordinator.js";
import { SpatialComposition } from "../../engine/spatial/spatial-composition.js";
import { querySpatialCell, querySpatialNeighbors, querySpatialRadius, querySpatialFootprint } from "../../dev-lab/application/spatial-inspector.js";

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

test("Dev Lab neighbor and radius inspection reuse Engine spatial queries", () => {
  const worlds = new WorldRegistry();
  worlds.registerWorld({
    worldId: "dev-lab-grid",
    type: "dev-lab-test",
    dimensions: { width: 64, height: 64 },
    grid: { width: 64, height: 64 }
  });
  const spatial = new SpatialComposition({ worldRegistry: worlds });
  assert.equal(querySpatialNeighbors(spatial, "dev-lab-grid", { x: 10, y: 10 }, "four-way").length, 4);
  assert.equal(querySpatialNeighbors(spatial, "dev-lab-grid", { x: 10, y: 10 }, "eight-way").length, 8);
  const radius = querySpatialRadius(spatial, "dev-lab-grid", { x: 10, y: 10 }, 2, "manhattan");
  assert.deepEqual(radius.cells, []);
  assert.equal(spatial.size, 0);
});

test("Dev Lab footprint inspection reads the authoritative Engine occupancy record", () => {
  const entities = new EntityRegistry();
  const worlds = new WorldRegistry();
  worlds.registerWorld({
    worldId: "dev-lab-grid",
    type: "dev-lab-test",
    dimensions: { width: 64, height: 64 },
    grid: { width: 64, height: 64 }
  });
  const worldContext = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  const spatial = new SpatialComposition({ worldRegistry: worlds, entityRegistry: entities });
  const placements = new PlacementCoordinator({
    entityRegistry: entities, worldRegistry: worlds, worldContext, spatialComposition: spatial
  });
  const entity = entities.registerPersistent({ id: "lab:footprint", kind: "test-object" });
  placements.placeEntity(entity.id, {
    worldId: "dev-lab-grid",
    anchor: { x: 7, y: 8 },
    footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
  });
  const result = querySpatialFootprint(spatial, entity.id);
  assert.equal(result.entityId, entity.id);
  assert.equal(result.cells.length, 4);
  assert.deepEqual(result.anchor, { x: 7, y: 8 });
});

test("Dev Lab spatial inspector rejects invalid grid coordinates before querying", () => {
  const spatial = { queryCell() { throw new Error("query should not run"); } };
  assert.throws(() => querySpatialCell(spatial, "dev-lab-grid", { x: 1.5, y: 2 }), /integer cell coordinates/);
  assert.throws(() => querySpatialCell(spatial, " ", { x: 1, y: 2 }), /world ID is required/);
});

test("Dev Lab spatial inspector requires the shared Engine query API", () => {
  assert.throws(() => querySpatialCell({}, "dev-lab-grid", { x: 1, y: 2 }), /Engine Spatial Composition/);
});
