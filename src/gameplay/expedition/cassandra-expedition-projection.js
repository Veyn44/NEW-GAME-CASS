const SNAPSHOT_VERSION = 1;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;

export class CassandraExpeditionProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CassandraExpeditionProjectionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new CassandraExpeditionProjectionError(code, message, details);
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    fail("INVALID_PROJECTION_ID", `${label} must be a stable non-empty ID.`, { value });
  }
  return value;
}

function validateEntityPair(entityRegistry, campaignEntityId, temporaryEntityId, temporaryWorldId) {
  const campaignEntity = entityRegistry.get(campaignEntityId);
  const temporaryEntity = entityRegistry.get(temporaryEntityId);
  if (!campaignEntity || campaignEntity.scope !== "persistent"
    || !["active", "stored"].includes(campaignEntity.status)) {
    fail("CAMPAIGN_ENTITY_NOT_PERSISTENT", "Projection source must be a live persistent campaign entity.", {
      campaignEntityId
    });
  }
  const expectedScopeId = `world:${temporaryWorldId}`;
  if (!temporaryEntity || temporaryEntity.scope !== "scoped"
    || temporaryEntity.scopeId !== expectedScopeId || temporaryEntity.status !== "active") {
    fail("TEMPORARY_ENTITY_SCOPE_MISMATCH",
      "Projection target must be an active scoped entity belonging to this Temporary World.",
      { temporaryEntityId, expectedScopeId }
    );
  }
  if (campaignEntity.kind !== temporaryEntity.kind) {
    fail("PROJECTION_KIND_MISMATCH", "Campaign and Temporary World projection entities must have the same kind.", {
      campaignEntityId, temporaryEntityId
    });
  }
  if (campaignEntityId === temporaryEntityId) {
    fail("PROJECTION_ID_REUSE", "Campaign and Temporary World entities must have distinct Engine identities.", {
      campaignEntityId
    });
  }
  return { campaignEntity, temporaryEntity };
}

function normalizeMapping(input, entityRegistry, temporaryWorldId) {
  if (!input || typeof input !== "object") fail("INVALID_PROJECTION_MAPPING", "Projection mapping must be an object.");
  const campaignEntityId = assertId(input.campaignEntityId, "Campaign entity ID");
  const temporaryEntityId = assertId(input.temporaryEntityId, "Temporary entity ID");
  const aggregateId = assertId(input.aggregateId, "Aggregate ID");
  const projectionRole = assertId(input.projectionRole, "Projection role");
  if (!Number.isSafeInteger(input.baselineRevision) || input.baselineRevision < 0) {
    fail("INVALID_PROJECTION_REVISION", "Projection mapping requires a non-negative aggregate baseline revision.", {
      campaignEntityId
    });
  }
  if (typeof input.transferEligible !== "boolean") {
    fail("INVALID_TRANSFER_ELIGIBILITY", "Projection mapping must declare transfer eligibility.", { campaignEntityId });
  }
  const { campaignEntity, temporaryEntity } = validateEntityPair(
    entityRegistry, campaignEntityId, temporaryEntityId, temporaryWorldId
  );
  return Object.freeze({
    campaignEntityId,
    temporaryEntityId,
    aggregateId,
    baselineRevision: input.baselineRevision,
    projectionRole,
    transferEligible: input.transferEligible,
    kind: campaignEntity.kind,
    baselineFingerprint: input.baselineFingerprint ?? null,
    campaignScopeId: campaignEntity.scopeId ?? null,
    temporaryScopeId: temporaryEntity.scopeId
  });
}

function parseSnapshot(snapshot, entityRegistry, expected) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.mappings)) {
    fail("INVALID_PROJECTION_SNAPSHOT", "Projection snapshot has an unsupported version or shape.");
  }
  const sessionId = assertId(snapshot.sessionId, "Session ID");
  const mainWorldId = assertId(snapshot.mainWorldId, "Main World ID");
  const temporaryWorldId = assertId(snapshot.temporaryWorldId, "Temporary World ID");
  if (mainWorldId === temporaryWorldId
    || (expected.sessionId && expected.sessionId !== sessionId)
    || (expected.mainWorldId && expected.mainWorldId !== mainWorldId)
    || (expected.temporaryWorldId && expected.temporaryWorldId !== temporaryWorldId)) {
    fail("PROJECTION_SESSION_MISMATCH", "Projection snapshot does not belong to the expected expedition session.");
  }
  const campaignIds = new Set();
  const temporaryIds = new Set();
  const mappings = snapshot.mappings.map((entry) => {
    const mapping = normalizeMapping(entry, entityRegistry, temporaryWorldId);
    if (campaignIds.has(mapping.campaignEntityId) || temporaryIds.has(mapping.temporaryEntityId)) {
      fail("DUPLICATE_PROJECTION_MAPPING", "Projection mappings must be one-to-one.", {
        campaignEntityId: mapping.campaignEntityId,
        temporaryEntityId: mapping.temporaryEntityId
      });
    }
    campaignIds.add(mapping.campaignEntityId);
    temporaryIds.add(mapping.temporaryEntityId);
    return mapping;
  }).sort((a, b) => a.campaignEntityId.localeCompare(b.campaignEntityId));
  return { sessionId, mainWorldId, temporaryWorldId, mappings };
}

/**
 * Session-scoped one-to-one mapping between persistent campaign entities and
 * their distinct Temporary World runtime projections.
 *
 * This map is Cassandra-owned. It does not move Engine placements or transfer
 * inventory; it only records identity/provenance and return eligibility.
 */
export function createCassandraExpeditionProjection({
  sessionId,
  mainWorldId,
  temporaryWorldId,
  entityRegistry
} = {}) {
  assertId(sessionId, "Session ID");
  assertId(mainWorldId, "Main World ID");
  assertId(temporaryWorldId, "Temporary World ID");
  if (mainWorldId === temporaryWorldId) {
    fail("PROJECTION_SESSION_MISMATCH", "Main and Temporary World IDs must be different.");
  }
  if (!entityRegistry || typeof entityRegistry.get !== "function") {
    fail("ENTITY_REGISTRY_REQUIRED", "Expedition projection requires the Engine Entity Registry.");
  }

  const mappings = new Map();
  const byTemporaryId = new Map();

  function add(input) {
    const mapping = normalizeMapping(input, entityRegistry, temporaryWorldId);
    if (mappings.has(mapping.campaignEntityId) || byTemporaryId.has(mapping.temporaryEntityId)) {
      fail("DUPLICATE_PROJECTION_MAPPING", "A campaign or Temporary World entity can appear only once in the projection map.", {
        campaignEntityId: mapping.campaignEntityId,
        temporaryEntityId: mapping.temporaryEntityId
      });
    }
    mappings.set(mapping.campaignEntityId, mapping);
    byTemporaryId.set(mapping.temporaryEntityId, mapping);
    return mapping;
  }

  const api = Object.freeze({
    add,
    getByCampaignId(campaignEntityId) {
      return mappings.get(assertId(campaignEntityId, "Campaign entity ID")) ?? null;
    },
    getByTemporaryId(temporaryEntityId) {
      return byTemporaryId.get(assertId(temporaryEntityId, "Temporary entity ID")) ?? null;
    },
    resolveCampaignEntityId(temporaryEntityId) {
      return api.getByTemporaryId(temporaryEntityId)?.campaignEntityId ?? null;
    },
    resolveTemporaryEntityId(campaignEntityId) {
      return api.getByCampaignId(campaignEntityId)?.temporaryEntityId ?? null;
    },
    list() {
      return Object.freeze([...mappings.values()].sort((a, b) => a.campaignEntityId.localeCompare(b.campaignEntityId)));
    },
    validateReturnManifest(returnManifest) {
      if (!Array.isArray(returnManifest)) {
        fail("INVALID_RETURN_MANIFEST", "Return manifest must be an array.");
      }
      const counts = new Map();
      for (const entry of returnManifest) {
        if (entry?.campaignEntityId) {
          const id = assertId(entry.campaignEntityId, "Manifest campaign entity ID");
          counts.set(id, (counts.get(id) ?? 0) + 1);
          if (!mappings.has(id)) {
            fail("UNKNOWN_MANIFEST_CAMPAIGN_ENTITY", "Return manifest references an entity outside this expedition projection.", {
              campaignEntityId: id
            });
          }
        }
      }
      for (const mapping of mappings.values()) {
        if (counts.get(mapping.campaignEntityId) !== 1) {
          fail("PROJECTION_MANIFEST_COVERAGE",
            "Every projected persistent campaign entity must have exactly one explicit final disposition.",
            { campaignEntityId: mapping.campaignEntityId, entries: counts.get(mapping.campaignEntityId) ?? 0 }
          );
        }
      }
      return true;
    },
    toSnapshot() {
      return Object.freeze({
        version: SNAPSHOT_VERSION,
        sessionId,
        mainWorldId,
        temporaryWorldId,
        mappings: api.list()
      });
    }
  });
  return api;
}

export function restoreCassandraExpeditionProjection(snapshot, {
  entityRegistry,
  sessionId = null,
  mainWorldId = null,
  temporaryWorldId = null
} = {}) {
  if (!entityRegistry || typeof entityRegistry.get !== "function") {
    fail("ENTITY_REGISTRY_REQUIRED", "Restoring expedition projection requires the Engine Entity Registry.");
  }
  const parsed = parseSnapshot(snapshot, entityRegistry, { sessionId, mainWorldId, temporaryWorldId });
  const api = createCassandraExpeditionProjection({
    ...parsed,
    entityRegistry
  });
  for (const mapping of parsed.mappings) api.add(mapping);
  return api;
}

export const CASSANDRA_EXPEDITION_PROJECTION_SNAPSHOT_VERSION = SNAPSHOT_VERSION;
