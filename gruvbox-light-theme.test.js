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

test("Gruvbox Light uses warm paper surfaces and dark, readable ink app-wide", () => {
  const palette = theme.slice(theme.indexOf('[data-theme="gruvbox-light"]'), theme.indexOf('/* ----------------------------------------------------------------------- * Nord'));
  assert.match(palette, /--bg: #ece7d8;/);
  assert.match(palette, /--desktop-canvas-bg: #ece7d8;/);
  assert.match(palette, /--panel: rgba\(249,245,233,.94\);/);
  assert.match(palette, /--text: #383329;/);
  assert.match(palette, /--title: #383329;/);
  assert.match(palette, /--focus-border: rgba\(113,98,67,.88\);/);
  assert.doesNotMatch(palette, /#splitsBlock[\s\S]*?\)\{ color: #fbf1c7; \}/);
});

test("Gruvbox Light retains the Gruvbox side-rail watermark", () => {
  assert.match(desktop, /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\]\) \.workspaceNav::after/);
  assert.match(desktop, /content:"GRUVBOX";/);
});
