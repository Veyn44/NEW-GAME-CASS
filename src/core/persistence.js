const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
const SLOT_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const FORMAT_VERSION = 1;

export class PersistenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PersistenceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new PersistenceError("INVALID_ID", `${label} must be a stable lowercase ID.`, { value });
  }
  return value;
}

function cloneSerializable(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") {
    throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains a non-serializable value.`);
  }
  if (seen.has(value)) throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains a circular reference.`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} must contain only plain objects and arrays.`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      const result = new Array(value.length);
      const indices = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains an unsupported array property.`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
          throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains an accessor or hidden array property.`);
        }
        indices.add(Number(key));
        result[Number(key)] = cloneSerializable(descriptor.value, `${path}[${key}]`, seen);
      }
      if (indices.size !== value.length) throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains a sparse array.`);
      return result;
    }
    const result = Object.create(null);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains a symbol key.`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path}.${key} is not a plain data property.`);
      }
      Object.defineProperty(result, key, {
        value: cloneSerializable(descriptor.value, `${path}.${key}`, seen),
        enumerable: true,
        writable: true,
        configurable: true
      });
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertSlotId(slotId) {
  if (typeof slotId !== "string" || !SLOT_PATTERN.test(slotId)) {
    throw new PersistenceError("INVALID_SLOT_ID", "Save slot ID contains unsupported characters or length.", { slotId });
  }
  return slotId;
}

/**
 * Coordinates system-owned snapshots. The supplied boundary must defer the
 * operation until the active simulation step and synchronous event delivery
 * have completed. Storage adapters must implement atomic write semantics.
 */
export class Persistence {
  #participants = new Map();
  #adapter;
  #runAtSafeBoundary;
  #logger;
  #gameVersion;
  #campaignFormatVersion;

  constructor({
    adapter,
    runAtSafeBoundary,
    gameVersion = "0.0.0",
    campaignFormatVersion = FORMAT_VERSION,
    logger = null
  } = {}) {
    if (!adapter || typeof adapter.read !== "function" || typeof adapter.writeAtomic !== "function") {
      throw new PersistenceError("INVALID_ADAPTER", "Persistence adapter must implement read(slotId) and writeAtomic(slotId, saveData).");
    }
    if (typeof runAtSafeBoundary !== "function") {
      throw new PersistenceError("INVALID_BOUNDARY", "Persistence requires runAtSafeBoundary(operation); saves and loads must not run mid-step.");
    }
    if (typeof gameVersion !== "string" || !gameVersion.trim()) throw new PersistenceError("INVALID_GAME_VERSION", "gameVersion must be a non-empty string.");
    if (!Number.isSafeInteger(campaignFormatVersion) || campaignFormatVersion < 1) {
      throw new PersistenceError("INVALID_FORMAT_VERSION", "campaignFormatVersion must be a positive safe integer.");
    }
    if (logger !== null && typeof logger.error !== "function") throw new PersistenceError("INVALID_LOGGER", "Logger must expose error(message, details).");
    this.#adapter = adapter;
    this.#runAtSafeBoundary = runAtSafeBoundary;
    this.#gameVersion = gameVersion;
    this.#campaignFormatVersion = campaignFormatVersion;
    this.#logger = logger;
  }

  registerParticipant(participant) {
    if (!participant || typeof participant !== "object" || Array.isArray(participant)) {
      throw new PersistenceError("INVALID_PARTICIPANT", "Save participant must be an object.");
    }
    const id = assertId(participant.id, "Participant ID");
    if (this.#participants.has(id)) throw new PersistenceError("DUPLICATE_PARTICIPANT", `Participant "${id}" is already registered.`, { id });
    if (!Number.isSafeInteger(participant.schemaVersion) || participant.schemaVersion < 1) {
      throw new PersistenceError("INVALID_SCHEMA_VERSION", `Participant "${id}" must declare a positive schemaVersion.`, { id });
    }
    if (typeof participant.captureSnapshot !== "function" || typeof participant.prepareRestore !== "function") {
      throw new PersistenceError("INVALID_PARTICIPANT", `Participant "${id}" must implement captureSnapshot() and prepareRestore(snapshot).`, { id });
    }
    const entry = Object.freeze({
      id,
      schemaVersion: participant.schemaVersion,
      required: participant.required !== false,
      order: Number.isSafeInteger(participant.order) ? participant.order : 0,
      captureSnapshot: participant.captureSnapshot,
      validateSnapshot: participant.validateSnapshot ?? null,
      migrateSnapshot: participant.migrateSnapshot ?? null,
      prepareRestore: participant.prepareRestore
    });
    if (entry.validateSnapshot !== null && typeof entry.validateSnapshot !== "function") {
      throw new PersistenceError("INVALID_PARTICIPANT", `Participant "${id}" validateSnapshot must be a function.`);
    }
    if (entry.migrateSnapshot !== null && typeof entry.migrateSnapshot !== "function") {
      throw new PersistenceError("INVALID_PARTICIPANT", `Participant "${id}" migrateSnapshot must be a function.`);
    }
    this.#participants.set(id, entry);
    return () => this.#participants.delete(id);
  }

  get participantIds() {
    return Object.freeze([...this.#participants.keys()].sort());
  }

  async save(slotId, { campaignId, galaxySeed, kind = "manual" } = {}) {
    assertSlotId(slotId);
    if (typeof campaignId !== "string" || !campaignId.trim()) {
      throw new PersistenceError("INVALID_CAMPAIGN_ID", "campaignId is required for a save.");
    }
    if (kind !== "manual" && kind !== "autosave") throw new PersistenceError("INVALID_SAVE_KIND", "kind must be manual or autosave.");
    return this.#runAtSafeBoundary(async () => {
      try {
        const snapshots = Object.create(null);
        const schemas = Object.create(null);
        const participants = [...this.#participants.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        for (const participant of participants) {
          let snapshot;
          try {
            snapshot = await participant.captureSnapshot();
          } catch (error) {
            if (!participant.required) {
              this.#log("warn", "Optional save participant failed to capture snapshot.", { participantId: participant.id, error: error?.message ?? String(error) });
              continue;
            }
            throw new PersistenceError("SNAPSHOT_FAILED", `Required participant "${participant.id}" failed to capture its snapshot.`, { participantId: participant.id, cause: error });
          }
          if (snapshot === undefined) {
            if (participant.required) throw new PersistenceError("MISSING_SNAPSHOT", `Required participant "${participant.id}" returned no snapshot.`, { participantId: participant.id });
            continue;
          }
          const detached = cloneSerializable(snapshot, `snapshots.${participant.id}`);
          if (participant.validateSnapshot && await participant.validateSnapshot(detached) !== true) {
            throw new PersistenceError("INVALID_SNAPSHOT", `Participant "${participant.id}" rejected its snapshot.`, { participantId: participant.id });
          }
          snapshots[participant.id] = detached;
          schemas[participant.id] = participant.schemaVersion;
        }
        const saveData = {
          metadata: {
            campaignId,
            galaxySeed: galaxySeed ?? null,
            gameVersion: this.#gameVersion,
            campaignFormatVersion: this.#campaignFormatVersion,
            createdAt: new Date().toISOString(),
            kind
          },
          schemas,
          snapshots
        };
        const validated = deepFreeze(cloneSerializable(saveData));
        await this.#adapter.writeAtomic(slotId, validated);
        this.#log("info", "Campaign save committed.", { slotId, campaignId, kind, participantCount: Object.keys(snapshots).length });
        return validated.metadata;
      } catch (error) {
        this.#log("error", "Campaign save failed; previous save must remain intact.", { slotId, code: error?.code ?? "SAVE_FAILED", error: error?.message ?? String(error) });
        throw error;
      }
    });
  }

  async load(slotId, { campaignId = null } = {}) {
    assertSlotId(slotId);
    return this.#runAtSafeBoundary(async () => {
      try {
        const stored = await this.#adapter.read(slotId);
        if (!stored || typeof stored !== "object") throw new PersistenceError("SAVE_NOT_FOUND", `No save exists in slot "${slotId}".`, { slotId });
        const saveData = cloneSerializable(stored, "saveData");
        const metadata = saveData.metadata;
        if (!metadata || metadata.campaignFormatVersion !== this.#campaignFormatVersion) {
          throw new PersistenceError("INCOMPATIBLE_SAVE_FORMAT", "Save campaign format is incompatible.", { found: metadata?.campaignFormatVersion, expected: this.#campaignFormatVersion });
        }
        if (campaignId !== null && metadata.campaignId !== campaignId) {
          throw new PersistenceError("CAMPAIGN_MISMATCH", "Save belongs to a different campaign.", { expected: campaignId, found: metadata.campaignId });
        }
        if (!saveData.snapshots || !saveData.schemas) throw new PersistenceError("INVALID_SAVE", "Save is missing snapshots or schema metadata.");
        const ordered = [...this.#participants.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        const prepared = [];
        for (const participant of ordered) {
          if (!Object.hasOwn(saveData.snapshots, participant.id)) {
            if (participant.required) throw new PersistenceError("MISSING_REQUIRED_SNAPSHOT", `Save is missing required participant "${participant.id}".`, { participantId: participant.id });
            continue;
          }
          let snapshot = saveData.snapshots[participant.id];
          const storedVersion = saveData.schemas[participant.id];
          if (!Number.isSafeInteger(storedVersion) || storedVersion < 1) {
            throw new PersistenceError("INVALID_STORED_SCHEMA", `Save has invalid schema version for "${participant.id}".`, { participantId: participant.id });
          }
          if (storedVersion !== participant.schemaVersion) {
            if (!participant.migrateSnapshot) throw new PersistenceError("SCHEMA_MISMATCH", `Participant "${participant.id}" cannot migrate schema ${storedVersion} to ${participant.schemaVersion}.`, { participantId: participant.id, storedVersion, currentVersion: participant.schemaVersion });
            snapshot = await participant.migrateSnapshot(snapshot, storedVersion);
            snapshot = cloneSerializable(snapshot, `migrated.${participant.id}`);
          }
          if (participant.validateSnapshot && await participant.validateSnapshot(snapshot) !== true) {
            throw new PersistenceError("INVALID_SNAPSHOT", `Participant "${participant.id}" rejected the stored snapshot.`, { participantId: participant.id });
          }
          const transaction = await participant.prepareRestore(deepFreeze(snapshot), Object.freeze({ metadata, storedVersion, schemaVersion: participant.schemaVersion }));
          if (!transaction || typeof transaction.commit !== "function" || typeof transaction.rollback !== "function") {
            throw new PersistenceError("INVALID_RESTORE_TRANSACTION", `Participant "${participant.id}" must return commit() and rollback() functions from prepareRestore().`, { participantId: participant.id });
          }
          prepared.push({ participantId: participant.id, transaction });
        }
        const committed = [];
        try {
          for (const item of prepared) {
            // Include the current participant before commit: a failing commit
            // may have made partial changes and must receive rollback too.
            committed.push(item);
            await item.transaction.commit();
          }
        } catch (error) {
          for (const item of committed.reverse()) {
            try { await item.transaction.rollback(); }
            catch (rollbackError) { this.#log("critical", "Restore rollback failed.", { participantId: item.participantId, error: rollbackError?.message ?? String(rollbackError) }); }
          }
          throw new PersistenceError("RESTORE_COMMIT_FAILED", "Restore transaction failed; committed participants were rolled back where possible.", { cause: error });
        }
        this.#log("info", "Campaign save restored.", { slotId, campaignId: metadata.campaignId, participantCount: prepared.length });
        return deepFreeze(metadata);
      } catch (error) {
        this.#log("error", "Campaign load failed; runtime must remain stopped.", { slotId, code: error?.code ?? "LOAD_FAILED", error: error?.message ?? String(error) });
        throw error;
      }
    });
  }

  #log(level, message, details) {
    try { this.#logger?.[level]?.(message, { source: "core.persistence", category: "persistence", ...details }); } catch { /* Diagnostics cannot break persistence control flow. */ }
  }
}

/** Simple deterministic adapter for tests and early integration. */
export class MemorySaveAdapter {
  #slots = new Map();

  async read(slotId) {
    if (!this.#slots.has(slotId)) return null;
    return cloneSerializable(this.#slots.get(slotId), `slot.${slotId}`);
  }

  async writeAtomic(slotId, saveData) {
    const detached = cloneSerializable(saveData, `slot.${slotId}`);
    this.#slots.set(slotId, detached);
    return true;
  }
}
