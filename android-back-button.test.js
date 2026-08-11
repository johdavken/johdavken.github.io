"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const backButtonJs = fs.readFileSync("android-back-button.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

// handleAndroidBack() is app.js's single explicit integration point for
// Android Back - reads this module's real state and calls its real
// close/exit functions, never generic DOM selectors. See its own comment
// in app.js for the full rationale (this replaced an earlier version that
// used details[open]:not(.workspacePanel), which was shown to silently
// consume Back on the Help screen because that selector can't distinguish
// a real transient popover from other open <details>).

function functionBody(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("the old generic details[open]:not(.workspacePanel) selector is gone from app.js", () => {
  assert.doesNotMatch(app, /details\[open\]:not\(\.workspacePanel\)/);
});

test("handleAndroidBack is defined once and exposed as the sole global entry point", () => {
  assert.match(app, /function handleAndroidBack\(\)\{/);
  assert.match(app, /window\.handleAndroidBack = handleAndroidBack;/);
  // Nothing else should be hung off window for this - the smallest
  // possible API is exactly this one function, not a broader object.
  assert.doesNotMatch(app, /window\.PolynAndroidBack\b/);
});

test("priority order: topmost dialog, then footer sheet, then Bulk Edit, then Rearrange, then Tool/Help/section, in that source order", () => {
  const body = functionBody("handleAndroidBack");
  const order = [
    'document.querySelector("dialog[open]")',
    "activeFooterSheetName",
    "weightsBulkModeActive",
    "splitsBulkModeActive",
    "hopperRearrangement?.active",
    'document.body.dataset.mobileWorkspace === "panel"'
  ].map(needle => {
    const index = body.indexOf(needle);
    assert.notEqual(index, -1, `Expected to find "${needle}" in handleAndroidBack`);
    return index;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "priority checks must appear in the requested order");
});

test("closes the topmost dialog through its own real .close(), not a generic details toggle", () => {
  const body = functionBody("handleAndroidBack");
  assert.match(body, /const dialog = document\.querySelector\("dialog\[open\]"\);\s*\n\s*if \(dialog\)\{ dialog\.close\(\); return true; \}/);
});

test("closes a footer sheet/menu through the existing PolynFooterSheetUI.close(), never a raw selector", () => {
  const body = functionBody("handleAndroidBack");
  assert.match(body, /if \(activeFooterSheetName\)\{ window\.PolynFooterSheetUI\.close\(\); return true; \}/);
  assert.match(app, /window\.PolynFooterSheetUI = \{ close:/);
});

test("exits Receiver Weights Bulk Edit (mobile and desktop) through the real setMobileWeightBulkMode/setDesktopBulkMode, not a duplicate implementation", () => {
  const body = functionBody("handleAndroidBack");
  assert.match(body, /if \(weightsBulkModeActive\)\{ exitWeightsBulkModeFn\?\.\(\); return true; \}/);
  assert.match(app, /exitWeightsBulkModeFn = \(\) => setMobileWeightBulkMode\(false\);/);
  assert.match(app, /exitWeightsBulkModeFn = \(\) => setDesktopBulkMode\(false\);/);
});

test("exits Recipe Setup Bulk Edit through the real setBulkMode, and Rearrange through the real finishRearrangement(cancelled=true)", () => {
  const body = functionBody("handleAndroidBack");
  assert.match(body, /if \(splitsBulkModeActive\)\{ exitSplitsBulkModeFn\?\.\(\); return true; \}/);
  assert.match(app, /exitSplitsBulkModeFn = \(\) => setBulkMode\(false\);/);
  assert.match(body, /if \(hopperRearrangement\?\.active\)\{ exitRearrangeModeFn\?\.\(\); return true; \}/);
  assert.match(app, /exitRearrangeModeFn = \(\) => finishRearrangement\(true\);/);
});

test("Tool->Tools and Help->Help reuse the existing mobileToolsBack/mobileHelpBack buttons via a real click, not duplicated navigation logic", () => {
  const body = functionBody("handleAndroidBack");
  assert.match(body, /activeWorkspaceId === "toolsBlock" && document\.body\.dataset\.mobileTools === "panel"/);
  assert.match(body, /\$\("mobileToolsBack"\)\?\.click\(\);/);
  assert.match(body, /activeWorkspaceId === "helpBlock" && document\.body\.dataset\.mobileHelp === "panel"/);
  assert.match(body, /\$\("mobileHelpBack"\)\?\.click\(\);/);
  // Both real buttons must actually exist and already have their own
  // handlers - handleAndroidBack must not be their only wiring.
  assert.match(app, /\$\("mobileToolsBack"\)\?\.addEventListener\("click"/);
  assert.match(app, /\$\("mobileHelpBack"\)\?\.addEventListener\("click"/);
});

test("section->Main falls back to the existing showMobileWorkspaceHome(), and only when a section is actually open", () => {
  const body = functionBody("handleAndroidBack");
  assert.match(body, /document\.body\.dataset\.mobileWorkspace === "panel"\)\{[\s\S]*showMobileWorkspaceHome\(\);\s*\n\s*return true;/);
});

test("returns false (never throws, never silently swallows) when nothing on this screen can be handled, so the caller knows to minimize", () => {
  const body = functionBody("handleAndroidBack");
  const fnEnd = body.indexOf("window.handleAndroidBack = handleAndroidBack;");
  assert.notEqual(fnEnd, -1);
  assert.match(body.slice(0, fnEnd), /return false;\s*\n\s*\}\s*\n\s*$/);
});

test("android-back-button.js gates all native behavior on Capacitor.isNativePlatform(), not mere existence of window.Capacitor", () => {
  assert.match(backButtonJs, /Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.doesNotMatch(backButtonJs, /if \(window\.Capacitor\)/);
  assert.doesNotMatch(backButtonJs, /if \(!window\.Capacitor\)/);
});

test("android-back-button.js delegates entirely to handleAndroidBack and only minimizes when it returns false", () => {
  assert.match(backButtonJs, /window\.handleAndroidBack\?\.\(\)/);
  assert.match(backButtonJs, /App\.minimizeApp\(\);/);
});

test("no Capacitor script is loaded in index.html - native already injects its own bridge, and loading one here would create window.Capacitor on plain web", () => {
  assert.doesNotMatch(html, /vendor\/capacitor-core\.js/);
  assert.doesNotMatch(html, /vendor\/capacitor-app\.js/);
  assert.match(html, /<script src="android-back-button\.js/);
});

test("the vendored Capacitor browser bundles were removed from the repo, not just unlinked", () => {
  assert.equal(fs.existsSync("vendor/capacitor-core.js"), false);
  assert.equal(fs.existsSync("vendor/capacitor-app.js"), false);
});
