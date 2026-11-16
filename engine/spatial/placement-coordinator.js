import { PLACEMENT_AUTHORITY } from "./placement-authority.js";
import { deriveFootprintCells } from "./spatial-composition.js";
import { MOVEMENT_AUTHORITY } from "./movement-authority.js";

export class PlacementCoordinatorError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = "PlacementCoordinatorError"; this.code = code; this.details = Object.freeze({ ...details }); }
}
export class PlacementCoordinator {
  #entities; #worlds; #worldContext; #spatial; #faulted = false; #onFatalIntegrityFault; #policyEvaluation = 0;
  constructor({ entityRegistry, worldRegistry, worldContext, spatialComposition, onFatalIntegrityFault = null } = {}) {
    if (!entityRegistry?.get || !entityRegistry?.setSpatialOccupancyGuard || !worldRegistry?.get ||
        !worldContext?.prepareCoordinatedPlacementChange || !spatialComposition?.prepareEntityOccupancyChange) throw new PlacementCoordinatorError("INVALID_DEPENDENCY", "PlacementCoordinator requires EntityRegistry, WorldRegistry, WorldContext and SpatialComposition.");
    if (onFatalIntegrityFault !== null && typeof onFatalIntegrityFault !== "function") throw new PlacementCoordinatorError("INVALID_FAULT_HANDLER", "onFatalIntegrityFault must be a function or null.");
    this.#entities = entityRegistry; this.#worlds = worldRegistry; this.#worldContext = worldContext; this.#spatial = spatialComposition; this.#onFatalIntegrityFault = onFatalIntegrityFault;
    this.#worldContext.requireSpatialCoordination(PLACEMENT_AUTHORITY);
    this.#entities.setSpatialOccupancyGuard((id) => this.#spatial.hasEntityOccupancy(id), PLACEMENT_AUTHORITY);
  }
  get isFaulted() { return this.#faulted; }
  withPolicyEvaluation(callback, authority) {
    if (authority !== MOVEMENT_AUTHORITY || typeof callback !== "function") throw new PlacementCoordinatorError("MOVEMENT_AUTHORITY_REQUIRED", "Policy evaluation requires the internal movement capability.");
    this.#policyEvaluation += 1;
    let released = false;
    const release = () => { if (!released) { released = true; this.#policyEvaluation -= 1; } };
    try {
      const value = callback();
      if (value && typeof value.then === "function") return Promise.resolve(value).finally(release);
      release();
      return value;
    } catch (error) { release(); throw error; }
  }
  #assertMutationAllowed() {
    if (this.#policyEvaluation > 0) throw new PlacementCoordinatorError("PLACEMENT_MUTATION_DURING_POLICY", "Placement cannot change during movement policy evaluation.");
  }
  placeEntity(entityId, target) {
    this.#assertHealthy();
    if (!target || typeof target !== "object" || Array.isArray(target)
      || (Object.hasOwn(target, "type") && target.type !== "grid")) {
      throw new PlacementCoordinatorError("INVALID_GRID_TARGET", "placeEntity requires a grid target with an anchor and footprint.");
    }
    if (this.#worldContext.getPlacement(entityId)) throw new PlacementCoordinatorError("ENTITY_ALREADY_PLACED", "Entity already has a placement.", { entityId });
    return this.#apply(entityId, { ...target, type: "grid" });
  }
  moveEntity(entityId, target) {
    this.#assertHealthy();
    if (!this.#worldContext.getPlacement(entityId)) throw new PlacementCoordinatorError("ENTITY_NOT_PLACED", "Entity has no placement.", { entityId });
    return this.#apply(entityId, target);
  }
  storeEntity(entityId, storeId) { return this.#apply(entityId, { type: "store", storeId }); }
  removePlacement(entityId) { return this.#apply(entityId, null); }
  removeEntity(entityId) { return this.#apply(entityId, null, { retire: true }); }
  #assertHealthy() { if (this.#faulted) throw new PlacementCoordinatorError("FATAL_INTEGRITY_FAULT", "Coordinator is faulted; mutations and persistence are blocked."); }
  #markFaulted() { this.#faulted = true; try { this.#onFatalIntegrityFault?.(); } catch { /* Fault signaling must not mask the integrity failure. */ } }
  #apply(entityId, target, { retire = false } = {}) {
    this.#assertHealthy();
    const previous = this.#worldContext.getPlacement(entityId);
    const sourceGrid = previous?.type === "world" && this.#worlds.get(previous.worldId)?.grid != null;
    let worldTarget = target, occupancyTarget = null;
    if (target?.type === "grid") {
      const world = this.#worlds.get(target.worldId);
      if (!world) throw new PlacementCoordinatorError("UNKNOWN_WORLD", "Target world is not registered.", { worldId: target.worldId });
      if (world.grid == null) throw new PlacementCoordinatorError("WORLD_HAS_NO_GRID", "Target world does not have grid capability.", { worldId: target.worldId });
      const cells = deriveFootprintCells({ anchor: target.anchor, footprint: target.footprint, orientation: target.orientation ?? 0, grid: world.grid });
      if (!cells.length) throw new PlacementCoordinatorError("INVALID_FOOTPRINT", "Footprint cannot be empty.");
      occupancyTarget = { worldId: target.worldId, anchor: target.anchor, footprint: target.footprint, orientation: target.orientation ?? 0 };
      worldTarget = { type: "world", worldId: target.worldId, position: { x: target.anchor.x + 0.5, y: target.anchor.y + 0.5 } };
    }
    const targetWorld = worldTarget?.type === "world" ? this.#worlds.get(worldTarget.worldId) : null;
    if (worldTarget?.type === "world" && !targetWorld) {
      throw new PlacementCoordinatorError("UNKNOWN_WORLD", "Target world is not registered.", { worldId: worldTarget.worldId });
    }
    if (targetWorld?.grid != null && occupancyTarget === null) {
      throw new PlacementCoordinatorError("GRID_TARGET_REQUIRED",
        "A grid-backed target must provide an explicit grid anchor and footprint; world coordinates alone are ambiguous.",
        { worldId: targetWorld.worldId });
    }
    const targetGrid = targetWorld?.grid != null;
    if (!sourceGrid && !targetGrid) throw new PlacementCoordinatorError("GRID_COORDINATION_NOT_REQUIRED", "At least one side must be grid-backed.");
    if (sourceGrid) this.#assertCurrentOccupancy(entityId, previous);
    const worldTx = this.#worldContext.prepareCoordinatedPlacementChange(entityId, worldTarget, PLACEMENT_AUTHORITY, { retire });
    const spatialTx = this.#spatial.prepareEntityOccupancyChange(entityId, occupancyTarget, PLACEMENT_AUTHORITY);
    let worldCommitted = false, spatialCommitted = false;
    try { worldTx.commit(); worldCommitted = true; spatialTx.commit(); spatialCommitted = true; }
    catch (error) {
      try { if (spatialCommitted) spatialTx.rollback(); if (worldCommitted) worldTx.rollback(); }
      catch (rollbackError) { this.#markFaulted(); throw new PlacementCoordinatorError("FATAL_INTEGRITY_FAULT", "Commit and rollback both failed.", { cause: error?.message, rollback: rollbackError?.message }); }
      throw new PlacementCoordinatorError("PLACEMENT_COMMIT_FAILED", "Coordinated placement failed; prior state was restored.", { cause: error?.message });
    }
    return Object.freeze({ previous: worldTx.previous, current: worldTx.current, occupancy: spatialTx.current });
  }
  #assertCurrentOccupancy(entityId, placement) {
    const occupancy = this.#spatial.getEntityOccupancy(entityId);
    if (!occupancy || occupancy.worldId !== placement.worldId ||
        occupancy.anchor.x !== placement.position.x - 0.5 || occupancy.anchor.y !== placement.position.y - 0.5) {
      this.#markFaulted(); throw new PlacementCoordinatorError("PLACEMENT_INTEGRITY_MISMATCH", "WorldContext and Spatial Composition disagree.", { entityId });
    }
  }
  #validateSnapshot(snapshot, { validateWorlds = true } = {}) {
    if (!snapshot || snapshot.version !== 1 || !snapshot.worldContext || !snapshot.spatialComposition) throw new PlacementCoordinatorError("INVALID_SNAPSHOT", "Invalid composite placement snapshot.");
    const placements = snapshot.worldContext.placements, occupancies = snapshot.spatialComposition.entityOccupancies ?? [];
    if (!Array.isArray(placements) || !Array.isArray(occupancies)) throw new PlacementCoordinatorError("INVALID_SNAPSHOT", "Composite collections must be arrays.");
    const byOccupancy = new Map();
    for (const item of occupancies) { if (!item || typeof item.entityId !== "string" || byOccupancy.has(item.entityId)) throw new PlacementCoordinatorError("DUPLICATE_ENTITY_OCCUPANCY", "Duplicate or invalid occupancy."); byOccupancy.set(item.entityId,item); }
    const byPlacement = new Map();
    for (const item of placements) {
      if (!item || typeof item.entityId !== "string" || byPlacement.has(item.entityId)) throw new PlacementCoordinatorError("DUPLICATE_PLACEMENT", "Duplicate or invalid placement.");
      byPlacement.set(item.entityId,item);
      const occupancy = byOccupancy.get(item.entityId);
      if (item.type !== "world") { if (occupancy) throw new PlacementCoordinatorError("UNEXPECTED_ENTITY_OCCUPANCY", "Stored entity has occupancy."); continue; }
      if (validateWorlds) {
        const world = this.#worlds.get(item.worldId);
        if (!world) throw new PlacementCoordinatorError("UNKNOWN_WORLD", "Snapshot references unknown world.", { worldId: item.worldId });
        if (world.grid == null && occupancy) throw new PlacementCoordinatorError("UNEXPECTED_ENTITY_OCCUPANCY", "Non-grid placement has occupancy.", { entityId: item.entityId });
        if (world.grid != null && (!occupancy || occupancy.worldId !== item.worldId || item.position.x !== occupancy.anchor?.x + 0.5 || item.position.y !== occupancy.anchor?.y + 0.5))
          throw new PlacementCoordinatorError("PLACEMENT_INTEGRITY_MISMATCH", "Grid placement and occupancy anchor do not match.", { entityId: item.entityId });
      } else if (occupancy && (occupancy.worldId !== item.worldId || item.position.x !== occupancy.anchor?.x + 0.5 || item.position.y !== occupancy.anchor?.y + 0.5)) {
        throw new PlacementCoordinatorError("PLACEMENT_INTEGRITY_MISMATCH", "Occupancy and placement anchor do not match.", { entityId: item.entityId });
      }
    }
    for (const entityId of byOccupancy.keys()) { const p = byPlacement.get(entityId); if (!p || p.type !== "world" || p.worldId !== byOccupancy.get(entityId).worldId) throw new PlacementCoordinatorError("ORPHAN_ENTITY_OCCUPANCY", "Occupancy has no matching WorldContext placement.", { entityId }); }
    return true;
  }
  createPersistenceParticipant({ id = "core.spatial-placement", order = -80 } = {}) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9.-]*$/.test(id) || !Number.isSafeInteger(order)) throw new PlacementCoordinatorError("INVALID_PARTICIPANT_CONFIG", "Invalid participant ID/order.");
    return Object.freeze({
      id, schemaVersion: 1, required: true, order,
      captureSnapshot: () => { this.#assertHealthy(); const snapshot = Object.freeze({ version: 1, worldContext: this.#worldContext.captureSnapshot(), spatialComposition: this.#spatial.captureSnapshot() }); this.#validateSnapshot(snapshot); return snapshot; },
      validateSnapshot: (snapshot) => { try { this.#validateSnapshot(snapshot,{validateWorlds:false}); this.#worldContext.prepareRestore(snapshot.worldContext,{deferReferenceValidation:true,authority:PLACEMENT_AUTHORITY}); this.#spatial.prepareRestore(snapshot.spatialComposition,{deferWorldValidation:true,authority:PLACEMENT_AUTHORITY}); return true; } catch { return false; } },
      prepareRestore: (snapshot) => {
        this.#assertHealthy(); this.#validateSnapshot(snapshot,{validateWorlds:false});
        const worldTx = this.#worldContext.prepareRestore(snapshot.worldContext,{deferReferenceValidation:true,authority:PLACEMENT_AUTHORITY}), spatialTx = this.#spatial.prepareRestore(snapshot.spatialComposition,{deferWorldValidation:true,authority:PLACEMENT_AUTHORITY});
        let committed = false;
        return Object.freeze({
          commit: () => {
            if (committed) throw new PlacementCoordinatorError("RESTORE_ALREADY_COMMITTED","Restore already committed.");
            this.#validateSnapshot(snapshot,{validateWorlds:true});
            worldTx.commit();
            try { spatialTx.commit(); }
            catch (error) { try { worldTx.rollback(); } catch (rollbackError) { this.#markFaulted(); throw new PlacementCoordinatorError("FATAL_INTEGRITY_FAULT","Restore rollback failed.",{cause:error?.message,rollback:rollbackError?.message}); } throw error; }
            committed=true;
          },
          rollback: () => { this.#assertMutationAllowed(); if (!committed) return false; try { spatialTx.rollback(); worldTx.rollback(); committed=false; return true; } catch(error) { this.#faulted=true; throw new PlacementCoordinatorError("FATAL_INTEGRITY_FAULT","Composite restore rollback failed.",{cause:error?.message}); } }
        });
      }
    });
  }
}
