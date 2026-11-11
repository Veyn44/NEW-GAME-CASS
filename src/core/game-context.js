import { RegistryError } from "./system-registry.js";

/**
 * Shared technical context. Domain state remains owned by its domain systems.
 * The registry itself is private: consumers can resolve public services but
 * cannot register systems or publish APIs through the context.
 */
export class GameContext {
  #systems;
  #infrastructure;

  constructor({ systems, infrastructure = {} } = {}) {
    if (!systems || typeof systems.getService !== "function" || typeof systems.hasService !== "function") {
      throw new RegistryError("INVALID_CONTEXT_REGISTRY", "GameContext requires a valid SystemRegistry.");
    }
    if (!infrastructure || typeof infrastructure !== "object" || Array.isArray(infrastructure)) {
      throw new RegistryError("INVALID_INFRASTRUCTURE", "Infrastructure services must be supplied as an object.");
    }
    this.#systems = systems;
    this.#infrastructure = new Map();
    for (const [id, service] of Object.entries(infrastructure)) {
      if (!/^[a-z][a-z0-9.-]*$/.test(id)) {
        throw new RegistryError("INVALID_ID", `Infrastructure service ID "${id}" is invalid.`, { serviceId: id });
      }
      if (service === undefined || service === null) {
        throw new RegistryError("INVALID_INFRASTRUCTURE", `Infrastructure service "${id}" cannot be null or undefined.`, { serviceId: id });
      }
      this.#infrastructure.set(id, service);
    }
    Object.freeze(this);
  }

  hasInfrastructureService(serviceId) {
    return this.#infrastructure.has(serviceId);
  }

  getInfrastructureService(serviceId) {
    if (!this.#infrastructure.has(serviceId)) {
      throw new RegistryError(
        "UNKNOWN_INFRASTRUCTURE_SERVICE",
        `Infrastructure service "${serviceId}" is not available in this GameContext.`,
        { serviceId }
      );
    }
    return this.#infrastructure.get(serviceId);
  }

  hasService(serviceId) {
    return this.#systems.hasService(serviceId);
  }

  getService(serviceId) {
    return this.#systems.getService(serviceId);
  }
}
