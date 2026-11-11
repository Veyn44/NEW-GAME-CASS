import { WorldRegistry, WorldRegistryError } from "../src/core/world-registry.js";

const tests = [];
function test(name, run) { tests.push({ name, run }); }
function assert(condition, message = "Assertion failed") { if (!condition) throw new Error(message); }
function equal(actual, expected, message = "Values differ") {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}
function throwsCode(run, code) {
  try { run(); } catch (error) {
    equal(error.code, code, `Unexpected error code (expected ${code})`);
    return error;
  }
  throw new Error(`Expected error code ${code}`);
}
function makeRegistry() {
  let id = 0;
  return new WorldRegistry({ idFactory: () => `test-${++id}` });
}
function addCassandra(registry, worldId = "world:cassandra") {
  return registry.registerWorld({ worldId, type: "cassandra", dimensions: { width: 128, height: 128 } });
}
function addEncounter(registry, encounterId = "encounter:alpha", locationId = "asteroid:alpha") {
  return registry.registerWorld({
    type: "encounter", encounterId, locationId,
    dimensions: { width: 96, height: 80 }, coordinateSystem: "tile-grid"
  });
}

test("registers Cassandra as a stable map world", () => {
  const registry = makeRegistry();
  const world = addCassandra(registry);
  equal(world.worldId, "world:cassandra");
  equal(world.type, "cassandra");
  equal(world.status, "inactive");
  equal(world.dimensions.width, 128);
});

test("generates unique world IDs when none are supplied", () => {
  const registry = makeRegistry();
  const first = registry.registerWorld({ type: "cassandra", dimensions: { width: 20, height: 30 } });
  const second = registry.registerWorld({ type: "cassandra", dimensions: { width: 20, height: 30 } });
  assert(first.worldId !== second.worldId);
  assert(first.worldId.startsWith("world:"));
});

test("encounter world requires stable encounter and location references", () => {
  const registry = makeRegistry();
  throwsCode(() => registry.registerWorld({ type: "encounter", dimensions: { width: 10, height: 10 } }), "INVALID_WORLD_ID");
});

test("encounter world retains its asteroid location and encounter identity", () => {
  const registry = makeRegistry();
  const world = addEncounter(registry, "encounter:visit-2", "asteroid:sector-4");
  equal(world.encounterId, "encounter:visit-2");
  equal(world.locationId, "asteroid:sector-4");
});

test("revisiting one location can register a distinct encounter world", () => {
  const registry = makeRegistry();
  const first = addEncounter(registry, "encounter:visit-1", "asteroid:same");
  const second = addEncounter(registry, "encounter:visit-2", "asteroid:same");
  assert(first.worldId !== second.worldId);
  equal(first.locationId, second.locationId);
});

test("rejects duplicate world IDs", () => {
  const registry = makeRegistry();
  addCassandra(registry);
  throwsCode(() => addCassandra(registry), "DUPLICATE_WORLD_ID");
});

test("closed world IDs remain reserved", () => {
  const registry = makeRegistry();
  const world = addEncounter(registry);
  registry.closeWorld(world.worldId);
  throwsCode(() => registry.registerWorld({
    worldId: world.worldId, type: "encounter", encounterId: "encounter:again",
    locationId: "asteroid:again", dimensions: { width: 10, height: 10 }
  }), "DUPLICATE_WORLD_ID");
});

test("world dimensions must be positive finite values", () => {
  const registry = makeRegistry();
  throwsCode(() => registry.registerWorld({ type: "cassandra", dimensions: { width: 0, height: 10 } }), "INVALID_DIMENSIONS");
  throwsCode(() => registry.registerWorld({ type: "cassandra", dimensions: { width: Infinity, height: 10 } }), "INVALID_DIMENSIONS");
});

test("coordinate system is an explicit non-empty label", () => {
  const registry = makeRegistry();
  throwsCode(() => registry.registerWorld({ type: "cassandra", dimensions: { width: 10, height: 10 }, coordinateSystem: "" }), "INVALID_COORDINATE_SYSTEM");
});

test("galaxy data context is not a playable map world", () => {
  const registry = makeRegistry();
  throwsCode(() => registry.registerWorld({ type: "galaxy", dimensions: { width: 10, height: 10 } }), "INVALID_WORLD_TYPE");
});

test("only supported map-world types can be registered in version one", () => {
  const registry = makeRegistry();
  throwsCode(() => registry.registerWorld({ type: "shuttle", dimensions: { width: 10, height: 10 } }), "UNSUPPORTED_WORLD_TYPE");
});

test("world records and dimensions are immutable", () => {
  const registry = makeRegistry();
  const world = addCassandra(registry);
  assert(Object.isFrozen(world));
  assert(Object.isFrozen(world.dimensions));
  equal(world.dimensions.width, 128);
});

test("activating one world exposes it as the only active world", () => {
  const registry = makeRegistry();
  const cassandra = addCassandra(registry);
  registry.activateWorld(cassandra.worldId);
  equal(registry.activeWorldId, cassandra.worldId);
  equal(registry.getActiveWorld().status, "active");
  equal(registry.list({ status: "active" }).length, 1);
});

test("activating another world atomically deactivates the previous world", () => {
  const registry = makeRegistry();
  const cassandra = addCassandra(registry);
  const encounter = addEncounter(registry);
  registry.activateWorld(cassandra.worldId);
  registry.activateWorld(encounter.worldId);
  equal(registry.get(cassandra.worldId).status, "inactive");
  equal(registry.getActiveWorld().worldId, encounter.worldId);
  equal(registry.list({ status: "active" }).length, 1);
});

test("deactivating the active world leaves no active world", () => {
  const registry = makeRegistry();
  const cassandra = addCassandra(registry);
  registry.activateWorld(cassandra.worldId);
  assert(registry.deactivateWorld(cassandra.worldId));
  equal(registry.activeWorldId, null);
  equal(registry.getActiveWorld(), null);
});

test("deactivating an inactive world is an idempotent no-op", () => {
  const registry = makeRegistry();
  const cassandra = addCassandra(registry);
  equal(registry.deactivateWorld(cassandra.worldId), false);
});

test("an active world cannot be closed", () => {
  const registry = makeRegistry();
  const encounter = addEncounter(registry);
  registry.activateWorld(encounter.worldId);
  throwsCode(() => registry.closeWorld(encounter.worldId), "WORLD_ACTIVE");
});

test("only inactive encounter worlds can be closed", () => {
  const registry = makeRegistry();
  const cassandra = addCassandra(registry);
  const encounter = addEncounter(registry);
  throwsCode(() => registry.closeWorld(cassandra.worldId), "WORLD_NOT_CLOSABLE");
  assert(registry.closeWorld(encounter.worldId));
  equal(registry.get(encounter.worldId).status, "closed");
  equal(registry.closeWorld(encounter.worldId), false);
});

test("closed encounter worlds cannot be activated", () => {
  const registry = makeRegistry();
  const encounter = addEncounter(registry);
  registry.closeWorld(encounter.worldId);
  throwsCode(() => registry.activateWorld(encounter.worldId), "WORLD_CLOSED");
});

test("list filters return deterministic world descriptors", () => {
  const registry = makeRegistry();
  const cassandra = addCassandra(registry);
  const encounter = addEncounter(registry);
  equal(registry.list({ type: "encounter" }).length, 1);
  equal(registry.list({ status: "inactive" }).length, 2);
  equal(registry.list()[0].worldId, [cassandra.worldId, encounter.worldId].sort()[0]);
});

test("snapshot captures all worlds and the active world reference", () => {
  const registry = makeRegistry();
  const cassandra = addCassandra(registry);
  addEncounter(registry);
  registry.activateWorld(cassandra.worldId);
  const snapshot = registry.captureSnapshot();
  equal(snapshot.activeWorldId, cassandra.worldId);
  equal(snapshot.worlds.length, 2);
});

test("restore preparation is side-effect-free and commit replaces the registry", () => {
  const source = makeRegistry();
  const cassandra = addCassandra(source);
  addEncounter(source);
  source.activateWorld(cassandra.worldId);
  const target = makeRegistry();
  const old = addCassandra(target, "world:old");
  const tx = target.prepareRestore(source.captureSnapshot());
  equal(target.has(old.worldId), true);
  tx.commit();
  equal(target.has(old.worldId), false);
  equal(target.activeWorldId, cassandra.worldId);
});

test("restore rollback reinstates the previous worlds and active world", () => {
  const source = makeRegistry();
  const cassandra = addCassandra(source);
  source.activateWorld(cassandra.worldId);
  const target = makeRegistry();
  const old = addCassandra(target, "world:old");
  target.activateWorld(old.worldId);
  const tx = target.prepareRestore(source.captureSnapshot());
  tx.commit();
  assert(tx.rollback());
  equal(target.activeWorldId, old.worldId);
  assert(target.has(old.worldId));
});

test("snapshot rejects accessors without invoking them", () => {
  const registry = makeRegistry();
  let invoked = false;
  const snapshot = { version: 1, activeWorldId: null, worlds: [] };
  Object.defineProperty(snapshot, "worlds", { enumerable: true, get() { invoked = true; return []; } });
  throwsCode(() => registry.prepareRestore(snapshot), "INVALID_SNAPSHOT");
  equal(invoked, false);
});

test("snapshot rejects multiple active worlds and inconsistent activeWorldId", () => {
  const registry = makeRegistry();
  const a = { worldId: "world:a", type: "cassandra", status: "active", dimensions: { width: 10, height: 10 }, coordinateSystem: "world-units", locationId: null, encounterId: null };
  const b = { ...a, worldId: "world:b" };
  throwsCode(() => registry.prepareRestore({ version: 1, activeWorldId: "world:a", worlds: [a, b] }), "MULTIPLE_ACTIVE_WORLDS");
  throwsCode(() => registry.prepareRestore({ version: 1, activeWorldId: "world:missing", worlds: [{ ...a, status: "inactive" }] }), "INVALID_ACTIVE_WORLD");
});

test("Persistence participant follows the coordinator contract", () => {
  const registry = makeRegistry();
  addCassandra(registry);
  const participant = registry.createPersistenceParticipant();
  equal(participant.id, "core.world-registry");
  equal(participant.schemaVersion, 1);
  equal(participant.required, true);
  assert(participant.validateSnapshot(registry.captureSnapshot()));
  const tx = participant.prepareRestore(registry.captureSnapshot());
  assert(typeof tx.commit === "function" && typeof tx.rollback === "function");
});

export async function runWorldRegistryTests() {
  const results = [];
  for (const item of tests) {
    try { await item.run(); results.push({ name: item.name, passed: true }); }
    catch (error) { results.push({ name: item.name, passed: false, error: error?.stack ?? String(error) }); }
  }
  return results;
}

if (typeof document !== "undefined") {
  const output = document.querySelector("#results");
  const button = document.querySelector("#run");
  button?.addEventListener("click", async () => {
    output.textContent = "Running…";
    const results = await runWorldRegistryTests();
    output.textContent = results.map((item) => `${item.passed ? "PASS" : "FAIL"} — ${item.name}${item.error ? `\n${item.error}` : ""}`).join("\n");
    output.dataset.failed = String(results.filter((item) => !item.passed).length);
    output.dataset.total = String(results.length);
  });
}
