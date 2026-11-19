/**
 * Cassandra's Dev Lab gameplay adapter.
 *
 * The Dev Lab shell talks to this application-owned contract rather than
 * depending on Unit, Pawn Runtime and Colony Control service shapes.
 */
export function createCassandraDevLabGameplayController({
  unitApi,
  pawnRuntimeApi,
  colonyControlApi,
  worldRegistry
} = {}) {
  if (!unitApi || !pawnRuntimeApi || !colonyControlApi || !worldRegistry) {
    throw new TypeError("Cassandra gameplay controller requires Unit, Pawn Runtime, Colony Control and World services.");
  }

  function getControlState() {
    return colonyControlApi.getState();
  }

  const facingByPawn = new Map();

  function getFacing(entityId) {
    return facingByPawn.get(entityId) ?? 0;
  }

  function setFacing(entityId, angle) {
    if (!pawnRuntimeApi.getPawn(entityId) || !Number.isFinite(angle)) return false;
    facingByPawn.set(entityId, Math.atan2(Math.sin(angle), Math.cos(angle)));
    return true;
  }

  function createUnit(options) {
    const unit = unitApi.createUnit(options);
    try {
      const pawn = pawnRuntimeApi.initializePawn(unit.id);
      if (pawn && !getControlState().leaderId) {
        colonyControlApi.setLeader(unit.id);
      }
      return unit;
    } catch (error) {
      // Preserve the original Pawn initialization failure if cleanup also fails.
      try {
        unitApi.removeUnit(unit.id);
      } catch (rollbackError) {
        if (error && typeof error === "object" && Object.isExtensible(error)) {
          error.rollbackError = rollbackError;
        }
      }
      throw error;
    }
  }

  function setControlledEntity(entityId) {
    if (entityId === null || entityId === "") {
      colonyControlApi.setDrafted(false);
      colonyControlApi.setLeader(null);
      return getControlState();
    }
    const pawn = pawnRuntimeApi.getPawn(entityId);
    const unit = pawn ? unitApi.getUnit(entityId) : null;
    if (!pawn || !unit?.placement || unit.placement.type !== "world"
      || unit.placement.worldId !== worldRegistry.activeWorldId) {
      throw new Error("Controlled entity must be a spawned Pawn in the active world.");
    }
    colonyControlApi.setLeader(entityId);
    return getControlState();
  }

  function handleKeyDown(event) {
    if (event?.code !== "KeyF" || event.repeat) return null;
    const controlState = colonyControlApi.toggleDraft();
    const leader = controlState.leaderId ? unitApi.getUnit(controlState.leaderId) : null;
    return Object.freeze({ controlState, leader });
  }

  function update(deltaSeconds) {
    if (!getControlState().drafted) return null;
    return colonyControlApi.update(deltaSeconds);
  }

  return Object.freeze({
    getControlState,
    getControlModeLabel() {
      return getControlState().drafted ? "PAWN CONTROL" : "FREE CAMERA";
    },
    getDraftStatusLabel() {
      return getControlState().drafted ? "DRAFT ACTIVE" : "F TO DRAFT";
    },
    getActiveWorldId() {
      return worldRegistry.activeWorldId;
    },
    canPlaceDefinition(definition) {
      return Boolean(definition?.spawnableAs?.includes("unit"));
    },
    getUnit(id) {
      return unitApi.getUnit(id);
    },
    getPawn(id) {
      return pawnRuntimeApi.getPawn(id);
    },
    getFacing,
    setFacing,
    listUnits() {
      return unitApi.listUnits();
    },
    listPawns() {
      return pawnRuntimeApi.listPawns();
    },
    createUnit,
    removeUnit(id) {
      return unitApi.removeUnit(id);
    },
    setLeader(id) {
      return setControlledEntity(id);
    },
    setControlledEntity,
    setDrafted(value) {
      return colonyControlApi.setDrafted(value);
    },
    toggleDraft() {
      return colonyControlApi.toggleDraft();
    },
    handleKeyDown,
    update
  });
}
