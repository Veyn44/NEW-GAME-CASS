export const PRIMARY_WORLD_SIZES = Object.freeze([64, 128, 256]);
export const BASE_VIEW_COLUMNS = 64;
export const BASE_VIEW_ROWS = 32;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;
export const CAMERA_VERTICAL_OVERSCAN_TILES = 20;

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
  verticalOverscan = 0
) {
  if (!Number.isFinite(verticalOverscan) || verticalOverscan < 0) {
    throw new TypeError("Vertical camera overscan must be a non-negative finite number.");
  }

  const halfColumns = Math.min(view.columns, worldSize) / 2;
  const minY = -verticalOverscan + view.rows / 2;
  const maxY = worldSize + verticalOverscan - view.rows / 2;
  const centeredY = worldSize / 2;
  const canUseOverscan = minY <= maxY;

  return {
    x: Math.max(halfColumns, Math.min(worldSize - halfColumns, camera.x)),
    y: canUseOverscan
      ? Math.max(minY, Math.min(maxY, camera.y))
      : centeredY
  };
}
