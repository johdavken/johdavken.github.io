"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("renderLineSync calls renderPendingList with the sync state's pendingSummary", () => {
  assert.match(app, /renderPendingList\(syncState\.pendingSummary\);/);
});

test("renderPendingList hides the list entirely when there are no pending items, rather than showing an empty list", () => {
  const fnStart = app.indexOf("function renderPendingList(");
  const fnEnd = app.indexOf("\n  }", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /host\.hidden = !items\?\.length;/);
  assert.match(body, /if \(!items\?\.length\) return;/);
});

test("renderPendingList maps active-job kind and saved-setup action to human-readable labels, falling back to the raw value if unmapped", () => {
  const fnStart = app.indexOf("function renderPendingList(");
  const fnEnd = app.indexOf("\n  }", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /ACTIVE_JOB_PENDING_LABELS\[item\.kind\] \|\| item\.kind/);
  assert.match(body, /SETUP_ACTION_LABELS\[item\.action\] \|\| item\.action/);
});

test("renderPendingList shows which workspace a stuck item belongs to, with a clear fallback when the workspace can't be resolved", () => {
  const fnStart = app.indexOf("function renderPendingList(");
  const fnEnd = app.indexOf("\n  }", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /item\.workspaceName \|\| "an unknown line \(you may have left it\)"/);
});

test("the active-job kind label map covers every kind string used elsewhere in app.js's notifyActiveJobMutation calls", () => {
  const usedKinds = new Set();
  for (const match of app.matchAll(/kind:\s*"([a-z-]+)"/g)) usedKinds.add(match[1]);
  const mapStart = app.indexOf("const ACTIVE_JOB_PENDING_LABELS = {");
  const mapEnd = app.indexOf("};", mapStart);
  const mapBody = app.slice(mapStart, mapEnd);
  usedKinds.forEach(kind => {
    assert.match(mapBody, new RegExp(`"?${kind}"?:`), `expected ACTIVE_JOB_PENDING_LABELS to have an entry for kind "${kind}"`);
  });
});

test("the pending list container exists in index.html, inside the RT Sync panel, hidden by default", () => {
  assert.match(index, /<ul id="lineSyncPendingList" class="lineSyncPendingList" hidden><\/ul>/);
});

test("the pending list has its own CSS, reusing the existing pill/row visual language rather than inventing new chrome", () => {
  assert.match(styles, /\.lineSyncPendingList\{/);
  assert.match(styles, /\.lineSyncPendingList li\{/);
});

// --- discard: the only recovery for an item stuck on an unreachable workspace ---

test("each pending item gets a Discard button, using the existing danger button convention", () => {
  const fnStart = app.indexOf("function renderPendingList(");
  const fnEnd = app.indexOf("\n  }", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /discard\.className = "danger lineSyncPendingDiscardBtn";/);
  assert.match(body, /discard\.textContent = "Discard";/);
});

test("discarding requires an explicit confirm() naming what will be lost and that it's irreversible - matching the app's other destructive-action confirmations", () => {
  const fnStart = app.indexOf("function renderPendingList(");
  const fnEnd = app.indexOf("\n  }", fnStart);
  const body = app.slice(fnStart, fnEnd);
  assert.match(body, /if \(!confirm\(/);
  assert.match(body, /cannot be undone/i);
});

test("confirming discard calls lineSync.discardPendingItem with the exact item clicked, only after the confirm() check", () => {
  const fnStart = app.indexOf("function renderPendingList(");
  const fnEnd = app.indexOf("\n  }", fnStart);
  const body = app.slice(fnStart, fnEnd);
  const confirmIndex = body.indexOf("if (!confirm(");
  const discardCallIndex = body.indexOf("lineSync?.discardPendingItem(item);");
  assert.ok(confirmIndex !== -1 && discardCallIndex !== -1 && confirmIndex < discardCallIndex);
});

test("cloud-sync.js exposes discardPendingItem publicly for app.js to call", () => {
  const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");
  assert.match(cloudSync, /function discardPendingItem\(item\)\{/);
  assert.match(cloudSync, /^\s*discardPendingItem\s*$/m);
});
