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

function safeDescriptor(value, key, path) {
  try { return Object.getOwnPropertyDescriptor(value, key); }
  catch {
    throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} property could not be inspected safely.`);
  }
}

function cloneSerializable(value, path = "value", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") {
    throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains a non-serializable value.`);
  }
  if (seen.has(value)) throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains a circular reference.`);
  let array;
  let prototype;
  let keys;
  try {
    array = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(value);
  } catch {
    throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} could not be inspected safely.`);
  }
  if (!array && prototype !== Object.prototype && prototype !== null) {
    throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} must contain only plain objects and arrays.`);
  }
  seen.add(value);
  try {
    if (array) {
      const result = new Array(value.length);
      const indices = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains an unsupported array property.`);
        }
        const descriptor = safeDescriptor(value, key, path);
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
    for (const key of keys) {
      if (typeof key !== "string") throw new PersistenceError("INVALID_SNAPSHOT_DATA", `${path} contains a symbol key.`);
      const descriptor = safeDescriptor(value, key, path);
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

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  const {
    campaignId: legacyStateId,
    campaignFormatVersion: legacyFormatVersion,
    gameVersion: legacyApplicationVersion,
    galaxySeed: legacySeed,
    ...current
  } = metadata;
  return {
    ...current,
    stateId: current.stateId ?? legacyStateId,
    formatVersion: current.formatVersion ?? legacyFormatVersion,
    applicationVersion: current.applicationVersion ?? legacyApplicationVersion,
    seed: current.seed ?? legacySeed
  };
}

function assertSlotId(slotId) {
  if (typeof slotId !== "string" || !SLOT_PATTERN.test(slotId)) {
    throw new PersistenceError("INVALID_SLOT_ID", "Save slot ID contains unsupported characters or length.", { slotId });
  }
  return slotId;
}

/**
 * Coordinates system-owned snapshots. The supplied boundary must defer the
 * operation only when the active simulation step and synchronous event delivery
 * have completed. Storage adapters must implement atomic write semantics.
 */
export class Persistence {
  #participants = new Map();
  #adapter;
  #runAtSafeBoundary;
  #logger;
  #applicationVersion;
  #formatVersion;
  #faulted = false;
  #onFatalIntegrityFault;

  constructor({
    adapter,
    runAtSafeBoundary,
    applicationVersion = "0.0.0",
    formatVersion = FORMAT_VERSION,
    logger = null,
    onFatalIntegrityFault = null
  } = {}) {
    if (!adapter || typeof adapter.read !== "function" || typeof adapter.writeAtomic !== "function") {
      throw new PersistenceError("INVALID_ADAPTER", "Persistence adapter must implement read(slotId) and writeAtomic(slotId, saveData).");
    }
    if (typeof runAtSafeBoundary !== "function") {
      throw new PersistenceError("INVALID_BOUNDARY", "Persistence requires runAtSafeBoundary(operation); saves and loads must not run mid-step.");
    }
    if (typeof applicationVersion !== "string" || !applicationVersion.trim()) throw new PersistenceError("INVALID_APPLICATION_VERSION", "applicationVersion must be a non-empty string.");
    if (!Number.isSafeInteger(formatVersion) || formatVersion < 1) {
      throw new PersistenceError("INVALID_FORMAT_VERSION", "formatVersion must be a positive safe integer.");
    }
    if (logger !== null && typeof logger.error !== "function") throw new PersistenceError("INVALID_LOGGER", "Logger must expose error(message, details).");
    if (onFatalIntegrityFault !== null && typeof onFatalIntegrityFault !== "function") {
      throw new PersistenceError("INVALID_FATAL_INTEGRITY_HANDLER",
        "onFatalIntegrityFault must be a function or null.");
    }
    this.#adapter = adapter;
    this.#runAtSafeBoundary = runAtSafeBoundary;
    this.#applicationVersion = applicationVersion;
    this.#formatVersion = formatVersion;
    this.#logger = logger;
    this.#onFatalIntegrityFault = onFatalIntegrityFault;
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
    if (participant.validateSnapshot != null && typeof participant.validateSnapshot !== "function") {
      throw new PersistenceError("INVALID_PARTICIPANT", `Participant "${id}" validateSnapshot must be a function.`);
    }
    if (participant.migrateSnapshot != null && typeof participant.migrateSnapshot !== "function") {
      throw new PersistenceError("INVALID_PARTICIPANT", `Participant "${id}" migrateSnapshot must be a function.`);
    }
    if (participant.prepareRestoreMissing != null && typeof participant.prepareRestoreMissing !== "function") {
      throw new PersistenceError("INVALID_PARTICIPANT", `Participant "${id}" prepareRestoreMissing must be a function.`);
    }
    const hasRuntimeCheckpointCapture = participant.captureRuntimeCheckpoint != null;
    const hasRuntimeCheckpointRestore = participant.prepareRuntimeCheckpointRestore != null;
    if (hasRuntimeCheckpointCapture !== hasRuntimeCheckpointRestore
      || (hasRuntimeCheckpointCapture && typeof participant.captureRuntimeCheckpoint !== "function")
      || (hasRuntimeCheckpointRestore && typeof participant.prepareRuntimeCheckpointRestore !== "function")) {
      throw new PersistenceError("INVALID_PARTICIPANT",
        `Participant "${id}" must provide both runtime checkpoint hooks as functions.`);
    }
    if (participant.allowMissingSnapshot != null && typeof participant.allowMissingSnapshot !== "boolean") {
      throw new PersistenceError("INVALID_PARTICIPANT", `Participant "${id}" allowMissingSnapshot must be a boolean.`);
    }
    const entry = Object.freeze({
      id,
      schemaVersion: participant.schemaVersion,
      required: participant.required !== false,
      allowMissingSnapshot: participant.allowMissingSnapshot === true,
      order: Number.isSafeInteger(participant.order) ? participant.order : 0,
      captureSnapshot: participant.captureSnapshot.bind(participant),
      validateSnapshot: participant.validateSnapshot == null ? null : participant.validateSnapshot.bind(participant),
      migrateSnapshot: participant.migrateSnapshot == null ? null : participant.migrateSnapshot.bind(participant),
      prepareRestoreMissing: participant.prepareRestoreMissing == null ? null : participant.prepareRestoreMissing.bind(participant),
      captureRuntimeCheckpoint: participant.captureRuntimeCheckpoint == null ? null : participant.captureRuntimeCheckpoint.bind(participant),
      prepareRuntimeCheckpointRestore: participant.prepareRuntimeCheckpointRestore == null ? null : participant.prepareRuntimeCheckpointRestore.bind(participant),
      prepareRestore: participant.prepareRestore.bind(participant)
    });
    this.#participants.set(id, entry);
    return () => this.#participants.delete(id);
  }

  get participantIds() {
    return Object.freeze([...this.#participants.keys()].sort());
  }

  get isFaulted() {
    return this.#faulted;
  }

  #assertHealthy() {
    if (this.#faulted) {
      throw new PersistenceError("PERSISTENCE_FAULTED",
        "Persistence is faulted after a failed runtime rollback; restart and recovery are required.");
    }
  }

  /**
   * Runs a synchronous multi-system runtime mutation with an in-memory
   * rollback checkpoint built from every registered persistence participant.
   *
   * prepare() must be synchronous and side-effect-free. It runs at the safe
   * boundary before the checkpoint is captured. commit(plan) must be
   * synchronous. If commit throws, each participant is restored from the
   * checkpoint in normal dependency order before the original error is
   * rethrown. A failed restoration is surfaced as a fatal integrity error.
   */
  runAtomicMutation({ prepare, commit } = {}) {
    this.#assertHealthy();
    if (typeof prepare !== "function" || typeof commit !== "function") {
      throw new PersistenceError("INVALID_ATOMIC_MUTATION",
        "Runtime atomic mutation requires synchronous prepare() and commit(plan) functions.");
    }

    return this.#runAtSafeBoundary(async () => {
      const plan = prepare();
      if (plan && typeof plan.then === "function") {
        throw new PersistenceError("ASYNC_ATOMIC_PREPARATION",
          "Runtime atomic mutation preparation must be synchronous and side-effect-free.");
      }

      const participants = [...this.#participants.values()]
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
      const prepared = [];

      // Capture and prepare every participant before the first live mutation.
      // A missing/invalid participant checkpoint aborts without running commit.
      for (const participant of participants) {
        const captureCheckpoint = participant.captureRuntimeCheckpoint ?? participant.captureSnapshot;
        const prepareCheckpointRestore = participant.prepareRuntimeCheckpointRestore ?? participant.prepareRestore;
        const snapshot = await captureCheckpoint();
        if (snapshot === undefined) {
          throw new PersistenceError("ATOMIC_CHECKPOINT_MISSING",
            `Participant "${participant.id}" did not provide a runtime rollback snapshot.`,
            { participantId: participant.id });
        }
        const detached = cloneSerializable(snapshot, `runtimeCheckpoint.${participant.id}`);
        if (participant.validateSnapshot && await participant.validateSnapshot(detached) !== true) {
          throw new PersistenceError("ATOMIC_CHECKPOINT_INVALID",
            `Participant "${participant.id}" rejected its runtime rollback snapshot.`,
            { participantId: participant.id });
        }
        const transaction = await prepareCheckpointRestore(deepFreeze(detached), Object.freeze({
          metadata: Object.freeze({ kind: "runtime-checkpoint" }),
          storedVersion: participant.schemaVersion,
          schemaVersion: participant.schemaVersion,
          runtimeCheckpoint: true
        }));
        if (!transaction || typeof transaction.commit !== "function"
          || typeof transaction.rollback !== "function") {
          throw new PersistenceError("INVALID_ATOMIC_CHECKPOINT",
            `Participant "${participant.id}" did not prepare a reversible runtime checkpoint.`,
            { participantId: participant.id });
        }
        prepared.push({ participantId: participant.id, transaction });
      }

      try {
        const result = commit(plan);
        if (result && typeof result.then === "function") {
          throw new PersistenceError("ASYNC_ATOMIC_COMMIT",
            "Runtime atomic mutation commit must be synchronous; asynchronous work belongs before prepare().");
        }
        return result;
      } catch (cause) {
        const restoreFailures = [];
        // Participant order is the same dependency order used by load():
        // registries first, then placements/runtime, then domain participants.
        for (const item of prepared) {
          try {
            await item.transaction.commit();
          } catch (restoreError) {
            let rollbackError = null;
            try { await item.transaction.rollback(); }
            catch (error) { rollbackError = error; }
            restoreFailures.push({
              participantId: item.participantId,
              restoreError: restoreError?.message ?? String(restoreError),
              rollbackError: rollbackError?.message ?? null
            });
          }
        }

        if (restoreFailures.length) {
          this.#faulted = true;
          try { this.#onFatalIntegrityFault?.(Object.freeze({ cause, restoreFailures })); } catch { /* Fault signaling must not mask the integrity failure. */ }
          this.#log("critical", "Runtime mutation failed and its rollback checkpoint could not be fully restored.", {
            cause: cause?.message ?? String(cause),
            restoreFailures
          });
          throw new PersistenceError("ATOMIC_MUTATION_ROLLBACK_FAILED",
            "Runtime mutation failed and one or more persistence participants could not restore the pre-mutation state.",
            { cause, restoreFailures });
        }

        this.#log("warn", "Runtime mutation failed; all persistence participants were restored from the in-memory checkpoint.", {
          cause: cause?.message ?? String(cause),
          participantCount: prepared.length
        });
        throw cause;
      }
    });
  }

  async save(slotId, { stateId, seed = null, kind = "manual" } = {}) {
    this.#assertHealthy();
    assertSlotId(slotId);
    if (typeof stateId !== "string" || !stateId.trim()) {
      throw new PersistenceError("INVALID_STATE_ID", "stateId is required for a save.");
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
            stateId,
            seed,
            applicationVersion: this.#applicationVersion,
            formatVersion: this.#formatVersion,
            createdAt: new Date().toISOString(),
            kind
          },
          schemas,
          snapshots
        };
        const validated = deepFreeze(cloneSerializable(saveData));
        try {
          await this.#adapter.writeAtomic(slotId, validated);
        } catch (error) {
          throw new PersistenceError("SAVE_FAILED", `Atomic write failed for slot "${slotId}".`, { slotId, cause: error });
        }
        this.#log("info", "State save committed.", { slotId, stateId, kind, participantCount: Object.keys(snapshots).length });
        return validated.metadata;
      } catch (error) {
        this.#log("error", "State save failed; previous save must remain intact.", { slotId, code: error?.code ?? "SAVE_FAILED", error: error?.message ?? String(error) });
        throw error;
      }
    });
  }

  async load(slotId, { stateId = null } = {}) {
    this.#assertHealthy();
    assertSlotId(slotId);
    return this.#runAtSafeBoundary(async () => {
      try {
        const stored = await this.#adapter.read(slotId);
        if (!stored || typeof stored !== "object") throw new PersistenceError("SAVE_NOT_FOUND", `No save exists in slot "${slotId}".`, { slotId });
        const saveData = cloneSerializable(stored, "saveData");
        const metadata = saveData.metadata;
        const normalizedMetadata = normalizeMetadata(metadata);
        if (!normalizedMetadata || normalizedMetadata.formatVersion !== this.#formatVersion) {
          throw new PersistenceError("INCOMPATIBLE_SAVE_FORMAT", "Save format is incompatible.", { found: normalizedMetadata?.formatVersion, expected: this.#formatVersion });
        }
        if (stateId !== null && normalizedMetadata.stateId !== stateId) {
          throw new PersistenceError("STATE_MISMATCH", "Save belongs to a different state.", { expected: stateId, found: normalizedMetadata.stateId });
        }
        if (!saveData.snapshots || !saveData.schemas) throw new PersistenceError("INVALID_SAVE", "Save is missing snapshots or schema metadata.");
        const ordered = [...this.#participants.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        const prepared = [];
        for (const participant of ordered) {
          if (!Object.hasOwn(saveData.snapshots, participant.id)) {
            if (participant.required && !participant.allowMissingSnapshot) throw new PersistenceError("MISSING_REQUIRED_SNAPSHOT", `Save is missing required participant "${participant.id}".`, { participantId: participant.id });
            if (participant.prepareRestoreMissing) {
              const transaction = await participant.prepareRestoreMissing(Object.freeze({
                metadata: normalizedMetadata,
                schemaVersion: participant.schemaVersion,
                missingSnapshot: true
              }));
              if (!transaction || typeof transaction.commit !== "function" || typeof transaction.rollback !== "function") {
                throw new PersistenceError("INVALID_RESTORE_TRANSACTION", `Participant "${participant.id}" must return commit() and rollback() functions from prepareRestoreMissing().`, { participantId: participant.id });
              }
              prepared.push({ participantId: participant.id, transaction });
            }
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
          const transaction = await participant.prepareRestore(deepFreeze(snapshot), Object.freeze({ metadata: normalizedMetadata, storedVersion, schemaVersion: participant.schemaVersion }));
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
          const rollbackFailures = [];
          for (const item of committed.reverse()) {
            try { await item.transaction.rollback(); }
            catch (rollbackError) {
              const failure = {
                participantId: item.participantId,
                error: rollbackError?.message ?? String(rollbackError)
              };
              rollbackFailures.push(failure);
              this.#log("critical", "Restore rollback failed.", failure);
            }
          }
          if (rollbackFailures.length > 0) {
            this.#faulted = true;
            try {
              this.#onFatalIntegrityFault?.(Object.freeze({
                cause: error,
                rollbackFailures: Object.freeze(rollbackFailures.map((failure) => Object.freeze({ ...failure })))
              }));
            } catch { /* Fault signaling must not mask the integrity failure. */ }
            throw new PersistenceError(
              "RESTORE_ROLLBACK_FAILED",
              "Restore failed and one or more participants could not restore the prior runtime state; restart and recovery are required.",
              { cause: error, rollbackFailures }
            );
          }
          throw new PersistenceError("RESTORE_COMMIT_FAILED", "Restore transaction failed; committed participants were rolled back.", { cause: error });
        }
        this.#log("info", "State save restored.", { slotId, stateId: normalizedMetadata.stateId, participantCount: prepared.length });
        return deepFreeze(normalizedMetadata);
      } catch (error) {
        this.#log("error", "State load failed; runtime must remain stopped.", { slotId, code: error?.code ?? "LOAD_FAILED", error: error?.message ?? String(error) });
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
