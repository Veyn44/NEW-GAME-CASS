import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIMARY_WORLD_SIZES,
  createWorldDescriptor,
  getVisibleDimensions,
  clampCameraPosition,
  CAMERA_OVERSCAN_TILES,
  UNIT_MARKER_RADIUS_TILES,
  SELECTED_MARKER_OUTLINE_RADIUS_TILES
} from "../../src/adapters/presentation/world-preview-model.js";

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

test("viewport dimensions follow the actual canvas aspect ratio at every zoom", () => {
  assert.deepEqual(getVisibleDimensions(1, 2), { columns: 64, rows: 32 });
  assert.deepEqual(getVisibleDimensions(2, 2), { columns: 32, rows: 16 });
  assert.deepEqual(getVisibleDimensions(0.5, 2), { columns: 128, rows: 64 });
  assert.deepEqual(getVisibleDimensions(1, 16 / 9), { columns: 64, rows: 36 });
  assert.deepEqual(getVisibleDimensions(1, 4 / 3), { columns: 64, rows: 48 });
});

test("camera remains inside the square world and centers small worlds", () => {
  assert.deepEqual(
    clampCameraPosition({ x: -20, y: 300 }, 128, { columns: 64, rows: 32 }),
    { x: 32, y: 112 }
  );
  assert.deepEqual(
    clampCameraPosition({ x: 0, y: 0 }, 64, { columns: 128, rows: 64 }),
    { x: 32, y: 32 }
  );
});

test("Unit marker radius is fixed in world space and slightly under one tile", () => {
  assert.equal(UNIT_MARKER_RADIUS_TILES, 0.4);
  assert.equal(SELECTED_MARKER_OUTLINE_RADIUS_TILES, 0.48);
  for (const zoom of [0.5, 1, 2]) {
    const { columns } = getVisibleDimensions(zoom, 2);
    const cellWidth = 64 / columns;
    const markerRadiusPixels = cellWidth * UNIT_MARKER_RADIUS_TILES;
    assert.equal(markerRadiusPixels / cellWidth, 0.4);
  }
});

test("invalid zoom values are rejected", () => {
  assert.throws(() => getVisibleDimensions(0, 2), TypeError);
  assert.throws(() => getVisibleDimensions(Number.NaN, 2), TypeError);
  assert.throws(() => getVisibleDimensions(1, 0), TypeError);
  assert.throws(() => getVisibleDimensions(1, Number.NaN), TypeError);
});

test("camera allows up to 20 tiles of overscan beyond all four world edges", () => {
  assert.equal(CAMERA_OVERSCAN_TILES, 20);
  assert.deepEqual(
    clampCameraPosition(
      { x: 64, y: -100 },
      128,
      { columns: 64, rows: 32 },
      CAMERA_OVERSCAN_TILES
    ),
    { x: 64, y: -4 }
  );
  assert.deepEqual(
    clampCameraPosition(
      { x: 64, y: 300 },
      128,
      { columns: 64, rows: 32 },
      CAMERA_OVERSCAN_TILES
    ),
    { x: 64, y: 132 }
  );
  assert.deepEqual(
    clampCameraPosition(
      { x: -100, y: 64 },
      128,
      { columns: 64, rows: 32 },
      CAMERA_OVERSCAN_TILES
    ),
    { x: 12, y: 64 }
  );
  assert.deepEqual(
    clampCameraPosition(
      { x: 300, y: 64 },
      128,
      { columns: 64, rows: 32 },
      CAMERA_OVERSCAN_TILES
    ),
    { x: 116, y: 64 }
  );
});

test("camera centers on an axis when viewport exceeds world plus overscan", () => {
  assert.deepEqual(
    clampCameraPosition(
      { x: 32, y: -100 },
      64,
      { columns: 128, rows: 128 },
      CAMERA_OVERSCAN_TILES
    ),
    { x: 32, y: 32 }
  );
});
