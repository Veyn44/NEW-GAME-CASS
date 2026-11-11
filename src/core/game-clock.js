const PAUSE_REASON_PATTERN = /^[a-z][a-z0-9.-]*$/;

export class GameClockError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GameClockError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Authoritative strategic clock for Cassandra.
 *
 * One strategic day (86,400 strategic seconds) lasts 720 real seconds at
 * 1x. The clock does not own a calendar, frame loop, timer, or encounter clock.
 * SimulationScheduler commits time only after a complete fixed simulation step.
 */
export class GameClock {
  #dayLengthRealSeconds;
  #strategicSecondsPerDay;
  #minimumSpeed;
  #maximumSpeed;
  #speed;
  #pauseReasons = new Set();
  #totalSeconds = 0;

  constructor({
    dayLengthRealSeconds = 720,
    strategicSecondsPerDay = 86400,
    initialSpeed = 1,
    minimumSpeed = 0.25,
    maximumSpeed = 3
  } = {}) {
    if (!Number.isFinite(dayLengthRealSeconds) || dayLengthRealSeconds <= 0) {
      throw new GameClockError("INVALID_DAY_LENGTH", "dayLengthRealSeconds must be a positive finite number.");
    }
    if (!Number.isFinite(strategicSecondsPerDay) || strategicSecondsPerDay <= 0) {
      throw new GameClockError("INVALID_STRATEGIC_DAY", "strategicSecondsPerDay must be a positive finite number.");
    }
    if (!Number.isFinite(minimumSpeed) || !Number.isFinite(maximumSpeed) ||
        minimumSpeed <= 0 || maximumSpeed < minimumSpeed) {
      throw new GameClockError("INVALID_SPEED_RANGE", "The speed range must contain positive finite values.");
    }

    this.#dayLengthRealSeconds = dayLengthRealSeconds;
    this.#strategicSecondsPerDay = strategicSecondsPerDay;
    this.#minimumSpeed = minimumSpeed;
    this.#maximumSpeed = maximumSpeed;
    this.setSpeed(initialSpeed);
    Object.freeze(this);
  }

  get totalSeconds() {
    return this.#totalSeconds;
  }

  get speed() {
    return this.#speed;
  }

  get paused() {
    return this.#pauseReasons.size > 0;
  }

  get pauseReasons() {
    return Object.freeze([...this.#pauseReasons]);
  }

  get strategicSecondsPerRealSecond() {
    return this.#strategicSecondsPerDay / this.#dayLengthRealSeconds * this.#speed;
  }

  get dayLengthRealSeconds() {
    return this.#dayLengthRealSeconds;
  }

  get strategicSecondsPerDay() {
    return this.#strategicSecondsPerDay;
  }

  setSpeed(value) {
    if (!Number.isFinite(value) || value < this.#minimumSpeed || value > this.#maximumSpeed) {
      throw new GameClockError(
        "INVALID_SPEED",
        `Speed must be between ${this.#minimumSpeed} and ${this.#maximumSpeed}.`,
        { value, minimum: this.#minimumSpeed, maximum: this.#maximumSpeed }
      );
    }
    this.#speed = value;
    return this.snapshot();
  }

  pause(reason = "manual") {
    this.#assertPauseReason(reason);
    const wasPaused = this.paused;
    this.#pauseReasons.add(reason);
    return !wasPaused && this.paused;
  }

  resume(reason = "manual") {
    this.#assertPauseReason(reason);
    return this.#pauseReasons.delete(reason);
  }

  hasPauseReason(reason) {
    return this.#pauseReasons.has(reason);
  }

  /**
   * Converts incoming real time using the speed active at that instant.
   * This method is pure; simulation time is committed by completed steps.
   */
  scaleRealDelta(realDeltaSeconds) {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0) {
      throw new GameClockError("INVALID_REAL_DELTA", "realDeltaSeconds must be a non-negative finite number.", { realDeltaSeconds });
    }
    if (this.paused || realDeltaSeconds === 0) return 0;
    return realDeltaSeconds * this.strategicSecondsPerRealSecond;
  }

  /**
   * Commits one successfully completed strategic simulation step.
   * Called by SimulationScheduler, not by render or UI code.
   */
  commitSimulationStep(strategicDeltaSeconds) {
    if (!Number.isFinite(strategicDeltaSeconds) || strategicDeltaSeconds <= 0) {
      throw new GameClockError("INVALID_SIMULATION_DELTA", "A committed simulation step must be a positive finite number.", { strategicDeltaSeconds });
    }
    const next = this.#totalSeconds + strategicDeltaSeconds;
    if (!Number.isFinite(next) || next <= this.#totalSeconds) {
      throw new GameClockError("TIME_EXHAUSTED", "Strategic time can no longer advance safely.");
    }
    this.#totalSeconds = next;
    return this.#totalSeconds;
  }

  snapshot() {
    return Object.freeze({
      totalSeconds: this.#totalSeconds,
      speed: this.#speed,
      paused: this.paused,
      pauseReasons: this.pauseReasons,
      strategicSecondsPerRealSecond: this.strategicSecondsPerRealSecond,
      dayLengthRealSeconds: this.#dayLengthRealSeconds,
      strategicSecondsPerDay: this.#strategicSecondsPerDay
    });
  }

  #assertPauseReason(reason) {
    if (typeof reason !== "string" || !PAUSE_REASON_PATTERN.test(reason)) {
      throw new GameClockError("INVALID_PAUSE_REASON", "Pause reason must be a stable lowercase ID.", { reason });
    }
  }
}
