const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeName, normalizedKey, isConflictError } = require("./cloud-sync.js");

test("normalizes synchronized line and setup names", () => {
  assert.equal(normalizeName("  Line   9  "), "Line 9");
  assert.equal(normalizedKey("  LINE   9 "), "line 9");
});

test("recognizes optimistic concurrency failures", () => {
  assert.equal(isConflictError({ code: "40001", message: "revision_conflict" }), true);
  assert.equal(isConflictError({ code: "PGRST301", message: "offline" }), false);
});

test("disabled configuration remains a no-op without Supabase", async () => {
  const storage = { getItem(){ return null; }, setItem(){} };
  const syncStorage = require("./sync-storage.js");
  const sync = require("./cloud-sync.js").create({
    config: { enabled: false }, syncStorage, storage,
    adapter: { onStateChange(){} }
  });
  const state = await sync.initialize();
  assert.equal(state.status, "Local only");
  sync.notifyActiveJobMutation();
  assert.equal(syncStorage.createStore(storage).pendingCount(), 0);
});
