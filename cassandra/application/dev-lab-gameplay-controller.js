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

  function createUnit(options) {
    const unit = unitApi.createUnit(options);
    try {
      const pawn = pawnRuntimeApi.initializePawn(unit.id);
      if (pawn && unit.definitionId === "pawn.johny" && !getControlState().leaderId) {
        colonyControlApi.setLeader(unit.id);
      }
      return unit;
    } catch (error) {
      unitApi.removeUnit(unit.id);
      throw error;
    }
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
      return colonyControlApi.setLeader(id);
    },
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
