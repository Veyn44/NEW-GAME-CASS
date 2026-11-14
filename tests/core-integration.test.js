import { createCoreAssembly } from "./fixtures/create-demo-assembly.js";
import { createCoreAssembly as createEngineCoreAssembly } from "../engine/core/core-assembly.js";

const tests = [];
function test(name, run) { tests.push({ name, run }); }
function assert(value, message = "Expected condition to be true") { if (!value) throw new Error(message); }
function equal(actual, expected, message = "Values differ") {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}
async function rejects(run, code) {
  try { await run(); } catch (error) {
    if (code && error.code !== code) throw new Error(`Expected error code ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  throw new Error("Expected operation to reject.");
}

test("Core Assembly requires an explicit persistence adapter", async () => {
  let error = null;
  try { createEngineCoreAssembly(); } catch (caught) { error = caught; }
  assert(error instanceof TypeError, "Core Assembly silently selected an in-memory persistence adapter.");
  assert(error.message.includes("saveAdapter"), "Missing adapter error should explain the required contract.");
});

test("Core Assembly forwards host clock conversion and speed configuration", async () => {
  const runtime = createCoreAssembly({
    dayLengthRealSeconds: 3600,
    strategicSecondsPerDay: 7200,
    initialSpeed: 2,
    minimumSpeed: 0.5,
    maximumSpeed: 4
  });
  const context = await runtime.start();
  const clock = context.getService("core.game-clock");
  equal(clock.dayLengthRealSeconds, 3600);
  equal(clock.strategicSecondsPerDay, 7200);
  equal(clock.scaleRealDelta(1), 4);
  await runtime.destroy();
});

test("bootstrap publishes every declared Core service", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  for (const serviceId of Object.values(runtime.services)) assert(context.hasService(serviceId), `Missing ${serviceId}`);
  equal(runtime.state, "running");
  await runtime.destroy();
});

test("dependency order initializes providers before consumers", async () => {
  const runtime = createCoreAssembly();
  await runtime.start();
  const order = runtime.initializationOrder;
  assert(order.indexOf("core.logger") < order.indexOf("core.event-bus"));
  assert(order.indexOf("core.entity-registry") < order.indexOf("core.world-context"));
  assert(order.indexOf("core.world-context") < order.indexOf("core.persistence"));
  await runtime.destroy();
});

test("host simulation tasks follow the validated host-system dependency order", async () => {
  const calls = [];
  const runtime = createCoreAssembly({
    hostSystems: [
      {
        id: "game.consumer",
        provides: ["game.consumer-api"],
        requires: ["game.provider-api"],
        initialize(context) {
          assert(context.hasService("game.provider-api"), "Provider service was not published before consumer initialization.");
          return { "game.consumer-api": Object.freeze({ ready: true }) };
        }
      },
      {
        id: "game.provider",
        provides: ["game.provider-api"],
        initialize() { return { "game.provider-api": Object.freeze({ ready: true }) }; }
      }
    ],
    simulationTasks: [
      { systemId: "game.consumer", update() { calls.push("consumer"); } },
      { systemId: "game.provider", update() { calls.push("provider"); } }
    ]
  });
  const context = await runtime.start();
  context.getService("core.scheduler").advance(0.05);
  equal(calls.join(","), "provider,consumer");
  await runtime.destroy();
});

test("demo system creates an entity with an exclusive world placement", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const entityId = context.getService("core.demo-api").entityId;
  equal(context.getService("core.entity-registry").get(entityId).kind, "pawn");
  equal(context.getService("core.world-context").getPlacement(entityId).worldId, "world:cassandra");
  await runtime.destroy();
});

test("scheduler advances strategic time and delivers its event synchronously", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const clock = context.getService("core.game-clock");
  const demo = context.getService("core.demo-api");
  const scheduler = context.getService("core.scheduler");
  scheduler.advance(0.05);
  equal(clock.totalSeconds, 6, `Clock mismatch; clock=${JSON.stringify(clock.snapshot())}; scheduler=${JSON.stringify(scheduler.snapshot)}`);
  equal(demo.receivedSteps, 1);
  await runtime.destroy();
});

test("invalid service lookup remains an explicit error", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  await rejects(() => Promise.resolve(context.getService("core.not-registered")));
  await runtime.destroy();
});

test("persistence round-trip restores entity identity and placement", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const entities = context.getService("core.entity-registry");
  const worlds = context.getService("core.world-registry");
  const placements = context.getService("core.world-context");
  const persistence = context.getService("core.persistence");
  const id = "entity:integration-pawn";
  await persistence.save("integration-slot", { stateId: "campaign:integration" });
  placements.removePlacement(id);
  entities.remove(id);
  worlds.deactivateWorld("world:cassandra");
  await persistence.load("integration-slot", { stateId: "campaign:integration" });
  assert(entities.has(id));
  equal(placements.getPlacement(id).worldId, "world:cassandra");
  equal(worlds.activeWorldId, "world:cassandra");
  await runtime.destroy();
});

test("save failure leaves the previous valid save intact", async () => {
  let failWrite = false;
  const adapter = {
    slot: null,
    async read() { return this.slot; },
    async writeAtomic(_slot, value) {
      if (failWrite) throw new Error("injected storage failure");
      this.slot = value;
    }
  };
  const runtime = createCoreAssembly({ saveAdapter: adapter });
  const context = await runtime.start();
  const persistence = context.getService("core.persistence");
  await persistence.save("atomic-slot", { stateId: "campaign:atomic" });
  const previous = adapter.slot;
  failWrite = true;
  await rejects(() => persistence.save("atomic-slot", { stateId: "campaign:atomic" }));
  equal(adapter.slot, previous, "Previous save was replaced after failed write");
  await runtime.destroy();
});

test("restore transaction stages worlds before validating entity placements", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const persistence = context.getService("core.persistence");
  const worlds = context.getService("core.world-registry");
  await persistence.save("restore-slot", { stateId: "campaign:restore" });
  worlds.prepareRestore({ version: 2, activeWorldId: null, worlds: [] }).commit();
  await persistence.load("restore-slot", { stateId: "campaign:restore" });
  assert(worlds.get("world:cassandra"), "Saved world was not restored before placement validation.");
  assert(context.getService("core.entity-registry").has("entity:integration-pawn"));
  equal(context.getService("core.world-context").getPlacement("entity:integration-pawn").worldId, "world:cassandra");
  await runtime.destroy();
});

test("Persistence migrates version-one entity and world snapshots during a real load", async () => {
  const adapter = {
    slot: null,
    async read() { return this.slot; },
    async writeAtomic(_slot, value) { this.slot = value; }
  };
  const runtime = createCoreAssembly({ saveAdapter: adapter });
  const context = await runtime.start();
  const persistence = context.getService("core.persistence");
  await persistence.save("legacy-slot", { stateId: "campaign:legacy" });

  const saved = adapter.slot;
  const entitySnapshot = saved.snapshots["core.entity-registry"];
  const worldSnapshot = saved.snapshots["core.world-registry"];
  const persistentRecords = entitySnapshot.entities.map((record) => ({
    id: record.id, kind: record.kind, scope: "persistent",
    encounterId: null, originEncounterId: null,
    status: record.status, metadata: record.metadata
  }));
  persistentRecords.push({
    id: "encounter:legacy:1", kind: "enemy", scope: "encounter",
    encounterId: "legacy", originEncounterId: "legacy",
    status: "active", metadata: { health: 25 }
  });
  const legacyWorld = worldSnapshot.worlds[0];
  const { metadata: _metadata, ...worldRecord } = legacyWorld;
  adapter.slot = {
    ...saved,
    schemas: { ...saved.schemas, "core.entity-registry": 1, "core.world-registry": 1 },
    snapshots: {
      ...saved.snapshots,
      "core.entity-registry": { version: 1, entities: persistentRecords },
      "core.world-registry": {
        version: 1,
        activeWorldId: worldSnapshot.activeWorldId,
        worlds: [{ ...worldRecord, locationId: "asteroid:legacy", encounterId: "encounter:legacy" }]
      }
    }
  };

  await persistence.load("legacy-slot", { stateId: "campaign:legacy" });
  const entities = context.getService("core.entity-registry");
  const worlds = context.getService("core.world-registry");
  equal(entities.get("encounter:legacy:1").scope, "scoped");
  equal(entities.get("encounter:legacy:1").scopeId, "legacy");
  equal(worlds.get("world:cassandra").metadata.locationId, "asteroid:legacy");
  equal(worlds.get("world:cassandra").metadata.encounterId, "encounter:legacy");
  await runtime.destroy();
});

test("persistence participant set includes identity, world and placement owners", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const persistence = context.getService("core.persistence");
  for (const id of ["core.entity-registry", "core.world-registry", "core.world-context"]) {
    assert(persistence.participantIds.includes(id), `Missing participant ${id}`);
  }
  await runtime.destroy();
});


test("failed system startup destroys initialized systems and leaves no running runtime", async () => {
  let destroyed = false;
  const runtime = createCoreAssembly({
    demoSystem: {
      start() { throw new Error("injected startup failure"); },
      destroy() { destroyed = true; }
    }
  });
  await rejects(() => runtime.start());
  equal(runtime.state, "failed");
  assert(destroyed, "Initialized demo system was not destroyed after startup failure");
});

test("invalid world transfer leaves the previous placement unchanged", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const placements = context.getService("core.world-context");
  const before = placements.getPlacement("entity:integration-pawn");
  let error = null;
  try {
    placements.moveEntity("entity:integration-pawn", {
      type: "world", worldId: "world:missing", position: { x: 4, y: 5 }
    });
  } catch (caught) { error = caught; }
  assert(error, "Invalid transfer unexpectedly succeeded");
  equal(placements.getPlacement("entity:integration-pawn"), before);
  await runtime.destroy();
});

test("failed restore commit rolls back earlier Core participants", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const persistence = context.getService("core.persistence");
  const placements = context.getService("core.world-context");
  let rollbackCalled = false;
  persistence.registerParticipant({
    id: "test.integration-failure",
    schemaVersion: 1,
    order: 100,
    captureSnapshot: () => ({ marker: "saved" }),
    prepareRestore: () => ({
      commit() { throw new Error("injected participant commit failure"); },
      rollback() { rollbackCalled = true; }
    })
  });
  await persistence.save("rollback-slot", { stateId: "campaign:rollback" });
  placements.moveEntity("entity:integration-pawn", {
    type: "world", worldId: "world:cassandra", position: { x: 40, y: 41 }
  });
  await rejects(() => persistence.load("rollback-slot", { stateId: "campaign:rollback" }));
  assert(rollbackCalled, "Failing participant did not receive rollback");
  equal(placements.getPlacement("entity:integration-pawn").position.x, 40);
  equal(placements.getPlacement("entity:integration-pawn").position.y, 41);
  await runtime.destroy();
});

test("pause and resume stop and restart Scheduler time through the Game Clock", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const clock = context.getService("core.game-clock");
  const scheduler = context.getService("core.scheduler");
  await runtime.pause();
  equal(runtime.state, "paused");
  assert(clock.paused, "Bootstrap pause did not pause the authoritative Game Clock");
  assert(clock.hasPauseReason("bootstrap-lifecycle"), "Lifecycle pause reason was not registered");
  const pausedTick = scheduler.tick;
  const pausedTime = clock.totalSeconds;
  scheduler.advance(12);
  equal(scheduler.tick, pausedTick, "Scheduler advanced while Bootstrap was paused");
  equal(clock.totalSeconds, pausedTime, "Strategic time advanced while Bootstrap was paused");
  await runtime.resume();
  equal(runtime.state, "running");
  assert(!clock.hasPauseReason("bootstrap-lifecycle"), "Lifecycle pause reason was not removed on resume");
  scheduler.advance(0.05);
  equal(scheduler.tick, pausedTick + 1);
  equal(clock.totalSeconds, pausedTime + 6);
  await runtime.destroy();
});

test("Bootstrap resume preserves an independent Game Clock pause reason", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const clock = context.getService("core.game-clock");
  const scheduler = context.getService("core.scheduler");
  clock.pause("manual");
  await runtime.pause();
  await runtime.resume();
  assert(clock.paused, "Bootstrap resume incorrectly cleared an independent pause");
  scheduler.advance(0.05);
  equal(scheduler.tick, 0);
  clock.resume("manual");
  scheduler.advance(0.05);
  equal(scheduler.tick, 1);
  await runtime.destroy();
});

test("asynchronous demo update is rejected before publishing a successful simulation step", async () => {
  const runtime = createCoreAssembly({
    demoSystem: { update() { return Promise.resolve(); } }
  });
  const context = await runtime.start();
  const clock = context.getService("core.game-clock");
  const scheduler = context.getService("core.scheduler");
  const demo = context.getService("core.demo-api");
  let publishedSteps = 0;
  context.getService("core.event-bus").subscribe("core.simulation-step", "core.scheduler", () => { publishedSteps += 1; });
  let error = null;
  try { scheduler.advance(0.05); } catch (caught) { error = caught; }
  assert(error, "Asynchronous demo update was not rejected");
  equal(error.code, "SIMULATION_STEP_FAILED");
  equal(scheduler.snapshot.faulted, true);
  equal(scheduler.tick, 0);
  equal(clock.totalSeconds, 0);
  equal(demo.receivedSteps, 0);
  equal(publishedSteps, 0);
  await runtime.destroy();
});

test("an externally faulted Event Bus stops host simulation before the next update", async () => {
  let updates = 0;
  const runtime = createCoreAssembly({
    hostSystems: [{ id: "game.probe", provides: ["game.probe-api"], initialize() { return { "game.probe-api": {} }; } }],
    simulationTasks: [{ systemId: "game.probe", update() { updates += 1; } }]
  });
  const context = await runtime.start();
  const events = context.getService("core.event-bus");
  const scheduler = context.getService("core.scheduler");
  events.subscribe("core.async-host-event", "game.probe", () => Promise.resolve());
  let eventError;
  try { events.publish({ type: "core.async-host-event", source: "game.probe", payload: {} }); }
  catch (error) { eventError = error; }
  assert(eventError?.code === "ASYNC_HANDLER_NOT_SUPPORTED");
  let stepError;
  try { scheduler.advance(0.05); } catch (error) { stepError = error; }
  assert(stepError?.code === "SIMULATION_STEP_FAILED", "Scheduler did not fault after Event Bus failure.");
  equal(updates, 0, "Host simulation ran after Event Bus had faulted.");
  assert(scheduler.snapshot.faulted, "Scheduler should be faulted.");
  await runtime.destroy();
});

test("overlapping Persistence requests are serialized under one continuous simulation pause", async () => {
  let releaseFirstWrite;
  const firstWriteBlock = new Promise((resolve) => { releaseFirstWrite = resolve; });
  let firstWriteStarted = false;
  const writes = [];
  const adapter = {
    async read() { return null; },
    async writeAtomic(slotId) {
      writes.push(slotId);
      if (slotId === "save-one") {
        firstWriteStarted = true;
        await firstWriteBlock;
        throw new Error("simulated first-slot storage failure");
      }
      return true;
    }
  };
  const runtime = createCoreAssembly({ saveAdapter: adapter });
  const context = await runtime.start();
  const clock = context.getService("core.game-clock");
  const scheduler = context.getService("core.scheduler");
  const persistence = context.getService("core.persistence");

  const firstSave = persistence.save("save-one", { stateId: "campaign:one" });
  while (!firstWriteStarted) await Promise.resolve();
  const secondSave = persistence.save("save-two", { stateId: "campaign:two" });
  await Promise.resolve();

  equal(writes.length, 1, "The second storage write started before the first transaction finished.");
  assert(clock.hasPauseReason("core.persistence"), "The shared persistence pause was not held.");
  scheduler.advance(0.05);
  equal(scheduler.tick, 0, "Simulation advanced during overlapping persistence requests.");

  releaseFirstWrite();
  const outcomes = await Promise.allSettled([firstSave, secondSave]);
  equal(outcomes[0].status, "rejected", "The simulated first save failure was not reported.");
  equal(outcomes[0].reason?.code, "SAVE_FAILED", "The first save failure lost its Persistence error code.");
  equal(outcomes[1].status, "fulfilled", "A failed first save prevented the queued second save from running.");
  equal(writes.length, 2);
  assert(!clock.hasPauseReason("core.persistence"), "The persistence pause remained after the queue drained.");
  scheduler.advance(0.05);
  equal(scheduler.tick, 1, "Simulation did not resume after all persistence requests completed.");
  await runtime.destroy();
});

test("Persistence holds an independent simulation pause across asynchronous storage writes", async () => {
  let releaseWrite;
  const blockedWrite = new Promise((resolve) => { releaseWrite = resolve; });
  let writeStarted = false;
  let stored = null;
  const adapter = {
    async read() { return stored; },
    async writeAtomic(_slotId, saveData) {
      writeStarted = true;
      await blockedWrite;
      stored = saveData;
      return true;
    }
  };
  const runtime = createCoreAssembly({ saveAdapter: adapter });
  const context = await runtime.start();
  const clock = context.getService("core.game-clock");
  const scheduler = context.getService("core.scheduler");
  const persistence = context.getService("core.persistence");

  clock.pause("manual");
  const savePromise = persistence.save("slow-storage", { stateId: "campaign:boundary" });
  while (!writeStarted) await Promise.resolve();

  assert(clock.hasPauseReason("core.persistence"), "Persistence did not hold its clock pause during storage I/O.");
  assert(clock.hasPauseReason("manual"), "Persistence removed an unrelated manual pause.");
  scheduler.advance(0.05);
  equal(scheduler.tick, 0, "Simulation advanced while the save transaction was pending.");

  releaseWrite();
  await savePromise;
  assert(!clock.hasPauseReason("core.persistence"), "Persistence pause reason was not released after saving.");
  assert(clock.hasPauseReason("manual"), "Manual pause was not preserved after saving.");

  clock.resume("manual");
  scheduler.advance(0.05);
  equal(scheduler.tick, 1, "Simulation did not resume after the save completed.");
  await runtime.destroy();
});

test("Persistence remains blocked after an asynchronous Event Bus handler faults the bus", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const events = context.getService("core.event-bus");
  const persistence = context.getService("core.persistence");
  events.subscribe("core.async-handler-probe", "core.scheduler", () => Promise.resolve());
  let eventError = null;
  try { events.publish({ type: "core.async-handler-probe", source: "core.scheduler", payload: {} }); }
  catch (error) { eventError = error; }
  assert(eventError?.code === "ASYNC_HANDLER_NOT_SUPPORTED", "Async event handler was not rejected.");
  await rejects(() => persistence.save("faulted-event-bus", { stateId: "campaign:event-fault" }), "UNSAFE_BOUNDARY");
  await runtime.destroy();
});

test("Persistence rejects saves inside updates and Event Bus handlers but permits a save after delivery", async () => {
  let updateSave;
  const runtime = createCoreAssembly({
    demoSystem: {
      update() { updateSave = runtimeContext.getService("core.persistence").save("inside-update", { stateId: "campaign:boundary" }); }
    }
  });
  let runtimeContext;
  runtimeContext = await runtime.start();
  const context = runtimeContext;
  const persistence = context.getService("core.persistence");
  const events = context.getService("core.event-bus");
  const scheduler = context.getService("core.scheduler");

  scheduler.advance(0.05);
  const updateError = await rejects(() => updateSave, "UNSAFE_BOUNDARY");
  assert(updateError.message.includes("simulation step"));

  let handlerSave;
  const unsubscribe = events.subscribe("core.integration-boundary-probe", "core.scheduler", () => {
    handlerSave = persistence.save("inside-handler", { stateId: "campaign:boundary" });
  });
  events.publish({ type: "core.integration-boundary-probe", source: "core.demo-system", payload: {} });
  unsubscribe();
  const handlerError = await rejects(() => handlerSave, "UNSAFE_BOUNDARY");
  assert(handlerError.message.includes("Event Bus delivery"));

  await persistence.save("after-boundary", { stateId: "campaign:boundary" });
  await runtime.destroy();
});


test("Core shutdown waits for accepted persistence work and rejects new requests", async () => {
  let releaseWrite;
  const blockedWrite = new Promise((resolve) => { releaseWrite = resolve; });
  let writeStarted = false;
  let systemDestroyed = false;
  const adapter = {
    async read() { return null; },
    async writeAtomic() {
      writeStarted = true;
      await blockedWrite;
      return true;
    }
  };
  const runtime = createCoreAssembly({
    saveAdapter: adapter,
    hostSystems: [{
      id: "game.shutdown-probe",
      destroy() { systemDestroyed = true; }
    }]
  });
  const context = await runtime.start();
  const persistence = context.getService("core.persistence");
  const clock = context.getService("core.game-clock");

  const savePromise = persistence.save("shutdown-slot", { stateId: "campaign:shutdown" });
  while (!writeStarted) await Promise.resolve();

  let shutdownFinished = false;
  const shutdownPromise = runtime.destroy().then(() => { shutdownFinished = true; });
  await Promise.resolve();
  assert(!shutdownFinished, "Core shutdown completed while accepted storage I/O was still active.");
  assert(!systemDestroyed, "Host systems were destroyed while persistence still used Core state.");
  assert(clock.hasPauseReason("core.persistence"), "Persistence pause was released before storage completed.");

  await rejects(() => persistence.save("late-slot", { stateId: "campaign:late" }), "RUNTIME_DESTROYING");
  releaseWrite();
  await savePromise;
  await shutdownPromise;

  assert(shutdownFinished, "Core shutdown did not finish after persistence drained.");
  assert(systemDestroyed, "Host systems were not destroyed after persistence completed.");
  assert(!clock.hasPauseReason("core.persistence"), "Persistence pause remained after shutdown.");
  equal(runtime.state, "destroyed");
  await runtime.destroy();
});


test("Core lifecycle transitions are serialized before shutdown", async () => {
  let releasePause;
  const pauseBlock = new Promise((resolve) => { releasePause = resolve; });
  let pauseStarted = false;
  let destroyed = false;
  const runtime = createCoreAssembly({
    hostSystems: [{
      id: "game.lifecycle-race",
      async pause() {
        pauseStarted = true;
        await pauseBlock;
      },
      destroy() { destroyed = true; }
    }]
  });
  await runtime.start();

  const pausePromise = runtime.pause();
  while (!pauseStarted) await Promise.resolve();
  let shutdownFinished = false;
  const shutdownPromise = runtime.destroy().then(() => { shutdownFinished = true; });
  await Promise.resolve();

  assert(!shutdownFinished, "Shutdown overtook an active lifecycle transition.");
  assert(!destroyed, "System was destroyed while its pause hook was still running.");
  releasePause();
  await pausePromise;
  await shutdownPromise;

  assert(destroyed, "System was not destroyed after the lifecycle queue drained.");
  equal(runtime.state, "destroyed");
});

test("cross-registry reference failure rolls back entity counters, worlds and placements", async () => {
  const adapter = {
    slot: null,
    async read() { return this.slot; },
    async writeAtomic(_slot, value) { this.slot = value; }
  };
  const runtime = createEngineCoreAssembly({ saveAdapter: adapter });
  const context = await runtime.start();
  const entities = context.getService("core.entity-registry");
  const worlds = context.getService("core.world-registry");
  const placements = context.getService("core.world-context");
  const persistence = context.getService("core.persistence");

  const entity = entities.registerScoped({ scopeId: "campaign", localId: "7", kind: "probe" });
  worlds.registerWorld({
    worldId: "world:rollback-original",
    type: "test.world",
    dimensions: { width: 100, height: 100 }
  });
  worlds.activateWorld("world:rollback-original");
  placements.placeEntity(entity.id, "world:rollback-original", { x: 2, y: 3 });
  await persistence.save("cross-registry-rollback", { stateId: "campaign:cross-registry" });

  // Establish a distinct live state and a higher scoped-ID counter.
  entities.registerScoped({ scopeId: "campaign", localId: "20", kind: "probe" });
  worlds.registerWorld({
    worldId: "world:runtime",
    type: "test.world",
    dimensions: { width: 100, height: 100 }
  });
  worlds.activateWorld("world:runtime");
  placements.moveEntity(entity.id, {
    type: "world", worldId: "world:runtime", position: { x: 5, y: 6 }
  });

  // This snapshot is structurally valid. Its missing entity reference is
  // intentionally detected only when World Context commits after the
  // Entity and World Registry participants have committed.
  const saved = adapter.slot;
  adapter.slot = {
    ...saved,
    snapshots: {
      ...saved.snapshots,
      "core.world-context": {
        ...saved.snapshots["core.world-context"],
        placements: [{
          entityId: "entity:missing-cross-reference",
          type: "world",
          worldId: "world:rollback-original",
          position: { x: 1, y: 1 }
        }]
      }
    }
  };

  await rejects(
    () => persistence.load("cross-registry-rollback", { stateId: "campaign:cross-registry" }),
    "RESTORE_COMMIT_FAILED"
  );

  assert(entities.has("scope:campaign:20"), "Entity rollback did not restore the live registry state.");
  equal(worlds.activeWorldId, "world:runtime", "World rollback did not restore the active world.");
  assert(worlds.has("world:runtime"), "World rollback lost a live world.");
  equal(placements.getPlacement(entity.id).worldId, "world:runtime", "Placement rollback did not restore the live placement.");

  const next = entities.registerScoped({ scopeId: "campaign", kind: "probe" });
  equal(next.id, "scope:campaign:21", "Entity rollback did not restore the exact scoped-ID counter.");
  await runtime.destroy();
});

export async function runCoreIntegrationTests() {
  let passed = 0;
  const lines = [];
  for (const item of tests) {
    try { await item.run(); passed += 1; lines.push(`PASS ${item.name}`); }
    catch (error) { lines.push(`FAIL ${item.name}: ${error.message}`); }
  }
  lines.push(`RESULT ${passed}/${tests.length} passed`);
  if (typeof document !== "undefined") document.querySelector("#results").textContent = lines.join("\n");
  return tests.map((item, index) => ({ name: item.name, passed: lines[index].startsWith("PASS "), error: lines[index].startsWith("FAIL ") ? lines[index].slice(lines[index].indexOf(": ") + 2) : null }));
}
if (typeof document !== "undefined") {
  document.querySelector("#run")?.addEventListener("click", async () => {
    const results = await runCoreIntegrationTests();
    document.querySelector("#results").textContent = results.map((item) => `${item.passed ? "PASS" : "FAIL"} ${item.name}${item.error ? `: ${item.error}` : ""}`).join("\\n");
  });
  document.querySelector("#results").textContent = "Ready. Press Run tests.";
}
