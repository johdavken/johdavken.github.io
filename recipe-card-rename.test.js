"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");

// The Recipe Setup card/panel is titled just "Recipe" now, on both the
// desktop sidebar nav label and the shared card title (.layerTitle, used
// as both the mobile accordion title and the desktop in-panel header).
// Everywhere else "Recipe Setup" appears (Help text, Changelog, the
// printed recipe sheet's own heading, aria-labels) is describing the
// feature/page by its full name, not this on-screen title, and is
// untouched.

test("the desktop sidebar nav label for the Recipe Setup panel reads just \"Recipe\"", () => {
  const start = html.indexOf('data-workspace-target="splitsBlock"');
  assert.notEqual(start, -1);
  const tag = html.slice(start, html.indexOf("</button>", start));
  assert.match(tag, /<span>(?:<svg[^>]*>[\s\S]*?<\/svg>)?Recipe<\/span>/);
  assert.doesNotMatch(tag, />Recipe Setup</);
});

test("the shared card title (mobile accordion / desktop in-panel header) reads just \"Recipe\"", () => {
  const start = html.indexOf('id="splitsBlock"');
  const summaryEnd = html.indexOf("</summary>", start);
  const summary = html.slice(start, summaryEnd);
  assert.match(summary, /<div class="layerTitle" role="heading" aria-level="1">Recipe<\/div>/);
  assert.doesNotMatch(summary, />Recipe Setup</);
  // The subtitle itself is untouched - only the title shortened.
  assert.match(summary, /Set recipe percentages and choose which hoppers appear in the timeline/);
});

test("the printed recipe sheet's own heading keeps a full descriptive name - a different context (a physical document), not this on-screen title", () => {
  const app = fs.readFileSync("app.js", "utf8");
  // Now names the page the sheet came from, so a plan carried to the line is
  // never mistaken for the recipe being run.
  assert.match(app, /title\.textContent = recipePageLabel\(\);/);
  assert.match(app, /function recipePageLabel\(destination=null\)\{ return \(destination \? destination==="next" : isNextRecipePage\(\)\) \? "Next Recipe" : "Current Recipe"; \}/);
});
