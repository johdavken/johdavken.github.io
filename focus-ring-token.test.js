"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const { readStylesheet } = require("./css-source");

const FILES = ["styles.css", "desktop.css", "button-styling.css", "theme.css"];
const css = Object.fromEntries(FILES.map(f => [f, readStylesheet(f)]));

// The keyboard focus ring used to be written out as a literal shorthand 65
// times across three files, in two spellings that differed only by a space -
// so nothing flagged them as duplicates and no single edit could change the
// ring. It is now one token, --focus-outline, composed in styles.css :root
// beside the --focus-border it wraps.
//
// `outline-offset` is deliberately NOT part of the token: it is genuinely
// per-component and currently takes six different values across the app
// (2px x40, 1px x12, -2px x9, -3px x2, 3px x1, -1px x1). Folding it in would
// have moved rings; normalising those six is a design decision, not a refactor.

// Matches `outline:` as a whole property - never the tail of `--focus-outline:`.
const OUTLINE_PROPERTY = /(?<![\w-])outline(\s*:\s*)([^;}]+)/g;

test("the focus ring is composed exactly once, beside the token it wraps", () => {
  const defs = [...css["styles.css"].matchAll(/--focus-outline\s*:\s*([^;]+);/g)];
  assert.equal(defs.length, 1, "expected exactly one --focus-outline definition");
  assert.equal(defs[0][1].trim(), "2px solid var(--focus-border)");
  // It must compose the theme token rather than pinning a colour, or the ring
  // stops following the active theme.
  assert.match(defs[0][1], /var\(--focus-border\)/);
});

test("no stylesheet restates the focus-ring shorthand as a literal", () => {
  for (const file of FILES) {
    const offenders = [...css[file].matchAll(OUTLINE_PROPERTY)]
      .filter(m => /2px solid var\(--focus-border\)/.test(m[2]));
    assert.deepEqual(
      offenders.map(m => m[0]),
      [],
      `${file} writes the focus ring out longhand - use outline:var(--focus-outline)`,
    );
  }
});

test("every focus-visible ring goes through the token", () => {
  let viaToken = 0;
  for (const file of FILES) {
    for (const match of css[file].matchAll(OUTLINE_PROPERTY)) {
      if (match[2].includes("var(--focus-outline)")) viaToken += 1;
    }
  }
  // 65 at the time of the change. A new focus ring should push this up, not
  // reintroduce a literal - the test above is what catches that.
  assert.ok(viaToken >= 65, `expected at least 65 rings via the token, found ${viaToken}`);
});

test("border shorthands that happen to share the ring's value are left alone", () => {
  // border-bottom/-left/-right:2px solid var(--focus-border) are a different
  // thing wearing the same colour - the sweep must not have touched them.
  const borders = [...css["styles.css"].matchAll(/border(?:-[a-z]+)?\s*:\s*2px solid var\(--focus-border\)/g)];
  assert.ok(borders.length > 0, "expected the border uses of --focus-border to survive");
});

test("the token is defined before any rule consumes it", () => {
  const styles = css["styles.css"];
  const definedAt = styles.indexOf("--focus-outline:");
  const firstUse = styles.indexOf("var(--focus-outline)", definedAt + 1);
  assert.notEqual(definedAt, -1);
  assert.ok(firstUse > definedAt, "the :root definition must precede the first use");
});
