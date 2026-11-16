import test from "node:test";
import assert from "node:assert/strict";
import { EntityRegistry } from "../../engine/core/entity-registry.js";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { WorldContext } from "../../engine/core/world-context.js";
import { SpatialComposition } from "../../engine/spatial/spatial-composition.js";
import { PlacementCoordinator } from "../../engine/spatial/placement-coordinator.js";
import { SpatialMovement } from "../../engine/spatial/spatial-movement.js";

function setup() {
  const entities = new EntityRegistry({ idFactory: () => "generated" });
  const worlds = new WorldRegistry({ idFactory: () => "generated-world" });
  worlds.registerWorld({ worldId: "grid-a", type: "test.grid", dimensions: { width: 8, height: 8 }, grid: { width: 8, height: 8 } });
  worlds.registerWorld({ worldId: "grid-b", type: "test.grid", dimensions: { width: 5, height: 5 }, grid: { width: 5, height: 5 } });
  worlds.registerWorld({ worldId: "plain", type: "test.plain", dimensions: { width: 8, height: 8 } });
  worlds.registerWorld({ worldId: "closed", type: "test.closed", dimensions: { width: 8, height: 8 }, grid: { width: 8, height: 8 } });
  worlds.closeWorld("closed");
  const worldContext = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  const spatial = new SpatialComposition({ worldRegistry: worlds, entityRegistry: entities });
  const placements = new PlacementCoordinator({ entityRegistry: entities, worldRegistry: worlds, worldContext, spatialComposition: spatial });
  const movement = new SpatialMovement({ entityRegistry: entities, worldRegistry: worlds, spatialComposition: spatial, placementCoordinator: placements });
  return { entities, worlds, worldContext, spatial, placements, movement };
}
function register(s, id, kind = "pawn") { s.entities.registerPersistent({ id, kind }); }
function place(s, id, anchor, footprint = [{ x: 0, y: 0 }], worldId = "grid-a") {
  register(s, id);
  s.placements.placeEntity(id, { worldId, anchor, footprint, orientation: 0 });
}
function occupancy(s, id) { return s.spatial.getEntityFootprint(id); }

test("accepted move commits complete footprint and removes every old cell", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  const seen = [];
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 3, y: 2 }, orientation: 90 }, (context) => {
    seen.push(context);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(context.target.cells), true);
    assert.equal(context.target.cells.length, 3);
    return { accepted: true };
  });
  assert.equal(result.status, "moved");
  assert.deepEqual(occupancy(s, "pawn:mover").anchor, { x: 3, y: 2 });
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 1, y: 1 }), []);
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 3, y: 2 }), ["pawn:mover"]);
  assert.equal(seen.length, 1);
});

test("policy receives geometric overlaps and cell contents without Engine semantics", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  place(s, "machine:other", { x: 3, y: 1 }, [{ x: 0, y: 0 }, { x: 0, y: 1 }]);
  s.spatial.addCellContent({ contentId: "wall:fixture", worldId: "grid-a", cell: { x: 3, y: 1 }, categoryId: "structure", layerId: "physical" });
  let received;
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 3, y: 1 } }, (context) => {
    received = context;
    return true;
  });
  assert.equal(result.status, "moved");
  assert.deepEqual(received.overlaps.map((x) => x.entityId), ["machine:other"]);
  assert.deepEqual(received.contents.map((x) => x.contentId), ["wall:fixture"]);
  assert.equal(received.overlaps[0].cells.length, 2);
});

test("policy rejection leaves the previous footprint and WorldContext placement unchanged", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  const beforePlacement = s.worldContext.getPlacement("pawn:mover");
  const beforeOccupancy = occupancy(s, "pawn:mover");
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 4, y: 4 } }, () => ({
    accepted: false, code: "HOST_BLOCKED", reason: "Host policy rejected this target."
  }));
  assert.equal(result.status, "rejected");
  assert.equal(result.code, "HOST_BLOCKED");
  assert.equal(s.worldContext.getPlacement("pawn:mover"), beforePlacement);
  assert.equal(occupancy(s, "pawn:mover"), beforeOccupancy);
});

test("host policy can allow overlap and Engine does not impose a blocker rule", () => {
  const s = setup();
  place(s, "pawn:a", { x: 1, y: 1 });
  place(s, "pawn:b", { x: 3, y: 1 });
  const result = s.movement.moveEntity("pawn:a", { worldId: "grid-a", anchor: { x: 3, y: 1 } }, (context) => {
    assert.deepEqual(context.overlaps.map((x) => x.entityId), ["pawn:b"]);
    return true;
  });
  assert.equal(result.status, "moved");
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 3, y: 1 }), ["pawn:a", "pawn:b"]);
});

test("anchor inside bounds does not permit an out-of-bounds multi-cell footprint", () => {
  const s = setup();
  place(s, "pawn:wide", { x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  let called = false;
  const result = s.movement.moveEntity("pawn:wide", { worldId: "grid-b", anchor: { x: 4, y: 2 } }, () => { called = true; return true; });
  assert.equal(result.status, "out-of-bounds");
  assert.equal(called, false);
  assert.equal(occupancy(s, "pawn:wide").worldId, "grid-a");
});

test("same-position move is unchanged and does not invoke host policy", () => {
  const s = setup();
  place(s, "pawn:still", { x: 2, y: 3 });
  let called = false;
  const result = s.movement.moveEntity("pawn:still", { worldId: "grid-a", anchor: { x: 2, y: 3 } }, () => { called = true; return false; });
  assert.equal(result.status, "unchanged");
  assert.equal(called, false);
});

test("grid-to-grid movement preserves identity and atomically transfers occupancy", () => {
  const s = setup();
  place(s, "pawn:traveler", { x: 2, y: 2 });
  const beforeId = s.entities.get("pawn:traveler").id;
  const result = s.movement.moveEntity("pawn:traveler", { worldId: "grid-b", anchor: { x: 1, y: 1 } }, () => true);
  assert.equal(result.status, "moved");
  assert.equal(s.entities.get("pawn:traveler").id, beforeId);
  assert.deepEqual(s.spatial.getCellEntities("grid-a", { x: 2, y: 2 }), []);
  assert.deepEqual(s.spatial.getCellEntities("grid-b", { x: 1, y: 1 }), ["pawn:traveler"]);
});

test("invalid, unavailable and ineligible requests return stable outcomes", () => {
  const s = setup();
  register(s, "pawn:unplaced");
  assert.equal(s.movement.moveEntity("pawn:unplaced", { worldId: "grid-a", anchor: { x: 1, y: 1 } }, () => true).code, "ENTITY_NOT_SPATIALLY_PLACED");
  place(s, "pawn:placed", { x: 1, y: 1 });
  assert.equal(s.movement.moveEntity("pawn:placed", { worldId: "missing", anchor: { x: 1, y: 1 } }, () => true).status, "unavailable");
  assert.equal(s.movement.moveEntity("pawn:placed", { worldId: "plain", anchor: { x: 1, y: 1 } }, () => true).code, "WORLD_HAS_NO_GRID");
  assert.equal(s.movement.moveEntity("pawn:placed", { worldId: "closed", anchor: { x: 1, y: 1 } }, () => true).code, "WORLD_CLOSED");
  assert.equal(s.movement.moveEntity("pawn:placed", { worldId: "grid-a", anchor: { x: 1.5, y: 1 } }, () => true).status, "invalid");
  assert.equal(s.movement.moveEntity("pawn:placed", { worldId: "grid-a", anchor: { x: 2, y: 2 } }).code, "INVALID_POLICY");
  assert.equal(s.movement.moveEntity("pawn:missing", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => true).code, "ENTITY_NOT_ELIGIBLE");
});

test("asynchronous, throwing and malformed policies fail without moving", async () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  const before = occupancy(s, "pawn:mover");
  place(s, "pawn:other", { x: 5, y: 5 });
  const otherBefore = occupancy(s, "pawn:other");
  assert.equal(s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => Promise.resolve(true)).code, "ASYNC_POLICY_UNSUPPORTED");
  assert.equal(s.movement.moveEntity("pawn:other", { worldId: "grid-a", anchor: { x: 6, y: 6 } }, () => { throw new Error("policy failure"); }).code, "POLICY_EVALUATION_FAILED");
  assert.equal(s.movement.moveEntity("pawn:other", { worldId: "grid-a", anchor: { x: 6, y: 6 } }, () => "yes").code, "INVALID_POLICY_RESULT");
  assert.equal(occupancy(s, "pawn:mover"), before);
  assert.equal(occupancy(s, "pawn:other"), otherBefore);
  await Promise.resolve();
});

test("policy cannot recursively start a second move for the same entity", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  let nested;
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => {
    nested = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 3, y: 3 } }, () => true);
    return true;
  });
  assert.equal(nested.code, "REENTRANT_MOVEMENT");
  assert.equal(result.status, "moved");
  assert.deepEqual(occupancy(s, "pawn:mover").anchor, { x: 2, y: 2 });
});

test("policy evaluation cannot mutate Spatial Composition cell contents", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  const before = occupancy(s, "pawn:mover");
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => {
    s.spatial.addCellContent({ contentId: "wall:illegal", worldId: "grid-a", cell: { x: 2, y: 2 }, categoryId: "structure" });
    return true;
  });
  assert.equal(result.status, "policy-error");
  assert.equal(result.code, "POLICY_EVALUATION_FAILED");
  assert.equal(occupancy(s, "pawn:mover"), before);
  assert.equal(s.spatial.getContent("wall:illegal"), null);
});

test("policy evaluation cannot remove existing Spatial Composition cell contents", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  s.spatial.addCellContent({
    contentId: "wall:existing",
    worldId: "grid-a",
    cell: { x: 2, y: 2 },
    categoryId: "structure"
  });
  const before = occupancy(s, "pawn:mover");
  const result = s.movement.moveEntity(
    "pawn:mover",
    { worldId: "grid-a", anchor: { x: 2, y: 2 } },
    () => {
      s.spatial.removeCellContent("wall:existing");
      return true;
    }
  );
  assert.equal(result.status, "policy-error");
  assert.equal(result.code, "POLICY_EVALUATION_FAILED");
  assert.equal(s.spatial.getContent("wall:existing")?.contentId, "wall:existing");
  assert.equal(occupancy(s, "pawn:mover"), before);
});

test("policy evaluation cannot commit a prepared Spatial Composition restore", () => {
  const s = setup();
  const preparedRestore = s.spatial.prepareRestore(s.spatial.captureSnapshot());
  place(s, "pawn:mover", { x: 1, y: 1 });
  const before = occupancy(s, "pawn:mover");
  const result = s.movement.moveEntity(
    "pawn:mover",
    { worldId: "grid-a", anchor: { x: 2, y: 2 } },
    () => {
      preparedRestore.commit();
      return true;
    }
  );
  assert.equal(result.status, "policy-error");
  assert.equal(result.code, "POLICY_EVALUATION_FAILED");
  assert.equal(occupancy(s, "pawn:mover"), before);
});

test("policy evaluation cannot mutate placements through PlacementCoordinator", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  place(s, "pawn:other", { x: 5, y: 5 });
  const beforeMover = occupancy(s, "pawn:mover");
  const beforeOther = occupancy(s, "pawn:other");
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => {
    s.placements.moveEntity("pawn:other", { type: "grid", worldId: "grid-a", anchor: { x: 6, y: 6 }, footprint: [{ x: 0, y: 0 }], orientation: 0 });
    return true;
  });
  assert.equal(result.status, "policy-error");
  assert.equal(result.code, "POLICY_EVALUATION_FAILED");
  assert.equal(occupancy(s, "pawn:mover"), beforeMover);
  assert.equal(occupancy(s, "pawn:other"), beforeOther);
});

test("movement cannot silently change an entity footprint", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  const before = occupancy(s, "pawn:mover");
  const result = s.movement.moveEntity("pawn:mover", {
    worldId: "grid-a", anchor: { x: 2, y: 2 }, footprint: [{ x: 0, y: 0 }]
  }, () => true);
  assert.equal(result.code, "FOOTPRINT_CHANGE_NOT_SUPPORTED");
  assert.equal(occupancy(s, "pawn:mover"), before);
});

test("policy decision accessors are evaluated while spatial writes are locked", () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  const before = occupancy(s, "pawn:mover");
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => ({
    get accepted() {
      s.spatial.addCellContent({ contentId: "wall:from-getter", worldId: "grid-a", cell: { x: 2, y: 2 }, categoryId: "structure" });
      return true;
    }
  }));
  assert.equal(result.status, "policy-error");
  assert.equal(occupancy(s, "pawn:mover"), before);
  assert.equal(s.spatial.getContent("wall:from-getter"), null);
});

test("async policy cannot mutate spatial services after its first await", async () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  let completion;
  let mutationRejected = false;
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => {
    completion = (async () => {
      await Promise.resolve();
      try {
        s.spatial.addCellContent({ contentId: "wall:async", worldId: "grid-a", cell: { x: 2, y: 2 }, categoryId: "structure" });
      } catch (error) {
        mutationRejected = error.code === "SPATIAL_MUTATION_DURING_POLICY";
      }
      return true;
    })();
    return completion;
  });
  assert.equal(result.code, "ASYNC_POLICY_UNSUPPORTED");
  await completion;
  assert.equal(mutationRejected, true);
  assert.equal(s.spatial.getContent("wall:async"), null);
  assert.deepEqual(occupancy(s, "pawn:mover").anchor, { x: 1, y: 1 });
});

test("async policy keeps the mover reentrancy guard until settlement", async () => {
  const s = setup();
  place(s, "pawn:mover", { x: 1, y: 1 });
  let completion;
  let nested;
  const result = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 2, y: 2 } }, () => {
    completion = (async () => {
      await Promise.resolve();
      nested = s.movement.moveEntity("pawn:mover", { worldId: "grid-a", anchor: { x: 3, y: 3 } }, () => true);
      return true;
    })();
    return completion;
  });
  assert.equal(result.code, "ASYNC_POLICY_UNSUPPORTED");
  await completion;
  assert.equal(nested.code, "REENTRANT_MOVEMENT");
  assert.deepEqual(occupancy(s, "pawn:mover").anchor, { x: 1, y: 1 });
});


test("policy evaluation cannot mutate WorldContext through direct APIs or prepared restore transactions", () => {
  const s = setup();
  const preparedRestore = s.worldContext.prepareRestore(s.worldContext.captureSnapshot());
  place(s, "pawn:mover", { x: 1, y: 1 });

  register(s, "pawn:new");
  register(s, "pawn:plain");
  s.worldContext.placeEntity("pawn:plain", "plain", { x: 1, y: 1 });

  const scoped = s.entities.registerScoped({ scopeId: "policy-test", localId: "store-active", kind: "item" });
  s.worldContext.placeEntity(scoped.id, "plain", { x: 2, y: 2 });
  const stored = s.entities.registerScoped({ scopeId: "policy-test", localId: "store-stored", kind: "item" });
  s.entities.store(stored.id);

  const originalPlainPlacement = s.worldContext.getPlacement("pawn:plain");
  const originalScopedPlacement = s.worldContext.getPlacement(scoped.id);
  const attempts = [
    () => s.worldContext.placeEntity("pawn:new", "plain", { x: 3, y: 3 }),
    () => s.worldContext.moveEntity("pawn:plain", { type: "world", worldId: "plain", position: { x: 4, y: 4 } }),
    () => s.worldContext.removePlacement("pawn:plain"),
    () => s.worldContext.storeEntity(scoped.id, "store:policy"),
    () => s.worldContext.placeInStore(stored.id, "store:policy"),
    () => s.worldContext.prepareRestore(s.worldContext.captureSnapshot()),
    () => preparedRestore.commit()
  ];

  for (const [index, mutate] of attempts.entries()) {
    const result = s.movement.moveEntity(
      "pawn:mover",
      { worldId: "grid-a", anchor: { x: 2 + (index % 4), y: 2 + Math.floor(index / 4) } },
      () => { mutate(); return true; }
    );
    assert.equal(result.status, "policy-error", `mutation attempt ${index}`);
    assert.equal(result.code, "POLICY_EVALUATION_FAILED", `mutation attempt ${index}`);
  }

  assert.equal(s.worldContext.getPlacement("pawn:new"), null);
  assert.equal(s.worldContext.getPlacement("pawn:plain"), originalPlainPlacement);
  assert.equal(s.worldContext.getPlacement(scoped.id), originalScopedPlacement);
  assert.equal(s.entities.get(scoped.id).status, "active");
  assert.equal(s.entities.get(stored.id).status, "stored");
  assert.equal(s.worldContext.getPlacement(stored.id), null);
  assert.deepEqual(occupancy(s, "pawn:mover").anchor, { x: 1, y: 1 });
});
