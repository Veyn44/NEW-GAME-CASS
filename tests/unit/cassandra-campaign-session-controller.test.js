import test from "node:test";
import assert from "node:assert/strict";

import {
  createCassandraCampaignSessionController
} from "../../cassandra/application/cassandra-campaign-session-controller.js";

function createMemoryAdapterFactory() {
  const records = new Map();
  const closed = [];
  const created = [];

  function createAdapter({ campaignId, initialSnapshot = null }) {
    created.push(campaignId);
    return {
      atomicReplace: true,
      compareAndSwap: true,
      async loadCampaignSnapshot() {
        const record = records.get(campaignId);
        if (record) return structuredClone(record);
        if (initialSnapshot !== null) {
          return { snapshot: structuredClone(initialSnapshot), revision: 0 };
        }
        const error = new Error("Campaign not found.");
        error.code = "CAMPAIGN_SAVE_NOT_FOUND";
        throw error;
      },
      async writeCampaignSnapshotAtomic(snapshot, expectedRevision) {
        const current = records.get(campaignId);
        const revision = current?.revision ?? 0;
        if (revision !== expectedRevision) {
          const error = new Error("Campaign storage conflict.");
          error.code = "CAMPAIGN_STORAGE_CONFLICT";
          throw error;
        }
        const next = { snapshot: structuredClone(snapshot), revision: revision + 1 };
        records.set(campaignId, next);
        return { durable: true, campaignId, revision: next.revision };
      },
      close() { closed.push(campaignId); }
    };
  }

  return { createAdapter, records, closed, created };
}

function initialSnapshot() {
  return {
    majorState: { revision: 0, aggregates: {} },
    pendingPackages: [],
    appliedLedger: []
  };
}

test("campaign session starts closed and never invents a campaign identity", async () => {
  const storage = createMemoryAdapterFactory();
  const sessions = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });

  assert.deepEqual(sessions.getState(), {
    status: "closed",
    campaignId: null,
    storageRevision: null
  });
  assert.equal(await sessions.isPackageApplied("package:any", "a".repeat(64)), false);
  await assert.rejects(() => sessions.open(), { code: "INVALID_CAMPAIGN_ID" });
  assert.deepEqual(storage.created, []);
});

test("campaign creation requires an explicit ID and durable initial snapshot", async () => {
  const storage = createMemoryAdapterFactory();
  const sessions = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  const initial = initialSnapshot();

  assert.deepEqual(await sessions.create("campaign:alpha", initial), {
    status: "open",
    campaignId: "campaign:alpha",
    storageRevision: 1
  });
  initial.majorState.revision = 99;
  const loaded = await sessions.loadSnapshot();
  assert.equal(loaded.campaignId, "campaign:alpha");
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.snapshot.majorState.revision, 0);
});

test("opening a campaign restores its durable snapshot without using the .cass workspace adapter", async () => {
  const storage = createMemoryAdapterFactory();
  const first = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  await first.create("campaign:reopen", initialSnapshot());
  first.close();

  const second = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  assert.deepEqual(await second.open("campaign:reopen"), {
    status: "open",
    campaignId: "campaign:reopen",
    storageRevision: 1
  });
  assert.deepEqual((await second.loadSnapshot()).snapshot, initialSnapshot());
  second.close();
});

test("campaign selection cannot silently replace an already open campaign", async () => {
  const storage = createMemoryAdapterFactory();
  const sessions = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  await sessions.create("campaign:first", initialSnapshot());

  await assert.rejects(
    () => sessions.open("campaign:second"),
    { code: "CAMPAIGN_ALREADY_OPEN" }
  );
  assert.deepEqual(storage.created, ["campaign:first"]);
  assert.equal(sessions.getState().campaignId, "campaign:first");
});

test("campaign create refuses an existing durable campaign and closes the candidate adapter", async () => {
  const storage = createMemoryAdapterFactory();
  const first = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  await first.create("campaign:existing", initialSnapshot());
  first.close();

  const second = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  await assert.rejects(
    () => second.create("campaign:existing", initialSnapshot()),
    { code: "CAMPAIGN_ALREADY_EXISTS" }
  );
  assert.deepEqual(second.getState(), {
    status: "closed",
    campaignId: null,
    storageRevision: null
  });
  assert.deepEqual(storage.closed, ["campaign:existing", "campaign:existing"]);
});

test("Applied ledger verifier requires exact package ID, digest and applied status", async () => {
  const storage = createMemoryAdapterFactory();
  const sessions = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  const digest = "b".repeat(64);
  const initial = initialSnapshot();
  initial.appliedLedger.push({
    packageId: "package:committed",
    digest,
    status: "applied"
  });
  await sessions.create("campaign:ledger", initial);

  assert.equal(await sessions.isPackageApplied("package:committed", digest), true);
  assert.equal(await sessions.isPackageApplied("package:committed", "c".repeat(64)), false);
  assert.equal(await sessions.isPackageApplied("package:pending", digest), false);
  await assert.rejects(
    () => sessions.isPackageApplied("package:committed", "not-a-digest"),
    { code: "INVALID_APPLIED_LEDGER_QUERY" }
  );
});

test("closing a campaign clears identity before later ledger checks", async () => {
  const storage = createMemoryAdapterFactory();
  const sessions = createCassandraCampaignSessionController({ createAdapter: storage.createAdapter });
  await sessions.create("campaign:close", initialSnapshot());

  assert.deepEqual(sessions.close(), {
    status: "closed",
    campaignId: null,
    storageRevision: null
  });
  assert.equal(await sessions.isPackageApplied("package:any", "d".repeat(64)), false);
  await assert.rejects(() => sessions.loadSnapshot(), { code: "NO_ACTIVE_CAMPAIGN" });
  assert.deepEqual(storage.closed, ["campaign:close"]);
});

test("campaign snapshot reads fail when no campaign is active", async () => {
  const sessions = createCassandraCampaignSessionController({
    createAdapter: createMemoryAdapterFactory().createAdapter
  });
  await assert.rejects(() => sessions.loadSnapshot(), { code: "NO_ACTIVE_CAMPAIGN" });
});

test("campaign lifecycle requires an atomic compare-and-swap adapter", async () => {
  const sessions = createCassandraCampaignSessionController({
    createAdapter: () => ({
      atomicReplace: false,
      compareAndSwap: false,
      async loadCampaignSnapshot() { return { snapshot: initialSnapshot(), revision: 1 }; },
      async writeCampaignSnapshotAtomic() {},
      close() {}
    })
  });
  await assert.rejects(
    () => sessions.open("campaign:unsafe-storage"),
    { code: "ATOMIC_CAMPAIGN_STORAGE_REQUIRED" }
  );
  assert.deepEqual(sessions.getState(), {
    status: "closed",
    campaignId: null,
    storageRevision: null
  });
});
