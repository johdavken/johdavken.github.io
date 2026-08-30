"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const theme = fs.readFileSync("theme.css", "utf8");

test("OLED Black, Vaporwave, and Rosé Pine Dark are touch-only Display choices", () => {
  const select = html.slice(html.indexOf('<select id="themeSel">'), html.indexOf("</select>", html.indexOf('<select id="themeSel">')));
  for (const value of ["oled-black", "vaporwave", "rose-pine"]) {
    assert.match(select, new RegExp(`<option value="${value}" data-touch-only-theme>`));
  }
  assert.match(app, /const touchOnlyThemePreferences = new Set\(\["oled-black", "vaporwave", "rose-pine"\]\);/);
  assert.match(app, /option\.hidden = !touchLayout;\s*\n\s*option\.disabled = !touchLayout;/);
  assert.match(app, /!touchLayout && touchOnlyThemePreferences\.has\(preference\)\s*\n\s*\? "industrial-slate"/);
});

test("Vaporwave has a complete dark neon palette and touch-native background", () => {
  const start = theme.indexOf(':where(html, body)[data-theme="vaporwave"]{');
  assert.notEqual(start, -1);
  const palette = theme.slice(start, theme.indexOf("\n}", start) + 2);
  for (const token of ["color-scheme: dark;", "--bg:", "--panel:", "--text:", "--title:", "--focus-border:", "--footer-bg:"]) {
    assert.match(palette, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(styles, /body\[data-theme="vaporwave"\]\[data-mobile-background-style="theme-native"\]\{/);
});
