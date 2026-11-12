export const PRIMARY_WORLD_SIZES = Object.freeze([64, 128, 256]);
export const BASE_VIEW_COLUMNS = 64;
export const BASE_VIEW_ROWS = 32;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

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

export function clampCameraPosition(camera, worldSize, view) {
  const halfColumns = Math.min(view.columns, worldSize) / 2;
  const halfRows = Math.min(view.rows, worldSize) / 2;
  return {
    x: Math.max(halfColumns, Math.min(worldSize - halfColumns, camera.x)),
    y: Math.max(halfRows, Math.min(worldSize - halfRows, camera.y))
  };
}
