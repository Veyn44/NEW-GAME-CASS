/**
 * Shared host-side lifecycle for applications built on the Engine runtime.
 *
 * The host owns runtime construction, fixed-step advancement scheduling,
 * clock synchronization, and frame-loop teardown. Browser scheduling and
 * application presentation policy are injected by the consuming application.
 */
export function createApplicationRuntimeHost({
  createRuntime,
  resolveRuntimeServices,
  runtimeOptions = {},
  requestFrame,
  cancelFrame,
  shouldAdvance = () => true,
  onReady = () => {},
  onFrame = () => {},
  onPauseChange = () => {},
  onError = () => {},
  maxFrameDeltaSeconds = 0.25
} = {}) {
  if (typeof createRuntime !== "function" || typeof resolveRuntimeServices !== "function") {
    throw new TypeError("Application runtime host requires runtime and service factories.");
  }
  if (typeof requestFrame !== "function" || typeof cancelFrame !== "function") {
    throw new TypeError("Application runtime host requires injected frame scheduling functions.");
  }
  if (typeof shouldAdvance !== "function" || typeof onReady !== "function"
    || typeof onFrame !== "function" || typeof onPauseChange !== "function"
    || typeof onError !== "function") {
    throw new TypeError("Application runtime host callbacks must be functions.");
  }
  if (!Number.isFinite(maxFrameDeltaSeconds) || maxFrameDeltaSeconds <= 0) {
    throw new TypeError("maxFrameDeltaSeconds must be a positive finite number.");
  }

  let runtime = null;
  let context = null;
  let services = null;
  let clock = null;
  let frameHandle = null;
  let lastFrameTime = null;
  let startPromise = null;
  let stopPromise = null;
  let paused = true;
  let simulationFaulted = false;

  function syncPauseState(force = false) {
    if (!clock) return paused;
    const nextPaused = Boolean(clock.paused);
    if (force || nextPaused !== paused) {
      paused = nextPaused;
      onPauseChange(paused, services);
    }
    return paused;
  }

  function scheduleFrame() {
    if (stopPromise || frameHandle !== null) return;
    frameHandle = requestFrame(handleFrame);
  }

  function handleFrame(timestamp) {
    frameHandle = null;
    if (stopPromise || !clock) return;

    if (lastFrameTime !== null) {
      const deltaSeconds = Math.min(
        maxFrameDeltaSeconds,
        Math.max(0, (timestamp - lastFrameTime) / 1000)
      );
      try {
        if (!simulationFaulted && shouldAdvance({ paused, services, clock })) runtime.advance(deltaSeconds);
        onFrame(deltaSeconds, { paused, services, clock });
        syncPauseState();
      } catch (error) {
        simulationFaulted = true;
        clock.pause("simulation-fault");
        syncPauseState();
        onError(error, services);
      }
    }

    lastFrameTime = timestamp;
    scheduleFrame();
  }

  async function start() {
    if (startPromise) return startPromise;
    if (stopPromise) throw new Error("Application runtime host has been stopped.");

    startPromise = (async () => {
      runtime = createRuntime(runtimeOptions);
      if (!runtime || typeof runtime.start !== "function"
        || typeof runtime.advance !== "function" || typeof runtime.destroy !== "function") {
        throw new TypeError("Runtime factory must return start(), advance() and destroy() methods.");
      }

      try {
        context = await runtime.start();
        services = resolveRuntimeServices(context);
        clock = services?.clock;
        if (!clock || typeof clock.pause !== "function"
          || typeof clock.resume !== "function" || typeof clock.paused !== "boolean") {
          throw new TypeError("Resolved runtime services must provide a compatible game clock.");
        }
        onReady({ runtime, context, services });
        syncPauseState(true);
        lastFrameTime = null;
        scheduleFrame();
        return Object.freeze({ runtime, context, services });
      } catch (error) {
        try { await runtime.destroy(); } catch {}
        runtime = null;
        context = null;
        services = null;
        clock = null;
        throw error;
      }
    })();

    return startPromise;
  }

  function pause(reason = "player") {
    if (!clock || stopPromise) return false;
    const changed = clock.pause(reason);
    syncPauseState();
    return changed;
  }

  function resume(reason = "player") {
    if (!clock || stopPromise) return false;
    const changed = clock.resume(reason);
    syncPauseState();
    return changed;
  }

  function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (frameHandle !== null) {
        cancelFrame(frameHandle);
        frameHandle = null;
      }
      if (startPromise) {
        try { await startPromise; } catch { return; }
      }
      if (runtime) await runtime.destroy();
      runtime = null;
      context = null;
      services = null;
      clock = null;
    })();
    return stopPromise;
  }

  return Object.freeze({
    start,
    pause,
    resume,
    stop,
    syncPauseState: () => syncPauseState(),
    isPaused: () => paused,
    getRuntime: () => runtime,
    getContext: () => context,
    getServices: () => services
  });
}
