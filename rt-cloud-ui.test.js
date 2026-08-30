"use strict";

// RT Cloud UI wiring + markup + isolation. String-level checks in the style
// of notes-ui.test.js (there is no DOM here). The behavioural state machine
// is covered by rt-cloud.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const ui = fs.readFileSync("rt-cloud-ui.js", "utf8");
const svc = fs.readFileSync("rt-cloud.js", "utf8");
const notesUi = fs.readFileSync("notes-ui.js", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const activeJob = fs.readFileSync("active-job.js", "utf8");

/* -------------------------------------------------------------------- *
 *   Script load order
 * ------------------------------------------------------------------ */

test("crypto + service load before the RT Cloud UI, and after notes-ui.js", () => {
  const notes = html.indexOf('src="notes-ui.js');
  const crypto = html.indexOf('src="rt-cloud-crypto.js');
  const service = html.indexOf('src="rt-cloud.js');
  const cloudUi = html.indexOf('src="rt-cloud-ui.js');
  assert.ok(notes !== -1 && crypto !== -1 && service !== -1 && cloudUi !== -1);
  assert.ok(notes < crypto && crypto < service && service < cloudUi, "order: notes-ui -> crypto -> service -> ui");
  assert.match(html, /src="rt-cloud-crypto\.js\?v=[^"]+" defer/);
});

/* -------------------------------------------------------------------- *
 *   Backup dialog: RT CLOUD section + sub-dialogs
 * ------------------------------------------------------------------ */

test("the RT CLOUD block lives inside the existing Backup dialog and keeps local backup", () => {
  const dlgStart = html.indexOf('id="notesBackupDialog"');
  const dlgEnd = html.indexOf("</dialog>", dlgStart);
  const dlg = html.slice(dlgStart, dlgEnd);
  // Local export/import still present.
  assert.match(dlg, /id="notesExportBtn"[^>]*>Export RT Notes</);
  assert.match(dlg, /id="notesImportFile"/);
  // RT Cloud section + its controls.
  assert.match(dlg, /id="notesCloud"[^>]*data-rt-cloud-state="off"/);
  assert.match(dlg, /id="notesCloudEnableBtn"[^>]*>Enable RT Cloud</);
  assert.match(dlg, /id="notesCloudBackupNowBtn"[^>]*>Back up now</);
  assert.match(dlg, /id="notesCloudViewCodeBtn"[^>]*>View recovery code</);
  assert.match(dlg, /id="notesCloudRestoreBtn"[^>]*>Restore from RT Cloud</);
  assert.match(dlg, /id="notesCloudTurnOffBtn"[^>]*>Turn off backups</);
  assert.match(dlg, /id="notesCloudDeleteBtn"[^>]*>Delete cloud backup</);
});

test("the three RT Cloud sub-dialogs are native <dialog> (Android Back closes them first)", () => {
  for (const id of ["notesCloudCodeDialog", "notesCloudRestoreDialog", "notesCloudDeleteDialog"]) {
    assert.match(html, new RegExp(`<dialog id="${id}"`), `${id} is a <dialog>`);
  }
  // handleAndroidBack already closes the topmost open <dialog> generically.
  assert.match(app, /function handleAndroidBack\(\)\{[\s\S]*?document\.querySelector\("dialog\[open\]"\)/);
});

test("first-time recovery-code screen requires an explicit acknowledgement", () => {
  assert.match(html, /id="notesCloudAckCheck"/);
  assert.match(html, /id="notesCloudCodeDoneBtn"[^>]*disabled/);
  // Done stays disabled until the ack box is checked.
  assert.match(ui, /ackCheck\.addEventListener\("change", \(\) => \{\s*if \(codeDoneBtn\) codeDoneBtn\.disabled = !ackCheck\.checked;/);
  // The warning wording is present.
  assert.match(html, /Save this recovery code somewhere safe\. You will need it to restore RT Notes/);
});

test("the recovery code is only copied on an explicit tap - never automatically", () => {
  // Exactly one clipboard write call, inside copyRecoveryCode, wired to the Copy button.
  const writes = ui.match(/clipboard\.writeText\(/g) || [];
  assert.equal(writes.length, 1);
  assert.match(ui, /function copyRecoveryCode\(\)\s*\{[\s\S]*?clipboard\.writeText/);
  assert.match(ui, /codeCopyBtn\.addEventListener\("click", copyRecoveryCode\)/);
  // Not called on open / render / enable.
  assert.doesNotMatch(ui, /openCodeDialog[\s\S]{0,400}clipboard\.writeText/);
});

test("Delete cloud backup needs a typed DELETE confirmation", () => {
  assert.match(html, /id="notesCloudDeleteConfirmInput"/);
  assert.match(html, /id="notesCloudDeleteConfirmBtn"[^>]*disabled/);
  assert.match(ui, /deleteConfirmInput\.value\.trim\(\)\.toUpperCase\(\) !== "DELETE"/);
});

/* -------------------------------------------------------------------- *
 *   Restore flow
 * ------------------------------------------------------------------ */

test("restore offers Replace vs Import, and a single Restore for an empty notebook", () => {
  assert.match(ui, /service\.restore\(restoreInput \? restoreInput\.value : ""\)/);
  assert.match(ui, /applyRestore\("replace"\)/);
  assert.match(ui, /applyRestore\("import"\)/);
  assert.match(ui, /pendingRestore\.applyReplace\(\)/);
  assert.match(ui, /pendingRestore\.applyImport\(\)/);
  // Empty local notebook -> hide Import, relabel Replace.
  assert.match(ui, /if \(existing === 0\) \{[\s\S]*?restoreImportBtn\.hidden = true;[\s\S]*?"Restore RT Notes"/);
  // A restore refreshes the visible list through the store's own UI.
  assert.match(ui, /NotesUI\.refresh\(\)/);
});

/* -------------------------------------------------------------------- *
 *   notes-ui.js integration hook
 * ------------------------------------------------------------------ */

test("notes-ui.js exposes a change hook and shared store, and fires it after every committed mutation", () => {
  assert.match(notesUi, /root\.PolynNotesUI = \{/);
  assert.match(notesUi, /getStore: \(\) => store/);
  assert.match(notesUi, /onChange: \(fn\) => \{/);
  // notifyNotesChanged is invoked on create / edit-commit / delete / pin / move / folder / import.
  for (const kind of ['"create"', '"edit"', '"delete"', '"pin"', '"move"', '"folder"', '"import"']) {
    assert.match(notesUi, new RegExp(`notifyNotesChanged\\(${kind}\\)`), `fires for ${kind}`);
  }
  // The RT Cloud UI subscribes to it.
  assert.match(ui, /NotesUI\.onChange\(\(\) => service\.noteChanged\(\)\)/);
});

/* -------------------------------------------------------------------- *
 *   Privacy wording
 * ------------------------------------------------------------------ */

test("device hint keeps the OFF wording while off, and the ON wording never says 'sync'", () => {
  // The static OFF hint in index.html is unchanged.
  assert.match(html, /id="notesDeviceHint"[^>]*>RT Notes are stored on this device only\. They don.{0,10}t sync with RT Sync/);
  // rt-cloud-ui swaps it only when enabled.
  assert.match(ui, /DEVICE_HINT_ON\s*=\s*\n?\s*"RT Notes stay private to this device\. An encrypted recovery backup is stored in RT Cloud\.";/);
  const onLine = ui.match(/DEVICE_HINT_ON\s*=\s*\n?\s*"([^"]+)"/)[1];
  assert.ok(!/sync/i.test(onLine), "the ON wording must not use the word 'sync'");
  assert.match(ui, /s\.enabled \? DEVICE_HINT_ON : DEVICE_HINT_OFF/);
});

test("changelog documents RT Cloud as recovery, not sync", () => {
  // The v1.1.23 heading may fold in other features shipped the same release;
  // it just has to name RT Cloud.
  assert.match(html, /<h3>\(v1\.1\.23\)[^<]*RT Cloud[^<]*<\/h3>/);
  assert.match(html, /New <strong>RT Cloud<\/strong> option/);
  assert.match(html, /This is recovery, not sync\./);
});

/* -------------------------------------------------------------------- *
 *   Isolation from RT Sync / app state
 * ------------------------------------------------------------------ */

test("RT Cloud never enters an app snapshot, active job, or RT Sync settings", () => {
  const snap = app.slice(app.indexOf("function snapshotPayload("), app.indexOf("function snapshotPayload(") + 6000);
  assert.doesNotMatch(snap, /rt.?cloud|rtCloud|rt_notes_cloud/i);
  assert.doesNotMatch(activeJob, /rt.?cloud|rtCloud/i);
  // The UI and service never read/write RT Sync's settings key or localStorage.
  assert.doesNotMatch(ui, /polyn\.lineSync\.settings|localStorage/);
  assert.doesNotMatch(svc, /polyn\.lineSync\.settings|localStorage/);
});

test("RT Cloud UI opens no Realtime channel and no Supabase client", () => {
  assert.doesNotMatch(ui, /\.channel\s*\(|\.subscribe\s*\(\s*\)|createClient\s*\(|RealtimeChannel/);
  // The one onStatus() call is the service's own status listener, not Supabase Realtime.
  assert.match(ui, /service\.onStatus\(render\)/);
});

test("RT Sync Device ID / RT User ID are passed only as optional diagnostics", () => {
  assert.match(ui, /getDiagnostics: \(\) => \{/);
  assert.match(ui, /PolynRtSyncBridge && root\.PolynRtSyncBridge\.getRecoveryDescriptor\(\)/);
  // Diagnostics are wrapped so their absence is harmless, and they are never
  // awaited on or required.
  assert.match(ui, /return \{ deviceId: d\.deviceId \|\| "", rtUserId: d\.userId \|\| "" \};/);
  assert.match(svc, /never required, never authoritative for recovery/);
});

/* -------------------------------------------------------------------- *
 *   Styling hooks exist
 * ------------------------------------------------------------------ */

test("styles.css carries the RT Cloud section styles", () => {
  assert.match(css, /\.notesCloud\{/);
  assert.match(css, /\.notesCloudBadge\{/);
  assert.match(css, /\.notesCloud\[data-rt-cloud-state="on"\] \.notesCloudBadge/);
  assert.match(css, /\.notesCloudCode\{/);
});
