import test from "node:test";
import assert from "node:assert/strict";

import { MemorySaveAdapter } from "../../engine/core/persistence.js";
import { createDevLabRuntime } from "../../dev-lab/application/create-dev-lab-runtime.js";
import { createCassandraRuntime } from "../../cassandra/application/cassandra-runtime-host.js";

async function runSpatialAcceptance(runtimeFactory, entityId) {
  const runtime = runtimeFactory({
    saveAdapter: new MemorySaveAdapter(),
    inputController: {
      getState: () => Object.freeze({}),
      consumeFrameInput: () => Object.freeze({})
    }
  });
  try {
    const context = await runtime.start();
    const worlds = context.getService("core.world-registry");
    const entities = context.getService("core.entity-registry");
    const worldContext = context.getService("core.world-context");
    const spatial = context.getService("core.spatial-composition");
    const placements = context.getService("core.placement-coordinator");

    worlds.registerWorld({
      worldId: "acceptance-world",
      type: "acceptance-grid",
      dimensions: { width: 32, height: 32 },
      grid: { width: 32, height: 32 },
      coordinateSystem: "tiles"
    });
    const entity = entities.registerPersistent({ id: entityId, kind: "acceptance-object" });
    placements.placeEntity(entity.id, {
      worldId: "acceptance-world",
      anchor: { x: 8, y: 9 },
      footprint: [{ x: 0, y: 0 }, { x: 1, y: 0 }]
    });

    const cell = spatial.queryCell("acceptance-world", { x: 9, y: 9 });
    const region = spatial.queryRegion("acceptance-world", {
      type: "rectangle",
      min: { x: 8, y: 9 },
      maxExclusive: { x: 10, y: 10 }
    });
    const footprint = spatial.getEntityFootprint(entity.id);
    const worldPlacement = worldContext.getPlacement(entity.id);

    assert.deepEqual(cell.entities.map((entry) => entry.entityId), [entity.id]);
    assert.deepEqual(region.entities.map((entry) => entry.entityId), [entity.id]);
    assert.equal(footprint.cells.length, 2);
    assert.deepEqual(worldPlacement.position, { x: 8.5, y: 9.5 });
    assert.deepEqual(spatial.getEntityOccupancy(entity.id).cells, footprint.cells);

    return {
      services: {
        worldRegistry: typeof worlds.registerWorld,
        entityRegistry: typeof entities.registerPersistent,
        spatialComposition: typeof spatial.queryRegion,
        placementCoordinator: typeof placements.placeEntity
      },
      query: {
        cells: footprint.cells,
        anchor: footprint.anchor
      }
    };
  } finally {
    await runtime.destroy();
  }
}

test("standalone Dev Lab and Cassandra host consume the same authoritative Engine spatial contracts", async () => {
  const standalone = await runSpatialAcceptance(createDevLabRuntime, "acceptance:standalone");
  const cassandra = await runSpatialAcceptance(createCassandraRuntime, "acceptance:cassandra");

  assert.deepEqual(standalone.services, cassandra.services);
  assert.deepEqual(standalone.query, cassandra.query);
});
