export const PRIMARY_WORLD_SIZES = Object.freeze([64, 128, 256]);
export const BASE_VIEW_COLUMNS = 64;
export const BASE_VIEW_ROWS = 32;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const CAMERA_OVERSCAN_TILES = 20;

export function createWorldDescriptor(size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError("World size must be a positive integer.");
  }
  return Object.freeze({ width: size, height: size, shape: "square" });
}

export function getVisibleDimensions(zoom) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new TypeError("Zoom must be a positive finite number.");
  }
  return {
    columns: BASE_VIEW_COLUMNS / zoom,
    rows: BASE_VIEW_ROWS / zoom
  };
}

export function clampCameraPosition(
  camera,
  worldSize,
  view,
  overscan = CAMERA_OVERSCAN_TILES
) {
  if (!Number.isFinite(overscan) || overscan < 0) {
    throw new TypeError("Camera overscan must be a non-negative finite number.");
  }

  const halfColumns = view.columns / 2;
  const halfRows = view.rows / 2;
  const minX = -overscan + halfColumns;
  const maxX = worldSize + overscan - halfColumns;
  const minY = -overscan + halfRows;
  const maxY = worldSize + overscan - halfRows;

  return {
    x: minX <= maxX
      ? Math.max(minX, Math.min(maxX, camera.x))
      : worldSize / 2,
    y: minY <= maxY
      ? Math.max(minY, Math.min(maxY, camera.y))
      : worldSize / 2
  };
}
