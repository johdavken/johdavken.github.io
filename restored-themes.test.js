"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const theme = fs.readFileSync("theme.css", "utf8");

for (const [id, scheme] of [
  ["rose-pine", "dark"],
  ["rose-pine-dawn", "light"],
  ["everforest", "dark"],
  ["everforest-light", "light"]
]) {
  test(`${id} retains its complete ${scheme} palette`, () => {
    const start = theme.indexOf(`:where(html, body)[data-theme="${id}"]{`);
    assert.notEqual(start, -1);
    const palette = theme.slice(start, theme.indexOf("\n}", start) + 2);
    assert.match(palette, new RegExp(`color-scheme: ${scheme};`));
    for (const token of ["--bg:", "--panel:", "--text:", "--title:", "--muted:", "--border:", "--focus-border:", "--footer-bg:"]) {
      assert.match(palette, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
}
