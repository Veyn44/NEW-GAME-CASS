import { deriveFootprintCells, SpatialCompositionError } from "./spatial-composition.js";
import { PlacementCoordinatorError } from "./placement-coordinator.js";

export class SpatialMovementError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SpatialMovementError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Generic, grid-footprint movement transaction.
 *
 * The host policy receives immutable geometric facts and must be synchronous,
 * deterministic and side-effect free. Only PlacementCoordinator may commit.
 */
export class SpatialMovement {
  #entities;
  #worlds;
  #spatial;
  #placements;
  #policy;
  #evaluating = new Set();

  constructor({ entityRegistry, worldRegistry, spatialComposition, placementCoordinator, policy } = {}) {
    if (!entityRegistry?.get || !worldRegistry?.get || !spatialComposition?.queryCell ||
        !spatialComposition?.getEntityFootprint || !placementCoordinator?.moveEntity) {
      throw new SpatialMovementError("INVALID_DEPENDENCY", "SpatialMovement requires EntityRegistry, WorldRegistry, SpatialComposition and PlacementCoordinator.");
    }
    if (typeof policy !== "function") throw new SpatialMovementError("INVALID_POLICY", "A host-supplied movement policy function is required.");
    this.#entities = entityRegistry;
    this.#worlds = worldRegistry;
    this.#spatial = spatialComposition;
    this.#placements = placementCoordinator;
    this.#policy = policy;
  }

  moveEntity(entityId, target) {
    if (typeof entityId !== "string" || !entityId.length) return this.#outcome("invalid", "INVALID_ENTITY_ID", { entityId });
    if (this.#evaluating.has(entityId)) return this.#outcome("invalid", "REENTRANT_MOVEMENT", { entityId });
    const entity = this.#entities.get(entityId);
    if (!entity || entity.status !== "active") return this.#outcome("invalid", "ENTITY_NOT_ELIGIBLE", { entityId });
    let current;
    try { current = this.#spatial.getEntityFootprint(entityId); }
    catch (error) {
      return this.#outcome("invalid", error.code ?? "ENTITY_NOT_SPATIALLY_PLACED", { entityId });
    }
    if (!target || typeof target !== "object" || Array.isArray(target) ||
        typeof target.worldId !== "string" || !target.worldId ||
        !target.anchor || !Number.isSafeInteger(target.anchor.x) || !Number.isSafeInteger(target.anchor.y)) {
      return this.#outcome("invalid", "INVALID_TARGET", { entityId });
    }
    const world = this.#worlds.get(target.worldId);
    if (!world) return this.#outcome("unavailable", "UNKNOWN_WORLD", { entityId, worldId: target.worldId });
    if (world.status === "closed") return this.#outcome("unavailable", "WORLD_CLOSED", { entityId, worldId: target.worldId });
    if (world.grid == null) return this.#outcome("unavailable", "WORLD_HAS_NO_GRID", { entityId, worldId: target.worldId });
    const orientation = target.orientation ?? (current.worldId === target.worldId ? current.orientation : 0);
    let targetCells;
    try {
      targetCells = deriveFootprintCells({ anchor: target.anchor, footprint: current.footprint, orientation, grid: world.grid });
    } catch (error) {
      const status = error.code === "FOOTPRINT_OUT_OF_BOUNDS" || error.code === "CELL_OUT_OF_BOUNDS" ? "out-of-bounds" : "invalid";
      return this.#outcome(status, error.code ?? "INVALID_FOOTPRINT", { entityId, worldId: target.worldId });
    }
    if (current.worldId === target.worldId &&
        current.anchor.x === target.anchor.x && current.anchor.y === target.anchor.y &&
        current.orientation === orientation) {
      return Object.freeze({ status: "unchanged", entityId, worldId: current.worldId, anchor: current.anchor, cells: current.cells });
    }

    const cellFacts = targetCells.map((cell) => this.#spatial.queryCell(target.worldId, cell));
    const overlapsById = new Map();
    for (const fact of cellFacts) for (const occupied of fact.entities) {
      if (occupied.entityId !== entityId && !overlapsById.has(occupied.entityId)) overlapsById.set(occupied.entityId, occupied);
    }
    const overlaps = [...overlapsById.values()].sort((a,b) => a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0);
    const context = Object.freeze({
      entity,
      current,
      target: Object.freeze({
        worldId: target.worldId,
        anchor: Object.freeze({ x: target.anchor.x, y: target.anchor.y }),
        footprint: current.footprint,
        orientation,
        cells: Object.freeze(targetCells)
      }),
      cells: Object.freeze(cellFacts),
      contents: Object.freeze(cellFacts.flatMap((fact) => fact.contents)),
      overlaps: Object.freeze(overlaps)
    });

    this.#evaluating.add(entityId);
    let decision;
    try {
      decision = this.#policy(context);
      if (decision && typeof decision.then === "function") {
        return this.#outcome("invalid", "ASYNC_POLICY_UNSUPPORTED", { entityId });
      }
    } catch (error) {
      return this.#outcome("invalid", "POLICY_EVALUATION_FAILED", { entityId, cause: error?.message ?? String(error) });
    } finally {
      this.#evaluating.delete(entityId);
    }

    const accepted = typeof decision === "boolean" ? decision
      : decision && typeof decision === "object" && typeof decision.accepted === "boolean" ? decision.accepted
      : null;
    if (accepted === null) return this.#outcome("invalid", "INVALID_POLICY_RESULT", { entityId });
    if (!accepted) {
      const reason = typeof decision === "object" && typeof decision.reason === "string" ? decision.reason : null;
      const code = typeof decision === "object" && typeof decision.code === "string" ? decision.code : "POLICY_REJECTED";
      return Object.freeze({ status: "rejected", code, reason, entityId, worldId: target.worldId, anchor: context.target.anchor });
    }

    try {
      const committed = this.#placements.moveEntity(entityId, {
        type: "grid", worldId: target.worldId, anchor: context.target.anchor,
        footprint: current.footprint, orientation
      });
      return Object.freeze({
        status: "moved", entityId, worldId: target.worldId,
        anchor: context.target.anchor, cells: Object.freeze(targetCells),
        previous: committed.previous, current: committed.current
      });
    } catch (error) {
      if (error instanceof PlacementCoordinatorError) {
        const status = error.code === "FOOTPRINT_OUT_OF_BOUNDS" ? "out-of-bounds"
          : ["UNKNOWN_WORLD", "WORLD_HAS_NO_GRID", "WORLD_CLOSED"].includes(error.code) ? "unavailable" : "invalid";
        return this.#outcome(status, error.code, { entityId, worldId: target.worldId, cause: error.message });
      }
      return this.#outcome("invalid", "MOVEMENT_COMMIT_FAILED", { entityId, cause: error?.message ?? String(error) });
    }
  }

  #outcome(status, code, details) {
    return Object.freeze({ status, code, ...details });
  }
}
