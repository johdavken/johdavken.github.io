"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");
const styles = fs.readFileSync("styles.css","utf8");

test("Appearance is replaced by a compact Display sheet",()=>{
  assert.doesNotMatch(html,/mobileAppearanceTile|statusPreferences|densitySel/);
  assert.match(html,/id="displaySheet"/);
  assert.match(html,/id="appFooterDisplay"[^>]*aria-label="Display settings"/);
  assert.match(html,/id="themeSel"[\s\S]*?>Light<[\s\S]*?>Dark<[\s\S]*?>Gruvbox</);
  assert.match(html,/id="timeFormatSel"/);
  assert.match(app,/function openDisplaySheet\(event\)/);
  assert.doesNotMatch(html,/displaySheetClose|Close display settings/);
  assert.match(html,/id="displaySheet" class="footerSheet displaySheet"[^>]*aria-modal="true"/);
});

test("footer sheets share backdrop, toggle, Escape, and focus-return behavior",()=>{
  assert.match(html,/id="footerSheetBackdrop"/);
  assert.match(app,/function closeFooterSheets\(\{ returnFocus = true \} = \{\}\)/);
  assert.match(app,/requestAnimationFrame\(\(\)=>focusTarget\.focus\(\)\)/);
  assert.match(app,/event\.key === "Escape"/);
  assert.match(app,/event\.key === "Tab"/);
  assert.match(app,/footerSheetFocusable/);
  assert.match(app,/footerSheetBackdrop"\)\?\.addEventListener\("click"/);
  assert.match(app,/sheet\.show\(\)/);
  assert.doesNotMatch(app,/sheet\?\.showModal/);
});

test("desktop-only surface style remains available because it still has real layout behavior",()=>{
  assert.match(html,/class="desktopDisplaySettings"[\s\S]*?id="surfaceStyleSel"/);
  assert.match(styles,/@media \(width <= 900px\)[\s\S]*?\.desktopDisplaySettings\{display:none\}/);
});
