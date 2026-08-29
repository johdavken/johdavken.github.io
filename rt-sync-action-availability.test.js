"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

function slice(from, to){
  const start = app.indexOf(from);
  const end = app.indexOf(to, start);
  assert.ok(start > -1 && end > start, `expected to find ${from}`);
  return app.slice(start, end);
}

/* ============================================================
 *   RT Sync panel controls disabling themselves permanently
 *
 *   Reported from the floor: the panel read "RT Sync Synced / RT Sync is
 *   up to date", the line was connected, and Generate Link Code, Rename
 *   line, New job and Disconnect were all dead. Only Connect/retry and
 *   Join still worked.
 *
 *   Those two were the tell. Every one of these buttons is disabled by
 *   `lineSyncActionInFlight || ...`, but the assignment only ran during the
 *   panel render, which is driven by sync state changes rather than by the
 *   flag. An action that starts and finishes with no state change in
 *   between - Generate Link Code on an already up-to-date line - gets
 *   rendered once while the flag is true and then clears the flag with no
 *   render left to undo the disable. Refresh and Join escaped only because
 *   setLineSyncActionBusy happened to re-enable those two by hand.
 * ============================================================ */

test("the available operator actions get their disabled state from one shared pass, not from the render alone", () => {
  const helper = slice("function applyLineSyncActionAvailability(", "function setLineSyncActionBusy(");
  ["lineSyncGenerateCodeBtn", "lineSyncGenerateNewCodeBtn", "lineSyncCopyCodeBtn"].forEach(id=>{
    assert.match(helper, new RegExp(`"${id}"`));
  });
  assert.match(helper, /\["lineSyncRetryBtn", "lineSyncRetryMobileBtn"\]/);
  // Join's own availability has an extra condition (a well-formed code), so
  // it stays in its own function - but it belongs to the same pass.
  assert.match(helper, /updateLineSyncJoinAvailability\(syncState\);/);
});

test("finishing an action re-applies availability immediately - it does not wait for a render that may never come", () => {
  const busy = slice("function setLineSyncActionBusy(", "function formatLineSyncTimestamp(");
  assert.match(busy, /lineSyncActionInFlight = busy;/);
  assert.match(busy, /applyLineSyncActionAvailability\(\);/);
  // The old hand-rolled re-enable for this one button is what masked the
  // bug for Refresh; with the shared pass it must not linger as a second
  // source of truth.
  assert.doesNotMatch(busy, /refresh\.disabled = busy;/);
});

test("the panel render delegates rather than keeping its own copy of the disabled rules", () => {
  const render = slice("function renderLineSync(syncState){", "function openRtSyncJoinFromUrl()");
  assert.match(render, /applyLineSyncActionAvailability\(syncState\);/);
  assert.doesNotMatch(render, /\.disabled = lineSyncActionInFlight/);
});

test("the helper reads live sync state when called without one, so the busy path needs no plumbing", () => {
  assert.match(app, /function applyLineSyncActionAvailability\(syncState = lineSync\?\.getState\?\.\(\) \|\| \{\}\)\{/);
});

/* ============================================================
 *   The conflict dialog as a storm engine
 * ============================================================ */

const conflict = () => slice("function resolveLineSyncConflict(", "function replaceSavedConfigsFromSync(");

test("a second conflict arriving while the dialog is already open pauses instead of throwing", () => {
  // showModal() raises InvalidStateError on an open dialog. Raised inside
  // the Promise executor that used to wrap it, that became a rejection,
  // which reaches flushActiveJob's catch as an ordinary upload failure -
  // leaving the change queued to retry into the same conflict again.
  assert.match(conflict(), /if \(dialog\.open\) return Promise\.resolve\("cancel"\);/);
  assert.match(conflict(), /try\{\s*\n\s*dialog\.showModal\(\);\s*\n\s*\}catch\{/);
});

test("no dialog to ask with pauses too - it never answers 'remote' on the operator's behalf", () => {
  // "remote" discards this device's unsynced work without anyone seeing the
  // choice, and a discard is not a pause, so the same conflict is free to
  // regenerate immediately.
  assert.match(conflict(), /if \(!dialog\?\.showModal\) return Promise\.resolve\("cancel"\);/);
  assert.doesNotMatch(conflict(), /Promise\.resolve\("remote"\)/);
});

test("a returnValue left over from an earlier conflict cannot answer the next one", () => {
  // Dismissing with Escape sets no returnValue, so a stale "local" would
  // otherwise silently re-upload local work the operator never re-chose.
  const body = conflict();
  assert.match(body, /dialog\.returnValue = "";/);
  assert.ok(body.indexOf('dialog.returnValue = "";') < body.indexOf("dialog.showModal()"),
    "the reset must happen before the dialog is shown");
});
