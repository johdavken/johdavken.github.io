"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");
const theme = fs.readFileSync("theme.css", "utf8");

test("--recipe-pill-accent/--recipe-pill-danger default to the tokens the pill fills always used, so every theme without an override is pixel-unchanged", () => {
  assert.match(styles, /--focus-border: rgba\(74,163,255,\.80\);\s*\n\s*--focus-ring: rgba\(74,163,255,\.16\);\s*\n[\s\S]*?--recipe-pill-accent: var\(--focus-border\);\s*\n\s*--recipe-pill-danger: var\(--bad\);/, "expected the fallback declarations to sit in :root, right after the base focus-border tokens");
});

test("Industrial Slate mutes only the pill's danger fill, not the shared --bad token everything else (validation, error states) still reads", () => {
  const start = theme.indexOf(':where(html, body)[data-theme="industrial-slate"]{');
  assert.notEqual(start, -1);
  const block = theme.slice(start, theme.indexOf("\n}\n", start));
  assert.match(block, /--bad: #dc2626;/, "the global --bad token must stay untouched - other UI still reads it");
  assert.match(block, /--recipe-pill-danger: #a05355;/);
});

test("Gruvbox (dark and light) point the pill's accent fill at the theme's own green instead of its shared focus color", () => {
  assert.match(styles, /body\[data-theme="gruvbox-dark"\]\{[\s\S]*?--recipe-pill-accent: var\(--gruv-green\);\s*\n\}/);
  assert.match(styles, /body\[data-theme="gruvbox-light"\]\{[\s\S]*?--recipe-pill-accent: var\(--gruv-green\);\s*\n\}/);
  // The two variants retain distinct traditional focus cues, while the pill
  // deliberately stays green so it doesn't read as a caution action.
  assert.match(theme, /:where\(html, body\)\[data-theme="gruvbox-dark"\]\{[\s\S]*?--focus-border: rgba\(201,180,107,\.88\);/);
  assert.match(theme, /:where\(html, body\)\[data-theme="gruvbox-light"\]\{[\s\S]*?--focus-border: rgba\(69,88,129,\.88\);/);
});

test("themes without a dedicated recipe-pill treatment keep falling back to --focus-border/--bad", () => {
  for (const themeName of ["industrial-slate-dark", "nord", "everforest", "newsprint", "ayu-light", "oled-black", "rose-pine-dawn"]) {
    const start = theme.indexOf(`:where(html, body)[data-theme="${themeName}"]{`);
    assert.notEqual(start, -1, `expected a theme.css block for ${themeName}`);
    const block = theme.slice(start, theme.indexOf("\n}\n", start));
    assert.doesNotMatch(block, /--recipe-pill-accent:|--recipe-pill-danger:/, `${themeName} should not override the pill tokens`);
  }
});
