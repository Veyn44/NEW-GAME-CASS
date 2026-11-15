/**
 * Read-only Dev Lab adapter over Engine Spatial Composition.
 * The helper formats no game rules and never mutates the world.
 */
export function querySpatialCell(spatialComposition, worldId, cell) {
  if (!spatialComposition || typeof spatialComposition.queryCell !== "function") {
    throw new TypeError("Dev Lab spatial inspection requires Engine Spatial Composition.");
  }
  if (typeof worldId !== "string" || !worldId.trim()) {
    throw new TypeError("A world ID is required for spatial inspection.");
  }
  if (!cell || !Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
    throw new TypeError("Spatial inspection requires integer cell coordinates.");
  }
  const result = spatialComposition.queryCell(worldId, cell);
  return Object.freeze({
    worldId,
    cell: Object.freeze({ x: cell.x, y: cell.y }),
    contents: result.contents,
    entities: result.entities
  });
}
