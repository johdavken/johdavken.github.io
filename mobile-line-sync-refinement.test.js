"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("mobile RT Sync has a compact status area and a distinct join prompt", () => {
  assert.match(html, /id="mobileLineSyncStatus"/);
  assert.match(html, /id="mobileLineSyncState"/);
  assert.match(html, /id="mobileLineSyncLastSync"/);
  assert.match(html, /id="mobileLineSyncPending"/);
  assert.match(html, /JOIN RT SYNC/);
  assert.match(html, /Enter this workspace’s four-character link code\./);
  assert.match(html, /id="lineSyncRetryMobileLabel">Refresh now/);
});

test("mobile RT Sync status distinguishes healthy sync, pending changes, errors, and local-only devices", () => {
  const start = app.indexOf("function renderMobileLineSyncStatus");
  const body = app.slice(start, app.indexOf("async function runLineSyncAction", start));
  assert.match(body, /title = "Synced"/);
  assert.match(body, /Saved line settings are synced/);
  assert.match(body, /title = "Pending changes"/);
  assert.match(body, /title = "Error"/);
  assert.match(body, /title = "Not connected"/);
  assert.match(body, /This device is using local data only\./);
  assert.match(body, /Last connected sync:/);
  assert.match(body, /Local Resin\.Tools data was preserved\./);
});

test("joining is disabled until a four-character code is valid and duplicate sync actions are guarded", () => {
  assert.match(app, /\!\/\^\[A-Z0-9\]\{4\}\$\/\.test\(code\.trim\(\)\)/);
  assert.match(app, /if \(lineSyncActionInFlight\) return;/);
  assert.match(app, /lineSyncRetryMobileLabel.*Refreshing…/s);
  assert.match(app, /join\.textContent = busy && action === "join" \? "Joining…"/);
});

test("mobile styling is scoped so desktop RT Sync keeps its fuller interface", () => {
  assert.match(styles, /@media \(max-width: 900px\), \(min-width: 901px\) and \(pointer: coarse\)\{[\s\S]*\.lineSyncPanel \.mobileLineSyncStatus/s);
  assert.match(styles, /\.lineSyncPanel:not\(\.mobileConnected\) #lineSyncDisconnectBtn\{display:none\}/);
  assert.match(styles, /\.lineSyncPanel #lineSyncLeaveBtn\{color:var\(--bad\)\}/);
  assert.match(styles, /\.mobileLineSyncStatus\[data-state="synced"\]/);
});
