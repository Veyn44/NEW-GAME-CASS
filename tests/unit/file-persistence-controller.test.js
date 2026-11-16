import test from "node:test";
import assert from "node:assert/strict";

import { LocalFileSaveAdapter } from "../../src/adapters/storage/local-file-save-adapter.js";
import { createFilePersistenceController } from "../../shared/application/file-persistence-controller.js";

function envelope(data) {
  return JSON.stringify({ format: "cassandra.save", fileFormatVersion: 1, data });
}

function readableFile(name, data) {
  return { name, async text() { return envelope(data); } };
}

test("failed inner save validation preserves the previously selected save source", async () => {
  const adapter = new LocalFileSaveAdapter();
  const previousData = {
    metadata: { stateId: "cassandra-main-world", formatVersion: 1 },
    schemas: {},
    snapshots: {}
  };
  await adapter.importFile(readableFile("previous.cass", previousData));

  const controller = createFilePersistenceController({
    persistenceApi: {
      async load() {
        const error = new Error("The saved system schema is incompatible.");
        error.code = "SCHEMA_MISMATCH";
        throw error;
      },
      async save() { throw new Error("Not used by this test."); }
    },
    saveAdapter: adapter,
    fileInput: { click() {} },
    saveSlot: "cassandra-main-world",
    stateId: "cassandra-main-world",
    supportsFileAccess: () => false,
    fileExtension: ".cass",
    defaultFileName: "save.cass"
  });

  const imported = await controller.importFile(readableFile("incompatible.cass", {
    metadata: { stateId: "cassandra-main-world", formatVersion: 1 },
    schemas: { "core.world-context": 999 },
    snapshots: {}
  }));

  assert.equal(imported, false);
  assert.equal(adapter.selectedFileName, "previous.cass");
  assert.deepEqual(await adapter.read("cassandra-main-world"), previousData);
});

test("successful import commits the new save source after persistence restore", async () => {
  const adapter = new LocalFileSaveAdapter();
  const previousData = {
    metadata: { stateId: "cassandra-main-world", formatVersion: 1 },
    schemas: {},
    snapshots: {}
  };
  const nextData = {
    metadata: { stateId: "cassandra-main-world", formatVersion: 1, revision: 2 },
    schemas: {},
    snapshots: {}
  };
  await adapter.importFile(readableFile("previous.cass", previousData));

  let restored = false;
  const controller = createFilePersistenceController({
    persistenceApi: {
      async load() {},
      async save() { throw new Error("Not used by this test."); }
    },
    saveAdapter: adapter,
    fileInput: { click() {} },
    saveSlot: "cassandra-main-world",
    stateId: "cassandra-main-world",
    supportsFileAccess: () => false,
    fileExtension: ".cass",
    defaultFileName: "save.cass",
    onRestore() { restored = true; }
  });

  const imported = await controller.importFile(readableFile("next.cass", nextData));
  assert.equal(imported, true);
  assert.equal(restored, true);
  assert.equal(adapter.selectedFileName, "next.cass");
  assert.deepEqual(await adapter.read("cassandra-main-world"), nextData);
});
