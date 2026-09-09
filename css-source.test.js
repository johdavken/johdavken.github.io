"use strict";

/* Guards for the one-logical-view helper the suite reads the base stylesheet
 * through.
 *
 * These are the invariants the positional split depends on. They were written
 * and made to fail on injected regressions while styles.css was still one
 * file, so the cut landed on a net that already worked rather than one written
 * afterwards to describe whatever the cut happened to produce.
 *
 * styles.css is now eleven consecutive styles-*.css parts. Concatenating them
 * in link order reproduces the original file byte for byte, which is what
 * makes the cascade provably unchanged - but see the self-containment test for
 * the one thing that identity does NOT prove.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { STYLE_PARTS, readStyles, stylePartFilesOnDisk } = require("./css-source");

const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

test("the stylesheet has at least one part and it reads", () => {
  assert.ok(STYLE_PARTS.length >= 1, "index.html links no styles*.css at all");
  const css = readStyles();
  assert.ok(css.length > 1000);
  // Landmarks that must survive any cut: the very first rule of the file and
  // the global [hidden] rule that every other visibility rule defers to.
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  assert.match(css, /:root\{/);
});

test("every part on disk is actually linked by index.html", () => {
  // The failure this catches is a cut that produces a new part file and
  // forgets its <link>: the suite would still pass, reading a stylesheet the
  // browser never loads, while the app silently lost those rules.
  const linked = new Set(STYLE_PARTS.map(p => path.basename(p)));
  const orphans = stylePartFilesOnDisk().filter(name => !linked.has(name));
  assert.deepEqual(orphans, [],
    "these styles*.css files exist but no <link> loads them - add the link, " +
    "or delete the file");
});

test("every linked part exists and is linked exactly once", () => {
  for (const part of STYLE_PARTS) {
    assert.ok(fs.existsSync(path.join(__dirname, part)), `${part} is linked but missing`);
  }
  assert.equal(new Set(STYLE_PARTS).size, STYLE_PARTS.length,
    "a part linked twice is applied twice, and the second copy wins ties");
});

test("each part is brace-balanced, so no cut lands inside a block", () => {
  // The catastrophic split failure: cutting inside an @media block leaves one
  // part with an unclosed brace and the next starting mid-block. Browsers
  // recover from that silently and differently than the original cascaded.
  // Each part must open and close at depth zero on its own.
  for (const part of STYLE_PARTS) {
    const css = fs.readFileSync(path.join(__dirname, part), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    let depth = 0, min = 0;
    for (const ch of css) {
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth < min) min = depth; }
    }
    assert.equal(depth, 0, `${part} ends at brace depth ${depth}, not 0`);
    assert.equal(min, 0, `${part} closes a block it never opened`);
  }
});

test("each part is self-contained, so no cut landed inside a selector list", () => {
  // Brace balance is not enough, and neither is byte-identical concatenation.
  // A cut between a selector and its block -
  //
  //     .a,          <- end of one part
  //     .b{ ... }    <- start of the next
  //
  // rejoins to exactly the original bytes, and every part is brace-balanced.
  // But the browser parses each file on its own: the dangling ".a," is
  // discarded as a parse error and .a silently loses the rule. That is a real
  // cascade change that the identity proof cannot see, so it is checked here.
  //
  // The condition: with comments removed, a part ends at "}" with nothing
  // trailing, and begins something new rather than continuing a selector.
  for (const part of STYLE_PARTS) {
    const css = fs.readFileSync(path.join(__dirname, part), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").trim();
    assert.ok(css.endsWith("}"), `${part} does not end with a closed block`);
    assert.equal(css.slice(css.lastIndexOf("}") + 1).trim(), "",
      `${part} has text after its last block - a cut landed mid-rule`);
    assert.doesNotMatch(css, /^[,>+~]/,
      `${part} starts with a combinator or comma - it continues the previous part's selector`);
    assert.match(css.slice(0, css.indexOf("{")), /\S/,
      `${part} opens a block with no selector`);
  }
});

test("the parts are linked before theme.css, desktop.css and button-styling.css", () => {
  // Cascade order is document order. These three deliberately come after and
  // override; a part linked below them would quietly stop losing ties it is
  // supposed to lose.
  const order = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)]
    .map(m => path.basename(m[1].split("?")[0]));
  const lastPart = Math.max(...STYLE_PARTS.map(p => order.indexOf(path.basename(p))));
  for (const after of ["theme.css", "desktop.css", "button-styling.css"]) {
    const at = order.indexOf(after);
    if (at === -1) continue;
    assert.ok(at > lastPart,
      `${after} is linked at ${at}, before or among the styles parts (last at ${lastPart})`);
  }
});

test("every part carries a cache-busting version tag", () => {
  // Eleven parts means eleven tags to bump, and an edit usually touches one.
  // Shipping a changed part under its old tag serves stale CSS from cache,
  // which reads as "the change did nothing" - the exact misdiagnosis that cost
  // two debugging passes while consolidating [hidden]. css-cache-tags.test.js
  // enforces the harder half (a changed part's tag actually moved); this only
  // checks a tag is there to move.
  for (const part of STYLE_PARTS) {
    const tag = new RegExp(`href="${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=[0-9.]+"`);
    assert.match(html, tag, `${part} is linked without a ?v= cache tag`);
  }
});
