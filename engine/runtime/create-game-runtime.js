import { createCoreAssembly } from "../core/core-assembly.js";

/**
 * Creates a host runtime around the reusable Core Assembly.
 *
 * The host owns configuration, adapters, systems and the outer application
 * loop. Core remains the owner of shared runtime infrastructure.
 */
export function createGameRuntime({
  saveAdapter,
  hostSystems = [],
  simulationTasks = [],
  eventSources = [],
  ...coreOptions
} = {}) {
  const core = createCoreAssembly({
    ...coreOptions,
    saveAdapter,
    hostSystems,
    simulationTasks,
    eventSources
  });

  let destroyPromise = null;

  return Object.freeze({
    get state() {
      return core.state;
    },

    get context() {
      return core.context;
    },

    get initializationOrder() {
      return core.initializationOrder;
    },

    start() {
      return core.start();
    },

    /**
     * Advance the fixed-step simulation from the host's outer loop.
     * Rendering/input frame timing stays outside the simulation systems.
     */
    advance(realDeltaSeconds) {
      if (destroyPromise) {
        throw new Error("Game runtime is shutting down and cannot advance.");
      }
      const context = core.context;
      if (!context) {
        throw new Error("Game runtime must be started before it can advance.");
      }
      return context
        .getService(core.services.scheduler)
        .advance(realDeltaSeconds);
    },

    pause() {
      return core.pause();
    },

    resume() {
      return core.resume();
    },

    destroy() {
      if (!destroyPromise) destroyPromise = core.destroy();
      return destroyPromise;
    }
  });
}
