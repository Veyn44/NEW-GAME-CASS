import {
  createCassandraExpeditionProjection
} from "./cassandra-expedition-projection.js";

export class CassandraUnitProjectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CassandraUnitProjectionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new CassandraUnitProjectionError(code, message, details);
}

/**
 * Creates Temporary World runtime Units for selected persistent campaign Units.
 *
 * The Unit system remains the sole creator/placement authority. This adapter
 * projects only the Unit fields currently modeled by Cassandra (definition and
 * grid-cell position); inventory, health, equipment and shuttle semantics must
 * be added by their owning domain systems rather than copied generically here.
 */
export function createCassandraUnitExpeditionProjection({
  sessionId,
  mainWorldId,
  temporaryWorldId,
  campaignUnitIds,
  unitApi,
  entityRegistry,
  getProjectionMetadata
} = {}) {
  if (!unitApi || typeof unitApi.getUnit !== "function"
    || typeof unitApi.createUnit !== "function"
    || typeof unitApi.removeUnit !== "function") {
    fail("UNIT_API_REQUIRED", "Unit projection requires the Cassandra Unit API.");
  }
  if (!Array.isArray(campaignUnitIds) || campaignUnitIds.length === 0) {
    fail("CAMPAIGN_UNITS_REQUIRED", "At least one campaign Unit must be selected for projection.");
  }
  if (typeof getProjectionMetadata !== "function") {
    fail("PROJECTION_METADATA_REQUIRED",
      "The host must supply each Unit's authoritative aggregate ID, revision, role and transfer eligibility.");
  }
  if (new Set(campaignUnitIds).size !== campaignUnitIds.length) {
    fail("DUPLICATE_CAMPAIGN_UNIT", "A campaign Unit may be projected only once per expedition.");
  }

  const projection = createCassandraExpeditionProjection({
    sessionId,
    mainWorldId,
    temporaryWorldId,
    entityRegistry
  });
  const created = [];
  const projectedUnits = [];

  try {
    for (const campaignEntityId of campaignUnitIds) {
      const source = unitApi.getUnit(campaignEntityId);
      if (!source || source.id !== campaignEntityId) {
        fail("UNKNOWN_CAMPAIGN_UNIT", "Selected campaign Unit does not exist.", { campaignEntityId });
      }
      if (source.placement?.type !== "world" || source.placement.worldId !== mainWorldId) {
        fail("CAMPAIGN_UNIT_NOT_IN_MAIN_WORLD",
          "Only Units currently placed in the selected Main World can be projected by this adapter.",
          { campaignEntityId, mainWorldId, placement: source.placement ?? null });
      }
      if (!Number.isFinite(source.position?.x) || !Number.isFinite(source.position?.y)) {
        fail("INVALID_CAMPAIGN_UNIT_POSITION", "Campaign Unit has no valid continuous position.", { campaignEntityId });
      }
      const metadata = getProjectionMetadata(source);
      if (!metadata || typeof metadata !== "object") {
        fail("INVALID_PROJECTION_METADATA", "Projection metadata callback must return an object.", { campaignEntityId });
      }

      const temporaryUnit = unitApi.createUnit({
        definitionId: source.definitionId,
        worldId: temporaryWorldId,
        position: {
          x: Math.floor(source.position.x),
          y: Math.floor(source.position.y)
        }
      });
      created.push(temporaryUnit.id);
      projection.add({
        campaignEntityId,
        temporaryEntityId: temporaryUnit.id,
        aggregateId: metadata.aggregateId,
        baselineRevision: metadata.baselineRevision,
        projectionRole: metadata.projectionRole,
        transferEligible: metadata.transferEligible,
        baselineFingerprint: metadata.baselineFingerprint ?? null
      });
      projectedUnits.push(temporaryUnit);
    }
  } catch (error) {
    const cleanupErrors = [];
    for (const entityId of created.reverse()) {
      try { unitApi.removeUnit(entityId); }
      catch (cleanupError) { cleanupErrors.push({ entityId, message: cleanupError?.message ?? String(cleanupError) }); }
    }
    if (cleanupErrors.length) {
      fail("PROJECTION_ROLLBACK_FAILED",
        "Projection creation failed and one or more Temporary World Units could not be retired.",
        { cause: error?.message ?? String(error), cleanupErrors });
    }
    throw error;
  }

  return Object.freeze({
    projection,
    projectedUnits: Object.freeze(projectedUnits),
    toSnapshot: () => projection.toSnapshot(),
    validateReturnManifest: (manifest) => projection.validateReturnManifest(manifest)
  });
}
