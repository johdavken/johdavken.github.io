"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("shortcuts live in the persistent footer menu with accessible labels",()=>{
  assert.doesNotMatch(html,/mobileQuickActionsToggle|mobileQuickActionsMenu/);
  assert.match(html,/id="appFooterShortcuts"[^>]*aria-expanded="false"[^>]*aria-controls="footerShortcutsMenu"/);
  assert.match(html,/id="footerShortcutsMenu" class="footerSheet footerDockMenu"[^>]*aria-modal="true"/);
  assert.match(html,/Production Summary/);
  assert.match(html,/Scan Dosing Screen/);
  assert.match(styles,/\.footerDockMenu\{/);
});

test("shortcut actions preserve the existing scan and tool navigation flows",()=>{
  assert.match(app,/PolynRecipeScanUI\?\.startScan\("dosing_screen"\)/);
  assert.match(app,/setWorkspacePanel\("toolsBlock", \{ reveal: true \}\);\s*selectToolPanel\("productionSummaryTool"\);/);
  assert.match(app,/setMobileQuickActionsOpen\(false\)/);
});
