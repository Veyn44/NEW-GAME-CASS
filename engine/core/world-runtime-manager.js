const WORLD_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const PAUSE_REASON_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,99}$/;
const SNAPSHOT_VERSION = 1;

export class WorldRuntimeError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorldRuntimeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertWorldId(value) {
  if (typeof value !== "string" || !WORLD_ID_PATTERN.test(value)) {
    throw new WorldRuntimeError("INVALID_WORLD_ID", "World ID must be a stable identifier.", { worldId: value });
  }
  return value;
}

function assertPauseReason(value) {
  if (typeof value !== "string" || !PAUSE_REASON_PATTERN.test(value)) {
    throw new WorldRuntimeError("INVALID_PAUSE_REASON", "Pause reason must be a stable non-empty identifier.", { reason: value });
  }
  return value;
}

function parseSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.worlds)) {
    throw new WorldRuntimeError("INVALID_SNAPSHOT", "World runtime snapshot has an unsupported version or shape.");
  }
  const worlds = new Map();
  for (const [index, entry] of snapshot.worlds.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new WorldRuntimeError("INVALID_SNAPSHOT", `World runtime entry at index ${index} must be an object.`);
    }
    const worldId = assertWorldId(entry.worldId);
    if (worlds.has(worldId)
      || !Number.isFinite(entry.simulatedSeconds) || entry.simulatedSeconds < 0
      || !Number.isSafeInteger(entry.completedSteps) || entry.completedSteps < 0) {
      throw new WorldRuntimeError("INVALID_SNAPSHOT", `World runtime data for "${worldId}" is invalid or duplicated.`, { worldId });
    }
    worlds.set(worldId, Object.freeze({
      simulatedSeconds: entry.simulatedSeconds,
      completedSteps: entry.completedSteps
    }));
  }
  return worlds;
}

function parseRuntimeCheckpoint(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)
    || snapshot.version !== SNAPSHOT_VERSION || !Array.isArray(snapshot.worlds)) {
    throw new WorldRuntimeError("INVALID_RUNTIME_CHECKPOINT",
      "World runtime checkpoint has an unsupported version or shape.");
  }
  const worlds = new Map();
  const statuses = new Set(["Unloaded", "Loading", "Ready", "Disposing", "Disposed"]);
  for (const [index, entry] of snapshot.worlds.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new WorldRuntimeError("INVALID_RUNTIME_CHECKPOINT",
        `World runtime checkpoint entry at index ${index} must be an object.`);
    }
    const worldId = assertWorldId(entry.worldId);
    if (worlds.has(worldId) || !statuses.has(entry.status)
      || typeof entry.simulationEnabled !== "boolean"
      || !Array.isArray(entry.pauseReasons)
      || !Number.isFinite(entry.simulatedSeconds) || entry.simulatedSeconds < 0
      || !Number.isSafeInteger(entry.completedSteps) || entry.completedSteps < 0) {
      throw new WorldRuntimeError("INVALID_RUNTIME_CHECKPOINT",
        `World runtime checkpoint data for "${worldId}" is invalid or duplicated.`, { worldId });
    }
    const disposalTarget = entry.disposalTarget ?? null;
    if ((entry.status === "Disposing" && disposalTarget !== "Unloaded" && disposalTarget !== "Disposed")
      || (entry.status !== "Disposing" && disposalTarget !== null)
      || (entry.simulationEnabled && entry.status !== "Ready")) {
      throw new WorldRuntimeError("INVALID_RUNTIME_CHECKPOINT",
        `World runtime lifecycle data for "${worldId}" is inconsistent.`, { worldId });
    }
    const pauseReasons = new Set(entry.pauseReasons.map(assertPauseReason));
    if (pauseReasons.size !== entry.pauseReasons.length) {
      throw new WorldRuntimeError("INVALID_RUNTIME_CHECKPOINT",
        `World runtime checkpoint for "${worldId}" contains duplicate pause reasons.`, { worldId });
    }
    worlds.set(worldId, Object.freeze({
      status: entry.status,
      disposalTarget,
      simulationEnabled: entry.simulationEnabled,
      pauseReasons: Object.freeze([...pauseReasons]),
      simulatedSeconds: entry.simulatedSeconds,
      completedSteps: entry.completedSteps
    }));
  }
  return worlds;
}

function compareWorldIds(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function createRecord(worldId, saved = null) {
  return {
    worldId,
    status: "Unloaded",
    disposalTarget: null,
    simulationEnabled: false,
    pauseReasons: new Set(),
    simulatedSeconds: saved?.simulatedSeconds ?? 0,
    completedSteps: saved?.completedSteps ?? 0
  };
}

/**
 * Owns runtime residency, simulation participation and local simulation time
 * for registered worlds. WorldRegistry continues to own world identity and
 * the singular active-world selection.
 */
export class WorldRuntimeManager {
  #worlds;
  #records = new Map();
  #simulationRoundActive = false;
  #lastRestoreIncludedSnapshot = null;

  constructor({ worldRegistry } = {}) {
    if (!worldRegistry || typeof worldRegistry.get !== "function" || typeof worldRegistry.list !== "function"
      || typeof worldRegistry.setLifecycleGuard !== "function") {
      throw new WorldRuntimeError("INVALID_WORLD_REGISTRY", "WorldRuntimeManager requires a WorldRegistry with lifecycle-guard support.");
    }
    this.#worlds = worldRegistry;
    worldRegistry.setLifecycleGuard((worldId, operation) => {
      this.#assertLifecycleBoundary();
      this.#synchronizeRegisteredWorlds();
      const record = this.#records.get(worldId);
      if (record && record.status !== "Unloaded" && record.status !== "Disposed") {
        throw new WorldRuntimeError("WORLD_RUNTIME_NOT_STOPPED",
          `World "${worldId}" must be Unloaded or Disposed before the registry can ${operation} it.`,
          { worldId, operation, status: record.status });
      }
    });
  }

  beginLoading(worldId) {
    this.#assertLifecycleBoundary();
    const record = this.#requireRecord(worldId);
    if (record.status !== "Unloaded" && record.status !== "Disposed") {
      throw this.#transitionError(record, "Loading");
    }
    record.status = "Loading";
    record.simulationEnabled = false;
    record.pauseReasons.clear();
    return this.getState(worldId);
  }

  markReady(worldId) {
    this.#assertLifecycleBoundary();
    const record = this.#requireRecord(worldId);
    if (record.status !== "Loading") throw this.#transitionError(record, "Ready");
    record.status = "Ready";
    return this.getState(worldId);
  }

  failLoading(worldId) {
    this.#assertLifecycleBoundary();
    const record = this.#requireRecord(worldId);
    if (record.status !== "Loading") throw this.#transitionError(record, "Unloaded");
    record.status = "Unloaded";
    record.simulationEnabled = false;
    record.pauseReasons.clear();
    return this.getState(worldId);
  }

  beginUnload(worldId) {
    this.#assertLifecycleBoundary();
    const record = this.#requireRecord(worldId);
    if (record.status !== "Ready") throw this.#transitionError(record, "Disposing for unload");
    record.status = "Disposing";
    record.disposalTarget = "Unloaded";
    record.simulationEnabled = false;
    record.pauseReasons.clear();
    return this.getState(worldId);
  }

  finishUnload(worldId) {
    this.#assertLifecycleBoundary();
    const record = this.#requireRecord(worldId);
    if (record.status !== "Disposing" || record.disposalTarget !== "Unloaded") {
      throw this.#transitionError(record, "Unloaded");
    }
    record.status = "Unloaded";
    record.disposalTarget = null;
    return this.getState(worldId);
  }

  beginDisposal(worldId) {
    this.#assertLifecycleBoundary();
    const record = this.#requireRecord(worldId);
    if (record.status !== "Ready" && record.status !== "Loading" && record.status !== "Unloaded") {
      throw this.#transitionError(record, "Disposing");
    }
    record.status = "Disposing";
    record.disposalTarget = "Disposed";
    record.simulationEnabled = false;
    record.pauseReasons.clear();
    return this.getState(worldId);
  }

  finishDisposal(worldId) {
    this.#assertLifecycleBoundary();
    const record = this.#requireRecord(worldId);
    if (record.status !== "Disposing" || record.disposalTarget !== "Disposed") throw this.#transitionError(record, "Disposed");
    record.status = "Disposed";
    record.disposalTarget = null;
    record.simulationEnabled = false;
    record.pauseReasons.clear();
    return this.getState(worldId);
  }

  beginSimulationRound(participants) {
    if (this.#simulationRoundActive) {
      throw new WorldRuntimeError("SIMULATION_ROUND_ACTIVE", "A World Runtime simulation round is already active.");
    }
    if (!Array.isArray(participants)) {
      throw new WorldRuntimeError("INVALID_PARTICIPANTS", "Simulation participants must be an array.");
    }
    const seen = new Set();
    for (const participant of participants) {
      const worldId = assertWorldId(participant?.worldId);
      const record = this.#records.get(worldId);
      if (!record || seen.has(worldId)
        || participant.completedSteps !== record.completedSteps
        || participant.simulatedSeconds !== record.simulatedSeconds
        || participant.nextStep !== record.completedSteps + 1) {
        throw new WorldRuntimeError("STALE_PARTICIPANT_SNAPSHOT", `World "${worldId}" participant snapshot is stale or duplicated.`, { worldId });
      }
      seen.add(worldId);
    }
    this.#simulationRoundActive = true;
    return true;
  }

  endSimulationRound() {
    if (!this.#simulationRoundActive) return false;
    this.#simulationRoundActive = false;
    return true;
  }

  setSimulationEnabled(worldId, enabled) {
    if (typeof enabled !== "boolean") {
      throw new WorldRuntimeError("INVALID_PARTICIPATION", "Simulation participation must be a boolean.", { worldId, enabled });
    }
    const record = this.#requireRecord(worldId);
    if (enabled && record.status !== "Ready") {
      throw new WorldRuntimeError("WORLD_NOT_READY", `World "${worldId}" must be Ready before simulation can be enabled.`, { worldId, status: record.status });
    }
    record.simulationEnabled = enabled;
    return this.getState(worldId);
  }

  pause(worldId, reason) {
    const record = this.#requireRecord(worldId);
    record.pauseReasons.add(assertPauseReason(reason));
    return this.getState(worldId);
  }

  resume(worldId, reason) {
    const record = this.#requireRecord(worldId);
    record.pauseReasons.delete(assertPauseReason(reason));
    return this.getState(worldId);
  }

  getState(worldId) {
    const record = this.#requireRecord(worldId);
    return this.#snapshotRecord(record);
  }

  list() {
    this.#synchronizeRegisteredWorlds();
    return Object.freeze([...this.#records.values()]
      .sort((a, b) => compareWorldIds(a.worldId, b.worldId))
      .map((record) => this.#snapshotRecord(record)));
  }

  getParticipants() {
    this.#synchronizeRegisteredWorlds();
    return Object.freeze([...this.#records.values()]
      .filter((record) => record.status === "Ready" && record.simulationEnabled && record.pauseReasons.size === 0)
      .sort((a, b) => compareWorldIds(a.worldId, b.worldId))
      .map((record) => Object.freeze({
        worldId: record.worldId,
        completedSteps: record.completedSteps,
        nextStep: record.completedSteps + 1,
        simulatedSeconds: record.simulatedSeconds
      })));
  }

  validateStep(participants, deltaSeconds) {
    this.#prepareStep(participants, deltaSeconds);
    return true;
  }

  commitStep(participants, deltaSeconds) {
    const updates = this.#prepareStep(participants, deltaSeconds);
    // All values are validated before any record is changed. These assignments
    // are synchronous and invoke no host callbacks.
    for (const update of updates) {
      update.record.simulatedSeconds = update.simulatedSeconds;
      update.record.completedSteps = update.completedSteps;
    }
    return updates.length;
  }

  #prepareStep(participants, deltaSeconds) {
    if (!Array.isArray(participants)) {
      throw new WorldRuntimeError("INVALID_PARTICIPANTS", "Simulation participants must be an array.");
    }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      throw new WorldRuntimeError("INVALID_SIMULATION_DELTA", "Simulation delta must be a positive finite number.", { deltaSeconds });
    }
    const updates = [];
    const seen = new Set();
    for (const participant of participants) {
      const worldId = assertWorldId(participant?.worldId);
      const record = this.#records.get(worldId);
      if (!record || seen.has(worldId)
        || participant.completedSteps !== record.completedSteps
        || participant.simulatedSeconds !== record.simulatedSeconds
        || participant.nextStep !== record.completedSteps + 1) {
        throw new WorldRuntimeError("STALE_PARTICIPANT_SNAPSHOT", `World "${worldId}" participant snapshot is stale or duplicated.`, { worldId });
      }
      const simulatedSeconds = record.simulatedSeconds + deltaSeconds;
      const completedSteps = record.completedSteps + 1;
      if (!Number.isFinite(simulatedSeconds) || !Number.isSafeInteger(completedSteps)) {
        throw new WorldRuntimeError("SIMULATION_TIME_OVERFLOW", `World "${worldId}" local simulation counters overflowed.`, { worldId });
      }
      seen.add(worldId);
      updates.push({ record, simulatedSeconds, completedSteps });
    }
    return updates;
  }

  prepareLegacyTimeRestore(entries) {
    if (!Array.isArray(entries)) {
      throw new WorldRuntimeError("INVALID_LEGACY_WORLD_TIMES", "Legacy world times must be an array.");
    }
    const parsed = new Map();
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new WorldRuntimeError("INVALID_LEGACY_WORLD_TIMES", `Legacy world time at index ${index} must be an object.`);
      }
      const worldId = assertWorldId(entry.worldId);
      if (parsed.has(worldId) || !Number.isFinite(entry.seconds) || entry.seconds < 0) {
        throw new WorldRuntimeError("INVALID_LEGACY_WORLD_TIMES", `Legacy world time for "${worldId}" is invalid or duplicated.`, { worldId });
      }
      parsed.set(worldId, entry.seconds);
    }
    const previous = new Map();
    let committed = false;
    let applied = false;
    return Object.freeze({
      commit: () => {
        if (committed) throw new WorldRuntimeError("RESTORE_ALREADY_COMMITTED", "Legacy world-time restore was already committed.");
        // The authoritative core.world-runtime participant commits earlier in
        // the same Persistence transaction. Its snapshot must win over this
        // compatibility mirror when both are present.
        if (this.#lastRestoreIncludedSnapshot === true) {
          committed = true;
          return;
        }
        const updates = [];
        for (const [worldId, seconds] of parsed) {
          const record = this.#requireRecord(worldId);
          previous.set(worldId, record.simulatedSeconds);
          updates.push({ record, seconds });
        }
        for (const update of updates) update.record.simulatedSeconds = update.seconds;
        applied = true;
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        if (applied) {
          for (const [worldId, seconds] of previous) {
            const record = this.#records.get(worldId);
            if (record) record.simulatedSeconds = seconds;
          }
        }
        committed = false;
        applied = false;
        return true;
      }
    });
  }

  prepareRestoreMissing() {
    const previous = this.#records;
    const previousRestoreIncludedSnapshot = this.#lastRestoreIncludedSnapshot;
    let committed = false;
    return Object.freeze({
      commit: () => {
        const next = new Map();
        for (const world of this.#worlds.list()) {
          if (world.status !== "closed") next.set(world.worldId, createRecord(world.worldId));
        }
        this.#records = next;
        this.#lastRestoreIncludedSnapshot = false;
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#records = previous;
        this.#lastRestoreIncludedSnapshot = previousRestoreIncludedSnapshot;
        committed = false;
        return true;
      }
    });
  }

  createPersistenceParticipant({ id = "core.world-runtime", order = -85 } = {}) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(id) || !Number.isSafeInteger(order)) {
      throw new WorldRuntimeError("INVALID_PARTICIPANT_CONFIG", "World runtime persistence participant ID/order is invalid.", { id, order });
    }
    return Object.freeze({
      id,
      schemaVersion: SNAPSHOT_VERSION,
      required: true,
      allowMissingSnapshot: true,
      order,
      captureSnapshot: () => this.captureSnapshot(),
      captureRuntimeCheckpoint: () => this.captureRuntimeCheckpoint(),
      prepareRuntimeCheckpointRestore: (snapshot) => this.prepareRuntimeCheckpointRestore(snapshot),
      prepareRestoreMissing: () => this.prepareRestoreMissing(),
      validateSnapshot: (snapshot) => {
        try { parseSnapshot(snapshot); return true; }
        catch { return false; }
      },
      prepareRestore: (snapshot) => this.prepareRestore(snapshot)
    });
  }

  captureSnapshot() {
    this.#synchronizeRegisteredWorlds();
    const worlds = [...this.#records.values()]
      .sort((a, b) => compareWorldIds(a.worldId, b.worldId))
      .map((record) => Object.freeze({
        worldId: record.worldId,
        simulatedSeconds: record.simulatedSeconds,
        completedSteps: record.completedSteps
      }));
    return Object.freeze({ version: SNAPSHOT_VERSION, worlds: Object.freeze(worlds) });
  }

  captureRuntimeCheckpoint() {
    this.#synchronizeRegisteredWorlds();
    const worlds = [...this.#records.values()]
      .sort((a, b) => compareWorldIds(a.worldId, b.worldId))
      .map((record) => Object.freeze({
        worldId: record.worldId,
        status: record.status,
        disposalTarget: record.disposalTarget,
        simulationEnabled: record.simulationEnabled,
        pauseReasons: Object.freeze([...record.pauseReasons].sort(compareWorldIds)),
        simulatedSeconds: record.simulatedSeconds,
        completedSteps: record.completedSteps
      }));
    return Object.freeze({ version: SNAPSHOT_VERSION, worlds: Object.freeze(worlds) });
  }

  prepareRuntimeCheckpointRestore(snapshot) {
    const parsed = parseRuntimeCheckpoint(snapshot);
    const previous = this.#records;
    const previousRestoreIncludedSnapshot = this.#lastRestoreIncludedSnapshot;
    let committed = false;
    return Object.freeze({
      commit: () => {
        const registered = this.#worlds.list().filter((world) => world.status !== "closed");
        const registeredIds = new Set(registered.map((world) => world.worldId));
        if (parsed.size !== registeredIds.size
          || [...parsed.keys()].some((worldId) => !registeredIds.has(worldId))) {
          throw new WorldRuntimeError("WORLD_RUNTIME_REGISTRY_MISMATCH",
            "Runtime checkpoint does not match the restored World Registry.");
        }
        const next = new Map();
        for (const world of registered) {
          const saved = parsed.get(world.worldId);
          const record = createRecord(world.worldId, saved);
          record.status = saved.status;
          record.disposalTarget = saved.disposalTarget;
          record.simulationEnabled = saved.simulationEnabled;
          record.pauseReasons = new Set(saved.pauseReasons);
          next.set(world.worldId, record);
        }
        this.#records = next;
        this.#lastRestoreIncludedSnapshot = previousRestoreIncludedSnapshot;
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#records = previous;
        this.#lastRestoreIncludedSnapshot = previousRestoreIncludedSnapshot;
        committed = false;
        return true;
      }
    });
  }

  prepareRestore(snapshot) {
    const parsed = parseSnapshot(snapshot);
    const previous = this.#records;
    const previousRestoreIncludedSnapshot = this.#lastRestoreIncludedSnapshot;
    let committed = false;
    return Object.freeze({
      commit: () => {
        const registered = this.#worlds.list().filter((world) => world.status !== "closed");
        const registeredIds = new Set(registered.map((world) => world.worldId));
        if (parsed.size !== registeredIds.size
          || [...parsed.keys()].some((worldId) => !registeredIds.has(worldId))) {
          throw new WorldRuntimeError("WORLD_RUNTIME_REGISTRY_MISMATCH", "World runtime snapshot does not match the restored World Registry.");
        }
        const next = new Map();
        for (const world of registered) next.set(world.worldId, createRecord(world.worldId, parsed.get(world.worldId)));
        this.#records = next;
        this.#lastRestoreIncludedSnapshot = true;
        committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#records = previous;
        this.#lastRestoreIncludedSnapshot = previousRestoreIncludedSnapshot;
        committed = false;
        return true;
      }
    });
  }

  #synchronizeRegisteredWorlds() {
    for (const world of this.#worlds.list()) {
      if (world.status === "closed") {
        this.#records.delete(world.worldId);
      } else if (!this.#records.has(world.worldId)) {
        this.#records.set(world.worldId, createRecord(world.worldId));
      }
    }
    for (const worldId of this.#records.keys()) {
      if (!this.#worlds.has(worldId)) this.#records.delete(worldId);
    }
  }

  #requireRecord(worldId) {
    const id = assertWorldId(worldId);
    const world = this.#worlds.get(id);
    if (!world) throw new WorldRuntimeError("UNKNOWN_WORLD", `World "${id}" is not registered.`, { worldId: id });
    if (world.status === "closed") throw new WorldRuntimeError("WORLD_CLOSED", `World "${id}" is closed.`, { worldId: id });
    if (!this.#records.has(id)) this.#records.set(id, createRecord(id));
    return this.#records.get(id);
  }

  #snapshotRecord(record) {
    return Object.freeze({
      worldId: record.worldId,
      status: record.status,
      simulationEnabled: record.simulationEnabled,
      pauseReasons: Object.freeze([...record.pauseReasons].sort(compareWorldIds)),
      simulatedSeconds: record.simulatedSeconds,
      completedSteps: record.completedSteps
    });
  }

  #assertLifecycleBoundary() {
    if (this.#simulationRoundActive) {
      throw new WorldRuntimeError("WORLD_STEP_ACTIVE",
        "World lifecycle transitions cannot run during a simulation round.");
    }
  }

  #transitionError(record, target) {
    return new WorldRuntimeError("INVALID_WORLD_TRANSITION",
      `World "${record.worldId}" cannot transition from ${record.status} to ${target}.`,
      { worldId: record.worldId, current: record.status, requested: target });
  }
}
