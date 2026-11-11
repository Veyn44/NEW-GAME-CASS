import { GameContext } from "../src/core/game-context.js";
import { RegistryError, SystemRegistry } from "../src/core/system-registry.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function expectCode(callback, code) {
  try {
    callback();
  } catch (error) {
    assert(error instanceof RegistryError, `Expected RegistryError, got ${error?.constructor?.name}`);
    assert(error.code === code, `Expected error code ${code}, got ${error.code}`);
    return;
  }
  throw new Error(`Expected RegistryError with code ${code}`);
}

export function runCoreRegistryTests() {
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };

  test("orders providers before consumers, regardless of registration order", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "consumer", requires: ["clock.api"] });
    registry.register({ id: "clock", provides: ["clock.api"] });
    const order = registry.validate();
    assert(order.join(",") === "clock,consumer", `Unexpected order: ${order.join(",")}`);
  });

  test("rejects duplicate system IDs", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "pawn" });
    expectCode(() => registry.register({ id: "pawn" }), "DUPLICATE_SYSTEM_ID");
  });

  test("rejects duplicate service providers without partially registering the rejected system", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "clock-a", provides: ["clock.api"] });
    expectCode(() => registry.register({ id: "clock-b", provides: ["clock.api", "calendar.api"] }), "DUPLICATE_SERVICE_PROVIDER");
    registry.register({ id: "calendar", provides: ["calendar.api"] });
    assert(registry.validate().join(",") === "clock-a,calendar", "Rejected registration must not reserve IDs or services.");
  });

  test("rejects missing required services before startup", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "pawn", requires: ["world.api"] });
    expectCode(() => registry.validate(), "MISSING_REQUIRED_SERVICE");
  });

  test("allows missing optional services", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "ui", requires: [{ id: "logger.api", optional: true }] });
    assert(registry.validate().join(",") === "ui", "Optional service should not block validation.");
  });

  test("rejects dependency cycles", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "alpha", provides: ["alpha.api"], requires: ["beta.api"] });
    registry.register({ id: "beta", provides: ["beta.api"], requires: ["alpha.api"] });
    expectCode(() => registry.validate(), "DEPENDENCY_CYCLE");
  });

  test("rejects a system requiring its own service", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "clock", provides: ["clock.api"], requires: ["clock.api"] });
    expectCode(() => registry.validate(), "SELF_DEPENDENCY");
  });

  test("publishes and resolves only declared public services", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "clock", provides: ["clock.api"] });
    registry.validate();
    const api = { now: () => 42 };
    registry.publishService("clock", "clock.api", api);
    assert(registry.hasService("clock.api"), "Published service should be available.");
    assert(registry.getService("clock.api").now() === 42, "Public API should resolve.");
    assert(Object.isFrozen(registry.getService("clock.api")), "Object APIs should be shallow-frozen.");
    expectCode(() => registry.publishService("clock", "private.api", {}), "UNDECLARED_SERVICE");
  });

  test("distinguishes declared-but-not-ready from unknown services", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "clock", provides: ["clock.api"] });
    registry.validate();
    expectCode(() => registry.getService("clock.api"), "SERVICE_NOT_READY");
    expectCode(() => registry.getService("missing.api"), "UNKNOWN_SERVICE");
  });

  test("locks system declarations after validation", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "clock" });
    registry.validate();
    expectCode(() => registry.register({ id: "late-system" }), "REGISTRY_LOCKED");
  });

  test("keeps infrastructure services separate from domain services", () => {
    const registry = new SystemRegistry();
    registry.register({ id: "pawn", provides: ["pawn.api"] });
    registry.validate();
    registry.publishService("pawn", "pawn.api", { count: () => 1 });
    const logger = { info() {} };
    const context = new GameContext({ systems: registry, infrastructure: { logger } });
    assert(context.getInfrastructureService("logger") === logger, "Infrastructure service should be accessible.");
    assert(context.getService("pawn.api").count() === 1, "Domain API should be accessed through registry.");
    assert(!context.hasInfrastructureService("pawn.api"), "Domain API must not leak into infrastructure map.");
  });

  test("reports unavailable infrastructure services clearly", () => {
    const registry = new SystemRegistry();
    registry.validate();
    const context = new GameContext({ systems: registry });
    expectCode(() => context.getInfrastructureService("logger"), "UNKNOWN_INFRASTRUCTURE_SERVICE");
  });

  return results;
}
