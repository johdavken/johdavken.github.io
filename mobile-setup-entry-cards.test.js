"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("Receiver Hopper Weights and Profiles retain their shared desktop markup but gain separate themed SVG entry art", () => {
  assert.match(html, /mobileSetupEntryArt mobileWeightsEntryArt/);
  assert.match(html, /mobileSetupEntryArt mobileProfilesEntryArt/);
  assert.match(html, /entryHopperShell/);
  assert.match(html, /entryProfileFront/);
  assert.match(styles, /\.mobileSetupEntryArt\{ display:none; \}/);
  assert.match(styles, /#lineSetupBlock #weightsBlock > summary/);
  assert.match(styles, /#lineSetupBlock #setupWeightProfilesBlock > summary/);
});

test("mobile entry art uses theme-aware CSS colors, lightweight transform animation, and respects reduced motion", () => {
  assert.match(styles, /color:var\(--focus-border\)/);
  assert.match(styles, /fill:color-mix\(in srgb,var\(--ok\) 28%,transparent\)/);
  assert.match(styles, /animation:mobileHopperFill/);
  assert.match(styles, /@keyframes mobileHopperFill/);
  assert.match(styles, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(styles, /animation:none/);
});

test("mobile headers and card titles use a stronger theme-neutral weight while body copy remains separate", () => {
  assert.match(styles, /\.workspaceNavButton span,[\s\S]*?\.workspaceConfigurationSectionTitle strong,[\s\S]*?font-weight:800; font-synthesis:none;/);
  assert.match(styles, /:is\(h1,h2,h3,h4,h5,h6\)/);
});
