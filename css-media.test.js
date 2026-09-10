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

const { PHONE, enclosingMedia, occurrences, ruleIn, blockContaining, rulesUnder } = require("./css-media");

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

test("PHONE matches the spellings the stylesheet actually uses", () => {
  assert.ok(PHONE.test("@media (max-width: 700px)"));
  assert.ok(PHONE.test("@media (max-width:700px)"));
  assert.ok(!PHONE.test("@media (max-width: 720px)"));
  assert.ok(!PHONE.test("@media (min-width: 701px)"));
});
