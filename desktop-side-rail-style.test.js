"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

const railStyles = ["filled", "underline"];

test("Display exposes the two retained desktop-only side rail styles", () => {
  assert.match(html, /<label for="desktopRailStyleSel" class="desktopRailStyleField">Side Rail Style/);
  for (const style of railStyles) {
    assert.match(html, new RegExp(`<option value="${style}"`));
    assert.match(desktop, new RegExp(`data-desktop-rail-style="${style}"`));
  }
  assert.match(styles, /\.desktopRailStyleField\{display:none!important\}/);
});

test("side rail style persists locally and restores through the standard payload path", () => {
  assert.match(app, /desktopRailStyle: "filled"/);
  assert.match(app, /desktopRailStyle: state\.desktopRailStyle/);
  assert.match(app, /function applyDesktopRailStyle\(value\)/);
  assert.match(app, /applyDesktopRailStyle\(payload\.desktopRailStyle \|\| "filled"\)/);
  assert.match(app, /\$\("desktopRailStyleSel"\)\?\.addEventListener\("change"/);
});

test("retired rail styles safely migrate to Solid selected strip", () => {
  assert.match(app, /new Set\(\["filled", "underline"\]\)/);
  assert.doesNotMatch(html, /value="(?:inboard|spine|tab|pointer)"/);
  assert.doesNotMatch(desktop, /data-desktop-rail-style="(?:inboard|spine|tab|pointer)"/);
});
