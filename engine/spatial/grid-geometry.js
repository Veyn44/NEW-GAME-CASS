/**
 * Pure, application-neutral helpers for finite square-topology grids.
 *
 * This module does not register grid capability on a World and does not own
 * cell contents or entity occupancy. World Registry owns the optional grid
 * descriptor; spatial services consume the validated geometry.
 */

export class GridGeometryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GridGeometryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertRecord(value, code, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GridGeometryError(code, `${label} must be an object.`);
  }
  return value;
}

/** Validates and detaches a finite rectangular grid descriptor. */
export function validateGridDescriptor(descriptor) {
  assertRecord(descriptor, "INVALID_GRID_DESCRIPTOR", "Grid descriptor");
  const { width, height } = descriptor;

  if (!Number.isSafeInteger(width) || width <= 0
    || !Number.isSafeInteger(height) || height <= 0) {
    throw new GridGeometryError(
      "INVALID_GRID_DIMENSIONS",
      "Grid width and height must be positive safe integers.",
      { width, height }
    );
  }

  return Object.freeze({ width, height });
}

/** Validates a discrete cell coordinate and returns a detached immutable pair. */
export function validateCellCoordinate(cell) {
  assertRecord(cell, "INVALID_CELL_COORDINATE", "Cell coordinate");
  const { x, y } = cell;

  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
    throw new GridGeometryError(
      "INVALID_CELL_COORDINATE",
      "Cell x and y coordinates must be safe integers.",
      { x, y }
    );
  }

  return Object.freeze({
    x: Object.is(x, -0) ? 0 : x,
    y: Object.is(y, -0) ? 0 : y
  });
}

/** Returns whether a valid integer cell lies inside the grid's half-open bounds. */
export function isCellInBounds(cell, descriptor) {
  const point = validateCellCoordinate(cell);
  const grid = validateGridDescriptor(descriptor);
  return point.x >= 0 && point.y >= 0
    && point.x < grid.width && point.y < grid.height;
}

/** Validates a cell coordinate and throws when it lies outside the grid. */
export function assertCellInBounds(cell, descriptor) {
  const point = validateCellCoordinate(cell);
  const grid = validateGridDescriptor(descriptor);

  if (point.x < 0 || point.y < 0 || point.x >= grid.width || point.y >= grid.height) {
    throw new GridGeometryError(
      "CELL_OUT_OF_BOUNDS",
      `Cell (${point.x}, ${point.y}) is outside the grid.`,
      { x: point.x, y: point.y, width: grid.width, height: grid.height }
    );
  }
  return point;
}

/**
 * Maps a continuous world-space point to its containing cell using floor
 * semantics. Negative positions remain negative cells and are not clamped.
 */
export function worldPositionToCell(position) {
  assertRecord(position, "INVALID_WORLD_POSITION", "World position");
  const { x, y } = position;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new GridGeometryError(
      "INVALID_WORLD_POSITION",
      "World x and y positions must be finite numbers.",
      { x, y }
    );
  }

  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  if (!Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellY)) {
    throw new GridGeometryError(
      "INVALID_WORLD_POSITION",
      "World position is outside the safely representable cell-coordinate range.",
      { x, y }
    );
  }

  return Object.freeze({
    x: Object.is(cellX, -0) ? 0 : cellX,
    y: Object.is(cellY, -0) ? 0 : cellY
  });
}

/** Maps a discrete anchor cell to its world-space center. */
export function cellToWorldCenter(cell) {
  const point = validateCellCoordinate(cell);
  return Object.freeze({ x: point.x + 0.5, y: point.y + 0.5 });
}

function enumerateNeighbors(cell, descriptor, offsets) {
  const point = assertCellInBounds(cell, descriptor);
  const grid = validateGridDescriptor(descriptor);
  const neighbors = [];

  for (const [dx, dy] of offsets) {
    const x = point.x + dx;
    const y = point.y + dy;
    if (x >= 0 && y >= 0 && x < grid.width && y < grid.height) {
      neighbors.push(Object.freeze({ x, y }));
    }
  }

  return Object.freeze(neighbors);
}

/** Returns in-bounds north, east, south and west neighbors, in that order. */
export function getOrthogonalNeighbors(cell, descriptor) {
  return enumerateNeighbors(cell, descriptor, [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0]
  ]);
}

/** Returns in-bounds neighbors clockwise from north, including diagonals. */
export function getAdjacentNeighbors(cell, descriptor) {
  return enumerateNeighbors(cell, descriptor, [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1]
  ]);
}

function assertSafeDistance(distance, metric) {
  if (!Number.isSafeInteger(distance)) {
    throw new GridGeometryError(
      "DISTANCE_OUT_OF_RANGE",
      `${metric} distance exceeds the safely representable integer range.`,
      { metric, distance }
    );
  }
  return distance;
}

/** Returns Manhattan distance between two integer cell coordinates. */
export function manhattanDistance(from, to) {
  const a = validateCellCoordinate(from);
  const b = validateCellCoordinate(to);
  return assertSafeDistance(Math.abs(a.x - b.x) + Math.abs(a.y - b.y), "Manhattan");
}

/** Returns Chebyshev distance between two integer cell coordinates. */
export function chebyshevDistance(from, to) {
  const a = validateCellCoordinate(from);
  const b = validateCellCoordinate(to);
  return assertSafeDistance(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)), "Chebyshev");
}
