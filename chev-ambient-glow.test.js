"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// Option 19 ("Ambient conic glow") from the chevron mockup round: while a
// mobile card summary is open, a thin conic-gradient ring fades in behind
// the chevron and keeps slowly spinning for as long as it stays open - an
// idle "active" indicator, not just a one-shot transition. The existing
// rotate-on-open and hover/press border-color highlight are untouched.

function chevRule(){
  // Anchored with a leading newline so this finds the base, unindented
  // .chev{...} rule - not the desktop ".workspaceContent > .workspacePanel
  // > summary .chev{ display: none; }" override, which also contains the
  // literal substring ".chev{" and appears earlier in the file.
  const start = styles.indexOf("\n.chev{");
  assert.notEqual(start, -1, "expected the base .chev rule");
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

test(".chev is position:relative so its ::before ring can anchor to it", () => {
  assert.match(chevRule(), /position: relative;/);
});

test("the ring is a masked conic-gradient - a true ring, not a filled dot, regardless of whatever background sits behind it", () => {
  const start = styles.indexOf(".chev::before{");
  assert.notEqual(start, -1, "expected a .chev::before rule");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /background: conic-gradient\(var\(--focus-border\), transparent 40%\);/);
  assert.match(rule, /-webkit-mask: radial-gradient\(farthest-side, transparent calc\(100% - 2px\), #000 calc\(100% - 2px\)\);/);
  assert.match(rule, /mask: radial-gradient\(farthest-side, transparent calc\(100% - 2px\), #000 calc\(100% - 2px\)\);/);
  assert.match(rule, /opacity: 0;/, "invisible until the panel is open");
  assert.match(rule, /pointer-events: none;/, "decorative only - never intercepts the summary's own click target");
});

test("the ring only overhangs .chev by 3px - small enough to clear .card's overflow:hidden even at Maximum Data density (the tightest summary padding)", () => {
  const start = styles.indexOf(".chev::before{");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /inset: -3px;/);
  // Maximum Data: --pad-card:2px, --summary-pad:5px -> mobile summary
  // padding is halved to 2.5px, so total clearance from .chev to the
  // card's clipped edge is 2px + 2.5px = 4.5px, comfortably more than a
  // 3px ring overhang. Comfort/Spacious/Compact/Dense all have more
  // clearance still.
  const maxDensityStart = styles.indexOf('[data-density="maximum"]');
  const maxDensityRule = styles.slice(maxDensityStart, styles.indexOf("}", maxDensityStart) + 1);
  assert.match(maxDensityRule, /--pad-card: 2px;/);
  assert.match(maxDensityRule, /--summary-pad: 5px;/);
});

test("the ring fades in and starts an infinite slow spin only while the details element is open - not on mere hover", () => {
  const start = styles.indexOf('details[open] > summary .chev::before{');
  assert.notEqual(start, -1);
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /opacity: \.55;/);
  assert.match(rule, /animation: chevAmbientSpin 2\.2s linear infinite;/);
  // Hover alone (not open) must not trigger the spin - only the existing
  // border-color highlight, which this change doesn't touch.
  const hoverRule = styles.slice(styles.indexOf("summary:hover .chev{"), styles.indexOf("}", styles.indexOf("summary:hover .chev{")) + 1);
  assert.doesNotMatch(hoverRule, /animation/);
});

test("the existing rotate-on-open and hover highlight behavior is unchanged", () => {
  assert.match(styles, /summary:hover \.chev\{ border-color: var\(--focus-border\); \}/);
  assert.match(styles, /details\[open\] > summary \.chev\{ transform: rotate\(45deg\); \}/);
});

test("the spin keyframes exist and are a plain full rotation", () => {
  assert.match(styles, /@keyframes chevAmbientSpin\{ to\{ transform: rotate\(360deg\); \} \}/);
});
