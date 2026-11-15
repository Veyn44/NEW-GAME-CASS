import test from "node:test";
import assert from "node:assert/strict";

import { createGameRuntime } from "../../engine/runtime/create-game-runtime.js";
import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { registerDefinition, getDefinition, clearDefinitionsForTests } from "../../engine/database/definition-registry.js";
import { createUnitSystem } from "../../src/gameplay/unit/unit-system.js";
import { createCassandraWorldSessionSystem } from "../../src/gameplay/world/cassandra-world-session-system.js";
import { createCassandraExpeditionProjectionSystem } from "../../src/gameplay/expedition/cassandra-expedition-projection-system.js";
import {
  createCassandraUnitExpeditionProjection
} from "../../src/gameplay/expedition/cassandra-unit-expedition-projection.js";

async function setup({ isPackageApplied = async () => true } = {}) {
  clearDefinitionsForTests();
  registerDefinition({
    id: "unit.expedition-worker",
    name: "Expedition Worker",
    category: "Units",
    description: "Test expedition participant.",
    attributes: {}
  });
  const runtime = createGameRuntime({
    saveAdapter: new MemorySaveAdapter(),
    hostSystems: [
      createUnitSystem({ definitionLookup: getDefinition }),
      createCassandraWorldSessionSystem({ isPackageApplied }),
      createCassandraExpeditionProjectionSystem()
    ]
  });
  const context = await runtime.start();
  const worlds = context.getService("core.world-registry");
  worlds.registerWorld({
    worldId: "expedition-main",
    type: "cassandra-main",
    dimensions: { width: 32, height: 32 },
    grid: { width: 32, height: 32 },
    coordinateSystem: "tiles"
  });
  const worldSession = context.getService("game.world-session-api");
  worldSession.registerMainWorld("expedition-main");
  const unitApi = context.getService("game.unit-api");
  const first = unitApi.createUnit({
    definitionId: "unit.expedition-worker",
    worldId: "expedition-main",
    position: { x: 5, y: 7 }
  });
  const second = unitApi.createUnit({
    definitionId: "unit.expedition-worker",
    worldId: "expedition-main",
    position: { x: 12, y: 14 }
  });
  worldSession.beginTemporaryWorld({ worldId: "expedition-temp", width: 32, height: 32 });
  return {
    runtime,
    context,
    worlds,
    unitApi,
    campaignUnits: [first, second],
    entityRegistry: context.getService("core.entity-registry"),
    worldSession: context.getService("game.world-session-api"),
    projectionApi: context.getService("game.expedition-projection-api"),
    persistence: context.getService("core.persistence"),
    spatial: context.getService("core.spatial-composition"),
    worldContext: context.getService("core.world-context")
  };
}

test("Cassandra Unit projection creates scoped Temporary World identities and records campaign mappings", async () => {
  const state = await setup();
  try {
    const result = createCassandraUnitExpeditionProjection({
      sessionId: "expedition:units",
      mainWorldId: "expedition-main",
      temporaryWorldId: "expedition-temp",
      campaignUnitIds: state.campaignUnits.map((unit) => unit.id),
      unitApi: state.unitApi,
      entityRegistry: state.entityRegistry,
      getProjectionMetadata: (unit) => ({
        aggregateId: `unit-aggregate:${unit.id}`,
        baselineRevision: 0,
        projectionRole: "participant",
        transferEligible: true
      })
    });

    assert.equal(result.projectedUnits.length, 2);
    for (const [index, source] of state.campaignUnits.entries()) {
      const projected = result.projectedUnits[index];
      assert.notEqual(projected.id, source.id);
      assert.equal(state.entityRegistry.get(projected.id).scopeId, "world:expedition-temp");
      assert.equal(projected.placement.worldId, "expedition-temp");
      assert.deepEqual(
        result.projection.getByCampaignId(source.id).temporaryEntityId,
        projected.id
      );
    }
    assert.equal(result.validateReturnManifest(state.campaignUnits.map((unit) => ({
      campaignEntityId: unit.id,
      disposition: "returned"
    }))), true);

    state.projectionApi.registerProjection(result.projection);
    await state.persistence.save("expedition-projection", { stateId: "expedition-projection-state" });
    for (const projected of result.projectedUnits) state.unitApi.removeUnit(projected.id);
    state.worldSession.returnToMainWorld();
    await state.persistence.load("expedition-projection", { stateId: "expedition-projection-state" });

    assert.equal(state.worldSession.getState().activeWorldId, "expedition-temp");
    assert.equal(state.projectionApi.hasProjection(), true);
    for (const source of state.campaignUnits) {
      const mapping = state.projectionApi.getProjection().getByCampaignId(source.id);
      assert.ok(mapping);
      assert.ok(state.unitApi.getUnit(mapping.temporaryEntityId));
    }

    state.spatial.addCellContent({
      contentId: "content:temporary-terrain",
      worldId: "expedition-temp",
      cell: { x: 1, y: 1 },
      categoryId: "terrain",
      layerId: "ground",
      payload: { material: "rock" }
    });
    state.worldSession.returnToMainWorld();
    const completed = await state.worldSession.completeTemporaryWorld({
      packageId: "package:expedition:one",
      digest: "a".repeat(64)
    });
    assert.equal(completed.temporaryWorldId, null);
    assert.equal(state.worlds.has("expedition-temp"), false);
    assert.equal(state.projectionApi.hasProjection(), false);
    assert.equal(state.unitApi.listUnits().length, 2);
    assert.equal(state.worldContext.listPlacements({ worldId: "expedition-temp" }).length, 0);
    assert.equal(state.spatial.listEntityOccupancies({ worldId: "expedition-temp" }).length, 0);
    assert.equal(state.spatial.listContents({ worldId: "expedition-temp" }).length, 0);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Cassandra refuses Temporary World disposal until the exact package is in the Applied ledger", async () => {
  const state = await setup({ isPackageApplied: async () => false });
  try {
    state.worldSession.returnToMainWorld();
    await assert.rejects(
      () => state.worldSession.completeTemporaryWorld({
        packageId: "package:not-applied",
        digest: "b".repeat(64)
      }),
      { code: "CHANGE_PACKAGE_NOT_APPLIED" }
    );
    assert.equal(state.worlds.has("expedition-temp"), true);
    assert.equal(state.worldSession.getState().temporaryWorldId, "expedition-temp");
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Projection mapping and Temporary Units survive a later cleanup preflight failure", async () => {
  const state = await setup();
  try {
    const result = createCassandraUnitExpeditionProjection({
      sessionId: "expedition:cleanup-preflight",
      mainWorldId: "expedition-main",
      temporaryWorldId: "expedition-temp",
      campaignUnitIds: [state.campaignUnits[0].id],
      unitApi: state.unitApi,
      entityRegistry: state.entityRegistry,
      getProjectionMetadata: (unit) => ({
        aggregateId: `unit-aggregate:${unit.id}`,
        baselineRevision: 0,
        projectionRole: "participant",
        transferEligible: true
      })
    });
    state.projectionApi.registerProjection(result.projection);
    const temporaryUnit = result.projectedUnits[0];
    state.worldSession.registerTemporaryWorldCleanup(() => {
      throw new Error("later cleanup preflight rejected");
    });
    state.worldSession.returnToMainWorld();

    await assert.rejects(
      () => state.worldSession.completeTemporaryWorld({
        packageId: "package:cleanup-preflight",
        digest: "d".repeat(64)
      }),
      /later cleanup preflight rejected/
    );
    assert.equal(state.worlds.has("expedition-temp"), true);
    assert.equal(state.projectionApi.hasProjection(), true);
    assert.ok(state.unitApi.getUnit(temporaryUnit.id));
    assert.equal(
      state.worldContext.listPlacements({ worldId: "expedition-temp" }).length,
      1
    );
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});

test("Cassandra Unit projection retires already-created Temporary Units if a later projection fails", async () => {
  const state = await setup();
  try {
    assert.throws(
      () => createCassandraUnitExpeditionProjection({
        sessionId: "expedition:rollback",
        mainWorldId: "expedition-main",
        temporaryWorldId: "expedition-temp",
        campaignUnitIds: state.campaignUnits.map((unit) => unit.id),
        unitApi: state.unitApi,
        entityRegistry: state.entityRegistry,
        getProjectionMetadata: (unit) => {
          if (unit.id === state.campaignUnits[1].id) throw new Error("metadata unavailable");
          return {
            aggregateId: `unit-aggregate:${unit.id}`,
            baselineRevision: 0,
            projectionRole: "participant",
            transferEligible: true
          };
        }
      }),
      /metadata unavailable/
    );
    assert.equal(state.unitApi.listUnits().length, 2);
    assert.equal(state.entityRegistry.list({ scope: "scoped", scopeId: "world:expedition-temp", status: "active" }).length, 0);
  } finally {
    await state.runtime.destroy();
    clearDefinitionsForTests();
  }
});
