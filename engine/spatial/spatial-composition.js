import { assertCellInBounds, validateCellCoordinate } from "./grid-geometry.js";

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
        if (typeof key !== "string" || !/^(0|[1-9]\\d*)$/.test(key) || Number(key) >= value.length) throw new SpatialCompositionError("INVALID_PAYLOAD", `${path} has an unsupported array property.`);
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
  #worlds; #idFactory; #contents = new Map(); #byCell = new Map(); #reserved = new Set();
  constructor({ worldRegistry, idFactory = defaultIdFactory } = {}) {
    if (!worldRegistry || typeof worldRegistry.get !== "function") throw new SpatialCompositionError("INVALID_WORLD_REGISTRY", "A WorldRegistry-compatible service is required.");
    if (typeof idFactory !== "function") throw new SpatialCompositionError("INVALID_ID_FACTORY", "idFactory must be a function.");
    this.#worlds = worldRegistry; this.#idFactory = idFactory;
  }
  get size() { return this.#contents.size; }
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
        cell: { x: r.cell.x, y: r.cell.y }, categoryId: r.categoryId, layerId: r.layerId, payload: r.payload }))) });
  }
  prepareRestore(snapshot) {
    const next = this.#parse(snapshot), previous = { contents: this.#contents, byCell: this.#byCell, reserved: this.#reserved };
    let committed = false;
    return Object.freeze({
      commit: () => {
        if (committed) throw new SpatialCompositionError("RESTORE_ALREADY_COMMITTED", "Restore transaction was already committed.");
        this.#contents = next.contents; this.#byCell = next.byCell; this.#reserved = next.reserved; committed = true;
      },
      rollback: () => {
        if (!committed) return false;
        this.#contents = previous.contents; this.#byCell = previous.byCell; this.#reserved = previous.reserved; committed = false; return true;
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
    const contents = new Map(), byCell = new Map();
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
    return { contents, byCell, reserved };
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
