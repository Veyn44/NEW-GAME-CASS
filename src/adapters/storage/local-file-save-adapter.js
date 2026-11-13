const FILE_FORMAT = "cassandra.save";
const FILE_FORMAT_VERSION = 1;
const DEFAULT_FILE_NAME = "save.cass";
const SLOT_ID = "dev-lab-workspace";

function makeEnvelope(saveData) {
  return {
    format: FILE_FORMAT,
    fileFormatVersion: FILE_FORMAT_VERSION,
    data: saveData
  };
}

function parseEnvelope(text) {
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    const wrapped = new Error("The selected file is not valid JSON.");
    wrapped.code = "INVALID_SAVE_FILE";
    wrapped.cause = error;
    throw wrapped;
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || envelope.format !== FILE_FORMAT
    || envelope.fileFormatVersion !== FILE_FORMAT_VERSION
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

/**
 * Host-side adapter for one user-selected workspace directory.
 * The directory contains one authoritative file: save.cass.
 * Browser file APIs never leak into Core or gameplay systems.
 */
export class LocalFileSaveAdapter {
  #directoryHandle = null;
  #fileName;
  #download;
  #importedData = null;

  constructor({ fileName = DEFAULT_FILE_NAME, download = downloadSave } = {}) {
    if (typeof fileName !== "string" || !/^[a-zA-Z0-9._-]+\.cass$/.test(fileName)) {
      throw new TypeError("Save file name must be a simple .cass filename.");
    }
    if (typeof download !== "function") throw new TypeError("download must be a function.");
    this.#fileName = fileName;
    this.#download = download;
  }

  static get supportsDirectoryAccess() {
    return typeof globalThis.window?.showDirectoryPicker === "function";
  }

  get selectedDirectoryName() {
    return this.#directoryHandle?.name ?? null;
  }

  get fileName() {
    return this.#fileName;
  }

  async selectDirectory() {
    const picker = globalThis.window?.showDirectoryPicker;
    if (typeof picker !== "function") {
      const error = new Error("Direct folder access is not supported by this browser. Use file import/export instead.");
      error.code = "DIRECTORY_ACCESS_UNAVAILABLE";
      throw error;
    }
    const handle = await picker.call(globalThis.window, { mode: "readwrite" });
    if (!handle) return null;
    this.#directoryHandle = handle;
    this.#importedData = null;
    await this.#ensurePermission("readwrite");
    return handle.name ?? "Selected folder";
  }

  async importFile(file) {
    if (!file || typeof file.text !== "function") throw new TypeError("A readable .cass file is required.");
    if (file.name && !file.name.toLowerCase().endsWith(".cass")) {
      const error = new Error("Choose a Cassandra .cass save file.");
      error.code = "INVALID_SAVE_EXTENSION";
      throw error;
    }
    this.#importedData = parseEnvelope(await file.text());
    this.#directoryHandle = null;
    return Object.freeze({ fileName: file.name || this.#fileName, imported: true });
  }

  async read(slotId) {
    this.#assertSlot(slotId);
    if (this.#directoryHandle) {
      await this.#ensurePermission("read");
      let fileHandle;
      try {
        fileHandle = await this.#directoryHandle.getFileHandle(this.#fileName, { create: false });
      } catch (cause) {
        if (cause?.name !== "NotFoundError") throw cause;
        const error = new Error(`The selected folder does not contain ${this.#fileName}.`);
        error.code = "SAVE_FILE_NOT_FOUND";
        error.cause = cause;
        throw error;
      }
      const file = await fileHandle.getFile();
      return parseEnvelope(await file.text());
    }
    if (this.#importedData) return this.#importedData;
    const error = new Error("Choose a save folder or import a .cass file before loading.");
    error.code = "SAVE_SOURCE_NOT_SELECTED";
    throw error;
  }

  async writeAtomic(slotId, saveData) {
    this.#assertSlot(slotId);
    const text = JSON.stringify(makeEnvelope(saveData), null, 2);
    if (!this.#directoryHandle) {
      this.#download(text, this.#fileName);
      return true;
    }

    await this.#ensurePermission("readwrite");
    const fileHandle = await this.#directoryHandle.getFileHandle(this.#fileName, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    try {
      await writable.write(text);
      // File System Access API commits the replacement when close() succeeds.
      await writable.close();
      return true;
    } catch (error) {
      try { await writable.abort(); } catch { /* Preserve the original write error. */ }
      throw error;
    }
  }

  async #ensurePermission(mode) {
    const handle = this.#directoryHandle;
    if (!handle) throw new Error("No save folder is selected.");
    if (typeof handle.queryPermission !== "function") return;
    let permission = await handle.queryPermission({ mode });
    if (permission !== "granted" && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode });
    }
    if (permission !== "granted") {
      const error = new Error("Permission to access the selected save folder was not granted.");
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
