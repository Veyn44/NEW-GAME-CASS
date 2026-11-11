import { GameClock, GameClockError } from "../src/core/game-clock.js";
import { SchedulerError, SimulationScheduler } from "../src/core/simulation-scheduler.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function equal(actual, expected, message) {
  assert(Object.is(actual, expected), `${message} (expected ${expected}, received ${actual})`);
}
function near(actual, expected, message, epsilon = 1e-8) {
  assert(Math.abs(actual - expected) <= epsilon, `${message} (expected ${expected}, received ${actual})`);
}
function expectCode(callback, code, ErrorType = SchedulerError) {
  try { callback(); }
  catch (error) {
    assert(error instanceof ErrorType, `Expected ${ErrorType.name}, received ${error?.constructor?.name}`);
    equal(error.code, code, "Unexpected error code");
    return error;
  }
  throw new Error(`Expected error ${code}`);
}

export function runClockSchedulerTests() {
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };

  test("one strategic day maps to twelve real minutes at 1x", () => {
    const clock = new GameClock();
    equal(clock.dayLengthRealSeconds, 720, "Real day length");
    equal(clock.strategicSecondsPerDay, 86400, "Strategic day length");
    equal(clock.scaleRealDelta(720), 86400, "Strategic seconds in one real day");
    equal(clock.strategicSecondsPerRealSecond, 120, "Base strategic rate");
  });

  test("speed scales strategic time within the approved range", () => {
    const clock = new GameClock();
    clock.setSpeed(2);
    equal(clock.scaleRealDelta(1), 240, "2x strategic delta");
    clock.setSpeed(3);
    equal(clock.scaleRealDelta(1), 360, "3x strategic delta");
    clock.setSpeed(0.25);
    equal(clock.scaleRealDelta(1), 30, "Minimum strategic delta");
    expectCode(() => clock.setSpeed(3.01), "INVALID_SPEED", GameClockError);
    expectCode(() => clock.setSpeed(0), "INVALID_SPEED", GameClockError);
  });

  test("pause reasons compose and can be removed independently", () => {
    const clock = new GameClock();
    clock.pause("manual");
    clock.pause("scheduler-overload");
    assert(clock.paused, "Clock should be paused.");
    equal(clock.scaleRealDelta(10), 0, "Paused clock must not accumulate strategic time.");
    clock.resume("scheduler-overload");
    assert(clock.paused, "Manual pause must remain.");
    clock.resume("manual");
    assert(!clock.paused, "Clock should resume after all reasons are removed.");
  });

  test("pause and resume operations are idempotent", () => {
    const clock = new GameClock();
    equal(clock.pause("manual"), true, "First pause should change state.");
    equal(clock.pause("manual"), false, "Repeated pause should be a no-op.");
    equal(clock.resume("manual"), true, "First resume should remove reason.");
    equal(clock.resume("manual"), false, "Repeated resume should be a no-op.");
  });

  test("clock validates deltas and commits only positive simulation time", () => {
    const clock = new GameClock();
    expectCode(() => clock.scaleRealDelta(-1), "INVALID_REAL_DELTA", GameClockError);
    expectCode(() => clock.scaleRealDelta(Infinity), "INVALID_REAL_DELTA", GameClockError);
    expectCode(() => clock.commitSimulationStep(0), "INVALID_SIMULATION_DELTA", GameClockError);
    equal(clock.totalSeconds, 0, "Invalid operations must not advance time.");
    equal(clock.commitSimulationStep(6), 6, "Committed time");
  });

  test("scheduler waits for a complete fixed strategic step", () => {
    const clock = new GameClock();
    const scheduler = new SimulationScheduler({ clock, systemOrder: [] });
    equal(scheduler.advance(0.025).processedSteps, 0, "Half a step must not run.");
    equal(scheduler.tick, 0, "Tick before completion");
    equal(scheduler.advance(0.025).processedSteps, 1, "Second half completes one step.");
    equal(clock.totalSeconds, 6, "One complete strategic step committed.");
  });

  test("fixed-step results are independent of render-frame partitioning", () => {
    const make = () => {
      const clock = new GameClock();
      const scheduler = new SimulationScheduler({ clock, systemOrder: [], maxStepsPerFrame: 500 });
      for (let i = 0; i < 60; i++) scheduler.advance(1 / 60);
      return { clock, scheduler };
    };
    const a = make();
    const clockB = new GameClock();
    const schedulerB = new SimulationScheduler({ clock: clockB, systemOrder: [], maxStepsPerFrame: 500 });
    for (let i = 0; i < 20; i++) schedulerB.advance(1 / 20);
    equal(a.scheduler.tick, schedulerB.tick, "Tick count");
    near(a.clock.totalSeconds, clockB.totalSeconds, "Committed strategic time");
  });

  test("tasks execute in validated system dependency order", () => {
    const clock = new GameClock();
    const calls = [];
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: ["provider", "middle", "consumer"],
      tasks: [
        { systemId: "consumer", update: () => calls.push("consumer") },
        { systemId: "middle", update: () => calls.push("middle") },
        { systemId: "provider", update: () => calls.push("provider") }
      ]
    });
    scheduler.advance(0.05);
    equal(calls.join(","), "provider,middle,consumer", "Task execution order");
  });

  test("task frequency uses deterministic integer tick intervals", () => {
    const clock = new GameClock();
    const calls = [];
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: ["fast", "slow"],
      tasks: [
        { systemId: "fast", update: ({ tick }) => calls.push(`f${tick}`) },
        { systemId: "slow", everyTicks: 2, update: ({ tick }) => calls.push(`s${tick}`) }
      ]
    });
    scheduler.advance(0.15);
    equal(calls.join(","), "f1,f2,s2,f3", "Frequency sequence");
  });

  test("step context exposes strategic time and corresponding real-time slice", () => {
    const clock = new GameClock();
    let received;
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: ["probe"],
      tasks: [{ systemId: "probe", update: (context) => { received = context; } }]
    });
    scheduler.advance(0.05);
    equal(received.deltaSeconds, 6, "Strategic fixed delta");
    near(received.realDeltaSeconds, 0.05, "Real-time equivalent");
    equal(received.timeSeconds, 6, "End time of step");
    equal(received.tick, 1, "Tick index");
  });

  test("already accumulated slices retain their original speed after a speed change", () => {
    const clock = new GameClock();
    let received;
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: ["probe"],
      tasks: [{ systemId: "probe", update: (context) => { received = context; } }]
    });
    scheduler.advance(0.025); // 3 strategic seconds at 1x
    clock.setSpeed(2);
    scheduler.advance(0.0125); // 3 strategic seconds at 2x
    equal(scheduler.tick, 1, "One fixed step should complete.");
    near(received.realDeltaSeconds, 0.0375, "Real time must retain both original speed ratios.");
    equal(clock.totalSeconds, 6, "Strategic time committed once.");
  });

  test("pause stops new accumulation and preserves a partial step", () => {
    const clock = new GameClock();
    const scheduler = new SimulationScheduler({ clock, systemOrder: [] });
    scheduler.advance(0.025);
    clock.pause("manual");
    scheduler.advance(5);
    near(scheduler.snapshot.backlogSeconds, 3, "Paused real time must not enter backlog.");
    clock.resume("manual");
    scheduler.advance(0.025);
    equal(scheduler.tick, 1, "The preserved half-step should complete after resume.");
  });

  test("per-frame work limit preserves backlog instead of dropping time", () => {
    const clock = new GameClock();
    const scheduler = new SimulationScheduler({ clock, systemOrder: [], maxStepsPerFrame: 2 });
    const first = scheduler.advance(0.25);
    equal(first.processedSteps, 2, "First frame step cap");
    equal(scheduler.tick, 2, "Ticks after first frame");
    equal(scheduler.snapshot.backlogSeconds, 18, "Backlog after first frame");
    const second = scheduler.advance(0);
    equal(second.processedSteps, 2, "Second frame step cap");
    equal(scheduler.snapshot.backlogSeconds, 6, "Backlog after second frame");
    const third = scheduler.advance(0);
    equal(third.processedSteps, 1, "Final preserved step");
    equal(scheduler.snapshot.backlogSeconds, 0, "No time should be dropped.");
  });

  test("critical backlog triggers emergency pause without discarding time", () => {
    const clock = new GameClock();
    const diagnostics = [];
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: [],
      warningBacklogSeconds: 12,
      criticalBacklogSeconds: 30,
      onDiagnostic: (entry) => diagnostics.push(entry.level)
    });
    const result = scheduler.advance(0.3);
    assert(clock.paused, "Critical overload should pause the clock.");
    assert(scheduler.snapshot.overloadPaused, "Scheduler should record its emergency pause.");
    equal(scheduler.tick, 0, "Critical overload should not begin another step.");
    near(scheduler.snapshot.backlogSeconds, 36, "Backlog must be preserved.");
    equal(diagnostics.join(","), "warning,critical", "Diagnostic sequence");
    assert(result.paused, "Advance result should report pause.");
  });

  test("overload acknowledgement clears only the emergency pause reason", () => {
    const clock = new GameClock();
    const scheduler = new SimulationScheduler({
      clock, systemOrder: [], warningBacklogSeconds: 12, criticalBacklogSeconds: 30
    });
    scheduler.advance(0.3);
    clock.pause("manual");
    assert(clock.paused, "Clock remains paused.");
    assert(scheduler.acknowledgeOverload(), "Acknowledgement should clear overload state.");
    assert(clock.paused, "Manual pause must remain active.");
    clock.resume("manual");
    scheduler.advance(0);
    equal(scheduler.tick, 6, "Preserved backlog should be processed after resume.");
  });

  test("warning diagnostic clears after backlog returns below its threshold", () => {
    const clock = new GameClock();
    const diagnostics = [];
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: [],
      warningBacklogSeconds: 12,
      criticalBacklogSeconds: 60,
      onDiagnostic: (entry) => diagnostics.push(entry.level)
    });
    scheduler.advance(0.15);
    equal(diagnostics.join(","), "warning,cleared", "Warning lifecycle");
    assert(!scheduler.snapshot.warningActive, "Warning state should clear.");
  });

  test("invalid task declarations are rejected before simulation starts", () => {
    const clock = new GameClock();
    expectCode(() => new SimulationScheduler({
      clock, systemOrder: ["a"], tasks: [{ systemId: "missing", update() {} }]
    }), "UNKNOWN_TASK_SYSTEM");
    expectCode(() => new SimulationScheduler({
      clock, systemOrder: ["a"], tasks: [{ systemId: "a", everyTicks: 0, update() {} }]
    }), "INVALID_TASK_FREQUENCY");
    expectCode(() => new SimulationScheduler({
      clock, systemOrder: ["a", "a"]
    }), "DUPLICATE_SYSTEM_ORDER");
  });

  test("a task failure faults and pauses the scheduler without committing the failed step", () => {
    const clock = new GameClock();
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: ["broken"],
      tasks: [{ systemId: "broken", update() { throw new Error("sim failure"); } }]
    });
    expectCode(() => scheduler.advance(0.05), "SIMULATION_STEP_FAILED");
    assert(scheduler.snapshot.faulted, "Scheduler should be faulted.");
    assert(clock.paused && clock.hasPauseReason("scheduler-fault"), "Clock should carry a fault pause.");
    equal(clock.totalSeconds, 0, "Failed step must not commit strategic time.");
    equal(scheduler.snapshot.backlogSeconds, 6, "Failed step time remains uncommitted.");
    expectCode(() => scheduler.advance(0), "SCHEDULER_FAULTED");
  });

  test("async simulation tasks are rejected", () => {
    const clock = new GameClock();
    const scheduler = new SimulationScheduler({
      clock,
      systemOrder: ["async"],
      tasks: [{ systemId: "async", update: () => Promise.resolve() }]
    });
    expectCode(() => scheduler.advance(0.05), "ASYNC_TASK_NOT_SUPPORTED");
    assert(scheduler.snapshot.faulted, "Async task should fault scheduler.");
  });

  test("reentrant advance calls are rejected and fault the active step", () => {
    const clock = new GameClock();
    let scheduler;
    scheduler = new SimulationScheduler({
      clock,
      systemOrder: ["recursive"],
      tasks: [{ systemId: "recursive", update: () => scheduler.advance(0) }]
    });
    expectCode(() => scheduler.advance(0.05), "REENTRANT_ADVANCE");
    assert(scheduler.snapshot.faulted, "Reentrant execution should fault scheduler.");
  });

  test("zero real delta can drain an existing backlog without adding time", () => {
    const clock = new GameClock();
    const scheduler = new SimulationScheduler({ clock, systemOrder: [], maxStepsPerFrame: 1 });
    scheduler.advance(0.1);
    const before = scheduler.snapshot.backlogSeconds;
    scheduler.advance(0);
    equal(scheduler.snapshot.backlogSeconds, before - 6, "Zero-delta call should only process pending time.");
  });

  return results;
}
