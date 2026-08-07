"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

// Option 6 ("Orbit Ring") from the "no chevron" mockup round, implemented
// for real: the mobile card disclosure indicator is no longer an
// arrow/corner shape at all. Closed, it's a plain dot. Open, a faint
// dashed ring appears with a small satellite continuously orbiting it for
// as long as the panel stays open - not just a one-shot transition. The
// outer .chev class name/position is kept (only its contents and rules
// changed) so no other layout code needed to change.

test("every summary's chev is the 3-part orbit structure (ring, satellite, core), not the old empty chevron div", () => {
  const chevCount = (html.match(/<div class="chev">/g) || []).length;
  assert.ok(chevCount >= 10, `expected at least 10 .chev instances, found ${chevCount}`);
  assert.equal(chevCount, (html.match(/<span class="chevRing">/g) || []).length);
  assert.equal(chevCount, (html.match(/<span class="chevSatellite">/g) || []).length);
  assert.equal(chevCount, (html.match(/<span class="chevCore">/g) || []).length);
  assert.doesNotMatch(html, /<div class="chev"><\/div>/, "no empty (old-style) chev divs should remain");
});

test("no leftover border-corner-triangle chevron styling or the old ambient-glow pseudo-element/keyframes", () => {
  const chevRule = styles.slice(styles.indexOf("\n.chev{"), styles.indexOf("}", styles.indexOf("\n.chev{")) + 1);
  assert.doesNotMatch(chevRule, /border-right/);
  assert.doesNotMatch(chevRule, /border-bottom/);
  assert.doesNotMatch(chevRule, /rotate\(-45deg\)/);
  assert.doesNotMatch(styles, /chevAmbientSpin/);
  assert.doesNotMatch(styles, /\.chev::before/);
});

test("closed state is just a plain dot - no ring, no satellite visible", () => {
  const ringRule = styles.slice(styles.indexOf(".chevRing{"), styles.indexOf("}", styles.indexOf(".chevRing{")) + 1);
  const satRule = styles.slice(styles.indexOf(".chevSatellite{"), styles.indexOf("}", styles.indexOf(".chevSatellite{")) + 1);
  assert.match(ringRule, /opacity: 0;/);
  assert.match(satRule, /opacity: 0;/);
});

test("opening reveals the ring and starts the satellite's continuous orbit - a real loop (infinite), not a single pass", () => {
  assert.match(styles, /details\[open\] > summary \.chevRing\{ opacity: 1; \}/);
  const openSatRule = styles.slice(
    styles.indexOf("details[open] > summary .chevSatellite{"),
    styles.indexOf("}", styles.indexOf("details[open] > summary .chevSatellite{")) + 1
  );
  assert.match(openSatRule, /opacity: 1;/);
  assert.match(openSatRule, /animation: chevOrbit 2\.6s linear infinite;/);
});

test("the orbit keyframes are a full, continuous rotation - the satellite stays at a fixed radius from center throughout", () => {
  const start = styles.indexOf("@keyframes chevOrbit{");
  assert.notEqual(start, -1);
  const rule = styles.slice(start, styles.indexOf("\n}", start) + 2);
  assert.match(rule, /from\{ transform: translate\(-50%,-50%\) rotate\(0deg\) translateX\(7px\); \}/);
  assert.match(rule, /to\{ transform: translate\(-50%,-50%\) rotate\(360deg\) translateX\(7px\); \}/);
});

test("hover and open both highlight the core dot the same way the old chevron highlighted on hover/open", () => {
  assert.match(styles, /summary:hover \.chevCore\{ background: var\(--focus-border\); \}/);
  assert.match(styles, /details\[open\] > summary \.chevCore\{ background: var\(--focus-border\); \}/);
});

test("the whole indicator stays self-contained within its 18px box (no overhang), so .card's overflow:hidden can never clip it regardless of density", () => {
  const chevRule = styles.slice(styles.indexOf("\n.chev{"), styles.indexOf("}", styles.indexOf("\n.chev{")) + 1);
  assert.match(chevRule, /width: 18px; height: 18px;/);
  const ringRule = styles.slice(styles.indexOf(".chevRing{"), styles.indexOf("}", styles.indexOf(".chevRing{")) + 1);
  assert.match(ringRule, /inset: 0;/, "the ring fits exactly within the 18px box, not extending past it like the old ambient-glow ring did");
});
