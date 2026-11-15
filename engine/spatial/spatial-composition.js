import { assertCellInBounds, validateCellCoordinate, getOrthogonalNeighbors, getAdjacentNeighbors, manhattanDistance, chebyshevDistance } from "./grid-geometry.js";
import { PLACEMENT_AUTHORITY } from "./placement-authority.js";

const VERSION = 1;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/;
const CATEGORY = /^[a-z][a-z0-9.-]{0,79}$/;
const ORIENTATIONS = new Set([0, 90, 180, 270]);

export class SpatialCompositionError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = "SpatialCompositionError"; this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
function id(value, label) {
  if (typeof value !== "string" || !ID.test(value)) throw new SpatialCompositionError("INVALID_ID", `${label} must be a stable ID.`, { value });
  return value;
}
function category(value, label = "Category ID") {
  if (typeof value !== "string" || !CATEGORY.test(value)) throw new SpatialCompositionError("INVALID_CATEGORY", `${label} must be a stable lowercase ID.`, { value });
  return value;
}
function clone(value, path = "payload", seen = new Set()) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || seen.has(value)) throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} contains an unsupported or circular value.`);
  let proto, keys, array;
  try { proto = Object.getPrototypeOf(value); keys = Reflect.ownKeys(value); array = Array.isArray(value); }
  catch { throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} could not be inspected safely.`); }
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} must contain plain objects and arrays.`);
  seen.add(value);
  try {
    if (array) {
      const out = new Array(value.length), indexes = new Set();
      for (const key of keys) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} has an unsupported array property.`);
        const d = Object.getOwnPropertyDescriptor(value, key);
        if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} has an accessor or hidden array property.`);
        indexes.add(Number(key)); out[Number(key)] = clone(d.value, `${path}[${key}]`, seen);
      }
      if (indexes.size !== value.length) throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} contains a sparse array.`);
      return Object.freeze(out);
    }
    const out = Object.create(null);
    for (const key of keys) {
      if (typeof key !== "string") throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} contains a symbol key.`);
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d?.enumerable || !Object.hasOwn(d, "value")) throw new SpatialCompositionError("INVALID_PAYLOAD", `${path}.${key} is not a plain data property.`);
      Object.defineProperty(out, key, { value: clone(d.value, `${path}.${key}`, seen), enumerable: true });
    }
    return Object.freeze(out);
  } finally { seen.delete(value); }
}
function cellKey(worldId, cell) { return `${worldId}\\u0000${cell.x},${cell.y}`; }
function compare(a, b) { return a.cell.y - b.cell.y || a.cell.x - b.cell.x || a.categoryId.localeCompare(b.categoryId) || a.contentId.localeCompare(b.contentId); }
function freezeRecord(raw) {
  return Object.freeze({ contentId: raw.contentId, worldId: raw.worldId, cell: validateCellCoordinate(raw.cell),
    categoryId: raw.categoryId, layerId: raw.layerId, payload: clone(raw.payload) });
}

/** Canonical unique offsets, sorted row-major; (0,0) is mandatory. */
export function normalizeFootprintOffsets(offsets) {
  if (!Array.isArray(offsets) || offsets.length === 0) throw new SpatialCompositionError("INVALID_FOOTPRINT", "Footprint must be a non-empty array.");
  const seen = new Set(), result = offsets.map((offset, index) => {
    let point;
    try { point = validateCellCoordinate(offset); }
    catch (error) { throw new SpatialCompositionError("INVALID_FOOTPRINT_OFFSET", `Footprint offset ${index} is invalid.`, { index, causeCode: error.code ?? null }); }
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) throw new SpatialCompositionError("DUPLICATE_FOOTPRINT_OFFSET", `Footprint repeats offset ${key}.`);
    seen.add(key); return point;
  });
  if (!seen.has("0,0")) throw new SpatialCompositionError("FOOTPRINT_MISSING_ORIGIN", "Footprint must include (0,0).");
  result.sort((a, b) => a.y - b.y || a.x - b.x);
  return Object.freeze(result);
}
export function rotateFootprintOffset(offset, orientation = 0) {
  let p;
  try { p = validateCellCoordinate(offset); }
  catch (error) { throw new SpatialCompositionError("INVALID_FOOTPRINT_OFFSET", "Offset must use safe integer coordinates.", { causeCode: error.code ?? null }); }
  if (!ORIENTATIONS.has(orientation)) throw new SpatialCompositionError("INVALID_ORIENTATION", "Orientation must be 0, 90, 180 or 270 degrees.", { orientation });
  if (orientation === 90) return Object.freeze({ x: -p.y, y: p.x });
  if (orientation === 180) return Object.freeze({ x: -p.x, y: -p.y });
  if (orientation === 270) return Object.freeze({ x: p.y, y: -p.x });
  return p;
}
/** Geometry-only footprint derivation; this does not mutate entity occupancy. */
export function deriveFootprintCells({ anchor, footprint, orientation = 0, grid } = {}) {
  let origin;
  try { origin = validateCellCoordinate(anchor); }
  catch (error) { throw new SpatialCompositionError("INVALID_ANCHOR", "Anchor must use safe integer coordinates.", { causeCode: error.code ?? null }); }
  const cells = normalizeFootprintOffsets(footprint).map((offset) => {
    const rotated = rotateFootprintOffset(offset, orientation), x = origin.x + rotated.x, y = origin.y + rotated.y;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new SpatialCompositionError("FOOTPRINT_OUT_OF_RANGE", "Transformed cell exceeds the safe integer range.");
    try { return assertCellInBounds({ x, y }, grid); }
    catch (error) { throw new SpatialCompositionError("FOOTPRINT_OUT_OF_BOUNDS", "A transformed footprint cell lies outside the grid.", { cell: { x, y }, causeCode: error.code ?? null }); }
  });
  cells.sort((a, b) => a.y - b.y || a.x - b.x);
  return Object.freeze(cells);
}

/**
 * Sparse cell-associated content store. Entity occupancy writes are deliberately
 * withheld until a WorldContext + SpatialComposition coordinator exists.
 */
export class SpatialComposition {
  #worlds; #entities; #idFactory; #contents = new Map(); #byCell = new Map(); #reserved = new Set();
  #entityOccupancies = new Map(); #entitiesByCell = new Map();
  constructor({ worldRegistry, entityRegistry = null, idFactory = defaultIdFactory } = {}) {
    if (!worldRegistry || typeof worldRegistry.get !== "function") throw new SpatialCompositionError("INVALID_WORLD_REGISTRY", "A WorldRegistry-compatible service is required.");
    if (typeof idFactory !== "function") throw new SpatialCompositionError("INVALID_ID_FACTORY", "idFactory must be a function.");
    if (entityRegistry !== null && typeof entityRegistry.get !== "function") throw new SpatialCompositionError("INVALID_ENTITY_REGISTRY", "entityRegistry must provide get() when supplied.");
    this.#worlds = worldRegistry; this.#entities = entityRegistry; this.#idFactory = idFactory;
  }
  get size() { return this.#contents.size; }
  get entityOccupancyCount() { return this.#entityOccupancies.size; }
  hasEntityOccupancy(entityId) { return this.#entityOccupancies.has(id(entityId, "Entity ID")); }
  getEntityOccupancy(entityId) { return this.#entityOccupancies.get(id(entityId, "Entity ID")) ?? null; }
  listEntityOccupancies({ worldId = null } = {}) {
    if (worldId !== null) id(worldId, "World ID");
    return Object.freeze([...this.#entityOccupancies.values()].filter((r) => worldId === null || r.worldId === worldId).sort((a,b) => a.entityId.localeCompare(b.entityId)));
  }
  getCellEntities(worldId, cell) {
    const world = this.#requireGridWorld(worldId), point = this.#cell(cell, world), ids = this.#entitiesByCell.get(cellKey(worldId, point));
    return Object.freeze(ids ? [...ids].sort() : []);
  }

  /** Read-only combined view of explicit cell contents and entity occupancy. */
  queryCell(worldId, cell, { categories = null, layers = null, kinds = null } = {}) {
    const world = this.#requireGridWorld(worldId), point = this.#cell(cell, world);
    const filters = this.#normalizeFilters(categories, layers, kinds);
    const contents = this.getCellContents(worldId, point).filter((r) =>
      (!filters.categories || filters.categories.has(r.categoryId))
      && (!filters.layers || (r.layerId !== null && filters.layers.has(r.layerId))));
    const entityIds = this.getCellEntities(worldId, point).filter((entityId) => this.#matchesKind(entityId, filters.kinds));
    const entities = entityIds.map((entityId) => {
      const occupancy = this.#entityOccupancies.get(entityId);
      return Object.freeze({ entityId, worldId: occupancy.worldId, anchor: occupancy.anchor,
        footprint: occupancy.footprint, orientation: occupancy.orientation, cells: occupancy.cells,
        matchedCells: Object.freeze([point]) });
    });
    return Object.freeze({ worldId, cell: point, contents: Object.freeze(contents), entities: Object.freeze(entities) });
  }

  /**
   * Query a bounded rectangle or finite cell set. Only matching occupied cells
   * are returned, so large sparse rectangles do not require materializing every
   * untouched cell.
   */
  queryRegion(worldId, region, { categories = null, layers = null, kinds = null } = {}) {
    const world = this.#requireGridWorld(worldId), filters = this.#normalizeFilters(categories, layers, kinds);
    const normalized = this.#normalizeRegion(region, world.grid);
    const byCell = new Map();
    const include = (cell) => normalized.contains(cell);
    for (const record of this.#contents.values()) {
      if (record.worldId !== worldId || !include(record.cell)) continue;
      if (filters.categories && !filters.categories.has(record.categoryId)) continue;
      if (filters.layers && (record.layerId === null || !filters.layers.has(record.layerId))) continue;
      const key = `${record.cell.y},${record.cell.x}`, entry = byCell.get(key) ?? { cell: record.cell, contents: [], entityIds: new Set() };
      entry.contents.push(record); byCell.set(key, entry);
    }
    for (const occupancy of this.#entityOccupancies.values()) {
      if (occupancy.worldId !== worldId) continue;
      if (!this.#matchesKind(occupancy.entityId, filters.kinds)) continue;
      const matched = occupancy.cells.filter(include);
      for (const cell of matched) {
        const key = `${cell.y},${cell.x}`, entry = byCell.get(key) ?? { cell, contents: [], entityIds: new Set() };
        entry.entityIds.add(occupancy.entityId); byCell.set(key, entry);
      }
    }
    const cells = [...byCell.values()].sort((a,b) => a.cell.y-b.cell.y || a.cell.x-b.cell.x).map((entry) => {
      const entities = [...entry.entityIds].sort().map((entityId) => {
        const occupancy = this.#entityOccupancies.get(entityId);
        return Object.freeze({ entityId, worldId: occupancy.worldId, anchor: occupancy.anchor,
          footprint: occupancy.footprint, orientation: occupancy.orientation,
          cells: occupancy.cells, matchedCells: Object.freeze([entry.cell]) });
      });
      entry.contents.sort((a,b) => a.contentId < b.contentId ? -1 : a.contentId > b.contentId ? 1 : 0);
      return Object.freeze({ cell: entry.cell, contents: Object.freeze(entry.contents), entities: Object.freeze(entities) });
    });
    const entityMatches = new Map();
    for (const entry of cells) for (const entity of entry.entities) {
      const current = entityMatches.get(entity.entityId) ?? { ...entity, matchedCells: [] };
      current.matchedCells.push(entry.cell); entityMatches.set(entity.entityId, current);
    }
    const entities = [...entityMatches.values()].sort((a,b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0)
      .map((r) => Object.freeze({ ...r, matchedCells: Object.freeze(r.matchedCells) }));
    const contents = cells.flatMap((entry) => entry.contents);
    return Object.freeze({ worldId, region: normalized.descriptor, cells: Object.freeze(cells),
      contents: Object.freeze(contents), entities: Object.freeze(entities) });
  }

  queryEntitiesInRegion(worldId, region, { kinds = null } = {}) {
    return this.queryRegion(worldId, region, { kinds }).entities;
  }

  getEntityFootprint(entityId) {
    const key = id(entityId, "Entity ID"), occupancy = this.#entityOccupancies.get(key);
    if (occupancy) return occupancy;
    if (this.#entities && !this.#entities.get(key)) throw new SpatialCompositionError("UNKNOWN_ENTITY", `Entity "${key}" is not registered.`, { entityId: key });
    throw new SpatialCompositionError("ENTITY_NOT_SPATIALLY_PLACED", `Entity "${key}" has no grid occupancy.`, { entityId: key });
  }

  queryNeighbors(worldId, cell, { topology } = {}) {
    const world = this.#requireGridWorld(worldId);
    const neighbors = topology === "four-way" ? getOrthogonalNeighbors(cell, world.grid)
      : topology === "eight-way" ? getAdjacentNeighbors(cell, world.grid)
      : (() => { throw new SpatialCompositionError("INVALID_TOPOLOGY", "topology must be four-way or eight-way.", { topology }); })();
    return Object.freeze(neighbors.map((point) => this.queryCell(worldId, point)));
  }

  queryRadius(worldId, center, { radius, metric } = {}) {
    const world = this.#requireGridWorld(worldId), origin = this.#cell(center, world);
    if (!Number.isSafeInteger(radius) || radius < 0) throw new SpatialCompositionError("INVALID_RADIUS", "radius must be a non-negative safe integer.", { radius });
    if (metric !== "manhattan" && metric !== "chebyshev") throw new SpatialCompositionError("INVALID_METRIC", "metric must be manhattan or chebyshev.", { metric });
    const distance = metric === "manhattan" ? manhattanDistance : chebyshevDistance;
    const cells = [];
    const minX = Math.max(0, origin.x - radius), maxX = Math.min(world.grid.width - 1, origin.x + radius);
    const minY = Math.max(0, origin.y - radius), maxY = Math.min(world.grid.height - 1, origin.y + radius);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const point = Object.freeze({ x, y });
      if (distance(origin, point) <= radius) cells.push(point);
    }
    return this.queryRegion(worldId, { type: "cells", cells });
  }

  #normalizeFilters(categories, layers, kinds) {
    const normalize = (values, label) => {
      if (values === null || values === undefined) return null;
      if (!Array.isArray(values)) throw new SpatialCompositionError("INVALID_QUERY_FILTER", `${label} must be an array.`, { filter: label });
      const result = new Set(values.map((value) => category(value, label)));
      return result.size ? result : null;
    };
    const normalizedKinds = normalize(kinds, "Entity kind");
    if (normalizedKinds && !this.#entities) throw new SpatialCompositionError("ENTITY_REGISTRY_UNAVAILABLE", "Entity kind filters require an Entity Registry.");
    return { categories: normalize(categories, "Category ID"), layers: normalize(layers, "Layer ID"), kinds: normalizedKinds };
  }

  #matchesKind(entityId, kinds) {
    if (!kinds) return true;
    if (!this.#entities) throw new SpatialCompositionError("ENTITY_REGISTRY_UNAVAILABLE", "Entity kind filters require an Entity Registry.");
    const entity = this.#entities.get(entityId);
    return Boolean(entity && kinds.has(entity.kind));
  }

  #normalizeRegion(region, grid) {
    if (!region || typeof region !== "object" || Array.isArray(region)) throw new SpatialCompositionError("INVALID_REGION", "Region must be an object.");
    if (region.type === "cells") {
      if (!Array.isArray(region.cells)) throw new SpatialCompositionError("INVALID_REGION", "Cell region requires a cells array.");
      const unique = new Map();
      for (const raw of region.cells) {
        const point = this.#cell(raw, { grid });
        unique.set(`${point.y},${point.x}`, point);
      }
      const cells = Object.freeze([...unique.values()].sort((a,b) => a.y-b.y || a.x-b.x));
      const keys = new Set(cells.map((p) => `${p.y},${p.x}`));
      return Object.freeze({ descriptor: Object.freeze({ type: "cells", cells }), contains: (p) => keys.has(`${p.y},${p.x}`) });
    }
    if (region.type === "rectangle") {
      let min, max;
      try { min = validateCellCoordinate(region.min); max = validateCellCoordinate(region.maxExclusive); }
      catch (error) { throw new SpatialCompositionError("INVALID_REGION", "Rectangle bounds must be safe integer cell coordinates.", { causeCode: error.code ?? null }); }
      if (max.x <= min.x || max.y <= min.y) throw new SpatialCompositionError("INVALID_REGION", "Rectangle maxExclusive must be greater than min on both axes.");
      if (min.x < 0 || min.y < 0 || max.x > grid.width || max.y > grid.height) throw new SpatialCompositionError("REGION_OUT_OF_BOUNDS", "Rectangle must lie fully inside the grid.", { min, maxExclusive: max });
      const descriptor = Object.freeze({ type: "rectangle", min, maxExclusive: max });
      return Object.freeze({ descriptor, contains: (p) => p.x >= min.x && p.y >= min.y && p.x < max.x && p.y < max.y });
    }
    throw new SpatialCompositionError("INVALID_REGION", "Region type must be rectangle or cells.", { type: region.type });
  }
  prepareEntityOccupancyChange(entityId, nextOccupancy, authority) {
    if (authority !== PLACEMENT_AUTHORITY) throw new SpatialCompositionError("PLACEMENT_AUTHORITY_REQUIRED", "Only PlacementCoordinator may change entity occupancy.");
    const key = id(entityId, "Entity ID"); let nextRecord = null;
    if (nextOccupancy !== null) {
      if (!nextOccupancy || typeof nextOccupancy !== "object" || Array.isArray(nextOccupancy)) throw new SpatialCompositionError("INVALID_OCCUPANCY", "Occupancy must be an object or null.");
      const world = this.#requireGridWorld(nextOccupancy.worldId), anchor = this.#cell(nextOccupancy.anchor, world);
      const footprint = normalizeFootprintOffsets(nextOccupancy.footprint), orientation = nextOccupancy.orientation ?? 0;
      const cells = deriveFootprintCells({ anchor, footprint, orientation, grid: world.grid });
      nextRecord = Object.freeze({ entityId: key, worldId: nextOccupancy.worldId, anchor, footprint, orientation, cells });
    }
    const previousMaps = { occupancies: this.#entityOccupancies, byCell: this.#entitiesByCell };
    const nextOccupancies = new Map(this.#entityOccupancies), nextByCell = new Map([...this.#entitiesByCell].map(([k,v]) => [k,new Set(v)]));
    const previous = nextOccupancies.get(key) ?? null;
    if (previous) for (const cell of previous.cells) {
      const k = cellKey(previous.worldId, cell), ids = nextByCell.get(k); ids?.delete(key); if (ids?.size === 0) nextByCell.delete(k);
    }
    if (nextRecord) {
      nextOccupancies.set(key, nextRecord);
      for (const cell of nextRecord.cells) { const k = cellKey(nextRecord.worldId, cell), ids = nextByCell.get(k) ?? new Set(); ids.add(key); nextByCell.set(k, ids); }
    } else nextOccupancies.delete(key);
    let committed = false;
    return Object.freeze({
      previous, current: nextRecord,
      commit: () => { if (committed) throw new SpatialCompositionError("TRANSACTION_ALREADY_COMMITTED", "Occupancy transaction already committed."); this.#entityOccupancies = nextOccupancies; this.#entitiesByCell = nextByCell; committed = true; },
      rollback: () => { if (!committed) return false; this.#entityOccupancies = previousMaps.occupancies; this.#entitiesByCell = previousMaps.byCell; committed = false; return true; }
    });
  }
  getContent(contentId) { return this.#contents.get(id(contentId, "Content ID")) ?? null; }
  listContents({ worldId = null, categoryId = null, layerId = null } = {}) {
    if (worldId !== null) id(worldId, "World ID");
    if (categoryId !== null) category(categoryId);
    if (layerId !== null) category(layerId, "Layer ID");
    return Object.freeze([...this.#contents.values()].filter((r) => worldId === null || r.worldId === worldId)
      .filter((r) => categoryId === null || r.categoryId === categoryId)
      .filter((r) => layerId === null || r.layerId === layerId).sort(compare));
  }
  getCellContents(worldId, cell) {
    const world = this.#requireGridWorld(worldId), point = this.#cell(cell, world);
    const ids = this.#byCell.get(cellKey(worldId, point));
    if (!ids) return Object.freeze([]);
    return Object.freeze([...ids].map((key) => this.#contents.get(key)).filter(Boolean)
      .sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.contentId.localeCompare(b.contentId)));
  }
  addCellContent({ contentId = null, worldId, cell, categoryId, layerId = null, payload = {} } = {}) {
    const world = this.#requireGridWorld(worldId), point = this.#cell(cell, world);
    const cat = category(categoryId), layer = layerId === null ? null : category(layerId, "Layer ID");
    const contentKey = contentId === null ? this.#newId() : id(contentId, "Content ID");
    if (this.#reserved.has(contentKey)) throw new SpatialCompositionError("CONTENT_ID_ALREADY_USED", `Content ID "${contentKey}" has already been used.`);
    const record = freezeRecord({ contentId: contentKey, worldId, cell: point, categoryId: cat, layerId: layer, payload });
    const key = cellKey(worldId, point), cellIds = this.#byCell.get(key) ?? new Set();
    this.#reserved.add(contentKey); this.#contents.set(contentKey, record); cellIds.add(contentKey); this.#byCell.set(key, cellIds);
    return record;
  }
  removeCellContent(contentId) {
    const key = id(contentId, "Content ID"), record = this.#contents.get(key);
    if (!record) return false;
    const indexKey = cellKey(record.worldId, record.cell), ids = this.#byCell.get(indexKey);
    ids?.delete(key); if (ids?.size === 0) this.#byCell.delete(indexKey);
    this.#contents.delete(key); return true;
  }
  captureSnapshot() {
    return Object.freeze({ version: VERSION, reservedContentIds: Object.freeze([...this.#reserved].sort()),
      contents: Object.freeze(this.listContents().map((r) => ({ contentId: r.contentId, worldId: r.worldId,
        cell: { x: r.cell.x, y: r.cell.y }, categoryId: r.categoryId, layerId: r.layerId, payload: r.payload }))),
      entityOccupancies: Object.freeze(this.listEntityOccupancies().map((r) => ({ entityId: r.entityId, worldId: r.worldId,
        anchor: { x: r.anchor.x, y: r.anchor.y }, footprint: r.footprint.map((p) => ({ x: p.x, y: p.y })), orientation: r.orientation }))) });
  }
  prepareRestore(snapshot, { deferWorldValidation = false, authority = null } = {}) {
    const hasCurrentOccupancy = this.#entityOccupancies.size > 0;
    const hasSnapshotOccupancy = Array.isArray(snapshot?.entityOccupancies) && snapshot.entityOccupancies.length > 0;
    if ((hasCurrentOccupancy || hasSnapshotOccupancy) && authority !== PLACEMENT_AUTHORITY) {
      throw new SpatialCompositionError("PLACEMENT_AUTHORITY_REQUIRED", "Restoring entity occupancy requires the composite Placement Coordinator participant.");
    }
    const stableSnapshot = clone(snapshot, "snapshot");
    const next = deferWorldValidation ? null : this.#parse(stableSnapshot);
    const previous = { contents: this.#contents, byCell: this.#byCell, reserved: this.#reserved, entityOccupancies: this.#entityOccupancies, entitiesByCell: this.#entitiesByCell };
    let committed = false;
    return Object.freeze({
      commit: () => {
        if (committed) throw new SpatialCompositionError("RESTORE_ALREADY_COMMITTED", "Restore transaction was already committed.");
        const parsed = next ?? this.#parse(stableSnapshot);
        this.#contents = parsed.contents; this.#byCell = parsed.byCell; this.#reserved = parsed.reserved; this.#entityOccupancies = parsed.entityOccupancies; this.#entitiesByCell = parsed.entitiesByCell; committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#contents = previous.contents; this.#byCell = previous.byCell; this.#reserved = previous.reserved; this.#entityOccupancies = previous.entityOccupancies; this.#entitiesByCell = previous.entitiesByCell; committed = false; return true;
      }
    });
  }
  #parse(snapshot) {
    const safe = clone(snapshot, "snapshot");
    if (!safe || Array.isArray(safe) || safe.version !== VERSION || !Array.isArray(safe.contents) || !Array.isArray(safe.reservedContentIds))
      throw new SpatialCompositionError("INVALID_SNAPSHOT", "Spatial Composition snapshot has an unsupported version or shape.");
    const reserved = new Set();
    for (const raw of safe.reservedContentIds) {
      const key = id(raw, "Reserved content ID");
      if (reserved.has(key)) throw new SpatialCompositionError("DUPLICATE_RESERVED_ID", `Reserved ID "${key}" is duplicated.`);
      reserved.add(key);
    }
    const contents = new Map(), byCell = new Map(), entityOccupancies = new Map(), entitiesByCell = new Map();
    for (const raw of safe.contents) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SpatialCompositionError("INVALID_SNAPSHOT", "Content record must be an object.");
      const key = id(raw.contentId, "Content ID");
      if (contents.has(key)) throw new SpatialCompositionError("DUPLICATE_CONTENT_ID", `Content ID "${key}" is duplicated.`);
      if (!reserved.has(key)) throw new SpatialCompositionError("UNRESERVED_CONTENT_ID", `Active content ID "${key}" is not reserved.`);
      const world = this.#requireGridWorld(raw.worldId), point = this.#cell(raw.cell, world);
      const record = freezeRecord({ contentId: key, worldId: raw.worldId, cell: point,
        categoryId: category(raw.categoryId), layerId: raw.layerId === null ? null : category(raw.layerId, "Layer ID"), payload: raw.payload });
      contents.set(key, record);
      const indexKey = cellKey(record.worldId, record.cell);
      if (!byCell.has(indexKey)) byCell.set(indexKey, new Set());
      byCell.get(indexKey).add(key);
    }
    const rawOccupancies = safe.entityOccupancies ?? [];
    if (!Array.isArray(rawOccupancies)) throw new SpatialCompositionError("INVALID_SNAPSHOT", "entityOccupancies must be an array.");
    for (const raw of rawOccupancies) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SpatialCompositionError("INVALID_SNAPSHOT", "Entity occupancy must be an object.");
      const entityId = id(raw.entityId, "Entity ID");
      if (entityOccupancies.has(entityId)) throw new SpatialCompositionError("DUPLICATE_ENTITY_OCCUPANCY", `Entity "${entityId}" has duplicate occupancy records.`);
      const world = this.#requireGridWorld(raw.worldId), anchor = this.#cell(raw.anchor, world);
      const footprint = normalizeFootprintOffsets(raw.footprint), orientation = raw.orientation ?? 0;
      const cells = deriveFootprintCells({ anchor, footprint, orientation, grid: world.grid });
      entityOccupancies.set(entityId, Object.freeze({ entityId, worldId: raw.worldId, anchor, footprint, orientation, cells }));
      for (const cell of cells) { const k = cellKey(raw.worldId, cell), ids = entitiesByCell.get(k) ?? new Set(); ids.add(entityId); entitiesByCell.set(k, ids); }
    }
    return { contents, byCell, reserved, entityOccupancies, entitiesByCell };
  }
  #cell(cell, world) {
    try { return assertCellInBounds(cell, world.grid); }
    catch (error) { throw new SpatialCompositionError(error.code === "CELL_OUT_OF_BOUNDS" ? "CELL_OUT_OF_BOUNDS" : "INVALID_CELL", error.message, { causeCode: error.code ?? null }); }
  }
  #requireGridWorld(worldId) {
    const key = id(worldId, "World ID"), world = this.#worlds.get(key);
    if (!world) throw new SpatialCompositionError("UNKNOWN_WORLD", `World "${key}" is not registered.`);
    if (world.status === "closed") throw new SpatialCompositionError("WORLD_CLOSED", `World "${key}" is closed.`);
    if (world.grid === null) throw new SpatialCompositionError("WORLD_HAS_NO_GRID", `World "${key}" has no grid capability.`);
    return world;
  }
  #newId() {
    const generated = id(this.#idFactory(), "Generated content ID");
    const key = generated.startsWith("content:") ? generated : `content:${generated}`;
    if (this.#reserved.has(key)) throw new SpatialCompositionError("CONTENT_ID_ALREADY_USED", `Generated ID "${key}" has already been used.`);
    return key;
  }
}
function defaultIdFactory() {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject || typeof cryptoObject.randomUUID !== "function") throw new SpatialCompositionError("ID_GENERATION_UNAVAILABLE", "Secure randomUUID is required; provide idFactory when unavailable.");
  return cryptoObject.randomUUID();
}
