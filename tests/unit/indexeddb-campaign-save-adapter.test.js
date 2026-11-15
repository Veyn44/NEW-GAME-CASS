import test from "node:test";
import assert from "node:assert/strict";

import {
  IndexedDbCampaignSaveAdapter
} from "../../src/adapters/storage/indexeddb-campaign-save-adapter.js";

class FakeTransaction {
  constructor(database, storeName, mode, options, supportsStrict, failNextCommit = false) {
    this.database = database;
    this.storeName = storeName;
    this.mode = mode;
    this.failNextCommit = failNextCommit;
    this.pendingWrites = [];
    this.durability = supportsStrict ? (options?.durability ?? "default") : "default";
    this.error = null;
    this.aborted = false;
    this.pending = 0;
    this.completionQueued = false;
    const lease = database.enqueueTransaction();
    this.ready = lease.ready;
    this.release = lease.release;
    this.released = false;
  }

  #release() {
    if (this.released) return;
    this.released = true;
    this.release();
  }

  objectStore(name) {
    assert.equal(name, this.storeName);
    const records = this.database.stores.get(name);
    const schedule = (action) => {
      this.pending += 1;
      this.ready.then(() => queueMicrotask(() => {
        if (!this.aborted) action();
        this.pending -= 1;
        this.#queueComplete();
      }));
    };
    return {
      get: (key) => {
        const request = {};
        schedule(() => {
          request.result = structuredClone(records.get(key));
          request.onsuccess?.();
        });
        return request;
      },
      put: (record) => {
        assert.equal(this.mode, "readwrite");
        schedule(() => {
          this.pendingWrites.push(structuredClone(record));
        });
      }
    };
  }

  #queueComplete() {
    if (this.aborted || this.pending !== 0 || this.completionQueued) return;
    this.completionQueued = true;
    queueMicrotask(() => {
      this.completionQueued = false;
      if (!this.aborted && this.pending === 0) {
        if (this.failNextCommit) {
          this.aborted = true;
          this.error = new Error("simulated IndexedDB transaction abort");
          this.onabort?.();
          this.#release();
          return;
        }
        const records = this.database.stores.get(this.storeName);
        for (const record of this.pendingWrites) records.set(record.campaignId, record);
        this.pendingWrites = [];
        this.oncomplete?.();
        this.#release();
      }
    });
  }

  abort() {
    this.aborted = true;
    queueMicrotask(() => {
      this.onabort?.();
      this.#release();
    });
  }
}

class FakeDatabase {
  constructor(supportsStrict, failNextCommit = false) {
    this.stores = new Map();
    this.supportsStrict = supportsStrict;
    this.failNextCommit = failNextCommit;
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
    this.transactionTail = Promise.resolve();
  }
  enqueueTransaction() {
    const ready = this.transactionTail;
    let release;
    this.transactionTail = new Promise((resolve) => { release = resolve; });
    return { ready, release };
  }
  createObjectStore(name) { this.stores.set(name, new Map()); }
  transaction(storeName, mode, options) {
    if (!this.stores.has(storeName)) throw new Error("Missing object store.");
    const failNextCommit = this.failNextCommit;
    this.failNextCommit = false;
    return new FakeTransaction(this, storeName, mode, options, this.supportsStrict, failNextCommit);
  }
  close() {}
}

class FakeIndexedDB {
  constructor({ supportsStrict = true, failNextCommit = false } = {}) {
    this.supportsStrict = supportsStrict;
    this.failNextCommit = failNextCommit;
    this.databases = new Map();
  }
  open(name, version) {
    const request = {};
    queueMicrotask(() => {
      let database = this.databases.get(name);
      const isNew = !database;
      if (!database) {
        database = new FakeDatabase(this.supportsStrict, this.failNextCommit);
        this.databases.set(name, database);
      }
      request.result = database;
      if (isNew) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
}

function initialSnapshot() {
  return {
    majorState: { revision: 1, aggregates: {} },
    pendingPackages: [],
    appliedLedger: []
  };
}

test("IndexedDB campaign adapter atomically replaces and reopens one complete campaign snapshot", async () => {
  const indexedDBRef = new FakeIndexedDB();
  const adapter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:one",
    initialSnapshot: initialSnapshot()
  });
  assert.equal(adapter.atomicReplace, true);
  assert.equal(adapter.compareAndSwap, true);
  assert.deepEqual(await adapter.loadCampaignSnapshot(), { snapshot: initialSnapshot(), revision: 0 });

  const next = {
    majorState: { revision: 2, aggregates: { "inventory:crew": { revision: 1, state: { ore: 4 } } } },
    pendingPackages: [{ packageId: "package:one", digest: "a".repeat(64) }],
    appliedLedger: []
  };
  assert.deepEqual(await adapter.writeCampaignSnapshotAtomic(next, 0), {
    durable: true,
    campaignId: "campaign:one",
    revision: 1
  });

  const reopened = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:one"
  });
  assert.deepEqual(await reopened.loadCampaignSnapshot(), { snapshot: next, revision: 1 });
  adapter.close();
  reopened.close();
});

test("IndexedDB campaign adapter fails closed when strict durability is unavailable", async () => {
  const indexedDBRef = new FakeIndexedDB({ supportsStrict: false });
  const adapter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:strict",
    initialSnapshot: initialSnapshot()
  });
  await assert.rejects(
    () => adapter.writeCampaignSnapshotAtomic(initialSnapshot(), 0),
    { code: "STRICT_DURABILITY_UNAVAILABLE" }
  );
  assert.deepEqual(await adapter.loadCampaignSnapshot(), { snapshot: initialSnapshot(), revision: 0 });
  adapter.close();
});

test("IndexedDB campaign adapter rejects stale cross-writer revisions", async () => {
  const indexedDBRef = new FakeIndexedDB();
  const initial = initialSnapshot();
  const firstWriter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:cas",
    initialSnapshot: initial
  });
  const secondWriter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:cas",
    initialSnapshot: initial
  });
  assert.equal((await firstWriter.loadCampaignSnapshot()).revision, 0);
  assert.equal((await secondWriter.loadCampaignSnapshot()).revision, 0);
  const next = {
    ...initial,
    majorState: { revision: 2, aggregates: {} }
  };
  await firstWriter.writeCampaignSnapshotAtomic(next, 0);
  await assert.rejects(
    () => secondWriter.writeCampaignSnapshotAtomic(initial, 0),
    { code: "CAMPAIGN_STORAGE_CONFLICT" }
  );
  assert.deepEqual(await secondWriter.loadCampaignSnapshot(), { snapshot: next, revision: 1 });
  firstWriter.close();
  secondWriter.close();
});

test("IndexedDB campaign adapter serializes simultaneous compare-and-swap writers", async () => {
  const indexedDBRef = new FakeIndexedDB();
  const initial = initialSnapshot();
  const firstWriter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:simultaneous-cas",
    initialSnapshot: initial
  });
  const secondWriter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:simultaneous-cas",
    initialSnapshot: initial
  });
  const first = {
    majorState: { revision: 2, aggregates: { first: { revision: 1, state: { value: 1 } } } },
    pendingPackages: [],
    appliedLedger: []
  };
  const second = {
    majorState: { revision: 2, aggregates: { second: { revision: 1, state: { value: 2 } } } },
    pendingPackages: [],
    appliedLedger: []
  };
  const outcomes = await Promise.allSettled([
    firstWriter.writeCampaignSnapshotAtomic(first, 0),
    secondWriter.writeCampaignSnapshotAtomic(second, 0)
  ]);
  assert.equal(outcomes.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((entry) => entry.status === "rejected" && entry.reason.code === "CAMPAIGN_STORAGE_CONFLICT").length, 1);
  const durable = await firstWriter.loadCampaignSnapshot();
  assert.equal(durable.revision, 1);
  assert.ok(
    durable.snapshot.majorState.aggregates.first || durable.snapshot.majorState.aggregates.second,
    "the winning complete snapshot must be durable"
  );
  assert.equal(
    Boolean(durable.snapshot.majorState.aggregates.first)
      && Boolean(durable.snapshot.majorState.aggregates.second),
    false,
    "a stale concurrent writer must not overwrite or combine snapshots"
  );
  firstWriter.close();
  secondWriter.close();
});

test("IndexedDB campaign adapter leaves the previous snapshot intact when a transaction aborts", async () => {
  const indexedDBRef = new FakeIndexedDB();
  const initial = initialSnapshot();
  const adapter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:abort",
    initialSnapshot: initial
  });
  await adapter.writeCampaignSnapshotAtomic(initial, 0);
  indexedDBRef.databases.get("cassandra-campaign-storage").failNextCommit = true;
  const next = {
    majorState: { revision: 2, aggregates: { "inventory:crew": { revision: 1, state: { ore: 9 } } } },
    pendingPackages: [{ packageId: "package:abort" }],
    appliedLedger: []
  };
  await assert.rejects(
    () => adapter.writeCampaignSnapshotAtomic(next, 1),
    { code: "INDEXEDDB_WRITE_FAILED" }
  );
  assert.deepEqual(await adapter.loadCampaignSnapshot(), {
    snapshot: initial,
    revision: 1
  });
  adapter.close();
});

test("IndexedDB campaign adapter refuses to overwrite a corrupt existing snapshot", async () => {
  const indexedDBRef = new FakeIndexedDB();
  const adapter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:corrupt-record",
    initialSnapshot: initialSnapshot()
  });
  await adapter.writeCampaignSnapshotAtomic(initialSnapshot(), 0);
  const store = indexedDBRef.databases.get("cassandra-campaign-storage").stores.get("campaign-snapshots");
  const corrupt = store.get("campaign:corrupt-record");
  corrupt.snapshot = null;
  store.set("campaign:corrupt-record", corrupt);

  await assert.rejects(
    () => adapter.writeCampaignSnapshotAtomic(initialSnapshot(), 1),
    { code: "INVALID_CAMPAIGN_RECORD" }
  );
  assert.equal(store.get("campaign:corrupt-record").snapshot, null);
  await assert.rejects(
    () => adapter.loadCampaignSnapshot(),
    { code: "INVALID_CAMPAIGN_RECORD" }
  );
  adapter.close();
});

test("IndexedDB campaign adapter closes a connection that succeeds after a blocked-open rejection", async () => {
  const backingIndexedDB = new FakeIndexedDB();
  const lateDatabase = new FakeDatabase(true);
  lateDatabase.createObjectStore("campaign-snapshots");
  let lateDatabaseClosed = false;
  lateDatabase.close = () => { lateDatabaseClosed = true; };
  let openCount = 0;
  const indexedDBRef = {
    open(name, version) {
      openCount += 1;
      if (openCount > 1) return backingIndexedDB.open(name, version);
      const request = {};
      queueMicrotask(() => {
        request.onblocked?.();
        queueMicrotask(() => {
          request.result = lateDatabase;
          request.onsuccess?.();
        });
      });
      return request;
    }
  };
  const adapter = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:blocked-open",
    initialSnapshot: initialSnapshot()
  });

  await assert.rejects(
    () => adapter.loadCampaignSnapshot(),
    { code: "INDEXEDDB_OPEN_BLOCKED" }
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(lateDatabaseClosed, true);
  assert.deepEqual(await adapter.loadCampaignSnapshot(), {
    snapshot: initialSnapshot(),
    revision: 0
  });
  adapter.close();
});

test("IndexedDB campaign adapter requires IndexedDB and a stable campaign identity", () => {
  assert.throws(
    () => new IndexedDbCampaignSaveAdapter({ indexedDBRef: null, campaignId: "campaign:one" }),
    { code: "INDEXEDDB_UNAVAILABLE" }
  );
  assert.throws(
    () => new IndexedDbCampaignSaveAdapter({ indexedDBRef: new FakeIndexedDB(), campaignId: "" }),
    { code: "INVALID_CAMPAIGN_STORAGE_ID" }
  );
});
