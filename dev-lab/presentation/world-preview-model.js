export const PRIMARY_WORLD_SIZES = Object.freeze([64, 128, 256]);
export const BASE_VIEW_COLUMNS = 64;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const CAMERA_OVERSCAN_TILES = 20;
export const UNIT_MARKER_RADIUS_TILES = 0.4;
export const SELECTED_MARKER_OUTLINE_RADIUS_TILES = 0.48;

export function createWorldDescriptor(size) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError("World size must be a positive integer.");
  }
  return Object.freeze({ width: size, height: size, shape: "square" });
}

export function getVisibleDimensions(zoom, aspectRatio) {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new TypeError("Zoom must be a positive finite number.");
  }
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new TypeError("Viewport aspect ratio must be a positive finite number.");
  }
  const columns = BASE_VIEW_COLUMNS / zoom;
  return {
    columns,
    rows: columns / aspectRatio
  };
}

export function clampCameraPosition(
  camera,
  worldSize,
  view,
  overscan = 0
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
