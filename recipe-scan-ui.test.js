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

test("the orientation dialog is skipped for a 1-layer line or a dosing_screen scan", () => {
  const fnStart = ui.indexOf("function startScan(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /const lineType = Number\(serviceApi\.getLineType\(\)\);/);
  assert.match(body, /if \(sourceType === "dosing_screen" \|\| lineType === 1\)\{ openCaptureDialog\(\); return; \}/);
});

test("a multilayer scan takes its orientation from the connected line instead of asking the operator", () => {
  const fnStart = ui.indexOf("function startScan(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  // Read through the shared line configuration - never a layer-order rule of
  // this scanner's own, and never a per-source-type branch.
  assert.match(body, /serviceApi\.getLineConfiguration\?\.\(\)\?\.layerAPosition/);
  assert.doesNotMatch(body, /\b(?:inside|outside)\b\s*[:=]/, "startScan must not hard-code an orientation value");
  assert.doesNotMatch(body, /lineNumber\s*[><=]/, "startScan must not re-derive orientation from a line number range");
  const resolved = body.indexOf("if (orientation){");
  assert.ok(resolved > -1, "expected the resolved orientation to short-circuit the prompt");
  assert.ok(body.indexOf("pendingOrientation = orientation;", resolved) > -1);
  // The prompt survives only as the unmapped-line fallback, after the check.
  assert.ok(body.indexOf("openOrientationDialog();") > resolved, "the dialog must only be reachable once orientation could not be resolved");
});

test("neither Job Traveler nor Heat Sheet gets its own orientation path - both fall through the same shared resolution", () => {
  const fnStart = ui.indexOf("function startScan(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.doesNotMatch(body, /heat_sheet/, "heat_sheet must not be special-cased");
  assert.doesNotMatch(body, /job_traveler/, "job_traveler must not be special-cased");
  assert.equal((body.match(/getLineConfiguration/g) || []).length, 1, "orientation should be resolved exactly once, for every source type");
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
  assert.match(body, /form\.append\("source_type", pendingSourceType\);/);
  assert.match(body, /fetch\(`\$\{base\}\/functions\/v1\/recipe-scan`, \{/);
  assert.match(body, /Authorization: `Bearer \$\{token\}`/);
  assert.match(body, /method: "POST"/);
});

test("a missing access token is treated as not-ready and blocks the request, rather than sending an unauthenticated call", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /if \(!token\)\{[\s\S]{0,220}scanInFlight = false;\s*\n\s*return;/);
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

test("submitFile picks the mapping function based on pendingSourceType - dosing_screen never uses Job Traveler's orientation/fill-algorithm mapping", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /const buildFn = pendingSourceType === "dosing_screen"\s*\n\s*\? mapping\(\)\?\.buildDosingScreenRecipePayloadFromScan\s*\n\s*: mapping\(\)\?\.buildRecipePayloadFromScan;/);
});

test("openCaptureDialog sets the dialog's title/description from CAPTURE_COPY based on the active source type", () => {
  const fnStart = ui.indexOf("function openCaptureDialog(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /const copy = CAPTURE_COPY\[pendingSourceType\] \|\| CAPTURE_COPY\.job_traveler;/);
  assert.match(ui, /dosing_screen: \{\s*\n\s*title: "Scan Dosing Screen",/);
});

test("applyReview submits pendingPayload directly via the bridge's applyPayload - so review-screen edits are what actually get applied, not recomputed from the raw scan", () => {
  const fnStart = ui.indexOf("function applyReview(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /serviceApi\.applyPayload\(pendingPayload\)/);
});

test("submitFile passes the bridge's current hopper naming mode into the mapping call, so the applied payload matches this line's naming convention", () => {
  const fnStart = ui.indexOf("async function submitFile(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /hopperNamingMode: serviceApi\.getHopperNamingMode\?\.\(\)/);
});

test("layerPctNode renders an editable number input only when the layer's percentage is still estimated (missing, unsolvable) - not for scanned or derived values", () => {
  const fnStart = ui.indexOf("function layerPctNode(");
  const fnEnd = ui.indexOf("\n  function renderReview(", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /if \(layer\.layer_pct_estimated\)\{/);
  assert.match(body, /input\.type = "number";/);
  assert.match(body, /input\.min = "0";/);
  assert.match(body, /input\.max = "100";/);
});

test("editing the layer-percentage input writes straight into pendingPayload, so Apply submits the edited value", () => {
  const fnStart = ui.indexOf("function layerPctNode(");
  const fnEnd = ui.indexOf("\n  function renderReview(", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /input\.addEventListener\("input", \(\) => \{/);
  assert.match(body, /pendingPayload\.layers\[layerIndex\]\.layer_pct = Number\.isFinite\(value\) \? value : 0;/);
});

test("a derived layer percentage (auto-solved from the others) is shown as read-only text marked '(calculated)', distinct from a directly scanned value", () => {
  const fnStart = ui.indexOf("function layerPctNode(");
  const fnEnd = ui.indexOf("\n  function renderReview(", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /layer\.layer_pct_derived/);
  assert.match(body, /\(calculated\)/);
});

test("pressing Enter in a layer-percentage input advances focus to the next one instead of doing nothing - saves clicking/scrolling to each of up to 5 fields", () => {
  const fnStart = ui.indexOf("function renderReview(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /content\.querySelectorAll\("\.recipeScanReviewLayerPctInput input"\)/);
  assert.match(body, /if \(event\.key !== "Enter"\) return;/);
  assert.match(body, /event\.preventDefault\(\);/);
  assert.match(body, /const next = layerPctInputs\[index \+ 1\];/);
  assert.match(body, /if \(next\) next\.focus\(\);/);
  assert.match(body, /else input\.blur\(\);/);
});

test("the review screen warns before overwriting an existing non-empty recipe", () => {
  const fnStart = ui.indexOf("function renderReview(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /serviceApi\.hasNonEmptyRecipe\?\.\(\)/);
  // The warning names the page being overwritten, since a scan lands on
  // whichever recipe page is selected.
  assert.match(body, /This will overwrite the \$\{destination\.toLowerCase\(\)\} assignments\./);
});

test("the review screen states which recipe page the scan will be applied to", () => {
  const fnStart = ui.indexOf("function renderReview(");
  const body = ui.slice(fnStart, ui.indexOf("\n  }", fnStart));
  assert.match(body, /const destination = serviceApi\.getRecipePageLabel\?\.\(\) \|\| "Current Recipe";/);
  assert.match(body, /applyButton\.textContent = `Apply to \$\{destination\}`/);
  assert.match(body, /title\.textContent = `Review Scanned Recipe — \$\{destination\}`/);
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
  assert.match(ui, /\$\("recipeScanJobTravelerBtn"\)\?\.addEventListener\("click", \(\) => startScan\("job_traveler"\)\);/);
  assert.match(ui, /\$\("recipeScanDosingScreenBtn"\)\?\.addEventListener\("click", \(\) => startScan\("dosing_screen"\)\);/);
  assert.match(ui, /\$\("recipeScanHeatSheetBtn"\)\?\.addEventListener\("click", \(\) => startScan\("heat_sheet"\)\);/);
  assert.match(ui, /\$\("recipeScanCaptureBtn"\)\?\.addEventListener\("click", \(\) => \$\("recipeScanCaptureInput"\)\?\.click\(\)\);/);
  assert.match(ui, /\$\("recipeScanCaptureInput"\)\?\.addEventListener\("change", event => submitFile\(event\.target\.files\?\.\[0\]\)\);/);
  assert.match(ui, /\$\("recipeScanReviewApplyBtn"\)\?\.addEventListener\("click", applyReview\);/);
});

test("the mobile status-bar shortcut buttons call the exact same startScan entry point as the Tools panel buttons, not a parallel code path", () => {
  assert.match(ui, /function pickFromShortcut\(sourceType\)\{/);
  const fnStart = ui.indexOf("function pickFromShortcut(");
  const fnEnd = ui.indexOf("\n  }", fnStart);
  const body = ui.slice(fnStart, fnEnd);
  assert.match(body, /statusScanShortcut\.open = false;/);
  assert.match(body, /startScan\(sourceType\);/);
  assert.match(ui, /\$\("statusScanJobTravelerBtn"\)\?\.addEventListener\("click", \(\) => pickFromShortcut\("job_traveler"\)\);/);
  assert.match(ui, /\$\("statusScanDosingScreenBtn"\)\?\.addEventListener\("click", \(\) => pickFromShortcut\("dosing_screen"\)\);/);
  assert.match(ui, /\$\("statusScanHeatSheetBtn"\)\?\.addEventListener\("click", \(\) => pickFromShortcut\("heat_sheet"\)\);/);
});

test("the shortcut menu closes on an outside click and on Escape, same behavior as the existing appearance-preferences menu in app.js", () => {
  assert.match(ui, /if \(statusScanShortcut\?\.open && !statusScanShortcut\.contains\(event\.target\)\) statusScanShortcut\.open = false;/);
  assert.match(ui, /if \(event\.key === "Escape" && statusScanShortcut\?\.open\)\{/);
});

test("heat_sheet has its own CAPTURE_COPY entry while sharing Job Traveler's orientation resolution", () => {
  assert.match(ui, /heat_sheet: \{\s*\n\s*title: "Scan Heat Sheet",/);
});

// --- index.html: capture dialog structure --------------

test("the capture dialog has a single Scan button and file input - clicking either Take Photo or Choose from Gallery on Android already opens the same OS chooser, so two buttons were redundant", () => {
  assert.match(index, /<button id="recipeScanCaptureBtn" type="button">Scan<\/button>/);
  assert.match(index, /<input id="recipeScanCaptureInput" type="file" accept="image\/\*" hidden \/>/);
  assert.doesNotMatch(index, /recipeScanCameraInput|recipeScanGalleryInput/);
});

test("all three recipe-scan dialogs exist in index.html", () => {
  assert.match(index, /<dialog id="recipeScanOrientationDialog"/);
  assert.match(index, /<dialog id="recipeScanCaptureDialog"/);
  assert.match(index, /<dialog id="recipeScanReviewDialog"/);
});

test("the Heat Sheet scan button is enabled, matching Job Traveler and Dosing Screen", () => {
  assert.match(index, /<button id="recipeScanHeatSheetBtn" class="secondary" type="button">Scan Heat Sheet<\/button>/);
  assert.doesNotMatch(index, /recipeScanHeatSheetBtn"[^>]*disabled/);
});

test("recipe-scan-ui.js loads after app.js, so window.PolynRecipeScanBridge already exists when it runs", () => {
  const appIndex = index.indexOf('src="app.js');
  const uiIndex = index.indexOf('src="recipe-scan-ui.js');
  assert.ok(appIndex !== -1 && uiIndex !== -1 && appIndex < uiIndex);
});

test("startScan is exported so other entry points (Recipe Setup's own Scan Recipe shortcut) can trigger the same flow without duplicating its orientation/dialog logic", () => {
  assert.match(ui, /root\.PolynRecipeScanUI = \{ startScan \};/);
});
