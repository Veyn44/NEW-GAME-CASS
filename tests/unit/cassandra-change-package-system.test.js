import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  createCassandraChangePackage,
  verifyCassandraChangePackage,
  createCassandraChangePackageCoordinator
} from "../../src/gameplay/expedition/cassandra-change-package-system.js";

globalThis.crypto ??= webcrypto;

function makePackage(overrides = {}) {
  return createCassandraChangePackage({
    packageId: "package:one",
    sessionId: "expedition:one",
    source: {
      mainWorldId: "main:one",
      temporaryWorldId: "temp:one",
      locationId: "location:alpha",
      locationRevision: 3
    },
    baseline: [{ aggregateId: "inventory:crew", revision: 0 }],
    projectionMappings: [],
    operations: [{
      operationId: "operation:add",
      type: "inventory.add",
      aggregateId: "inventory:crew",
      expectedRevision: 0,
      payload: { amount: 4 }
    }],
    returnManifest: [{
      entryId: "manifest:ore",
      resultKey: "result:ore",
      disposition: "returned",
      quantity: 4,
      unit: "ore"
    }],
    outcome: { kind: "end", encounter: "clear" },
    ...overrides
  });
}

function makeStorage({ revision = 0, value = 2, failWrites = 0 } = {}) {
  let snapshot = {
    majorState: {
      revision: 7,
      aggregates: {
        "inventory:crew": { revision, state: { ore: value } }
      }
    },
    pendingPackages: [],
    appliedLedger: []
  };
  let writes = 0;
  return {
    atomicReplace: true,
    async loadCampaignSnapshot() {
      return structuredClone(snapshot);
    },
    async writeCampaignSnapshotAtomic(next) {
      writes += 1;
      if (writes === failWrites) throw new Error("simulated durable write failure");
      snapshot = structuredClone(next);
      return { durable: true };
    },
    tamperPendingCheckpoint() {
      const pending = snapshot.pendingPackages[0];
      if (pending) pending.checkpoint.majorState.revision += 1;
    },
    get snapshot() { return structuredClone(snapshot); },
    get writes() { return writes; }
  };
}

const resolveResultIdentities = async () => ({ "result:ore": "campaign-ore:one" });

const handlers = {
  "inventory.add": {
    validate({ operation, aggregate }) {
      return Number.isSafeInteger(operation.payload.amount)
        && operation.payload.amount > 0
        && Number.isSafeInteger(aggregate.state.ore);
    },
    apply({ operation, aggregate }) {
      aggregate.state.ore += operation.payload.amount;
    }
  }
};

test("change package uses canonical SHA-256 digest and rejects tampering", async () => {
  const changePackage = await makePackage();
  assert.equal(await verifyCassandraChangePackage(changePackage), true);
  const tampered = structuredClone(changePackage);
  tampered.operations[0].payload.amount = 99;
  await assert.rejects(
    () => verifyCassandraChangePackage(tampered),
    { code: "PACKAGE_DIGEST_MISMATCH" }
  );
});

test("change package rejects missing dispositions and inconsistent operation baselines", async () => {
  await assert.rejects(
    () => makePackage({
      returnManifest: [{ entryId: "manifest:bad", disposition: "unknown" }]
    }),
    { code: "INVALID_DISPOSITION" }
  );
  await assert.rejects(
    () => makePackage({
      operations: [{
        operationId: "operation:add",
        type: "inventory.add",
        aggregateId: "inventory:crew",
        expectedRevision: 4,
        payload: { amount: 1 }
      }]
    }),
    { code: "OPERATION_BASELINE_MISMATCH" }
  );
});

test("change package validates one-to-one projection mappings against aggregate baselines", async () => {
  const mapping = {
    campaignEntityId: "campaign:pawn:one",
    temporaryEntityId: "scope:world:temp:one:1",
    aggregateId: "inventory:crew",
    baselineRevision: 0,
    projectionRole: "participant",
    transferEligible: true
  };
  const changePackage = await makePackage({ projectionMappings: [mapping] });
  assert.equal(changePackage.projectionMappings.length, 1);
  await assert.rejects(
    () => makePackage({ projectionMappings: [{ ...mapping, baselineRevision: 2 }] }),
    { code: "PROJECTION_BASELINE_MISMATCH" }
  );
  await assert.rejects(
    () => makePackage({
      projectionMappings: [
        mapping,
        { ...mapping, campaignEntityId: "campaign:pawn:two" }
      ]
    }),
    { code: "DUPLICATE_PROJECTION_MAPPING" }
  );
});

test("coordinator stages a durable buffer then promotes Major State and Applied ledger together", async () => {
  const storage = makeStorage();
  const coordinator = createCassandraChangePackageCoordinator({ storage, operationHandlers: handlers, validateReturnManifest: () => true, resolveResultIdentities });
  const changePackage = await makePackage();
  assert.equal((await coordinator.stage(changePackage, { checkpoint: { majorState: storage.snapshot.majorState } })).status, "pending");
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 2);
  assert.equal(storage.snapshot.pendingPackages.length, 1);

  const result = await coordinator.apply(changePackage.packageId);
  assert.equal(result.status, "applied");
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 6);
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].revision, 1);
  assert.equal(storage.snapshot.pendingPackages.length, 0);
  assert.equal(storage.snapshot.appliedLedger.length, 1);

  assert.equal((await coordinator.apply(changePackage.packageId)).status, "alreadyApplied");
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 6);
});

test("failed promotion retains the old Major State and durable pending package for retry", async () => {
  const storage = makeStorage({ failWrites: 3 });
  let identityResolutions = 0;
  const coordinator = createCassandraChangePackageCoordinator({
    storage,
    operationHandlers: handlers,
    validateReturnManifest: () => true,
    resolveResultIdentities: async () => {
      identityResolutions += 1;
      return { "result:ore": "campaign-ore:one" };
    }
  });
  const changePackage = await makePackage();
  // The third write fails during promotion, after the package and identity map are durable.
  await coordinator.stage(changePackage, { checkpoint: { majorState: storage.snapshot.majorState } });
  await assert.rejects(() => coordinator.apply(changePackage.packageId), /simulated durable write failure/);
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 2);
  assert.equal(storage.snapshot.pendingPackages.length, 1);
  assert.deepEqual(storage.snapshot.pendingPackages[0].resolvedResultIdentities, {
    "result:ore": "campaign-ore:one"
  });

  const result = await coordinator.apply(changePackage.packageId);
  assert.equal(result.status, "applied");
  assert.equal(identityResolutions, 1);
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 6);
});

test("coordinator rejects incomplete result identity mappings before changing Major State", async () => {
  const storage = makeStorage();
  const coordinator = createCassandraChangePackageCoordinator({
    storage,
    operationHandlers: handlers,
    validateReturnManifest: () => true,
    resolveResultIdentities: async () => ({})
  });
  const changePackage = await makePackage();
  await coordinator.stage(changePackage, { checkpoint: { majorState: storage.snapshot.majorState } });
  await assert.rejects(
    () => coordinator.apply(changePackage.packageId),
    { code: "RESULT_IDENTITY_MAP_INCOMPLETE" }
  );
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 2);
  assert.equal(storage.snapshot.appliedLedger.length, 0);
});

test("coordinator rejects a corrupted durable expedition-start checkpoint", async () => {
  const storage = makeStorage();
  const coordinator = createCassandraChangePackageCoordinator({
    storage,
    operationHandlers: handlers,
    validateReturnManifest: () => true,
    resolveResultIdentities
  });
  const changePackage = await makePackage();
  await coordinator.stage(changePackage, { checkpoint: { majorState: storage.snapshot.majorState } });
  storage.tamperPendingCheckpoint();
  await assert.rejects(
    () => coordinator.apply(changePackage.packageId),
    { code: "EXPEDITION_CHECKPOINT_CORRUPT" }
  );
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 2);
  assert.equal(storage.snapshot.appliedLedger.length, 0);
});

test("stale touched aggregate marks package conflicted without applying any operation", async () => {
  const storage = makeStorage({ revision: 1, value: 9 });
  const coordinator = createCassandraChangePackageCoordinator({ storage, operationHandlers: handlers, validateReturnManifest: () => true, resolveResultIdentities });
  const changePackage = await makePackage();
  const expeditionStart = storage.snapshot.majorState;
  expeditionStart.aggregates["inventory:crew"].revision = 0;
  expeditionStart.aggregates["inventory:crew"].state.ore = 2;
  await coordinator.stage(changePackage, { checkpoint: { majorState: expeditionStart } });
  const result = await coordinator.apply(changePackage.packageId);
  assert.equal(result.status, "conflict");
  assert.equal(storage.snapshot.majorState.aggregates["inventory:crew"].state.ore, 9);
  assert.equal(storage.snapshot.appliedLedger.length, 0);
  assert.equal(storage.snapshot.pendingPackages[0].status, "conflict");
});

test("coordinator refuses workspace or non-atomic storage adapters", () => {
  assert.throws(
    () => createCassandraChangePackageCoordinator({
      storage: {
        async loadCampaignSnapshot() { return {}; },
        async writeCampaignSnapshotAtomic() { return true; }
      },
      operationHandlers: handlers
    }),
    { code: "ATOMIC_CAMPAIGN_STORAGE_REQUIRED" }
  );
});
