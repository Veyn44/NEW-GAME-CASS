import { Logger, LoggerError } from "../src/core/logger.js";
import { Persistence, PersistenceError, MemorySaveAdapter } from "../src/core/persistence.js";

function assert(condition, message) { if (!condition) throw new Error(message); }
function equal(actual, expected, message) { if (!Object.is(actual, expected)) throw new Error(`${message} (expected ${expected}, received ${actual})`); }
function expectCodeSync(fn, code, Type) {
  try { fn(); } catch (error) {
    assert(error instanceof Type, `Expected ${Type.name}, got ${error?.constructor?.name}`);
    equal(error.code, code, "Unexpected error code");
    return error;
  }
  throw new Error(`Expected ${code}`);
}
async function expectCode(fn, code, Type = PersistenceError) {
  try { await fn(); } catch (error) {
    assert(error instanceof Type, `Expected ${Type.name}, got ${error?.constructor?.name}`);
    equal(error.code, code, "Unexpected error code");
    return error;
  }
  throw new Error(`Expected ${code}`);
}

export async function runPersistenceLoggerTests() {
  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error?.stack ?? error?.message ?? String(error) }); }
  };

  await test("Logger records structured entries with injected diagnostic timestamp", () => {
    const logger = new Logger({ clock: () => "2030-01-02T03:04:05.000Z" });
    const record = logger.warn("Potential issue", { source: "core.test", category: "testing", entityId: "pawn-1" });
    equal(record.timestamp, "2030-01-02T03:04:05.000Z", "Timestamp");
    equal(record.level, "WARN", "Level");
    equal(record.source, "core.test", "Source");
    equal(record.details.entityId, "pawn-1", "Metadata");
    assert(Object.isFrozen(record) && Object.isFrozen(record.details), "Log record must be immutable.");
  });

  await test("Logger filters by minimum level and supports category/source filters", () => {
    const logger = new Logger({ minimumLevel: "WARN" });
    equal(logger.debug("hidden"), null, "DEBUG must be filtered");
    logger.info("hidden too");
    logger.warn("visible", { source: "pawn.life", category: "needs" });
    logger.error("also visible", { source: "core.test", category: "testing" });
    equal(logger.getRecords().length, 2, "Filtered record count");
    equal(logger.getRecords({ category: "needs" }).length, 1, "Category filter");
    equal(logger.getRecords({ source: "core.test" }).length, 1, "Source filter");
    equal(logger.getRecords({ limit: 0 }).length, 0, "Zero limit");
  });

  await test("Logger bounds retained history and counts dropped entries", () => {
    const logger = new Logger({ capacity: 2 });
    logger.info("one"); logger.info("two"); logger.info("three");
    equal(logger.size, 2, "Capacity");
    equal(logger.droppedCount, 1, "Dropped count");
    equal(logger.getRecords()[0].message, "two", "Oldest retained record");
  });

  await test("Logger isolates sink and clock failures", () => {
    const logger = new Logger({ clock: () => { throw new Error("clock"); }, sink: () => { throw new Error("sink"); } });
    const record = logger.error("still recorded");
    equal(record.timestamp, null, "Failed diagnostic clock fallback");
    equal(logger.size, 1, "Sink failure must not prevent recording");
  });

  await test("Logger rejects invalid levels, IDs and non-serializable details", () => {
    expectCodeSync(() => new Logger({ minimumLevel: "TRACE" }), "INVALID_LEVEL", LoggerError);
    const logger = new Logger();
    expectCodeSync(() => logger.info("bad", { source: "Not Valid" }), "INVALID_SOURCE", LoggerError);
    const circular = {}; circular.self = circular;
    expectCodeSync(() => logger.info("bad", { circular }), "INVALID_LOG_DATA", LoggerError);
  });

  await test("Persistence requires an explicit safe-boundary coordinator", () => {
    expectCodeSync(() => new Persistence({ adapter: new MemorySaveAdapter() }), "INVALID_BOUNDARY", PersistenceError);
  });

  await test("Persistence saves required participant snapshots through the safe boundary", async () => {
    const adapter = new MemorySaveAdapter();
    let boundaryCalls = 0;
    const persistence = new Persistence({
      adapter, gameVersion: "1.2.3",
      runAtSafeBoundary: async (operation) => { boundaryCalls += 1; return operation(); }
    });
    persistence.registerParticipant({ id: "core.clock", schemaVersion: 1, captureSnapshot: () => ({ seconds: 42 }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    const metadata = await persistence.save("slot-1", { campaignId: "campaign-a", galaxySeed: 1234 });
    equal(boundaryCalls, 1, "Boundary must wrap save");
    equal(metadata.campaignId, "campaign-a", "Campaign metadata");
    const saved = await adapter.read("slot-1");
    equal(saved.snapshots["core.clock"].seconds, 42, "Stored snapshot");
    equal(saved.metadata.gameVersion, "1.2.3", "Game version");
  });

  await test("Persistence rejects missing required snapshots without writing", async () => {
    let writes = 0;
    const adapter = { async read() { return null; }, async writeAtomic() { writes += 1; } };
    const persistence = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    persistence.registerParticipant({ id: "core.required", schemaVersion: 1, captureSnapshot: () => undefined, prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await expectCode(() => persistence.save("slot", { campaignId: "c" }), "MISSING_SNAPSHOT");
    equal(writes, 0, "No partial save write");
  });

  await test("Persistence leaves prior save intact when atomic adapter write fails", async () => {
    const memory = new MemorySaveAdapter();
    const persistence = new Persistence({ adapter: memory, runAtSafeBoundary: (operation) => operation() });
    let value = 1;
    persistence.registerParticipant({ id: "core.state", schemaVersion: 1, captureSnapshot: () => ({ value }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await persistence.save("slot", { campaignId: "c" });
    value = 2;
    const failingAdapter = {
      read: (id) => memory.read(id),
      async writeAtomic() { throw new Error("disk full"); }
    };
    const failing = new Persistence({ adapter: failingAdapter, runAtSafeBoundary: (operation) => operation() });
    failing.registerParticipant({ id: "core.state", schemaVersion: 1, captureSnapshot: () => ({ value }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await expectCode(() => failing.save("slot", { campaignId: "c" }), "SAVE_FAILED");
    equal((await memory.read("slot")).snapshots["core.state"].value, 1, "Previous save remains intact");
  });

  await test("Persistence validates all restore plans before committing any", async () => {
    const adapter = new MemorySaveAdapter();
    const writer = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    writer.registerParticipant({ id: "core.a", schemaVersion: 1, captureSnapshot: () => ({ n: 1 }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    writer.registerParticipant({ id: "core.b", schemaVersion: 1, captureSnapshot: () => ({ n: 2 }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await writer.save("slot", { campaignId: "c" });
    let committed = 0;
    const reader = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    reader.registerParticipant({ id: "core.a", schemaVersion: 1, captureSnapshot: () => ({}), prepareRestore: () => ({ commit() { committed++; }, rollback() {} }) });
    reader.registerParticipant({ id: "core.b", schemaVersion: 1, captureSnapshot: () => ({}), prepareRestore: () => { throw new PersistenceError("PREPARE_FAILED", "invalid staged state"); } });
    await expectCode(() => reader.load("slot"), "PREPARE_FAILED");
    equal(committed, 0, "No participant committed before all preparation succeeded");
  });

  await test("Persistence rolls back participants in reverse order after commit failure", async () => {
    const adapter = new MemorySaveAdapter();
    const writer = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    for (const id of ["core.a", "core.b"]) writer.registerParticipant({ id, schemaVersion: 1, captureSnapshot: () => ({ ok: true }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await writer.save("slot", { campaignId: "c" });
    const calls = [];
    const reader = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    reader.registerParticipant({ id: "core.a", schemaVersion: 1, captureSnapshot: () => ({}), prepareRestore: () => ({ commit() { calls.push("commit-a"); }, rollback() { calls.push("rollback-a"); } }) });
    reader.registerParticipant({ id: "core.b", schemaVersion: 1, captureSnapshot: () => ({}), prepareRestore: () => ({ commit() { calls.push("commit-b"); throw new Error("commit failed"); }, rollback() { calls.push("rollback-b"); } }) });
    await expectCode(() => reader.load("slot"), "RESTORE_COMMIT_FAILED");
    equal(calls.join(","), "commit-a,commit-b,rollback-b,rollback-a", "Rollback order");
  });

  await test("Persistence rejects incompatible campaign format and campaign identity", async () => {
    const adapter = new MemorySaveAdapter();
    const writer = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    writer.registerParticipant({ id: "core.state", schemaVersion: 1, captureSnapshot: () => ({}), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await writer.save("slot", { campaignId: "campaign-a" });
    const reader = new Persistence({ adapter, campaignFormatVersion: 2, runAtSafeBoundary: (operation) => operation() });
    reader.registerParticipant({ id: "core.state", schemaVersion: 1, captureSnapshot: () => ({}), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await expectCode(() => reader.load("slot"), "INCOMPATIBLE_SAVE_FORMAT");
    await expectCode(() => writer.load("slot", { campaignId: "campaign-b" }), "CAMPAIGN_MISMATCH");
  });

  await test("Persistence migrates participant schema before restore preparation", async () => {
    const adapter = new MemorySaveAdapter();
    const writer = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    writer.registerParticipant({ id: "core.data", schemaVersion: 1, captureSnapshot: () => ({ old: 5 }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await writer.save("slot", { campaignId: "c" });
    let received;
    const reader = new Persistence({ adapter, runAtSafeBoundary: (operation) => operation() });
    reader.registerParticipant({
      id: "core.data", schemaVersion: 2, captureSnapshot: () => ({}),
      migrateSnapshot: (snapshot, from) => ({ value: snapshot.old + from }),
      prepareRestore: (snapshot) => { received = snapshot.value; return { commit() {}, rollback() {} }; }
    });
    await reader.load("slot");
    equal(received, 6, "Migrated snapshot");
  });

  await test("Persistence refuses unsafe slot IDs and invalid snapshot data", async () => {
    const persistence = new Persistence({ adapter: new MemorySaveAdapter(), runAtSafeBoundary: (operation) => operation() });
    await expectCode(() => persistence.save("../slot", { campaignId: "c" }), "INVALID_SLOT_ID");
    const circular = {}; circular.self = circular;
    persistence.registerParticipant({ id: "core.bad", schemaVersion: 1, captureSnapshot: () => circular, prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await expectCode(() => persistence.save("slot", { campaignId: "c" }), "INVALID_SNAPSHOT_DATA");
  });

  await test("Persistence invokes Logger without allowing diagnostic failure to escape", async () => {
    const logger = { error() { throw new Error("logger broken"); }, info() { throw new Error("logger broken"); } };
    const persistence = new Persistence({ adapter: new MemorySaveAdapter(), runAtSafeBoundary: (operation) => operation(), logger });
    persistence.registerParticipant({ id: "core.state", schemaVersion: 1, captureSnapshot: () => ({ ok: true }), prepareRestore: () => ({ commit() {}, rollback() {} }) });
    await persistence.save("slot", { campaignId: "c" });
    assert(true, "Persistence should complete despite logger failure.");
  });

  return results;
}
