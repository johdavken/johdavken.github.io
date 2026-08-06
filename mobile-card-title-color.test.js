"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// Desktop's sidebar nav already uses two colors for section titles: --muted
// normally, --title once .workspaceNavButton is .active. Mobile's cards
// reuse the same two tokens, with [open] standing in for desktop's .active.
// Confirmed on Dark and Light first (explicitly requested), then widened to
// every theme - theme-agnostic on purpose, since --muted/--title are
// already theme-aware tokens, so every data-theme value picks up correct
// colors automatically without enumerating each one here.

function mobileBlock(){
  const start = styles.indexOf("@media (max-width:900px)");
  assert.notEqual(start, -1, "expected the mobile media query block");
  const end = styles.indexOf("\n}", start);
  return styles.slice(start, end);
}

test("desktop's nav button uses --muted normally and --title once .active - mobile's card title reuses the exact same two tokens", () => {
  const activeStart = styles.indexOf(".workspaceNavButton.active{");
  const activeEnd = styles.indexOf("}", activeStart);
  const activeBody = styles.slice(activeStart, activeEnd);
  assert.match(activeBody, /color: var\(--title\);/);
  const mobile = mobileBlock();
  assert.match(mobile, /\.workspaceContent > \.workspacePanel > summary \.layerTitle\{[\s\S]{0,80}color: var\(--muted\);/);
  assert.match(mobile, /\.workspaceContent > \.workspacePanel\[open\] > summary \.layerTitle\{ color: var\(--title\); \}/);
});

test("theme-agnostic, not scoped to specific data-theme values - every theme picks this up automatically since --muted/--title are already theme-aware", () => {
  const mobile = mobileBlock();
  assert.doesNotMatch(mobile, /data-theme=/, "the title-color rule must not be gated behind specific themes anymore");
});

test("every theme defined in theme.css sets its own --muted and --title, so the mobile card-title treatment has a real effect everywhere, not just Dark/Light", () => {
  const theme = fs.readFileSync("theme.css", "utf8");
  const themeNames = [...theme.matchAll(/data-theme="([^"]+)"/g)].map(m => m[1]);
  const uniqueThemes = [...new Set(themeNames)];
  assert.ok(uniqueThemes.length >= 20, `expected the full theme set, found ${uniqueThemes.length}`);
  uniqueThemes.forEach(name => {
    // Some themes (mono/monochrome) share one rule via a combined selector
    // list, so the block's own `{` doesn't immediately follow this specific
    // [data-theme="X"] token - find the next `{` after it instead of
    // assuming it's adjacent.
    const selectorIndex = theme.indexOf(`[data-theme="${name}"]`);
    assert.notEqual(selectorIndex, -1, `expected a [data-theme="${name}"] selector`);
    const blockStart = theme.indexOf("{", selectorIndex);
    const blockEnd = theme.indexOf("}", blockStart);
    const block = theme.slice(blockStart, blockEnd);
    assert.match(block, /--muted:/, `${name} must define --muted`);
    assert.match(block, /--title:/, `${name} must define --title`);
  });
});

test("data-theme is actually set on both html and body in app.js, matching how theme.css's own :where(html, body) selectors expect it", () => {
  const app = fs.readFileSync("app.js", "utf8");
  assert.match(app, /document\.documentElement\.setAttribute\("data-theme", theme\);/);
  assert.match(app, /document\.body\.setAttribute\("data-theme", theme\);/);
});
