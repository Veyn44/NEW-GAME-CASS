import { EntityRegistry } from "../src/core/entity-registry.js";
import { WorldRegistry } from "../src/core/world-registry.js";
import { WorldContext, WorldContextError } from "../src/core/world-context.js";

const tests = [];
function test(name, run) { tests.push({ name, run }); }
function assert(value, message = "Assertion failed") { if (!value) throw new Error(message); }
function equal(actual, expected, message = "Values differ") { if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${expected}, got ${actual}`); }
function throwsCode(run, code) {
  try { run(); } catch (error) { equal(error.code, code, `Expected ${code}`); return; }
  throw new Error(`Expected error ${code}`);
}
function setup() {
  const entities = new EntityRegistry({ idFactory: () => "generated" });
  const worlds = new WorldRegistry({ idFactory: () => "world-generated" });
  const context = new WorldContext({ entityRegistry: entities, worldRegistry: worlds });
  worlds.registerWorld({ worldId: "world:cassandra", type: "cassandra", dimensions: { width: 100, height: 80 } });
  worlds.registerWorld({ worldId: "world:encounter-a", type: "encounter", encounterId: "encounter:a", locationId: "asteroid:a", dimensions: { width: 50, height: 40 } });
  worlds.registerWorld({ worldId: "world:encounter-b", type: "encounter", encounterId: "encounter:b", locationId: "asteroid:a", dimensions: { width: 50, height: 40 } });
  return { entities, worlds, context };
}
function persistent(entities, id = "entity:pawn") { return entities.registerPersistent({ id, kind: "pawn" }); }

test("places a registered persistent entity in a known world", () => {
  const { entities, context } = setup(); persistent(entities);
  const placement = context.placeEntity("entity:pawn", "world:cassandra", { x: 10, y: 20 });
  equal(placement.worldId, "world:cassandra"); equal(placement.position.x, 10);
});
test("rejects placement of an unknown entity", () => {
  const { context } = setup();
  throwsCode(() => context.placeEntity("entity:missing", "world:cassandra", { x: 1, y: 1 }), "UNKNOWN_ENTITY");
});
test("rejects placement in an unknown world", () => {
  const { entities, context } = setup(); persistent(entities);
  throwsCode(() => context.placeEntity("entity:pawn", "world:missing", { x: 1, y: 1 }), "UNKNOWN_WORLD");
});
test("rejects placement in a closed world", () => {
  const { entities, worlds, context } = setup(); persistent(entities);
  const world = worlds.registerWorld({ worldId: "world:closed", type: "encounter", encounterId: "encounter:closed", locationId: "asteroid:closed", dimensions: { width: 10, height: 10 } });
  worlds.closeWorld(world.worldId);
  throwsCode(() => context.placeEntity("entity:pawn", world.worldId, { x: 1, y: 1 }), "WORLD_CLOSED");
});
test("requires finite coordinates", () => {
  const { entities, context } = setup(); persistent(entities);
  throwsCode(() => context.placeEntity("entity:pawn", "world:cassandra", { x: NaN, y: 1 }), "INVALID_POSITION");
});
test("enforces world bounds", () => {
  const { entities, context } = setup(); persistent(entities);
  throwsCode(() => context.placeEntity("entity:pawn", "world:cassandra", { x: 100, y: 1 }), "POSITION_OUT_OF_BOUNDS");
});
test("rejects a second placement for one entity", () => {
  const { entities, context } = setup(); persistent(entities);
  context.placeEntity("entity:pawn", "world:cassandra", { x: 1, y: 1 });
  throwsCode(() => context.placeEntity("entity:pawn", "world:cassandra", { x: 2, y: 2 }), "ENTITY_ALREADY_PLACED");
});
test("moves an entity atomically between map worlds while retaining its ID", () => {
  const { entities, context } = setup(); persistent(entities);
  context.placeEntity("entity:pawn", "world:cassandra", { x: 1, y: 1 });
  const result = context.moveEntity("entity:pawn", { type: "world", worldId: "world:encounter-a", position: { x: 5, y: 6 } });
  equal(result.previous.worldId, "world:cassandra");
  equal(result.current.worldId, "world:encounter-a");
  equal(entities.get("entity:pawn").id, "entity:pawn");
  equal(context.listPlacements().length, 1);
});
test("failed transfer preserves the original placement", () => {
  const { entities, context } = setup(); persistent(entities);
  context.placeEntity("entity:pawn", "world:cassandra", { x: 1, y: 1 });
  throwsCode(() => context.moveEntity("entity:pawn", { type: "world", worldId: "world:missing", position: { x: 2, y: 2 } }), "UNKNOWN_WORLD");
  equal(context.getPlacement("entity:pawn").worldId, "world:cassandra");
});
test("encounter entities may only be placed in their own encounter", () => {
  const { entities, context } = setup();
  entities.registerEncounter({ encounterId: "encounter:a", localId: "enemy-1", kind: "enemy" });
  context.placeEntity("encounter:encounter:a:enemy-1", "world:encounter-a", { x: 2, y: 2 });
  throwsCode(() => context.moveEntity("encounter:encounter:a:enemy-1", { type: "world", worldId: "world:encounter-b", position: { x: 2, y: 2 } }), "ENCOUNTER_SCOPE_MISMATCH");
});
test("stored entity cannot be placed in a world before activation", () => {
  const { entities, context } = setup();
  entities.registerEncounter({ encounterId: "encounter:a", localId: "body", kind: "pawn" });
  entities.store("encounter:encounter:a:body");
  throwsCode(() => context.placeEntity("encounter:encounter:a:body", "world:cassandra", { x: 2, y: 2 }), "ENTITY_STORED");
});
test("transfers an encounter entity from a world into Entity Store without changing its ID", () => {
  const { entities, context } = setup();
  entities.registerEncounter({ encounterId: "encounter:a", localId: "body", kind: "pawn" });
  context.placeEntity("encounter:encounter:a:body", "world:encounter-a", { x: 4, y: 5 });
  const moved = context.storeEntity("encounter:encounter:a:body", "campaign:entity-store");
  equal(moved.previous.worldId, "world:encounter-a");
  equal(moved.current.type, "store");
  equal(entities.get("encounter:encounter:a:body").status, "stored");
  equal(context.listPlacements().length, 1);
});
test("stored entity can be assigned to Entity Store placement", () => {
  const { entities, context } = setup();
  entities.registerEncounter({ encounterId: "encounter:a", localId: "body", kind: "pawn" });
  entities.store("encounter:encounter:a:body");
  context.placeInStore("encounter:encounter:a:body", "campaign:entity-store");
  equal(context.getPlacement("encounter:encounter:a:body").storeId, "campaign:entity-store");
});
test("stored entities cannot transfer to a world until activated", () => {
  const { entities, context } = setup();
  entities.registerEncounter({ encounterId: "encounter:a", localId: "body", kind: "pawn" });
  entities.store("encounter:encounter:a:body");
  context.prepareRestore({ version: 1, placements: [{ entityId: "encounter:encounter:a:body", type: "store", storeId: "campaign:entity-store" }] }).commit();
  throwsCode(() => context.moveEntity("encounter:encounter:a:body", { type: "world", worldId: "world:cassandra", position: { x: 3, y: 3 } }), "ENTITY_STORED");
});
test("removed entities cannot be placed", () => {
  const { entities, context } = setup(); persistent(entities);
  entities.remove("entity:pawn");
  throwsCode(() => context.placeEntity("entity:pawn", "world:cassandra", { x: 1, y: 1 }), "ENTITY_REMOVED");
});
test("removing placement does not remove entity identity", () => {
  const { entities, context } = setup(); persistent(entities);
  context.placeEntity("entity:pawn", "world:cassandra", { x: 1, y: 1 });
  assert(context.removePlacement("entity:pawn"));
  assert(entities.has("entity:pawn"));
});
test("placement records and positions are immutable", () => {
  const { entities, context } = setup(); persistent(entities);
  const position = { x: 4, y: 5 };
  const record = context.placeEntity("entity:pawn", "world:cassandra", position);
  position.x = 90;
  equal(record.position.x, 4);
  assert(Object.isFrozen(record) && Object.isFrozen(record.position));
});
test("snapshot is stable and sorted by entity ID", () => {
  const { entities, context } = setup();
  persistent(entities, "entity:z"); persistent(entities, "entity:a");
  context.placeEntity("entity:z", "world:cassandra", { x: 1, y: 1 });
  context.placeEntity("entity:a", "world:cassandra", { x: 2, y: 2 });
  const snapshot = context.captureSnapshot();
  equal(snapshot.placements[0].entityId, "entity:a");
});
test("restore preparation is side-effect free and rollback restores prior placements", () => {
  const { entities, context } = setup(); persistent(entities);
  context.placeEntity("entity:pawn", "world:cassandra", { x: 1, y: 1 });
  const prepared = context.prepareRestore({ version: 1, placements: [] });
  equal(context.size, 1);
  prepared.commit(); equal(context.size, 0);
  assert(prepared.rollback()); equal(context.getPlacement("entity:pawn").worldId, "world:cassandra");
});
test("restore rejects duplicate entity placements", () => {
  const { entities, context } = setup(); persistent(entities);
  const snapshot = { version: 1, placements: [
    { entityId: "entity:pawn", type: "world", worldId: "world:cassandra", position: { x: 1, y: 1 } },
    { entityId: "entity:pawn", type: "world", worldId: "world:cassandra", position: { x: 2, y: 2 } }
  ] };
  throwsCode(() => context.prepareRestore(snapshot), "DUPLICATE_PLACEMENT");
});
test("restore rejects references to missing entities or worlds", () => {
  const { context } = setup();
  throwsCode(() => context.prepareRestore({ version: 1, placements: [{ entityId: "entity:missing", type: "world", worldId: "world:cassandra", position: { x: 1, y: 1 } }] }), "UNKNOWN_ENTITY");
});
test("persistence participant exposes required versioned contract", () => {
  const { context } = setup();
  const participant = context.createPersistenceParticipant();
  equal(participant.id, "core.world-context"); equal(participant.schemaVersion, 1); equal(participant.required, true);
});
test("snapshot restore validates stored placement lifecycle", () => {
  const { entities, context } = setup();
  entities.registerEncounter({ encounterId: "encounter:a", localId: "body", kind: "pawn" });
  entities.store("encounter:encounter:a:body");
  const tx = context.prepareRestore({ version: 1, placements: [{ entityId: "encounter:encounter:a:body", type: "store", storeId: "campaign:entity-store" }] });
  tx.commit();
  equal(context.getPlacement("encounter:encounter:a:body").type, "store");
});

function runAll() {
  let passed = 0;
  const lines = [];
  for (const item of tests) {
    try { item.run(); passed += 1; lines.push(`PASS ${item.name}`); }
    catch (error) { lines.push(`FAIL ${item.name}: ${error.message}`); }
  }
  lines.push(`RESULT ${passed}/${tests.length} passed`);
  if (typeof document !== "undefined") document.querySelector("#results").textContent = lines.join("\n");
  if (passed !== tests.length) throw new Error(`World Context tests failed: ${passed}/${tests.length}`);
  return { passed, total: tests.length };
}
if (typeof document !== "undefined") {
  document.querySelector("#run")?.addEventListener("click", runAll);
  document.querySelector("#results").textContent = "Ready. Press Run tests.";
} else {
  const result = runAll();
  console.log(`RESULT ${result.passed}/${result.total} passed`);
}
