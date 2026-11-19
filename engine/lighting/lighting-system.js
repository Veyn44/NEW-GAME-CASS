import { assertCellInBounds, worldPositionToCell } from "../spatial/grid-geometry.js";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const LIGHT_TYPES = new Set(["point", "spot"]);

export class LightingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "LightingError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new LightingError("INVALID_ID", `${label} must be a stable identifier.`, { value });
  }
  return value;
}

function finite(value, label, { min = -Infinity, max = Infinity, exclusiveMin = false } = {}) {
  if (!Number.isFinite(value) || (exclusiveMin ? value <= min : value < min) || value > max) {
    throw new LightingError("INVALID_LIGHT", `${label} must be a finite number in the supported range.`, { label, value, min, max });
  }
  return value;
}

function cloneMetadata(value, path = "metadata", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new LightingError("INVALID_METADATA", `${path} must contain finite JSON-like data.`);
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new LightingError("INVALID_METADATA", `${path} must contain plain objects and arrays.`);
  }
  seen.add(value);
  try {
    if (array) return Object.freeze(value.map((entry, index) => cloneMetadata(entry, `${path}[${index}]`, seen)));
    const result = Object.create(null);
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(result, key, { value: cloneMetadata(entry, `${path}.${key}`, seen), enumerable: true });
    }
    return Object.freeze(result);
  } finally {
    seen.delete(value);
  }
}

function normalizeLight(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new LightingError("INVALID_LIGHT", "Light definition must be an object.");
  }
  const id = assertId(raw.id, "Light ID");
  const worldId = assertId(raw.worldId, "World ID");
  if (raw.falloff !== undefined && raw.falloff !== "quadratic") {
    throw new LightingError("UNSUPPORTED_FALLOFF", "The lighting runtime uses quadratic attenuation only.", { falloff: raw.falloff });
  }
  if (!LIGHT_TYPES.has(raw.type)) {
    throw new LightingError("UNSUPPORTED_LIGHT_TYPE", "The initial lighting runtime supports point lights only.", { type: raw.type });
  }
  if (!raw.position || !Number.isFinite(raw.position.x) || !Number.isFinite(raw.position.y)) {
    throw new LightingError("INVALID_POSITION", "Light position requires finite world-space x and y coordinates.");
  }
  const intensity = finite(raw.intensity, "intensity", { min: 0 });
  const radius = finite(raw.radius, "radius", { min: 0, exclusiveMin: true });
  const innerRadius = finite(raw.innerRadius ?? 0, "innerRadius", { min: 0 });
  if (innerRadius >= radius) {
    throw new LightingError("INVALID_INNER_RADIUS", "innerRadius must be smaller than radius.", { innerRadius, radius });
  }
  const direction = raw.type === "spot" ? finite(raw.direction, "direction") : null;
  const innerAngle = raw.type === "spot" ? finite(raw.innerAngle, "innerAngle", { min: 0, max: Math.PI * 2 }) : null;
  const outerAngle = raw.type === "spot" ? finite(raw.outerAngle, "outerAngle", { min: 0, max: Math.PI * 2, exclusiveMin: true }) : null;
  if (raw.type === "spot" && innerAngle > outerAngle) {
    throw new LightingError("INVALID_CONE_ANGLES", "innerAngle must not exceed outerAngle.", { innerAngle, outerAngle });
  }
  const color = raw.color ?? { r: 255, g: 255, b: 255 };
  if (!color || ![color.r, color.g, color.b].every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)) {
    throw new LightingError("INVALID_COLOR", "Light color channels r, g and b must be between 0 and 255.");
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    throw new LightingError("INVALID_ENABLED", "Light enabled must be a boolean.");
  }
  if (raw.castsShadows !== undefined && typeof raw.castsShadows !== "boolean") {
    throw new LightingError("INVALID_SHADOW_SETTING", "castsShadows must be a boolean.");
  }
  const shadowStrength = finite(raw.shadowStrength ?? 1, "shadowStrength", { min: 0, max: 1 });
  return Object.freeze({
    id, worldId, type: raw.type,
    position: Object.freeze({ x: raw.position.x, y: raw.position.y }),
    enabled: raw.enabled ?? true,
    intensity, color: Object.freeze({ r: color.r, g: color.g, b: color.b }),
    radius, innerRadius,
    ...(raw.type === "spot" ? { direction, innerAngle, outerAngle } : {}),
    falloff: "quadratic",
    castsShadows: raw.castsShadows ?? true,
    shadowStrength,
    metadata: cloneMetadata(raw.metadata ?? {})
  });
}

function lineCells(from, to) {
  const cells = [];
  let x = from.x, y = from.y;
  const dx = to.x - from.x, dy = to.y - from.y;
  const stepX = Math.sign(dx), stepY = Math.sign(dy);
  const deltaX = dx === 0 ? Infinity : 1 / Math.abs(dx);
  const deltaY = dy === 0 ? Infinity : 1 / Math.abs(dy);
  let maxX = dx === 0 ? Infinity : 0.5 * deltaX;
  let maxY = dy === 0 ? Infinity : 0.5 * deltaY;
  const push = (cell) => {
    if (cell.x !== to.x || cell.y !== to.y) cells.push(Object.freeze(cell));
  };

  while (x !== to.x || y !== to.y) {
    if (Math.abs(maxX - maxY) < 1e-12) {
      // A ray crossing an exact grid corner touches both side cells.
      // Include both so opaque corner-touching cells cannot leak light.
      push({ x: x + stepX, y });
      push({ x, y: y + stepY });
      x += stepX;
      y += stepY;
      maxX += deltaX;
      maxY += deltaY;
      push({ x, y });
    } else if (maxX < maxY) {
      x += stepX;
      maxX += deltaX;
      push({ x, y });
    } else {
      y += stepY;
      maxY += deltaY;
      push({ x, y });
    }
  }
  return cells;
}

function isOccluded({ worldId, sourceCell, targetCell, occlusionQuery }) {
  if (!occlusionQuery) return false;
  const cells = lineCells(sourceCell, targetCell);
  // The destination cell may itself be an opaque wall; it is lit, but blocks cells behind it.
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    const blocked = occlusionQuery(Object.freeze({ worldId, cell, sourceCell, targetCell }));
    if (blocked && typeof blocked.then === "function") {
      throw new LightingError("ASYNC_OCCLUSION_QUERY", "Lighting occlusion queries must be synchronous.");
    }
    if (blocked === true) return true;
  }
  return false;
}

function spotAngularAttenuation(light, targetX, targetY) {
  if (light.type !== "spot") return 1;
  const targetAngle = Math.atan2(targetY - light.position.y, targetX - light.position.x);
  const difference = Math.abs(Math.atan2(Math.sin(targetAngle - light.direction), Math.cos(targetAngle - light.direction)));
  const innerHalf = light.innerAngle / 2, outerHalf = light.outerAngle / 2;
  if (difference <= innerHalf) return 1;
  if (difference >= outerHalf) return 0;
  const t = (difference - innerHalf) / (outerHalf - innerHalf);
  return 1 - (t * t * (3 - 2 * t));
}

function attenuation(distance, innerRadius, radius) {
  if (distance <= innerRadius) return 1;
  if (distance >= radius) return 0;
  const t = (distance - innerRadius) / (radius - innerRadius);
  const remaining = 1 - t;
  return remaining * remaining;
}

/**
 * Application-neutral, world-scoped light registry and deterministic grid illumination.
 * Host policy supplies occlusion facts; this service never interprets content categories.
 */
export class LightingSystem {
  #worlds;
  #occlusionQuery;
  #lights = new Map();

  constructor({ worldRegistry, occlusionQuery = null } = {}) {
    if (!worldRegistry || typeof worldRegistry.get !== "function") {
      throw new LightingError("INVALID_WORLD_REGISTRY", "LightingSystem requires a WorldRegistry-compatible service.");
    }
    if (occlusionQuery !== null && typeof occlusionQuery !== "function") {
      throw new LightingError("INVALID_OCCLUSION_QUERY", "occlusionQuery must be a synchronous function.");
    }
    this.#worlds = worldRegistry;
    this.#occlusionQuery = occlusionQuery;
  }

  addLight(definition) {
    const light = normalizeLight(definition);
    if (this.#lights.has(light.id)) {
      throw new LightingError("DUPLICATE_LIGHT_ID", `Light "${light.id}" already exists.`, { lightId: light.id });
    }
    const world = this.#worlds.get(light.worldId);
    if (!world) throw new LightingError("UNKNOWN_WORLD", `World "${light.worldId}" does not exist.`, { worldId: light.worldId });
    if (world.status === "closed") throw new LightingError("WORLD_CLOSED", `World "${light.worldId}" is closed.`, { worldId: light.worldId });
    if (!world.grid) throw new LightingError("GRID_UNAVAILABLE", `World "${light.worldId}" has no grid capability.`, { worldId: light.worldId });
    this.#lights.set(light.id, light);
    return light;
  }

  updateLight(lightId, patch) {
    const id = assertId(lightId, "Light ID");
    const current = this.#lights.get(id);
    if (!current) throw new LightingError("UNKNOWN_LIGHT", `Light "${id}" does not exist.`, { lightId: id });
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new LightingError("INVALID_PATCH", "Light update patch must be an object.");
    }
    if (Object.hasOwn(patch, "id") || Object.hasOwn(patch, "worldId")) {
      throw new LightingError("IMMUTABLE_LIGHT_IDENTITY", "A light ID and its worldId cannot be changed; remove and add a new light instead.");
    }
    const next = normalizeLight({ ...current, ...patch, id: current.id, worldId: current.worldId });
    this.#lights.set(id, next);
    return next;
  }

  removeLight(lightId) {
    return this.#lights.delete(assertId(lightId, "Light ID"));
  }

  getLight(lightId) {
    return this.#lights.get(assertId(lightId, "Light ID")) ?? null;
  }

  listLights({ worldId = null } = {}) {
    if (worldId !== null) assertId(worldId, "World ID");
    return Object.freeze([...this.#lights.values()]
      .filter((light) => worldId === null || light.worldId === worldId)
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  calculateIllumination({ worldId, bounds = null } = {}) {
    const id = assertId(worldId, "World ID");
    const world = this.#worlds.get(id);
    if (!world) throw new LightingError("UNKNOWN_WORLD", `World "${id}" does not exist.`, { worldId: id });
    if (world.status === "closed") throw new LightingError("WORLD_CLOSED", `World "${id}" is closed.`, { worldId: id });
    if (!world.grid) throw new LightingError("GRID_UNAVAILABLE", `World "${id}" has no grid capability.`, { worldId: id });
    const grid = world.grid;
    let minX = 0, minY = 0, maxX = grid.width, maxY = grid.height;
    if (bounds !== null) {
      if (!bounds || !Number.isSafeInteger(bounds.minX) || !Number.isSafeInteger(bounds.minY)
        || !Number.isSafeInteger(bounds.maxX) || !Number.isSafeInteger(bounds.maxY)
        || bounds.minX < 0 || bounds.minY < 0 || bounds.maxX > grid.width || bounds.maxY > grid.height
        || bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
        throw new LightingError("INVALID_BOUNDS", "Illumination bounds must be a non-empty, in-grid half-open rectangle.", { bounds });
      }
      ({ minX, minY, maxX, maxY } = bounds);
    }

    const accumulated = new Map();
    for (const light of this.#lights.values()) {
      if (light.worldId !== id || !light.enabled || light.intensity === 0) continue;
      const sourceCell = worldPositionToCell(light.position);
      try { assertCellInBounds(sourceCell, grid); }
      catch { throw new LightingError("LIGHT_OUT_OF_BOUNDS", `Light "${light.id}" is outside its world grid.`, { lightId: light.id, worldId: id, sourceCell }); }
      const minLightX = Math.max(minX, 0, Math.floor(light.position.x - light.radius));
      const minLightY = Math.max(minY, 0, Math.floor(light.position.y - light.radius));
      const maxLightX = Math.min(maxX, grid.width, Math.ceil(light.position.x + light.radius));
      const maxLightY = Math.min(maxY, grid.height, Math.ceil(light.position.y + light.radius));
      for (let y = minLightY; y < maxLightY; y += 1) {
        for (let x = minLightX; x < maxLightX; x += 1) {
          const cell = { x, y };
          const targetX = x + 0.5, targetY = y + 0.5;
          const distance = Math.hypot(targetX - light.position.x, targetY - light.position.y);
          if (distance >= light.radius) continue;
          const angularStrength = spotAngularAttenuation(light, targetX, targetY);
          if (angularStrength <= 0) continue;
          if (light.castsShadows && isOccluded({ worldId: id, sourceCell, targetCell: cell, occlusionQuery: this.#occlusionQuery })) continue;
          const strength = light.intensity * attenuation(distance, light.innerRadius, light.radius) * angularStrength;
          if (strength <= 0) continue;
          const key = `${y},${x}`;
          const entry = accumulated.get(key) ?? { cell: Object.freeze(cell), intensity: 0, contributions: [] };
          entry.intensity += strength;
          entry.contributions.push(Object.freeze({
            lightId: light.id, intensity: strength,
            color: light.color,
            angularStrength,
            shadowStrength: light.shadowStrength
          }));
          accumulated.set(key, entry);
        }
      }
    }

    const cells = [...accumulated.values()]
      .sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x)
      .map((entry) => Object.freeze({
        cell: entry.cell,
        intensity: entry.intensity,
        contributions: Object.freeze(entry.contributions.sort((a, b) => a.lightId < b.lightId ? -1 : a.lightId > b.lightId ? 1 : 0))
      }));
    return Object.freeze({ worldId: id, bounds: Object.freeze({ minX, minY, maxX, maxY }), cells: Object.freeze(cells) });
  }
}
