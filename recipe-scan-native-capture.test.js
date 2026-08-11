"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const ui = fs.readFileSync("recipe-scan-ui.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

// Root cause (see the feature's own diagnosis notes, and
// recipe-scan-edge-function.test.js's ALLOWED_ORIGINS tests): the Android
// app's photo picker has no camera option, and even Choose Photo failed
// because the Edge Function's CORS allowlist didn't include the bundled
// app's real origin. This file covers the client-side fix: an explicit
// native Take Photo/Choose Photo choice, sharing the exact same
// submitFile() the web file input already uses.

function functionBody(name){
  const start = ui.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = ui.indexOf("\n  function ", start + 1);
  return ui.slice(start, next === -1 ? undefined : next);
}

test("native detection uses Capacitor.isNativePlatform(), not mere existence of window.Capacitor", () => {
  assert.match(ui, /function isNativePlatform\(\)\{ return !!root\.Capacitor\?\.isNativePlatform\?\.\(\); \}/);
});

test("no Capacitor Camera script is vendored or loaded - native already provides Plugins.Camera on its own, same as Plugins.App", () => {
  assert.doesNotMatch(index, /vendor\/capacitor-camera/i);
  assert.equal(fs.existsSync("vendor/capacitor-camera.js"), false);
  assert.match(ui, /function nativeCamera\(\)\{ return root\.Capacitor\?\.Plugins\?\.Camera \|\| null; \}/);
});

test("the capture dialog has separate web and native button rows, native hidden by default so it never flashes on the ordinary website", () => {
  const dialogStart = index.indexOf('id="recipeScanCaptureDialog"');
  const dialogEnd = index.indexOf("</dialog>", dialogStart);
  const body = index.slice(dialogStart, dialogEnd);
  assert.match(body, /id="recipeScanCaptureWebRow"><button id="recipeScanCaptureBtn" type="button">Scan<\/button>/);
  assert.match(body, /id="recipeScanCaptureNativeRow" hidden>/);
  assert.match(body, /id="recipeScanTakePhotoBtn" type="button">Take Photo<\/button>/);
  assert.match(body, /id="recipeScanChoosePhotoBtn" type="button" class="secondary">Choose Photo<\/button>/);
});

test("the web Scan button and file input are completely unchanged - still a plain <input type=file>, still wired to submitFile directly", () => {
  assert.match(index, /<input id="recipeScanCaptureInput" type="file" accept="image\/\*" hidden \/>/);
  assert.match(ui, /\$\("recipeScanCaptureBtn"\)\?\.addEventListener\("click", \(\) => \$\("recipeScanCaptureInput"\)\?\.click\(\)\);/);
  assert.match(ui, /\$\("recipeScanCaptureInput"\)\?\.addEventListener\("change", event => submitFile\(event\.target\.files\?\.\[0\]\)\);/);
});

test("openCaptureDialog shows exactly one row - native XOR web, never both, decided fresh every time the dialog opens", () => {
  const body = functionBody("openCaptureDialog");
  assert.match(body, /const native = isNativePlatform\(\);/);
  assert.match(body, /if \(webRow\) webRow\.hidden = native;/);
  assert.match(body, /if \(nativeRow\) nativeRow\.hidden = !native;/);
});

test("Take Photo calls the current Capacitor 8 API (takePhoto), not the deprecated getPhoto, and never saves to the gallery", () => {
  const body = functionBody("captureFromNativeCamera");
  assert.match(body, /await Camera\.takePhoto\(\{\}\);/);
  assert.doesNotMatch(ui, /\.getPhoto\(/);
  assert.doesNotMatch(ui, /saveToGallery:\s*true/);
});

test("Choose Photo calls the current Capacitor 8 API (chooseFromGallery), not the deprecated pickImages/getPhoto", () => {
  const body = functionBody("captureFromNativeGallery");
  assert.match(body, /await Camera\.chooseFromGallery\(\{\}\);/);
  assert.doesNotMatch(ui, /\.pickImages\(/);
});

test("both native capture paths feed the exact same submitFile() the web input uses - no second OCR request implementation", () => {
  const cameraBody = functionBody("captureFromNativeCamera");
  const galleryBody = functionBody("captureFromNativeGallery");
  assert.match(cameraBody, /await submitCapturedMedia\(result\);/);
  assert.match(galleryBody, /await submitCapturedMedia\(first\);/);
  const submitCapturedBody = functionBody("submitCapturedMedia");
  assert.match(submitCapturedBody, /await submitFile\(file\);/);
  // Only one function in the whole file builds the recipe-scan FormData/fetch.
  assert.equal((ui.match(/functions\/v1\/recipe-scan/g) || []).length, 1);
});

test("mediaResultToFile prefers webPath, builds a File with a MIME-matched extension, and never invents a resize step that doesn't exist elsewhere in this app", () => {
  const body = functionBody("mediaResultToFile");
  assert.match(body, /const path = result\?\.webPath \|\| result\?\.uri;/);
  assert.match(body, /const blob = await response\.blob\(\);/);
  assert.match(body, /const extension = mimeType === "image\/png" \? "png" : "jpg";/);
  assert.doesNotMatch(ui, /canvas|drawImage|createImageBitmap/i, "no client-side resize/compression was invented - none existed before this change");
});

test("a cancelled capture/picker returns quietly - no error status shown, matching 'Cancel returns safely without an error'", () => {
  const cameraBody = functionBody("captureFromNativeCamera");
  const galleryBody = functionBody("captureFromNativeGallery");
  assert.match(cameraBody, /if \(isCaptureCancelledError\(error\)\) return;/);
  assert.match(galleryBody, /if \(isCaptureCancelledError\(error\)\) return;/);
});

test("appRestoredResult is registered so a process death during native capture (Android killing this app while its Camera activity is foregrounded) isn't silently lost", () => {
  assert.match(ui, /function registerNativeAppRestoredResult\(\)\{/);
  const body = functionBody("registerNativeAppRestoredResult");
  assert.match(body, /App\.addListener\("appRestoredResult", async \(data\) => \{/);
  assert.match(body, /const context = readNativeCaptureContext\(\);/);
  assert.match(body, /await submitCapturedMedia\(data\.data\);/);
  assert.match(ui, /registerNativeAppRestoredResult\(\);/);
});

test("capture context is persisted only around takePhoto (the long-running native activity), not chooseFromGallery", () => {
  const cameraBody = functionBody("captureFromNativeCamera");
  const galleryBody = functionBody("captureFromNativeGallery");
  assert.match(cameraBody, /persistNativeCaptureContext\(\);/);
  assert.doesNotMatch(galleryBody, /persistNativeCaptureContext\(\);/);
});

// --- distinguishable error categories (submitFile) ---

test("submitFile distinguishes six failure categories, each with its own actionable message and console diagnostic - never one generic catch-all", () => {
  const body = functionBody("submitFile");
  assert.match(body, /That photo couldn't be read\. Try a different photo\./, "1: unable to read image");
  assert.match(body, /imageCheck\.error/, "2: unsupported image, from the existing validateImage checks");
  assert.match(body, /Your RT Sync session isn't ready yet/, "3: authentication not ready");
  assert.match(body, /Couldn't reach the scan service\. Check your connection and try again\./, "4: network unavailable (online)");
  assert.match(body, /You're offline\. Reconnect and try again\./, "4: network unavailable (offline)");
  assert.match(body, /response\.status === 401/, "5: authentication failure from the server");
  assert.match(body, /response\.status >= 500/, "5: OCR service failure");
  assert.match(body, /The scan service returned an unexpected response\. Try again\./, "6: invalid OCR response");
});

test("every distinct submitFile failure branch logs the real technical detail via console.error before showing a generic user-facing message", () => {
  const body = functionBody("submitFile");
  const errorLogs = body.match(/console\.error\(/g) || [];
  assert.ok(errorLogs.length >= 4, `expected several distinct console.error calls, found ${errorLogs.length}`);
});

test("a CORS-blocked fetch and a true offline failure are indistinguishable to JS by design, so the offline message is only shown when navigator.onLine actually says so - not assumed", () => {
  const body = functionBody("submitFile");
  assert.match(body, /const offline = typeof navigator !== "undefined" && navigator\.onLine === false;/);
});
