/**
 * Engine-backed spawn adapter for the standalone Dev Lab.
 * Definitions are data; instances, identity, and placement belong to Engine.
 */
export function createDevLabContentController({ entityRegistry, worldContext, placementCoordinator, worldRegistry, definitionLookup } = {}) {
  if (!entityRegistry || !worldContext || !placementCoordinator || !worldRegistry || typeof definitionLookup !== "function") {
    throw new TypeError("Dev Lab content controller requires Engine identity, world, placement and definition services.");
  }
  function canPlaceDefinition(definition) { return Boolean(definition?.spawnableAs?.includes("unit")); }
  function listUnits() {
    return entityRegistry.list({ status: "active", kind: "dev-lab.content-instance" }).map((entity) => {
      const placement = worldContext.getPlacement(entity.id);
      if (!placement || placement.type !== "world") return null;
      return Object.freeze({ id: entity.id, definitionId: entity.metadata.definitionId, position: placement.position, placement });
    }).filter(Boolean);
  }
  function createUnit({ definitionId, worldId, position } = {}) {
    const definition = definitionLookup(definitionId);
    if (!canPlaceDefinition(definition)) throw new TypeError("This definition is not spawnable in the Dev Lab.");
    const world = worldRegistry.get(worldId);
    if (!world || world.status === "closed") throw new Error("Target world is not available.");
    if (!position || !Number.isSafeInteger(position.x) || !Number.isSafeInteger(position.y)
      || position.x < 0 || position.y < 0 || position.x >= world.dimensions.width || position.y >= world.dimensions.height) {
      throw new RangeError("Spawn position is outside the active world.");
    }
    const entity = entityRegistry.registerPersistent({ kind: "dev-lab.content-instance", metadata: { definitionId } });
    try {
      placementCoordinator.placeEntity(entity.id, { worldId, anchor: position, footprint: [{ x: 0, y: 0 }], orientation: 0 });
    } catch (error) {
      entityRegistry.remove(entity.id);
      throw error;
    }
    const placement = worldContext.getPlacement(entity.id);
    return Object.freeze({ id: entity.id, definitionId, position: placement.position, placement });
  }
  function getUnit(id) { return listUnits().find((item) => item.id === id) ?? null; }
  function removeUnit(id) {
    const entity = entityRegistry.get(id);
    if (!entity || entity.kind !== "dev-lab.content-instance") return false;
    placementCoordinator.removeEntity(id);
    return true;
  }
  function removeAll() { for (const item of listUnits()) removeUnit(item.id); }
  return Object.freeze({
    canPlaceDefinition, createUnit, listUnits, getUnit, removeUnit, removeAll,
    getControlState: () => Object.freeze({ leaderId: null, drafted: false }),
    setLeader: () => null, setDrafted: () => null, handleKeyDown: () => null,
    getDraftStatusLabel: () => "FREE CAMERA", getControlModeLabel: () => "FREE CAMERA"
  });
}
