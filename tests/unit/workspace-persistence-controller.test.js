import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspacePersistenceController } from "../../dev-lab/application/workspace-persistence-controller.js";

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
  const controller = createWorkspacePersistenceController({
    persistenceApi,
    saveAdapter: adapter,
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
  const controller = createWorkspacePersistenceController({
    persistenceApi: {
      async save() {},
      async load(slot, options) { calls.push(["load", slot, options.stateId]); }
    },
    saveAdapter: adapter,
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
  const controller = createWorkspacePersistenceController({
    persistenceApi: { async save() {}, async load() {} },
    saveAdapter: {
      selectedFileName: null,
      clearSelection() { cleared += 1; },
      async importFile() {},
      setDownloadFileName() {}
    },
    fileInput: { click() { clicked += 1; } }
  });

  assert.equal(await controller.load(), false);
  assert.equal(clicked, 1);
  controller.clearSelection();
  assert.equal(cleared, 1);
});
