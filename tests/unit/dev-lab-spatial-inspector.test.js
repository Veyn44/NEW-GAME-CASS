import test from "node:test";
import assert from "node:assert/strict";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { EntityRegistry } from "../../engine/core/entity-registry.js";
import { WorldContext } from "../../engine/core/world-context.js";
import { PlacementCoordinator } from "../../engine/spatial/placement-coordinator.js";
import { SpatialComposition } from "../../engine/spatial/spatial-composition.js";
import { querySpatialCell, querySpatialNeighbors, querySpatialRadius, querySpatialFootprint, querySpatialRegion } from "../../dev-lab/application/spatial-inspector.js";

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

test("Dev Lab rectangular region inspection applies category, layer and entity-kind filters", () => {
  const entities = new EntityRegistry();
  const worlds = new WorldRegistry();
  worlds.registerWorld({
    worldId: "dev-lab-grid",
    type: "dev-lab-test",
    dimensions: { width: 16, height: 16 },
    grid: { width: 16, height: 16 }
  });
  const worldContext = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  const spatial = new SpatialComposition({ worldRegistry: worlds, entityRegistry: entities });
  const placements = new PlacementCoordinator({
    entityRegistry: entities, worldRegistry: worlds, worldContext, spatialComposition: spatial
  });
  const unit = entities.registerPersistent({ id: "lab:region-unit", kind: "unit" });
  const wall = entities.registerPersistent({ id: "lab:region-wall", kind: "structure" });
  placements.placeEntity(unit.id, {
    worldId: "dev-lab-grid", anchor: { x: 3, y: 3 }, footprint: [{ x: 0, y: 0 }]
  });
  placements.placeEntity(wall.id, {
    worldId: "dev-lab-grid", anchor: { x: 4, y: 4 }, footprint: [{ x: 0, y: 0 }]
  });
  spatial.addCellContent({
    contentId: "content:ground",
    worldId: "dev-lab-grid",
    cell: { x: 2, y: 2 },
    categoryId: "terrain",
    layerId: "ground",
    payload: { material: "rock" }
  });
  spatial.addCellContent({
    contentId: "content:wall",
    worldId: "dev-lab-grid",
    cell: { x: 5, y: 5 },
    categoryId: "structure",
    layerId: "built",
    payload: { material: "alloy" }
  });

  const result = querySpatialRegion(spatial, "dev-lab-grid", {
    type: "rectangle",
    min: { x: 1, y: 1 },
    maxExclusive: { x: 6, y: 6 }
  }, {
    categories: ["terrain"],
    layers: ["ground"],
    kinds: ["unit"]
  });
  assert.deepEqual(result.contents.map((entry) => entry.contentId), ["content:ground"]);
  assert.deepEqual(result.entities.map((entry) => entry.entityId), [unit.id]);
  assert.deepEqual(result.region, {
    type: "rectangle",
    min: { x: 1, y: 1 },
    maxExclusive: { x: 6, y: 6 }
  });
});

test("Dev Lab spatial inspector rejects invalid grid coordinates before querying", () => {
  const spatial = { queryCell() { throw new Error("query should not run"); } };
  assert.throws(() => querySpatialCell(spatial, "dev-lab-grid", { x: 1.5, y: 2 }), /integer cell coordinates/);
  assert.throws(() => querySpatialCell(spatial, " ", { x: 1, y: 2 }), /world ID is required/);
});

test("Dev Lab spatial inspector requires the shared Engine query API", () => {
  assert.throws(() => querySpatialCell({}, "dev-lab-grid", { x: 1, y: 2 }), /Engine Spatial Composition/);
});
