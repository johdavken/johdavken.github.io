"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");

// Recipe Setup's mobile view shows one layer's hoppers at a time, switched
// via a tab bar calling showMobileLayer(name). Swiping is a second way to
// reach the same function - not a parallel implementation, not a real
// scroll-snap carousel (the underlying table stays a CSS show/hide of
// [data-layer-column] cells, unchanged).

function swipeBlock(){
  const start = app.indexOf("scroll.addEventListener(\"touchstart\"");
  assert.notEqual(start, -1, "expected the touchstart listener");
  const end = app.indexOf("}, { passive: true });\n", app.indexOf("scroll.addEventListener(\"touchend\"")) ;
  return app.slice(start, end);
}

test("the swipe listeners are attached to the mobile layer scroll wrapper, after showMobileLayer/the tab buttons are already wired", () => {
  const wireIndex = app.indexOf("showMobileLayer(activeMobileLayer);");
  const touchIndex = app.indexOf("scroll.addEventListener(\"touchstart\"");
  assert.ok(wireIndex > -1 && touchIndex > wireIndex);
});

test("both listeners are passive - evaluated once on touchend (total displacement), never tracked live on touchmove, so this can't fight the page's normal vertical scroll", () => {
  const block = swipeBlock();
  assert.match(block, /\{ passive: true \}/);
  assert.doesNotMatch(app.slice(app.indexOf("scroll.addEventListener(\"touchstart\""), app.indexOf("scroll.addEventListener(\"touchend\"") + 2000), /addEventListener\("touchmove"/);
});

test("a swipe starting inside a field (input/select/textarea) is ignored, so selecting or dragging text in a hopper input isn't mistaken for a layer swipe", () => {
  const block = swipeBlock();
  assert.match(block, /event\.target\.closest\("input, select, textarea"\)/);
});

test("a swipe requires real horizontal displacement and must be more horizontal than vertical, so an ordinary vertical scroll can't trigger a layer change", () => {
  const block = swipeBlock();
  assert.match(block, /Math\.abs\(dx\) < 40 \|\| Math\.abs\(dx\) < Math\.abs\(dy\)/);
});

test("swiping calls the exact same showMobileLayer the tab bar uses - not a separate rendering path", () => {
  const block = swipeBlock();
  assert.match(block, /showMobileLayer\(names\[nextIndex\]\);/);
});

test("swiping is bounded at the ends - no wrap-around from the last layer back to the first, or vice versa", () => {
  const block = swipeBlock();
  assert.match(block, /if \(nextIndex < 0 \|\| nextIndex >= names\.length\) return;/);
});

test("left swipe (negative dx) advances to the next layer, right swipe goes back - the conventional forward/back paging direction", () => {
  const block = swipeBlock();
  assert.match(block, /const nextIndex = dx < 0 \? index \+ 1 : index - 1;/);
});
