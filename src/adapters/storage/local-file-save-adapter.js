const FILE_FORMAT = "cassandra.save";
const FILE_FORMAT_VERSION = 1;
const DEFAULT_FILE_NAME = "save.cass";
const SLOT_ID = "dev-lab-workspace";

function makeEnvelope(saveData) {
  return { format: FILE_FORMAT, fileFormatVersion: FILE_FORMAT_VERSION, data: saveData };
}

function parseEnvelope(text) {
  let envelope;
  try { envelope = JSON.parse(text); }
  catch (cause) {
    const error = new Error("The selected file is not valid JSON.");
    error.code = "INVALID_SAVE_FILE";
    error.cause = cause;
    throw error;
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || envelope.format !== FILE_FORMAT || envelope.fileFormatVersion !== FILE_FORMAT_VERSION
    || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    const error = new Error("The selected file is not a supported Cassandra save file.");
    error.code = "INCOMPATIBLE_SAVE_FILE";
    throw error;
  }
  return envelope.data;
}

function downloadSave(text, fileName) {
  const blob = new Blob([text], { type: "application/vnd.cassandra.save+json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickerTypes() {
  return [{ description: "Cassandra save", accept: { "application/vnd.cassandra.save+json": [".cass"] } }];
}

export class LocalFileSaveAdapter {
  #fileHandle = null;
  #fileName = null;
  #download;
  #importedData = null;

  constructor({ download = downloadSave } = {}) {
    if (typeof download !== "function") throw new TypeError("download must be a function.");
    this.#download = download;
  }

  static get supportsFileAccess() {
    return typeof globalThis.window?.showSaveFilePicker === "function"
      && typeof globalThis.window?.showOpenFilePicker === "function";
  }

  get selectedFileName() { return this.#fileName ?? null; }

  setDownloadFileName(fileName) {
    if (typeof fileName !== "string" || !/^[a-zA-Z0-9._ -]+\\.cass$/i.test(fileName)) {
      throw new TypeError("Save file name must be a simple .cass filename.");
    }
    this.#fileName = fileName;
    this.#fileHandle = null;
    this.#importedData = null;
  }

  async selectSaveFile() {
    const picker = globalThis.window?.showSaveFilePicker;
    if (typeof picker !== "function") {
      const error = new Error("Save file picker is not supported by this browser.");
      error.code = "FILE_PICKER_UNAVAILABLE";
      throw error;
    }
    const handle = await picker.call(globalThis.window, {
      suggestedName: DEFAULT_FILE_NAME,
      types: pickerTypes(),
      excludeAcceptAllOption: true
    });
    if (!handle) return null;
    this.#fileHandle = handle;
    this.#fileName = handle.name ?? DEFAULT_FILE_NAME;
    this.#importedData = null;
    await this.#ensurePermission("readwrite");
    return this.#fileName;
  }

  async selectLoadFile() {
    const picker = globalThis.window?.showOpenFilePicker;
    if (typeof picker !== "function") {
      const error = new Error("Open file picker is not supported by this browser.");
      error.code = "FILE_PICKER_UNAVAILABLE";
      throw error;
    }
    const [handle] = await picker.call(globalThis.window, {
      multiple: false,
      types: pickerTypes(),
      excludeAcceptAllOption: true
    });
    if (!handle) return null;
    this.#fileHandle = handle;
    this.#fileName = handle.name ?? DEFAULT_FILE_NAME;
    this.#importedData = null;
    await this.#ensurePermission("read");
    return this.#fileName;
  }

  async importFile(file) {
    if (!file || typeof file.text !== "function") throw new TypeError("A readable .cass file is required.");
    if (file.name && !file.name.toLowerCase().endsWith(".cass")) {
      const error = new Error("Choose a Cassandra .cass save file.");
      error.code = "INVALID_SAVE_EXTENSION";
      throw error;
    }
    this.#importedData = parseEnvelope(await file.text());
    this.#fileHandle = null;
    this.#fileName = file.name || DEFAULT_FILE_NAME;
    return Object.freeze({ fileName: this.#fileName, imported: true });
  }

  async read(slotId) {
    this.#assertSlot(slotId);
    if (this.#fileHandle) {
      await this.#ensurePermission("read");
      const file = await this.#fileHandle.getFile();
      return parseEnvelope(await file.text());
    }
    if (this.#importedData) return this.#importedData;
    const error = new Error("Choose a Cassandra .cass file before loading.");
    error.code = "SAVE_SOURCE_NOT_SELECTED";
    throw error;
  }

  async writeAtomic(slotId, saveData) {
    this.#assertSlot(slotId);
    const text = JSON.stringify(makeEnvelope(saveData), null, 2);
    if (!this.#fileHandle) {
      const fileName = this.#fileName || DEFAULT_FILE_NAME;
      this.#download(text, fileName);
      this.#fileName = fileName;
      this.#importedData = saveData;
      return true;
    }
    await this.#ensurePermission("readwrite");
    const writable = await this.#fileHandle.createWritable({ keepExistingData: false });
    try {
      await writable.write(text);
      await writable.close();
      this.#importedData = saveData;
      return true;
    } catch (error) {
      try { await writable.abort(); } catch { /* Preserve original error. */ }
      throw error;
    }
  }

  async #ensurePermission(mode) {
    const handle = this.#fileHandle;
    if (!handle) throw new Error("No save file is selected.");
    if (typeof handle.queryPermission !== "function") return;
    let permission = await handle.queryPermission({ mode });
    if (permission !== "granted" && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode });
    }
    if (permission !== "granted") {
      const error = new Error("Permission to access the selected save file was not granted.");
      error.code = "SAVE_PERMISSION_DENIED";
      throw error;
    }
  }

  #assertSlot(slotId) {
    if (slotId !== SLOT_ID) {
      const error = new Error(`Local workspace adapter does not support slot "${slotId}".`);
      error.code = "UNSUPPORTED_SAVE_SLOT";
      throw error;
    }
  }
}

export const DEV_LAB_SAVE_SLOT = SLOT_ID;
export const CASSANDRA_SAVE_FILE_NAME = DEFAULT_FILE_NAME;
