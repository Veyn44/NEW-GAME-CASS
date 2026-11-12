const DEFAULT_GAMEPLAY_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight"
]);

/**
 * Keeps physical input state separate from permission to apply it to gameplay.
 *
 * A plain pause preserves the inputs that were already held. Releasing an
 * input during pause removes it from the resume snapshot. Entering inspection
 * invalidates the snapshot and suppresses every input that is still physically
 * held until its matching release event arrives.
 */
export function createViewportInputController({
  gameplayKeys = DEFAULT_GAMEPLAY_KEYS,
  gameplayButtons = [0],
  onChange = null
} = {}) {
  const allowedKeys = new Set(gameplayKeys);
  const allowedButtons = new Set(gameplayButtons);
  const physicalKeys = new Set();
  const physicalButtons = new Set();
  const blockedKeys = new Set();
  const blockedButtons = new Set();
  const activeKeys = new Set();
  const activeButtons = new Set();
  let paused = true;
  let inspecting = false;
  let resumeSnapshot = null;
  let pointerDeltaX = 0;
  let pointerDeltaY = 0;

  function notify() {
    onChange?.(getState());
  }

  function getState() {
    return Object.freeze({
      paused,
      inspecting,
      resumePending: Boolean(resumeSnapshot),
      keys: Object.freeze([...activeKeys].sort()),
      buttons: Object.freeze([...activeButtons].sort((a, b) => a - b)),
      pointerDelta: Object.freeze({ x: pointerDeltaX, y: pointerDeltaY })
    });
  }

  function removeFromResumeSnapshot(kind, value) {
    if (!resumeSnapshot) return;
    resumeSnapshot[kind].delete(value);
  }

  function pause() {
    if (paused) return false;
    resumeSnapshot = {
      keys: new Set(activeKeys),
      buttons: new Set(activeButtons)
    };
    activeKeys.clear();
    activeButtons.clear();
    pointerDeltaX = 0;
    pointerDeltaY = 0;
    paused = true;
    inspecting = false;
    notify();
    return true;
  }

  function resume() {
    if (!paused) return false;
    const snapshot = resumeSnapshot;
    activeKeys.clear();
    activeButtons.clear();

    if (snapshot && !inspecting) {
      for (const code of snapshot.keys) {
        if (physicalKeys.has(code) && !blockedKeys.has(code)) activeKeys.add(code);
      }
      for (const button of snapshot.buttons) {
        if (physicalButtons.has(button) && !blockedButtons.has(button)) activeButtons.add(button);
      }
    }

    resumeSnapshot = null;
    paused = false;
    inspecting = false;
    pointerDeltaX = 0;
    pointerDeltaY = 0;
    notify();
    return true;
  }

  function beginInspection() {
    if (!paused) return false;
    if (!inspecting) {
      inspecting = true;
      resumeSnapshot = null;
      for (const code of physicalKeys) blockedKeys.add(code);
      for (const button of physicalButtons) blockedButtons.add(button);
      activeKeys.clear();
      activeButtons.clear();
      pointerDeltaX = 0;
      pointerDeltaY = 0;
      notify();
    }
    return true;
  }

  function keyDown(code) {
    if (!allowedKeys.has(code) || physicalKeys.has(code)) return false;
    physicalKeys.add(code);
    if (paused) {
      blockedKeys.add(code);
      return false;
    }
    if (blockedKeys.has(code)) return false;
    activeKeys.add(code);
    notify();
    return true;
  }

  function keyUp(code) {
    const wasPhysical = physicalKeys.delete(code);
    blockedKeys.delete(code);
    const wasActive = activeKeys.delete(code);
    removeFromResumeSnapshot("keys", code);
    if (wasActive || (paused && resumeSnapshot && wasPhysical)) notify();
    return wasPhysical || wasActive;
  }

  function pointerDown(button) {
    if (!allowedButtons.has(button) || physicalButtons.has(button)) return false;
    physicalButtons.add(button);
    if (paused) {
      blockedButtons.add(button);
      beginInspection();
      return false;
    }
    if (blockedButtons.has(button)) return false;
    activeButtons.add(button);
    notify();
    return true;
  }

  function pointerUp(button) {
    const wasPhysical = physicalButtons.delete(button);
    blockedButtons.delete(button);
    const wasActive = activeButtons.delete(button);
    removeFromResumeSnapshot("buttons", button);
    if (wasActive || (paused && resumeSnapshot && wasPhysical)) notify();
    return wasPhysical || wasActive;
  }

  function pointerMove(movementX, movementY) {
    if (paused || (!Number.isFinite(movementX) || !Number.isFinite(movementY))) return false;
    pointerDeltaX += movementX;
    pointerDeltaY += movementY;
    return true;
  }

  function consumeFrameInput() {
    const frame = Object.freeze({
      keys: Object.freeze([...activeKeys].sort()),
      buttons: Object.freeze([...activeButtons].sort((a, b) => a - b)),
      pointerDelta: Object.freeze({ x: pointerDeltaX, y: pointerDeltaY })
    });
    pointerDeltaX = 0;
    pointerDeltaY = 0;
    return frame;
  }

  function clearForFocusLoss() {
    physicalKeys.clear();
    physicalButtons.clear();
    blockedKeys.clear();
    blockedButtons.clear();
    activeKeys.clear();
    activeButtons.clear();
    resumeSnapshot = null;
    inspecting = paused;
    pointerDeltaX = 0;
    pointerDeltaY = 0;
    notify();
  }

  return Object.freeze({
    pause,
    resume,
    beginInspection,
    keyDown,
    keyUp,
    pointerDown,
    pointerUp,
    pointerMove,
    consumeFrameInput,
    clearForFocusLoss,
    getState
  });
}
