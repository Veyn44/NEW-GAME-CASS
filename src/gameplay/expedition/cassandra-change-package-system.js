const PACKAGE_SCHEMA_VERSION = 1;
const PACKAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const DISPOSITIONS = new Set([
  "returned",
  "retainedAtLocation",
  "consumed",
  "destroyedOrLost",
  "transient"
]);

export class CassandraChangePackageError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CassandraChangePackageError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function fail(code, message, details) {
  throw new CassandraChangePackageError(code, message, details);
}

function assertId(value, label) {
  if (typeof value !== "string" || !PACKAGE_ID.test(value)) {
    fail("INVALID_ID", `${label} must be a stable non-empty ID.`, { value });
  }
  return value;
}

function cloneJson(value, label = "value", seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("NON_CANONICAL_VALUE", `${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== "object") {
    fail("NON_CANONICAL_VALUE", `${label} contains a value that cannot be serialized canonically.`);
  }
  if (seen.has(value)) fail("NON_CANONICAL_VALUE", `${label} contains a circular reference.`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => cloneJson(entry, `${label}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("NON_CANONICAL_VALUE", `${label} must contain only plain objects and arrays.`);
    }
    result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) fail("NON_CANONICAL_VALUE", `${label} contains undefined at "${key}".`);
      result[key] = cloneJson(value[key], `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return result;
}

function canonicalStringify(value) {
  const normalized = cloneJson(value);
  function encode(entry) {
    if (entry === null || typeof entry !== "object") return JSON.stringify(entry);
    if (Array.isArray(entry)) return `[${entry.map(encode).join(",")}]`;
    return `{${Object.keys(entry).sort().map((key) => `${JSON.stringify(key)}:${encode(entry[key])}`).join(",")}}`;
  }
  return encode(normalized);
}

async function sha256(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder !== "function") {
    fail("CRYPTO_UNAVAILABLE", "SHA-256 requires the Web Crypto API in this runtime.");
  }
  const bytes = new TextEncoder().encode(value);
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateBaseline(baseline) {
  if (!Array.isArray(baseline)) {
    fail("INVALID_BASELINE", "Package aggregate baselines must be an array.");
  }
  const seen = new Set();
  const result = baseline.map((entry) => {
    if (!entry || typeof entry !== "object") fail("INVALID_BASELINE", "Baseline entries must be objects.");
    const aggregateId = assertId(entry.aggregateId, "Aggregate ID");
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 0 || seen.has(aggregateId)) {
      fail("INVALID_BASELINE", "Aggregate revisions must be unique non-negative safe integers.", { aggregateId });
    }
    seen.add(aggregateId);
    return { aggregateId, revision: entry.revision };
  });
  return result.sort((a, b) => a.aggregateId.localeCompare(b.aggregateId));
}

function validateProjectionMappings(mappings, baseline) {
  if (!Array.isArray(mappings)) {
    fail("INVALID_PROJECTION_MAPPINGS", "projectionMappings must be an array.");
  }
  const baselineById = new Map(baseline.map((entry) => [entry.aggregateId, entry.revision]));
  const campaignIds = new Set();
  const temporaryIds = new Set();
  return mappings.map((mapping) => {
    if (!mapping || typeof mapping !== "object") {
      fail("INVALID_PROJECTION_MAPPINGS", "Projection mapping entries must be objects.");
    }
    const campaignEntityId = assertId(mapping.campaignEntityId, "Campaign entity ID");
    const temporaryEntityId = assertId(mapping.temporaryEntityId, "Temporary entity ID");
    const aggregateId = assertId(mapping.aggregateId, "Projection aggregate ID");
    if (campaignEntityId === temporaryEntityId
      || campaignIds.has(campaignEntityId) || temporaryIds.has(temporaryEntityId)) {
      fail("DUPLICATE_PROJECTION_MAPPING", "Projection identity mappings must be one-to-one and use distinct IDs.", {
        campaignEntityId, temporaryEntityId
      });
    }
    if (baselineById.get(aggregateId) !== mapping.baselineRevision) {
      fail("PROJECTION_BASELINE_MISMATCH",
        "Projection mapping revision must match its package aggregate baseline.",
        { campaignEntityId, aggregateId });
    }
    if (typeof mapping.projectionRole !== "string" || !mapping.projectionRole
      || typeof mapping.transferEligible !== "boolean") {
      fail("INVALID_PROJECTION_MAPPINGS",
        "Projection mapping must declare a role and transfer eligibility.",
        { campaignEntityId });
    }
    if (mapping.baselineFingerprint !== undefined && mapping.baselineFingerprint !== null
      && typeof mapping.baselineFingerprint !== "string") {
      fail("INVALID_PROJECTION_FINGERPRINT", "Projection baseline fingerprint must be a string or null.", {
        campaignEntityId
      });
    }
    campaignIds.add(campaignEntityId);
    temporaryIds.add(temporaryEntityId);
    return cloneJson(mapping, `projection mapping ${campaignEntityId}`);
  }).sort((a, b) => a.campaignEntityId.localeCompare(b.campaignEntityId));
}

function validateOperations(operations, baseline) {
  if (!Array.isArray(operations)) {
    fail("INVALID_OPERATIONS", "Package operations must be an array.");
  }
  if (operations.length === 0) return Object.freeze([]);
  const baselineById = new Map(baseline.map((entry) => [entry.aggregateId, entry.revision]));
  const operationIds = new Set();
  const normalized = operations.map((operation) => {
    if (!operation || typeof operation !== "object") fail("INVALID_OPERATION", "Operations must be objects.");
    const operationId = assertId(operation.operationId, "Operation ID");
    const aggregateId = assertId(operation.aggregateId, "Operation aggregate ID");
    if (operationIds.has(operationId)) fail("DUPLICATE_OPERATION_ID", "Operation IDs must be unique.", { operationId });
    operationIds.add(operationId);
    if (typeof operation.type !== "string" || !/^[a-z][a-zA-Z0-9.:-]{1,95}$/.test(operation.type)) {
      fail("INVALID_OPERATION_TYPE", "Operation type must be a registered-style stable name.", { operationId });
    }
    if (!Number.isSafeInteger(operation.expectedRevision) || operation.expectedRevision < 0
      || baselineById.get(aggregateId) !== operation.expectedRevision) {
      fail("OPERATION_BASELINE_MISMATCH", "Every operation must match its aggregate baseline revision.", { operationId, aggregateId });
    }
    const dependsOn = operation.dependsOn ?? [];
    if (!Array.isArray(dependsOn) || dependsOn.some((id) => typeof id !== "string")) {
      fail("INVALID_OPERATION_DEPENDENCIES", "dependsOn must be an array of operation IDs.", { operationId });
    }
    return {
      operationId,
      type: operation.type,
      aggregateId,
      expectedRevision: operation.expectedRevision,
      dependsOn: [...new Set(dependsOn)].sort(),
      payload: cloneJson(operation.payload ?? {}, `operation ${operationId} payload`),
      provenance: cloneJson(operation.provenance ?? {}, `operation ${operationId} provenance`)
    };
  });
  for (const operation of normalized) {
    for (const dependency of operation.dependsOn) {
      if (!operationIds.has(dependency) || dependency === operation.operationId) {
        fail("INVALID_OPERATION_DEPENDENCIES", "An operation references a missing or self dependency.", {
          operationId: operation.operationId, dependency
        });
      }
    }
  }
  return normalized;
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest)) fail("INVALID_MANIFEST", "returnManifest must be an array.");
  const ids = new Set();
  const resultKeys = new Set();
  const campaignEntityIds = new Set();
  return manifest.map((entry) => {
    if (!entry || typeof entry !== "object") fail("INVALID_MANIFEST", "Manifest entries must be objects.");
    const entryId = assertId(entry.entryId, "Manifest entry ID");
    if (ids.has(entryId)) fail("DUPLICATE_MANIFEST_ENTRY", "Manifest entry IDs must be unique.", { entryId });
    ids.add(entryId);
    if (entry.resultKey !== undefined) {
      assertId(entry.resultKey, "Manifest result key");
      if (resultKeys.has(entry.resultKey)) fail("DUPLICATE_RESULT_KEY", "Manifest result keys must be unique.", { resultKey: entry.resultKey });
      resultKeys.add(entry.resultKey);
      if (entry.campaignEntityId !== undefined) {
        fail("AMBIGUOUS_MANIFEST_IDENTITY", "A manifest entry cannot declare both a resultKey and a campaignEntityId.", { entryId });
      }
    }
    if (entry.campaignEntityId !== undefined) {
      assertId(entry.campaignEntityId, "Manifest campaign entity ID");
      if (campaignEntityIds.has(entry.campaignEntityId)) {
        fail("DUPLICATE_MANIFEST_ENTITY", "A persistent campaign entity must have exactly one final disposition.", {
          campaignEntityId: entry.campaignEntityId
        });
      }
      campaignEntityIds.add(entry.campaignEntityId);
    }
    if (!DISPOSITIONS.has(entry.disposition)) {
      fail("INVALID_DISPOSITION", "Every manifest entry needs one explicit final disposition.", { entryId, disposition: entry.disposition });
    }
    if (entry.quantity !== undefined && (!Number.isSafeInteger(entry.quantity) || entry.quantity < 0)) {
      fail("INVALID_MANIFEST_QUANTITY", "Manifest quantities must be non-negative safe integers.", { entryId });
    }
    if (entry.quantity !== undefined && (typeof entry.unit !== "string" || !entry.unit)) {
      fail("INVALID_MANIFEST_UNIT", "Quantified manifest entries require an explicit unit.", { entryId });
    }
    return cloneJson(entry, `manifest entry ${entryId}`);
  }).sort((a, b) => a.entryId.localeCompare(b.entryId));
}

function validateResultIdentityMap(identityMap, manifest) {
  if (!identityMap || typeof identityMap !== "object" || Array.isArray(identityMap)) {
    fail("RESULT_IDENTITY_MAP_INVALID", "Result identity resolver must return a plain resultKey-to-campaignEntityId object.");
  }
  const expectedKeys = manifest.filter((entry) => entry.resultKey).map((entry) => entry.resultKey).sort();
  const actualKeys = Object.keys(identityMap).sort();
  if (canonicalStringify(expectedKeys) !== canonicalStringify(actualKeys)) {
    fail("RESULT_IDENTITY_MAP_INCOMPLETE",
      "Every manifest resultKey must resolve exactly once, with no extra identity mappings.",
      { expectedKeys, actualKeys });
  }
  const campaignIds = new Set();
  const normalized = {};
  for (const resultKey of expectedKeys) {
    const campaignEntityId = assertId(identityMap[resultKey], "Resolved campaign entity ID");
    if (campaignIds.has(campaignEntityId)) {
      fail("RESULT_IDENTITY_COLLISION", "Different result keys cannot resolve to the same campaign entity ID.", {
        resultKey, campaignEntityId
      });
    }
    campaignIds.add(campaignEntityId);
    normalized[resultKey] = campaignEntityId;
  }
  return normalized;
}

function orderOperations(operations) {
  const byId = new Map(operations.map((operation) => [operation.operationId, operation]));
  const visited = new Set();
  const visiting = new Set();
  const ordered = [];
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) fail("OPERATION_DEPENDENCY_CYCLE", "Operation dependencies must be acyclic.", { operationId: id });
    visiting.add(id);
    const operation = byId.get(id);
    for (const dependency of operation.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(operation);
  }
  for (const id of [...byId.keys()].sort()) visit(id);
  return ordered;
}

function packageContent(envelope) {
  const { digest: _digest, ...content } = envelope;
  return content;
}

export async function createCassandraChangePackage(input) {
  if (!input || typeof input !== "object") fail("INVALID_PACKAGE", "Package input must be an object.");
  const packageId = assertId(input.packageId, "Package ID");
  const sessionId = assertId(input.sessionId, "Expedition session ID");
  if (!input.source || typeof input.source !== "object") fail("INVALID_PACKAGE_SOURCE", "Package source metadata is required.");
  const source = cloneJson(input.source, "source");
  assertId(source.mainWorldId, "Source Main World ID");
  assertId(source.temporaryWorldId, "Source Temporary World ID");
  assertId(source.locationId, "Source location ID");
  if (source.mainWorldId === source.temporaryWorldId) {
    fail("INVALID_PACKAGE_SOURCE", "Source Main and Temporary World IDs must be different.");
  }
  if (!Number.isSafeInteger(source.locationRevision) || source.locationRevision < 0) {
    fail("INVALID_PACKAGE_SOURCE", "Source location revision must be a non-negative safe integer.");
  }
  const baseline = validateBaseline(input.baseline);
  const projectionMappings = validateProjectionMappings(input.projectionMappings ?? [], baseline);
  const operations = validateOperations(input.operations, baseline);
  orderOperations(operations);
  const returnManifest = validateManifest(input.returnManifest);
  if (!input.outcome || !["end", "abandon"].includes(input.outcome.kind)
    || !["clear", "notClear"].includes(input.outcome.encounter)) {
    fail("INVALID_OUTCOME", "Outcome must declare end/abandon and clear/notClear.");
  }
  const envelope = {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    packageId,
    sessionId,
    source,
    baseline,
    projectionMappings,
    operations,
    returnManifest,
    outcome: cloneJson(input.outcome, "outcome")
  };
  envelope.digest = await sha256(canonicalStringify(envelope));
  return deepFreeze(envelope);
}

export async function verifyCassandraChangePackage(changePackage) {
  if (!changePackage || typeof changePackage !== "object"
    || changePackage.schemaVersion !== PACKAGE_SCHEMA_VERSION
    || typeof changePackage.digest !== "string" || !/^[a-f0-9]{64}$/.test(changePackage.digest)) {
    fail("INVALID_PACKAGE", "Change package has an unsupported schema or missing digest.");
  }
  const content = packageContent(changePackage);
  const expected = await sha256(canonicalStringify(content));
  if (expected !== changePackage.digest) {
    fail("PACKAGE_DIGEST_MISMATCH", "Change package content does not match its SHA-256 digest.", {
      packageId: changePackage.packageId
    });
  }
  // Re-run structural validation so malformed but correctly hashed input is rejected.
  const rebuilt = await createCassandraChangePackage(content);
  if (rebuilt.digest !== changePackage.digest) {
    fail("PACKAGE_CANONICALIZATION_MISMATCH", "Change package is not in canonical protocol form.");
  }
  return true;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function cloneState(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * Applies Cassandra-owned packages against a single-snapshot atomic storage
 * contract. This is deliberately not wired to the Dev Lab .cass workspace adapter.
 *
 * storage contract:
 *   loadCampaignSnapshot() -> { snapshot, revision }
 *   writeCampaignSnapshotAtomic(snapshot, expectedRevision) -> { durable: true, revision }
 * The adapter must atomically compare-and-swap one complete campaign snapshot;
 * a stale writer must fail rather than overwrite a newer campaign generation.
 */
export function createCassandraChangePackageCoordinator({
  storage,
  operationHandlers,
  validateReturnManifest,
  resolveResultIdentities
} = {}) {
  if (!storage || typeof storage.loadCampaignSnapshot !== "function"
    || typeof storage.writeCampaignSnapshotAtomic !== "function"
    || storage.atomicReplace !== true || storage.compareAndSwap !== true) {
    fail("ATOMIC_CAMPAIGN_STORAGE_REQUIRED",
      "Campaign storage must provide atomic whole-snapshot replacement and cross-writer compare-and-swap.");
  }
  if (!operationHandlers || typeof operationHandlers !== "object") {
    fail("OPERATION_REGISTRY_REQUIRED", "Cassandra operation handlers must be supplied by the host.");
  }
  if (typeof validateReturnManifest !== "function") {
    fail("RETURN_MANIFEST_VALIDATOR_REQUIRED",
      "The host must provide Cassandra domain reconciliation for every return-manifest entry.");
  }
  if (typeof resolveResultIdentities !== "function") {
    fail("RESULT_IDENTITY_RESOLVER_REQUIRED",
      "The host must resolve every new manifest resultKey to a durable campaign entity identity.");
  }

  async function loadSnapshot() {
    const loaded = await storage.loadCampaignSnapshot();
    if (!loaded || typeof loaded !== "object"
      || !loaded.snapshot || typeof loaded.snapshot !== "object"
      || !Number.isSafeInteger(loaded.revision) || loaded.revision < 0) {
      fail("INVALID_CAMPAIGN_SNAPSHOT_ENVELOPE",
        "Campaign storage must return { snapshot, revision } with a non-negative storage revision.");
    }
    const snapshot = cloneState(loaded.snapshot);
    if (!snapshot.majorState || typeof snapshot.majorState !== "object"
      || !Array.isArray(snapshot.pendingPackages)
      || !Array.isArray(snapshot.appliedLedger)) {
      fail("INVALID_CAMPAIGN_SNAPSHOT", "Campaign snapshot must contain majorState, pendingPackages and appliedLedger.");
    }
    snapshot.__storageRevision = loaded.revision;
    return snapshot;
  }

  async function writeSnapshot(snapshot) {
    const expectedRevision = snapshot.__storageRevision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      fail("CAMPAIGN_STORAGE_REVISION_MISSING", "Candidate snapshot has no storage compare-and-swap revision.");
    }
    const payload = cloneState(snapshot);
    delete payload.__storageRevision;
    const result = await storage.writeCampaignSnapshotAtomic(payload, expectedRevision);
    if (result?.durable !== true || result.revision !== expectedRevision + 1) {
      fail("CAMPAIGN_COMMIT_UNCONFIRMED",
        "Campaign storage did not confirm a durable compare-and-swap snapshot replacement.",
        { expectedRevision, actualRevision: result?.revision ?? null });
    }
    snapshot.__storageRevision = result.revision;
    const reopened = await loadSnapshot();
    if (reopened.__storageRevision !== result.revision) {
      fail("CAMPAIGN_COMMIT_VERIFICATION_FAILED",
        "Reopened campaign snapshot has a different storage revision.",
        { expectedRevision: result.revision, actualRevision: reopened.__storageRevision });
    }
    return reopened;
  }

  return Object.freeze({
    async stage(changePackage, { checkpoint } = {}) {
      await verifyCassandraChangePackage(changePackage);
      const snapshot = await loadSnapshot();
      const pendingExisting = snapshot.pendingPackages.find((entry) => entry.packageId === changePackage.packageId);
      const appliedExisting = snapshot.appliedLedger.find((entry) => entry.packageId === changePackage.packageId);
      if (pendingExisting && appliedExisting) {
        fail("PACKAGE_LEDGER_INCONSISTENT", "A package cannot be both pending and applied.", { packageId: changePackage.packageId });
      }
      const existing = pendingExisting ?? appliedExisting;
      if (existing) {
        if (existing.digest !== changePackage.digest) {
          fail("PACKAGE_ID_REUSE", "A package ID cannot be reused with different content.", { packageId: changePackage.packageId });
        }
        return Object.freeze({ status: appliedExisting ? "alreadyApplied" : "alreadyPending" });
      }
      if (!checkpoint || typeof checkpoint !== "object"
        || !checkpoint.majorState || typeof checkpoint.majorState !== "object"
        || !checkpoint.majorState.aggregates || typeof checkpoint.majorState.aggregates !== "object") {
        fail("EXPEDITION_CHECKPOINT_REQUIRED",
          "The full expedition-start Major State checkpoint, including aggregates, must be retained with the pending package.");
      }
      for (const baseline of changePackage.baseline) {
        if (checkpoint.majorState.aggregates[baseline.aggregateId]?.revision !== baseline.revision) {
          fail("CHECKPOINT_BASELINE_MISMATCH",
            "The package baseline must match the retained expedition-start checkpoint.",
            { aggregateId: baseline.aggregateId });
        }
      }
      const checkpointDigest = await sha256(canonicalStringify(checkpoint));
      snapshot.pendingPackages.push({
        packageId: changePackage.packageId,
        digest: changePackage.digest,
        changePackage: cloneState(changePackage),
        checkpoint: cloneState(checkpoint),
        checkpointDigest,
        status: "pending",
        resolvedResultIdentities: null,
        resolvedResultIdentitiesDigest: null
      });
      const reopened = await writeSnapshot(snapshot);
      const retained = reopened.pendingPackages.find((entry) => entry.packageId === changePackage.packageId);
      if (!retained || retained.digest !== changePackage.digest
        || retained.checkpointDigest !== checkpointDigest
        || canonicalStringify(retained.checkpoint) !== canonicalStringify(checkpoint)) {
        fail("CHANGE_BUFFER_DURABILITY_UNCONFIRMED",
          "The reopened campaign snapshot does not contain the complete pending package and expedition checkpoint.");
      }
      return Object.freeze({ status: "pending", packageId: changePackage.packageId });
    },

    async apply(packageId) {
      assertId(packageId, "Package ID");
      const snapshot = await loadSnapshot();
      const applied = snapshot.appliedLedger.find((entry) => entry.packageId === packageId);
      const pending = snapshot.pendingPackages.find((entry) => entry.packageId === packageId);
      if (applied) {
        if (!pending && typeof applied.digest === "string") {
          return Object.freeze({ status: "alreadyApplied", ledger: deepFreeze(applied) });
        }
      }
      if (!pending) fail("PACKAGE_NOT_PENDING", "No durable pending package exists.", { packageId });
      if (pending.status === "conflict") {
        fail("PACKAGE_CONFLICT_REQUIRES_RESOLUTION",
          "A conflicted immutable package requires an explicit reconciliation/replacement workflow.",
          { packageId });
      }
      const changePackage = pending.changePackage;
      await verifyCassandraChangePackage(changePackage);
      if (pending.digest !== changePackage.digest) fail("PENDING_PACKAGE_CORRUPT", "Pending package digest does not match its envelope.");
      if (typeof pending.checkpointDigest !== "string"
        || await sha256(canonicalStringify(pending.checkpoint)) !== pending.checkpointDigest) {
        fail("EXPEDITION_CHECKPOINT_CORRUPT",
          "The durable expedition-start checkpoint does not match its SHA-256 digest.",
          { packageId });
      }
      if (applied) fail("PACKAGE_LEDGER_INCONSISTENT", "Package exists in both pending and applied records.");

      const majorState = snapshot.majorState;
      if (!Number.isSafeInteger(majorState.revision) || majorState.revision < 0) {
        fail("MAJOR_STATE_REVISION_REQUIRED", "Major State must expose a non-negative safe-integer revision.");
      }
      if (!majorState.aggregates || typeof majorState.aggregates !== "object") {
        fail("MAJOR_STATE_AGGREGATES_REQUIRED", "Major State must expose an aggregates object keyed by stable aggregate ID.");
      }
      for (const baseline of changePackage.baseline) {
        const aggregate = majorState.aggregates[baseline.aggregateId];
        if (!aggregate || aggregate.revision !== baseline.revision) {
          pending.status = "conflict";
          pending.conflict = {
            aggregateId: baseline.aggregateId,
            expectedRevision: baseline.revision,
            actualRevision: aggregate?.revision ?? null
          };
          await writeSnapshot(snapshot);
          return Object.freeze({ status: "conflict", conflict: deepFreeze(pending.conflict) });
        }
      }
      if (await validateReturnManifest(changePackage.returnManifest, changePackage) !== true) {
        fail("RETURN_MANIFEST_REJECTED", "Return manifest validation failed; no package changes were applied.");
      }

      const candidate = cloneState(majorState);
      let resolvedResultIdentities;
      if (pending.resolvedResultIdentities === null || pending.resolvedResultIdentities === undefined) {
        resolvedResultIdentities = validateResultIdentityMap(
          await resolveResultIdentities(changePackage, deepFreeze(cloneJson(candidate))),
          changePackage.returnManifest
        );
        // Persist result-key identities before candidate construction/commit so retries
        // cannot allocate a different durable identity after an interrupted promotion.
        pending.resolvedResultIdentities = resolvedResultIdentities;
        pending.resolvedResultIdentitiesDigest = await sha256(canonicalStringify(resolvedResultIdentities));
        const identityCheckpoint = await writeSnapshot(snapshot);
        const refreshedPending = identityCheckpoint.pendingPackages.find((entry) => entry.packageId === packageId);
        if (!refreshedPending || refreshedPending.digest !== changePackage.digest
          || refreshedPending.resolvedResultIdentitiesDigest !== pending.resolvedResultIdentitiesDigest) {
          fail("IDENTITY_CHECKPOINT_LOST", "Resolved result identities were not retained in the pending Change Buffer.");
        }
      } else {
        resolvedResultIdentities = validateResultIdentityMap(
          pending.resolvedResultIdentities,
          changePackage.returnManifest
        );
        if (typeof pending.resolvedResultIdentitiesDigest !== "string"
          || await sha256(canonicalStringify(resolvedResultIdentities)) !== pending.resolvedResultIdentitiesDigest) {
          fail("RESULT_IDENTITY_CHECKPOINT_CORRUPT",
            "The durable result identity map does not match its SHA-256 digest.",
            { packageId });
        }
      }
      const ordered = orderOperations(changePackage.operations);
      for (const operation of ordered) {
        const handler = operationHandlers[operation.type];
        if (!handler || typeof handler.apply !== "function" || typeof handler.validate !== "function") {
          fail("UNKNOWN_OPERATION_TYPE", "No validator and apply handler is registered for an operation type.", { type: operation.type });
        }
        const aggregate = candidate.aggregates[operation.aggregateId];
        if (!aggregate || aggregate.revision !== operation.expectedRevision) {
          fail("CANDIDATE_BASELINE_MISMATCH", "Candidate aggregate no longer matches the package baseline.", {
            aggregateId: operation.aggregateId
          });
        }
        const valid = await handler.validate({
          candidate: deepFreeze(cloneJson(candidate)),
          aggregate: deepFreeze(cloneJson(aggregate)),
          operation,
          changePackage,
          resolvedResultIdentities
        });
        if (valid !== true) fail("OPERATION_REJECTED", "A typed operation failed validation.", { operationId: operation.operationId });
        await handler.apply({
          candidate,
          aggregate,
          operation,
          changePackage,
          resolvedResultIdentities
        });
      }
      const touched = new Set(changePackage.baseline.map((entry) => entry.aggregateId));
      for (const baseline of changePackage.baseline) {
        if (candidate.aggregates[baseline.aggregateId]?.revision !== baseline.revision) {
          fail("OPERATION_MUTATED_AGGREGATE_REVISION",
            "Typed operation handlers may not mutate aggregate revision counters directly.",
            { aggregateId: baseline.aggregateId });
        }
      }
      if (candidate.revision !== majorState.revision) {
        fail("OPERATION_MUTATED_MAJOR_REVISION", "Typed operation handlers may not mutate the Major State revision directly.");
      }
      for (const aggregateId of touched) {
        candidate.aggregates[aggregateId].revision += 1;
      }
      candidate.revision += 1;
      if (await validateReturnManifest(
        changePackage.returnManifest,
        changePackage,
        deepFreeze(cloneJson(candidate))
      ) !== true) {
        fail("CANDIDATE_MANIFEST_RECONCILIATION_FAILED", "Candidate State does not reconcile with the complete return manifest.");
      }

      const next = cloneState(snapshot);
      next.majorState = candidate;
      next.appliedLedger.push({
        packageId: changePackage.packageId,
        digest: changePackage.digest,
        sessionId: changePackage.sessionId,
        status: "applied",
        resultingMajorRevision: candidate.revision ?? null,
        resolvedResultIdentities,
        commitGeneration: next.appliedLedger.length + 1
      });
      next.pendingPackages = next.pendingPackages.filter((entry) => entry.packageId !== packageId);
      const reopened = await writeSnapshot(next);
      const committed = reopened.appliedLedger.find((entry) => entry.packageId === packageId);
      if (!committed || committed.digest !== changePackage.digest) {
        fail("CAMPAIGN_COMMIT_VERIFICATION_FAILED", "The reopened campaign snapshot does not prove the package commit.");
      }
      return Object.freeze({ status: "applied", ledger: deepFreeze(committed) });
    },

    async getState() {
      const snapshot = await loadSnapshot();
      return deepFreeze({
        majorState: snapshot.majorState,
        pendingPackages: snapshot.pendingPackages,
        appliedLedger: snapshot.appliedLedger
      });
    }
  });
}

export const CASSANDRA_CHANGE_PACKAGE_SCHEMA_VERSION = PACKAGE_SCHEMA_VERSION;
