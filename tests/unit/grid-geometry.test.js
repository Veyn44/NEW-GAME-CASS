import test from "node:test";
import assert from "node:assert/strict";

import {
  GridGeometryError,
  assertCellInBounds,
  cellToWorldCenter,
  chebyshevDistance,
  getAdjacentNeighbors,
  getOrthogonalNeighbors,
  isCellInBounds,
  manhattanDistance,
  validateCellCoordinate,
  validateGridDescriptor,
  worldPositionToCell
} from "../../engine/spatial/grid-geometry.js";

function expectCode(operation, code) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof GridGeometryError);
    assert.equal(error.code, code);
    return true;
  });
}

test("grid descriptors require positive safe-integer dimensions", () => {
  const descriptor = { width: 128, height: 64 };
  const validated = validateGridDescriptor(descriptor);

  assert.deepEqual(validated, { width: 128, height: 64 });
  assert.notEqual(validated, descriptor);
  assert.equal(Object.isFrozen(validated), true);
  assert.deepEqual(validateGridDescriptor({ width: 1, height: 1 }), { width: 1, height: 1 });
  assert.deepEqual(validateGridDescriptor({ width: Number.MAX_SAFE_INTEGER, height: 1 }), {
    width: Number.MAX_SAFE_INTEGER,
    height: 1
  });
});

test("grid descriptor rejects missing, non-object, fractional, unsafe and non-positive dimensions", () => {
  for (const descriptor of [null, undefined, [], "128x128"]) {
    expectCode(() => validateGridDescriptor(descriptor), "INVALID_GRID_DESCRIPTOR");
  }

  for (const descriptor of [
    {},
    { width: 0, height: 1 },
    { width: -1, height: 1 },
    { width: 1, height: 0 },
    { width: 1.5, height: 1 },
    { width: 1, height: 1.5 },
    { width: Number.MAX_SAFE_INTEGER + 1, height: 1 },
    { width: 1, height: Infinity },
    { width: NaN, height: 1 }
  ]) {
    expectCode(() => validateGridDescriptor(descriptor), "INVALID_GRID_DIMENSIONS");
  }
});

test("cell coordinates require safe integers and normalize negative zero", () => {
  assert.deepEqual(validateCellCoordinate({ x: 0, y: 5 }), { x: 0, y: 5 });
  assert.deepEqual(validateCellCoordinate({ x: -0, y: -0 }), { x: 0, y: 0 });

  for (const cell of [null, undefined, [], "1,2"]) {
    expectCode(() => validateCellCoordinate(cell), "INVALID_CELL_COORDINATE");
  }

  for (const cell of [
    { x: 1.25, y: 2 },
    { x: 1, y: 2.5 },
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
    { x: Number.MAX_SAFE_INTEGER + 1, y: 0 }
  ]) {
    expectCode(() => validateCellCoordinate(cell), "INVALID_CELL_COORDINATE");
  }
});

test("bounds are half-open and support rectangular grids", () => {
  const grid = { width: 3, height: 2 };

  assert.equal(isCellInBounds({ x: 0, y: 0 }, grid), true);
  assert.equal(isCellInBounds({ x: 2, y: 1 }, grid), true);
  assert.equal(isCellInBounds({ x: 3, y: 1 }, grid), false);
  assert.equal(isCellInBounds({ x: 2, y: 2 }, grid), false);
  assert.equal(isCellInBounds({ x: -1, y: 0 }, grid), false);
  assert.equal(isCellInBounds({ x: 0, y: -1 }, grid), false);
  assert.deepEqual(assertCellInBounds({ x: 2, y: 1 }, grid), { x: 2, y: 1 });
  expectCode(() => assertCellInBounds({ x: 3, y: 1 }, grid), "CELL_OUT_OF_BOUNDS");
  expectCode(() => assertCellInBounds({ x: 0.5, y: 1 }, grid), "INVALID_CELL_COORDINATE");
});

test("world positions map to cells with floor semantics, including negatives", () => {
  assert.deepEqual(worldPositionToCell({ x: 0, y: 0 }), { x: 0, y: 0 });
  assert.deepEqual(worldPositionToCell({ x: 2.99, y: 4.01 }), { x: 2, y: 4 });
  assert.deepEqual(worldPositionToCell({ x: -0.01, y: -1.2 }), { x: -1, y: -2 });
  assert.deepEqual(worldPositionToCell({ x: -0, y: 0.99 }), { x: 0, y: 0 });
});

test("world position conversion rejects non-finite and unsafe cell results", () => {
  for (const position of [null, undefined, [], "1,2"]) {
    expectCode(() => worldPositionToCell(position), "INVALID_WORLD_POSITION");
  }
  for (const position of [
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
    { x: Number.MAX_VALUE, y: 0 },
    { x: 0, y: -Number.MAX_VALUE }
  ]) {
    expectCode(() => worldPositionToCell(position), "INVALID_WORLD_POSITION");
  }
});

test("cell centers use the approved anchor-plus-half-cell mapping", () => {
  assert.deepEqual(cellToWorldCenter({ x: 0, y: 0 }), { x: 0.5, y: 0.5 });
  assert.deepEqual(cellToWorldCenter({ x: 3, y: 5 }), { x: 3.5, y: 5.5 });
  assert.deepEqual(cellToWorldCenter({ x: -1, y: -2 }), { x: -0.5, y: -1.5 });
  expectCode(() => cellToWorldCenter({ x: 1.5, y: 0 }), "INVALID_CELL_COORDINATE");
});

test("orthogonal neighbors are deterministic and clipped at grid edges", () => {
  assert.deepEqual(getOrthogonalNeighbors({ x: 1, y: 1 }, { width: 3, height: 3 }), [
    { x: 1, y: 0 },
    { x: 2, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 1 }
  ]);
  assert.deepEqual(getOrthogonalNeighbors({ x: 0, y: 0 }, { width: 3, height: 3 }), [
    { x: 1, y: 0 },
    { x: 0, y: 1 }
  ]);
  assert.deepEqual(getOrthogonalNeighbors({ x: 0, y: 0 }, { width: 1, height: 1 }), []);
});

test("adjacent neighbors include diagonals in deterministic clockwise order", () => {
  assert.deepEqual(getAdjacentNeighbors({ x: 1, y: 1 }, { width: 3, height: 3 }), [
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
    { x: 0, y: 0 }
  ]);
  assert.deepEqual(getAdjacentNeighbors({ x: 0, y: 0 }, { width: 3, height: 2 }), [
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 }
  ]);
});

test("neighbor queries reject invalid or out-of-bounds source cells", () => {
  expectCode(() => getOrthogonalNeighbors({ x: 0.5, y: 0 }, { width: 2, height: 2 }), "INVALID_CELL_COORDINATE");
  expectCode(() => getAdjacentNeighbors({ x: 2, y: 0 }, { width: 2, height: 2 }), "CELL_OUT_OF_BOUNDS");
});

test("neighbor results and coordinate values are immutable", () => {
  const neighbors = getOrthogonalNeighbors({ x: 1, y: 1 }, { width: 3, height: 3 });
  assert.equal(Object.isFrozen(neighbors), true);
  assert.equal(Object.isFrozen(neighbors[0]), true);
  assert.throws(() => neighbors.push({ x: 9, y: 9 }), TypeError);
});

test("Manhattan and Chebyshev distances use their named metrics", () => {
  const a = { x: 2, y: 3 };
  const b = { x: 5, y: 7 };

  assert.equal(manhattanDistance(a, b), 7);
  assert.equal(chebyshevDistance(a, b), 4);
  assert.equal(manhattanDistance(a, a), 0);
  assert.equal(chebyshevDistance(a, a), 0);
  assert.equal(manhattanDistance({ x: -2, y: -4 }, { x: 1, y: 2 }), 9);
});

test("distance helpers reject fractional coordinates and unsafe results", () => {
  expectCode(() => manhattanDistance({ x: 0.5, y: 0 }, { x: 1, y: 1 }), "INVALID_CELL_COORDINATE");
  expectCode(() => chebyshevDistance({ x: 0, y: 0 }, { x: Number.MAX_SAFE_INTEGER, y: 0 }), "DISTANCE_OUT_OF_RANGE");
  expectCode(() => manhattanDistance(
    { x: -Number.MAX_SAFE_INTEGER, y: 0 },
    { x: Number.MAX_SAFE_INTEGER, y: 0 }
  ), "DISTANCE_OUT_OF_RANGE");
});
