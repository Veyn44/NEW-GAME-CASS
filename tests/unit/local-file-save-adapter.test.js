import test from "node:test";
import assert from "node:assert/strict";

import {
  LocalFileSaveAdapter,
  CASSANDRA_SAVE_SLOT,
  DEV_LAB_SAVE_SLOT,
  DEV_LAB_SAVE_FORMAT,
  DEV_LAB_SAVE_FILE_EXTENSION,
  DEV_LAB_SAVE_FILE_NAME,
  DEV_LAB_SAVE_MIME_TYPE
} from "../../src/adapters/storage/local-file-save-adapter.js";

const sampleSave = {
  metadata: { stateId: "cassandra-main-world", formatVersion: 1 },
  schemas: { "core.entity-registry": 1 },
  snapshots: { "core.entity-registry": { version: 1, entities: [] } }
};

function envelope(data = sampleSave, format = "cassandra.save") {
  return JSON.stringify({ format, fileFormatVersion: 1, data });
}

function createFileHandle(name, initialText = null) {
  let storedText = initialText;
  const writes = [];
  return {
    name,
    async queryPermission() { return "granted"; },
    async getFile() { return { async text() { return storedText; } }; },
    async createWritable() {
      let pending = "";
      return {
        async write(value) { pending = value; },
        async close() { storedText = pending; writes.push(pending); },
        async abort() { pending = ""; }
      };
    },
    get storedText() { return storedText; },
    get writes() { return writes; }
  };
}

test("Save As creates a named .cass file and Save overwrites that same selected file", async () => {
  const file = createFileHandle("colony-before-landing.cass");
  const originalWindow = globalThis.window;
  globalThis.window = { showSaveFilePicker: async () => file, showOpenFilePicker: async () => [file] };
  try {
    const adapter = new LocalFileSaveAdapter();
    assert.equal(await adapter.selectSaveFile(), "colony-before-landing.cass");
    assert.equal(await adapter.writeAtomic(CASSANDRA_SAVE_SLOT, sampleSave), true);
    const changedSave = { ...sampleSave, metadata: { ...sampleSave.metadata, revision: 2 } };
    await adapter.writeAtomic(CASSANDRA_SAVE_SLOT, changedSave);
    assert.equal(file.writes.length, 2);
    assert.deepEqual(JSON.parse(file.storedText).data, changedSave);
    assert.deepEqual(await adapter.read(CASSANDRA_SAVE_SLOT), changedSave);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("Load selects an existing named .cass file and keeps it as the current Save target", async () => {
  const file = createFileHandle("colony-after-landing.cass", envelope());
  const originalWindow = globalThis.window;
  globalThis.window = { showSaveFilePicker: async () => file, showOpenFilePicker: async () => [file] };
  try {
    const adapter = new LocalFileSaveAdapter();
    assert.equal(await adapter.selectLoadFile(), "colony-after-landing.cass");
    assert.deepEqual(await adapter.read(CASSANDRA_SAVE_SLOT), sampleSave);
    const changedSave = { ...sampleSave, metadata: { ...sampleSave.metadata, revision: 3 } };
    await adapter.writeAtomic(CASSANDRA_SAVE_SLOT, changedSave);
    assert.deepEqual(JSON.parse(file.storedText).data, changedSave);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("local file adapter imports and exports named .cass files without file picker support", async () => {
  const downloads = [];
  const adapter = new LocalFileSaveAdapter({
    download(text, fileName) { downloads.push({ text, fileName }); }
  });
  await adapter.importFile({ name: "old-colony.cass", async text() { return envelope(); } });
  assert.deepEqual(await adapter.read(CASSANDRA_SAVE_SLOT), sampleSave);
  adapter.setDownloadFileName("new-colony.cass");
  await adapter.writeAtomic(CASSANDRA_SAVE_SLOT, sampleSave);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].fileName, "new-colony.cass");
  assert.deepEqual(JSON.parse(downloads[0].text).data, sampleSave);
});

test("local file adapter rejects malformed, incompatible and non-Cassandra files", async () => {
  const adapter = new LocalFileSaveAdapter();
  await assert.rejects(
    adapter.importFile({ name: "save.cass", async text() { return "not json"; } }),
    (error) => error.code === "INVALID_SAVE_FILE"
  );
  await assert.rejects(
    adapter.importFile({ name: "save.cass", async text() { return JSON.stringify({ format: "other", data: {} }); } }),
    (error) => error.code === "INCOMPATIBLE_SAVE_FILE"
  );
  await assert.rejects(
    adapter.importFile({ name: "save.json", async text() { return envelope(); } }),
    (error) => error.code === "INVALID_SAVE_EXTENSION"
  );
});

test("local file adapter safely rejects unsupported historical .cass envelope versions", async () => {
  const adapter = new LocalFileSaveAdapter();
  await adapter.importFile({ name: "current.cass", async text() { return envelope(); } });
  await assert.rejects(
    adapter.importFile({
      name: "historical-v0.cass",
      async text() {
        return JSON.stringify({ format: "cassandra.save", fileFormatVersion: 0, data: sampleSave });
      }
    }),
    (error) => error.code === "INCOMPATIBLE_SAVE_FILE"
  );
  assert.deepEqual(await adapter.read(CASSANDRA_SAVE_SLOT), sampleSave);
  assert.equal(adapter.selectedFileName, "current.cass");
});

test("clearSelection forgets the current save target and imported data", async () => {
  const adapter = new LocalFileSaveAdapter();
  await adapter.importFile({ name: "current.cass", async text() { return envelope(); } });
  assert.equal(adapter.selectedFileName, "current.cass");
  adapter.clearSelection();
  assert.equal(adapter.selectedFileName, null);
  await assert.rejects(adapter.read(CASSANDRA_SAVE_SLOT), (error) => error.code === "SAVE_SOURCE_NOT_SELECTED");
});

test("local file adapter refuses unsupported slots and missing save sources", async () => {
  const adapter = new LocalFileSaveAdapter();
  await assert.rejects(adapter.read(CASSANDRA_SAVE_SLOT), (error) => error.code === "SAVE_SOURCE_NOT_SELECTED");
  await assert.rejects(adapter.read("another-slot"), (error) => error.code === "UNSUPPORTED_SAVE_SLOT");
  assert.throws(() => adapter.setDownloadFileName("bad/name.cass"), /simple \.cass filename/);
});


test("Dev Lab uses a distinct extension, envelope format and persistence slot", async () => {
  const downloads = [];
  const devLabSave = {
    ...sampleSave,
    metadata: { ...sampleSave.metadata, stateId: "cassandra-dev-lab-workspace" }
  };
  const adapter = new LocalFileSaveAdapter({
    format: DEV_LAB_SAVE_FORMAT,
    fileExtension: DEV_LAB_SAVE_FILE_EXTENSION,
    mimeType: DEV_LAB_SAVE_MIME_TYPE,
    fileDescription: "Dev Lab workspace",
    defaultFileName: DEV_LAB_SAVE_FILE_NAME,
    slotId: DEV_LAB_SAVE_SLOT,
    download(text, fileName, mimeType) { downloads.push({ text, fileName, mimeType }); }
  });

  await adapter.importFile({
    name: DEV_LAB_SAVE_FILE_NAME,
    async text() { return envelope(devLabSave, DEV_LAB_SAVE_FORMAT); }
  });
  assert.deepEqual(await adapter.read(DEV_LAB_SAVE_SLOT), devLabSave);
  await assert.rejects(
    adapter.read(CASSANDRA_SAVE_SLOT),
    (error) => error.code === "UNSUPPORTED_SAVE_SLOT"
  );

  await assert.rejects(
    adapter.importFile({ name: "legacy-workspace.cass", async text() { return envelope(); } }),
    (error) => error.code === "INVALID_SAVE_EXTENSION"
  );
  await assert.rejects(
    adapter.importFile({
      name: "renamed-legacy-workspace.dlcass",
      async text() { return envelope(devLabSave, "cassandra.save"); }
    }),
    (error) => error.code === "INCOMPATIBLE_SAVE_FILE"
  );
  assert.deepEqual(await adapter.read(DEV_LAB_SAVE_SLOT), devLabSave);

  adapter.setDownloadFileName(DEV_LAB_SAVE_FILE_NAME);
  await adapter.writeAtomic(DEV_LAB_SAVE_SLOT, devLabSave);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].fileName, DEV_LAB_SAVE_FILE_NAME);
  assert.equal(downloads[0].mimeType, DEV_LAB_SAVE_MIME_TYPE);
  assert.equal(JSON.parse(downloads[0].text).format, DEV_LAB_SAVE_FORMAT);
  assert.deepEqual(JSON.parse(downloads[0].text).data, devLabSave);
});

test("Cassandra adapter rejects Dev Lab files even when their JSON payload is readable", async () => {
  const adapter = new LocalFileSaveAdapter();
  await assert.rejects(
    adapter.importFile({
      name: DEV_LAB_SAVE_FILE_NAME,
      async text() { return envelope(sampleSave, DEV_LAB_SAVE_FORMAT); }
    }),
    (error) => error.code === "INVALID_SAVE_EXTENSION"
  );
});
