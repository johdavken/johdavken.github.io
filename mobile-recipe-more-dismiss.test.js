"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

test("the mobile Recipe More menu closes when an operator taps outside it", () => {
  const renderStart = app.indexOf("function renderSplitsArea(){");
  const moduleScope = app.slice(0, renderStart);
  assert.match(moduleScope, /let mobileRecipeMore = null;/);
  assert.match(moduleScope, /if \(mobileRecipeMore\?\.open && !mobileRecipeMore\.contains\(event\.target\)\) mobileRecipeMore\.open = false;/);
});

test("the current mobile More menu is registered once per Recipe render and also closes on Escape", () => {
  const renderStart = app.indexOf("function renderSplitsArea(){");
  const render = app.slice(renderStart);
  assert.match(render, /mobileRecipeMore = mobileMoreButton;/);
  const moduleScope = app.slice(0, renderStart);
  assert.match(moduleScope, /if \(event\.key === "Escape" && mobileRecipeMore\?\.open\)/);
  assert.match(moduleScope, /mobileRecipeMore\.querySelector\(":scope > summary"\)\?\.focus\(\);/);
});
