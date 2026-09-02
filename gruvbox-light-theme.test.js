"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const theme = fs.readFileSync("theme.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

test("Gruvbox Light is a persistent, selectable theme", () => {
  assert.match(html, /<option value="gruvbox-light">Gruvbox Light<\/option>/);
  assert.match(app, /\["gruvbox-light", "gruvbox-light"\]/);
});

test("Gruvbox Light follows the traditional light0 paper palette and muted accents", () => {
  const palette = theme.slice(theme.indexOf('[data-theme="gruvbox-light"]'), theme.indexOf('/* ----------------------------------------------------------------------- * Nord'));
  assert.match(palette, /--bg: #fbf1c7;/);
  assert.match(palette, /--desktop-canvas-bg: #fbf1c7;/);
  assert.match(palette, /--panel: rgba\(251,241,199,.96\);/);
  assert.match(palette, /--text: #3c3836;/);
  assert.match(palette, /--title: #3c3836;/);
  assert.match(palette, /--focus-border: rgba\(69,88,129,.88\);/);
  assert.doesNotMatch(palette, /#splitsBlock[\s\S]*?\)\{ color: #fbf1c7; \}/);
});

test("Gruvbox themes no longer render the side-rail GRUVBOX watermark", () => {
  assert.doesNotMatch(desktop, /content:"GRUVBOX";/);
});
