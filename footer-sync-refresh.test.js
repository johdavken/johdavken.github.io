"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("the mobile footer sync status is a real button, not a div - native tap/keyboard support for free", () => {
  assert.match(index, /<button type="button" id="cloudSyncFooterStatus" class="cloudSyncFooterStatus" data-state="local-only" aria-live="polite" aria-label="RT Sync status - tap to refresh and apply any unsynced changes">/);
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

test("button-chrome CSS is reset (no default border/background) while the existing visual divider and layout are preserved", () => {
  const ruleStart = styles.indexOf(".cloudSyncFooterStatus{");
  const ruleEnd = styles.indexOf("}", ruleStart);
  const rule = styles.slice(ruleStart, ruleEnd);
  assert.match(rule, /background:\s*none;/);
  assert.match(rule, /cursor:\s*pointer;/);
  assert.match(rule, /border-left:\s*1px solid var\(--footer-border\);/);
});
