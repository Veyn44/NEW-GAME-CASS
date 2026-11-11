import { EventBus, EventBusError } from "../src/core/event-bus.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function expectCode(callback, code) {
  try { callback(); }
  catch (error) {
    assert(error instanceof EventBusError, `Expected EventBusError, got ${error?.constructor?.name}`);
    assert(error.code === code, `Expected ${code}, got ${error.code}`);
    return error;
  }
  throw new Error(`Expected EventBusError with code ${code}`);
}

export function runEventBusTests() {
  const results = [];
  const test = (name, fn) => {
    try { fn(); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  };

  test("delivers synchronously in subscription registration order", () => {
    const bus = new EventBus({ sources: ["pawn", "ui"] });
    const received = [];
    bus.subscribe("pawn.damaged", "ui", () => received.push("first"));
    bus.subscribe("pawn.damaged", "pawn", () => received.push("second"));
    const event = bus.publish({ type: "pawn.damaged", source: "pawn", payload: { amount: 4 } });
    assert(received.join(",") === "first,second", received.join(","));
    assert(event.sequence === 1 && bus.sequence === 1, "Sequence must be monotonic.");
  });

  test("creates immutable envelopes and detached deep-frozen payload copies", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    const payload = { nested: { amount: 5 }, tags: ["impact"] };
    let received;
    bus.subscribe("pawn.hit", "pawn", (event) => { received = event; });
    const event = bus.publish({ type: "pawn.hit", source: "pawn", payload });
    payload.nested.amount = 99;
    assert(received.payload.nested.amount === 5, "Payload must be detached from caller data.");
    assert(Object.isFrozen(event) && Object.isFrozen(event.payload) && Object.isFrozen(event.payload.nested), "Envelope and nested payload must be frozen.");
  });

  test("validates event type, version, source and payload", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    expectCode(() => bus.publish({ type: "damaged", source: "pawn" }), "INVALID_EVENT_TYPE");
    expectCode(() => bus.publish({ type: "pawn.hit", source: "unknown" }), "UNKNOWN_SOURCE");
    expectCode(() => bus.publish({ type: "pawn.hit", source: "pawn", version: 0 }), "INVALID_VERSION");
    expectCode(() => bus.publish({ type: "pawn.hit", source: "pawn", payload: [] }), "INVALID_PAYLOAD");
    expectCode(() => bus.publish({ type: "pawn.hit", source: "pawn", payload: { value: () => 1 } }), "INVALID_PAYLOAD");
  });

  test("rejects duplicate subscriptions and supports idempotent unsubscribe", () => {
    const bus = new EventBus({ sources: ["pawn", "ui"] });
    let count = 0;
    const unsubscribe = bus.subscribe("pawn.hit", "ui", () => count++);
    expectCode(() => bus.subscribe("pawn.hit", "ui", () => {}), "DUPLICATE_SUBSCRIPTION");
    assert(unsubscribe() === true, "First unsubscribe should report removal.");
    assert(unsubscribe() === false, "Repeated unsubscribe should be a no-op.");
    bus.publish({ type: "pawn.hit", source: "pawn" });
    assert(count === 0, "Unsubscribed handler must not receive later events.");
  });

  test("uses a delivery snapshot when subscriptions change inside a handler", () => {
    const bus = new EventBus({ sources: ["alpha", "beta", "gamma"] });
    const received = [];
    let removeBeta;
    let gammaSubscribed = false;
    bus.subscribe("world.changed", "alpha", () => {
      received.push("alpha");
      removeBeta();
      if (!gammaSubscribed) {
        gammaSubscribed = true;
        bus.subscribe("world.changed", "gamma", () => received.push("gamma"));
      }
    });
    removeBeta = bus.subscribe("world.changed", "beta", () => received.push("beta"));
    bus.publish({ type: "world.changed", source: "alpha" });
    assert(received.join(",") === "alpha,beta", received.join(","));
    bus.publish({ type: "world.changed", source: "alpha" });
    assert(received.join(",") === "alpha,beta,alpha,gamma", received.join(","));
  });

  test("queues events published by handlers without nested delivery", () => {
    const bus = new EventBus({ sources: ["alpha", "beta"] });
    const received = [];
    bus.subscribe("alpha.started", "alpha", () => {
      received.push("alpha:start");
      bus.publish({ type: "beta.ready", source: "alpha" });
      received.push("alpha:end");
    });
    bus.subscribe("beta.ready", "beta", () => received.push("beta:ready"));
    bus.publish({ type: "alpha.started", source: "alpha" });
    assert(received.join("|") === "alpha:start|alpha:end|beta:ready", received.join("|"));
  });

  test("isolates handler exceptions and continues delivery", () => {
    const logs = [];
    const bus = new EventBus({ sources: ["alpha", "beta"], logger: { error: (...args) => logs.push(args) } });
    let secondCalled = false;
    bus.subscribe("pawn.damaged", "alpha", () => { throw new Error("handler failure"); });
    bus.subscribe("pawn.damaged", "beta", () => { secondCalled = true; });
    bus.publish({ type: "pawn.damaged", source: "alpha" });
    assert(secondCalled, "Later subscribers must still receive the event.");
    assert(logs.length === 1, "Handler failure must be logged once.");
    assert(logs[0][1].type === "pawn.damaged" && logs[0][1].subscriber === "alpha", "Log should identify event and subscriber.");
  });

  test("continues delivery if the logger itself throws", () => {
    const bus = new EventBus({ sources: ["alpha", "beta"], logger: { error() { throw new Error("logger failed"); } } });
    let delivered = false;
    bus.subscribe("pawn.damaged", "alpha", () => { throw new Error("handler failed"); });
    bus.subscribe("pawn.damaged", "beta", () => { delivered = true; });
    bus.publish({ type: "pawn.damaged", source: "alpha" });
    assert(delivered, "Logger failure must not interrupt delivery.");
  });

  test("assigns increasing sequence numbers and unique event IDs", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    const first = bus.publish({ type: "pawn.moved", source: "pawn" });
    const second = bus.publish({ type: "pawn.moved", source: "pawn" });
    assert(second.sequence === first.sequence + 1, "Sequence must increase by one.");
    assert(first.id !== second.id, "Event IDs must be unique within the bus.");
  });

  test("enforces a per-drain event limit and clears the runaway queue", () => {
    const logs = [];
    const bus = new EventBus({ sources: ["loop"], maxEventsPerDrain: 5, logger: { error: (...args) => logs.push(args) } });
    bus.subscribe("loop.tick", "loop", () => bus.publish({ type: "loop.tick", source: "loop" }));
    expectCode(() => bus.publish({ type: "loop.tick", source: "loop" }), "EVENT_DRAIN_LIMIT");
    assert(bus.pendingCount === 0, "Runaway queue must be cleared.");
    assert(logs.length === 1, "Limit breach must be logged.");
  });

  test("rejects unknown subscriber systems and duplicate sources", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    expectCode(() => bus.subscribe("pawn.hit", "unknown", () => {}), "UNKNOWN_SUBSCRIBER");
    expectCode(() => new EventBus({ sources: ["pawn", "pawn"] }), "DUPLICATE_SOURCE");
  });

  test("keeps a fresh drain usable after the event limit is reached", () => {
    const bus = new EventBus({ sources: ["loop"], maxEventsPerDrain: 2 });
    let loop = true;
    bus.subscribe("loop.tick", "loop", () => {
      if (loop) bus.publish({ type: "loop.tick", source: "loop" });
    });
    expectCode(() => bus.publish({ type: "loop.tick", source: "loop" }), "EVENT_DRAIN_LIMIT");
    loop = false;
    const event = bus.publish({ type: "loop.tick", source: "loop" });
    assert(event.sequence > 2 && bus.pendingCount === 0, "Bus should recover for a later independent drain.");
  });

  test("does not consume sequence numbers for invalid payloads", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    expectCode(() => bus.publish({ type: "pawn.hit", source: "pawn", payload: { nested: { value: undefined } } }), "INVALID_PAYLOAD");
    assert(bus.sequence === 0, "Invalid payload must not consume a sequence.");
    const valid = bus.publish({ type: "pawn.hit", source: "pawn" });
    assert(valid.sequence === 1, "The next valid event must receive sequence 1.");
  });

  test("preserves an own __proto__ data key without changing the clone prototype", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    const payload = {};
    Object.defineProperty(payload, "__proto__", { value: { polluted: true }, enumerable: true, writable: true, configurable: true });
    const event = bus.publish({ type: "pawn.data", source: "pawn", payload });
    assert(Object.getPrototypeOf(event.payload) === Object.prototype, "Clone must keep the ordinary object prototype.");
    assert(Object.hasOwn(event.payload, "__proto__"), "The data key must be preserved as an own property.");
    assert(event.payload.__proto__.polluted === true, "The own data value must be preserved.");
    assert({}.polluted === undefined, "Object.prototype must not be polluted.");
  });

  test("rejects accessors without invoking their getter", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    let getterCalls = 0;
    const payload = {};
    Object.defineProperty(payload, "danger", { enumerable: true, get() { getterCalls++; return 1; } });
    expectCode(() => bus.publish({ type: "pawn.data", source: "pawn", payload }), "INVALID_PAYLOAD");
    assert(getterCalls === 0, "Payload validation must not execute getters.");
    assert(bus.sequence === 0, "Rejected accessors must not consume sequence numbers.");
  });

  test("rejects symbol keys and hidden object properties", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    const symbolPayload = { value: 1 };
    symbolPayload[Symbol("hidden")] = 2;
    expectCode(() => bus.publish({ type: "pawn.data", source: "pawn", payload: symbolPayload }), "INVALID_PAYLOAD");
    const hiddenPayload = { value: 1 };
    Object.defineProperty(hiddenPayload, "hidden", { value: 2, enumerable: false });
    expectCode(() => bus.publish({ type: "pawn.data", source: "pawn", payload: hiddenPayload }), "INVALID_PAYLOAD");
    assert(bus.sequence === 0, "Rejected properties must not consume sequence numbers.");
  });

  test("rejects sparse arrays and arrays with extra properties", () => {
    const bus = new EventBus({ sources: ["pawn"] });
    const sparse = [];
    sparse.length = 1;
    expectCode(() => bus.publish({ type: "pawn.data", source: "pawn", payload: { values: sparse } }), "INVALID_PAYLOAD");
    const extra = [1];
    extra.note = "unsupported";
    expectCode(() => bus.publish({ type: "pawn.data", source: "pawn", payload: { values: extra } }), "INVALID_PAYLOAD");
    assert(bus.sequence === 0, "Rejected arrays must not consume sequence numbers.");
  });

  return results;
}
