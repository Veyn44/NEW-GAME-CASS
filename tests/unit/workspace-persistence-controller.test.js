import test from "node:test";
import assert from "node:assert/strict";

import { createFilePersistenceController } from "../../shared/application/file-persistence-controller.js";

test("workspace persistence controller saves through the Engine persistence API", async () => {
  const calls = [];
  const statuses = [];
  const persistenceApi = {
    async save(slot, options) {
      calls.push({ slot, options });
      return { createdAt: "2026-11-14T12:00:00.000Z" };
    },
    async load() { throw new Error("not used"); }
  };
  const adapter = {
    selectedFileName: "ship.cass",
    clearSelection() { this.selectedFileName = null; },
    async importFile() {},
    setDownloadFileName(name) { this.selectedFileName = name; }
  };
  const controller = createFilePersistenceController({
    persistenceApi,
    saveAdapter: adapter,
    saveSlot: "dev-lab-workspace",
    stateId: "cassandra-dev-lab-workspace",
    supportsFileAccess: () => false,
    requestFileName: () => "save.cass",
    fileExtension: ".cass",
    defaultFileName: "save.cass",
    fileInput: { click() {} },
    onStatus: (status) => statuses.push(status)
  });

  assert.equal(await controller.save(), true);
  assert.deepEqual(calls[0], {
    slot: "dev-lab-workspace",
    options: { stateId: "cassandra-dev-lab-workspace", kind: "manual" }
  });
  assert.equal(statuses.at(-1).saveStatus, "SAVED · ship.cass");
  assert.equal(statuses.at(-1).simulationStatus, "WORKSPACE SAVED · 2026-11-14T12:00:00.000Z");
});

test("workspace persistence controller imports a file and synchronizes the restored workspace", async () => {
  const calls = [];
  let restored = 0;
  const adapter = {
    selectedFileName: "import.cass",
    async importFile(file) { calls.push(["import", file.name]); },
    clearSelection() {},
    setDownloadFileName() {}
  };
  const controller = createFilePersistenceController({
    persistenceApi: {
      async save() {},
      async load(slot, options) { calls.push(["load", slot, options.stateId]); }
    },
    saveAdapter: adapter,
    saveSlot: "dev-lab-workspace",
    stateId: "cassandra-dev-lab-workspace",
    supportsFileAccess: () => false,
    requestFileName: () => "save.cass",
    fileExtension: ".cass",
    defaultFileName: "save.cass",
    fileInput: { click() {} },
    onRestore: () => { restored += 1; }
  });

  assert.equal(await controller.importFile({ name: "import.cass" }), true);
  assert.deepEqual(calls, [
    ["import", "import.cass"],
    ["load", "dev-lab-workspace", "cassandra-dev-lab-workspace"]
  ]);
  assert.equal(restored, 1);
});

test("workspace persistence controller delegates browser file selection and exposes reset", async () => {
  let clicked = 0;
  let cleared = 0;
  const controller = createFilePersistenceController({
    persistenceApi: { async save() {}, async load() {} },
    saveAdapter: {
      selectedFileName: null,
      clearSelection() { cleared += 1; },
      async importFile() {},
      setDownloadFileName() {}
    },
    saveSlot: "dev-lab-workspace",
    stateId: "cassandra-dev-lab-workspace",
    supportsFileAccess: () => false,
    requestFileName: () => "save.cass",
    fileExtension: ".cass",
    defaultFileName: "save.cass",
    fileInput: { click() { clicked += 1; } }
  });

  assert.equal(await controller.load(), false);
  assert.equal(clicked, 1);
  controller.clearSelection();
  assert.equal(cleared, 1);
});


test("file persistence controller injects save identity and filename selection", async () => {
  const calls = [];
  const requested = [];
  const adapter = {
    selectedFileName: null,
    clearSelection() { this.selectedFileName = null; },
    setDownloadFileName(name) { this.selectedFileName = name; },
    async importFile() {}
  };
  const controller = createFilePersistenceController({
    persistenceApi: {
      async save(slot, options) {
        calls.push({ slot, options });
        return { createdAt: "2026-11-14T13:00:00.000Z" };
      },
      async load() {}
    },
    saveAdapter: adapter,
    fileInput: { click() {} },
    saveSlot: "app-specific-slot",
    stateId: "app-specific-state",
    supportsFileAccess: () => false,
    requestFileName: (details) => {
      requested.push(details);
      return "ship-backup";
    },
    fileExtension: ".sav",
    defaultFileName: "default.sav"
  });

  assert.equal(await controller.saveAs(), true);
  assert.deepEqual(requested, [{ currentFileName: "", defaultFileName: "default.sav" }]);
  assert.equal(adapter.selectedFileName, "ship-backup.sav");
  assert.deepEqual(calls, [{
    slot: "app-specific-slot",
    options: { stateId: "app-specific-state", kind: "manual" }
  }]);
});

test("file persistence controller requires a selected file when native file access is enabled", async () => {
  let saveCalls = 0;
  let loadCalls = 0;
  const adapter = {
    selectedFileName: null,
    clearSelection() {},
    setDownloadFileName() {},
    async importFile() {},
    async selectLoadFile() {
      this.selectedFileName = "selected.cass";
      return this.selectedFileName;
    }
  };
  const controller = createFilePersistenceController({
    persistenceApi: {
      async save() { saveCalls += 1; },
      async load(slot, options) {
        loadCalls += 1;
        assert.equal(slot, "app-slot");
        assert.equal(options.stateId, "app-state");
      }
    },
    saveAdapter: adapter,
    fileInput: { click() { throw new Error("native file access should be used"); } },
    saveSlot: "app-slot",
    stateId: "app-state",
    supportsFileAccess: () => true,
    requestFileName: () => "unused.cass"
  });

  assert.equal(await controller.save(), false);
  assert.equal(saveCalls, 0);
  assert.equal(await controller.load(), true);
  assert.equal(loadCalls, 1);
});
