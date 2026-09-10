"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const styles = readStyles();

// Desktop's per-layer column header (ghosted letter, percentage, Copy)
// picked "option A" from the mockup: keep the giant translucent letter as
// is (it's still the bulk-edit "select this whole layer" tap target), just
// give the percentage a bolder/bigger treatment and promote Copy from a
// plain, low-opacity text link to a real bordered pill button. Scoped to
// the base (non-media-query) rules, since the mobile @media(max-width:700px)
// block already fully overrides both with its own two-chip layout.

function functionBodyLikeRule(selector){
  const start = styles.indexOf(`\n${selector}{`);
  assert.notEqual(start, -1, `expected a base-level rule for ${selector}`);
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

test("the ghosted letter itself is untouched - still the same size/opacity/position, still the bulk-edit column-select target", () => {
  const rule = functionBodyLikeRule(".splitLayerTitle");
  assert.match(rule, /font-size:64px;/);
  assert.match(rule, /opacity:\.14;/);
  assert.match(rule, /pointer-events:none;/);
});

test("the percentage number is bigger and bolder than before, still right-aligned in its own small field", () => {
  const rule = functionBodyLikeRule(".splitLayerPct input");
  assert.match(rule, /font-size:15px;/);
  assert.match(rule, /font-weight:900;/);
  assert.match(rule, /text-align:right;/);
});

test("Copy is now a real bordered pill button (border, background, radius, full opacity) instead of a faint plain-text link only revealed clearly on hover", () => {
  const rule = functionBodyLikeRule(".splitCopyBtn");
  assert.match(rule, /border:1px solid var\(--btn-secondary-border\);/);
  assert.match(rule, /border-radius:999px;/);
  assert.match(rule, /background:var\(--btn-secondary-bg\);/);
  assert.match(rule, /color:var\(--title\);/);
  assert.match(rule, /opacity:1;/);
});

test("Copy's hover/focus state shifts to the same gradient-fill treatment used elsewhere in this redesign, not the old underline", () => {
  const hoverStart = styles.indexOf(".splitCopyBtn:hover,.splitCopyBtn:focus-visible{");
  assert.notEqual(hoverStart, -1);
  const hoverRule = styles.slice(hoverStart, styles.indexOf("}", hoverStart) + 1);
  assert.match(hoverRule, /background:linear-gradient\(180deg, var\(--btn-primary-a\), var\(--btn-primary-b\)\);/);
  assert.doesNotMatch(hoverRule, /text-decoration:underline/);
});

test("the desktop pill treatment cannot leak onto phones - the header Copy button is hidden there outright", () => {
  /* This used to check that the phone block re-styled .splitCopyBtn to strip
   * the desktop pill's border, background and radius - an intentional
   * override rather than a leak.
   *
   * There is nothing left to override. Copy between layers is a
   * desktop/tablet utility; on phones it lives in the Edit toolbar, and the
   * header button is hidden outright. The phone re-styling was dead the whole
   * time it was being asserted here, so it went, and the guarantee this test
   * makes is now the stronger one: the desktop pill cannot appear on a phone
   * because the element it styles never renders there. */
  const { rulesUnder } = require("./css-media");
  const phone = rulesUnder(styles).replace(/\/\*[\s\S]*?\*\//g, "");
  const copyRules = [...phone.matchAll(/([^{}]*)\{([^}]*)\}/g)]
    .filter(m => /splitCopyBtn/.test(m[1]))
    .map(m => m[1].replace(/\s+/g, " ").trim() + " {" + m[2].replace(/\s+/g, " ").trim() + "}");
  assert.deepEqual(copyRules, [".splitsMatrix.compactMobileRecipe .splitCopyBtn {display:none;}"],
    "the phone stylesheet should only hide the header Copy button, never style it");
});
