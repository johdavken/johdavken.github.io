"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

// The mobile footer's Shortcuts action (Production Summary / Scan Dosing
// Screen) is gone: Production Summary is now a first-class main section
// (see mobile-tile-and-smart-placement.test.js) and Scan Dosing Screen
// remains reachable through the existing mobile status-bar scan shortcut
// and Recipe Setup itself. Shortcuts' footer slot is replaced by the
// notification bell, reusing the exact same dialog/data source as desktop.

test("Shortcuts is fully removed - no footer button, no sheet, no quick-action handlers, no dead wiring left behind", () => {
  assert.doesNotMatch(html, /appFooterShortcuts/);
  assert.doesNotMatch(html, /footerShortcutsMenu/);
  assert.doesNotMatch(html, /quickProductionSummaryBtn/);
  assert.doesNotMatch(html, /quickScanDosingScreenBtn/);
  assert.doesNotMatch(app, /appFooterShortcuts|footerShortcutsMenu|setMobileQuickActionsOpen|quickProductionSummaryBtn|quickScanDosingScreenBtn/);
  assert.doesNotMatch(styles, /footerShortcutsMenu/);
});

test("the mobile footer's notification bell sits in Shortcuts' old slot, between Display and Main", () => {
  const footer = html.slice(html.indexOf('<footer class="footerBar"'), html.indexOf("</footer>"));
  assert.match(footer, /id="appFooterNotifications" class="appDockControl mobileNotificationsToggle"/);
  const order = ["appFooterDisplay", "appFooterNotifications", "appFooterMain", "appFooterAccount", "cloudSyncFooterStatus"]
    .map(id => footer.indexOf(`id="${id}"`));
  assert.ok(order.every(index => index > -1));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test("the mobile bell uses the exact same bell icon markup as the desktop toggle", () => {
  const desktopIconStart = html.indexOf('id="desktopNotificationsToggle"');
  const desktopIcon = html.slice(html.indexOf("<svg", desktopIconStart), html.indexOf("</svg>", desktopIconStart) + 6);
  const mobileIconStart = html.indexOf('id="appFooterNotifications"');
  const mobileIcon = html.slice(html.indexOf("<svg", mobileIconStart), html.indexOf("</svg>", mobileIconStart) + 6);
  assert.equal(mobileIcon, desktopIcon);
});

test("the mobile bell carries its own severity/count badge, kept in sync with the desktop badge by the same renderAttentionCenter", () => {
  assert.match(html, /id="mobileNotificationsBadge" class="mobileNotificationsBadge" aria-hidden="true" hidden/);
  const start = app.indexOf("renderAttentionCenter = facts=>{");
  const body = app.slice(start, app.indexOf("toggle.addEventListener(\"click\"", start));
  assert.match(body, /mobileToggle\.dataset\.severity = summary\.severity;/);
  assert.match(body, /mobileBadge\.hidden = summary\.count === 0;/);
  assert.match(body, /mobileBadge\.textContent = summary\.count \? String\(summary\.count\) : "";/);
});

test("the mobile bell opens the exact same #footerNotificationsMenu dialog through the shared footer-sheet system - no separate mobile notification store", () => {
  assert.match(app, /mobileToggle\?\.addEventListener\("click",event=>\{\s*\n\s*event\.stopPropagation\(\);\s*\n\s*setFooterSheetOpen\("notifications", true, event\.currentTarget\);/);
  assert.match(html, /id="footerNotificationsMenu" class="desktopNotificationsMenu footerSheet"/);
  // Exactly one PolynAttentionCenter-driven list host, referenced by both triggers.
  assert.equal((html.match(/id="desktopNotificationsList"/g) || []).length, 1);
  assert.equal((app.match(/window\.PolynAttentionCenter/g) || []).length, 1);
});

test("desktop keeps its anchored nonmodal popover presentation; mobile gets the ordinary modal footerSheet bottom sheet - same dialog, viewport-driven presentation", () => {
  assert.match(app, /function isDesktopNotificationsPopover\(name = activeFooterSheetName\)\{\s*\n\s*return name === "notifications" && isDesktopLayout\(\);/);
  assert.doesNotMatch(styles, /@media \(width <= 900px\)\{ \.desktopNotificationsMenu\{display:none!important\} \}/);
});

test("Android Back closes the notification sheet before falling through to section navigation, via the existing generic footer-sheet branch - no bespoke notifications branch needed", () => {
  const start = app.indexOf("function handleAndroidBack(){");
  const body = app.slice(start, app.indexOf("window.handleAndroidBack = handleAndroidBack;", start));
  assert.match(body, /if \(activeFooterSheetName\)\{ window\.PolynFooterSheetUI\.close\(\); return true; \}/);
});
