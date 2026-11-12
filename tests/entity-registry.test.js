import { EntityRegistry, EntityRegistryError } from "../src/core/entity-registry.js";

const tests = [];
function test(name, run) { tests.push({ name, run }); }
function assert(condition, message = "Assertion failed") { if (!condition) throw new Error(message); }
function equal(actual, expected, message = "Values differ") { if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`); }
function throwsCode(run, code) {
  try { run(); } catch (error) { equal(error.code, code); return error; }
  throw new Error(`Expected error code ${code}`);
}

function makeRegistry() {
  let id = 0;
  return new EntityRegistry({ idFactory: () => `test-${++id}` });
}

test("persistent entities receive unique stable IDs", () => {
  const registry = makeRegistry();
  const first = registry.registerPersistent({ kind: "pawn" });
  const second = registry.registerPersistent({ kind: "item" });
  assert(first.id !== second.id);
  assert(first.id.startsWith("entity:"));
  equal(registry.get(first.id).kind, "pawn");
});

test("caller-supplied persistent IDs are retained", () => {
  const registry = makeRegistry();
  const item = registry.registerPersistent({ id: "item:alpha-1", kind: "item" });
  equal(item.id, "item:alpha-1");
});

test("duplicate IDs and tombstoned IDs cannot be reused", () => {
  const registry = makeRegistry();
  const item = registry.registerPersistent({ id: "pawn:one", kind: "pawn" });
  registry.remove(item.id);
  throwsCode(() => registry.registerPersistent({ id: item.id, kind: "pawn" }), "DUPLICATE_ENTITY_ID");
  equal(registry.get(item.id).status, "removed");
});

test("scoped IDs are namespaced and locally sequenced", () => {
  const registry = makeRegistry();
  const a = registry.registerScoped({ scopeId: "enc-1", kind: "enemy" });
  const b = registry.registerScoped({ scopeId: "enc-1", kind: "enemy" });
  const c = registry.registerScoped({ scopeId: "enc-2", kind: "enemy" });
  equal(a.id, "scope:enc-1:1");
  equal(b.id, "scope:enc-1:2");
  equal(c.id, "scope:enc-2:1");
});

test("explicit numeric scoped IDs advance the automatic sequence", () => {
  const registry = new EntityRegistry();
  registry.registerScoped({ scopeId: "sequence", localId: "4", kind: "enemy" });
  equal(registry.registerScoped({ scopeId: "sequence", kind: "enemy" }).id, "scope:sequence:5");
});

test("automatic scoped IDs skip identities already reserved by another registration path", () => {
  const registry = new EntityRegistry();
  registry.registerPersistent({ id: "scope:collision:1", kind: "external" });
  equal(registry.registerScoped({ scopeId: "collision", kind: "enemy" }).id, "scope:collision:2");
});

test("failed scoped registration does not consume an automatic ID", () => {
  const registry = new EntityRegistry();
  throwsCode(() => registry.registerScoped({ scopeId: "sequence", kind: "InvalidKind" }), "INVALID_ENTITY_KIND");
  equal(registry.registerScoped({ scopeId: "sequence", kind: "enemy" }).id, "scope:sequence:1");
});

test("scoped-local IDs are stable when explicitly supplied", () => {
  const registry = makeRegistry();
  const entity = registry.registerScoped({ scopeId: "run-7", localId: "boss", kind: "enemy" });
  equal(entity.id, "scope:run-7:boss");
});

test("entity records and metadata are immutable defensive copies", () => {
  const registry = makeRegistry();
  const metadata = { tags: ["hostile"] };
  const entity = registry.registerPersistent({ id: "enemy:1", kind: "enemy", metadata });
  metadata.tags.push("changed");
  equal(entity.metadata.tags.length, 1);
  assert(Object.isFrozen(entity) && Object.isFrozen(entity.metadata.tags));
});

test("unsafe metadata is rejected without invoking getters", () => {
  const registry = makeRegistry();
  let called = false;
  const metadata = {};
  Object.defineProperty(metadata, "secret", { enumerable: true, get() { called = true; return 1; } });
  throwsCode(() => registry.registerPersistent({ id: "entity:bad", kind: "pawn", metadata }), "INVALID_METADATA");
  equal(called, false);
});

test("invalid kinds and identifiers are rejected", () => {
  const registry = makeRegistry();
  throwsCode(() => registry.registerPersistent({ id: "../bad", kind: "pawn" }), "INVALID_ENTITY_ID");
  throwsCode(() => registry.registerPersistent({ id: "pawn:1", kind: "Pawn" }), "INVALID_ENTITY_KIND");
  const valid = registry.registerScoped({ scopeId: "e", localId: "x", kind: "enemy" });
  equal(valid.id, "scope:e:x");
});

test("Entity Store only accepts active scoped entities", () => {
  const registry = makeRegistry();
  const persistent = registry.registerPersistent({ id: "pawn:1", kind: "pawn" });
  throwsCode(() => registry.store(persistent.id), "ENTITY_NOT_STORABLE");
  const enemy = registry.registerScoped({ scopeId: "e-1", kind: "specimen" });
  const stored = registry.store(enemy.id);
  equal(stored.status, "stored");
  equal(stored.scope, "persistent");
  equal(stored.scopeId, null);
  equal(stored.originScopeId, "e-1");
});

test("stored entities can be activated without changing identity", () => {
  const registry = makeRegistry();
  const original = registry.registerScoped({ scopeId: "e-2", kind: "specimen" });
  registry.store(original.id);
  const active = registry.activateStored(original.id);
  equal(active.id, original.id);
  equal(active.status, "active");
  throwsCode(() => registry.activateStored(original.id), "ENTITY_NOT_STORED");
});

test("remove is idempotent and preserves an identity tombstone", () => {
  const registry = makeRegistry();
  const entity = registry.registerPersistent({ id: "pawn:gone", kind: "pawn" });
  equal(registry.remove(entity.id), true);
  equal(registry.remove(entity.id), false);
  equal(registry.list({ status: "removed" }).length, 1);
});

test("list filters are deterministic", () => {
  const registry = makeRegistry();
  registry.registerPersistent({ id: "pawn:b", kind: "pawn" });
  registry.registerPersistent({ id: "pawn:a", kind: "pawn" });
  registry.registerScoped({ scopeId: "e", kind: "enemy" });
  const result = registry.list({ kind: "pawn" });
  equal(result.length, 2);
  equal(result[0].id, "pawn:a");
});

test("snapshot captures identity metadata and all lifecycle tombstones", () => {
  const registry = makeRegistry();
  const pawn = registry.registerPersistent({ id: "pawn:1", kind: "pawn" });
  const enemy = registry.registerScoped({ scopeId: "e-1", kind: "enemy" });
  registry.store(enemy.id);
  registry.remove(pawn.id);
  const snapshot = registry.captureSnapshot();
  equal(snapshot.version, 2);
  equal(snapshot.entities.length, 2);
  assert(snapshot.entities.some((entry) => entry.id === pawn.id && entry.status === "removed"));
  assert(snapshot.entities.some((entry) => entry.id === enemy.id && entry.status === "stored"));
});

test("restore preparation is side-effect-free and commit replaces registry", () => {
  const registry = makeRegistry();
  registry.registerPersistent({ id: "old:1", kind: "item" });
  const source = makeRegistry();
  source.registerPersistent({ id: "new:1", kind: "pawn" });
  const transaction = registry.prepareRestore(source.captureSnapshot());
  assert(registry.has("old:1") && !registry.has("new:1"));
  transaction.commit();
  assert(!registry.has("old:1") && registry.has("new:1"));
});

test("restore rollback reinstates previous registry state", () => {
  const registry = makeRegistry();
  registry.registerPersistent({ id: "old:1", kind: "item" });
  const source = makeRegistry();
  source.registerPersistent({ id: "new:1", kind: "pawn" });
  const transaction = registry.prepareRestore(source.captureSnapshot());
  transaction.commit();
  transaction.rollback();
  assert(registry.has("old:1") && !registry.has("new:1"));
});

test("snapshot accessors are rejected without being invoked", () => {
  const registry = makeRegistry();
  let called = false;
  const snapshot = { entities: [] };
  Object.defineProperty(snapshot, "version", { enumerable: true, get() { called = true; return 1; } });
  throwsCode(() => registry.prepareRestore(snapshot), "INVALID_METADATA");
  equal(called, false);
});

test("invalid snapshots and duplicate snapshot IDs are rejected", () => {
  const registry = makeRegistry();
  throwsCode(() => registry.prepareRestore({ version: 99, entities: [] }), "INVALID_SNAPSHOT");
  throwsCode(() => registry.prepareRestore({ version: 2, entities: [
    { id: "same:1", kind: "pawn", scope: "persistent", scopeId: null, status: "active", metadata: {} },
    { id: "same:1", kind: "pawn", scope: "persistent", scopeId: null, status: "active", metadata: {} }
  ] }), "DUPLICATE_ENTITY_ID");
});

test("Persistence participant conforms to the coordinator contract", async () => {
  const registry = makeRegistry();
  const participant = registry.createPersistenceParticipant();
  equal(participant.id, "core.entity-registry");
  equal(participant.schemaVersion, 2);
  assert(await participant.validateSnapshot(registry.captureSnapshot()));
  const tx = participant.prepareRestore(registry.captureSnapshot());
  assert(typeof tx.commit === "function" && typeof tx.rollback === "function");
});

test("version-one encounter snapshots migrate to generic scopes without changing identity", () => {
  const registry = new EntityRegistry({ idFactory: () => "generated" });
  const participant = registry.createPersistenceParticipant();
  const migrated = participant.migrateSnapshot({
    version: 1,
    entities: [{
      id: "encounter:legacy:1", kind: "enemy", scope: "encounter",
      encounterId: "legacy", originEncounterId: "legacy",
      status: "active", metadata: { hp: 10 }
    }]
  }, 1);
  equal(migrated.version, 2);
  const transaction = registry.prepareRestore(migrated);
  transaction.commit();
  equal(registry.get("encounter:legacy:1").scope, "scoped");
  equal(registry.get("encounter:legacy:1").scopeId, "legacy");
  equal(registry.registerScoped({ scopeId: "legacy", kind: "enemy" }).id, "scope:legacy:2");
});

test("rollback preserves scoped ID sequence after stored entities", () => {
  const registry = makeRegistry();
  const stored = registry.registerScoped({ scopeId: "rollback", localId: "10", kind: "enemy" });
  registry.store(stored.id);
  const source = makeRegistry();
  source.registerPersistent({ id: "other:1", kind: "item" });
  const tx = registry.prepareRestore(source.captureSnapshot());
  tx.commit();
  tx.rollback();
  equal(registry.get(stored.id).status, "stored");
  equal(registry.registerScoped({ scopeId: "rollback", kind: "enemy" }).id, "scope:rollback:11");
});

test("scoped sequence resumes from restored records", () => {
  const registry = makeRegistry();
  registry.registerScoped({ scopeId: "resume", kind: "enemy" });
  const snapshot = registry.captureSnapshot();
  const restored = makeRegistry();
  restored.prepareRestore(snapshot).commit();
  const next = restored.registerScoped({ scopeId: "resume", kind: "enemy" });
  equal(next.id, "scope:resume:2");
});

export async function runEntityRegistryTests() {
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
    const results = await runEntityRegistryTests();
    output.textContent = results.map((item) => `${item.passed ? "PASS" : "FAIL"} — ${item.name}${item.error ? `\\n${item.error}` : ""}`).join("\\n");
    output.dataset.failed = String(results.filter((item) => !item.passed).length);
  });
}
