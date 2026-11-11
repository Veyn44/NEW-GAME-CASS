import { RegistryError } from "../src/core/system-registry.js";
import { SystemBootstrap } from "../src/core/system-bootstrap.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function expectCode(callback, code) {
  try { await callback(); }
  catch (error) {
    assert(error instanceof RegistryError, `Expected RegistryError, got ${error?.constructor?.name}`);
    assert(error.code === code, `Expected ${code}, got ${error.code}`);
    return error;
  }
  throw new Error(`Expected RegistryError with code ${code}`);
}

export async function runLifecycleBootstrapTests() {
  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };

  await test("validates declarations before calling lifecycle hooks", async () => {
    let initialized = false;
    await expectCode(() => new SystemBootstrap({ systems: [
      { id: "consumer", requires: ["missing.api"], initialize() { initialized = true; } }
    ] }), "MISSING_REQUIRED_SERVICE");
    assert(!initialized, "No system may initialize before registry validation.");
  });

  await test("initializes providers before consumers and publishes APIs after initialization", async () => {
    const events = [];
    let bootstrap;
    bootstrap = new SystemBootstrap({ systems: [
      {
        id: "consumer", requires: ["clock.api"],
        initialize(context) {
          events.push("consumer:init");
          assert(context.getService("clock.api").now() === 7, "Provider API must be available to consumer.");
        },
        start() { events.push("consumer:start"); }
      },
      {
        id: "clock", provides: ["clock.api"],
        initialize() { events.push("clock:init"); return { "clock.api": { now: () => 7 } }; },
        start() { events.push("clock:start"); }
      }
    ] });
    await bootstrap.start();
    assert(events.join("|") === "clock:init|consumer:init|clock:start|consumer:start", events.join("|"));
    assert(bootstrap.state === "running", "Bootstrap should be running.");
  });

  await test("does not publish a provider API before its initialize hook succeeds", async () => {
    let consumerInitialized = false;
    const bootstrap = new SystemBootstrap({ systems: [
      { id: "provider", provides: ["provider.api"], initialize() { throw new Error("provider failed"); } },
      { id: "consumer", requires: ["provider.api"], initialize() { consumerInitialized = true; } }
    ] });
    await expectCode(() => bootstrap.start(), "BOOTSTRAP_FAILED");
    assert(!consumerInitialized, "Consumer must not initialize after provider failure.");
    assert(bootstrap.state === "failed", "Bootstrap should enter failed state.");
  });

  await test("initializes every system before starting any system", async () => {
    const events = [];
    const bootstrap = new SystemBootstrap({ systems: [
      { id: "alpha", initialize() { events.push("alpha:init"); }, start() { events.push("alpha:start"); } },
      { id: "beta", initialize() { events.push("beta:init"); }, start() { events.push("beta:start"); } }
    ] });
    await bootstrap.start();
    assert(events.join("|") === "alpha:init|beta:init|alpha:start|beta:start", events.join("|"));
  });

  await test("rolls back all initialized systems in reverse order when start fails", async () => {
    const events = [];
    const bootstrap = new SystemBootstrap({ systems: [
      { id: "alpha", initialize() { events.push("alpha:init"); }, start() { events.push("alpha:start"); }, destroy() { events.push("alpha:destroy"); } },
      { id: "beta", initialize() { events.push("beta:init"); }, start() { events.push("beta:start"); throw new Error("start failed"); }, destroy() { events.push("beta:destroy"); } },
      { id: "gamma", initialize() { events.push("gamma:init"); }, start() { events.push("gamma:start"); }, destroy() { events.push("gamma:destroy"); } }
    ] });
    await expectCode(() => bootstrap.start(), "BOOTSTRAP_FAILED");
    assert(events.join("|") === "alpha:init|beta:init|gamma:init|alpha:start|beta:start|gamma:destroy|beta:destroy|alpha:destroy", events.join("|"));
  });

  await test("continues rollback when a destroy hook throws", async () => {
    const events = [];
    const bootstrap = new SystemBootstrap({ systems: [
      { id: "alpha", initialize() {}, destroy() { events.push("alpha:destroy"); } },
      { id: "beta", initialize() {}, destroy() { events.push("beta:destroy"); throw new Error("cleanup failed"); } },
      { id: "gamma", initialize() {}, start() { throw new Error("start failed"); }, destroy() { events.push("gamma:destroy"); } }
    ] });
    await expectCode(() => bootstrap.start(), "BOOTSTRAP_FAILED");
    assert(events.join("|") === "gamma:destroy|beta:destroy|alpha:destroy", events.join("|"));
    assert(bootstrap.cleanupErrors.length === 1, "Cleanup error should be retained.");
    assert(bootstrap.cleanupErrors[0].systemId === "beta", "Cleanup error should identify its system.");
  });

  await test("rejects missing and undeclared public service APIs atomically", async () => {
    const missing = new SystemBootstrap({ systems: [
      { id: "provider", provides: ["one.api", "two.api"], initialize() { return { "one.api": {} }; } }
    ] });
    await expectCode(() => missing.start(), "BOOTSTRAP_FAILED");

    const extra = new SystemBootstrap({ systems: [
      { id: "provider", provides: ["one.api"], initialize() { return { "one.api": {}, "private.api": {} }; } }
    ] });
    await expectCode(() => extra.start(), "BOOTSTRAP_FAILED");
  });

  await test("supports optional pause and resume hooks in deterministic order", async () => {
    const events = [];
    const bootstrap = new SystemBootstrap({ systems: [
      { id: "alpha", initialize() {}, start() {}, pause() { events.push("alpha:pause"); }, resume() { events.push("alpha:resume"); }, destroy() { events.push("alpha:destroy"); } },
      { id: "beta", initialize() {}, start() {}, pause() { events.push("beta:pause"); }, resume() { events.push("beta:resume"); }, destroy() { events.push("beta:destroy"); } }
    ] });
    await bootstrap.start();
    await bootstrap.pause();
    assert(bootstrap.state === "paused", "Expected paused state.");
    await bootstrap.resume();
    assert(bootstrap.state === "running", "Expected running state.");
    await bootstrap.destroy();
    assert(events.join("|") === "beta:pause|alpha:pause|alpha:resume|beta:resume|beta:destroy|alpha:destroy", events.join("|"));
    assert(bootstrap.state === "destroyed", "Expected destroyed state.");
  });

  await test("exposes only public service resolution through GameContext", async () => {
    const bootstrap = new SystemBootstrap({ systems: [
      { id: "clock", provides: ["clock.api"], initialize() { return { "clock.api": { now: () => 1 } }; } }
    ] });
    const context = await bootstrap.start();
    assert(context.getService("clock.api").now() === 1, "Public service should resolve.");
    assert(!("systems" in context), "Internal SystemRegistry must not be exposed.");
    assert(!("register" in context), "Context must not expose registry mutation.");
    await bootstrap.destroy();
  });

  await test("rejects invalid lifecycle hook types and repeated starts", async () => {
    try {
      new SystemBootstrap({ systems: [{ id: "bad", start: true }] });
      throw new Error("Expected invalid hook rejection.");
    } catch (error) {
      assert(error.code === "INVALID_LIFECYCLE_HOOK", `Unexpected error: ${error.code}`);
    }
    const bootstrap = new SystemBootstrap({ systems: [{ id: "empty" }] });
    await bootstrap.start();
    await expectCode(() => bootstrap.start(), "INVALID_BOOTSTRAP_STATE");
  });

  return results;
}
