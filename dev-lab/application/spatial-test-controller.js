import { deriveFootprintCells, normalizeFootprintOffsets } from "../../engine/spatial/spatial-composition.js";

const DEFAULT_FOOTPRINT = Object.freeze([{ x: 0, y: 0 }]);
const TEST_ENTITY_KIND = "dev-lab.test-entity";

/**
 * Creates and moves disposable Dev Lab entities using only Engine services.
 * Collision acceptance is a Dev Lab host policy; Engine supplies occupancy facts.
 */
export class SpatialTestController {
  #entities;
  #worlds;
  #spatial;
  #placements;
  #movement;
  #sequence = 0;

  constructor({ entityRegistry, worldRegistry, spatialComposition, placementCoordinator, spatialMovement } = {}) {
    if (!entityRegistry?.registerPersistent || !entityRegistry?.get || !entityRegistry?.list
      || !worldRegistry?.get || !worldRegistry?.activeWorldId
      || !spatialComposition?.getEntityOccupancy || !spatialComposition?.listEntityOccupancies
      || !placementCoordinator?.placeEntity || !placementCoordinator?.removeEntity
      || !spatialMovement?.moveEntity) {
      throw new TypeError("SpatialTestController requires the shared Engine spatial services.");
    }
    this.#entities = entityRegistry;
    this.#worlds = worldRegistry;
    this.#spatial = spatialComposition;
    this.#placements = placementCoordinator;
    this.#movement = spatialMovement;
  }

  list() {
    return Object.freeze(this.#entities.list({ kind: TEST_ENTITY_KIND, status: "active" })
      .map((entity) => {
        const occupancy = this.#spatial.getEntityOccupancy(entity.id);
        return occupancy ? Object.freeze({ entity, occupancy }) : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.entity.id.localeCompare(b.entity.id)));
  }

  create({ worldId = this.#worlds.activeWorldId, anchor, footprint = DEFAULT_FOOTPRINT, orientation = 0 } = {}) {
    const world = this.#worlds.get(worldId);
    if (!world || world.status === "closed" || world.grid == null) {
      throw new TypeError("Test entities require an active grid-backed world.");
    }
    const normalizedFootprint = normalizeFootprintOffsets(footprint);
    const cells = deriveFootprintCells({ anchor, footprint: normalizedFootprint, orientation, grid: world.grid });
    const id = this.#nextId();
    const entity = this.#entities.registerPersistent({
      id,
      kind: TEST_ENTITY_KIND,
      metadata: { owner: "dev-lab", role: "spatial-test" }
    });
    try {
      this.#placements.placeEntity(entity.id, {
        worldId,
        anchor,
        footprint: normalizedFootprint,
        orientation
      });
    } catch (error) {
      this.#entities.remove(entity.id);
      throw error;
    }
    return Object.freeze({ entity, occupancy: this.#spatial.getEntityOccupancy(entity.id), cells });
  }

  move(entityId, { worldId = this.#worlds.activeWorldId, anchor, orientation } = {}) {
    this.#assertOwned(entityId);
    return this.#movement.moveEntity(entityId, { worldId, anchor, orientation }, (proposal) => {
      const accepted = proposal.overlaps.length === 0;
      return {
        accepted,
        code: accepted ? null : "DEV_LAB_OVERLAP",
        reason: accepted ? null : "Target footprint overlaps another occupied entity."
      };
    });
  }

  remove(entityId) {
    this.#assertOwned(entityId);
    this.#placements.removeEntity(entityId);
    return this.#entities.get(entityId);
  }

  #assertOwned(entityId) {
    const entity = this.#entities.get(entityId);
    if (!entity || entity.kind !== TEST_ENTITY_KIND || entity.metadata?.owner !== "dev-lab"
      || entity.status !== "active") {
      throw new TypeError("Only active Dev Lab spatial test entities can be changed.");
    }
    return entity;
  }

  #nextId() {
    let id;
    do {
      this.#sequence += 1;
      id = `dev-lab:test:${this.#sequence}`;
    } while (this.#entities.has(id));
    return id;
  }
}
