import test from "node:test";
import assert from "node:assert/strict";

import { createDevLabWorkspaceSessionController } from "../../dev-lab/application/workspace-session-controller.js";

function createHarness({ paused = true, confirm = true } = {}) {
  const calls = [];
  const units = [
    { id: "u1", placement: { worldId: "dev-lab-world-64" } },
    { id: "u2", placement: { worldId: "dev-lab-world-128" } }
  ];
  const worldRegistry = {
    activeWorldId: "dev-lab-world-64",
    worlds: new Map([
      ["dev-lab-world-64", { dimensions: { width: 64, height: 64 } }],
      ["dev-lab-world-128", { dimensions: { width: 128, height: 128 } }]
    ]),
    activateWorld(id) { this.activeWorldId = id; calls.push(["activate", id]); },
    get(id) { return this.worlds.get(id); }
  };
  const gameplayApi = {
    getControlState: () => ({ leaderId: "u1" }),
    getUnit: (id) => units.find((unit) => unit.id === id),
    setDrafted: (value) => calls.push(["drafted", value]),
    listUnits: () => [...units],
    removeUnit(id) { calls.push(["remove", id]); units.splice(units.findIndex((unit) => unit.id === id), 1); },
    setLeader: (id) => calls.push(["leader", id])
  };
  const inputController = {
    pause: () => calls.push(["input-pause"]),
    clearForFocusLoss: () => calls.push(["clear-input"])
  };
  const heldMovementKeys = new Set(["KeyW"]);
  const viewport = {
    resetCameraToWorld: (size) => calls.push(["camera", size ?? null])
  };
  const elements = {
    worldSizeSelect: { value: "64" },
    worldStatus: { textContent: "" }
  };
  let isPaused = paused;
  const controller = createDevLabWorkspaceSessionController({
    elements, worldRegistry, gameplayApi, clock: { pause: (reason) => calls.push(["clock-pause", reason]) },
    inputController, heldMovementKeys, viewport,
    isPaused: () => isPaused,
    setPaused: (value) => { isPaused = value; calls.push(["paused", value]); },
    clearSelection: () => calls.push(["selection-clear"]),
    refreshWorldMarkers: () => calls.push(["markers-refresh"]),
    updateSimulationUi: () => calls.push(["ui-update"]),
    cancelPlacement: () => calls.push(["placement-cancel"]),
    closeViewportDatabase: () => calls.push(["database-close"]),
    closeUnitProfile: () => calls.push(["profile-close"]),
    clearSaveSelection: () => calls.push(["save-clear"]),
    confirmReset: () => confirm,
    onResetStatus: () => calls.push(["reset-status"]),
    focusCanvas: () => calls.push(["focus"])
  });
  return { controller, calls, units, worldRegistry, elements, heldMovementKeys, get paused() { return isPaused; } };
}

test("world changes are blocked while running and refresh the active-world presentation", () => {
  const h = createHarness({ paused: false });
  assert.equal(h.controller.changeWorld("128"), false);
  assert.equal(h.worldRegistry.activeWorldId, "dev-lab-world-64");
  assert.equal(h.controller.changeWorld("128"), false);
  assert.equal(h.calls.some(([name]) => name === "activate"), false);
});

test("world change switches world, releases a leader placed on another world, and refreshes selection", () => {
  const h = createHarness();
  assert.equal(h.controller.changeWorld("128"), true);
  assert.equal(h.worldRegistry.activeWorldId, "dev-lab-world-128");
  assert.ok(h.calls.some(([name, value]) => name === "drafted" && value === false));
  assert.ok(h.calls.some(([name]) => name === "selection-clear"));
  assert.ok(h.calls.some(([name]) => name === "markers-refresh"));
  assert.ok(h.calls.some(([name]) => name === "ui-update"));
});

test("reset cancellation leaves the workspace untouched", () => {
  const h = createHarness({ confirm: false });
  assert.equal(h.controller.reset(), false);
  assert.equal(h.units.length, 2);
  assert.equal(h.heldMovementKeys.size, 1);
  assert.equal(h.calls.length, 0);
});

test("reset pauses safely, clears entities and session UI, then focuses the canvas", () => {
  const h = createHarness();
  assert.equal(h.controller.reset(), true);
  assert.equal(h.paused, true);
  assert.equal(h.units.length, 0);
  assert.equal(h.heldMovementKeys.size, 0);
  assert.deepEqual(h.calls.filter(([name]) => name === "remove"), [["remove", "u1"], ["remove", "u2"]]);
  for (const name of ["input-pause", "clear-input", "clock-pause", "placement-cancel", "database-close",
    "profile-close", "leader", "selection-clear", "markers-refresh", "save-clear", "reset-status", "ui-update", "focus"]) {
    assert.ok(h.calls.some(([called]) => called === name), `expected ${name}`);
  }
  assert.equal(h.elements.worldStatus.textContent, "World: 64 × 64");
  assert.ok(h.calls.some(([name, value]) => name === "camera" && value === 64));
});

test("restoring a workspace always pauses input, resets camera, and rebuilds selection markers", () => {
  const h = createHarness({ paused: false });
  h.controller.synchronizeRestoredWorkspace();
  assert.equal(h.paused, true);
  assert.equal(h.heldMovementKeys.size, 0);
  assert.equal(h.elements.worldSizeSelect.value, "64");
  assert.equal(h.elements.worldStatus.textContent, "World: 64 × 64");
  assert.ok(h.calls.some(([name]) => name === "clock-pause"));
  assert.ok(h.calls.some(([name]) => name === "camera"));
  assert.ok(h.calls.some(([name]) => name === "selection-clear"));
  assert.ok(h.calls.some(([name]) => name === "markers-refresh"));
  assert.ok(h.calls.some(([name]) => name === "ui-update"));
});

test("controller validates required session dependencies", () => {
  assert.throws(() => createDevLabWorkspaceSessionController(), /elements/);
});
