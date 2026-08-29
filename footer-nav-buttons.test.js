"use strict";

// Concept 7 - "Back + Home, Forward on demand" - in the mobile footer.
// The behavioural stack is unit-tested in mobile-nav-history.test.js; this
// file guards the wiring: the markup, the mobile-only CSS contract, and the
// fact that walking history never persists a preference or touches the RT
// Sync outbox.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const footer = html.slice(html.indexOf('<footer class="footerBar"'), html.indexOf("</footer>"));

test("the pure history module loads before app.js", () => {
  const nav = html.indexOf('src="mobile-nav-history.js');
  const main = html.indexOf('src="app.js');
  assert.ok(nav > -1, "mobile-nav-history.js is referenced");
  assert.ok(nav < main, "it loads ahead of app.js");
});

test("Back and Forward sit either side of Main, both starting disabled", () => {
  const order = ["appFooterDisplay", "appFooterBack", "appFooterMain", "appFooterForward", "appFooterNotifications"]
    .map(id => footer.indexOf(`id="${id}"`));
  assert.ok(order.every(i => i > -1), "all five controls present");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "Display / Back / Main / Forward / Alerts");

  assert.match(footer, /id="appFooterBack" class="appDockControl appDockNav" aria-label="Go back" disabled/);
  assert.match(footer, /id="appFooterForward" class="appDockControl appDockNav" aria-label="Go forward" disabled/);
});

test("the footer grid grows to five cells only in the compact (mobile) block", () => {
  const compact = styles.slice(styles.lastIndexOf("/* Compact footer:"));
  assert.match(compact, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  // Desktop still collapses the whole bar (display:contents + hide-all).
  const desktop = styles.slice(styles.indexOf("@media (min-width:901px) and (pointer: fine){"));
  assert.match(desktop, /\.footerBar\{display:contents\}/);
  assert.match(desktop, /\.footerBar > :not\(\.footerAccountHost\)\{display:none!important\}/);
});

test("the new controls join the icon-show and clipped-label lists", () => {
  assert.match(styles, /#appFooterDisplay svg,#appFooterBack svg,#appFooterMain svg,#appFooterForward svg,#appFooterNotifications svg\{/);
  assert.match(styles, /#appFooterBack > span,[\s\S]*?#appFooterForward > span,[\s\S]*?clip-path:inset\(50%\)/);
  assert.match(styles, /\.appDockNav:disabled\{opacity:\.32;pointer-events:none\}/);
});

test("clicks are wired to the history walkers", () => {
  assert.match(app, /\$\("appFooterBack"\)\?\.addEventListener\("click", goMobileNavBack\)/);
  assert.match(app, /\$\("appFooterForward"\)\?\.addEventListener\("click", goMobileNavForward\)/);
  assert.match(app, /setupMobileNavHistory\(\);/);
});

test("history is captured from live nav state, applied through the same nav functions", () => {
  const start = app.indexOf("function captureMobileNavState()");
  const end = app.indexOf("function setupMobileNavHistory()");
  const block = app.slice(start, end);

  // Descriptor is derived, never a stored hopper/recipe/runtime object.
  assert.match(block, /document\.body\.dataset\.mobileWorkspace === "panel"/);
  assert.match(block, /activeWorkspaceId/);
  assert.match(block, /document\.body\.dataset\.mobileTools === "panel"/);

  // Applying a remembered view reuses showMobileWorkspaceHome /
  // setWorkspacePanel, and setWorkspacePanel is told not to persist.
  assert.match(block, /showMobileWorkspaceHome\(\)/);
  assert.match(block, /setWorkspacePanel\(state\.panelId, \{ persist: false \}\)/);
});

test("walking history cannot re-enter Recipe/Timeline edit persistence or the sync outbox", () => {
  const start = app.indexOf("function applyMobileNavState(state)");
  const block = app.slice(start, app.indexOf("function goMobileNavBack()"));
  assert.doesNotMatch(block, /saveWorkspacePreference|persist: true|enqueue|outbox|pushMutation|cloudSync/i);
  assert.match(block, /applyingMobileNav = true/);
  assert.match(block, /applyingMobileNav = false/);
});

test("the footer history resets when the shell switches to desktop", () => {
  const start = app.indexOf("function syncWorkspaceForViewport()");
  const block = app.slice(start, app.indexOf("}", app.indexOf("syncToggleUI(\"mobileRecipeToggle\"", start)));
  assert.match(block, /mobileNavHistory\?\.reset\(\)/);
  assert.match(block, /recordMobileNavState\(\)/);
});

test("Android hardware Back keeps its own richer contextual handler", () => {
  // concept 7 is a footer feature; handleAndroidBack must be untouched by it.
  const start = app.indexOf("function handleAndroidBack()");
  const block = app.slice(start, app.indexOf("window.handleAndroidBack = handleAndroidBack"));
  assert.doesNotMatch(block, /mobileNavHistory|goMobileNavBack/);
});
