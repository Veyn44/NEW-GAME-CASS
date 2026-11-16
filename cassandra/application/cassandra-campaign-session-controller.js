import { IndexedDbCampaignSaveAdapter } from "../../src/adapters/storage/indexeddb-campaign-save-adapter.js";

const CAMPAIGN_ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;

export class CassandraCampaignSessionError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "CassandraCampaignSessionError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(code, message, cause) {
  throw new CassandraCampaignSessionError(code, message, cause);
}

function assertCampaignId(campaignId) {
  if (typeof campaignId !== "string" || !CAMPAIGN_ID.test(campaignId)) {
    fail("INVALID_CAMPAIGN_ID", "Campaign selection requires an explicit stable campaign ID.");
  }
  return campaignId;
}

function cloneSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.majorState === null || typeof snapshot.majorState !== "object"
    || Array.isArray(snapshot.majorState)
    || !Array.isArray(snapshot.pendingPackages)
    || !Array.isArray(snapshot.appliedLedger)) {
    fail("INVALID_CAMPAIGN_SNAPSHOT",
      "Campaign snapshots must contain Major State, pending packages and the Applied ledger.");
  }
  return structuredClone(snapshot);
}

/**
 * Application-owned lifecycle for one explicitly selected Campaign.
 *
 * This controller owns campaign identity and the IndexedDB adapter instance.
 * It does not invent a campaign ID, create domain aggregates, or construct a
 * Change Package coordinator. Those require player selection and approved
 * Cassandra domain handlers respectively.
 */
export function createCassandraCampaignSessionController({
  createAdapter = (options) => new IndexedDbCampaignSaveAdapter(options)
} = {}) {
  if (typeof createAdapter !== "function") {
    fail("CAMPAIGN_ADAPTER_FACTORY_REQUIRED", "Campaign adapter factory must be a function.");
  }

  let active = null;
  let busy = false;

  function requireIdle() {
    if (busy) fail("CAMPAIGN_SESSION_BUSY", "A campaign lifecycle operation is already in progress.");
  }

  function requireClosed() {
    if (active) {
      fail("CAMPAIGN_ALREADY_OPEN", "Close the active campaign before opening or creating another one.", {
        campaignId: active.campaignId
      });
    }
  }

  function getState() {
    return Object.freeze({
      status: active ? "open" : "closed",
      campaignId: active?.campaignId ?? null,
      storageRevision: active?.revision ?? null
    });
  }

  async function open(campaignId) {
    assertCampaignId(campaignId);
    requireIdle();
    requireClosed();
    busy = true;
    let adapter = null;
    try {
      adapter = createAdapter({ campaignId });
      if (!adapter || typeof adapter.loadCampaignSnapshot !== "function"
        || typeof adapter.writeCampaignSnapshotAtomic !== "function"
        || adapter.atomicReplace !== true || adapter.compareAndSwap !== true) {
        fail("ATOMIC_CAMPAIGN_STORAGE_REQUIRED",
          "Campaign sessions require atomic snapshot replacement and compare-and-swap storage.");
      }
      const loaded = await adapter.loadCampaignSnapshot();
      const snapshot = cloneSnapshot(loaded?.snapshot);
      if (!Number.isSafeInteger(loaded.revision) || loaded.revision < 1) {
        fail("CAMPAIGN_NOT_CREATED",
          "The selected campaign has no durable snapshot. Create it explicitly before opening it.");
      }
      active = { campaignId, adapter, revision: loaded.revision, snapshot };
      return getState();
    } catch (error) {
      adapter?.close?.();
      throw error;
    } finally {
      busy = false;
    }
  }

  async function create(campaignId, initialSnapshot) {
    assertCampaignId(campaignId);
    requireIdle();
    requireClosed();
    const initial = cloneSnapshot(initialSnapshot);
    busy = true;
    let adapter = null;
    try {
      adapter = createAdapter({ campaignId, initialSnapshot: initial });
      if (!adapter || typeof adapter.loadCampaignSnapshot !== "function"
        || typeof adapter.writeCampaignSnapshotAtomic !== "function"
        || adapter.atomicReplace !== true || adapter.compareAndSwap !== true) {
        fail("ATOMIC_CAMPAIGN_STORAGE_REQUIRED",
          "Campaign sessions require atomic snapshot replacement and compare-and-swap storage.");
      }
      const existing = await adapter.loadCampaignSnapshot();
      if (existing.revision !== 0) {
        fail("CAMPAIGN_ALREADY_EXISTS", "A durable campaign with this ID already exists.", { campaignId });
      }
      const committed = await adapter.writeCampaignSnapshotAtomic(initial, 0);
      if (committed?.durable !== true || committed.campaignId !== campaignId || committed.revision !== 1) {
        fail("CAMPAIGN_CREATE_UNCONFIRMED",
          "Campaign creation was not confirmed as a durable first snapshot.");
      }
      const reopened = await adapter.loadCampaignSnapshot();
      const persisted = cloneSnapshot(reopened.snapshot);
      if (reopened.revision !== 1 || JSON.stringify(persisted) !== JSON.stringify(initial)) {
        fail("CAMPAIGN_CREATE_VERIFICATION_FAILED",
          "The newly created campaign did not reopen as the exact initial snapshot.");
      }
      active = { campaignId, adapter, revision: reopened.revision, snapshot: persisted };
      return getState();
    } catch (error) {
      adapter?.close?.();
      throw error;
    } finally {
      busy = false;
    }
  }

  function close() {
    requireIdle();
    const previous = active;
    active = null;
    previous?.adapter.close?.();
    return getState();
  }

  async function loadSnapshot() {
    requireIdle();
    if (!active) fail("NO_ACTIVE_CAMPAIGN", "Select and open a campaign before reading its state.");
    const current = active;
    const loaded = await current.adapter.loadCampaignSnapshot();
    const snapshot = cloneSnapshot(loaded?.snapshot);
    if (!Number.isSafeInteger(loaded.revision) || loaded.revision < 1) {
      fail("INVALID_CAMPAIGN_STORAGE_REVISION", "An opened campaign must have a durable positive storage revision.");
    }
    if (active !== current) {
      fail("CAMPAIGN_SESSION_CHANGED", "The active campaign changed while its snapshot was being read.");
    }
    current.revision = loaded.revision;
    current.snapshot = snapshot;
    return Object.freeze({
      campaignId: current.campaignId,
      revision: current.revision,
      snapshot: structuredClone(snapshot)
    });
  }

  async function isPackageApplied(packageId, digest) {
    if (typeof packageId !== "string" || !CAMPAIGN_ID.test(packageId)
      || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
      fail("INVALID_APPLIED_LEDGER_QUERY", "Applied-ledger verification requires a stable package ID and exact SHA-256 digest.");
    }
    if (!active) return false;
    const current = active;
    const loaded = await current.adapter.loadCampaignSnapshot();
    if (active !== current) return false;
    const snapshot = cloneSnapshot(loaded?.snapshot);
    if (!Number.isSafeInteger(loaded.revision) || loaded.revision < 1) {
      fail("INVALID_CAMPAIGN_STORAGE_REVISION", "Applied-ledger verification requires a durable campaign revision.");
    }
    current.revision = loaded.revision;
    current.snapshot = snapshot;
    return snapshot.appliedLedger.some((entry) =>
      entry?.packageId === packageId && entry?.digest === digest && entry?.status === "applied");
  }

  return Object.freeze({
    open,
    create,
    close,
    getState,
    loadSnapshot,
    isPackageApplied
  });
}
