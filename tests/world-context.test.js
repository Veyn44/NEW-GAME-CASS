import { EntityRegistry } from "../engine/core/entity-registry.js";
import { WorldRegistry } from "../engine/core/world-registry.js";
import { WorldContext, WorldContextError } from "../engine/core/world-context.js";

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
  worlds.registerWorld({ worldId: "world:scoped-a", type: "scoped", scopeId: "scope:a", locationId: "asteroid:a", dimensions: { width: 50, height: 40 } });
  worlds.registerWorld({ worldId: "world:scoped-b", type: "scoped", scopeId: "scope:b", locationId: "asteroid:a", dimensions: { width: 50, height: 40 } });
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
  const world = worlds.registerWorld({ worldId: "world:closed", type: "scoped", scopeId: "scope:closed", locationId: "asteroid:closed", dimensions: { width: 10, height: 10 } });
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
  const result = context.moveEntity("entity:pawn", { type: "world", worldId: "world:scoped-a", position: { x: 5, y: 6 } });
  equal(result.previous.worldId, "world:cassandra");
  equal(result.current.worldId, "world:scoped-a");
  equal(entities.get("entity:pawn").id, "entity:pawn");
  equal(context.listPlacements().length, 1);
});
test("failed transfer preserves the original placement", () => {
  const { entities, context } = setup(); persistent(entities);
  context.placeEntity("entity:pawn", "world:cassandra", { x: 1, y: 1 });
  throwsCode(() => context.moveEntity("entity:pawn", { type: "world", worldId: "world:missing", position: { x: 2, y: 2 } }), "UNKNOWN_WORLD");
  equal(context.getPlacement("entity:pawn").worldId, "world:cassandra");
});
test("world placement does not impose host-specific scope or world-type rules", () => {
  const { entities, context } = setup();
  entities.registerScoped({ scopeId: "scope:a", localId: "enemy-1", kind: "enemy" });
  context.placeEntity("scope:scope:a:enemy-1", "world:scoped-a", { x: 2, y: 2 });
  const moved = context.moveEntity("scope:scope:a:enemy-1", { type: "world", worldId: "world:scoped-b", position: { x: 2, y: 2 } });
  equal(moved.current.worldId, "world:scoped-b");
});
test("stored entity cannot be placed in a world before activation", () => {
  const { entities, context } = setup();
  entities.registerScoped({ scopeId: "scope:a", localId: "body", kind: "pawn" });
  entities.store("scope:scope:a:body");
  throwsCode(() => context.placeEntity("scope:scope:a:body", "world:cassandra", { x: 2, y: 2 }), "ENTITY_STORED");
});
test("transfers a scoped entity from a world into Entity Store without changing its ID", () => {
  const { entities, context } = setup();
  entities.registerScoped({ scopeId: "scope:a", localId: "body", kind: "pawn" });
  context.placeEntity("scope:scope:a:body", "world:scoped-a", { x: 4, y: 5 });
  const moved = context.storeEntity("scope:scope:a:body", "campaign:entity-store");
  equal(moved.previous.worldId, "world:scoped-a");
  equal(moved.current.type, "store");
  equal(entities.get("scope:scope:a:body").status, "stored");
  equal(context.listPlacements().length, 1);
});
test("stored entity can be assigned to Entity Store placement", () => {
  const { entities, context } = setup();
  entities.registerScoped({ scopeId: "scope:a", localId: "body", kind: "pawn" });
  entities.store("scope:scope:a:body");
  context.placeInStore("scope:scope:a:body", "campaign:entity-store");
  equal(context.getPlacement("scope:scope:a:body").storeId, "campaign:entity-store");
});
test("stored entities cannot transfer to a world until activated", () => {
  const { entities, context } = setup();
  entities.registerScoped({ scopeId: "scope:a", localId: "body", kind: "pawn" });
  entities.store("scope:scope:a:body");
  context.prepareRestore({ version: 1, placements: [{ entityId: "scope:scope:a:body", type: "store", storeId: "campaign:entity-store" }] }).commit();
  throwsCode(() => context.moveEntity("scope:scope:a:body", { type: "world", worldId: "world:cassandra", position: { x: 3, y: 3 } }), "ENTITY_STORED");
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
test("restore snapshots are detached before commit so caller mutation cannot change staged state", () => {
  const { entities, context } = setup(); persistent(entities);
  const snapshot = { version: 1, placements: [{
    entityId: "entity:pawn", type: "world", worldId: "world:cassandra",
    position: { x: 10, y: 12 }
  }] };
  const transaction = context.prepareRestore(snapshot);
  snapshot.placements[0].position.x = 99;
  transaction.commit();
  equal(context.getPlacement("entity:pawn").position.x, 10);
});

test("restore rejects accessors without invoking their getters", () => {
  const { entities, context } = setup(); persistent(entities);
  let getterCalls = 0;
  const placement = {
    type: "world",
    worldId: "world:cassandra",
    position: { x: 1, y: 1 }
  };
  Object.defineProperty(placement, "entityId", {
    enumerable: true,
    get() { getterCalls += 1; return "entity:pawn"; }
  });
  throwsCode(() => context.prepareRestore({ version: 1, placements: [placement] }), "INVALID_SNAPSHOT");
  equal(getterCalls, 0);
});

test("restore rejects snapshots whose proxy traps fail during inspection", () => {
  const { context } = setup();
  const hostile = new Proxy({}, {
    getPrototypeOf() { throw new Error("blocked"); }
  });
  throwsCode(() => context.prepareRestore(hostile), "INVALID_SNAPSHOT");
});

test("persistence participant exposes required versioned contract", () => {
  const { context } = setup();
  const participant = context.createPersistenceParticipant();
  equal(participant.id, "core.world-context"); equal(participant.schemaVersion, 1); equal(participant.required, true);
});
test("snapshot restore validates stored placement lifecycle", () => {
  const { entities, context } = setup();
  entities.registerScoped({ scopeId: "scope:a", localId: "body", kind: "pawn" });
  entities.store("scope:scope:a:body");
  const tx = context.prepareRestore({ version: 1, placements: [{ entityId: "scope:scope:a:body", type: "store", storeId: "campaign:entity-store" }] });
  tx.commit();
  equal(context.getPlacement("scope:scope:a:body").type, "store");
});

export function runWorldContextTests() {
  let passed = 0;
  const lines = [];
  for (const item of tests) {
    try { item.run(); passed += 1; lines.push(`PASS ${item.name}`); }
    catch (error) { lines.push(`FAIL ${item.name}: ${error.message}`); }
  }
  lines.push(`RESULT ${passed}/${tests.length} passed`);
  if (typeof document !== "undefined") document.querySelector("#results").textContent = lines.join("\n");
  return tests.map((item, index) => ({ name: item.name, passed: lines[index].startsWith("PASS "), error: lines[index].startsWith("FAIL ") ? lines[index].slice(lines[index].indexOf(": ") + 2) : null }));
}
if (typeof document !== "undefined") {
  document.querySelector("#run")?.addEventListener("click", () => {
    const results = runWorldContextTests();
    document.querySelector("#results").textContent = results.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.name}${item.error ? `: ${item.error}` : ""}`).join("\\n");
  });
  document.querySelector("#results").textContent = "Ready. Press Run tests.";
}
