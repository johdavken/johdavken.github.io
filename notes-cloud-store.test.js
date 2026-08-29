"use strict";

// PolynNotesStore additions for RT Cloud:
//   - the v3 `meta` key/value store (getMeta / setMeta / deleteMeta)
//   - replaceAllFromExport(): the transactional "Replace local RT Notes"
//     path of an RT Cloud restore
//   - the v2 -> v3 upgrade preserving existing notes and folders
//
// Uses a small fake IndexedDB that supports multi-store transactions, a
// keyPath per store, clear(), and a real rollback on abort() so the
// transactional guarantee can actually be exercised.

const test = require("node:test");
const assert = require("node:assert/strict");

/* -------------------------------------------------------------------- *
 *   Fake IndexedDB with rollback-on-abort
 * ------------------------------------------------------------------ */

const DATABASES = new Map();

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function fire(request, work) {
  queueMicrotask(() => {
    try {
      request.result = work();
      request.onsuccess && request.onsuccess({ target: request });
    } catch (error) {
      request.error = error;
      request.onerror && request.onerror({ target: request });
    }
  });
}

function makeStore(entry, name, failPut) {
  const records = entry.stores.get(name);
  const keyPath = entry.keyPaths.get(name) || "id";
  return {
    createIndex() {},
    getAll() {
      const r = {};
      fire(r, () => Array.from(records.values()).map(clone));
      return r;
    },
    get(key) {
      const r = {};
      fire(r, () => clone(records.get(key)));
      return r;
    },
    put(record) {
      const r = {};
      fire(r, () => {
        if (failPut && failPut(record, name)) throw new Error(`put rejected for ${name}`);
        const key = record[keyPath];
        records.set(key, clone(record));
        return key;
      });
      return r;
    },
    delete(key) {
      const r = {};
      fire(r, () => {
        records.delete(key);
        return undefined;
      });
      return r;
    },
    clear() {
      const r = {};
      fire(r, () => {
        records.clear();
        return undefined;
      });
      return r;
    }
  };
}

function makeConnection(name, opts) {
  const entry = DATABASES.get(name);
  return {
    objectStoreNames: { contains: (s) => entry.stores.has(s) },
    createObjectStore(storeName, params) {
      if (!entry.stores.has(storeName)) entry.stores.set(storeName, new Map());
      entry.keyPaths.set(storeName, (params && params.keyPath) || "id");
      return makeStore(entry, storeName, opts && opts.failPut);
    },
    transaction(storeNames) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      // Snapshot every named store so abort() can roll the whole thing back.
      const snapshots = new Map(names.map((n) => [n, new Map(entry.stores.get(n))]));
      const tx = {
        error: null,
        onabort: null,
        oncomplete: null,
        objectStore: (n) => makeStore(entry, n, opts && opts.failPut),
        abort() {
          for (const [n, snap] of snapshots) entry.stores.set(n, new Map(snap));
          if (tx.onabort) tx.onabort();
        }
      };
      return tx;
    },
    close() {}
  };
}

function installFakeIndexedDB(opts) {
  global.indexedDB = {
    open(name, version) {
      const request = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      if (!DATABASES.has(name)) DATABASES.set(name, { version: 0, stores: new Map(), keyPaths: new Map() });
      const entry = DATABASES.get(name);
      queueMicrotask(() => {
        request.result = makeConnection(name, opts);
        if (version > entry.version) {
          const oldVersion = entry.version;
          entry.version = version;
          request.onupgradeneeded &&
            request.onupgradeneeded({ target: request, oldVersion, newVersion: version });
        }
        request.onsuccess && request.onsuccess({ target: request });
      });
      return request;
    }
  };
}

installFakeIndexedDB();
const NotesStore = require("./notes-store.js");

function resetDb() {
  DATABASES.clear();
}

function seedV2(notes, folders) {
  // A pre-existing v2 database: notes + folders stores populated, no meta.
  const stores = new Map([
    ["notes", new Map((notes || []).map((n) => [n.id, NotesStore.normalizeNote(n)]))],
    ["folders", new Map((folders || []).map((f) => [f.id, NotesStore.normalizeFolder(f)]))]
  ]);
  const keyPaths = new Map([
    ["notes", "id"],
    ["folders", "id"]
  ]);
  DATABASES.set(NotesStore.DB_NAME, { version: 2, stores, keyPaths });
}

/* -------------------------------------------------------------------- *
 *   Meta store
 * ------------------------------------------------------------------ */

test("meta store: set / get / delete round-trips arbitrary values", async () => {
  resetDb();
  installFakeIndexedDB();
  const store = NotesStore.createStore();

  assert.equal(await store.getMeta("rtCloud.v1"), null, "missing key reads as null");

  const value = { enabled: true, recoveryCode: "AAAA-BBBB", kdfSalt: "c2FsdA==", lastRevision: 3 };
  await store.setMeta("rtCloud.v1", value);
  assert.deepEqual(await store.getMeta("rtCloud.v1"), value);

  await store.setMeta("rtCloud.v1", Object.assign({}, value, { lastRevision: 4 }));
  assert.equal((await store.getMeta("rtCloud.v1")).lastRevision, 4, "overwrite wins (last-write-wins)");

  await store.deleteMeta("rtCloud.v1");
  assert.equal(await store.getMeta("rtCloud.v1"), null);
});

test("meta store is never part of an export", async () => {
  resetDb();
  installFakeIndexedDB();
  const store = NotesStore.createStore();
  await store.create({ title: "n1", body: "b" });
  await store.setMeta("rtCloud.v1", { enabled: true, recoveryCode: "SECRET-CODE-HERE" });
  const json = await store.exportNotes();
  assert.ok(!json.includes("SECRET-CODE-HERE"));
  assert.ok(!json.includes("rtCloud"));
  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed).sort(), ["count", "exportedAt", "folderCount", "folders", "format", "notes", "version"]);
});

/* -------------------------------------------------------------------- *
 *   v2 -> v3 upgrade
 * ------------------------------------------------------------------ */

test("opening a v2 database upgrades to v3 without losing notes or folders", async () => {
  resetDb();
  installFakeIndexedDB();
  seedV2(
    [
      { id: "note_a", title: "Startup", body: "check dryers", folderId: "folder_j", createdAt: 10, updatedAt: 20 },
      { id: "note_b", title: "Shutdown", body: "purge", pinned: true, createdAt: 11, updatedAt: 21 }
    ],
    [{ id: "folder_j", name: "Jobs", createdAt: 5, updatedAt: 5, sortOrder: 0 }]
  );

  const store = NotesStore.createStore();
  const notes = await store.getAll();
  const folders = await store.getFolders();
  assert.equal(notes.length, 2, "both notes survived the upgrade");
  assert.equal(folders.length, 1, "the folder survived the upgrade");
  assert.equal(notes.find((n) => n.id === "note_a").folderId, "folder_j");

  const entry = DATABASES.get(NotesStore.DB_NAME);
  assert.equal(entry.version, 3);
  assert.ok(entry.stores.has("meta"), "meta store created by the v3 upgrade");

  // The new meta store is usable straight away.
  await store.setMeta("rtCloud.v1", { enabled: false });
  assert.deepEqual(await store.getMeta("rtCloud.v1"), { enabled: false });
});

/* -------------------------------------------------------------------- *
 *   replaceAllFromExport - the Replace path of a restore
 * ------------------------------------------------------------------ */

function snapshot(notes, folders) {
  return NotesStore.serializeExport(notes, folders);
}

test("replaceAllFromExport swaps the whole notebook for the snapshot", async () => {
  resetDb();
  installFakeIndexedDB();
  const store = NotesStore.createStore();
  await store.create({ title: "old one", body: "gone after restore" });
  await store.createFolder("Old Folder");

  const snap = snapshot(
    [
      { id: "n_new1", title: "New A", body: "<p>x</p>", bodyFormat: "html", pinned: true, folderId: "folder_x", createdAt: 1, updatedAt: 2 },
      { id: "n_new2", title: "New B", body: "y", bodyFormat: "markdown", createdAt: 3, updatedAt: 4 }
    ],
    [{ id: "folder_x", name: "Restored", createdAt: 1, updatedAt: 1, sortOrder: 0 }]
  );

  const result = await store.replaceAllFromExport(snap);
  assert.deepEqual(result, { ok: true, notes: 2, folders: 1 });

  const notes = await store.getAll();
  const folders = await store.getFolders();
  assert.deepEqual(notes.map((n) => n.id).sort(), ["n_new1", "n_new2"]);
  assert.equal(notes.find((n) => n.id === "n_new1").bodyFormat, "html");
  assert.equal(notes.find((n) => n.id === "n_new1").pinned, true);
  assert.equal(notes.find((n) => n.id === "n_new1").folderId, "folder_x");
  assert.deepEqual(folders.map((f) => f.name), ["Restored"]);
});

test("replaceAllFromExport rejects a malformed snapshot and changes nothing", async () => {
  resetDb();
  installFakeIndexedDB();
  const store = NotesStore.createStore();
  await store.create({ title: "keep me", body: "still here" });
  const before = await store.getAll();

  const bad = await store.replaceAllFromExport('{"not":"a notes export"}');
  assert.equal(bad.ok, false);
  const after = await store.getAll();
  assert.deepEqual(after.map((n) => n.title), before.map((n) => n.title), "existing notes untouched");
});

test("replaceAllFromExport is transactional: a mid-write failure rolls the notebook back", async () => {
  resetDb();
  // Make the SECOND note put fail, after clear() has already run.
  let putCount = 0;
  installFakeIndexedDB({
    failPut: (record, storeName) => {
      if (storeName === "notes") {
        putCount += 1;
        return putCount === 2;
      }
      return false;
    }
  });
  const store = NotesStore.createStore();
  await store.create({ title: "original", body: "must survive a failed restore" });
  await store.createFolder("Original Folder");
  const beforeNotes = await store.getAll();
  const beforeFolders = await store.getFolders();

  const snap = snapshot(
    [
      { id: "r1", title: "R1", body: "a", createdAt: 1, updatedAt: 2 },
      { id: "r2", title: "R2", body: "b", createdAt: 3, updatedAt: 4 },
      { id: "r3", title: "R3", body: "c", createdAt: 5, updatedAt: 6 }
    ],
    [{ id: "folder_r", name: "Restored", createdAt: 1, updatedAt: 1, sortOrder: 0 }]
  );

  await assert.rejects(() => store.replaceAllFromExport(snap), /Could not replace|put rejected/);

  const afterNotes = await store.getAll();
  const afterFolders = await store.getFolders();
  assert.deepEqual(
    afterNotes.map((n) => n.title),
    beforeNotes.map((n) => n.title),
    "notes rolled back to the original notebook - no half-restore"
  );
  assert.deepEqual(
    afterFolders.map((f) => f.name),
    beforeFolders.map((f) => f.name),
    "folders rolled back too"
  );
});

test("replaceAllFromExport with an empty snapshot clears the notebook", async () => {
  resetDb();
  installFakeIndexedDB();
  const store = NotesStore.createStore();
  await store.create({ title: "will be cleared", body: "x" });
  const res = await store.replaceAllFromExport(snapshot([], []));
  assert.deepEqual(res, { ok: true, notes: 0, folders: 0 });
  assert.deepEqual(await store.getAll(), []);
  assert.deepEqual(await store.getFolders(), []);
});
