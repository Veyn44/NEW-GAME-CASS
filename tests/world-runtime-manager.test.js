import { WorldRegistry } from "../engine/core/world-registry.js";
import { WorldRuntimeError, WorldRuntimeManager } from "../engine/core/world-runtime-manager.js";

const tests = [];
function test(name, run) { tests.push({ name, run }); }
function assert(value, message = "Expected condition to be true") { if (!value) throw new Error(message); }
function equal(actual, expected, message = "Values differ") {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
function throwsCode(run, code) {
  try { run(); } catch (error) {
    if (!(error instanceof WorldRuntimeError)) throw new Error(`Expected WorldRuntimeError, got ${error?.constructor?.name}`);
    equal(error.code, code);
    return error;
  }
  throw new Error(`Expected error ${code}`);
}
function setup() {
  const worlds = new WorldRegistry();
  worlds.registerWorld({ worldId: "world:alpha", type: "test.world", dimensions: { width: 10, height: 10 } });
  worlds.registerWorld({ worldId: "world:beta", type: "test.world", dimensions: { width: 10, height: 10 } });
  return { worlds, runtime: new WorldRuntimeManager({ worldRegistry: worlds }) };
}
function ready(runtime, worldId) {
  runtime.beginLoading(worldId);
  runtime.markReady(worldId);
}

export function runWorldRuntimeManagerTests() {
  const results = [];
  const check = (name, run) => {
    try { run(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };

  check("registered worlds begin Unloaded and simulation-disabled", () => {
    const { runtime } = setup();
    const state = runtime.getState("world:alpha");
    equal(state.status, "Unloaded");
    equal(state.simulationEnabled, false);
    equal(state.simulatedSeconds, 0);
    equal(state.completedSteps, 0);
  });

  check("world readiness requires the Loading transition", () => {
    const { runtime } = setup();
    throwsCode(() => runtime.markReady("world:alpha"), "INVALID_WORLD_TRANSITION");
    runtime.beginLoading("world:alpha");
    equal(runtime.markReady("world:alpha").status, "Ready");
  });

  check("simulation cannot be enabled before readiness", () => {
    const { runtime } = setup();
    throwsCode(() => runtime.setSimulationEnabled("world:alpha", true), "WORLD_NOT_READY");
    ready(runtime, "world:alpha");
    equal(runtime.setSimulationEnabled("world:alpha", true).simulationEnabled, true);
  });

  check("participation is independent from the World Registry active selection", () => {
    const { worlds, runtime } = setup();
    ready(runtime, "world:alpha");
    ready(runtime, "world:beta");
    runtime.setSimulationEnabled("world:alpha", true);
    runtime.setSimulationEnabled("world:beta", true);
    worlds.activateWorld("world:alpha");
    equal(runtime.getParticipants().length, 2);
    worlds.activateWorld("world:beta");
    equal(runtime.getParticipants().length, 2);
  });

  check("world-local pause reasons compose independently", () => {
    const { runtime } = setup();
    ready(runtime, "world:alpha");
    runtime.setSimulationEnabled("world:alpha", true);
    runtime.pause("world:alpha", "weather-event");
    runtime.pause("world:alpha", "host-maintenance");
    runtime.resume("world:alpha", "weather-event");
    equal(runtime.getParticipants().length, 0);
    runtime.resume("world:alpha", "host-maintenance");
    equal(runtime.getParticipants().length, 1);
  });

  check("participants use canonical world-ID order independent of registration order", () => {
    const worlds = new WorldRegistry();
    for (const worldId of ["world:zeta", "world:alpha", "world:middle"]) {
      worlds.registerWorld({ worldId, type: "test.world", dimensions: { width: 10, height: 10 } });
    }
    const runtime = new WorldRuntimeManager({ worldRegistry: worlds });
    for (const worldId of ["world:zeta", "world:middle", "world:alpha"]) {
      ready(runtime, worldId);
      runtime.setSimulationEnabled(worldId, true);
    }
    equal(runtime.getParticipants().map((entry) => entry.worldId).join(","), "world:alpha,world:middle,world:zeta");
  });

  check("only the participant snapshot advances local time and completed steps", () => {
    const { runtime } = setup();
    ready(runtime, "world:alpha");
    ready(runtime, "world:beta");
    runtime.setSimulationEnabled("world:alpha", true);
    const participants = runtime.getParticipants();
    equal(runtime.commitStep(participants, 6), 1);
    equal(runtime.getState("world:alpha").simulatedSeconds, 6);
    equal(runtime.getState("world:alpha").completedSteps, 1);
    equal(runtime.getState("world:beta").simulatedSeconds, 0);
  });

  check("stale and duplicate participant snapshots are rejected before any time is committed", () => {
    const { runtime } = setup();
    ready(runtime, "world:alpha");
    ready(runtime, "world:beta");
    runtime.setSimulationEnabled("world:alpha", true);
    runtime.setSimulationEnabled("world:beta", true);
    const participants = runtime.getParticipants();
    runtime.commitStep([participants[0]], 6);
    throwsCode(() => runtime.commitStep(participants, 6), "STALE_PARTICIPANT_SNAPSHOT");
    equal(runtime.getState("world:beta").simulatedSeconds, 0);
  });

  check("unloading disables participation and disposed worlds can be loaded again", () => {
    const { runtime } = setup();
    ready(runtime, "world:alpha");
    runtime.setSimulationEnabled("world:alpha", true);
    runtime.beginDisposal("world:alpha");
    equal(runtime.getParticipants().length, 0);
    runtime.finishDisposal("world:alpha");
    equal(runtime.getState("world:alpha").status, "Disposed");
    runtime.beginLoading("world:alpha");
    runtime.markReady("world:alpha");
    equal(runtime.getState("world:alpha").status, "Ready");
  });

  check("runtime snapshot restores time but never readiness or participation", () => {
    const { worlds, runtime } = setup();
    ready(runtime, "world:alpha");
    runtime.setSimulationEnabled("world:alpha", true);
    runtime.commitStep(runtime.getParticipants(), 12);
    const snapshot = runtime.captureSnapshot();
    const restored = new WorldRuntimeManager({ worldRegistry: worlds });
    const transaction = restored.prepareRestore(snapshot);
    transaction.commit();
    const state = restored.getState("world:alpha");
    equal(state.simulatedSeconds, 12);
    equal(state.completedSteps, 1);
    equal(state.status, "Unloaded");
    equal(state.simulationEnabled, false);
  });

  check("runtime restore rolls back when a later persistence participant fails", () => {
    const { worlds, runtime } = setup();
    ready(runtime, "world:alpha");
    runtime.setSimulationEnabled("world:alpha", true);
    runtime.commitStep(runtime.getParticipants(), 6);
    const snapshot = runtime.captureSnapshot();
    const transaction = runtime.prepareRestore(snapshot);
    runtime.setSimulationEnabled("world:alpha", false);
    transaction.commit();
    transaction.rollback();
    equal(runtime.getState("world:alpha").simulationEnabled, false);
    equal(runtime.getState("world:alpha").simulatedSeconds, 6);
  });

  check("restore rejects world-time records that do not match registered worlds", () => {
    const { runtime } = setup();
    throwsCode(() => runtime.prepareRestore({ version: 1, worlds: [{ worldId: "world:missing", simulatedSeconds: 0, completedSteps: 0 }] }).commit(),
      "WORLD_RUNTIME_REGISTRY_MISMATCH");
  });

  check("closed and unknown worlds cannot enter runtime", () => {
    const { worlds, runtime } = setup();
    worlds.closeWorld("world:alpha");
    throwsCode(() => runtime.beginLoading("world:alpha"), "WORLD_CLOSED");
    throwsCode(() => runtime.beginLoading("world:missing"), "UNKNOWN_WORLD");
  });

  return results;
}
