import test from "node:test";
import assert from "node:assert/strict";
import { createGameRuntime } from "../../src/host/create-game-runtime.js";
import { MemorySaveAdapter } from "../../src/core/persistence.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createGameInputSystem } from "../../src/gameplay/input/game-input-system.js";
import { createViewportInputController } from "../../src/application/input/viewport-input-controller.js";
import { clearDefinitionsForTests, getDefinition } from "../../src/application/database/definition-registry.js";
import { loadCanonicalDefinitions } from "../../src/application/database/database-loader.js";

test("Johny exists as a live world Unit backed by his canonical database identity", async () => {
  clearDefinitionsForTests();
  loadCanonicalDefinitions();

  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [
      createGameInputSystem({ inputController: createViewportInputController() }),
      createUnitSystem({ definitionLookup: getDefinition })
    ]
  });

  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    worlds.registerWorld({
      worldId: "johny-test-world",
      type: "test",
      dimensions: { width: 128, height: 128 },
      coordinateSystem: "tiles"
    });
    worlds.activateWorld("johny-test-world");

    const unitApi = context.getService("game.unit-api");
    const johny = unitApi.createUnit({
      definitionId: "pawn.johny",
      worldId: "johny-test-world",
      position: { x: 64, y: 64 }
    });
    const definition = getDefinition(johny.definitionId);

    assert.equal(definition.name, "Johny");
    assert.equal(definition.entityType, "human");
    assert.equal(definition.attributes.age, 32);
    assert.equal(definition.attributes.role, null);
    assert.equal(johny.definitionId, "pawn.johny");
    assert.deepEqual(johny.placement.position, { x: 64, y: 64 });
    assert.equal(unitApi.listUnits().length, 1);
  } finally {
    await runtime.destroy();
  }
});
