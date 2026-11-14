import { GameClockError } from "./game-clock.js";

const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
const EPSILON = 1e-9;

export class SchedulerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SchedulerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertPositiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SchedulerError("INVALID_CONFIGURATION", `${label} must be a positive finite number.`, { value });
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new SchedulerError("INVALID_ID", `${label} must be a stable lowercase ID.`, { value });
  }
  return value;
}

/**
 * Fixed-step strategic simulation scheduler.
 *
 * Incoming real-time slices are converted using the GameClock speed that was
 * active when they arrived. Slices retain that ratio while waiting in backlog,
 * so changing speed never retroactively changes already accumulated time.
 *
 * Systems are supplied in the dependency order already validated by
 * SystemRegistry/Bootstrap. The scheduler does not build a second dependency
 * graph or run EventBus handlers in parallel.
 */
export class SimulationScheduler {
  #clock;
  #fixedStepSeconds;
  #maxStepsPerFrame;
  #warningBacklogSeconds;
  #criticalBacklogSeconds;
  #onDiagnostic;
  #tasks;
  #segments = [];
  #backlogSeconds = 0;
  #tick = 0;
  #warningActive = false;
  #overloadPaused = false;
  #overloadArmed = true;
  #faulted = false;
  #advancing = false;

  constructor({
    clock,
    systemOrder,
    tasks = [],
    fixedStepSeconds = 6,
    maxStepsPerFrame = 120,
    warningBacklogSeconds = 120,
    criticalBacklogSeconds = 600,
    onDiagnostic = null
  } = {}) {
    if (!clock || typeof clock.scaleRealDelta !== "function" ||
        typeof clock.commitSimulationStep !== "function" ||
        typeof clock.pause !== "function" || typeof clock.resume !== "function") {
      throw new SchedulerError("INVALID_CLOCK", "SimulationScheduler requires a compatible GameClock.");
    }
    if (!Array.isArray(systemOrder) || systemOrder.some((id) => typeof id !== "string" || !ID_PATTERN.test(id))) {
      throw new SchedulerError("INVALID_SYSTEM_ORDER", "systemOrder must be an array of stable system IDs.");
    }
    if (new Set(systemOrder).size !== systemOrder.length) {
      throw new SchedulerError("DUPLICATE_SYSTEM_ORDER", "systemOrder must not contain duplicate IDs.");
    }
    if (!Array.isArray(tasks)) {
      throw new SchedulerError("INVALID_TASKS", "tasks must be an array.");
    }
    assertPositiveFinite(fixedStepSeconds, "fixedStepSeconds");
    if (!Number.isSafeInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new SchedulerError("INVALID_STEP_LIMIT", "maxStepsPerFrame must be a positive safe integer.", { maxStepsPerFrame });
    }
    assertPositiveFinite(warningBacklogSeconds, "warningBacklogSeconds");
    assertPositiveFinite(criticalBacklogSeconds, "criticalBacklogSeconds");
    if (criticalBacklogSeconds <= warningBacklogSeconds) {
      throw new SchedulerError("INVALID_BACKLOG_THRESHOLDS", "Critical backlog threshold must exceed the warning threshold.");
    }
    if (onDiagnostic !== null && typeof onDiagnostic !== "function") {
      throw new SchedulerError("INVALID_DIAGNOSTIC_HANDLER", "onDiagnostic must be a function or null.");
    }

    const orderIndex = new Map(systemOrder.map((id, index) => [id, index]));
    const seen = new Set();
    const normalized = tasks.map((task, index) => {
      if (!task || typeof task !== "object" || Array.isArray(task)) {
        throw new SchedulerError("INVALID_TASK", `Task at index ${index} must be an object.`, { index });
      }
      const systemId = assertId(task.systemId, "Task systemId");
      if (!orderIndex.has(systemId)) {
        throw new SchedulerError("UNKNOWN_TASK_SYSTEM", `Task system "${systemId}" is absent from systemOrder.`, { systemId });
      }
      if (seen.has(systemId)) {
        throw new SchedulerError("DUPLICATE_TASK", `System "${systemId}" has more than one simulation task.`, { systemId });
      }
      if (typeof task.update !== "function") {
        throw new SchedulerError("INVALID_TASK_HANDLER", `Task "${systemId}" must provide a synchronous update function.`, { systemId });
      }
      const everyTicks = task.everyTicks ?? 1;
      if (!Number.isSafeInteger(everyTicks) || everyTicks < 1) {
        throw new SchedulerError("INVALID_TASK_FREQUENCY", `Task "${systemId}" everyTicks must be a positive safe integer.`, { systemId, everyTicks });
      }
      seen.add(systemId);
      return Object.freeze({ systemId, update: task.update, everyTicks, order: orderIndex.get(systemId) });
    }).sort((a, b) => a.order - b.order);

    this.#clock = clock;
    this.#fixedStepSeconds = fixedStepSeconds;
    this.#maxStepsPerFrame = maxStepsPerFrame;
    this.#warningBacklogSeconds = warningBacklogSeconds;
    this.#criticalBacklogSeconds = criticalBacklogSeconds;
    this.#onDiagnostic = onDiagnostic;
    this.#tasks = Object.freeze(normalized);
    Object.freeze(this);
  }

  get tick() {
    return this.#tick;
  }

  get fixedStepSeconds() {
    return this.#fixedStepSeconds;
  }

  get snapshot() {
    return Object.freeze({
      tick: this.#tick,
      fixedStepSeconds: this.#fixedStepSeconds,
      backlogSeconds: this.#backlogSeconds,
      backlogSteps: Math.floor((this.#backlogSeconds + EPSILON) / this.#fixedStepSeconds),
      pendingSegments: this.#segments.length,
      warningActive: this.#warningActive,
      overloadPaused: this.#overloadPaused,
      faulted: this.#faulted,
      paused: this.#clock.paused
    });
  }

  advance(realDeltaSeconds) {
    if (this.#faulted) {
      throw new SchedulerError("SCHEDULER_FAULTED", "Scheduler is faulted and cannot advance; discard or rebuild the runtime.");
    }
    if (this.#advancing) {
      throw new SchedulerError("REENTRANT_ADVANCE", "SimulationScheduler.advance() cannot be called recursively.");
    }
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0) {
      throw new SchedulerError("INVALID_REAL_DELTA", "realDeltaSeconds must be a non-negative finite number.", { realDeltaSeconds });
    }
    if (this.#clock.paused) return this.snapshot;

    this.#advancing = true;
    try {
      if (realDeltaSeconds > 0) this.#enqueueTime(realDeltaSeconds);
      this.#updateWarningState();

      if (this.#overloadArmed && this.#backlogSeconds >= this.#criticalBacklogSeconds) {
        this.#triggerOverloadPause();
        return this.snapshot;
      }

      let processed = 0;
      while (!this.#clock.paused &&
             this.#backlogSeconds + EPSILON >= this.#fixedStepSeconds &&
             processed < this.#maxStepsPerFrame) {
        this.#runStep();
        processed += 1;
      }

      this.#updateWarningState();
      return Object.freeze({ ...this.snapshot, processedSteps: processed });
    } finally {
      this.#advancing = false;
    }
  }

  /**
   * Explicit acknowledgement clears only the scheduler's emergency pause.
   * Any independent manual or lifecycle pause remains in effect.
   */
  acknowledgeOverload() {
    if (!this.#overloadPaused) return false;
    this.#overloadPaused = false;
    this.#clock.resume("scheduler-overload");
    this.#emitDiagnostic("resumed", { backlogSeconds: this.#backlogSeconds, tick: this.#tick });
    return true;
  }

  #enqueueTime(realDeltaSeconds) {
    const gameDeltaSeconds = this.#clock.scaleRealDelta(realDeltaSeconds);
    if (gameDeltaSeconds <= 0) return;
    const speed = this.#clock.speed;
    const last = this.#segments[this.#segments.length - 1];
    if (last && last.speed === speed) {
      last.realRemaining += realDeltaSeconds;
      last.gameRemaining += gameDeltaSeconds;
    } else {
      this.#segments.push({
        speed,
        gameRemaining: gameDeltaSeconds,
        realRemaining: realDeltaSeconds
      });
    }
    this.#backlogSeconds += gameDeltaSeconds;
  }

  #previewRealDelta(gameSeconds) {
    let remaining = gameSeconds;
    let realDeltaSeconds = 0;
    for (const segment of this.#segments) {
      if (remaining <= EPSILON) break;
      const take = Math.min(remaining, segment.gameRemaining);
      const gamePerRealSecond = segment.gameRemaining / segment.realRemaining;
      realDeltaSeconds += take / gamePerRealSecond;
      remaining -= take;
    }
    if (remaining > EPSILON) {
      throw new SchedulerError("TIME_QUEUE_CORRUPT", "The scheduler time queue does not contain the requested fixed step.", { remaining });
    }
    return realDeltaSeconds;
  }

  #consumeTime(gameSeconds) {
    let remaining = gameSeconds;
    while (remaining > EPSILON) {
      const segment = this.#segments[0];
      if (!segment) {
        throw new SchedulerError("TIME_QUEUE_CORRUPT", "The scheduler time queue ended before the fixed step was consumed.");
      }
      const take = Math.min(remaining, segment.gameRemaining);
      const gamePerRealSecond = segment.gameRemaining / segment.realRemaining;
      const realTake = take / gamePerRealSecond;
      segment.gameRemaining -= take;
      segment.realRemaining -= realTake;
      remaining -= take;
      if (segment.gameRemaining <= EPSILON || segment.realRemaining <= EPSILON) this.#segments.shift();
    }
    this.#backlogSeconds = Math.max(0, this.#backlogSeconds - gameSeconds);
  }

  #runStep() {
    const nextTick = this.#tick + 1;
    const realDeltaSeconds = this.#previewRealDelta(this.#fixedStepSeconds);
    const context = Object.freeze({
      tick: nextTick,
      deltaSeconds: this.#fixedStepSeconds,
      realDeltaSeconds,
      timeSeconds: this.#clock.totalSeconds + this.#fixedStepSeconds
    });

    try {
      for (const task of this.#tasks) {
        if (nextTick % task.everyTicks !== 0) continue;
        const result = task.update(context);
        if (result && typeof result.then === "function") {
          throw new SchedulerError(
            "ASYNC_TASK_NOT_SUPPORTED",
            `Simulation task "${task.systemId}" returned a Promise; fixed-step updates must complete synchronously.`,
            { systemId: task.systemId, tick: nextTick }
          );
        }
      }
      this.#consumeTime(this.#fixedStepSeconds);
      this.#clock.commitSimulationStep(this.#fixedStepSeconds);
      this.#tick = nextTick;
    } catch (error) {
      this.#faulted = true;
      this.#clock.pause("scheduler-fault");
      this.#emitDiagnostic("fault", { tick: nextTick, error: error?.message ?? String(error) });
      if (error instanceof SchedulerError) throw error;
      if (error instanceof GameClockError) {
        throw new SchedulerError("CLOCK_COMMIT_FAILED", error.message, { cause: error, tick: nextTick });
      }
      throw new SchedulerError("SIMULATION_STEP_FAILED", `Simulation step ${nextTick} failed: ${error?.message ?? String(error)}`, {
        cause: error,
        tick: nextTick
      });
    }
  }

  #updateWarningState() {
    if (!this.#warningActive && this.#backlogSeconds >= this.#warningBacklogSeconds) {
      this.#warningActive = true;
      this.#emitDiagnostic("warning", { backlogSeconds: this.#backlogSeconds, tick: this.#tick });
    } else if (this.#warningActive && this.#backlogSeconds < this.#warningBacklogSeconds) {
      this.#warningActive = false;
      this.#overloadArmed = true;
      this.#emitDiagnostic("cleared", { backlogSeconds: this.#backlogSeconds, tick: this.#tick });
    }
  }

  #triggerOverloadPause() {
    if (this.#overloadPaused) return;
    this.#overloadPaused = true;
    this.#overloadArmed = false;
    this.#clock.pause("scheduler-overload");
    this.#emitDiagnostic("critical", { backlogSeconds: this.#backlogSeconds, tick: this.#tick });
  }

  #emitDiagnostic(level, details) {
    try {
      this.#onDiagnostic?.(Object.freeze({ level, ...details }));
    } catch {
      // Diagnostics must never destabilize simulation execution.
    }
  }
}
