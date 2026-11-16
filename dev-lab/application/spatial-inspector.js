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


export function querySpatialNeighbors(spatialComposition, worldId, cell, topology = "four-way") {
  if (!spatialComposition || typeof spatialComposition.queryNeighbors !== "function") {
    throw new TypeError("Dev Lab neighbor inspection requires Engine Spatial Composition.");
  }
  return spatialComposition.queryNeighbors(worldId, cell, { topology });
}

export function querySpatialRadius(spatialComposition, worldId, center, radius = 2, metric = "chebyshev") {
  if (!spatialComposition || typeof spatialComposition.queryRadius !== "function") {
    throw new TypeError("Dev Lab radius inspection requires Engine Spatial Composition.");
  }
  return spatialComposition.queryRadius(worldId, center, { radius, metric });
}

export function querySpatialFootprint(spatialComposition, entityId) {
  if (!spatialComposition || typeof spatialComposition.getEntityFootprint !== "function") {
    throw new TypeError("Dev Lab footprint inspection requires Engine Spatial Composition.");
  }
  if (typeof entityId !== "string" || !entityId.trim()) {
    throw new TypeError("A spatial entity ID is required for footprint inspection.");
  }
  return spatialComposition.getEntityFootprint(entityId);
}


export function querySpatialRegion(spatialComposition, worldId, region, filters = {}) {
  if (!spatialComposition || typeof spatialComposition.queryRegion !== "function") {
    throw new TypeError("Dev Lab region inspection requires Engine Spatial Composition.");
  }
  if (typeof worldId !== "string" || !worldId.trim()) {
    throw new TypeError("A world ID is required for spatial region inspection.");
  }
  return spatialComposition.queryRegion(worldId, region, filters);
}
