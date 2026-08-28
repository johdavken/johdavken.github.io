(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynNotesStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Private, device-local notes. Deliberately its own IndexedDB database,
  // completely outside the app's localStorage session payload and RT Sync:
  //
  //   - never serialized by snapshotPayload() / snapshotActiveJob()
  //   - never sent to Supabase or a workspace
  //   - never appears on another device or the shared desktop
  //
  // This module is the whole storage abstraction. Pure helpers (normalize,
  // sort, preview, export/import merge) are exported for direct testing;
  // createStore() wraps them in a thin IndexedDB layer so no UI code ever
  // opens a transaction itself.

  const DB_NAME = "resin.tools.notes";
  const STORE_NAME = "notes";
  const SCHEMA_VERSION = 1;

  // Export envelope. `format` is checked on import so an unrelated JSON file
  // is rejected rather than half-read.
  const EXPORT_FORMAT = "resin.tools/notes";
  const EXPORT_VERSION = 1;

  const MAX_TITLE = 200;
  const PREVIEW_LENGTH = 140;

  function now() {
    return Date.now();
  }

  function makeId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return `note_${now().toString(36)}_${rand}`;
  }

  function coerceString(value) {
    if (typeof value === "string") return value;
    return value == null ? "" : String(value);
  }

  function coerceTimestamp(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  // One stored note. Unknown keys are dropped; missing keys get safe
  // defaults, so a partial record (an old export, a hand-edited file)
  // still loads instead of poisoning the store.
  function normalizeNote(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const created = coerceTimestamp(raw.createdAt, now());
    const updated = coerceTimestamp(raw.updatedAt, created);
    const id = coerceString(raw.id).trim();
    return {
      id: id || makeId(),
      title: coerceString(raw.title).slice(0, MAX_TITLE),
      body: coerceString(raw.body),
      pinned: raw.pinned === true,
      createdAt: created,
      updatedAt: updated
    };
  }

  function newNote(fields) {
    const ts = now();
    const note = {
      id: makeId(),
      title: "",
      body: "",
      pinned: false,
      createdAt: ts,
      updatedAt: ts
    };
    if (fields && typeof fields === "object") {
      if (typeof fields.title === "string") note.title = fields.title.slice(0, MAX_TITLE);
      if (typeof fields.body === "string") note.body = fields.body;
      if (fields.pinned === true) note.pinned = true;
    }
    return note;
  }

  // Pinned first, then most-recently-updated. Falls back to original order
  // for equal keys so re-sorting an unchanged list never reshuffles it.
  function sortNotes(list) {
    const array = Array.isArray(list) ? list.slice() : [];
    return array
      .map((note, index) => ({ note, index }))
      .sort((a, b) => {
        const ap = a.note && a.note.pinned ? 1 : 0;
        const bp = b.note && b.note.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        const au = a.note ? a.note.updatedAt || 0 : 0;
        const bu = b.note ? b.note.updatedAt || 0 : 0;
        if (au !== bu) return bu - au;
        return a.index - b.index;
      })
      .map((entry) => entry.note);
  }

  // A plain-text one-liner from a Markdown body for the list preview. Strips
  // exactly the syntax the toolbar inserts. Never rendered as HTML.
  function previewOf(body, length) {
    const limit = typeof length === "number" ? length : PREVIEW_LENGTH;
    const text = coerceString(body)
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/[*_`>#~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  }

  // Display title: the explicit title, else the first non-empty body line
  // with its Markdown marker stripped, else a stable placeholder.
  function titleFor(note) {
    const explicit = coerceString(note && note.title).trim();
    if (explicit) return explicit;
    const firstLine = coerceString(note && note.body)
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || "";
    const cleaned = firstLine
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/[*_`~]/g, "")
      .trim();
    return cleaned ? previewOf(cleaned, 80) : "Untitled note";
  }

  /* --------------------------------------------------------------------
   *   Export / import (pure)
   * ------------------------------------------------------------------ */

  function buildExport(notes) {
    const normalized = (Array.isArray(notes) ? notes : [])
      .map(normalizeNote)
      .filter(Boolean);
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      count: normalized.length,
      notes: normalized
    };
  }

  function serializeExport(notes) {
    return JSON.stringify(buildExport(notes), null, 2);
  }

  // Accepts a JSON string or an already-parsed object. Never throws: a bad
  // file returns { ok:false, error } and the caller leaves the store as-is.
  function parseImport(input) {
    let data = input;
    if (typeof input === "string") {
      try {
        data = JSON.parse(input);
      } catch (error) {
        return { ok: false, error: "That file isn't valid JSON." };
      }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, error: "Unrecognized notes file." };
    }
    if (data.format !== EXPORT_FORMAT) {
      return { ok: false, error: "This file isn't a Resin.Tools notes export." };
    }
    if (!Array.isArray(data.notes)) {
      return { ok: false, error: "The notes file has no notes list." };
    }
    const notes = data.notes.map(normalizeNote).filter(Boolean);
    return { ok: true, notes, skipped: data.notes.length - notes.length };
  }

  function sameNote(a, b) {
    return (
      a.title === b.title &&
      a.body === b.body &&
      a.pinned === b.pinned &&
      a.createdAt === b.createdAt
    );
  }

  // Merge imported notes into the existing set. An id that collides with an
  // existing note whose content differs is re-issued a fresh id, so both
  // are kept; an exact duplicate is skipped. Existing notes are never
  // overwritten or dropped.
  function mergeImport(existing, incoming) {
    const byId = new Map();
    const result = (Array.isArray(existing) ? existing : [])
      .map(normalizeNote)
      .filter(Boolean);
    result.forEach((note) => byId.set(note.id, note));

    let added = 0;
    let skipped = 0;
    let renamed = 0;

    (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
      let note = normalizeNote(raw);
      if (!note) {
        skipped += 1;
        return;
      }
      const clash = byId.get(note.id);
      if (clash) {
        if (sameNote(clash, note)) {
          skipped += 1;
          return;
        }
        note = Object.assign({}, note, { id: makeId() });
        renamed += 1;
      }
      byId.set(note.id, note);
      result.push(note);
      added += 1;
    });

    return { notes: result, added, skipped, renamed };
  }

  /* --------------------------------------------------------------------
   *   IndexedDB wrapper
   * ------------------------------------------------------------------ */

  function idbFactory() {
    if (typeof indexedDB !== "undefined" && indexedDB) return indexedDB;
    if (typeof globalThis !== "undefined" && globalThis.indexedDB) return globalThis.indexedDB;
    return null;
  }

  function isSupported() {
    return !!idbFactory();
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const idb = idbFactory();
      if (!idb) {
        reject(new Error("IndexedDB is not available on this device."));
        return;
      }
      let request;
      try {
        request = idb.open(DB_NAME, SCHEMA_VERSION);
      } catch (error) {
        reject(error);
        return;
      }
      request.onupgradeneeded = (event) => {
        const db = request.result;
        // Layered by design: each version block builds on the last, so a
        // future field or index is added in its own `if (from < N)` block
        // without rewriting the store.
        const from = event.oldVersion || 0;
        if (from < 1) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
          store.createIndex("pinned", "pinned", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the notes database."));
      // Another tab holding an older version open; it closes on its own.
      request.onblocked = () => {};
    });
  }

  function objectStore(db, mode) {
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function createStore() {
    let dbPromise = null;

    // Every mutation runs one-at-a-time through this chain. update() is a
    // read-modify-write (get the note, patch a field, put it back); the
    // editor fires an autosave and a pin toggle almost together, so without
    // serializing them the second read could miss the first write and one
    // change would be lost. Reads stay off the chain.
    let writeChain = Promise.resolve();

    function db() {
      if (!dbPromise) dbPromise = openDatabase();
      return dbPromise;
    }

    function serialize(task) {
      const run = () => task();
      const next = writeChain.then(run, run);
      writeChain = next.catch(() => {});
      return next;
    }

    function rawGetAll() {
      return db()
        .then((conn) => requestToPromise(objectStore(conn, "readonly").getAll()))
        .then((rows) => (rows || []).map(normalizeNote).filter(Boolean));
    }

    function rawGet(id) {
      return db()
        .then((conn) => requestToPromise(objectStore(conn, "readonly").get(id)))
        .then((row) => (row ? normalizeNote(row) : null));
    }

    function rawPut(record) {
      return db().then((conn) => requestToPromise(objectStore(conn, "readwrite").put(record)));
    }

    function rawDelete(id) {
      return db().then((conn) => requestToPromise(objectStore(conn, "readwrite").delete(id)));
    }

    function getAll() {
      return rawGetAll().then(sortNotes);
    }

    function get(id) {
      return rawGet(id);
    }

    function put(note) {
      const record = normalizeNote(note);
      if (!record) return Promise.reject(new Error("Invalid note."));
      return serialize(() => rawPut(record)).then(() => record);
    }

    function create(fields) {
      return put(newNote(fields));
    }

    function update(id, patch) {
      return serialize(() =>
        rawGet(id).then((existing) => {
          if (!existing) return null;
          const merged = Object.assign({}, existing);
          if (patch && typeof patch === "object") {
            if (typeof patch.title === "string") merged.title = patch.title.slice(0, MAX_TITLE);
            if (typeof patch.body === "string") merged.body = patch.body;
            if (typeof patch.pinned === "boolean") merged.pinned = patch.pinned;
          }
          merged.updatedAt = now();
          return rawPut(merged).then(() => merged);
        })
      );
    }

    function remove(id) {
      return serialize(() => rawDelete(id));
    }

    function bulkPut(notes) {
      return serialize(() =>
        (Array.isArray(notes) ? notes : []).reduce(
          (chain, note) => chain.then(() => rawPut(normalizeNote(note))),
          Promise.resolve()
        )
      );
    }

    function exportNotes() {
      return getAll().then(serializeExport);
    }

    // Validates first (parseImport never throws); only touches the store
    // once the file is known-good, and only ever adds - a malformed file
    // leaves every existing note exactly as it was. The whole merge+write
    // runs as one serialized unit so a concurrent edit can't interleave.
    function importNotes(input) {
      const parsed = parseImport(input);
      if (!parsed.ok) return Promise.resolve(parsed);
      return serialize(() =>
        rawGetAll().then((existing) => {
          const merged = mergeImport(existing, parsed.notes);
          return merged.notes
            .reduce((chain, note) => chain.then(() => rawPut(note)), Promise.resolve())
            .then(() => ({
              ok: true,
              added: merged.added,
              renamed: merged.renamed,
              skipped: merged.skipped + (parsed.skipped || 0)
            }));
        })
      );
    }

    function close() {
      if (!dbPromise) return;
      const pending = dbPromise;
      dbPromise = null;
      pending
        .then((conn) => {
          try {
            conn.close();
          } catch (error) {
            /* already closing */
          }
        })
        .catch(() => {});
    }

    return {
      getAll,
      get,
      create,
      update,
      remove,
      put,
      bulkPut,
      exportNotes,
      importNotes,
      close
    };
  }

  return {
    DB_NAME,
    STORE_NAME,
    SCHEMA_VERSION,
    EXPORT_FORMAT,
    EXPORT_VERSION,
    PREVIEW_LENGTH,
    MAX_TITLE,
    isSupported,
    newNote,
    normalizeNote,
    sortNotes,
    previewOf,
    titleFor,
    buildExport,
    serializeExport,
    parseImport,
    mergeImport,
    createStore
  };
});
