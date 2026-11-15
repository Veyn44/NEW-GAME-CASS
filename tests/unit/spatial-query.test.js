import test from "node:test";
import assert from "node:assert/strict";
import { EntityRegistry } from "../../engine/core/entity-registry.js";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { WorldContext } from "../../engine/core/world-context.js";
import { SpatialComposition, SpatialCompositionError } from "../../engine/spatial/spatial-composition.js";
import { PlacementCoordinator } from "../../engine/spatial/placement-coordinator.js";

function setup() {
  const entities = new EntityRegistry({ idFactory: () => "generated" });
  const worlds = new WorldRegistry({ idFactory: () => "world-generated" });
  worlds.registerWorld({ worldId: "grid", type: "test.grid", dimensions: { width: 8, height: 6 }, grid: { width: 8, height: 6 } });
  worlds.registerWorld({ worldId: "plain", type: "test.plain", dimensions: { width: 8, height: 6 } });
  const worldContext = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  const spatial = new SpatialComposition({ worldRegistry: worlds, entityRegistry: entities, idFactory: () => "generated-content" });
  const coordinator = new PlacementCoordinator({ entityRegistry: entities, worldRegistry: worlds, worldContext, spatialComposition: spatial });
  return { entities, worlds, spatial, coordinator };
}
function code(fn, expected) {
  assert.throws(fn, (error) => error instanceof SpatialCompositionError && error.code === expected);
}
function addContent(spatial, contentId, cell, categoryId = "terrain", layerId = "base") {
  return spatial.addCellContent({ contentId, worldId: "grid", cell, categoryId, layerId, payload: { contentId } });
}
function addPawn(entities, id) { entities.registerPersistent({ id, kind: "pawn" }); }
function place(s, id, anchor, footprint = [{ x: 0, y: 0 }]) {
  addPawn(s.entities, id);
  return s.coordinator.placeEntity(id, { worldId: "grid", anchor, footprint, orientation: 0 });
}

test("queryCell returns separate immutable content and occupancy facts", () => {
  const s = setup();
  addContent(s.spatial, "floor", { x: 2, y: 2 }, "terrain", "base");
  addContent(s.spatial, "lamp", { x: 2, y: 2 }, "fixture", "overlay");
  place(s, "pawn:a", { x: 2, y: 2 });
  const result = s.spatial.queryCell("grid", { x: 2, y: 2 }, { categories: ["terrain"] });
  assert.deepEqual(result.contents.map((r) => r.contentId), ["floor"]);
  assert.deepEqual(result.entities.map((r) => r.entityId), ["pawn:a"]);
  assert.deepEqual(result.entities[0].matchedCells, [{ x: 2, y: 2 }]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.entities), true);
  assert.equal(s.spatial.size, 2);
});

test("queryRegion rectangle is half-open and returns only matching occupied cells", () => {
  const s = setup();
  addContent(s.spatial, "inside", { x: 2, y: 3 });
  addContent(s.spatial, "edge", { x: 4, y: 3 });
  const result = s.spatial.queryRegion("grid", {
    type: "rectangle", min: { x: 1, y: 2 }, maxExclusive: { x: 4, y: 5 }
  });
  assert.deepEqual(result.cells.map((r) => r.cell), [{ x: 2, y: 3 }]);
  assert.deepEqual(result.contents.map((r) => r.contentId), ["inside"]);
  assert.deepEqual(result.region.maxExclusive, { x: 4, y: 5 });
});

test("queryRegion explicit cell sets deduplicate and normalize row-major", () => {
  const s = setup();
  addContent(s.spatial, "a", { x: 3, y: 1 });
  addContent(s.spatial, "b", { x: 1, y: 1 });
  const result = s.spatial.queryRegion("grid", {
    type: "cells", cells: [{ x: 3, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 1 }]
  });
  assert.deepEqual(result.region.cells, [{ x: 1, y: 1 }, { x: 3, y: 1 }]);
  assert.deepEqual(result.cells.map((r) => r.cell), [{ x: 1, y: 1 }, { x: 3, y: 1 }]);
});

test("entity region results deduplicate multi-cell footprints and expose matched cells", () => {
  const s = setup();
  place(s, "pawn:wide", { x: 2, y: 2 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  const result = s.spatial.queryEntitiesInRegion("grid", {
    type: "rectangle", min: { x: 2, y: 2 }, maxExclusive: { x: 4, y: 4 }
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].entityId, "pawn:wide");
  assert.deepEqual(result[0].matchedCells, [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }]);
  assert.deepEqual(s.spatial.getEntityFootprint("pawn:wide").cells, result[0].cells);
});

test("footprint lookup distinguishes unknown and non-grid-placed entities", () => {
  const s = setup();
  addPawn(s.entities, "pawn:stored");
  code(() => s.spatial.getEntityFootprint("pawn:missing"), "UNKNOWN_ENTITY");
  code(() => s.spatial.getEntityFootprint("pawn:stored"), "ENTITY_NOT_SPATIALLY_PLACED");
});

test("region validation rejects malformed and out-of-bounds rectangles", () => {
  const s = setup();
  code(() => s.spatial.queryRegion("grid", { type: "rectangle", min: { x: 0, y: 0 }, maxExclusive: { x: 9, y: 2 } }), "REGION_OUT_OF_BOUNDS");
  code(() => s.spatial.queryRegion("grid", { type: "rectangle", min: { x: 2, y: 2 }, maxExclusive: { x: 2, y: 3 } }), "INVALID_REGION");
  code(() => s.spatial.queryRegion("grid", { type: "cells", cells: [{ x: 8, y: 0 }] }), "CELL_OUT_OF_BOUNDS");
  code(() => s.spatial.queryRegion("plain", { type: "cells", cells: [] }), "WORLD_HAS_NO_GRID");
  code(() => s.spatial.queryCell("missing", { x: 0, y: 0 }), "UNKNOWN_WORLD");
});

test("neighbor and radius queries require explicit topology and metric", () => {
  const s = setup();
  assert.deepEqual(s.spatial.queryNeighbors("grid", { x: 0, y: 0 }, { topology: "four-way" }).map((r) => r.cell), [
    { x: 1, y: 0 }, { x: 0, y: 1 }
  ]);
  assert.equal(s.spatial.queryNeighbors("grid", { x: 0, y: 0 }, { topology: "eight-way" }).length, 3);
  assert.deepEqual(s.spatial.queryRadius("grid", { x: 2, y: 2 }, { radius: 1, metric: "manhattan" }).region.cells.length, 5);
  assert.deepEqual(s.spatial.queryRadius("grid", { x: 2, y: 2 }, { radius: 1, metric: "chebyshev" }).region.cells.length, 9);
  code(() => s.spatial.queryNeighbors("grid", { x: 0, y: 0 }, {}), "INVALID_TOPOLOGY");
  code(() => s.spatial.queryRadius("grid", { x: 0, y: 0 }, { radius: -1, metric: "manhattan" }), "INVALID_RADIUS");
  code(() => s.spatial.queryRadius("grid", { x: 0, y: 0 }, { radius: 1, metric: "euclidean" }), "INVALID_METRIC");
});

test("query results are read-only and querying never changes snapshots", () => {
  const s = setup();
  addContent(s.spatial, "one", { x: 1, y: 1 });
  place(s, "pawn:one", { x: 1, y: 1 });
  const before = s.spatial.captureSnapshot();
  const result = s.spatial.queryRegion("grid", { type: "rectangle", min: { x: 0, y: 0 }, maxExclusive: { x: 3, y: 3 } });
  assert.throws(() => result.cells.push({}), TypeError);
  assert.throws(() => result.cells[0].contents.push({}), TypeError);
  assert.deepEqual(s.spatial.captureSnapshot(), before);
});
