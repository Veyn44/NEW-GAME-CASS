import test from "node:test";
import assert from "node:assert/strict";

import {
  LocalFileSaveAdapter,
  DEV_LAB_SAVE_SLOT,
  CASSANDRA_SAVE_FILE_NAME
} from "../../src/adapters/storage/local-file-save-adapter.js";

function createDirectoryHandle(initialText = null) {
  let storedText = initialText;
  const writes = [];
  const handle = {
    name: "1",
    async queryPermission() { return "granted"; },
    async getFileHandle(name, { create } = {}) {
      assert.equal(name, CASSANDRA_SAVE_FILE_NAME);
      if (storedText === null && !create) {
        const error = new Error("Not found");
        error.name = "NotFoundError";
        throw error;
      }
      return {
        async getFile() {
          return { async text() { return storedText; } };
        },
        async createWritable() {
          let pending = "";
          let closed = false;
          return {
            async write(value) { pending = value; },
            async close() {
              closed = true;
              storedText = pending;
              writes.push(pending);
            },
            async abort() { pending = ""; }
          };
        }
      };
    },
    get storedText() { return storedText; },
    get writes() { return writes; }
  };
  return handle;
}

const sampleSave = {
  metadata: { stateId: "dev-lab-workspace", formatVersion: 1 },
  schemas: { "core.entity-registry": 1 },
  snapshots: { "core.entity-registry": { version: 1, entities: [] } }
};

function envelope(data = sampleSave) {
  return JSON.stringify({ format: "cassandra.save", fileFormatVersion: 1, data });
}

test("local file adapter reads and writes the Cassandra save envelope in the selected folder", async () => {
  const adapter = new LocalFileSaveAdapter();
  const directory = createDirectoryHandle();
  // Inject the selected handle through the public directory-picker seam.
  const originalWindow = globalThis.window;
  globalThis.window = { showDirectoryPicker: async () => directory };
  try {
    assert.equal(await adapter.selectDirectory(), "1");
    assert.equal(adapter.selectedDirectoryName, "1");
    assert.equal(await adapter.writeAtomic(DEV_LAB_SAVE_SLOT, sampleSave), true);
    assert.equal(directory.writes.length, 1);
    assert.deepEqual(JSON.parse(directory.storedText), {
      format: "cassandra.save",
      fileFormatVersion: 1,
      data: sampleSave
    });
    assert.deepEqual(await adapter.read(DEV_LAB_SAVE_SLOT), sampleSave);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("local file adapter imports .cass files for browsers without direct directory access", async () => {
  const downloads = [];
  const adapter = new LocalFileSaveAdapter({
    download(text, fileName) { downloads.push({ text, fileName }); }
  });
  await adapter.importFile({
    name: "save.cass",
    async text() { return envelope(); }
  });
  assert.deepEqual(await adapter.read(DEV_LAB_SAVE_SLOT), sampleSave);
  assert.equal(await adapter.writeAtomic(DEV_LAB_SAVE_SLOT, sampleSave), true);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].fileName, "save.cass");
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
  assert.throws(() => new LocalFileSaveAdapter({ fileName: "save.json" }), /\.cass filename/);
});
