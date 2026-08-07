"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const cloudSync = fs.readFileSync("cloud-sync.js", "utf8");

function handlerBody(marker){
  const start = app.indexOf(marker);
  assert.notEqual(start, -1, `Expected to find ${marker}`);
  const end = app.indexOf("));", start) + 3;
  return app.slice(start, end);
}

const retryHandler = handlerBody('$("lineSyncRetryBtn")?.addEventListener("click"');

test("the Reconnect/Connect-retry button uses refreshSelected() whenever a line is selected, on both desktop and mobile", () => {
  assert.doesNotMatch(retryHandler, /matchMedia\("\(max-width: 900px\)"\)/,
    "the fix removes the mobile-only gate - desktop previously fell through to retry() even when a line was selected");
  assert.match(retryHandler, /lineSync\.getState\(\)\.selectedWorkspaceId\s*\?\s*lineSync\.refreshSelected\(\)\s*:\s*lineSync\.retry\(\)/);
});

test("retry() is still the fallback only when nothing is selected, and is otherwise untouched", () => {
  assert.match(retryHandler, /:\s*lineSync\.retry\(\)/);
  // retry() itself deliberately does NOT clear disconnectedWorkspaceIds -
  // that's correct for its other caller (auto-retry on tab visibility
  // change), which must not silently reconnect a line the operator
  // explicitly disconnected. Only this button's explicit-reconnect path
  // should override that.
  const retryFn = cloudSync.slice(cloudSync.indexOf("async function retry(){"), cloudSync.indexOf("async function refreshSelected(){"));
  assert.doesNotMatch(retryFn, /disconnectedWorkspaceIds/);
});

test("retry() is still what fires automatically on tab visibility change, now via the debounced autoRetry() wrapper (a later, separate fix for a retry-storm on flaky connections) - this reconnect-button fix didn't touch that path", () => {
  assert.match(cloudSync, /document\.addEventListener\("visibilitychange", \(\)=>\{ if \(!document\.hidden\) autoRetry\(\); \}\);/);
  assert.match(cloudSync, /function autoRetry\(\)\{[^}]*retry\(\);[^}]*\}/s);
});

test("refreshSelected() clears the disconnected flag before reconciling - the actual mechanism the fix now exercises on desktop too", () => {
  const refreshSelectedFn = cloudSync.slice(
    cloudSync.indexOf("async function refreshSelected(){"),
    cloudSync.indexOf("function getWorkspaceConfigurationTransport(){")
  );
  assert.match(refreshSelectedFn, /disconnectedWorkspaceIds = current\.disconnectedWorkspaceIds\.filter\(id=>id !== selectedId\(\)\)/);
  assert.match(refreshSelectedFn, /await reconcileSelected\(\{ forceRemote: true \}\)/);
});
