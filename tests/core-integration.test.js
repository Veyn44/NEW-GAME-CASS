import { createCoreAssembly } from "../src/core/core-assembly.js";

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
  scheduler.advance(6);
  equal(clock.totalSeconds, 6);
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
  await persistence.save("integration-slot", { campaignId: "campaign:integration" });
  placements.removePlacement(id);
  entities.remove(id);
  worlds.deactivateWorld("world:cassandra");
  await persistence.load("integration-slot", { campaignId: "campaign:integration" });
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
  await persistence.save("atomic-slot", { campaignId: "campaign:atomic" });
  const previous = adapter.slot;
  failWrite = true;
  await rejects(() => persistence.save("atomic-slot", { campaignId: "campaign:atomic" }));
  equal(adapter.slot, previous, "Previous save was replaced after failed write");
  await runtime.destroy();
});

test("restore preparation rejects a missing required world without partial commit", async () => {
  const runtime = createCoreAssembly();
  const context = await runtime.start();
  const persistence = context.getService("core.persistence");
  const worlds = context.getService("core.world-registry");
  await persistence.save("restore-slot", { campaignId: "campaign:restore" });
  worlds.prepareRestore({ version: 1, activeWorldId: null, worlds: [] }).commit();
  await rejects(() => persistence.load("restore-slot", { campaignId: "campaign:restore" }));
  equal(worlds.get("world:cassandra"), null);
  assert(context.getService("core.entity-registry").has("entity:integration-pawn"));
  equal(context.getService("core.world-context").getPlacement("entity:integration-pawn").worldId, "world:cassandra");
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
  await persistence.save("rollback-slot", { campaignId: "campaign:rollback" });
  placements.moveEntity("entity:integration-pawn", {
    type: "world", worldId: "world:cassandra", position: { x: 40, y: 41 }
  });
  await rejects(() => persistence.load("rollback-slot", { campaignId: "campaign:rollback" }));
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
  scheduler.advance(6);
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
  scheduler.advance(6);
  equal(scheduler.tick, 0);
  clock.resume("manual");
  scheduler.advance(6);
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
  try { scheduler.advance(6); } catch (caught) { error = caught; }
  assert(error, "Asynchronous demo update was not rejected");
  equal(error.code, "SIMULATION_STEP_FAILED");
  equal(scheduler.snapshot.faulted, true);
  equal(scheduler.tick, 0);
  equal(clock.totalSeconds, 0);
  equal(demo.receivedSteps, 0);
  equal(publishedSteps, 0);
  await runtime.destroy();
});

test("Persistence rejects saves inside updates and Event Bus handlers but permits a save after delivery", async () => {
  let updateSave;
  const runtime = createCoreAssembly({
    demoSystem: {
      update() { updateSave = runtimeContext.getService("core.persistence").save("inside-update", { campaignId: "campaign:boundary" }); }
    }
  });
  let runtimeContext;
  runtimeContext = await runtime.start();
  const context = runtimeContext;
  const persistence = context.getService("core.persistence");
  const events = context.getService("core.event-bus");
  const scheduler = context.getService("core.scheduler");

  scheduler.advance(6);
  const updateError = await rejects(() => updateSave, "UNSAFE_BOUNDARY");
  assert(updateError.message.includes("simulation step"));

  let handlerSave;
  const unsubscribe = events.subscribe("core.integration-boundary-probe", "core.scheduler", () => {
    // Queue a nested event so pendingCount remains non-zero during this handler.
    events.publish({ type: "core.integration-boundary-nested", source: "core.demo-system", payload: {} });
    handlerSave = persistence.save("inside-handler", { campaignId: "campaign:boundary" });
  });
  events.publish({ type: "core.integration-boundary-probe", source: "core.demo-system", payload: {} });
  unsubscribe();
  const handlerError = await rejects(() => handlerSave, "UNSAFE_BOUNDARY");
  assert(handlerError.message.includes("Event Bus delivery"));

  await persistence.save("after-boundary", { campaignId: "campaign:boundary" });
  await runtime.destroy();
});

async function runAll() {
  let passed = 0;
  const lines = [];
  for (const item of tests) {
    try { await item.run(); passed += 1; lines.push(`PASS ${item.name}`); }
    catch (error) { lines.push(`FAIL ${item.name}: ${error.message}`); }
  }
  lines.push(`RESULT ${passed}/${tests.length} passed`);
  if (typeof document !== "undefined") document.querySelector("#results").textContent = lines.join("\n");
  if (passed !== tests.length) throw new Error(`Core integration tests failed: ${passed}/${tests.length}`);
  return { passed, total: tests.length };
}
if (typeof document !== "undefined") {
  document.querySelector("#run")?.addEventListener("click", runAll);
  document.querySelector("#results").textContent = "Ready. Press Run tests.";
} else {
  runAll().then((result) => console.log(`RESULT ${result.passed}/${result.total} passed`));
}
