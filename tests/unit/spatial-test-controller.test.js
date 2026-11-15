import test from "node:test";
import assert from "node:assert/strict";
import { EntityRegistry } from "../../engine/core/entity-registry.js";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { WorldContext } from "../../engine/core/world-context.js";
import { SpatialComposition } from "../../engine/spatial/spatial-composition.js";
import { PlacementCoordinator } from "../../engine/spatial/placement-coordinator.js";
import { SpatialMovement } from "../../engine/spatial/spatial-movement.js";
import { SpatialTestController } from "../../dev-lab/application/spatial-test-controller.js";

function setup() {
  const entities = new EntityRegistry();
  const worlds = new WorldRegistry();
  worlds.registerWorld({
    worldId: "lab-grid", type: "dev-lab-test",
    dimensions: { width: 12, height: 12 }, grid: { width: 12, height: 12 }
  });
  worlds.activateWorld("lab-grid");
  const worldContext = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  const spatial = new SpatialComposition({ worldRegistry: worlds, entityRegistry: entities });
  const placements = new PlacementCoordinator({
    entityRegistry: entities, worldRegistry: worlds, worldContext, spatialComposition: spatial
  });
  const movement = new SpatialMovement({
    entityRegistry: entities, worldRegistry: worlds,
    spatialComposition: spatial, placementCoordinator: placements
  });
  const controller = new SpatialTestController({
    entityRegistry: entities, worldRegistry: worlds,
    spatialComposition: spatial, placementCoordinator: placements, spatialMovement: movement
  });
  return { entities, worlds, spatial, placements, controller };
}

test("Dev Lab creates a test entity through the Engine placement coordinator", () => {
  const s = setup();
  const created = s.controller.create({ anchor: { x: 2, y: 3 } });
  assert.equal(created.entity.kind, "dev-lab.test-entity");
  assert.equal(created.occupancy.worldId, "lab-grid");
  assert.deepEqual(s.spatial.getCellEntities("lab-grid", { x: 2, y: 3 }), [created.entity.id]);
  assert.equal(s.controller.list().length, 1);
});

test("Dev Lab test entity footprints are registered as Engine occupancy", () => {
  const s = setup();
  const created = s.controller.create({
    anchor: { x: 4, y: 4 },
    footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
  });
  assert.equal(created.occupancy.cells.length, 4);
  assert.deepEqual(s.spatial.getCellEntities("lab-grid", { x: 5, y: 5 }), [created.entity.id]);
});

test("Dev Lab rejects a spawned footprint that overlaps existing occupancy", () => {
  const s = setup();
  const first = s.controller.create({ anchor: { x: 4, y: 4 } });
  assert.throws(
    () => s.controller.create({
      anchor: { x: 3, y: 3 },
      footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
    }),
    (error) => error.code === "DEV_LAB_OVERLAP"
  );
  assert.deepEqual(s.spatial.getCellEntities("lab-grid", { x: 4, y: 4 }), [first.entity.id]);
  assert.equal(s.controller.list().length, 1);
});

test("Dev Lab movement commits a free target and rejects an occupied target", () => {
  const s = setup();
  const first = s.controller.create({ anchor: { x: 1, y: 1 } });
  const second = s.controller.create({ anchor: { x: 5, y: 5 } });
  const moved = s.controller.move(first.entity.id, { anchor: { x: 2, y: 2 } });
  assert.equal(moved.status, "moved");
  assert.equal(moved.diagnostic.status, "moved");
  assert.deepEqual(s.spatial.getCellEntities("lab-grid", { x: 1, y: 1 }), []);
  assert.deepEqual(s.spatial.getCellEntities("lab-grid", { x: 2, y: 2 }), [first.entity.id]);
  const rejected = s.controller.move(first.entity.id, { anchor: { x: 5, y: 5 } });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.code, "DEV_LAB_OVERLAP");
  assert.deepEqual(rejected.diagnostic.overlaps, [second.entity.id]);
  assert.equal(s.controller.getLastMovement().status, "rejected");
  assert.deepEqual(s.spatial.getCellEntities("lab-grid", { x: 5, y: 5 }), [second.entity.id]);
});

test("Dev Lab removes test entities through coordinated retirement", () => {
  const s = setup();
  const created = s.controller.create({ anchor: { x: 3, y: 3 } });
  const retired = s.controller.remove(created.entity.id);
  assert.equal(retired.status, "removed");
  assert.equal(s.spatial.getEntityOccupancy(created.entity.id), null);
  assert.deepEqual(s.spatial.getCellEntities("lab-grid", { x: 3, y: 3 }), []);
  assert.equal(s.controller.list().length, 0);
});

test("Dev Lab reset helper retires every spatial test entity", () => {
  const s = setup();
  const first = s.controller.create({ anchor: { x: 1, y: 1 } });
  const second = s.controller.create({ anchor: { x: 3, y: 3 } });
  const removed = s.controller.removeAll();
  assert.deepEqual(removed.map((entity) => entity.id).sort(), [first.entity.id, second.entity.id].sort());
  assert.equal(s.controller.list().length, 0);
  assert.equal(s.spatial.entityOccupancyCount, 0);
});

test("Dev Lab controller refuses to mutate non-test Engine entities", () => {
  const s = setup();
  const external = s.entities.registerPersistent({ id: "campaign:pawn", kind: "pawn" });
  s.placements.placeEntity(external.id, {
    worldId: "lab-grid", anchor: { x: 1, y: 1 }, footprint: [{ x: 0, y: 0 }]
  });
  assert.throws(() => s.controller.move(external.id, { anchor: { x: 2, y: 2 } }), /Only active Dev Lab/);
  assert.throws(() => s.controller.remove(external.id), /Only active Dev Lab/);
});
