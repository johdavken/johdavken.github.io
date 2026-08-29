"use strict";

// Flat folders for RT Notes - storage-layer behaviour end to end against a
// small in-memory fake IndexedDB (same approach as notes-integration.test.js).
//
// Folders are device-local organisation only: their own object store, never
// serialized to Supabase / RT Sync / workspace state (the isolation checks
// live in notes-integration.test.js). Here we pin the store contract:
// schema upgrade, folder CRUD, the "delete never deletes notes" rule, moves,
// duplicate-name validation, sorting, and the export/import folder merge.

const test = require("node:test");
const assert = require("node:assert/strict");

/* --------------------------------------------------------------------
 *   Minimal fake IndexedDB (supports multi-store transactions + a
 *   layered upgrade so we can seed a "v1, notes only" database).
 * ------------------------------------------------------------------ */

const DATABASES = new Map();

function fireAsync(request, getResult) {
  queueMicrotask(() => {
    try {
      request.result = getResult();
      if (typeof request.onsuccess === "function") request.onsuccess({ target: request });
    } catch (error) {
      request.error = error;
      if (typeof request.onerror === "function") request.onerror({ target: request });
    }
  });
}

function makeObjectStore(records) {
  return {
    createIndex() {},
    getAll() {
      const request = {};
      fireAsync(request, () => Array.from(records.values()));
      return request;
    },
    get(key) {
      const request = {};
      fireAsync(request, () => records.get(key));
      return request;
    },
    put(record) {
      const request = {};
      fireAsync(request, () => {
        records.set(record.id, JSON.parse(JSON.stringify(record)));
        return record.id;
      });
      return request;
    },
    delete(key) {
      const request = {};
      fireAsync(request, () => {
        records.delete(key);
        return undefined;
      });
      return request;
    }
  };
}

function makeConnection(name) {
  const entry = DATABASES.get(name);
  return {
    objectStoreNames: { contains: (store) => entry.stores.has(store) },
    createObjectStore(storeName) {
      const records = entry.stores.get(storeName) || new Map();
      entry.stores.set(storeName, records);
      return makeObjectStore(records);
    },
    transaction(storeNames) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return {
        objectStore: (n) => makeObjectStore(entry.stores.get(n != null ? n : names[0])),
        abort() {}
      };
    },
    close() {}
  };
}

const fakeIndexedDB = {
  open(name, version) {
    const request = { onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    if (!DATABASES.has(name)) DATABASES.set(name, { version: 0, stores: new Map() });
    const entry = DATABASES.get(name);
    queueMicrotask(() => {
      const conn = makeConnection(name);
      request.result = conn;
      if (version > entry.version) {
        const oldVersion = entry.version;
        entry.version = version;
        if (typeof request.onupgradeneeded === "function") {
          request.onupgradeneeded({ target: request, oldVersion, newVersion: version });
        }
      }
      if (typeof request.onsuccess === "function") request.onsuccess({ target: request });
    });
    return request;
  }
};

global.indexedDB = fakeIndexedDB;

const NotesStore = require("./notes-store.js");

function freshDb() {
  DATABASES.clear();
}

// Seed a pre-folders (schema v1) database with a couple of notes, exactly as
// the old code would have left it: a single `notes` store, version 1.
function seedLegacyDb(notes) {
  DATABASES.set(NotesStore.DB_NAME, {
    version: 1,
    stores: new Map([
      [
        "notes",
        new Map(
          (notes || []).map((raw) => {
            const note = NotesStore.normalizeNote(raw);
            // strip folderId to mimic a record written before the field existed
            delete note.folderId;
            return [note.id, note];
          })
        )
      ]
    ])
  });
}

/* --------------------------------------------------------------------
 *   Schema upgrade
 * ------------------------------------------------------------------ */

test("opening at the current schema creates the folders and meta object stores", async () => {
  freshDb();
  const store = NotesStore.createStore();
  await store.getFolders(); // forces open()
  const entry = DATABASES.get(NotesStore.DB_NAME);
  assert.equal(entry.version, NotesStore.SCHEMA_VERSION);
  assert.equal(entry.version, 3);
  assert.ok(entry.stores.has("folders"), "the folders store exists after the upgrade");
  assert.ok(entry.stores.has("meta"), "the meta store exists after the upgrade");
  assert.ok(entry.stores.has("notes"), "the notes store is still there");
});

test("a v1 database (notes only) upgrades to v2 without losing or rewriting notes", async () => {
  seedLegacyDb([
    { id: "note_a", title: "Startup", body: "check dryers", createdAt: 10, updatedAt: 20 },
    { id: "note_b", title: "Shutdown", body: "purge", createdAt: 11, updatedAt: 21, pinned: true }
  ]);
  const store = NotesStore.createStore();
  const all = await store.getAll();
  assert.equal(all.length, 2, "both legacy notes survived the upgrade");
  assert.deepEqual(all.map((n) => n.id).sort(), ["note_a", "note_b"]);
  // Every legacy note normalizes to Unfiled.
  assert.ok(all.every((n) => n.folderId === null));
  // The raw stored records were not bulk-rewritten during the upgrade: their
  // updatedAt is untouched.
  const raw = DATABASES.get(NotesStore.DB_NAME).stores.get("notes");
  assert.equal(raw.get("note_a").updatedAt, 20);
  assert.equal(raw.get("note_b").updatedAt, 21);
  assert.equal(DATABASES.get(NotesStore.DB_NAME).stores.get("folders").size, 0);
});

test("existing notes read back with folderId: null", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const made = await store.create({ title: "plain" });
  assert.equal(made.folderId, null);
  const reread = await store.get(made.id);
  assert.equal(reread.folderId, null);
});

/* --------------------------------------------------------------------
 *   Folder CRUD
 * ------------------------------------------------------------------ */

test("createFolder stores a folder with a stable, name-independent id", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const folder = await store.createFolder("  Jobs  ");
  assert.match(folder.id, /^folder_/);
  assert.equal(folder.name, "Jobs", "the name is trimmed");
  assert.equal(folder.sortOrder, 0);
  const list = await store.getFolders();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, folder.id);
});

test("createFolder rejects an empty / whitespace-only name", async () => {
  freshDb();
  const store = NotesStore.createStore();
  await assert.rejects(() => store.createFolder("   "));
  await assert.rejects(() => store.createFolder(""));
  assert.equal((await store.getFolders()).length, 0);
});

test("createFolder rejects a duplicate name ignoring case and extra whitespace", async () => {
  freshDb();
  const store = NotesStore.createStore();
  await store.createFolder("Jobs");
  await assert.rejects(() => store.createFolder("jobs"));
  await assert.rejects(() => store.createFolder("  JOBS "));
  assert.equal((await store.getFolders()).length, 1);
});

test("renameFolder changes the name and keeps the id; still blocks duplicates", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const jobs = await store.createFolder("Jobs");
  await store.createFolder("Shift");
  const renamed = await store.renameFolder(jobs.id, "Job Cards");
  assert.equal(renamed.id, jobs.id);
  assert.equal(renamed.name, "Job Cards");
  await assert.rejects(() => store.renameFolder(jobs.id, "shift"), "can't collide with another folder");
  // renaming to its own current name (case aside) is fine
  const same = await store.renameFolder(jobs.id, "job cards");
  assert.equal(same.name, "job cards");
});

test("folders sort by sortOrder, then creation order", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const a = await store.createFolder("Alpha");
  const b = await store.createFolder("Bravo");
  const c = await store.createFolder("Charlie");
  let list = await store.getFolders();
  assert.deepEqual(list.map((f) => f.name), ["Alpha", "Bravo", "Charlie"]);
  await store.reorderFolders([c.id, a.id, b.id]);
  list = await store.getFolders();
  assert.deepEqual(list.map((f) => f.name), ["Charlie", "Alpha", "Bravo"]);
});

/* --------------------------------------------------------------------
 *   Delete never deletes notes
 * ------------------------------------------------------------------ */

test("deleteFolder removes the folder and moves its notes to Unfiled - never deletes them", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const jobs = await store.createFolder("Jobs");
  const keep = await store.createFolder("Keep");
  const inJobs1 = await store.create({ title: "j1", folderId: jobs.id });
  const inJobs2 = await store.create({ title: "j2", folderId: jobs.id });
  const inKeep = await store.create({ title: "k1", folderId: keep.id });
  const unfiled = await store.create({ title: "u1" });

  const result = await store.deleteFolder(jobs.id);
  assert.equal(result.notesUnfiled, 2);

  const folders = await store.getFolders();
  assert.deepEqual(folders.map((f) => f.id), [keep.id], "only Jobs is gone");

  const notes = await store.getAll();
  assert.equal(notes.length, 4, "every note is still here");
  const byId = new Map(notes.map((n) => [n.id, n]));
  assert.equal(byId.get(inJobs1.id).folderId, null, "moved to Unfiled");
  assert.equal(byId.get(inJobs2.id).folderId, null, "moved to Unfiled");
  assert.equal(byId.get(inKeep.id).folderId, keep.id, "an unrelated folder's notes are untouched");
  assert.equal(byId.get(unfiled.id).folderId, null);

  // No dangling references anywhere.
  const liveFolderIds = new Set(folders.map((f) => f.id));
  assert.ok(notes.every((n) => n.folderId === null || liveFolderIds.has(n.folderId)));
});

/* --------------------------------------------------------------------
 *   Moving notes
 * ------------------------------------------------------------------ */

test("moveNoteToFolder moves a note between folders and to Unfiled", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const a = await store.createFolder("A");
  const b = await store.createFolder("B");
  const note = await store.create({ title: "n" });
  assert.equal(note.folderId, null);

  let moved = await store.moveNoteToFolder(note.id, a.id);
  assert.equal(moved.folderId, a.id);
  moved = await store.moveNoteToFolder(note.id, b.id);
  assert.equal(moved.folderId, b.id);
  moved = await store.moveNoteToFolder(note.id, null);
  assert.equal(moved.folderId, null, "back to Unfiled");

  assert.equal((await store.get(note.id)).folderId, null);
});

test("moveNoteToFolder to an unknown folder resolves to Unfiled, never a dangling id", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const note = await store.create({ title: "n" });
  const moved = await store.moveNoteToFolder(note.id, "folder_does_not_exist");
  assert.equal(moved.folderId, null);
});

test("creating a note with a stale folderId lands it Unfiled, not dangling", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const made = await store.create({ title: "n", folderId: "folder_ghost" });
  assert.equal(made.folderId, null);
});

/* --------------------------------------------------------------------
 *   Export / import - folder merge
 * ------------------------------------------------------------------ */

test("a new export carries the folders array and note.folderId relationships", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const jobs = await store.createFolder("Jobs");
  await store.create({ title: "filed", folderId: jobs.id });
  await store.create({ title: "loose" });

  const dump = JSON.parse(await store.exportNotes());
  assert.equal(dump.version, 2);
  assert.equal(dump.folderCount, 1);
  assert.equal(dump.folders[0].name, "Jobs");
  const filed = dump.notes.find((n) => n.title === "filed");
  const loose = dump.notes.find((n) => n.title === "loose");
  assert.equal(filed.folderId, jobs.id);
  assert.equal(loose.folderId, null);
});

test("a v1 backup (no folders key) still imports; every note becomes Unfiled", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const legacy = JSON.stringify({
    format: "resin.tools/notes",
    version: 1,
    notes: [
      { id: "note_x", title: "one", body: "1", createdAt: 1, updatedAt: 1 },
      { id: "note_y", title: "two", body: "2", createdAt: 2, updatedAt: 2 }
    ]
  });
  const result = await store.importNotes(legacy);
  assert.equal(result.ok, true);
  assert.equal(result.added, 2);
  assert.equal(result.foldersAdded || 0, 0);
  const notes = await store.getAll();
  assert.ok(notes.every((n) => n.folderId === null));
  assert.equal((await store.getFolders()).length, 0);
});

test("imported folder id that collides with a local folder is remapped, and its notes follow the new id", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const localJobs = await store.createFolder("Jobs"); // some id, say folder_local
  // Incoming file re-uses that exact id for a DIFFERENT folder ("Archive"),
  // and a note that points at it.
  const incoming = JSON.stringify({
    format: "resin.tools/notes",
    version: 2,
    notes: [{ id: "note_imp", title: "archived", body: "b", createdAt: 5, updatedAt: 5, folderId: localJobs.id }],
    folders: [{ id: localJobs.id, name: "Archive", createdAt: 5, updatedAt: 5, sortOrder: 0 }]
  });
  const result = await store.importNotes(incoming);
  assert.equal(result.ok, true);
  assert.equal(result.foldersAdded, 1);

  const folders = await store.getFolders();
  assert.equal(folders.length, 2);
  const archive = folders.find((f) => f.name === "Archive");
  assert.ok(archive, "Archive was added as its own folder");
  assert.notEqual(archive.id, localJobs.id, "with a fresh id - the local folder keeps its id");

  const imported = (await store.getAll()).find((n) => n.title === "archived");
  assert.equal(imported.folderId, archive.id, "the note follows the remapped folder, not local Jobs");
  const localJobsAfter = folders.find((f) => f.name === "Jobs");
  assert.equal(localJobsAfter.id, localJobs.id);
});

test("re-importing the same v2 export is idempotent for both folders and notes", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const jobs = await store.createFolder("Jobs");
  await store.create({ title: "filed", folderId: jobs.id });
  await store.create({ title: "loose" });
  const dump = await store.exportNotes();

  const again = await store.importNotes(dump);
  assert.equal(again.added, 0, "no duplicate notes");
  assert.equal(again.foldersAdded, 0, "no duplicate folders");
  assert.equal((await store.getFolders()).length, 1);
  assert.equal((await store.getAll()).length, 2);
});

test("malformed folder records are skipped; a note pointing at a now-missing folder imports Unfiled", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const payload = JSON.stringify({
    format: "resin.tools/notes",
    version: 2,
    notes: [
      { id: "note_ok", title: "ok", body: "b", createdAt: 1, updatedAt: 1, folderId: "folder_missing" },
      { id: "note_ok2", title: "ok2", body: "b", createdAt: 2, updatedAt: 2 }
    ],
    folders: [null, "garbage", { name: "   " }, { id: "folder_missing" }]
  });
  const result = await store.importNotes(payload);
  assert.equal(result.ok, true);
  assert.equal(result.added, 2, "notes still import");
  assert.equal((await store.getFolders()).length, 0, "no malformed folder made it in");
  const notes = await store.getAll();
  assert.ok(notes.every((n) => n.folderId === null), "the note with a missing folder is Unfiled");
});

test("importing malformed folder data never corrupts existing notes or folders", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const jobs = await store.createFolder("Jobs");
  const precious = await store.create({ title: "precious", body: "keep", folderId: jobs.id });

  await store.importNotes(JSON.stringify({ format: "resin.tools/notes", version: 2, notes: [], folders: "not an array" }));

  const folders = await store.getFolders();
  assert.deepEqual(folders.map((f) => f.name), ["Jobs"]);
  const reread = await store.get(precious.id);
  assert.equal(reread.folderId, jobs.id);
  assert.equal(reread.body, "keep");
});

test("duplicate note handling still keeps both copies when ids collide with different content", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const local = await store.create({ title: "local", body: "local body" });
  const clashing = JSON.stringify({
    format: "resin.tools/notes",
    version: 2,
    notes: [{ id: local.id, title: "imported", body: "different", createdAt: 1, updatedAt: 1 }],
    folders: []
  });
  const result = await store.importNotes(clashing);
  assert.equal(result.renamed, 1);
  const all = await store.getAll();
  assert.equal(all.length, 2);
  assert.equal(all.find((n) => n.id === local.id).title, "local");
});
