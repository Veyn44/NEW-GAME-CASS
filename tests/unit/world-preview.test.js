import test from "node:test";
import assert from "node:assert/strict";

const PRIMARY_WORLD_SIZES = Object.freeze([64, 128, 256]);
const BASE_VIEW_COLUMNS = 64;
const BASE_VIEW_ROWS = 32;

function createWorldDescriptor(size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError("World size must be a positive integer.");
  }
  return Object.freeze({ width: size, height: size, shape: "square" });
}

function getVisibleDimensions(zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new TypeError("Zoom must be a positive finite number.");
  }
  return {
    columns: BASE_VIEW_COLUMNS / zoom,
    rows: BASE_VIEW_ROWS / zoom
  };
}

test("primary world sizes are square and use the agreed dimensions", () => {
  assert.deepEqual(PRIMARY_WORLD_SIZES, [64, 128, 256]);
  for (const size of PRIMARY_WORLD_SIZES) {
    assert.deepEqual(createWorldDescriptor(size), {
      width: size,
      height: size,
      shape: "square"
    });
  }
});

test("world dimensions are not limited to the primary presets", () => {
  assert.deepEqual(createWorldDescriptor(512), {
    width: 512,
    height: 512,
    shape: "square"
  });
});

test("invalid world dimensions are rejected", () => {
  assert.throws(() => createWorldDescriptor(0), TypeError);
  assert.throws(() => createWorldDescriptor(64.5), TypeError);
  assert.throws(() => createWorldDescriptor(-64), TypeError);
});

test("base viewport shows 64 by 32 fields and zoom changes only the view", () => {
  assert.deepEqual(getVisibleDimensions(1), { columns: 64, rows: 32 });
  assert.deepEqual(getVisibleDimensions(2), { columns: 32, rows: 16 });
  assert.deepEqual(getVisibleDimensions(0.5), { columns: 128, rows: 64 });
});

test("invalid zoom values are rejected", () => {
  assert.throws(() => getVisibleDimensions(0), TypeError);
  assert.throws(() => getVisibleDimensions(Number.NaN), TypeError);
});
