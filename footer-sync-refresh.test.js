"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("the mobile footer sync status is a real button, not a div - native tap/keyboard support for free", () => {
  assert.match(index, /<button type="button" id="cloudSyncFooterStatus" class="appDockControl cloudSyncFooterStatus" data-state="local-only" aria-live="polite" aria-label="RT Sync status - tap to refresh and apply any unsynced changes">/);
  assert.doesNotMatch(index, /<div id="cloudSyncFooterStatus"/);
});

test("tapping the footer status triggers the same reconnect/refresh action as the RT Sync panel's Reconnect button - flush pending changes if a line is selected, retry the connection otherwise", () => {
  const handlerStart = app.indexOf('$("cloudSyncFooterStatus")?.addEventListener("click",');
  assert.notEqual(handlerStart, -1, "expected a click handler wired on cloudSyncFooterStatus");
  const handlerEnd = app.indexOf("));", handlerStart);
  const body = app.slice(handlerStart, handlerEnd);
  assert.match(body, /runLineSyncAction\(\(\)=>/);
  assert.match(body, /lineSync\.getState\(\)\.selectedWorkspaceId/);
  assert.match(body, /\? lineSync\.refreshSelected\(\)/);
  assert.match(body, /: lineSync\.retry\(\)/);
});

test("the footer button's click handler is wrapped in runLineSyncAction, matching every other RT Sync action's error handling", () => {
  const handlerStart = app.indexOf('$("cloudSyncFooterStatus")?.addEventListener("click",');
  const handlerEnd = app.indexOf("));", handlerStart);
  const body = app.slice(handlerStart, handlerEnd);
  assert.match(body, /runLineSyncAction\(/);
});

test("sync is integrated as the fifth text-only status cell with distinct status colors", () => {
  assert.match(styles,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\) minmax\(68px,\.9fr\)/);
  assert.match(index,/<span>Refresh<\/span><strong id="lineSyncMobileStatus">Local only<\/strong>/);
  assert.match(styles,/\.cloudSyncFooterStatus\[data-state="synced"\]\{color:var\(--ok\)\}/);
  assert.match(styles,/\.cloudSyncFooterStatus\[data-state="error"\]\{color:var\(--bad\)\}/);
});
