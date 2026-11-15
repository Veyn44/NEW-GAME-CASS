const DEFAULT_DATABASE_NAME = "cassandra-campaign-storage";
const DEFAULT_STORE_NAME = "campaign-snapshots";
const DEFAULT_DATABASE_VERSION = 1;

export class IndexedDbCampaignSaveError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "IndexedDbCampaignSaveError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(code, message, cause) {
  throw new IndexedDbCampaignSaveError(code, message, cause);
}

function assertToken(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(value)) {
    fail("INVALID_CAMPAIGN_STORAGE_ID", `${label} must be a stable non-empty ID.`);
  }
  return value;
}

function cloneJson(value, label = "campaign snapshot", seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_CAMPAIGN_SNAPSHOT", `${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value !== "object") {
    fail("INVALID_CAMPAIGN_SNAPSHOT", `${label} contains a non-JSON value.`);
  }
  if (seen.has(value)) fail("INVALID_CAMPAIGN_SNAPSHOT", `${label} contains a circular reference.`);
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((entry, index) => cloneJson(entry, `${label}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("INVALID_CAMPAIGN_SNAPSHOT", `${label} must contain only plain objects and arrays.`);
    }
    result = {};
    for (const key of Object.keys(value)) {
      if (value[key] === undefined) fail("INVALID_CAMPAIGN_SNAPSHOT", `${label} contains undefined at "${key}".`);
      result[key] = cloneJson(value[key], `${label}.${key}`, seen);
    }
  }
  seen.delete(value);
  return result;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionResult(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(true);
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
    transaction.onerror = () => {
      // The transaction's abort event carries the final failure.
    };
  });
}

/**
 * Browser campaign persistence using one IndexedDB record per campaign.
 *
 * Major State, pending Change Buffer and Applied ledger are stored together
 * as one value in one object store. A readwrite transaction replaces that
 * single value atomically; strict durability is required and verified.
 *
 * This adapter is intentionally separate from LocalFileSaveAdapter, whose
 * only supported slot is the Dev Lab workspace.
 */
export class IndexedDbCampaignSaveAdapter {
  #indexedDB;
  #databaseName;
  #storeName;
  #databaseVersion;
  #campaignId;
  #initialSnapshot;
  #database = null;
  #opening = null;

  constructor({
    indexedDBRef = globalThis.indexedDB,
    databaseName = DEFAULT_DATABASE_NAME,
    storeName = DEFAULT_STORE_NAME,
    databaseVersion = DEFAULT_DATABASE_VERSION,
    campaignId,
    initialSnapshot = null
  } = {}) {
    if (!indexedDBRef || typeof indexedDBRef.open !== "function") {
      fail("INDEXEDDB_UNAVAILABLE", "IndexedDB is required for authoritative campaign persistence.");
    }
    this.#indexedDB = indexedDBRef;
    this.#databaseName = assertToken(databaseName, "Database name");
    this.#storeName = assertToken(storeName, "Object store name");
    this.#campaignId = assertToken(campaignId, "Campaign ID");
    if (!Number.isSafeInteger(databaseVersion) || databaseVersion < 1) {
      fail("INVALID_DATABASE_VERSION", "IndexedDB database version must be a positive safe integer.");
    }
    this.#databaseVersion = databaseVersion;
    this.#initialSnapshot = initialSnapshot === null ? null : cloneJson(initialSnapshot);
    Object.defineProperty(this, "atomicReplace", { value: true, enumerable: true });
    Object.freeze(this);
  }

  async #open() {
    if (this.#database) return this.#database;
    if (this.#opening) return this.#opening;
    this.#opening = new Promise((resolve, reject) => {
      let request;
      try {
        request = this.#indexedDB.open(this.#databaseName, this.#databaseVersion);
      } catch (error) {
        reject(new IndexedDbCampaignSaveError("INDEXEDDB_OPEN_FAILED", "Could not open the campaign database.", error));
        return;
      }
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(this.#storeName)) {
          database.createObjectStore(this.#storeName, { keyPath: "campaignId" });
        }
      };
      request.onsuccess = () => {
        this.#database = request.result;
        this.#database.onversionchange = () => {
          this.#database?.close();
          this.#database = null;
          this.#opening = null;
        };
        resolve(this.#database);
      };
      request.onerror = () => reject(new IndexedDbCampaignSaveError(
        "INDEXEDDB_OPEN_FAILED", "Could not open the campaign database.", request.error
      ));
      request.onblocked = () => reject(new IndexedDbCampaignSaveError(
        "INDEXEDDB_OPEN_BLOCKED", "Another tab is blocking the campaign database upgrade."
      ));
    }).finally(() => {
      if (!this.#database) this.#opening = null;
    });
    return this.#opening;
  }

  async loadCampaignSnapshot() {
    const database = await this.#open();
    let transaction;
    try {
      transaction = database.transaction(this.#storeName, "readonly");
    } catch (error) {
      fail("INDEXEDDB_READ_FAILED", "Could not begin a campaign snapshot read.", error);
    }
    const completed = transactionResult(transaction);
    let record;
    try {
      record = await requestResult(transaction.objectStore(this.#storeName).get(this.#campaignId));
      await completed;
    } catch (error) {
      fail("INDEXEDDB_READ_FAILED", "Could not read the campaign snapshot.", error);
    }
    if (!record) {
      if (this.#initialSnapshot !== null) {
        return Object.freeze({ snapshot: cloneJson(this.#initialSnapshot), revision: 0 });
      }
      fail("CAMPAIGN_SAVE_NOT_FOUND", `No saved campaign exists for "${this.#campaignId}".`);
    }
    if (record.campaignId !== this.#campaignId || !record.snapshot || typeof record.snapshot !== "object"
      || !Number.isSafeInteger(record.revision) || record.revision < 1) {
      fail("INVALID_CAMPAIGN_RECORD", "The stored campaign record has an invalid shape or revision.");
    }
    return Object.freeze({ snapshot: cloneJson(record.snapshot), revision: record.revision });
  }

  async writeCampaignSnapshotAtomic(snapshot, expectedRevision) {
    const normalized = cloneJson(snapshot);
    if (!normalized.majorState || typeof normalized.majorState !== "object"
      || !Array.isArray(normalized.pendingPackages)
      || !Array.isArray(normalized.appliedLedger)) {
      fail("INVALID_CAMPAIGN_SNAPSHOT",
        "A campaign snapshot must contain Major State, pending Change Buffer packages and Applied ledger.");
    }
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      fail("INVALID_EXPECTED_STORAGE_REVISION", "Campaign writes require a non-negative expected storage revision.");
    }
    const database = await this.#open();
    let transaction;
    try {
      transaction = database.transaction(this.#storeName, "readwrite", { durability: "strict" });
    } catch (error) {
      fail("STRICT_DURABILITY_UNAVAILABLE",
        "The browser cannot create a strict-durability IndexedDB transaction; campaign commit is refused.", error);
    }
    if (transaction.durability !== "strict") {
      try { transaction.abort(); } catch { /* Preserve the durability error. */ }
      fail("STRICT_DURABILITY_UNAVAILABLE",
        "IndexedDB did not confirm strict transaction durability; campaign commit is refused.");
    }
    const completed = transactionResult(transaction);
    let conflict = false;
    let nextRevision = null;
    const store = transaction.objectStore(this.#storeName);
    const currentRequest = store.get(this.#campaignId);
    currentRequest.onsuccess = () => {
      const currentRevision = currentRequest.result?.revision ?? 0;
      if (!Number.isSafeInteger(currentRevision) || currentRevision !== expectedRevision) {
        conflict = true;
        try { transaction.abort(); } catch { /* The transaction may already be aborting. */ }
        return;
      }
      nextRevision = currentRevision + 1;
      try {
        store.put({
          campaignId: this.#campaignId,
          revision: nextRevision,
          snapshot: normalized
        });
      } catch (error) {
        try { transaction.abort(); } catch { /* Preserve the request error. */ }
      }
    };
    try {
      await completed;
    } catch (error) {
      if (conflict) {
        fail("CAMPAIGN_STORAGE_CONFLICT",
          "Another writer committed a newer campaign snapshot; reload and reconcile before retrying.",
          error);
      }
      fail("INDEXEDDB_WRITE_FAILED",
        "The atomic campaign snapshot transaction did not complete.", error);
    }
    return Object.freeze({ durable: true, campaignId: this.#campaignId, revision: nextRevision });
  }

  close() {
    this.#database?.close();
    this.#database = null;
    this.#opening = null;
  }
}
