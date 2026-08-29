"use strict";

// Mobile-only icon guide in the Recipe panel: an "i" in the summary bar,
// opposite the RECIPE title. Tapping it drops a legend (down + to the left)
// naming every tab / action icon that replaces a text label on phones -
// Current, Next, Weights, Recipe Book, Scan, Load Next, Load Current, Edit,
// Weights profile. It is a <details> nested inside #splitsBlock's own
// <summary>, so its summary click must not bubble out and toggle the panel.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function recipeSummary(){
  const block = html.indexOf('id="splitsBlock"');
  const start = html.indexOf("<summary>", block);
  const end = html.indexOf("</summary>", start);
  assert.ok(start > -1 && end > start);
  return html.slice(start, end);
}

function legendMarkup(){
  const s = html.indexOf('<details class="recipeInfoLegend"');
  const e = html.indexOf("</details>", s);
  assert.ok(s > -1 && e > s, "expected #recipeInfoLegend markup");
  return html.slice(s, e);
}

/* -------------------------------------------------------------------
 *   Placement: in the Recipe summary bar, after the status pill
 * ------------------------------------------------------------------- */

test("the guide is a <details id=\"recipeInfoLegend\"> in the Recipe panel's summary, after #splitsSummaryStatus", () => {
  const summary = recipeSummary();
  const pillAt = summary.indexOf('id="splitsSummaryStatus"');
  const legendAt = summary.indexOf('id="recipeInfoLegend"');
  assert.ok(pillAt > -1 && legendAt > pillAt, "legend sits opposite the title, after the status pill");
  assert.match(summary, /<details class="recipeInfoLegend" id="recipeInfoLegend">/);
  assert.match(summary, /<summary aria-label="What the icons mean"[^>]*><svg/);
});

/* -------------------------------------------------------------------
 *   Legend contents: one row per icon, icon + description
 * ------------------------------------------------------------------- */

test("the legend covers all nine icons, each with an SVG and a description", () => {
  const legend = legendMarkup();
  const items = legend.match(/<li>[\s\S]*?<\/li>/g) || [];
  assert.equal(items.length, 9, "one row per icon");
  for (const name of ["Current", "Next", "Weights", "Recipe Book", "Scan", "Load Next", "Load Current", "Edit", "Weights profile"]){
    assert.ok(
      items.some(li => li.includes(`<strong>${name}</strong>`) && /<span class="recipeInfoLegendIcon"><svg/.test(li) && li.replace(/<[^>]+>/g, "").trim().length > name.length + 6),
      `row for "${name}" with an icon and a description`
    );
  }
});

test("legend icons reuse the real tab / action icon paths", () => {
  const legend = legendMarkup();
  // Current tab's document glyph
  assert.ok(legend.includes('d="M7 3.5h7L18.5 8v12.5h-11z"'));
  // Weights profile clipboard glyph (also on #mobileWeightProfilesButton)
  assert.ok(legend.includes('d="M8 5H6.5A1.5 1.5 0 0 0 5 6.5v13'));
  // Edit pencil glyph (also the ::before mask)
  assert.ok(legend.includes('d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"'));
});

/* -------------------------------------------------------------------
 *   CSS: desktop-hidden, phone-shown, drops down + right-aligned
 * ------------------------------------------------------------------- */

test("hidden at desktop widths, shown only <=700px", () => {
  assert.match(styles, /\.recipeInfoLegend\{ display: none; position: relative;/);
  const mStart = styles.indexOf("@media (max-width: 700px){");
  const mobile = styles.slice(mStart, styles.indexOf("@media (max-width: 720px){", mStart));
  assert.match(mobile, /#splitsBlock \.recipeInfoLegend\{ display: block; \}/);
});

test("the panel drops downward and hugs the right edge (opens to the left)", () => {
  const rule = styles.slice(styles.indexOf(".recipeInfoLegendPanel{"), styles.indexOf("}", styles.indexOf(".recipeInfoLegendPanel{")));
  assert.match(rule, /position: absolute;/);
  assert.match(rule, /top: calc\(100% \+ 6px\);/);
  assert.match(rule, /right: 0;/);
  assert.match(rule, /max-height:/);
  assert.match(rule, /overflow-y: auto;/);
});

/* -------------------------------------------------------------------
 *   Behaviour: never toggles the panel; closes on outside click / Escape
 * ------------------------------------------------------------------- */

test("hookRecipeInfoLegend stops the summary click from bubbling to the panel <summary>", () => {
  assert.match(app, /function hookRecipeInfoLegend\(\)\{[\s\S]*?querySelector\(":scope > summary"\)\?\.addEventListener\("click", event=>\{\s*\n\s*event\.stopPropagation\(\);/);
  assert.match(app, /hookRecipeInfoLegend\(\);/);
});

test("an outside click and Escape close the guide, mirroring the Scan popup", () => {
  assert.match(app, /const infoLegend = document\.getElementById\("recipeInfoLegend"\);\s*\n\s*if \(infoLegend\?\.open && !infoLegend\.contains\(event\.target\)\) infoLegend\.open = false;/);
  assert.match(app, /if \(event\.key === "Escape" && infoLegend\?\.open\)\{\s*\n\s*infoLegend\.open = false;/);
});

test("the guide's open state is not persisted (not in DETAILS_IDS)", () => {
  const idsBlock = app.slice(app.indexOf("DETAILS_IDS"), app.indexOf("]", app.indexOf("DETAILS_IDS")) + 1);
  assert.doesNotMatch(idsBlock, /recipeInfoLegend/);
});
