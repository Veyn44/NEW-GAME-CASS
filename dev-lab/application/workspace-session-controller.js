/**
 * Owns Dev Lab workspace-session transitions: world selection, reset, and
 * post-restore synchronization. Runtime construction and simulation remain
 * owned by the application shell / Engine.
 */
export function createDevLabWorkspaceSessionController({
  elements,
  worldRegistry,
  gameplayApi = null,
  clock = null,
  inputController,
  heldMovementKeys,
  viewport,
  isPaused = () => true,
  setPaused = () => {},
  clearSelection = () => {},
  refreshWorldMarkers = () => {},
  updateSimulationUi = () => {},
  cancelPlacement = () => {},
  closeViewportDatabase = () => {},
  closeUnitProfile = () => {},
  clearSaveSelection = () => {},
  confirmReset = () => true,
  onResetStatus = () => {},
  focusCanvas = () => {}
} = {}) {
  const required = ["worldSizeSelect", "worldStatus"];
  if (!elements || required.some((key) => !elements[key])) {
    throw new TypeError("Workspace session elements are required.");
  }
  if (!worldRegistry || !inputController || !heldMovementKeys || !viewport) {
    throw new TypeError("Workspace session requires world, input, and viewport services.");
  }
  const { worldSizeSelect, worldStatus } = elements;

  function clearHeldInputAndPause() {
    heldMovementKeys.clear();
    inputController.pause();
    inputController.clearForFocusLoss();
    clock?.pause("player");
    setPaused(true);
  }

  function syncWorldPresentation() {
    const activeWorld = worldRegistry.get(worldRegistry.activeWorldId);
    if (activeWorld?.dimensions?.width && activeWorld?.dimensions?.height) {
      const { width, height } = activeWorld.dimensions;
      worldSizeSelect.value = String(width);
      worldStatus.textContent = `World: ${width} × ${height}`;
      viewport.resetCameraToWorld(Math.min(width, height));
    } else {
      viewport.resetCameraToWorld();
    }
  }

  function changeWorld(value = worldSizeSelect.value) {
    if (!isPaused() || !worldRegistry) return false;
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0) return false;
    worldRegistry.activateWorld(`dev-lab-world-${size}`);
    const leaderId = gameplayApi?.getControlState().leaderId;
    const leader = leaderId ? gameplayApi?.getUnit(leaderId) : null;
    if (leader?.placement && leader.placement.worldId !== worldRegistry.activeWorldId) {
      gameplayApi.setDrafted(false);
    }
    clearSelection();
    refreshWorldMarkers();
    updateSimulationUi();
    return true;
  }

  function reset() {
    if (!worldRegistry || !confirmReset()) return false;
    clearHeldInputAndPause();
    cancelPlacement();
    closeViewportDatabase();
    closeUnitProfile();

    for (const unit of gameplayApi?.listUnits() ?? []) {
      gameplayApi.removeUnit(unit.id);
    }
    gameplayApi?.setLeader(null);
    clearSelection();
    refreshWorldMarkers();
    syncWorldPresentation();
    clearSaveSelection();
    onResetStatus();
    updateSimulationUi();
    focusCanvas();
    return true;
  }

  function synchronizeRestoredWorkspace() {
    // A loaded session always enters a safe, paused inspection state.
    clearHeldInputAndPause();
    syncWorldPresentation();
    clearSelection();
    refreshWorldMarkers();
    updateSimulationUi();
  }

  return Object.freeze({
    changeWorld,
    reset,
    synchronizeRestoredWorkspace
  });
}
