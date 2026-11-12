import test from "node:test";
import assert from "node:assert/strict";
import {
  PRIMARY_WORLD_SIZES,
  createWorldDescriptor,
  getVisibleDimensions,
  clampCameraPosition,
  CAMERA_OVERSCAN_TILES
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

test("base viewport shows 64 by 32 fields and zoom changes only the view", () => {
  assert.deepEqual(getVisibleDimensions(1), { columns: 64, rows: 32 });
  assert.deepEqual(getVisibleDimensions(2), { columns: 32, rows: 16 });
  assert.deepEqual(getVisibleDimensions(0.5), { columns: 128, rows: 64 });
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

test("invalid zoom values are rejected", () => {
  assert.throws(() => getVisibleDimensions(0), TypeError);
  assert.throws(() => getVisibleDimensions(Number.NaN), TypeError);
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
