"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const theme = fs.readFileSync("theme.css", "utf8");

for (const [id, scheme] of [
  ["rose-pine", "dark"],
  ["rose-pine-dawn", "light"],
  ["everforest", "dark"],
  ["newsprint", "light"],
  ["ayu-light", "light"]
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

test("Newsprint's accent palette is muted by 25% without losing its editorial red", () => {
  const start = theme.indexOf(':where(html, body)[data-theme="newsprint"]{');
  const palette = theme.slice(start, theme.indexOf("\n}", start) + 2);
  assert.match(palette, /--subtitle: #743735;/);
  assert.match(palette, /--yellow: #936831;/);
  assert.match(palette, /--orange: #8e4a3e;/);
  assert.match(palette, /--bad: #8f3c39;/);
  assert.match(palette, /--ok: #526655;/);
  assert.match(palette, /--focus-border: rgba\(55,74,90,\.86\);/);
  assert.match(palette, /--newsprint-rail-recipe: #805055;/);
  assert.match(palette, /--newsprint-rail-timeline: #64747c;/);
  assert.match(palette, /--newsprint-rail-totals: #657254;/);
});
