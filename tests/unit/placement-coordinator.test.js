import test from "node:test";
import assert from "node:assert/strict";
import { EntityRegistry } from "../../engine/core/entity-registry.js";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { WorldContext } from "../../engine/core/world-context.js";
import { SpatialComposition } from "../../engine/spatial/spatial-composition.js";
import { PlacementCoordinator } from "../../engine/spatial/placement-coordinator.js";

function setup() {
  const entities = new EntityRegistry({ idFactory: () => "generated" });
  const worlds = new WorldRegistry({ idFactory: () => "generated-world" });
  worlds.registerWorld({ worldId: "grid-a", type: "test.grid", dimensions: { width: 8, height: 8 }, grid: { width: 8, height: 8 } });
  worlds.registerWorld({ worldId: "grid-b", type: "test.grid", dimensions: { width: 8, height: 8 }, grid: { width: 8, height: 8 } });
  worlds.registerWorld({ worldId: "plain", type: "test.plain", dimensions: { width: 20, height: 20 } });
  const worldContext = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  const spatial = new SpatialComposition({ worldRegistry: worlds });
  const coordinator = new PlacementCoordinator({ entityRegistry: entities, worldRegistry: worlds, worldContext, spatialComposition: spatial });
  return { entities, worlds, worldContext, spatial, coordinator };
}
function pawn(entities, id = "pawn:one") { return entities.registerPersistent({ id, kind: "pawn" }); }
const footprint = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
function gridTarget(worldId = "grid-a", anchor = { x: 2, y: 2 }, shape = footprint, orientation = 0) {
  return { worldId, anchor, footprint: shape, orientation };
}
function throwsCode(fn, expected) { assert.throws(fn, (error) => error.code === expected); }

test("grid placement creates one identity and a derived multi-cell occupancy index", () => {
  const s = setup(); pawn(s.entities);
  const result = s.coordinator.placeEntity("pawn:one", gridTarget());
  assert.equal(result.current.position.x, 2.5);
  assert.equal(result.current.position.y, 2.5);
  assert.equal(s.spatial.getEntityOccupancy("pawn:one").cells.length, 3);
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 3, y: 2 }), ["pawn:one"]);
  assert.equal(s.entities.get("pawn:one").id, "pawn:one");
});

test("multiple entities may share cells; overlap policy remains host-owned", () => {
  const s = setup(); pawn(s.entities); pawn(s.entities, "pawn:two");
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  s.coordinator.placeEntity("pawn:two", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 1, y: 1 }), ["pawn:one", "pawn:two"]);
});

test("grid move and rotation replace all derived cells", () => {
  const s = setup(); pawn(s.entities); s.coordinator.placeEntity("pawn:one", gridTarget());
  s.coordinator.moveEntity("pawn:one", { type: "grid", ...gridTarget("grid-b", { x: 4, y: 3 }, footprint, 90) });
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 3, y: 2 }), []);
  assert.deepEqual(s.spatial.getCellEntities("grid-b", { x: 4, y: 4 }), ["pawn:one"]);
  assert.equal(s.worldContext.getPlacement("pawn:one").worldId, "grid-b");
  assert.deepEqual(s.spatial.getEntityOccupancy("pawn:one").anchor, { x: 4, y: 3 });
});

test("invalid footprint leaves both authoritative representations unchanged", () => {
  const s = setup(); pawn(s.entities); s.coordinator.placeEntity("pawn:one", gridTarget());
  const p = s.worldContext.getPlacement("pawn:one"), o = s.spatial.getEntityOccupancy("pawn:one");
  throwsCode(() => s.coordinator.moveEntity("pawn:one", { type: "grid", ...gridTarget("grid-a", { x: 7, y: 7 }) }), "FOOTPRINT_OUT_OF_BOUNDS");
  assert.equal(s.worldContext.getPlacement("pawn:one"), p);
  assert.equal(s.spatial.getEntityOccupancy("pawn:one"), o);
});

test("direct one-sided placement and lifecycle mutations are blocked", () => {
  const s = setup(); pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  throwsCode(() => s.worldContext.moveEntity("pawn:one", { type: "world", worldId: "plain", position: { x: 2, y: 2 } }), "GRID_COORDINATOR_REQUIRED");
  throwsCode(() => s.worldContext.removePlacement("pawn:one"), "GRID_COORDINATOR_REQUIRED");
  throwsCode(() => s.entities.remove("pawn:one"), "GRID_COORDINATOR_REQUIRED");
  throwsCode(() => s.entities.store("pawn:one"), "GRID_COORDINATOR_REQUIRED");
});

test("grid to non-grid transfer clears occupancy and preserves continuous coordinates", () => {
  const s = setup(); pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  s.coordinator.moveEntity("pawn:one", { type: "world", worldId: "plain", position: { x: 3.25, y: 4.75 } });
  assert.deepEqual(s.worldContext.getPlacement("pawn:one").position, { x: 3.25, y: 4.75 });
  assert.equal(s.spatial.getEntityOccupancy("pawn:one"), null);
});

test("grid storage and restoration coordinate lifecycle with occupancy", () => {
  const s = setup(); s.entities.registerScoped({ scopeId: "mission", localId: "body", kind: "pawn" });
  s.coordinator.placeEntity("scope:mission:body", gridTarget("grid-a", { x: 2, y: 2 }, [{ x: 0, y: 0 }]));
  s.coordinator.storeEntity("scope:mission:body", "campaign:store");
  assert.equal(s.entities.get("scope:mission:body").status, "stored");
  assert.equal(s.worldContext.getPlacement("scope:mission:body").type, "store");
  assert.equal(s.spatial.getEntityOccupancy("scope:mission:body"), null);
  s.coordinator.moveEntity("scope:mission:body", { type: "grid", ...gridTarget("grid-b", { x: 3, y: 3 }, [{ x: 0, y: 0 }]) });
  assert.equal(s.entities.get("scope:mission:body").status, "active");
  assert.equal(s.worldContext.getPlacement("scope:mission:body").position.x, 3.5);
  assert.deepEqual(s.spatial.getCellEntities("grid-b", { x: 3, y: 3 }), ["scope:mission:body"]);
});

test("coordinated retirement clears occupancy and tombstones identity", () => {
  const s = setup(); pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 2, y: 2 }, [{ x: 0, y: 0 }]));
  s.coordinator.removeEntity("pawn:one");
  assert.equal(s.worldContext.getPlacement("pawn:one"), null);
  assert.equal(s.spatial.getEntityOccupancy("pawn:one"), null);
  assert.equal(s.entities.get("pawn:one").status, "removed");
});

test("composite persistence restores WorldContext and SpatialComposition together", () => {
  const s = setup(); pawn(s.entities); s.coordinator.placeEntity("pawn:one", gridTarget());
  const participant = s.coordinator.createPersistenceParticipant(), snapshot = participant.captureSnapshot();
  s.coordinator.moveEntity("pawn:one", { type: "grid", ...gridTarget("grid-b", { x: 4, y: 4 }, footprint, 90) });
  const tx = participant.prepareRestore(snapshot); tx.commit();
  assert.equal(s.worldContext.getPlacement("pawn:one").worldId, "grid-a");
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 3, y: 2 }), ["pawn:one"]);
  assert.deepEqual(s.spatial.getCellEntities("grid-b", { x: 4, y: 5 }), []);
});

test("composite restore rejects mismatched placement and occupancy anchors", () => {
  const s = setup(); pawn(s.entities); s.coordinator.placeEntity("pawn:one", gridTarget());
  const participant = s.coordinator.createPersistenceParticipant(), snapshot = participant.captureSnapshot();
  const bad = { ...snapshot, worldContext: { ...snapshot.worldContext, placements: snapshot.worldContext.placements.map(p => ({ ...p, position: { x: 7.5, y: 7.5 } })) } };
  assert.equal(participant.validateSnapshot(bad), false);
  throwsCode(() => participant.prepareRestore(bad), "PLACEMENT_INTEGRITY_MISMATCH");
});

test("non-grid placement remains available directly through WorldContext", () => {
  const s = setup(); pawn(s.entities);
  const placement = s.worldContext.placeEntity("pawn:one", "plain", { x: 2.25, y: 5.5 });
  assert.deepEqual(placement.position, { x: 2.25, y: 5.5 });
});

test("WorldContext restore cannot bypass the composite grid placement participant", () => {
  const s = setup(); pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  throwsCode(() => s.worldContext.prepareRestore(s.worldContext.captureSnapshot()), "GRID_COORDINATOR_REQUIRED");
});

test("rollback integrity failure faults coordinator and signals the host", () => {
  const entities = new EntityRegistry({ idFactory: () => "generated" });
  const worlds = new WorldRegistry({ idFactory: () => "generated-world" });
  worlds.registerWorld({ worldId: "grid", type: "test.grid", dimensions: { width: 4, height: 4 }, grid: { width: 4, height: 4 } });
  pawn(entities);
  const realWorldContext = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  const realSpatial = new SpatialComposition({ worldRegistry: worlds });
  const brokenWorldContext = {
    requireSpatialCoordination: realWorldContext.requireSpatialCoordination.bind(realWorldContext),
    getPlacement: realWorldContext.getPlacement.bind(realWorldContext),
    prepareCoordinatedPlacementChange(...args) {
      const tx = realWorldContext.prepareCoordinatedPlacementChange(...args);
      return { ...tx, commit: tx.commit, rollback() { throw new Error("injected rollback failure"); } };
    }
  };
  const brokenSpatial = {
    hasEntityOccupancy: realSpatial.hasEntityOccupancy.bind(realSpatial),
    getEntityOccupancy: realSpatial.getEntityOccupancy.bind(realSpatial),
    prepareEntityOccupancyChange(...args) {
      const tx = realSpatial.prepareEntityOccupancyChange(...args);
      return { ...tx, commit() { throw new Error("injected spatial commit failure"); }, rollback: tx.rollback };
    }
  };
  let signaled = 0;
  const coordinator = new PlacementCoordinator({
    entityRegistry: entities, worldRegistry: worlds, worldContext: brokenWorldContext,
    spatialComposition: brokenSpatial, onFatalIntegrityFault: () => { signaled += 1; }
  });
  throwsCode(() => coordinator.placeEntity("pawn:one", { worldId: "grid", anchor: { x: 1, y: 1 }, footprint: [{ x: 0, y: 0 }] }), "FATAL_INTEGRITY_FAULT");
  assert.equal(coordinator.isFaulted, true);
  assert.equal(signaled, 1);
  throwsCode(() => coordinator.placeEntity("pawn:one", { worldId: "grid", anchor: { x: 2, y: 2 }, footprint: [{ x: 0, y: 0 }] }), "FATAL_INTEGRITY_FAULT");
});

test("SpatialComposition restore cannot replace entity occupancy outside the coordinator", () => {
  const s = setup(); pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  throwsCode(() => s.spatial.prepareRestore(s.spatial.captureSnapshot()), "PLACEMENT_AUTHORITY_REQUIRED");
});

test("EntityRegistry restore cannot invalidate an occupied grid entity outside composite persistence", () => {
  const s = setup(); pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  throwsCode(() => s.entities.prepareRestore(s.entities.captureSnapshot()), "PLACEMENT_AUTHORITY_REQUIRED");
});


test("Persistence rolls back the composite placement aggregate when a later participant commit fails", async () => {
  const { Persistence, MemorySaveAdapter } = await import("../../engine/core/persistence.js");
  const s = setup();
  pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));

  const adapter = new MemorySaveAdapter();
  const persistence = new Persistence({
    adapter,
    runAtSafeBoundary: (operation) => operation()
  });
  persistence.registerParticipant(s.entities.createPersistenceParticipant());
  persistence.registerParticipant(s.worlds.createPersistenceParticipant());
  persistence.registerParticipant(s.coordinator.createPersistenceParticipant());
  persistence.registerParticipant({
    id: "test.fail-after-placement",
    schemaVersion: 1,
    order: 0,
    captureSnapshot: () => ({ marker: "saved" }),
    prepareRestore: () => ({
      commit() { throw new Error("injected later participant failure"); },
      rollback() { return true; }
    })
  });

  await persistence.save("placement-rollback", { stateId: "test:placement-rollback" });
  s.coordinator.moveEntity("pawn:one", {
    type: "grid",
    ...gridTarget("grid-b", { x: 5, y: 4 }, [{ x: 0, y: 0 }])
  });

  await assert.rejects(
    persistence.load("placement-rollback", { stateId: "test:placement-rollback" }),
    (error) => error.code === "RESTORE_COMMIT_FAILED"
  );

  assert.equal(s.worldContext.getPlacement("pawn:one").worldId, "grid-b");
  assert.deepEqual(s.worldContext.getPlacement("pawn:one").position, { x: 5.5, y: 4.5 });
  assert.equal(s.spatial.getEntityOccupancy("pawn:one").worldId, "grid-b");
  assert.deepEqual(s.spatial.getCellEntities("grid-b", { x: 5, y: 4 }), ["pawn:one"]);
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 1, y: 1 }), []);
});


test("grid-backed target requires an explicit grid anchor and footprint", () => {
  const s = setup(); pawn(s.entities);
  s.coordinator.placeEntity("pawn:one", gridTarget("grid-a", { x: 1, y: 1 }, [{ x: 0, y: 0 }]));
  const placement = s.worldContext.getPlacement("pawn:one");
  const occupancy = s.spatial.getEntityOccupancy("pawn:one");

  throwsCode(() => s.coordinator.moveEntity("pawn:one", {
    type: "world",
    worldId: "grid-b",
    position: { x: 4.5, y: 4.5 }
  }), "GRID_TARGET_REQUIRED");

  assert.equal(s.worldContext.getPlacement("pawn:one"), placement);
  assert.equal(s.spatial.getEntityOccupancy("pawn:one"), occupancy);
  assert.deepEqual(s.spatial.getCellEntities("grid-b", { x: 4, y: 4 }), []);
});

test("placeEntity rejects an explicitly non-grid target instead of coercing it", () => {
  const s = setup(); pawn(s.entities);
  throwsCode(() => s.coordinator.placeEntity("pawn:one", {
    type: "world",
    worldId: "grid-a",
    position: { x: 2.5, y: 2.5 }
  }), "INVALID_GRID_TARGET");
  assert.equal(s.worldContext.getPlacement("pawn:one"), null);
  assert.equal(s.spatial.getEntityOccupancy("pawn:one"), null);
});
