import { LocalFileSaveAdapter, DEV_LAB_SAVE_SLOT } from "../../src/adapters/storage/local-file-save-adapter.js";

/**
 * Owns Dev Lab workspace file selection and persistence orchestration.
 * Runtime persistence remains provided by the Engine.
 */
export function createWorkspacePersistenceController({
  persistenceApi,
  saveAdapter = new LocalFileSaveAdapter(),
  fileInput,
  onRestore = () => {},
  onStatus = () => {}
} = {}) {
  if (!persistenceApi || !saveAdapter || !fileInput) {
    throw new TypeError("Workspace persistence requires persistenceApi, saveAdapter and fileInput.");
  }

  const report = (saveStatus, simulationStatus = saveStatus) => onStatus({
    saveStatus,
    simulationStatus
  });

  function describeLoadFailure(error) {
    const code = error?.code ?? "LOAD_FAILED";
    const descriptions = {
      INVALID_SAVE_FILE: "The file is not valid JSON.",
      INCOMPATIBLE_SAVE_FILE: "This is not a supported Cassandra save file.",
      INCOMPATIBLE_SAVE_FORMAT: "The save format version is not supported.",
      STATE_MISMATCH: "The save belongs to a different workspace.",
      MISSING_REQUIRED_SNAPSHOT: "The save is missing required system data.",
      INVALID_SAVE: "The save is missing required data.",
      SCHEMA_MISMATCH: "A saved system schema is incompatible.",
      INVALID_SNAPSHOT: "A saved system rejected its data.",
      RESTORE_COMMIT_FAILED: "A system failed while restoring the save. The restore was rolled back where possible.",
      SAVE_NOT_FOUND: "No save data was found.",
      SAVE_SOURCE_NOT_SELECTED: "No save file is selected."
    };
    const detail = descriptions[code] ?? error?.message ?? "The save could not be loaded.";
    return `LOAD FAILED · ${code} · ${detail}`;
  }

  async function persist({ chooseFile = false } = {}) {
    try {
      if (chooseFile) {
        if (LocalFileSaveAdapter.supportsFileAccess) {
          const fileName = await saveAdapter.selectSaveFile();
          if (!fileName) return false;
          report(`SAVING AS · ${fileName}`);
        } else {
          const requestedName = window.prompt("Name this Cassandra save:", saveAdapter.selectedFileName || "save.cass");
          if (requestedName === null) return false;
          const trimmed = requestedName.trim();
          const safeName = trimmed.endsWith(".cass") ? trimmed : `${trimmed}.cass`;
          if (!/^[a-zA-Z0-9._ -]+\.cass$/i.test(safeName)) {
            report("SAVE FAILED · USE A SIMPLE FILE NAME");
            return false;
          }
          saveAdapter.setDownloadFileName(safeName);
        }
      } else if (!saveAdapter.selectedFileName && LocalFileSaveAdapter.supportsFileAccess) {
        report("NO SAVE SELECTED · USE SAVE AS FIRST");
        return false;
      }

      const metadata = await persistenceApi.save(DEV_LAB_SAVE_SLOT, {
        stateId: "cassandra-dev-lab-workspace",
        kind: "manual"
      });
      const fileName = saveAdapter.selectedFileName || "save.cass";
      report(`SAVED · ${fileName}`, `WORKSPACE SAVED · ${metadata.createdAt}`);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      report(`SAVE FAILED · ${error.message}`);
      return false;
    }
  }

  async function restore() {
    try {
      if (LocalFileSaveAdapter.supportsFileAccess) {
        const fileName = await saveAdapter.selectLoadFile();
        if (!fileName) return false;
        report(`LOADING · ${fileName}`);
      } else {
        fileInput.click();
        return false;
      }
      await persistenceApi.load(DEV_LAB_SAVE_SLOT, {
        stateId: "cassandra-dev-lab-workspace"
      });
      onRestore();
      report(`LOADED · ${saveAdapter.selectedFileName}`, "WORKSPACE RESTORED");
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      const message = describeLoadFailure(error);
      report(message);
      return false;
    }
  }

  async function importFile(file) {
    if (!file) return false;
    try {
      await saveAdapter.importFile(file);
      await persistenceApi.load(DEV_LAB_SAVE_SLOT, {
        stateId: "cassandra-dev-lab-workspace"
      });
      onRestore();
      report(`LOADED · ${file.name}`, "WORKSPACE RESTORED");
      return true;
    } catch (error) {
      const message = describeLoadFailure(error);
      report(message);
      return false;
    }
  }

  return Object.freeze({
    save: () => persist(),
    saveAs: () => persist({ chooseFile: true }),
    load: restore,
    importFile,
    clearSelection: () => saveAdapter.clearSelection(),
    get selectedFileName() { return saveAdapter.selectedFileName; },
    get adapter() { return saveAdapter; },
    get initialStatus() {
      return LocalFileSaveAdapter.supportsFileAccess
        ? "NO SAVE SELECTED"
        : "FILE PICKER UNAVAILABLE · LOAD .CASS / EXPORT DOWNLOAD";
    }
  });
}
