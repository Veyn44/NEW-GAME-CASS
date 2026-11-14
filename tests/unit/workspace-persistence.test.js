import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createGameInputSystem } from "../../src/gameplay/input/game-input-system.js";
import { createColonyControlSystem } from "../../src/gameplay/colony/colony-control-system.js";
import { createViewportInputController } from "../../src/application/input/viewport-input-controller.js";
import {
  clearDefinitionsForTests,
  getDefinition,
  registerDefinition
} from "../../src/application/database/definition-registry.js";

test("workspace round-trip restores world, identity, placement, Unit and Colony Leader without duplicates", async () => {
  clearDefinitionsForTests();
  registerDefinition({
    id: "test.workspace-pawn",
    name: "Workspace Pawn",
    category: "Units",
    description: "Persistence integration test content.",
    attributes: {}
  });

  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [
      createGameInputSystem({ inputController: createViewportInputController() }),
      createUnitSystem({ definitionLookup: getDefinition }),
      createColonyControlSystem()
    ]
  });

  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    const entities = context.getService("core.entity-registry");
    const worldContext = context.getService("core.world-context");
    const persistence = context.getService("core.persistence");
    const units = context.getService("game.unit-api");
    const colony = context.getService("game.colony-control-api");

    worlds.registerWorld({
      worldId: "workspace-round-trip-world",
      type: "test",
      dimensions: { width: 64, height: 64 },
      coordinateSystem: "tiles"
    });
    worlds.activateWorld("workspace-round-trip-world");

    const original = units.createUnit({
      definitionId: "test.workspace-pawn",
      worldId: "workspace-round-trip-world",
      position: { x: 12, y: 23 }
    });
    colony.setLeader(original.id);

    await persistence.save("workspace-round-trip", {
      stateId: "workspace-round-trip-state"
    });

    units.removeUnit(original.id);
    const replacement = units.createUnit({
      definitionId: "test.workspace-pawn",
      worldId: "workspace-round-trip-world",
      position: { x: 40, y: 41 }
    });
    colony.setLeader(replacement.id);

    assert.notEqual(replacement.id, original.id);
    assert.equal(units.listUnits().length, 1);

    await persistence.load("workspace-round-trip", {
      stateId: "workspace-round-trip-state"
    });

    const restored = units.getUnit(original.id);
    assert.ok(restored);
    assert.equal(restored.definitionId, "test.workspace-pawn");
    assert.deepEqual(restored.placement.position, { x: 12, y: 23 });
    assert.equal(units.getUnit(replacement.id), null);
    assert.equal(entities.get(original.id).kind, "unit");
    assert.equal(entities.get(original.id).status, "active");
    assert.deepEqual(worldContext.getPlacement(original.id).position, { x: 12, y: 23 });
    assert.equal(colony.getState().leaderId, original.id);
    assert.equal(units.listUnits().length, 1);
  } finally {
    await runtime.destroy();
    clearDefinitionsForTests();
  }
});
