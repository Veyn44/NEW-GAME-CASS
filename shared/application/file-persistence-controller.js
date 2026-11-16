/**
 * Coordinates file selection with the Engine persistence API.
 * Save adapter, slot/state identity, prompts, and UI status copy are supplied
 * by the application composition root.
 */
export function createFilePersistenceController({
  persistenceApi,
  saveAdapter,
  fileInput,
  saveSlot,
  stateId,
  supportsFileAccess = () => false,
  requestFileName = () => null,
  fileExtension = ".save",
  defaultFileName = "save.save",
  onRestore = () => {},
  onStatus = () => {},
  messages = {}
} = {}) {
  if (!persistenceApi || !saveAdapter || !fileInput) {
    throw new TypeError("File persistence requires persistenceApi, saveAdapter and fileInput.");
  }
  if (typeof saveSlot !== "string" || !saveSlot
    || typeof stateId !== "string" || !stateId) {
    throw new TypeError("File persistence requires saveSlot and stateId identifiers.");
  }
  if (typeof supportsFileAccess !== "function" || typeof requestFileName !== "function") {
    throw new TypeError("File persistence requires file-access and filename providers.");
  }
  if (typeof fileExtension !== "string" || !/^\.[a-z0-9]+$/i.test(fileExtension)) {
    throw new TypeError("File persistence requires a simple file extension.");
  }
  if (typeof defaultFileName !== "string"
    || !defaultFileName.toLowerCase().endsWith(fileExtension.toLowerCase())) {
    throw new TypeError("The default filename must use the configured file extension.");
  }

  const isValidFileName = (name) => name.toLowerCase().endsWith(fileExtension.toLowerCase())
    && /^[a-zA-Z0-9._ -]+$/.test(name.slice(0, -fileExtension.length));

  const copy = {
    savingAs: "SAVING AS",
    noSaveSelected: "NO SAVE SELECTED · USE SAVE AS FIRST",
    invalidFileName: "SAVE FAILED · USE A SIMPLE FILE NAME",
    saveFailed: "SAVE FAILED",
    saved: "SAVED",
    savedDetail: "WORKSPACE SAVED",
    loading: "LOADING",
    loaded: "LOADED",
    restored: "WORKSPACE RESTORED",
    initialNoSelection: "NO SAVE SELECTED",
    filePickerUnavailable: "FILE PICKER UNAVAILABLE · LOAD " + fileExtension.toUpperCase() + " / EXPORT DOWNLOAD",
    busy: "SAVE / LOAD IN PROGRESS",
    ...messages
  };

  const report = (saveStatus, simulationStatus = saveStatus) => onStatus({
    saveStatus,
    simulationStatus
  });

  let operationInProgress = false;
  async function runExclusive(operation) {
    if (operationInProgress) {
      report(copy.busy);
      return false;
    }
    operationInProgress = true;
    try {
      return await operation();
    } finally {
      operationInProgress = false;
    }
  }

  function describeLoadFailure(error) {
    const code = error?.code ?? "LOAD_FAILED";
    const descriptions = {
      INVALID_SAVE_FILE: "The selected file is not valid JSON.",
      INCOMPATIBLE_SAVE_FILE: "The selected file is not a supported save file.",
      INCOMPATIBLE_SAVE_FORMAT: "The save format version is not supported.",
      STATE_MISMATCH: "The save belongs to a different application workspace.",
      MISSING_REQUIRED_SNAPSHOT: "The save is missing required system data.",
      INVALID_SAVE: "The save is missing required data.",
      SCHEMA_MISMATCH: "A saved system schema is incompatible.",
      INVALID_SNAPSHOT: "A saved system rejected its data.",
      RESTORE_COMMIT_FAILED: "A system failed while restoring the save. The restore was rolled back where possible.",
      RESTORE_ROLLBACK_FAILED: "A restore rollback failed. The runtime is faulted and must be restarted before continuing.",
      SAVE_NOT_FOUND: "No save data was found.",
      SAVE_SOURCE_NOT_SELECTED: "No save file is selected."
    };
    const detail = descriptions[code] ?? error?.message ?? "The save could not be loaded.";
    return "LOAD FAILED · " + code + " · " + detail;
  }

  async function persist({ chooseFile = false } = {}) {
    const restoreSelection = chooseFile ? saveAdapter.captureSelection?.() : null;
    let saved = false;
    try {
      if (chooseFile) {
        if (supportsFileAccess()) {
          const fileName = await saveAdapter.selectSaveFile();
          if (!fileName) return false;
          report(copy.savingAs + " · " + fileName);
        } else {
          const requestedName = await requestFileName({
            currentFileName: saveAdapter.selectedFileName || "",
            defaultFileName
          });
          if (requestedName === null) return false;
          const trimmed = requestedName.trim();
          const safeName = trimmed.toLowerCase().endsWith(fileExtension.toLowerCase())
            ? trimmed
            : trimmed + fileExtension;
          if (!isValidFileName(safeName)) {
            report(copy.invalidFileName);
            return false;
          }
          saveAdapter.setDownloadFileName(safeName);
        }
      } else if (!saveAdapter.selectedFileName && supportsFileAccess()) {
        report(copy.noSaveSelected);
        return false;
      }

      const metadata = await persistenceApi.save(saveSlot, {
        stateId,
        kind: "manual"
      });
      saved = true;
      const fileName = saveAdapter.selectedFileName || defaultFileName;
      report(copy.saved + " · " + fileName, copy.savedDetail + " · " + metadata.createdAt);
      return true;
    } catch (error) {
      if (chooseFile && !saved) restoreSelection?.();
      if (error?.name === "AbortError") return false;
      report(copy.saveFailed + " · " + error.message);
      return false;
    }
  }

  async function restore() {
    const restoreSelection = saveAdapter.captureSelection?.();
    let loaded = false;
    try {
      if (supportsFileAccess()) {
        const fileName = await saveAdapter.selectLoadFile();
        if (!fileName) return false;
        report(copy.loading + " · " + fileName);
      } else {
        fileInput.click();
        return false;
      }
      await persistenceApi.load(saveSlot, { stateId });
      loaded = true;
      onRestore();
      report(copy.loaded + " · " + saveAdapter.selectedFileName, copy.restored);
      return true;
    } catch (error) {
      if (!loaded) restoreSelection?.();
      if (error?.name === "AbortError") return false;
      report(describeLoadFailure(error));
      return false;
    }
  }

  async function importFile(file) {
    if (!file) return false;
    const restoreSelection = saveAdapter.captureSelection?.();
    let loaded = false;
    try {
      await saveAdapter.importFile(file);
      await persistenceApi.load(saveSlot, { stateId });
      loaded = true;
      onRestore();
      report(copy.loaded + " · " + file.name, copy.restored);
      return true;
    } catch (error) {
      if (!loaded) restoreSelection?.();
      report(describeLoadFailure(error));
      return false;
    }
  }

  return Object.freeze({
    save: () => runExclusive(() => persist()),
    saveAs: () => runExclusive(() => persist({ chooseFile: true })),
    load: () => runExclusive(restore),
    importFile: (file) => runExclusive(() => importFile(file)),
    clearSelection: () => {
      if (operationInProgress) {
        report(copy.busy);
        return false;
      }
      saveAdapter.clearSelection();
      return true;
    },
    get selectedFileName() { return saveAdapter.selectedFileName; },
    get adapter() { return saveAdapter; },
    get isBusy() { return operationInProgress; },
    get initialStatus() {
      return supportsFileAccess() ? copy.initialNoSelection : copy.filePickerUnavailable;
    }
  });
}
