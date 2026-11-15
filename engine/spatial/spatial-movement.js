import { deriveFootprintCells, normalizeFootprintOffsets, SpatialCompositionError } from "./spatial-composition.js";
import { PlacementCoordinatorError } from "./placement-coordinator.js";
import { MOVEMENT_AUTHORITY } from "./movement-authority.js";

export class SpatialMovementError extends Error {
  constructor(code, message, details = {}) {
    super(message); this.name = "SpatialMovementError"; this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
function freezeTarget(worldId, anchor, footprint, orientation, cells) {
  return Object.freeze({
    worldId, anchor: Object.freeze({ x: anchor.x, y: anchor.y }),
    footprint: Object.freeze(footprint.map((p) => Object.freeze({ x: p.x, y: p.y }))),
    orientation, cells: Object.freeze(cells.map((p) => Object.freeze({ x: p.x, y: p.y })))
  });
}
function sameCells(a, b) {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
}
function sameOccupancy(a, b) {
  return a.worldId === b.worldId && a.anchor.x === b.anchor.x && a.anchor.y === b.anchor.y
    && a.orientation === b.orientation && sameCells(a.cells, b.cells)
    && a.footprint.length === b.footprint.length
    && a.footprint.every((p, i) => p.x === b.footprint[i].x && p.y === b.footprint[i].y);
}
function outcome(status, code, details = {}) { return Object.freeze({ status, code, ...details }); }

/**
 * Generic grid movement transaction. Engine supplies geometry and overlap
 * facts; the host supplies the deterministic policy that gives them meaning.
 */
export class SpatialMovement {
  #entities; #worlds; #spatial; #placements; #evaluating = new Set();
  constructor({ entityRegistry, worldRegistry, spatialComposition, placementCoordinator } = {}) {
    if (!entityRegistry?.get || !worldRegistry?.get || !spatialComposition?.getEntityOccupancy
      || !spatialComposition?.queryRegion || !spatialComposition?.withReadOnlyEvaluation
      || !placementCoordinator?.moveEntity || !placementCoordinator?.withPolicyEvaluation) {
      throw new SpatialMovementError("INVALID_DEPENDENCY", "SpatialMovement requires EntityRegistry, WorldRegistry, SpatialComposition and PlacementCoordinator.");
    }
    this.#entities = entityRegistry; this.#worlds = worldRegistry;
    this.#spatial = spatialComposition; this.#placements = placementCoordinator;
  }

  moveEntity(entityId, target, policy) {
    if (typeof entityId !== "string" || !entityId.trim()) return outcome("invalid", "INVALID_ENTITY_ID", { entityId });
    if (this.#evaluating.has(entityId)) return outcome("invalid", "REENTRANT_MOVEMENT", { entityId });
    if (!target || typeof target !== "object" || Array.isArray(target)
      || typeof target.worldId !== "string" || !target.worldId.trim()
      || !target.anchor || typeof target.anchor !== "object" || Array.isArray(target.anchor)
      || !Number.isSafeInteger(target.anchor.x) || !Number.isSafeInteger(target.anchor.y)) {
      return outcome("invalid", "INVALID_TARGET", { entityId });
    }
    if (typeof policy !== "function") return outcome("invalid", "MOVEMENT_POLICY_REQUIRED", { entityId });
    const entity = this.#entities.get(entityId);
    if (!entity || entity.status !== "active") return outcome("invalid", "ENTITY_NOT_ACTIVE", { entityId });
    const source = this.#spatial.getEntityOccupancy(entityId);
    if (!source) return outcome("invalid", "ENTITY_NOT_GRID_PLACED", { entityId });
    const world = this.#worlds.get(target.worldId);
    if (!world || world.status === "closed" || world.grid == null) {
      return outcome("unavailable", !world ? "UNKNOWN_WORLD" : world.status === "closed" ? "WORLD_CLOSED" : "WORLD_HAS_NO_GRID", { entityId, worldId: target.worldId });
    }

    let footprint, orientation, cells;
    try {
      footprint = normalizeFootprintOffsets(target.footprint ?? source.footprint);
      orientation = target.orientation ?? (source.worldId === target.worldId ? source.orientation : 0);
      cells = deriveFootprintCells({ anchor: target.anchor, footprint, orientation, grid: world.grid });
    } catch (error) {
      const status = error.code === "FOOTPRINT_OUT_OF_BOUNDS" || error.code === "CELL_OUT_OF_BOUNDS" ? "out-of-bounds" : "invalid";
      return outcome(status, error.code ?? "INVALID_TARGET", { entityId, worldId: target.worldId, details: error.details ?? {} });
    }

    const proposedTarget = freezeTarget(target.worldId, target.anchor, footprint, orientation, cells);
    if (sameOccupancy(source, proposedTarget)) {
      return Object.freeze({ status: "unchanged", entityId, source, target: proposedTarget });
    }

    let observations;
    try { observations = this.#spatial.queryRegion(target.worldId, { type: "cells", cells }); }
    catch (error) {
      const status = ["UNKNOWN_WORLD", "WORLD_CLOSED", "WORLD_HAS_NO_GRID"].includes(error.code) ? "unavailable" : "invalid";
      return outcome(status, error.code ?? "SPATIAL_QUERY_FAILED", { entityId, worldId: target.worldId, details: error.details ?? {} });
    }
    const overlaps = Object.freeze(observations.entities.filter((item) => item.entityId !== entityId));
    const proposal = Object.freeze({
      entityId, entityKind: entity.kind, source, target: proposedTarget,
      overlaps, cells: observations.cells, contents: observations.contents
    });

    this.#evaluating.add(entityId);
    let decision;
    try {
      decision = this.#placements.withPolicyEvaluation(
        () => this.#spatial.withReadOnlyEvaluation(() => policy(proposal), MOVEMENT_AUTHORITY),
        MOVEMENT_AUTHORITY
      );
      if (decision && typeof decision.then === "function") {
        Promise.resolve(decision).catch(() => {});
        return outcome("invalid", "ASYNC_POLICY_NOT_SUPPORTED", { entityId });
      }
    } catch (error) {
      return outcome("policy-error", "POLICY_EVALUATION_FAILED", { entityId, cause: error?.message ?? String(error) });
    } finally { this.#evaluating.delete(entityId); }

    const accepted = typeof decision === "boolean" ? decision
      : decision && typeof decision === "object" && typeof decision.accepted === "boolean" ? decision.accepted : null;
    if (accepted === null) return outcome("invalid", "INVALID_POLICY_RESULT", { entityId });
    if (!accepted) {
      const reason = decision && typeof decision === "object" && typeof decision.reason === "string" ? decision.reason : null;
      const code = decision && typeof decision === "object" && typeof decision.code === "string" ? decision.code : "POLICY_REJECTED";
      return Object.freeze({ status: "rejected", code, reason, entityId, source, target: proposedTarget });
    }

    try {
      const committed = this.#placements.moveEntity(entityId, {
        type: "grid", worldId: proposedTarget.worldId, anchor: proposedTarget.anchor,
        footprint: proposedTarget.footprint, orientation: proposedTarget.orientation
      });
      return Object.freeze({
        status: "moved", entityId, source, target: proposedTarget,
        previous: committed.previous, current: committed.current, occupancy: committed.occupancy
      });
    } catch (error) {
      if (error instanceof PlacementCoordinatorError || error instanceof SpatialCompositionError) {
        const status = error.code === "FOOTPRINT_OUT_OF_BOUNDS" ? "out-of-bounds"
          : ["UNKNOWN_WORLD", "WORLD_HAS_NO_GRID", "WORLD_CLOSED"].includes(error.code) ? "unavailable" : "failed";
        return outcome(status, error.code, { entityId, worldId: target.worldId, cause: error.message });
      }
      return outcome("failed", "MOVEMENT_COMMIT_FAILED", { entityId, cause: error?.message ?? String(error) });
    }
  }
}
