"use strict";

// Missing-weight Timeline state, grouped form. A tracked hopper whose feed
// rate is known but whose receiver weight is not cannot produce a rundown
// time. Rather than one warning row per hopper competing with the timed
// ribbon, they collect into a single compact section after every calculable
// row:
//
//   NEEDS WEIGHT · 3
//   —   D1   MS1201 → MS0440
//   —   E5   A0450
//   —   E6   A0502
//
// The accent colour is spent only on the group label + marker; the rows stay
// in normal Timeline text. Each row's identity is a button that opens the
// existing Receiver Hopper Weights editor. Adding a weight drops the hopper
// out of the group and back into the timed list on the next render.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

function slice(from, to){
  const start = app.indexOf(from);
  assert.notEqual(start, -1, `expected to find ${from}`);
  const end = app.indexOf(to, start + 1);
  assert.notEqual(end, -1, `expected ${to} after ${from}`);
  return app.slice(start, end);
}

const render = slice("function renderResultsFlat(", "renderNeedsWeightGroup(area, needsWeightFlat, nextResins);");
const group = slice("function renderNeedsWeightGroup(", "\n    /* The Hookups view");

/* ----------------------------------------------------------------------
 *   Partition
 * -------------------------------------------------------------------- */

test("missing weight is a specific case: rate known, weight absent, not pumped off", () => {
  assert.match(render, /const isMissingWeight = h => !h\.pumpOff && h\.rate > 0 && !\(h\.weight > 0\);/);
});

test("missing-weight hoppers are split out of the timed ribbon and rendered as a trailing group", () => {
  assert.match(render, /const needsWeightFlat = viewFlat\.filter\(isMissingWeight\);/);
  assert.match(render, /const timedFlat = viewFlat\.filter\(h => !isMissingWeight\(h\)\);/);
  assert.match(render, /timedFlat\.forEach\(\(h\)=>\{/);
  // group is appended after the timed rows loop
  assert.match(app, /renderNeedsWeightGroup\(area, needsWeightFlat, nextResins\);/);
});

test("the timed ribbon no longer carries a per-row missing-weight branch or its long sentence", () => {
  assert.doesNotMatch(render, /Weight needed to calculate rundown/);
  assert.doesNotMatch(render, /resultMissingWeightAction/);
  assert.doesNotMatch(render, /\bmissingWeight \?/);
});

/* ----------------------------------------------------------------------
 *   The group
 * -------------------------------------------------------------------- */

test("the group shows a NEEDS WEIGHT label and the affected-hopper count", () => {
  assert.match(group, /if \(!needsWeightFlat\.length\) return;/);
  assert.match(group, /headingLabel\.textContent = "NEEDS WEIGHT";/);
  assert.match(group, /headingCount\.textContent = `· \$\{needsWeightFlat\.length\}`;/);
  assert.match(group, /heading\.className = "resultNeedsWeightHeading";/);
});

test("each grouped row keeps the row shape: em-dash time, hopper id, resin, next resin, pump control", () => {
  assert.match(group, /<span class="mono resultTimingValue resultTimingUnavailable">—<\/span>/);
  assert.match(group, /<span class="mono resultHopper">\$\{h\.hopperLabel\}<\/span>/);
  assert.match(group, /resinChip\.textContent = h\.resinName \|\| "No resin";/);
  assert.match(group, /const incoming = nextResins\?\.get\(`\$\{h\.layer\}:\$\{h\.hopperIndex\}`\);/);
  assert.match(group, /class="pumpToggle" data-pump-toggle/);
});

test("there is no repeated 'weight needed' helper sentence inside the group rows", () => {
  assert.doesNotMatch(group, /Weight needed to calculate rundown/);
  assert.doesNotMatch(group, /Add weight to calculate time/);
});

test("resin names are set as text nodes, never interpolated into row markup", () => {
  assert.doesNotMatch(group, /\$\{h\.resinName\}/);
  assert.doesNotMatch(group, /\$\{incoming\}/);
  assert.match(group, /name\.textContent = incoming \|\| "Empty";/);
});

/* ----------------------------------------------------------------------
 *   Actionability + recovery
 * -------------------------------------------------------------------- */

test("each grouped row is a button that routes to the existing weight editor for that hopper", () => {
  assert.match(group, /<button type="button" class="resultNeedsWeightRow" data-weight-fix>/);
  assert.match(group, /fixBtn\.setAttribute\("aria-label", `Add weight for hopper \$\{h\.hopperLabel\}`\);/);
  assert.match(group, /fixBtn\.addEventListener\("click",\(\)=>openHopperWeightEditor\(h\.layer, h\.hopperIndex\)\);/);
  // openHopperWeightEditor is the existing helper, not a new one
  assert.match(app, /function openHopperWeightEditor\(layerName, hi\)\{/);
});

test("recovery is automatic: the group renders straight from the current partition, no manual refresh", () => {
  // No timestamp is invented for these rows and nothing caches the group -
  // the next validateAndCompute() render re-partitions from live weights.
  assert.doesNotMatch(group, /startByDate\s*=/);
  assert.match(app, /renderNeedsWeightGroup\(area, needsWeightFlat, nextResins\);/);
});

/* ----------------------------------------------------------------------
 *   Restrained colour / not an error panel
 * -------------------------------------------------------------------- */

test("the accent colour is confined to the group label and marker; rows stay in normal text", () => {
  assert.match(styles, /\.resultNeedsWeightHeading\{[^}]*color:var\(--warn\)/);
  assert.match(styles, /\.resultNeedsWeightHeading::before\{[^}]*background:var\(--warn\)/);
  // the row itself inherits normal timeline colour, and its schedule node is quiet
  assert.match(styles, /\.resultNeedsWeightRow\{[^}]*color:inherit/);
  assert.match(styles, /\.resultRow\.needsWeight::before\{ background:var\(--row-border-2\); \}/);
  assert.match(styles, /\.resultRow\.needsWeight \.resultTimingValue\{[\s\S]*?color:var\(--muted\)/);
});

test("no error-red anywhere in the missing-weight rules", () => {
  const block = styles.slice(styles.indexOf(".resultNeedsWeightGroup"), styles.indexOf(".resultNeedsWeightRow:focus-visible") + 200);
  assert.doesNotMatch(block, /#f00|#ff0000|\bred\b|var\(--danger\)/i);
});

test("the grouped row keeps a visible keyboard focus state", () => {
  assert.match(styles, /\.resultNeedsWeightRow:focus-visible\{[\s\S]*?outline:2px solid var\(--focus-border\);/);
});

/* ----------------------------------------------------------------------
 *   Sorting of the timed rows (verification, no behaviour change)
 * -------------------------------------------------------------------- */

test("timed rows sort by the true upcoming instant, not displayed text or insertion order", () => {
  // Changeover set: absolute start-by Date -> getTime() numeric compare, so a
  // next-day rollover is already inside the timestamp.
  assert.match(render, /const ta = a\.startByDate \? a\.startByDate\.getTime\(\) : Infinity;/);
  assert.match(render, /if \(ta !== tb\) return ta - tb;/);
  // No changeover: numeric minutesToEmpty duration.
  assert.match(render, /\? a\.minutesToEmpty : Infinity/);
  // The sort key is never the rendered clock / "Empty in" text.
  const sortBody = render.slice(render.indexOf("viewFlat.sort("), render.indexOf("});", render.indexOf("viewFlat.sort(")));
  assert.doesNotMatch(sortBody, /timeText|startByText|timingValue/);
});

test("the day-rollover comparator orders a next-day start-by after a same-day one", () => {
  // Re-run the exact comparator shape against absolute Dates spanning midnight.
  const cmp = (a, b) => {
    const ta = a.startByDate ? a.startByDate.getTime() : Infinity;
    const tb = b.startByDate ? b.startByDate.getTime() : Infinity;
    if (ta !== tb) return ta - tb;
    if (a.layer !== b.layer) return a.layer.localeCompare(b.layer);
    return a.hopperLabel.localeCompare(b.hopperLabel);
  };
  const rows = [
    { layer: "A", hopperLabel: "A1", startByDate: new Date("2026-01-02T00:30:00Z") }, // next day
    { layer: "A", hopperLabel: "A2", startByDate: new Date("2026-01-01T23:50:00Z") }, // tonight, later clock
    { layer: "A", hopperLabel: "A3", startByDate: new Date("2026-01-01T08:05:00Z") }, // this morning
    { layer: "A", hopperLabel: "A4", startByDate: null },                              // no time -> last
  ];
  const order = [...rows].sort(cmp).map(r => r.hopperLabel);
  assert.deepEqual(order, ["A3", "A2", "A1", "A4"]);
});
