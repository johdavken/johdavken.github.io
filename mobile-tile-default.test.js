"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js","utf8");
const html = fs.readFileSync("index.html","utf8");

test("minimal is the default mobile tile appearance",()=>{
  assert.match(app,/mobileTileStyle: "minimal"/);
  assert.match(app,/allowed\.has\(String\(value\)\) \? String\(value\) : "minimal"/);
  assert.match(app,/applyMobileTileStyle\(payload\.mobileTileStyle \|\| "minimal"\)/);
  assert.match(app,/applyMobileTileStyle\(state\.mobileTileStyle \|\| "minimal"\)/);

  const minimal = html.match(/<button[^>]+data-mobile-tile-style="minimal"[^>]*>/)?.[0] || "";
  const accent = html.match(/<button[^>]+data-mobile-tile-style="accent"[^>]*>/)?.[0] || "";
  assert.match(minimal,/aria-checked="true"/);
  assert.match(accent,/aria-checked="false"/);
});
