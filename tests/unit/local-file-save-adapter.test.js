import test from "node:test";
import assert from "node:assert/strict";

import {
  LocalFileSaveAdapter,
  DEV_LAB_SAVE_SLOT
} from "../../src/adapters/storage/local-file-save-adapter.js";

const sampleSave = {
  metadata: { stateId: "dev-lab-workspace", formatVersion: 1 },
  schemas: { "core.entity-registry": 1 },
  snapshots: { "core.entity-registry": { version: 1, entities: [] } }
};

function envelope(data = sampleSave) {
  return JSON.stringify({ format: "cassandra.save", fileFormatVersion: 1, data });
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
    assert.equal(await adapter.writeAtomic(DEV_LAB_SAVE_SLOT, sampleSave), true);
    const changedSave = { ...sampleSave, metadata: { ...sampleSave.metadata, revision: 2 } };
    await adapter.writeAtomic(DEV_LAB_SAVE_SLOT, changedSave);
    assert.equal(file.writes.length, 2);
    assert.deepEqual(JSON.parse(file.storedText).data, changedSave);
    assert.deepEqual(await adapter.read(DEV_LAB_SAVE_SLOT), changedSave);
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
    assert.deepEqual(await adapter.read(DEV_LAB_SAVE_SLOT), sampleSave);
    const changedSave = { ...sampleSave, metadata: { ...sampleSave.metadata, revision: 3 } };
    await adapter.writeAtomic(DEV_LAB_SAVE_SLOT, changedSave);
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
  assert.deepEqual(await adapter.read(DEV_LAB_SAVE_SLOT), sampleSave);
  adapter.setDownloadFileName("new-colony.cass");
  await adapter.writeAtomic(DEV_LAB_SAVE_SLOT, sampleSave);
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

test("local file adapter refuses unsupported slots and missing save sources", async () => {
  const adapter = new LocalFileSaveAdapter();
  await assert.rejects(adapter.read(DEV_LAB_SAVE_SLOT), (error) => error.code === "SAVE_SOURCE_NOT_SELECTED");
  await assert.rejects(adapter.read("another-slot"), (error) => error.code === "UNSUPPORTED_SAVE_SLOT");
  assert.throws(() => adapter.setDownloadFileName("bad/name.cass"), /simple \.cass filename/);
});
