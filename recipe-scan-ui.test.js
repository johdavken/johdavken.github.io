"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const ui = fs.readFileSync("recipe-scan-ui.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

test("bails out entirely when the app.js bridge isn't present, matching the workspace-recovery-ui.js convention", () => {
  assert.match(ui, /const serviceApi = root\.PolynRecipeScanBridge;/);
  assert.match(ui, /if \(!serviceApi\) return;/);
});

test("scanning is refused with a clear message when no workspace is connected - no local-only path", () => {
  const fnStart = ui.indexOf("function startScan(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /if \(!serviceApi\.getWorkspaceId\(\)\)\{/);
  assert.match(body, /alert\(/);
});

test("the orientation dialog is skipped for a 1-layer line, but required otherwise", () => {
  const fnStart = ui.indexOf("function startScan(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /const lineType = Number\(serviceApi\.getLineType\(\)\);/);
  assert.match(body, /if \(lineType === 1\) openCaptureDialog\(\);\s*\n\s*else openOrientationDialog\(\);/);
});

test("orientation dialog only proceeds on an explicit inside/outside choice, not cancel or a stray close", () => {
  const fnStart = ui.indexOf("function openOrientationDialog(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /if \(value === "inside" \|\| value === "outside"\)\{/);
});

test("submitFile guards against a second submission while one is already in flight", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /if \(!file \|\| scanInFlight\) return;/);
  assert.match(body, /scanInFlight = true;/);
  // scanInFlight must be set to true before any await, so a second call sees it immediately
  const guardIndex = body.indexOf("scanInFlight = true;");
  const firstAwaitIndex = body.indexOf("await ");
  assert.ok(guardIndex < firstAwaitIndex, "scanInFlight must be set before the first await");
});

test("submitFile validates the image client-side before ever calling the Edge Function", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  const validateIndex = body.indexOf("schema()?.validateImage?.(");
  const fetchIndex = body.indexOf("fetch(");
  assert.ok(validateIndex !== -1 && fetchIndex !== -1 && validateIndex < fetchIndex);
});

test("the Edge Function is called with a fresh access token, the workspace id, a request id, and the image - matching index.ts's contract", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /const token = await serviceApi\.getAccessToken\(\);/);
  assert.match(body, /form\.append\("workspace_id", serviceApi\.getWorkspaceId\(\)\);/);
  assert.match(body, /form\.append\("request_id", requestId\);/);
  assert.match(body, /form\.append\("image", file\);/);
  assert.match(body, /fetch\(`\$\{base\}\/functions\/v1\/recipe-scan`, \{/);
  assert.match(body, /Authorization: `Bearer \$\{token\}`/);
  assert.match(body, /method: "POST"/);
});

test("a missing access token is treated as not-ready and blocks the request, rather than sending an unauthenticated call", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /if \(!token\)\{[\s\S]{0,150}scanInFlight = false;\s*\n\s*return;/);
});

test("a layer-count mismatch from the mapping function surfaces its own message and never reaches the review dialog", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /if \(!built\?\.ok\)\{/);
  assert.match(body, /setStatus\("recipeScanCaptureStatus", built\?\.message \|\| "This scan could not be applied\.", true\);/);
  const rejectIndex = body.indexOf('if (!built?.ok)');
  const openReviewIndex = body.indexOf("openReviewDialog();");
  assert.ok(rejectIndex < openReviewIndex, "the rejection check must come before opening the review dialog");
});

test("applyReview delegates to the bridge's applyScannedRecipe with the sanitized scan and chosen orientation - no separate mutation logic", () => {
  const fnStart = ui.indexOf("function applyReview(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /serviceApi\.applyScannedRecipe\(pendingScan, pendingOrientation\)/);
});

test("the review screen warns before overwriting an existing non-empty recipe", () => {
  const fnStart = ui.indexOf("function renderReview(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /serviceApi\.hasNonEmptyRecipe\?\.\(\)/);
  assert.match(body, /This will overwrite your current recipe assignments/);
});

test("Retake reopens the capture dialog without discarding the chosen orientation", () => {
  const fnStart = ui.indexOf("function retakeScan(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.doesNotMatch(body, /pendingOrientation\s*=/, "retake must not reset pendingOrientation");
  assert.match(body, /openCaptureDialog\(\);/);
});

test("Cancel from the review dialog fully resets pending scan state", () => {
  const fnStart = ui.indexOf("function cancelReview(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /resetPendingScan\(\);/);
});

test("every dialog action button and file input is wired exactly once at the bottom of the module", () => {
  assert.match(ui, /\$\("recipeScanJobTravelerBtn"\)\?\.addEventListener\("click", startScan\);/);
  assert.match(ui, /\$\("recipeScanCameraBtn"\)\?\.addEventListener\("click", \(\) => \$\("recipeScanCameraInput"\)\?\.click\(\)\);/);
  assert.match(ui, /\$\("recipeScanGalleryBtn"\)\?\.addEventListener\("click", \(\) => \$\("recipeScanGalleryInput"\)\?\.click\(\)\);/);
  assert.match(ui, /\$\("recipeScanCameraInput"\)\?\.addEventListener\("change", event => submitFile\(event\.target\.files\?\.\[0\]\)\);/);
  assert.match(ui, /\$\("recipeScanGalleryInput"\)\?\.addEventListener\("change", event => submitFile\(event\.target\.files\?\.\[0\]\)\);/);
  assert.match(ui, /\$\("recipeScanReviewApplyBtn"\)\?\.addEventListener\("click", applyReview\);/);
});

// --- index.html: camera vs gallery inputs, dialogs present --------------

test("the capture dialog has two distinct file inputs - camera capture and gallery, per the requested 2-function capture", () => {
  assert.match(index, /<input id="recipeScanCameraInput" type="file" accept="image\/\*" capture="environment" hidden \/>/);
  assert.match(index, /<input id="recipeScanGalleryInput" type="file" accept="image\/\*" hidden \/>/);
});

test("all three recipe-scan dialogs exist in index.html", () => {
  assert.match(index, /<dialog id="recipeScanOrientationDialog"/);
  assert.match(index, /<dialog id="recipeScanCaptureDialog"/);
  assert.match(index, /<dialog id="recipeScanReviewDialog"/);
});

test("recipe-scan-ui.js loads after app.js, so window.PolynRecipeScanBridge already exists when it runs", () => {
  const appIndex = index.indexOf('src="app.js');
  const uiIndex = index.indexOf('src="recipe-scan-ui.js');
  assert.ok(appIndex !== -1 && uiIndex !== -1 && appIndex < uiIndex);
});
