import { GameContext } from "./game-context.js";
import { RegistryError, SystemRegistry } from "./system-registry.js";

const LIFECYCLE_HOOKS = ["initialize", "start", "pause", "resume", "destroy"];

function assertSystem(system, index) {
  if (!system || typeof system !== "object" || Array.isArray(system)) {
    throw new RegistryError("INVALID_SYSTEM", `System at index ${index} must be an object.`, { index });
  }
  if (typeof system.id !== "string") {
    throw new RegistryError("INVALID_SYSTEM", `System at index ${index} must declare an ID.`, { index });
  }
  for (const hook of LIFECYCLE_HOOKS) {
    if (system[hook] !== undefined && typeof system[hook] !== "function") {
      throw new RegistryError("INVALID_LIFECYCLE_HOOK", `System "${system.id}" hook "${hook}" must be a function.`, { systemId: system.id, hook });
    }
  }
  return system;
}

/**
 * Validates and runs a complete system assembly.
 *
 * initialize(context) may return an object keyed by the system's declared
 * service IDs. Those APIs become visible only after initialize resolves.
 * start(context) is called only after every system has initialized.
 */
export class SystemBootstrap {
  #systems;
  #registry;
  #context;
  #orderedSystems = [];
  #initialized = [];
  #started = [];
  #state = "created";
  #cleanupErrors = [];

  constructor({ systems, infrastructure = {}, logger = null } = {}) {
    if (!Array.isArray(systems) || systems.length === 0) {
      throw new RegistryError("INVALID_SYSTEMS", "Bootstrap requires a non-empty systems array.");
    }
    this.#systems = systems.map(assertSystem);
    this.#registry = new SystemRegistry();

    for (const system of this.#systems) {
      this.#registry.register({
        id: system.id,
        provides: system.provides ?? [],
        requires: system.requires ?? []
      });
    }

    const order = this.#registry.validate();
    const byId = new Map(this.#systems.map((system) => [system.id, system]));
    this.#orderedSystems = order.map((id) => byId.get(id));
    this.#context = new GameContext({
      systems: this.#registry,
      infrastructure: logger && !Object.hasOwn(infrastructure, "logger")
        ? { ...infrastructure, logger }
        : infrastructure
    });
  }

  get state() {
    return this.#state;
  }

  get initializationOrder() {
    return Object.freeze(this.#orderedSystems.map((system) => system.id));
  }

  get cleanupErrors() {
    return Object.freeze([...this.#cleanupErrors]);
  }

  async start() {
    if (this.#state !== "created") {
      throw new RegistryError("INVALID_BOOTSTRAP_STATE", `Cannot start bootstrap from state "${this.#state}".`, { state: this.#state });
    }

    this.#state = "initializing";
    try {
      for (const system of this.#orderedSystems) {
        let publicApis;
        if (system.initialize) publicApis = await system.initialize(this.#context);
        this.#initialized.push(system);
        this.#publishDeclaredServices(system, publicApis);
      }

      this.#state = "starting";
      for (const system of this.#orderedSystems) {
        if (system.start) await system.start(this.#context);
        this.#started.push(system);
      }

      this.#state = "running";
      return this.#context;
    } catch (error) {
      this.#state = "failed";
      await this.#cleanupInitialized();
      throw new RegistryError("BOOTSTRAP_FAILED", `System bootstrap failed: ${error?.message ?? String(error)}`, {
        cause: error,
        cleanupErrors: this.cleanupErrors
      });
    }
  }

  async pause() {
    if (this.#state !== "running") {
      throw new RegistryError("INVALID_BOOTSTRAP_STATE", `Cannot pause bootstrap from state "${this.#state}".`, { state: this.#state });
    }
    const paused = [];
    try {
      for (const system of [...this.#started].reverse()) {
        if (system.pause) {
          await system.pause(this.#context);
          paused.push(system);
        }
      }
      this.#state = "paused";
    } catch (error) {
      // Restore the prior running state where possible; a failed pause is not
      // treated as a startup failure and does not destroy the assembly.
      for (const system of paused.reverse()) {
        try { if (system.resume) await system.resume(this.#context); }
        catch (resumeError) { this.#recordCleanupError(system, "resume", resumeError); }
      }
      throw new RegistryError("PAUSE_FAILED", `System pause failed: ${error?.message ?? String(error)}`, { cause: error });
    }
  }

  async resume() {
    if (this.#state !== "paused") {
      throw new RegistryError("INVALID_BOOTSTRAP_STATE", `Cannot resume bootstrap from state "${this.#state}".`, { state: this.#state });
    }
    const resumed = [];
    try {
      for (const system of this.#started) {
        if (system.resume) {
          await system.resume(this.#context);
          resumed.push(system);
        }
      }
      this.#state = "running";
    } catch (error) {
      for (const system of resumed.reverse()) {
        try { if (system.pause) await system.pause(this.#context); }
        catch (pauseError) { this.#recordCleanupError(system, "pause", pauseError); }
      }
      throw new RegistryError("RESUME_FAILED", `System resume failed: ${error?.message ?? String(error)}`, { cause: error });
    }
  }

  async destroy() {
    if (this.#state === "destroyed") return;
    if (this.#state === "created") {
      this.#state = "destroyed";
      return;
    }
    await this.#cleanupInitialized();
    this.#state = "destroyed";
  }

  #publishDeclaredServices(system, publicApis) {
    const declared = system.provides ?? [];
    if (declared.length === 0) {
      if (publicApis !== undefined && publicApis !== null &&
          (typeof publicApis !== "object" || Object.keys(publicApis).length > 0)) {
        throw new RegistryError("UNDECLARED_SERVICE_API", `System "${system.id}" returned service APIs without declaring services.`, { systemId: system.id });
      }
      return;
    }
    if (!publicApis || typeof publicApis !== "object" || Array.isArray(publicApis)) {
      throw new RegistryError("MISSING_SERVICE_APIS", `System "${system.id}" must return an API object for its declared services.`, { systemId: system.id });
    }
    const declaredIds = declared.map((entry) => typeof entry === "string" ? entry : entry.id);
    for (const key of Object.keys(publicApis)) {
      if (!declaredIds.includes(key)) {
        throw new RegistryError("UNDECLARED_SERVICE_API", `System "${system.id}" returned undeclared service API "${key}".`, { systemId: system.id, serviceId: key });
      }
    }
    for (const serviceId of declaredIds) {
      if (!Object.hasOwn(publicApis, serviceId)) {
        throw new RegistryError("MISSING_SERVICE_API", `System "${system.id}" did not return declared service API "${serviceId}".`, { systemId: system.id, serviceId });
      }
      this.#registry.publishService(system.id, serviceId, publicApis[serviceId]);
    }
  }

  async #cleanupInitialized() {
    for (const system of [...this.#initialized].reverse()) {
      if (!system.destroy) continue;
      try {
        await system.destroy(this.#context);
      } catch (error) {
        this.#recordCleanupError(system, "destroy", error);
      }
    }
    this.#initialized = [];
    this.#started = [];
  }

  #recordCleanupError(system, hook, error) {
    const entry = Object.freeze({ systemId: system.id, hook, error });
    this.#cleanupErrors.push(entry);
    try {
      const logger = this.#context.getInfrastructureService("logger");
      logger?.error?.("System lifecycle cleanup failed", entry);
    } catch {
      // Logging is optional and must never interrupt cleanup.
    }
  }
}
