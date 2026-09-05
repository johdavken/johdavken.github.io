"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n    function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

const render = functionBody("renderSplitsArea");

test("Display settings expose an accessible Left/Top recipe-header preference", () => {
  const sheet = html.slice(html.indexOf('<dialog id="displaySheet"'), html.indexOf('</dialog>', html.indexOf('<dialog id="displaySheet"')));
  assert.match(sheet, /<label for="recipeLayerOrientationSel"[^>]*>Recipe layer headers/);
  assert.match(sheet, /<select id="recipeLayerOrientationSel" aria-describedby="recipeLayerOrientationHelp">/);
  assert.match(sheet, /<option value="left" selected>Left<\/option>/);
  assert.match(sheet, /<option value="top">Top<\/option>/);
});

test("orientation defaults left and persists only in its device-local display key", () => {
  assert.match(app, /recipeLayerOrientation: "left"/);
  assert.match(app, /const LS_RECIPE_LAYER_ORIENTATION_KEY = "resinTimer\.recipeLayerOrientation\.v0\.01";/);
  assert.match(functionBody("saveRecipeLayerOrientation"), /localStorage\.setItem\(LS_RECIPE_LAYER_ORIENTATION_KEY, state\.recipeLayerOrientation\)/);
  assert.match(functionBody("loadRecipeLayerOrientation"), /localStorage\.getItem\(LS_RECIPE_LAYER_ORIENTATION_KEY\)/);

  const sessionSnapshot = functionBody("snapshotPayload");
  assert.doesNotMatch(sessionSnapshot, /recipeLayerOrientation/);
  assert.doesNotMatch(fs.readFileSync("active-job.js", "utf8"), /recipeLayerOrientation/);
});

test("changing orientation rerenders presentation without saving or syncing recipe data", () => {
  const apply = functionBody("applyRecipeLayerOrientation");
  assert.match(apply, /if \(render\) renderSplitsArea\(\);/);
  assert.doesNotMatch(apply, /saveSession|validateAndCompute|notifyActiveJobMutation|commitNextRecipeWorking/);

  assert.match(app, /applyRecipeLayerOrientation\(e\.target\.value, \{ render: true, persist: true \}\);/);
});

test("one shared hopper-cell builder is used for both matrix orientations", () => {
  assert.match(render, /const layersLeft = reworkedGrid && state\.recipeLayerOrientation !== "top";/);
  assert.match(render, /area\.dataset\.recipeOrientation = layersLeft \? "left" : "top";/);
  assert.match(render, /function buildCell\(L, li, hi\)/);
  assert.match(render, /if \(layersLeft\)\{[\s\S]*?tr\.appendChild\(buildLayerHeader\(L\)\);[\s\S]*?tr\.appendChild\(buildCell\(L, li, hi\)\)/);
  assert.match(render, /else\{[\s\S]*?headerRow\.appendChild\(buildLayerHeader\(L\)\)[\s\S]*?tr\.appendChild\(buildPositionHeader\(hi\)\);[\s\S]*?tr\.appendChild\(buildCell\(L, li, hi\)\)/);
  assert.match(render, /th\.scope = layersLeft \? "row" : "col";/);
  assert.match(render, /rowHeader\.scope = layersLeft \? "col" : "row";/);
});

test("Current and Next feed the same orientation renderer without transposing recipe data", () => {
  assert.match(functionBody("recipeLayers"), /return isNextRecipePage\(\) \? ensureNextRecipeWorking\(\) : state\.layers;/);
  assert.doesNotMatch(render, /state\.layers\s*=|nextRecipeWorking\s*=|\.reverse\(|\.sort\(/);
  assert.match(render, /const hopper = L\.hoppers\[hi\];/);
  assert.match(render, /const key = `\$\{L\.name\}:\$\{hi\}`;/);
});

test("Layers Top shares the existing outer rail and flexes 1, 3, or 5 layer columns within it", () => {
  assert.match(styles, /data-recipe-orientation="top"\] \.splitsMatrixFrame\{[\s\S]*?width:min\(100%, var\(--recipe-five-layer-rail, 1062px\)\);[\s\S]*?max-width:100%;/);
  assert.match(styles, /data-recipe-orientation="top"\] \.splitsMatrix\{[\s\S]*?table-layout:fixed;[\s\S]*?width:100%;[\s\S]*?min-width:0;/);
  assert.match(styles, /data-recipe-orientation="top"\] \.splitsMatrix thead th,[\s\S]*?data-recipe-orientation="top"\] \.splitMatrixCell\{[\s\S]*?min-width:0;[\s\S]*?width:auto;/);
  assert.doesNotMatch(styles, /data-recipe-orientation="top"[^\{]*\{[^}]*grid-template-columns:\s*repeat\([135],/);
});

test("compact phone retains its established matrix while tablet and desktop honor the preference", () => {
  assert.match(render, /const layersLeft = reworkedGrid && state\.recipeLayerOrientation !== "top";/);
  assert.match(styles, /@media \(max-width:700px\)\{\s*\.recipeLayerOrientationField\{display:none!important\}/);
});
