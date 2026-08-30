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
  assert.match(html, /Enter the four-letter code of the workspace you wish to join\./);
  assert.match(html, /id="lineSyncRetryMobileLabel">Refresh now/);
  assert.match(html, /id="lineSyncLeaveBtn" class="secondary actionRail" type="button">Leave RT Sync/);
});

test("mobile RT Sync has an operator connection reference using the shared info-guide behavior", () => {
  assert.match(html, /id="lineSyncInfoGuide"/);
  assert.match(html, /Connecting to RT Sync/);
  assert.match(html, /AT THE LINE WORKSTATION/i);
  assert.match(html, /GENERATE NEW CODE/);
  assert.match(html, /Link codes are one-time codes and remain available for 30 minutes\./);
  assert.match(styles, /#lineSyncBlock \.lineSyncInfoGuide\{ display: block; \}/);
  assert.match(styles, /\.lineSyncInfoGuide > summary\{ color: var\(--ok\); \}/);
  assert.match(app, /lineSyncInfoGuide\?\.open && !lineSyncInfoGuide\.contains\(event\.target\)/);
  assert.match(app, /function hookLineSyncInfoGuide\(\)/);
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
  assert.match(html, /id="lineSyncRetryMobileBtn" class="secondary actionRail"/);
  assert.match(styles, /\.lineSyncPanel:not\(\.mobileHasLine\) \.lineSyncMobileLeave\{ display:none; \}/);
  assert.match(styles, /\.lineSyncMobileLeave #lineSyncLeaveBtn\{width:100%;/);
  assert.match(app, /lineSync\.leaveWorkspace\(\), "leave"/);
  assert.match(app, /Local Resin\.Tools data will remain\./);
  assert.match(html, /id="desktopLineSyncMain" class="desktopSyncOnly/);
  assert.match(styles, /@media \(max-width: 900px\), \(min-width: 901px\) and \(pointer: coarse\)\{[\s\S]*\.lineSyncPanel \.mobileLineSyncStatus/s);
  assert.match(styles, /\.lineSyncMobileRefresh #lineSyncRetryMobileBtn\{width:100%;/);
  assert.match(styles, /\.mobileLineSyncStatus\[data-state="synced"\]/);
});
