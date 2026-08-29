"use strict";

// Exercises the IndexedDB wrapper in PolynNotesStore.createStore() against a
// small in-memory fake IndexedDB (no dependency added). Covers create,
// autosave-style update, delete, pin/unpin, persistence across a "reopen",
// and the export/import + malformed-import guarantees end to end.

const test = require("node:test");
const assert = require("node:assert/strict");

/* --------------------------------------------------------------------
 *   Minimal fake IndexedDB
 *
 *   Just enough of the surface notes-store.js touches. Data lives in a
 *   module-level map keyed by database name, so opening a second store
 *   instance sees what the first one wrote - that is the "reopen" test.
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
      const records = new Map();
      entry.stores.set(storeName, records);
      return makeObjectStore(records);
    },
    // Real IDB takes a store name or an array of them; the returned
    // transaction resolves each objectStore(name) call against that set.
    transaction(storeNames) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return {
        objectStore: (name) => makeObjectStore(entry.stores.get(name != null ? name : names[0])),
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

/* -------------------------------------------------------------------- */

test("create writes a note that getAll then returns", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const created = await store.create({ title: "Startup", body: "check dryers" });
  assert.match(created.id, /^note_/);
  const all = await store.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, "Startup");
  assert.equal(all[0].body, "check dryers");
});

test("update patches title/body and bumps updatedAt (the autosave path)", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const created = await store.create({ title: "draft" });
  const originalUpdatedAt = created.updatedAt;
  await new Promise((r) => setTimeout(r, 2));
  const saved = await store.update(created.id, { title: "draft 2", body: "line one" });
  assert.equal(saved.title, "draft 2");
  assert.equal(saved.body, "line one");
  assert.ok(saved.updatedAt >= originalUpdatedAt);
  assert.equal(saved.createdAt, created.createdAt, "createdAt is immutable");
  const reread = await store.get(created.id);
  assert.equal(reread.title, "draft 2");
});

test("update leaves body untouched when only the title is patched", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const created = await store.create({ title: "t", body: "important body" });
  await store.update(created.id, { title: "t2" });
  const reread = await store.get(created.id);
  assert.equal(reread.body, "important body");
});

test("pin / unpin persists and moves the note to the front of the list", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const a = await store.create({ title: "a" });
  const b = await store.create({ title: "b" });

  await store.update(a.id, { pinned: true });
  let all = await store.getAll();
  assert.equal(all[0].id, a.id, "a pinned -> a first");
  assert.equal(all[0].pinned, true);
  assert.equal(all.length, 2);

  await store.update(a.id, { pinned: false });
  all = await store.getAll();
  assert.equal(all.every((n) => n.pinned === false), true, "nothing pinned after unpin");
  assert.equal(all.length, 2);
});

test("remove deletes only the target note", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const a = await store.create({ title: "keep" });
  const b = await store.create({ title: "drop" });
  await store.remove(b.id);
  const all = await store.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, a.id);
  assert.equal(await store.get(b.id), null);
});

test("notes persist across a reopen (a fresh store instance on the same database)", async () => {
  freshDb();
  const first = NotesStore.createStore();
  const made = await first.create({ title: "persisted", body: "still here" });
  first.close();

  const second = NotesStore.createStore();
  const all = await second.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, made.id);
  assert.equal(all[0].body, "still here");
});

test("export then import into an empty database restores every note", async () => {
  freshDb();
  const source = NotesStore.createStore();
  await source.create({ title: "one", body: "1" });
  const pinned = await source.create({ title: "two", body: "2" });
  await source.update(pinned.id, { pinned: true });
  const json = await source.exportNotes();

  DATABASES.clear();
  const target = NotesStore.createStore();
  const result = await target.importNotes(json);
  assert.equal(result.ok, true);
  assert.equal(result.added, 2);
  const all = await target.getAll();
  assert.deepEqual(all.map((n) => n.title), ["two", "one"], "pinned first");
  assert.equal(all[0].pinned, true);
});

test("a malformed import leaves every existing note exactly as it was", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const keep = await store.create({ title: "precious", body: "do not lose" });

  for (const bad of ["{ not json", JSON.stringify({ format: "other/thing", notes: [] }), JSON.stringify({ format: "resin.tools/notes" })]) {
    const result = await store.importNotes(bad);
    assert.equal(result.ok, false);
  }
  const all = await store.getAll();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, keep.id);
  assert.equal(all[0].body, "do not lose");
});

test("importing a file whose ids collide with local notes keeps both copies", async () => {
  freshDb();
  const store = NotesStore.createStore();
  const local = await store.create({ title: "local", body: "local body" });

  const clashing = JSON.stringify({
    format: "resin.tools/notes",
    version: 1,
    notes: [{ id: local.id, title: "imported", body: "different body", createdAt: 1, updatedAt: 1 }]
  });
  const result = await store.importNotes(clashing);
  assert.equal(result.ok, true);
  assert.equal(result.renamed, 1);

  const all = await store.getAll();
  assert.equal(all.length, 2);
  const original = all.find((n) => n.id === local.id);
  assert.equal(original.title, "local", "the local note is never overwritten");
  assert.ok(all.some((n) => n.title === "imported" && n.id !== local.id));
});

test("importing the same export twice is idempotent - the second run adds nothing", async () => {
  freshDb();
  const store = NotesStore.createStore();
  await store.create({ title: "a" });
  await store.create({ title: "b" });
  const json = await store.exportNotes();

  const first = await store.importNotes(json);
  assert.equal(first.added, 0, "identical notes are skipped");
  assert.equal(first.skipped, 2);
  const all = await store.getAll();
  assert.equal(all.length, 2);
});
