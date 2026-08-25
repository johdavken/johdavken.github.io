"use strict";

// The desktop side rail gained the same numbered step markers the mobile
// tile home has carried: a small filled circle with the section's number,
// on Line Setup / Recipe / Timeline / Resin Totals only.
//
// "Match the mobile numbers" is the whole requirement, so the two surfaces
// must not merely look similar - they have to read the SAME tokens. That is
// what most of this file guards: --tile-accent (the per-section workflow
// colour) and Gruvbox's palette hues now live at top level instead of inside
// the mobile media block, so neither surface can drift from the other.
//
// The mobile marker itself is untouched; its own rules are asserted here
// only to prove they still exist unchanged.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const DESKTOP_QUERY = "@media (min-width: 901px) and (pointer: fine){";

/** The @media prelude a declaration block sits inside, or null at top level.
 *  Walks back from the rule counting brace depth, so it is not fooled by the
 *  many nested blocks between a rule and its query. */
function enclosingAtRule(needle){
  const at = styles.indexOf(needle);
  assert.notEqual(at, -1, `Expected to find ${needle}`);
  let depth = 0;
  for (let i = at; i > 0; i--){
    const ch = styles[i - 1];
    if (ch === "}") depth++;
    else if (ch === "{"){
      if (depth === 0){
        const start = styles.lastIndexOf("\n", i - 1);
        return styles.slice(start + 1, i).trim();
      }
      depth--;
    }
  }
  return null;
}

function ruleBody(selector){
  const at = styles.indexOf(selector);
  assert.notEqual(at, -1, `Expected rule ${selector}`);
  return styles.slice(at, styles.indexOf("}", at) + 1);
}

/* ----------------------------------------------------------------------
 *   The marker itself
 * -------------------------------------------------------------------- */

test("the rail marker is desktop-only, so it never doubles up with the mobile tile marker", () => {
  assert.equal(enclosingAtRule(".workspaceNavButton[data-step]::before{"), DESKTOP_QUERY);
  assert.equal(enclosingAtRule("  .workspaceNavButton[data-step]{\n    grid-template-columns:"), DESKTOP_QUERY);
});

test("it originates on the button, not the label span - attr() reads the element it belongs to", () => {
  // data-step lives on the button; span::before would resolve attr() against
  // the span and render an empty circle. The span's own ::before is already
  // the status dot, so the two never collide.
  const body = ruleBody(".workspaceNavButton[data-step]::before{");
  assert.match(body, /content: attr\(data-step\);/);
  assert.doesNotMatch(styles, /\.workspaceNavButton\[data-step\] > span::(before|after)\{/);
  assert.match(styles, /\.workspaceNavButton > span::before\{/);
});

test("a circle, filled with the section's own workflow accent and a knocked-out numeral", () => {
  const body = ruleBody(".workspaceNavButton[data-step]::before{");
  assert.match(body, /width: 18px;/);
  assert.match(body, /height: 18px;/);
  assert.match(body, /border-radius: 50%;/);
  assert.match(body, /background: var\(--tile-accent\);/);
  assert.match(body, /color: #fff;/);
  // Same type treatment as the mobile marker, only smaller: condensed face,
  // tabular figures, so 1-4 read as one set at either scale.
  assert.match(body, /font-family: "Arial Narrow","Roboto Condensed",Impact,sans-serif;/);
  assert.match(body, /font-variant-numeric: tabular-nums;/);
});

test("Gruvbox knocks the numeral out in the app background tone, exactly as mobile does", () => {
  const desktop = ruleBody('body:is([data-theme="gruvbox-dark"],[data-theme="gruvbox-light"]) .workspaceNavButton[data-step]::before{');
  assert.match(desktop, /color: var\(--bg\);/);
  assert.equal(
    enclosingAtRule('body:is([data-theme="gruvbox-dark"],[data-theme="gruvbox-light"]) .workspaceNavButton[data-step]::before{'),
    DESKTOP_QUERY
  );
  // The mobile marker's equivalent override, unchanged.
  assert.match(styles, /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\]\) \.workspaceNav \.workspaceNavButton\[data-step\]::before\{\s*\n\s*color:var\(--bg\);/);
});

// The bug this replaced: the circle was absolutely positioned with
// padding-right reserving its space. Reserving is not the same as
// occupying. The sidebar column is a fixed 220px and the labels are
// uppercase at .22em tracking, so "RESIN TOTALS" already fills the row -
// and a flex line cannot shrink below its longest word, so the label
// overflowed the padding and ran under the circle.
test("the circle occupies a grid column rather than being positioned over the row", () => {
  const button = ruleBody("  .workspaceNavButton[data-step]{\n    grid-template-columns:");
  assert.match(button, /grid-template-columns: minmax\(0,1fr\) auto;/);
  assert.doesNotMatch(button, /position: relative/);
  assert.doesNotMatch(button, /padding-right/);

  const marker = ruleBody(".workspaceNavButton[data-step]::before{");
  assert.match(marker, /grid-column: 2;/);
  // Spanning both rows keeps it centred against the label/status pair
  // rather than aligning to either line on its own.
  assert.match(marker, /grid-row: 1 \/ span 2;/);
  assert.doesNotMatch(marker, /position: absolute/);
  assert.doesNotMatch(marker, /right:/);
  assert.doesNotMatch(marker, /transform:/);
});

test("the label is confined to column 1 and can always give way to the circle", () => {
  const label = ruleBody("  .workspaceNavButton[data-step] > span,");
  assert.match(label, /grid-column: 1;/);
  assert.match(label, /min-width: 0;/);
  // Backstop for a single word with nowhere to break ("TIMELINE"), which
  // only bites below the 220px the column is fixed at.
  assert.match(ruleBody("  .workspaceNavButton[data-step] > span{"), /overflow-wrap: anywhere;/);
});

test("the unnumbered buttons are untouched - no dead gutter down the rest of the rail", () => {
  const base = ruleBody("  .workspaceNavButton{\n    display: grid;");
  assert.doesNotMatch(base, /padding-right/);
  assert.doesNotMatch(base, /grid-template-columns/);
});

/* ----------------------------------------------------------------------
 *   Shared tokens: the reason the two surfaces cannot drift
 * -------------------------------------------------------------------- */

test("--tile-accent is defined at top level so both surfaces resolve the same colour per section", () => {
  [
    ['.workspaceNavButton[data-workspace-target="lineSetupBlock"]{ --tile-accent:var(--orange); }', null],
    ['.workspaceNavButton[data-workspace-target="splitsBlock"]{ --tile-accent:var(--title); }', null],
    ['.workspaceNavButton[data-workspace-target="resultsBlock"]{ --tile-accent:var(--focus-border); }', null],
    ['.workspaceNavButton[data-workspace-target="productionSummaryBlock"]{ --tile-accent:var(--workflow-resin-totals); }', null]
  ].forEach(([rule]) => {
    assert.equal(enclosingAtRule("\n" + rule), null, `${rule} must not be inside a media query`);
  });
});

test("every theme override of the workflow accents is hoisted with them, or a theme would only apply on one surface", () => {
  [
    'body[data-theme="dark"] .workspaceNavButton[data-workspace-target="splitsBlock"]{ --tile-accent:var(--workflow-recipe); }',
    'body[data-theme="industrial-slate"] .workspaceNavButton[data-step]{ --tile-accent:var(--yellow); }',
    'body[data-theme="industrial-slate-dark"] .workspaceNavButton[data-workspace-target="resultsBlock"]{ --tile-accent:var(--workflow-timeline); }',
    'body:is([data-theme="gruvbox-dark"],[data-theme="gruvbox-light"]) .workspaceNavButton[data-workspace-target="lineSetupBlock"]{ --tile-accent:var(--gruv-orange); }'
  ].forEach(rule => {
    assert.equal(enclosingAtRule("\n" + rule), null, `${rule} must not be inside a media query`);
  });
});

test("Gruvbox's palette hues are top-level too - the accents above are useless without them", () => {
  // These used to sit beside the --gruv-mobile-* surface tokens inside the
  // mobile block. Left there, --tile-accent would resolve to an undefined
  // variable on desktop and the circle would lose its fill entirely.
  assert.equal(enclosingAtRule('body[data-theme="gruvbox-dark"]{\n  --gruv-red:#c87968;'), null);
  assert.equal(enclosingAtRule('body[data-theme="gruvbox-light"]{\n  --gruv-red:#cc241d;'), null);
  assert.match(styles, /body\[data-theme="gruvbox-dark"\]\{\s*\n\s*--gruv-red:#c87968;[\s\S]*?--gruv-purple:#ae8d80;\s*\n\}/);
  // The surface tokens stay mobile-only: they describe the tile home, not a colour.
  assert.notEqual(enclosingAtRule("--gruv-mobile-bg:#1d2021;"), null);
});

/* ----------------------------------------------------------------------
 *   Scope
 * -------------------------------------------------------------------- */

test("exactly the top four sections are numbered, and they are the same four as mobile", () => {
  const steps = [...html.matchAll(/data-workspace-target="(\w+)"[^>]*data-step="(\d)"/g)]
    .map(m => [m[2], m[1]]);
  assert.deepEqual(steps, [
    ["1", "lineSetupBlock"],
    ["2", "splitsBlock"],
    ["3", "resultsBlock"],
    ["4", "productionSummaryBlock"]
  ]);
  // RT Sync / Tools / Help carry no number on either surface.
  ["lineSyncBlock", "toolsBlock", "helpBlock"].forEach(target => {
    const button = html.slice(html.indexOf(`data-workspace-target="${target}"`));
    assert.doesNotMatch(button.slice(0, button.indexOf(">")), /data-step/);
  });
});

test("the marker is decorative - it adds no interactive state of its own", () => {
  const body = ruleBody(".workspaceNavButton[data-step]::before{");
  assert.doesNotMatch(body, /cursor|pointer-events/);
  assert.doesNotMatch(styles, /\.workspaceNavButton\[data-step\]:(hover|focus|active)/);
});
