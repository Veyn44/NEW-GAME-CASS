import test from "node:test";
import assert from "node:assert/strict";
import { WorldRegistry } from "../../engine/core/world-registry.js";
import { SpatialComposition, SpatialCompositionError, deriveFootprintCells, normalizeFootprintOffsets, rotateFootprintOffset } from "../../engine/spatial/spatial-composition.js";

function worlds() {
  const registry = new WorldRegistry({ idFactory: () => "unused" });
  registry.registerWorld({ worldId: "grid", type: "test.grid", dimensions: { width: 8, height: 6 }, grid: { width: 8, height: 6 } });
  registry.registerWorld({ worldId: "plain", type: "test.plain", dimensions: { width: 8, height: 6 } });
  registry.registerWorld({ worldId: "closed", type: "test.closed", dimensions: { width: 8, height: 6 }, grid: { width: 8, height: 6 } });
  registry.closeWorld("closed"); return registry;
}
function make() { return new SpatialComposition({ worldRegistry: worlds(), idFactory: () => "generated" }); }
function code(fn, expected) { assert.throws(fn, (e) => e instanceof SpatialCompositionError && e.code === expected); }

test("multiple independent contents coexist at one cell and filters are deterministic", () => {
  const s = make();
  s.addCellContent({ contentId: "floor", worldId: "grid", cell: { x: 2, y: 3 }, categoryId: "terrain", layerId: "base", payload: { material: "stone" } });
  s.addCellContent({ contentId: "carpet", worldId: "grid", cell: { x: 2, y: 3 }, categoryId: "surface", layerId: "overlay" });
  s.addCellContent({ contentId: "ore", worldId: "grid", cell: { x: 2, y: 3 }, categoryId: "terrain", layerId: "detail" });
  assert.deepEqual(s.getCellContents("grid", { x: 2, y: 3 }).map(x => x.contentId), ["floor", "ore", "carpet"]);
  assert.deepEqual(s.listContents({ categoryId: "terrain" }).map(x => x.contentId), ["floor", "ore"]);
  assert.deepEqual(s.listContents({ layerId: "overlay" }).map(x => x.contentId), ["carpet"]);
  assert.equal(Object.isFrozen(s.getContent("floor").payload), true);
});

test("empty cells are implicit and read-only queries do not allocate", () => {
  const s = make(); assert.deepEqual(s.getCellContents("grid", { x: 7, y: 5 }), []);
  assert.equal(s.size, 0); assert.deepEqual(s.captureSnapshot().contents, []);
});

test("payloads are detached and invalid payloads do not mutate indexes", () => {
  const s = make(), payload = { nested: { value: 4 } };
  const record = s.addCellContent({ contentId: "safe", worldId: "grid", cell: { x: 0, y: 0 }, categoryId: "terrain", payload });
  payload.nested.value = 8; assert.equal(record.payload.nested.value, 4);
  const circular = {}; circular.self = circular;
  code(() => s.addCellContent({ contentId: "bad", worldId: "grid", cell: { x: 1, y: 1 }, categoryId: "terrain", payload: circular }), "INVALID_PAYLOAD");
  assert.equal(s.size, 1); assert.deepEqual(s.getCellContents("grid", { x: 1, y: 1 }), []);
});

test("world, coordinate and bounds validation rejects unsupported content", () => {
  const s = make();
  code(() => s.addCellContent({ contentId: "a", worldId: "missing", cell: { x: 0, y: 0 }, categoryId: "terrain" }), "UNKNOWN_WORLD");
  code(() => s.addCellContent({ contentId: "b", worldId: "plain", cell: { x: 0, y: 0 }, categoryId: "terrain" }), "WORLD_HAS_NO_GRID");
  code(() => s.addCellContent({ contentId: "c", worldId: "closed", cell: { x: 0, y: 0 }, categoryId: "terrain" }), "WORLD_CLOSED");
  code(() => s.addCellContent({ contentId: "d", worldId: "grid", cell: { x: 1.5, y: 0 }, categoryId: "terrain" }), "INVALID_CELL");
  code(() => s.addCellContent({ contentId: "e", worldId: "grid", cell: { x: 8, y: 0 }, categoryId: "terrain" }), "CELL_OUT_OF_BOUNDS");
  assert.equal(s.size, 0);
});

test("content IDs remain reserved after removal and final cell index is removed", () => {
  const s = make();
  s.addCellContent({ contentId: "once", worldId: "grid", cell: { x: 4, y: 4 }, categoryId: "terrain" });
  assert.equal(s.removeCellContent("once"), true); assert.equal(s.removeCellContent("once"), false);
  assert.deepEqual(s.getCellContents("grid", { x: 4, y: 4 }), []);
  code(() => s.addCellContent({ contentId: "once", worldId: "grid", cell: { x: 5, y: 4 }, categoryId: "terrain" }), "CONTENT_ID_ALREADY_USED");
});

test("snapshots rebuild sparse indexes and preserve tombstoned IDs", () => {
  const s = make();
  s.addCellContent({ contentId: "active", worldId: "grid", cell: { x: 3, y: 2 }, categoryId: "terrain" });
  s.addCellContent({ contentId: "retired", worldId: "grid", cell: { x: 4, y: 2 }, categoryId: "surface" }); s.removeCellContent("retired");
  const snapshot = s.captureSnapshot(), restored = make(), tx = restored.prepareRestore(snapshot);
  tx.commit(); assert.deepEqual(restored.getCellContents("grid", { x: 3, y: 2 }).map(x => x.contentId), ["active"]);
  assert.deepEqual(restored.captureSnapshot(), snapshot);
  code(() => restored.addCellContent({ contentId: "retired", worldId: "grid", cell: { x: 1, y: 1 }, categoryId: "surface" }), "CONTENT_ID_ALREADY_USED");
});

test("invalid restore preparation leaves current state unchanged", () => {
  const s = make(); s.addCellContent({ contentId: "keep", worldId: "grid", cell: { x: 1, y: 1 }, categoryId: "terrain" });
  code(() => s.prepareRestore({ version: 1, reservedContentIds: ["dup", "dup"], contents: [] }), "DUPLICATE_RESERVED_ID");
  assert.deepEqual(s.getCellContents("grid", { x: 1, y: 1 }).map(x => x.contentId), ["keep"]);
});

test("restore rollback restores canonical records and reverse indexes together", () => {
  const s = make(); s.addCellContent({ contentId: "old", worldId: "grid", cell: { x: 0, y: 0 }, categoryId: "terrain" });
  const before = s.captureSnapshot(), other = make();
  other.addCellContent({ contentId: "new", worldId: "grid", cell: { x: 5, y: 4 }, categoryId: "surface" });
  const tx = s.prepareRestore(other.captureSnapshot()); tx.commit();
  assert.deepEqual(s.getCellContents("grid", { x: 5, y: 4 }).map(x => x.contentId), ["new"]);
  assert.equal(tx.rollback(), true); assert.deepEqual(s.captureSnapshot(), before);
  assert.deepEqual(s.getCellContents("grid", { x: 5, y: 4 }), []);
});

test("footprint offsets are unique, integer, origin-anchored and row-major", () => {
  assert.deepEqual(normalizeFootprintOffsets([{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }]), [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]);
  code(() => normalizeFootprintOffsets([]), "INVALID_FOOTPRINT");
  code(() => normalizeFootprintOffsets([{ x: 1, y: 0 }]), "FOOTPRINT_MISSING_ORIGIN");
  code(() => normalizeFootprintOffsets([{ x: 0, y: 0 }, { x: 0, y: 0 }]), "DUPLICATE_FOOTPRINT_OFFSET");
  code(() => normalizeFootprintOffsets([{ x: 0.5, y: 0 }]), "INVALID_FOOTPRINT_OFFSET");
});

test("quarter-turn orientation transforms are deterministic", () => {
  assert.deepEqual(rotateFootprintOffset({ x: 2, y: 1 }, 0), { x: 2, y: 1 });
  assert.deepEqual(rotateFootprintOffset({ x: 2, y: 1 }, 90), { x: -1, y: 2 });
  assert.deepEqual(rotateFootprintOffset({ x: 2, y: 1 }, 180), { x: -2, y: -1 });
  assert.deepEqual(rotateFootprintOffset({ x: 2, y: 1 }, 270), { x: 1, y: -2 });
  code(() => rotateFootprintOffset({ x: 0, y: 0 }, 45), "INVALID_ORIENTATION");
});

test("footprint derivation validates every rotated cell against bounds", () => {
  assert.deepEqual(deriveFootprintCells({ anchor: { x: 2, y: 1 }, footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], orientation: 90, grid: { width: 5, height: 5 } }),
    [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
  code(() => deriveFootprintCells({ anchor: { x: 4, y: 4 }, footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }], grid: { width: 5, height: 5 } }), "FOOTPRINT_OUT_OF_BOUNDS");
  code(() => deriveFootprintCells({ anchor: { x: Number.MAX_SAFE_INTEGER, y: 0 }, footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }], grid: { width: 5, height: 5 } }), "FOOTPRINT_OUT_OF_RANGE");
});
