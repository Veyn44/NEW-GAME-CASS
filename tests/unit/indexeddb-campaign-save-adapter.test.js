import test from "node:test";
import assert from "node:assert/strict";

import {
  IndexedDbCampaignSaveAdapter
} from "../../src/adapters/storage/indexeddb-campaign-save-adapter.js";

class FakeTransaction {
  constructor(database, storeName, mode, options, supportsStrict) {
    this.database = database;
    this.storeName = storeName;
    this.mode = mode;
    this.durability = supportsStrict ? (options?.durability ?? "default") : "default";
    this.error = null;
    this.aborted = false;
  }

  objectStore(name) {
    assert.equal(name, this.storeName);
    const records = this.database.stores.get(name);
    return {
      get: (key) => {
        const request = {};
        queueMicrotask(() => {
          request.result = structuredClone(records.get(key));
          request.onsuccess?.();
          if (!this.aborted) this.oncomplete?.();
        });
        return request;
      },
      put: (record) => {
        assert.equal(this.mode, "readwrite");
        queueMicrotask(() => {
          if (!this.aborted) {
            records.set(record.campaignId, structuredClone(record));
            this.oncomplete?.();
          }
        });
      }
    };
  }

  abort() {
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }
}

class FakeDatabase {
  constructor(supportsStrict) {
    this.stores = new Map();
    this.supportsStrict = supportsStrict;
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }
  createObjectStore(name) { this.stores.set(name, new Map()); }
  transaction(storeName, mode, options) {
    if (!this.stores.has(storeName)) throw new Error("Missing object store.");
    return new FakeTransaction(this, storeName, mode, options, this.supportsStrict);
  }
  close() {}
}

class FakeIndexedDB {
  constructor({ supportsStrict = true } = {}) {
    this.supportsStrict = supportsStrict;
    this.databases = new Map();
  }
  open(name, version) {
    const request = {};
    queueMicrotask(() => {
      let database = this.databases.get(name);
      const isNew = !database;
      if (!database) {
        database = new FakeDatabase(this.supportsStrict);
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
  assert.deepEqual(await adapter.loadCampaignSnapshot(), initialSnapshot());

  const next = {
    majorState: { revision: 2, aggregates: { "inventory:crew": { revision: 1, state: { ore: 4 } } } },
    pendingPackages: [{ packageId: "package:one", digest: "a".repeat(64) }],
    appliedLedger: []
  };
  assert.deepEqual(await adapter.writeCampaignSnapshotAtomic(next), {
    durable: true,
    campaignId: "campaign:one"
  });

  const reopened = new IndexedDbCampaignSaveAdapter({
    indexedDBRef,
    campaignId: "campaign:one"
  });
  assert.deepEqual(await reopened.loadCampaignSnapshot(), next);
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
    () => adapter.writeCampaignSnapshotAtomic(initialSnapshot()),
    { code: "STRICT_DURABILITY_UNAVAILABLE" }
  );
  assert.deepEqual(await adapter.loadCampaignSnapshot(), initialSnapshot());
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
