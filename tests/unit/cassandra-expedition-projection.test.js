import test from "node:test";
import assert from "node:assert/strict";

import {
  createCassandraExpeditionProjection,
  restoreCassandraExpeditionProjection
} from "../../src/gameplay/expedition/cassandra-expedition-projection.js";

function makeRegistry() {
  const entities = new Map([
    ["campaign:pawn:one", {
      id: "campaign:pawn:one",
      kind: "unit",
      scope: "persistent",
      scopeId: null,
      status: "active"
    }],
    ["campaign:shuttle:one", {
      id: "campaign:shuttle:one",
      kind: "vehicle",
      scope: "persistent",
      scopeId: null,
      status: "active"
    }],
    ["scope:world:temp:one:1", {
      id: "scope:world:temp:one:1",
      kind: "unit",
      scope: "scoped",
      scopeId: "world:temp:one",
      status: "active"
    }],
    ["scope:world:temp:one:2", {
      id: "scope:world:temp:one:2",
      kind: "vehicle",
      scope: "scoped",
      scopeId: "world:temp:one",
      status: "active"
    }],
    ["scope:world:other:1", {
      id: "scope:world:other:1",
      kind: "unit",
      scope: "scoped",
      scopeId: "world:other",
      status: "active"
    }]
  ]);
  return { get: (id) => entities.get(id) ?? null };
}

function createProjection(entityRegistry = makeRegistry()) {
  return createCassandraExpeditionProjection({
    sessionId: "expedition:one",
    mainWorldId: "main:one",
    temporaryWorldId: "temp:one",
    entityRegistry
  });
}

const pawnMapping = {
  campaignEntityId: "campaign:pawn:one",
  temporaryEntityId: "scope:world:temp:one:1",
  aggregateId: "aggregate:crew",
  baselineRevision: 4,
  projectionRole: "participant",
  transferEligible: true
};

test("expedition projection keeps persistent and temporary entity identities distinct", () => {
  const projection = createProjection();
  projection.add(pawnMapping);
  projection.add({
    campaignEntityId: "campaign:shuttle:one",
    temporaryEntityId: "scope:world:temp:one:2",
    aggregateId: "aggregate:shuttle",
    baselineRevision: 2,
    projectionRole: "shuttle",
    transferEligible: true
  });

  assert.equal(projection.resolveCampaignEntityId("scope:world:temp:one:1"), "campaign:pawn:one");
  assert.equal(projection.resolveTemporaryEntityId("campaign:pawn:one"), "scope:world:temp:one:1");
  assert.equal(projection.list().length, 2);
});

test("expedition projection rejects reused identities and entities from another Temporary World", () => {
  const projection = createProjection();
  projection.add(pawnMapping);
  assert.throws(
    () => projection.add({ ...pawnMapping, temporaryEntityId: "scope:world:temp:one:2" }),
    { code: "DUPLICATE_PROJECTION_MAPPING" }
  );
  assert.throws(
    () => projection.add({ ...pawnMapping, campaignEntityId: "campaign:shuttle:one", temporaryEntityId: "scope:world:other:1" }),
    { code: "TEMPORARY_ENTITY_SCOPE_MISMATCH" }
  );
});

test("every projected persistent entity requires exactly one manifest disposition", () => {
  const projection = createProjection();
  projection.add(pawnMapping);
  assert.throws(
    () => projection.validateReturnManifest([]),
    { code: "PROJECTION_MANIFEST_COVERAGE" }
  );
  assert.throws(
    () => projection.validateReturnManifest([
      { campaignEntityId: "campaign:pawn:one", disposition: "returned" },
      { campaignEntityId: "campaign:pawn:one", disposition: "destroyedOrLost" }
    ]),
    { code: "PROJECTION_MANIFEST_COVERAGE" }
  );
  assert.throws(
    () => projection.validateReturnManifest([
      { campaignEntityId: "campaign:unknown", disposition: "returned" }
    ]),
    { code: "UNKNOWN_MANIFEST_CAMPAIGN_ENTITY" }
  );
  assert.equal(projection.validateReturnManifest([
    { campaignEntityId: "campaign:pawn:one", disposition: "returned" }
  ]), true);
});

test("expedition projection snapshot restores only against the same session and valid Engine identities", () => {
  const registry = makeRegistry();
  const projection = createProjection(registry);
  projection.add(pawnMapping);
  const snapshot = projection.toSnapshot();
  const restored = restoreCassandraExpeditionProjection(snapshot, {
    entityRegistry: registry,
    sessionId: "expedition:one",
    mainWorldId: "main:one",
    temporaryWorldId: "temp:one"
  });
  assert.equal(restored.resolveCampaignEntityId("scope:world:temp:one:1"), "campaign:pawn:one");
  assert.throws(
    () => restoreCassandraExpeditionProjection(snapshot, {
      entityRegistry: registry,
      sessionId: "expedition:two"
    }),
    { code: "PROJECTION_SESSION_MISMATCH" }
  );
});
