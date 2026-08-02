const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore, KEYS } = require("./sync-storage.js");

function memoryStorage(){
  const values = new Map();
  return {
    getItem: key=>values.has(key) ? values.get(key) : null,
    setItem: (key,value)=>values.set(key,String(value)),
    removeItem: key=>values.delete(key)
  };
}

test("keeps only the newest pending active-job snapshot per workspace", () => {
  const store = createStore(memoryStorage());
  store.queueActiveJob("line-1", { operationId: "first", payload: { lineRate: 1 } });
  store.queueActiveJob("line-1", { operationId: "second", payload: { lineRate: 2 } });
  assert.equal(store.getOutbox().activeJobs["line-1"].operationId, "second");
  assert.equal(store.pendingCount(), 1);
});

test("does not clear a newer active-job operation when an older request completes", () => {
  const store = createStore(memoryStorage());
  store.queueActiveJob("line-1", { operationId: "newer" });
  store.clearActiveJob("line-1", "older");
  assert.equal(store.getOutbox().activeJobs["line-1"].operationId, "newer");
});

test("stores a bounded local conflict and replacement backup history", () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  for (let index=0; index<12; index++) store.addBackup({ index });
  const backups = JSON.parse(storage.getItem(KEYS.backups));
  assert.equal(backups.items.length, 10);
  assert.equal(backups.items[0].index, 11);
});

test("reports localStorage failures without throwing", () => {
  const store = createStore({ getItem(){ return null; }, setItem(){ throw new Error("quota"); } });
  assert.equal(store.queueActiveJob("line-1", { operationId: "op" }).ok, false);
});

test("persists a pending workspace-creation operation for safe retries", () => {
  const store = createStore(memoryStorage());
  const settings = store.getSettings();
  settings.pendingWorkspaceCreation = { name: "Line 9", operationId: "create-op-1" };
  assert.equal(store.saveSettings(settings).ok, true);
  assert.deepEqual(store.getSettings().pendingWorkspaceCreation, {
    name: "Line 9",
    operationId: "create-op-1"
  });
});

test("migrates legacy sync settings without losing the selected workspace", () => {
  const storage = memoryStorage();
  const legacyKey = "resin" + "IQ.lineSync.settings.v1";
  storage.setItem(legacyKey, JSON.stringify({
    deviceId: "device-1",
    selectedWorkspaceId: "line-9"
  }));

  const settings = createStore(storage).getSettings();

  assert.equal(settings.selectedWorkspaceId, "line-9");
  assert.equal(JSON.parse(storage.getItem(KEYS.settings)).deviceId, "device-1");
});
