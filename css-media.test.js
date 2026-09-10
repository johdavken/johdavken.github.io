"use strict";

/* Tests for the media-block locator, against synthetic CSS.
 *
 * Deliberately not against the app's own stylesheet: this has to be right
 * about the cases that broke the tests it replaces, and those cases need to be
 * constructed rather than waited for. The two that matter are a selector that
 * appears both at top level and again inside a media query, and more than one
 * block sharing the same condition.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { PHONE, enclosingMedia, occurrences, ruleIn, blockContaining, rulesUnder, startsSelector } = require("./css-media");

const CSS = [
  ".thing{color:red}",                                   // top-level base rule
  "@media (max-width: 700px){",
  "  .other{display:none}",
  "}",
  ".between{margin:0}",
  "@media (min-width: 901px) and (pointer: fine){",
  "  .thing{color:green}",                               // same selector, desktop
  "}",
  "@media (max-width: 700px){",
  "  .thing{color:blue}",                                // the phone override
  "  .nested{background:url(\"a{b\")}",                   // brace inside a string
  "}",
].join("\n");

test("enclosingMedia reports the condition a rule sits under, and null at top level", () => {
  assert.equal(enclosingMedia(CSS, CSS.indexOf(".between")), null);
  assert.equal(enclosingMedia(CSS, CSS.indexOf(".other")), "@media (max-width: 700px)");
  assert.equal(enclosingMedia(CSS, CSS.lastIndexOf(".thing")),
    "@media (max-width: 700px)");
});

test("a brace inside a quoted string does not shift the depth", () => {
  // url("a{b") would otherwise look like an extra open brace and put every
  // following rule at the wrong depth.
  assert.equal(enclosingMedia(CSS, CSS.indexOf(".nested")), "@media (max-width: 700px)");
});

test("occurrences finds every copy of a selector with the condition of each", () => {
  const hits = occurrences(CSS, ".thing{");
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map(h => h.condition), [
    null,
    "@media (min-width: 901px) and (pointer: fine)",
    "@media (max-width: 700px)",
  ]);
});

test("ruleIn returns the phone override, not the top-level base rule that comes first", () => {
  // This is the exact failure it exists to prevent: indexOf finds the base
  // rule, the assertion runs against that, and a working feature reads broken.
  const hit = ruleIn(CSS, ".thing{");
  assert.ok(hit);
  assert.match(hit.body, /color:blue/);
  assert.doesNotMatch(hit.body, /color:red/);
});

test("ruleIn is null when the selector exists but never under the asked-for condition", () => {
  assert.equal(ruleIn(CSS, ".between{"), null,
    "a top-level-only rule is not phone-scoped and must not be reported as such");
  assert.equal(ruleIn(CSS, ".nope{"), null);
});

test("ruleIn honours a condition other than phone", () => {
  const desktop = ruleIn(CSS, ".thing{", /pointer: fine/);
  assert.match(desktop.body, /color:green/);
});

test("rulesUnder collects every block with the condition, not just the first", () => {
  const phone = rulesUnder(CSS);
  assert.match(phone, /\.other\{display:none\}/,  "first phone block missing");
  assert.match(phone, /\.thing\{color:blue\}/,    "second phone block missing");
  assert.doesNotMatch(phone, /color:green/,       "a desktop block leaked in");
  assert.doesNotMatch(phone, /\.between/,         "a top-level rule leaked in");
});

test("blockContaining returns the whole block the anchor sits in", () => {
  const block = blockContaining(CSS, ".thing{");
  assert.equal(block.condition, "@media (max-width: 700px)");
  assert.match(block.body, /color:blue/);
  assert.doesNotMatch(block.body, /\.other/, "that is the other phone block, not this one");
});

test("an anchor matches only where it starts a selector, not inside a longer one", () => {
  /* The bug this exists for: ".splitLayerMain{" is a substring of
   * ".bulk-editing .splitLayerMain{". Asked for the first, a plain indexOf
   * returns the second - a different rule with different declarations. It cost
   * two wrong diagnoses here: the base rule really did say min-height:0, but
   * the lookup kept handing back the bulk-editing override's min-height:58px,
   * so a working rule was reported as a design that had been removed. */
  const css = [
    "@media (max-width: 700px){",
    "  .bulk-editing .thing{ min-height: 58px; }",
    "  .thing{ min-height: 0; }",
    "  .prefix.thing{ color: red; }",
    "}",
  ].join("\n");

  const hit = ruleIn(css, ".thing{");
  assert.match(hit.body, /min-height: 0/, "matched a longer selector instead of the bare one");
  assert.doesNotMatch(hit.body, /58px/);
  assert.doesNotMatch(hit.body, /color: red/);

  // The longer selectors are still reachable by asking for them in full.
  assert.match(ruleIn(css, ".bulk-editing .thing{").body, /58px/);
  assert.match(ruleIn(css, ".prefix.thing{").body, /color: red/);

  // ...and deliberately asking for a fragment still works when opted into.
  assert.equal(occurrences(css, ".thing{", { anywhere: true }).length, 3);
  assert.equal(occurrences(css, ".thing{").length, 1);
});

test("startsSelector accepts statement boundaries and rejects mid-selector positions", () => {
  const css = "}\n.a{x:1}\n.b .a{y:2}\n.c,\n.a{z:3}\n/* note */\n.a{w:4}";
  const at = n => { let i=-1; for(let k=0;k<=n;k++) i=css.indexOf(".a{", i+1); return i; };
  assert.equal(startsSelector(css, at(0)), true,  "after a closing brace");
  assert.equal(startsSelector(css, at(1)), false, "inside \".b .a\" - a descendant selector");
  assert.equal(startsSelector(css, at(2)), true,  "after a comma in a selector list");
  assert.equal(startsSelector(css, at(3)), true,  "after a comment");
});

test("PHONE matches the spellings the stylesheet actually uses", () => {
  assert.ok(PHONE.test("@media (max-width: 700px)"));
  assert.ok(PHONE.test("@media (max-width:700px)"));
  assert.ok(!PHONE.test("@media (max-width: 720px)"));
  assert.ok(!PHONE.test("@media (min-width: 701px)"));
});
