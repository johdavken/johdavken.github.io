"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { readStylesheet } = require("./css-source");

/* The desktop/touch boundary is decided ONCE, in app.js:
 *
 *   desktop: window.matchMedia("(min-width: 901px) and (pointer: fine)")
 *
 * and published to CSS as body[data-shell="desktop"|"touch"] - 273 selectors
 * across styles.css and button-styling.css depend on it. Pointer capability
 * is what decides it: width alone used to be enough for "desktop", which is
 * why an unfolded Fold (wide, but touch) was misclassified.
 *
 * CSS then states the SAME condition a second way, as 26 @media blocks:
 *
 *   desktop  @media (min-width: 901px) and (pointer: fine)
 *   touch    @media (max-width: 900px), (min-width: 901px) and (pointer: coarse)
 *
 * Two vocabularies for one boundary. They are used in disjoint places - no
 * rule is guarded by both - so this is not redundancy that can simply be
 * deleted. It is a drift risk: nothing stops someone moving 901px in the
 * stylesheet without moving it in app.js, at which point data-shell and the
 * media blocks disagree and elements get half of each layout. That failure
 * would look exactly like the side-rail bug: every rule correct on its own,
 * the page wrong.
 *
 * These tests pin the two together. They do NOT try to unify the spellings:
 * the same condition is written 6 ways across those 26 blocks, and ~18 test
 * files assert the exact media line text, so normalising it breaks them for
 * no behavioural gain. Counting here is whitespace-insensitive instead.
 *
 * KNOWN GAP, deliberately recorded rather than fixed: `pointer` can report
 * none, not just coarse/fine. A viewport >=901px reporting `pointer: none`
 * (keyboard-only, some TVs) gets data-shell="touch" from app.js, because the
 * fine query is false - but matches NEITHER media condition, because the
 * touch one asks for coarse specifically. Such a device gets the 273
 * data-shell rules and none of the 26 media blocks. Closing it means either
 * rewording 15 media lines (breaks the coupled tests) or making app.js agree
 * with the narrower CSS (worse - it would call a keyboard-only wide screen
 * "desktop", which is the misclassification the pointer check exists to
 * prevent). Left as-is, on purpose, with the reasoning attached.
 */

const app = fs.readFileSync("app.js", "utf8");
const CSS = ["styles.css", "desktop.css", "button-styling.css"]
  .map(f => readStylesheet(f));

const squash = s => s.replace(/\s+/g, "");

function mediaConditions() {
  const found = [];
  for (const css of CSS) {
    for (const m of css.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/@media([^{]*)\{/g)) {
      found.push(squash(m[1]));
    }
  }
  return found;
}

function jsQuery(name) {
  const m = app.match(new RegExp(`${name}:\\s*window\\.matchMedia\\("([^"]+)"\\)`));
  assert.ok(m, `app.js no longer defines layoutModeQueries.${name} via matchMedia`);
  return m[1];
}

test("the shell boundary app.js decides is a condition the stylesheet actually states", () => {
  // If this fails, JS and CSS disagree about what "desktop" means and the
  // data-shell attribute no longer lines up with the @media blocks.
  const q = squash(jsQuery("desktop"));
  assert.equal(q, "(min-width:901px)and(pointer:fine)");
  assert.ok(mediaConditions().includes(q),
    "no @media block states the exact condition app.js uses for data-shell");
});

test("the compact-touch breakpoint app.js uses is also stated in CSS", () => {
  const q = squash(jsQuery("compactRecipe"));
  assert.equal(q, "(max-width:700px)");
  assert.ok(mediaConditions().includes(q),
    "app.js's compact breakpoint has no matching @media block");
});

test("the touch condition is the complement of the desktop one, on the same boundary", () => {
  // Both must pivot on 901px. If one moves and the other doesn't, there is a
  // band of widths that is neither desktop nor touch.
  const conds = mediaConditions().filter(c => c.includes("pointer"));
  const touch = conds.filter(c => c.includes("pointer:coarse"));
  assert.ok(touch.length > 0, "no touch media condition found at all");
  for (const c of touch) {
    assert.match(c, /\(max-width:900px\)|\(width<=900px\)/,
      `touch condition does not pivot on 900px: ${c}`);
    assert.match(c, /\(min-width:901px\)and\(pointer:coarse\)/,
      `touch condition does not pair 901px with coarse: ${c}`);
  }
});

test("every pointer-based block is one of the two known conditions", () => {
  // A third variant would be a third opinion about where the boundary is.
  const strays = mediaConditions()
    .filter(c => c.includes("pointer"))
    .filter(c => !(
      (c.includes("(pointer:fine)") && c.includes("(min-width:901px)")) ||
      (c.includes("(pointer:coarse)") && c.includes("(min-width:901px)"))
    ));
  assert.deepEqual(strays, [], "these state the shell boundary a new way");
});

test("the number of pointer-based blocks does not grow", () => {
  // 25 at the time of writing. Adding another is adding another place the
  // boundary is restated; put the rules in an existing block, or use
  // body[data-shell=...] which needs no block at all.
  const n = mediaConditions().filter(c => c.includes("pointer")).length;
  assert.ok(n <= 26, `${n} pointer-based @media blocks, ceiling 26`);
});

test("data-shell is still what CSS keys the shell off, and app.js still sets it", () => {
  assert.match(app, /document\.body\.dataset\.shell = shell/,
    "app.js no longer publishes the shell to the DOM");
  const uses = CSS.reduce((n, css) => n + (css.match(/\[data-shell=/g) || []).length, 0);
  assert.ok(uses >= 250, `expected the data-shell vocabulary to still be in use, found ${uses}`);
});
