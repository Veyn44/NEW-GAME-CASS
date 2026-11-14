/**
 * Cassandra's Dev Lab gameplay adapter.
 *
 * The Dev Lab shell talks to this application-owned contract rather than
 * depending on Unit and Colony Control service shapes or Cassandra bindings.
 */
export function createCassandraDevLabGameplayController({
  unitApi,
  colonyControlApi,
  worldRegistry
} = {}) {
  if (!unitApi || !colonyControlApi || !worldRegistry) {
    throw new TypeError("Cassandra gameplay controller requires Unit, Colony Control and World services.");
  }

  function getControlState() {
    return colonyControlApi.getState();
  }

  function createUnit(options) {
    const unit = unitApi.createUnit(options);
    if (options?.definitionId === "pawn.johny" && !getControlState().leaderId) {
      colonyControlApi.setLeader(unit.id);
    }
    return unit;
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
    listUnits() {
      return unitApi.listUnits();
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
