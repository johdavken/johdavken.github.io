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
  // Flat folders are device-local organisation only - their own object store,
  // never serialized to Supabase / RT Sync / workspace state (see
  // notes-folders.test.js). Adding this store is why the schema goes to v2.
  const FOLDER_STORE_NAME = "folders";
  const SCHEMA_VERSION = 2;

  // Export envelope. `format` is checked on import so an unrelated JSON file
  // is rejected rather than half-read. `version` went 1 -> 2 when folders were
  // added: a v1 file has no `folders` array and no `note.folderId`, so every
  // note in it imports as Unfiled. v1 files are still accepted unchanged.
  const EXPORT_FORMAT = "resin.tools/notes";
  const EXPORT_VERSION = 2;

  const MAX_TITLE = 200;
  const MAX_FOLDER_NAME = 60;
  const PREVIEW_LENGTH = 140;

  function now() {
    return Date.now();
  }

  function makeId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return `note_${now().toString(36)}_${rand}`;
  }

  const FOLDER_ID_PREFIX = "folder_";

  function makeFolderId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return `${FOLDER_ID_PREFIX}${now().toString(36)}_${rand}`;
  }

  // A folder id is a stable, name-independent string. Anything that isn't one
  // (empty, a number, a stale shape) is treated as "no folder" so a note can
  // never be stuck pointing at something that cannot exist.
  function isFolderId(value) {
    return (
      typeof value === "string" &&
      value.length > FOLDER_ID_PREFIX.length &&
      value.slice(0, FOLDER_ID_PREFIX.length) === FOLDER_ID_PREFIX
    );
  }

  // null | a valid folder id. Used for both the stored `note.folderId` and
  // incoming move/create requests.
  function coerceFolderId(value) {
    return isFolderId(value) ? value : null;
  }

  // Trim, collapse internal whitespace, cap length. Mirrors the workspace
  // configuration name rule so the two feel the same.
  function normalizeFolderName(value) {
    return coerceString(value).replace(/\s+/g, " ").trim().slice(0, MAX_FOLDER_NAME);
  }

  // Case/whitespace-insensitive key for duplicate detection. Folders are a
  // human organisation tool, so "Jobs" and " jobs " are the same folder.
  function folderNameKey(value) {
    return normalizeFolderName(value).toLowerCase();
  }

  function coerceString(value) {
    if (typeof value === "string") return value;
    return value == null ? "" : String(value);
  }

  function coerceTimestamp(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  }

  // Storage format discriminator for `note.body`. The value is always a
  // string; this only says how to interpret it. Anything that isn't an
  // explicit "html" is Markdown - so every note written before this field
  // existed, and every legacy export, loads as Markdown untouched.
  function coerceBodyFormat(value) {
    return value === "html" ? "html" : "markdown";
  }

  // Tag-strip + entity-decode for an HTML body, for the list preview and
  // title fallback only. Pure string work so it runs in Node tests with no
  // DOM; the result is always used via textContent, never as markup. Block
  // ends become newlines so titleFor()'s first-line logic still works.
  function htmlToText(html) {
    const withBreaks = coerceString(html)
      .replace(/<\s*(br|\/p|\/h[1-6]|\/li|\/div|\/tr)\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    return withBreaks
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
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
      bodyFormat: coerceBodyFormat(raw.bodyFormat),
      pinned: raw.pinned === true,
      // Either a valid folder id or null. A note that predates folders, or one
      // whose folder was deleted, normalizes to null (Unfiled).
      folderId: coerceFolderId(raw.folderId),
      createdAt: created,
      updatedAt: updated
    };
  }

  // One stored folder. Same defensive contract as normalizeNote: unknown keys
  // dropped, missing keys defaulted, a record with no visible name rejected
  // (returns null) so a malformed entry can't poison the folder store.
  function normalizeFolder(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const name = normalizeFolderName(raw.name);
    if (!name) return null;
    const created = coerceTimestamp(raw.createdAt, now());
    const updated = coerceTimestamp(raw.updatedAt, created);
    const id = coerceString(raw.id).trim();
    const order = Number(raw.sortOrder);
    return {
      id: isFolderId(id) ? id : makeFolderId(),
      name,
      createdAt: created,
      updatedAt: updated,
      sortOrder: Number.isFinite(order) ? Math.floor(order) : 0
    };
  }

  function newFolder(name) {
    const ts = now();
    return {
      id: makeFolderId(),
      name: normalizeFolderName(name),
      createdAt: ts,
      updatedAt: ts,
      sortOrder: 0
    };
  }

  function newNote(fields) {
    const ts = now();
    const note = {
      id: makeId(),
      title: "",
      body: "",
      bodyFormat: "markdown",
      pinned: false,
      folderId: null,
      createdAt: ts,
      updatedAt: ts
    };
    if (fields && typeof fields === "object") {
      if (typeof fields.title === "string") note.title = fields.title.slice(0, MAX_TITLE);
      if (typeof fields.body === "string") note.body = fields.body;
      if (fields.bodyFormat === "html" || fields.bodyFormat === "markdown") note.bodyFormat = fields.bodyFormat;
      if (fields.pinned === true) note.pinned = true;
      if (fields.folderId === null || isFolderId(fields.folderId)) note.folderId = fields.folderId;
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

  // Folders sort by explicit sortOrder, then creation time, then original
  // order - stable, so re-sorting an unchanged list never reshuffles it.
  function sortFolders(list) {
    const array = Array.isArray(list) ? list.slice() : [];
    return array
      .map((folder, index) => ({ folder, index }))
      .sort((a, b) => {
        const ao = a.folder ? a.folder.sortOrder || 0 : 0;
        const bo = b.folder ? b.folder.sortOrder || 0 : 0;
        if (ao !== bo) return ao - bo;
        const ac = a.folder ? a.folder.createdAt || 0 : 0;
        const bc = b.folder ? b.folder.createdAt || 0 : 0;
        if (ac !== bc) return ac - bc;
        return a.index - b.index;
      })
      .map((entry) => entry.folder);
  }

  // A plain-text one-liner from a note body for the list preview. Never
  // rendered as HTML. `format` ("markdown" | "html") selects how the stored
  // string is flattened - Markdown strips exactly the syntax the toolbar
  // inserts; HTML is tag-stripped. Defaults to Markdown for callers (and
  // notes) that predate the discriminator.
  function previewOf(body, length, format) {
    const limit = typeof length === "number" ? length : PREVIEW_LENGTH;
    const base =
      format === "html"
        ? htmlToText(body)
        : coerceString(body)
            .replace(/^#{1,6}\s+/gm, "")
            .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, "")
            .replace(/^\s*[-*+]\s+/gm, "")
            .replace(/^\s*\d+\.\s+/gm, "")
            .replace(/[*_`>#~]/g, "");
    const text = base.replace(/\s+/g, " ").trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
  }

  // Display title: the explicit title, else the first non-empty body line
  // with its formatting stripped, else a stable placeholder.
  function titleFor(note) {
    const explicit = coerceString(note && note.title).trim();
    if (explicit) return explicit;
    const rawBody =
      note && note.bodyFormat === "html"
        ? htmlToText(note && note.body)
        : coerceString(note && note.body);
    const firstLine = rawBody
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

  function buildExport(notes, folders) {
    const normalizedNotes = (Array.isArray(notes) ? notes : [])
      .map(normalizeNote)
      .filter(Boolean);
    const normalizedFolders = sortFolders(
      (Array.isArray(folders) ? folders : []).map(normalizeFolder).filter(Boolean)
    );
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      count: normalizedNotes.length,
      folderCount: normalizedFolders.length,
      // Folder membership travels only via each note's `folderId`; the folder
      // name is never copied onto the note.
      notes: normalizedNotes,
      folders: normalizedFolders
    };
  }

  function serializeExport(notes, folders) {
    return JSON.stringify(buildExport(notes, folders), null, 2);
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
    // `folders` is optional (absent in every v1 export). A non-array, or
    // malformed entries, are skipped - never a reason to reject the whole
    // file, and never a way to corrupt existing notes/folders.
    const rawFolders = Array.isArray(data.folders) ? data.folders : [];
    const folders = rawFolders.map(normalizeFolder).filter(Boolean);
    return {
      ok: true,
      notes,
      folders,
      skipped: data.notes.length - notes.length,
      foldersSkipped: rawFolders.length - folders.length
    };
  }

  function sameNote(a, b) {
    return (
      a.title === b.title &&
      a.body === b.body &&
      a.bodyFormat === b.bodyFormat &&
      a.pinned === b.pinned &&
      (a.folderId || null) === (b.folderId || null) &&
      a.createdAt === b.createdAt
    );
  }

  // Merge imported folders into the existing set BEFORE the notes, and return
  // an id map the note merge uses to re-point `folderId`.
  //
  //   - identical folder already present (same id + same name)  -> reuse it
  //   - id collides with a different existing/incoming folder    -> fresh id
  //   - unrecognised id shape                                    -> fresh id
  //
  // A name that merely matches an existing folder with a different id is NOT
  // merged - that would silently move imported notes into a folder the user
  // never chose. Two same-named folders after an import is acceptable; the
  // user can rename or delete one.
  function mergeImportFolders(existing, incoming) {
    const result = (Array.isArray(existing) ? existing : [])
      .map(normalizeFolder)
      .filter(Boolean);
    const byId = new Map(result.map((folder) => [folder.id, folder]));
    const idMap = new Map();
    let added = 0;
    let skipped = 0;

    const nextOrder = () =>
      result.reduce((max, folder) => Math.max(max, folder.sortOrder || 0), -1) + 1;

    (Array.isArray(incoming) ? incoming : []).forEach((raw) => {
      const originalId =
        raw && typeof raw === "object" ? coerceString(raw.id).trim() : "";
      const folder = normalizeFolder(raw);
      if (!folder) {
        skipped += 1;
        return;
      }
      const clash = isFolderId(originalId) ? byId.get(originalId) : null;
      if (clash && folderNameKey(clash.name) === folderNameKey(folder.name)) {
        if (originalId) idMap.set(originalId, clash.id);
        skipped += 1;
        return;
      }
      let finalId = folder.id;
      if (!isFolderId(finalId) || byId.has(finalId)) finalId = makeFolderId();
      const record = {
        id: finalId,
        name: folder.name,
        createdAt: folder.createdAt,
        updatedAt: folder.updatedAt,
        sortOrder: nextOrder()
      };
      result.push(record);
      byId.set(finalId, record);
      if (originalId) idMap.set(originalId, finalId);
      added += 1;
    });

    return { folders: sortFolders(result), idMap, added, skipped };
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
        if (from < 2) {
          // Folders only. Existing notes are NOT touched here - they keep
          // loading exactly as before and normalize to folderId:null on read.
          const folders = db.createObjectStore(FOLDER_STORE_NAME, { keyPath: "id" });
          folders.createIndex("sortOrder", "sortOrder", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the notes database."));
      // Another tab holding an older version open; it closes on its own.
      request.onblocked = () => {};
    });
  }

  function objectStore(db, mode, name) {
    const storeName = name || STORE_NAME;
    return db.transaction(storeName, mode).objectStore(storeName);
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

    function rawFolderGetAll() {
      return db()
        .then((conn) => requestToPromise(objectStore(conn, "readonly", FOLDER_STORE_NAME).getAll()))
        .then((rows) => (rows || []).map(normalizeFolder).filter(Boolean));
    }

    function rawFolderPut(record) {
      return db().then((conn) =>
        requestToPromise(objectStore(conn, "readwrite", FOLDER_STORE_NAME).put(record))
      );
    }

    function getAll() {
      return rawGetAll().then(sortNotes);
    }

    function get(id) {
      return rawGet(id);
    }

    function getFolders() {
      return rawFolderGetAll().then(sortFolders);
    }

    function getFolder(id) {
      return db()
        .then((conn) => requestToPromise(objectStore(conn, "readonly", FOLDER_STORE_NAME).get(id)))
        .then((row) => (row ? normalizeFolder(row) : null));
    }

    function put(note) {
      const record = normalizeNote(note);
      if (!record) return Promise.reject(new Error("Invalid note."));
      return serialize(() => rawPut(record)).then(() => record);
    }

    function create(fields) {
      const seed = newNote(fields);
      if (seed.folderId == null) return put(seed);
      // A seeded folderId is validated against the folder store in the same
      // transaction so a "new note in this folder" can never land a dangling
      // reference (e.g. the folder was deleted a moment earlier).
      return serialize(() =>
        db().then(
          (conn) =>
            new Promise((resolve, reject) => {
              let tx;
              try {
                tx = conn.transaction([STORE_NAME, FOLDER_STORE_NAME], "readwrite");
              } catch (error) {
                reject(error);
                return;
              }
              const notesStore = tx.objectStore(STORE_NAME);
              const foldersStore = tx.objectStore(FOLDER_STORE_NAME);
              const folderReq = foldersStore.get(seed.folderId);
              folderReq.onsuccess = () => {
                const record = normalizeNote(
                  Object.assign({}, seed, { folderId: folderReq.result ? seed.folderId : null })
                );
                const putReq = notesStore.put(record);
                putReq.onsuccess = () => resolve(record);
                putReq.onerror = () => reject(putReq.error);
              };
              folderReq.onerror = () => reject(folderReq.error);
            })
        )
      );
    }

    function update(id, patch) {
      return serialize(() =>
        rawGet(id).then((existing) => {
          if (!existing) return null;
          const merged = Object.assign({}, existing);
          if (patch && typeof patch === "object") {
            if (typeof patch.title === "string") merged.title = patch.title.slice(0, MAX_TITLE);
            if (typeof patch.body === "string") merged.body = patch.body;
            if (patch.bodyFormat === "html" || patch.bodyFormat === "markdown") merged.bodyFormat = patch.bodyFormat;
            if (typeof patch.pinned === "boolean") merged.pinned = patch.pinned;
            if (patch.folderId === null || isFolderId(patch.folderId)) merged.folderId = patch.folderId;
          }
          merged.updatedAt = now();
          return rawPut(merged).then(() => merged);
        })
      );
    }

    function remove(id) {
      return serialize(() => rawDelete(id));
    }

    /* ----------------------------------------------------------------
     *   Folder mutations
     * -------------------------------------------------------------- */

    function createFolder(name) {
      return serialize(() =>
        db().then(
          (conn) =>
            new Promise((resolve, reject) => {
              const clean = normalizeFolderName(name);
              if (!clean) {
                reject(new Error("Enter a folder name."));
                return;
              }
              const store = objectStore(conn, "readwrite", FOLDER_STORE_NAME);
              const allReq = store.getAll();
              allReq.onsuccess = () => {
                const folders = (allReq.result || []).map(normalizeFolder).filter(Boolean);
                const key = folderNameKey(clean);
                if (folders.some((folder) => folderNameKey(folder.name) === key)) {
                  reject(new Error("A folder with that name already exists."));
                  return;
                }
                const order = folders.reduce((max, f) => Math.max(max, f.sortOrder || 0), -1) + 1;
                const folder = {
                  id: makeFolderId(),
                  name: clean,
                  createdAt: now(),
                  updatedAt: now(),
                  sortOrder: order
                };
                const putReq = store.put(folder);
                putReq.onsuccess = () => resolve(folder);
                putReq.onerror = () => reject(putReq.error);
              };
              allReq.onerror = () => reject(allReq.error);
            })
        )
      );
    }

    function renameFolder(id, name) {
      return serialize(() =>
        db().then(
          (conn) =>
            new Promise((resolve, reject) => {
              const clean = normalizeFolderName(name);
              if (!clean) {
                reject(new Error("Enter a folder name."));
                return;
              }
              const store = objectStore(conn, "readwrite", FOLDER_STORE_NAME);
              const allReq = store.getAll();
              allReq.onsuccess = () => {
                const folders = (allReq.result || []).map(normalizeFolder).filter(Boolean);
                const current = folders.find((folder) => folder.id === id);
                if (!current) {
                  resolve(null);
                  return;
                }
                const key = folderNameKey(clean);
                if (folders.some((folder) => folder.id !== id && folderNameKey(folder.name) === key)) {
                  reject(new Error("A folder with that name already exists."));
                  return;
                }
                const updated = Object.assign({}, current, { name: clean, updatedAt: now() });
                const putReq = store.put(updated);
                putReq.onsuccess = () => resolve(updated);
                putReq.onerror = () => reject(putReq.error);
              };
              allReq.onerror = () => reject(allReq.error);
            })
        )
      );
    }

    // Deleting a folder NEVER deletes its notes. In one readwrite transaction
    // over both stores: every note whose folderId matches is rewritten to
    // folderId:null, then the folder record is removed. If any step fails the
    // transaction aborts and nothing changes - no dangling folderId is left.
    function deleteFolder(id) {
      return serialize(() =>
        db().then(
          (conn) =>
            new Promise((resolve, reject) => {
              let tx;
              try {
                tx = conn.transaction([STORE_NAME, FOLDER_STORE_NAME], "readwrite");
              } catch (error) {
                reject(error);
                return;
              }
              const notesStore = tx.objectStore(STORE_NAME);
              const foldersStore = tx.objectStore(FOLDER_STORE_NAME);
              let failed = false;
              const fail = (error) => {
                if (failed) return;
                failed = true;
                try {
                  tx.abort();
                } catch (abortError) {
                  /* already settling */
                }
                reject(error || new Error("Could not delete the folder."));
              };
              const allReq = notesStore.getAll();
              allReq.onsuccess = () => {
                const targets = (allReq.result || []).filter(
                  (row) => row && row.folderId === id
                );
                let remaining = targets.length + 1; // + the folder delete itself
                const step = () => {
                  remaining -= 1;
                  if (remaining === 0 && !failed) {
                    resolve({ ok: true, folderId: id, notesUnfiled: targets.length });
                  }
                };
                targets.forEach((row) => {
                  const putReq = notesStore.put(Object.assign({}, row, { folderId: null }));
                  putReq.onsuccess = step;
                  putReq.onerror = () => fail(putReq.error);
                });
                const delReq = foldersStore.delete(id);
                delReq.onsuccess = step;
                delReq.onerror = () => fail(delReq.error);
              };
              allReq.onerror = () => fail(allReq.error);
              if (typeof tx.onabort !== "undefined") tx.onabort = () => fail(tx.error);
            })
        )
      );
    }

    // Move one note to a folder (or to null / Unfiled). An unknown target
    // folder resolves to null rather than creating a dangling reference.
    function moveNoteToFolder(noteId, folderId) {
      return serialize(() =>
        db().then(
          (conn) =>
            new Promise((resolve, reject) => {
              let tx;
              try {
                tx = conn.transaction([STORE_NAME, FOLDER_STORE_NAME], "readwrite");
              } catch (error) {
                reject(error);
                return;
              }
              const notesStore = tx.objectStore(STORE_NAME);
              const foldersStore = tx.objectStore(FOLDER_STORE_NAME);
              const target = coerceFolderId(folderId);
              const noteReq = notesStore.get(noteId);
              noteReq.onsuccess = () => {
                const existing = noteReq.result ? normalizeNote(noteReq.result) : null;
                if (!existing) {
                  resolve(null);
                  return;
                }
                const write = (resolved) => {
                  const merged = Object.assign({}, existing, {
                    folderId: resolved,
                    updatedAt: now()
                  });
                  const putReq = notesStore.put(merged);
                  putReq.onsuccess = () => resolve(merged);
                  putReq.onerror = () => reject(putReq.error);
                };
                if (target == null) {
                  write(null);
                  return;
                }
                const folderReq = foldersStore.get(target);
                folderReq.onsuccess = () => write(folderReq.result ? target : null);
                folderReq.onerror = () => reject(folderReq.error);
              };
              noteReq.onerror = () => reject(noteReq.error);
            })
        )
      );
    }

    function reorderFolders(orderedIds) {
      const ids = Array.isArray(orderedIds)
        ? orderedIds.filter((value) => typeof value === "string")
        : [];
      return serialize(() =>
        db().then(
          (conn) =>
            new Promise((resolve, reject) => {
              const store = objectStore(conn, "readwrite", FOLDER_STORE_NAME);
              const allReq = store.getAll();
              allReq.onsuccess = () => {
                const folders = (allReq.result || []).map(normalizeFolder).filter(Boolean);
                if (!folders.length) {
                  resolve([]);
                  return;
                }
                const rank = new Map(ids.map((id, index) => [id, index]));
                let remaining = folders.length;
                let failed = false;
                const out = [];
                folders.forEach((folder) => {
                  const next = Object.assign({}, folder, {
                    sortOrder: rank.has(folder.id)
                      ? rank.get(folder.id)
                      : ids.length + (folder.sortOrder || 0)
                  });
                  out.push(next);
                  const putReq = store.put(next);
                  putReq.onsuccess = () => {
                    remaining -= 1;
                    if (remaining === 0 && !failed) resolve(sortFolders(out));
                  };
                  putReq.onerror = () => {
                    if (failed) return;
                    failed = true;
                    reject(putReq.error);
                  };
                });
              };
              allReq.onerror = () => reject(allReq.error);
            })
        )
      );
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
      return Promise.all([getAll(), getFolders()]).then(([notes, folders]) =>
        serializeExport(notes, folders)
      );
    }

    // Validates first (parseImport never throws); only touches the store
    // once the file is known-good, and only ever adds - a malformed file
    // leaves every existing note and folder exactly as it was. The whole
    // merge+write runs as one serialized unit so a concurrent edit can't
    // interleave.
    //
    // Folders are merged first; the resulting id map re-points each imported
    // note's folderId. An imported note whose folder is missing/invalid after
    // that step imports as Unfiled - it is never pointed at an unrelated
    // existing folder.
    function importNotes(input) {
      const parsed = parseImport(input);
      if (!parsed.ok) return Promise.resolve(parsed);
      return serialize(() =>
        Promise.all([rawGetAll(), rawFolderGetAll()]).then(([existingNotes, existingFolders]) => {
          const folderMerge = mergeImportFolders(existingFolders, parsed.folders);
          const remappedNotes = parsed.notes.map((note) => {
            if (note.folderId == null) return note;
            const mapped = folderMerge.idMap.get(note.folderId);
            return Object.assign({}, note, { folderId: mapped || null });
          });
          const noteMerge = mergeImport(existingNotes, remappedNotes);
          return folderMerge.folders
            .reduce((chain, folder) => chain.then(() => rawFolderPut(folder)), Promise.resolve())
            .then(() =>
              noteMerge.notes.reduce(
                (chain, note) => chain.then(() => rawPut(note)),
                Promise.resolve()
              )
            )
            .then(() => ({
              ok: true,
              added: noteMerge.added,
              renamed: noteMerge.renamed,
              skipped: noteMerge.skipped + (parsed.skipped || 0),
              foldersAdded: folderMerge.added,
              foldersSkipped: folderMerge.skipped + (parsed.foldersSkipped || 0)
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
      getFolders,
      getFolder,
      createFolder,
      renameFolder,
      deleteFolder,
      moveNoteToFolder,
      reorderFolders,
      exportNotes,
      importNotes,
      close
    };
  }

  return {
    DB_NAME,
    STORE_NAME,
    FOLDER_STORE_NAME,
    SCHEMA_VERSION,
    EXPORT_FORMAT,
    EXPORT_VERSION,
    PREVIEW_LENGTH,
    MAX_TITLE,
    MAX_FOLDER_NAME,
    isSupported,
    newNote,
    newFolder,
    normalizeNote,
    normalizeFolder,
    sortNotes,
    sortFolders,
    folderNameKey,
    previewOf,
    titleFor,
    htmlToText,
    buildExport,
    serializeExport,
    parseImport,
    mergeImport,
    mergeImportFolders,
    createStore
  };
});
