const ID_PATTERN = /^[a-z][a-z0-9.-]*$/;

export class RegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "RegistryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new RegistryError("INVALID_ID", `${label} must be a stable lowercase ID (a-z, 0-9, dot, hyphen).`, { value });
  }
  return value;
}

function normalizeServices(values = [], label = "services") {
  if (!Array.isArray(values)) {
    throw new RegistryError("INVALID_DECLARATION", `${label} must be an array.`);
  }
  const seen = new Set();
  return values.map((entry) => {
    const optional = label === "required services" && entry && typeof entry === "object" && entry.optional === true;
    const id = assertId(typeof entry === "string" ? entry : entry?.id, label);
    if (seen.has(id)) {
      throw new RegistryError("DUPLICATE_DECLARATION", `Service "${id}" is declared more than once in ${label}.`, { serviceId: id });
    }
    seen.add(id);
    return Object.freeze({ id, optional });
  });
}

/**
 * Registry of system declarations and their public service APIs.
 * It deliberately knows nothing about system initialization or runtime updates.
 */
export class SystemRegistry {
  #systems = new Map();
  #providers = new Map();
  #services = new Map();
  #validated = false;
  #initializationOrder = null;

  register({ id, provides = [], requires = [] } = {}) {
    if (this.#validated) {
      throw new RegistryError("REGISTRY_LOCKED", "Systems cannot be registered after successful validation.");
    }
    id = assertId(id, "System ID");
    if (this.#systems.has(id)) {
      throw new RegistryError("DUPLICATE_SYSTEM_ID", `System ID "${id}" is already registered.`, { systemId: id });
    }

    const provided = normalizeServices(provides, "provided services");
    const required = normalizeServices(requires, "required services");

    // Validate the entire declaration before mutating registry state.
    for (const service of provided) {
      const existing = this.#providers.get(service.id);
      if (existing) {
        throw new RegistryError(
          "DUPLICATE_SERVICE_PROVIDER",
          `Service "${service.id}" is provided by both "${existing}" and "${id}".`,
          { serviceId: service.id, providers: [existing, id] }
        );
      }
    }

    this.#systems.set(id, Object.freeze({ id, provides: provided, requires: required }));
    for (const service of provided) this.#providers.set(service.id, id);
    return this;
  }

  validate() {
    if (this.#validated) return this.#initializationOrder;

    const dependencies = new Map();
    for (const [systemId, declaration] of this.#systems) {
      const providers = new Set();
      for (const requirement of declaration.requires) {
        const providerId = this.#providers.get(requirement.id);
        if (!providerId) {
          if (requirement.optional) continue;
          throw new RegistryError(
            "MISSING_REQUIRED_SERVICE",
            `System "${systemId}" requires service "${requirement.id}", but no system provides it.`,
            { systemId, serviceId: requirement.id }
          );
        }
        if (providerId === systemId) {
          throw new RegistryError(
            "SELF_DEPENDENCY",
            `System "${systemId}" cannot require its own service "${requirement.id}".`,
            { systemId, serviceId: requirement.id }
          );
        }
        providers.add(providerId);
      }
      dependencies.set(systemId, providers);
    }

    const remaining = new Map([...dependencies].map(([id, deps]) => [id, new Set(deps)]));
    const order = [];
    while (remaining.size) {
      const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([id]) => id);
      if (!ready.length) {
        const cycle = [...remaining].map(([id, deps]) => ({ id, dependsOn: [...deps] }));
        throw new RegistryError("DEPENDENCY_CYCLE", "System service dependencies contain a cycle.", { cycle });
      }
      for (const id of ready) {
        order.push(id);
        remaining.delete(id);
        for (const deps of remaining.values()) deps.delete(id);
      }
    }

    this.#validated = true;
    this.#initializationOrder = Object.freeze(order);
    return this.#initializationOrder;
  }

  get initializationOrder() {
    if (!this.#validated) {
      throw new RegistryError("REGISTRY_NOT_VALIDATED", "Call validate() before reading the system order.");
    }
    return this.#initializationOrder;
  }

  publishService(systemId, serviceId, publicApi) {
    this.#assertValidated();
    const system = this.#systems.get(systemId);
    if (!system) {
      throw new RegistryError("UNKNOWN_SYSTEM", `System "${systemId}" is not registered.`, { systemId });
    }
    if (!system.provides.some((service) => service.id === serviceId)) {
      throw new RegistryError(
        "UNDECLARED_SERVICE",
        `System "${systemId}" did not declare service "${serviceId}".`,
        { systemId, serviceId }
      );
    }
    if (this.#services.has(serviceId)) {
      throw new RegistryError("SERVICE_ALREADY_PUBLISHED", `Service "${serviceId}" has already been published.`, { serviceId });
    }
    if (!publicApi || (typeof publicApi !== "object" && typeof publicApi !== "function")) {
      throw new RegistryError("INVALID_SERVICE_API", `Public API for "${serviceId}" must be an object or function.`, { serviceId });
    }
    const api = typeof publicApi === "function" ? publicApi : Object.freeze({ ...publicApi });
    this.#services.set(serviceId, api);
    return api;
  }

  hasService(serviceId) {
    assertId(serviceId, "Service ID");
    return this.#services.has(serviceId);
  }

  getService(serviceId) {
    assertId(serviceId, "Service ID");
    if (!this.#services.has(serviceId)) {
      const provider = this.#providers.get(serviceId);
      if (!provider) {
        throw new RegistryError("UNKNOWN_SERVICE", `No system declares service "${serviceId}".`, { serviceId });
      }
      throw new RegistryError(
        "SERVICE_NOT_READY",
        `Service "${serviceId}" is declared by "${provider}" but has not been published yet.`,
        { serviceId, provider }
      );
    }
    return this.#services.get(serviceId);
  }

  getSystemIds() {
    return Object.freeze([...this.#systems.keys()]);
  }

  #assertValidated() {
    if (!this.#validated) {
      throw new RegistryError("REGISTRY_NOT_VALIDATED", "Validate the registry before publishing services.");
    }
  }
}
