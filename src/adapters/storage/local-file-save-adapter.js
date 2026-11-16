const FILE_FORMAT_VERSION = 1;

export const CASSANDRA_SAVE_FORMAT = "cassandra.save";
export const DEV_LAB_SAVE_FORMAT = "cassandra.dev-lab.save";
export const CASSANDRA_SAVE_SLOT = "cassandra-main-world";
export const DEV_LAB_SAVE_SLOT = "dev-lab-workspace";
export const CASSANDRA_SAVE_STATE_ID = "cassandra-main-world";
export const DEV_LAB_SAVE_STATE_ID = "cassandra-dev-lab-workspace";
export const CASSANDRA_SAVE_FILE_EXTENSION = ".cass";
export const DEV_LAB_SAVE_FILE_EXTENSION = ".dlcass";
export const CASSANDRA_SAVE_FILE_NAME = "save.cass";
export const DEV_LAB_SAVE_FILE_NAME = "workspace.dlcass";
export const CASSANDRA_SAVE_MIME_TYPE = "application/vnd.cassandra.save+json";
export const DEV_LAB_SAVE_MIME_TYPE = "application/vnd.cassandra.dev-lab-save+json";

function makeEnvelope(saveData, format) {
  return { format, fileFormatVersion: FILE_FORMAT_VERSION, data: saveData };
}

function parseEnvelope(text, format) {
  let envelope;
  try { envelope = JSON.parse(text); }
  catch (cause) {
    const error = new Error("The selected file is not valid JSON.");
    error.code = "INVALID_SAVE_FILE";
    error.cause = cause;
    throw error;
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)
    || envelope.format !== format || envelope.fileFormatVersion !== FILE_FORMAT_VERSION
    || !envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) {
    const error = new Error("The selected file is not a supported save file for this application.");
    error.code = "INCOMPATIBLE_SAVE_FILE";
    throw error;
  }
  return envelope.data;
}

function downloadSave(text, fileName, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function pickerTypes({ fileDescription, mimeType, fileExtension }) {
  return [{ description: fileDescription, accept: { [mimeType]: [fileExtension] } }];
}

export class LocalFileSaveAdapter {
  #fileHandle = null;
  #fileName = null;
  #download;
  #importedData = null;
  #format;
  #fileExtension;
  #mimeType;
  #fileDescription;
  #defaultFileName;
  #slotId;

  constructor({
    download = downloadSave,
    format = CASSANDRA_SAVE_FORMAT,
    fileExtension = CASSANDRA_SAVE_FILE_EXTENSION,
    mimeType = CASSANDRA_SAVE_MIME_TYPE,
    fileDescription = "Cassandra save",
    defaultFileName = CASSANDRA_SAVE_FILE_NAME,
    slotId = CASSANDRA_SAVE_SLOT
  } = {}) {
    if (typeof download !== "function") throw new TypeError("download must be a function.");
    if (typeof format !== "string" || !/^[a-z0-9][a-z0-9.-]*$/i.test(format)) {
      throw new TypeError("format must be a stable application save-format identifier.");
    }
    if (typeof fileExtension !== "string" || !/^\.[a-z0-9]+$/i.test(fileExtension)) {
      throw new TypeError("fileExtension must be a simple file extension.");
    }
    if (typeof mimeType !== "string" || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mimeType)) {
      throw new TypeError("mimeType must be a valid MIME type.");
    }
    if (typeof fileDescription !== "string" || !fileDescription.trim()) {
      throw new TypeError("fileDescription must be a non-empty string.");
    }
    if (typeof defaultFileName !== "string" || !defaultFileName.toLowerCase().endsWith(fileExtension.toLowerCase())) {
      throw new TypeError("defaultFileName must use the configured file extension.");
    }
    if (typeof slotId !== "string" || !slotId.trim()) {
      throw new TypeError("slotId must be a non-empty string.");
    }

    this.#download = download;
    this.#format = format;
    this.#fileExtension = fileExtension;
    this.#mimeType = mimeType;
    this.#fileDescription = fileDescription;
    this.#defaultFileName = defaultFileName;
    this.#slotId = slotId;
  }

  static get supportsFileAccess() {
    return typeof globalThis.window?.showSaveFilePicker === "function"
      && typeof globalThis.window?.showOpenFilePicker === "function";
  }

  get selectedFileName() { return this.#fileName ?? null; }

  clearSelection() {
    this.#fileHandle = null;
    this.#fileName = null;
    this.#importedData = null;
  }

  captureSelection() {
    const previous = {
      fileHandle: this.#fileHandle,
      fileName: this.#fileName,
      importedData: this.#importedData
    };
    let restored = false;
    return () => {
      if (restored) return false;
      this.#fileHandle = previous.fileHandle;
      this.#fileName = previous.fileName;
      this.#importedData = previous.importedData;
      restored = true;
      return true;
    };
  }

  #hasConfiguredExtension(fileName) {
    return typeof fileName === "string"
      && fileName.toLowerCase().endsWith(this.#fileExtension.toLowerCase());
  }

  #assertConfiguredExtension(fileName) {
    if (!this.#hasConfiguredExtension(fileName)) {
      const error = new Error(`Choose a ${this.#fileExtension} save file.`);
      error.code = "INVALID_SAVE_EXTENSION";
      throw error;
    }
  }

  #isValidFileName(fileName) {
    if (!this.#hasConfiguredExtension(fileName)) return false;
    const baseName = fileName.slice(0, -this.#fileExtension.length);
    return /^[a-zA-Z0-9._ -]+$/.test(baseName);
  }

  setDownloadFileName(fileName) {
    if (!this.#isValidFileName(fileName)) {
      throw new TypeError(`Save file name must be a simple ${this.#fileExtension} filename.`);
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
      suggestedName: this.#defaultFileName,
      types: pickerTypes({ fileDescription: this.#fileDescription, mimeType: this.#mimeType, fileExtension: this.#fileExtension }),
      excludeAcceptAllOption: true
    });
    if (!handle) return null;
    const fileName = handle.name ?? this.#defaultFileName;
    this.#assertConfiguredExtension(fileName);
    this.#fileHandle = handle;
    this.#fileName = fileName;
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
      types: pickerTypes({ fileDescription: this.#fileDescription, mimeType: this.#mimeType, fileExtension: this.#fileExtension }),
      excludeAcceptAllOption: true
    });
    if (!handle) return null;
    const fileName = handle.name ?? this.#defaultFileName;
    this.#assertConfiguredExtension(fileName);
    this.#fileHandle = handle;
    this.#fileName = fileName;
    this.#importedData = null;
    await this.#ensurePermission("read");
    return this.#fileName;
  }

  async importFile(file) {
    if (!file || typeof file.text !== "function") {
      throw new TypeError(`A readable ${this.#fileExtension} file is required.`);
    }
    if (typeof file.name !== "string" || !file.name) this.#assertConfiguredExtension("");
    this.#assertConfiguredExtension(file.name);
    const importedData = parseEnvelope(await file.text(), this.#format);
    this.#importedData = importedData;
    this.#fileHandle = null;
    this.#fileName = file.name || this.#defaultFileName;
    return Object.freeze({ fileName: this.#fileName, imported: true });
  }

  async read(slotId) {
    this.#assertSlot(slotId);
    if (this.#fileHandle) {
      await this.#ensurePermission("read");
      const file = await this.#fileHandle.getFile();
      return parseEnvelope(await file.text(), this.#format);
    }
    if (this.#importedData) return this.#importedData;
    const error = new Error(`Choose a ${this.#fileExtension} file before loading.`);
    error.code = "SAVE_SOURCE_NOT_SELECTED";
    throw error;
  }

  async writeAtomic(slotId, saveData) {
    this.#assertSlot(slotId);
    const text = JSON.stringify(makeEnvelope(saveData, this.#format), null, 2);
    if (!this.#fileHandle) {
      const fileName = this.#fileName || this.#defaultFileName;
      this.#download(text, fileName, this.#mimeType);
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
    if (slotId !== this.#slotId) {
      const error = new Error(`Local save adapter does not support slot "${slotId}".`);
      error.code = "UNSUPPORTED_SAVE_SLOT";
      throw error;
    }
  }
}
