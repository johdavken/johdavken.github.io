"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const theme = fs.readFileSync("theme.css", "utf8");

test("System Auto remains the saved preference while resolving the live OS scheme", () => {
  assert.match(app, /globalThis\.matchMedia\?\.\("\(prefers-color-scheme: dark\)"\)/);
  assert.match(app, /preference === "system"[\s\S]*?systemColorScheme\?\.matches \? "industrial-slate-dark" : "industrial-slate"/);
  assert.match(app, /if \(sel\) sel\.value = preference;/);
  assert.match(app, /state\.theme = preference;/);
  assert.match(app, /if \(state\.theme === "system"\) applyTheme\("system"\);/);
  assert.match(app, /systemColorScheme\.addEventListener\("change", handleSystemColorSchemeChange\)/);
});

test("OLED Black is a complete true-black theme", () => {
  const start = theme.indexOf(':where(html, body)[data-theme="oled-black"]{');
  assert.notEqual(start, -1);
  const palette = theme.slice(start, theme.indexOf("\n}", start) + 2);
  assert.match(palette, /color-scheme: dark;/);
  assert.match(palette, /--bg: #000000;/);
  assert.match(palette, /--panel: #000000;/);
  assert.match(palette, /--footer-bg: #000000;/);
  assert.match(palette, /--shadow2: none;/);
  for (const token of ["--text:", "--muted:", "--border:", "--focus-border:", "--ok:", "--warn:", "--bad:"]) {
    assert.match(palette, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("System Auto, OLED Black, and Nord are exposed in Display", () => {
  const select = html.slice(html.indexOf('<select id="themeSel">'), html.indexOf("</select>", html.indexOf('<select id="themeSel">')));
  for (const [value, label] of [["system", "System / Auto"], ["oled-black", "OLED Black"], ["nord", "Nord"]]) {
    assert.match(select, new RegExp(`<option value="${value}">${label.replace("/", "\\/")}<\\/option>`));
  }
});
