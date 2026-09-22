"use strict";

/* The tier rule (slate/slate-tier.js) and the sheets' discipline around
 * it: every tablet rule is scoped to the root's data-input/data-viewport, the
 * pointer tier has no rule of its own, and no media query decides a tier. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tier = require("./slate/slate-tier.js");

test("the preference wins; automatic is touch on a coarse pointer or in the app; below WIDE_MIN is narrow, and nothing to measure is wide", () => {
  assert.equal(tier.WIDE_MIN, 1100);
  assert.deepEqual(tier.tierFor({ coarse: false, native: false, width: 1440 }), { input: "pointer", width: "wide" });
  assert.deepEqual(tier.tierFor({ coarse: true, native: false, width: 1280 }), { input: "touch", width: "wide" });
  assert.deepEqual(tier.tierFor({ coarse: false, native: true, width: 800 }), { input: "touch", width: "narrow" });
  assert.deepEqual(tier.tierFor({ coarse: true, width: 1099 }), { input: "touch", width: "narrow" });
  assert.deepEqual(tier.tierFor({ coarse: true, width: 1100 }), { input: "touch", width: "wide" });
  assert.equal(tier.tierFor({ coarse: true, preference: "pointer" }).input, "pointer");
  assert.equal(tier.tierFor({ coarse: false, preference: "touch" }).input, "touch");
  assert.equal(tier.tierFor({ coarse: true, preference: "auto" }).input, "touch");
  assert.equal(tier.tierFor({ width: NaN }).width, "wide");
  assert.equal(tier.tierFor(null).input, "pointer");
});

test("probe reads the window it is handed and survives one that throws", () => {
  assert.deepEqual(tier.probe(null), { coarse: false, native: false, width: NaN });
  assert.deepEqual(tier.probe({ innerWidth: 900 }), { coarse: false, native: false, width: 900 });
  const view = { matchMedia: query => ({ matches: query === "(pointer: coarse)" }), Capacitor: { isNativePlatform: () => true } };
  assert.deepEqual(tier.probe(view), { coarse: true, native: true, width: 1099 });
  const hostile = { matchMedia() { throw new Error("no"); }, get Capacitor() { throw new Error("no"); } };
  assert.deepEqual(tier.probe(hostile), { coarse: false, native: false, width: NaN });
  assert.equal(tier.tierFor(tier.probe(hostile)).width, "wide", "a query that throws must not read as a narrow window");
  assert.equal(tier.probe({ matchMedia() { throw new Error("no"); }, innerWidth: 800 }).width, 800);
});

test("observe listens to both queries and its unsubscribe removes every listener", () => {
  const lists = [];
  const view = { matchMedia(query) { const set = new Set(); const list = { query, set, addEventListener: (t, fn) => set.add(fn), removeEventListener: (t, fn) => set.delete(fn) }; lists.push(list); return list; } };
  let heard = 0;
  const stop = tier.observe(view, () => { heard += 1; });
  assert.deepEqual(lists.map(one => one.query), ["(pointer: coarse)", "(min-width: 1100px)"]);
  for (const list of lists) for (const fn of list.set) fn();
  assert.equal(heard, 2);
  stop();
  assert.ok(lists.every(list => list.set.size === 0));
  assert.equal(typeof tier.observe(null, () => {}), "function");
});

function sheets() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push({ name: path.relative(__dirname, full), css: fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "") });
    }
  })(path.join(__dirname, "slate", "styles"));
  return out;
}

test("every tablet rule is scoped to the root's touch tier, and the pointer tier has no rule of its own", () => {
  for (const sheet of sheets()) {
    for (const match of sheet.css.matchAll(/([^{}]*)\{/g)) {
      for (const selector of match[1].split(",").map(one => one.trim()).filter(Boolean)) {
        if (!/data-(input|viewport)/.test(selector)) continue;
        assert.match(selector, /^\.slate-root\[data-input="touch"\](\[data-viewport="narrow"\])? \.slate-[a-z_-]+/, `${sheet.name}: "${selector}" is not scoped to the root's touch tier`);
      }
    }
    assert.doesNotMatch(sheet.css, /data-input="pointer"|data-viewport="wide"/, `${sheet.name} styles the pointer tier, which is the sheet itself`);
  }
});

test("the row format follows its section's width through exactly two named container queries, and only under the touch tier", () => {
  const found = [];
  for (const sheet of sheets()) {
    for (const match of sheet.css.matchAll(/@container\s+([^{]+)\{/g)) found.push(`${sheet.name.split("/").pop()}: ${match[1].trim()}`);
  }
  assert.deepEqual(found.sort(), ["recipe.css: slate-recipe (max-width: 779px)", "weights.css: slate-weights (max-width: 699px)"]);
  const recipe = sheets().find(sheet => sheet.name.endsWith("recipe.css")).css;
  assert.match(recipe, /\.slate-root\[data-input="touch"\] \.slate-recipe__body \{\s*container: slate-recipe \/ inline-size;/, "the recipe body is a container only under the touch tier");
  const weights = sheets().find(sheet => sheet.name.endsWith("weights.css")).css;
  assert.match(weights, /\.slate-root\[data-input="touch"\] \.slate-weights \{\s*container: slate-weights \/ inline-size;/);
});
