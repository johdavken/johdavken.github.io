"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

/* styles.css opens the same screen size over and over: 85 @media blocks across
 * 26 distinct conditions, with (min-width: 701px) alone opened 13 separate
 * times in a 13,000-line file.
 *
 * That costs twice over. You cannot read what a screen size does without
 * finding every one of its blocks, and CSS resolves ties by source order - so
 * a rule in the 3rd block silently loses to a contradicting rule in the 11th,
 * with nothing at either site to say so.
 *
 * WHY THIS IS A RATCHET AND NOT A CLEANUP
 *
 * Merging them was investigated properly and rejected. Of the 39 gaps between
 * same-condition blocks, 32 contain rules that set a property the moved rules
 * also set, on something both could match - closing those would change which
 * declaration wins, i.e. change the app. Only 7 were provably free of that,
 * and the 13 blocks of (min-width: 701px) span lines 2626-11226 with 7,915
 * lines of unrelated CSS between them, so there is no version of this where
 * they collapse into one.
 *
 * The 7 safe merges were then built and measured: an exhaustive capture of all
 * 3,937 elements x 51 computed properties came back byte-identical, so they
 * were correct. They were still abandoned, because they bought 85 -> 78 blocks
 * (8%) while breaking 8 tests that assert stylesheet text by position - and
 * one of those, "Wide Touch and Desktop layer headers are disjoint by
 * data-shell", could only be fixed by loosening what it checks. Trading a real
 * assertion for an 8% tidier file is a bad deal, and breaking things to
 * prevent things from breaking defeats the point.
 *
 * Normalising the spelling was rejected wholesale for the same reason: the
 * same query is written both "(max-width: 700px)" and "(max-width:700px)",
 * which hides duplicates from a grep, but making it all consistent broke 48
 * tests. blockCounts() below is whitespace-insensitive so this guard works
 * anyway.
 *
 * The SHELL BOUNDARY was later normalised on its own, and that part is done:
 * the 901px pivot was 16 headers in 6 spellings ("(width <= 900px)" and
 * "(max-width:900px)" and "@media(max-width:900px)" all naming one
 * condition), and is now exactly two canonical strings - one per shell.
 * It was measured, not argued: every element x 44 computed properties at
 * 390px touch, 1280px coarse and 1280px fine came back byte-identical with
 * app state reset on both sides. It cost 21 test repoints rather than 48
 * because it left the 700px/600px families alone, and those are still mixed
 * - which is why blockCounts() must stay whitespace-insensitive.
 *
 * The repoint that matters, if this is ever extended: a test that finds a
 * block by searching for its @media header stops identifying a particular
 * block the moment every block of that condition is spelled the same, and
 * lands on whichever one happens to be first or last in the file - still
 * passing, now guarding something else. Anchor those on block content.
 *
 * What is left is the part that carries its weight: stop it getting worse.
 * Opening a new block for a condition that already has one is exactly how it
 * got here, and that is now a test failure rather than a habit.
 */

const CEILING = {
  "(min-width:701px)": 13,
  "(max-width:600px)": 8,
  "(max-width:900px),(min-width:901px)and(pointer:coarse)": 15,
  "(min-width:901px)and(pointer:fine)": 8,
  "(prefers-reduced-motion:reduce)": 7,
  "(max-width:700px)": 6,
  "(max-width:760px)": 3,
  "(min-width:720px)": 3,
  "(max-width:520px)": 2,
  "(max-width:720px)": 2,
  "(min-width:1201px)": 2,
  "(min-width:701px)and(max-height:800px)": 2,
  "(min-width:701px)and(max-width:1200px)": 2,
};

const TOTAL_CEILING = 85;

function blockCounts(file) {
  const css = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  const counts = new Map();
  for (const match of css.matchAll(/@media([^{]*)\{/g)) {
    // Whitespace-insensitive, so both spellings of one query count as one.
    const cond = match[1].split(/\s+/).join("").trim();
    counts.set(cond, (counts.get(cond) || 0) + 1);
  }
  return counts;
}

test("no screen size gains yet another separate @media block", () => {
  const counts = blockCounts("styles.css");
  const regressions = [];
  for (const [cond, ceiling] of Object.entries(CEILING)) {
    const actual = counts.get(cond) || 0;
    if (actual > ceiling) regressions.push(`${cond}: ${actual} blocks, ceiling ${ceiling}`);
  }
  assert.deepEqual(regressions, [],
    "add the rules to that condition's existing block instead of opening a new one");
});

test("the ceiling does not quietly slacken", () => {
  // If a future merge lowers a count, lower the ceiling with it - otherwise
  // the duplication creeps back without ever failing this.
  const counts = blockCounts("styles.css");
  const slack = [];
  for (const [cond, ceiling] of Object.entries(CEILING)) {
    const actual = counts.get(cond) || 0;
    if (actual < ceiling) slack.push(`${cond}: now ${actual}, ceiling still ${ceiling}`);
  }
  assert.deepEqual(slack, [], "tighten CEILING to the counts that now hold");
});

test("the total block count does not grow", () => {
  const total = [...blockCounts("styles.css").values()].reduce((a, b) => a + b, 0);
  assert.ok(total <= TOTAL_CEILING,
    `styles.css has ${total} @media blocks, ceiling ${TOTAL_CEILING} - a genuinely new condition is fine, another copy of an existing one is not`);
});

test("every condition in the ceiling still exists in the stylesheet", () => {
  // A stale entry would silently stop guarding anything.
  const counts = blockCounts("styles.css");
  const missing = Object.keys(CEILING).filter(cond => !counts.has(cond));
  assert.deepEqual(missing, [], "these are gone from styles.css - drop them from CEILING");
});

test("the ceiling covers every condition that is already duplicated", () => {
  // A duplicated condition with no entry here is unguarded, which is the one
  // way this test could pass while the problem it exists for gets worse.
  const counts = blockCounts("styles.css");
  const unguarded = [...counts.entries()]
    .filter(([cond, n]) => n > 1 && !(cond in CEILING))
    .map(([cond, n]) => `${cond} (${n} blocks)`);
  assert.deepEqual(unguarded, [], "add these to CEILING at their current count");
});
