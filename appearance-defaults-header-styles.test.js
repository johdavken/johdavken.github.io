"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

// Two independent changes: (1) the default theme moved from Everforest to
// Industrial Slate ("mse") everywhere a default is asserted, and (2) the
// Header style picker - added specifically so the operator could preview
// several font treatments (Monospace, Condensed, System Sans, Bold Slab,
// Editorial Serif, Rounded Grotesk, Wide Display) - served its purpose:
// Wide Display was chosen, and the picker (plus the other 6 styles' CSS)
// is now gone. The chosen look is just the permanent, unconditional
// .layerTitle/.workspaceNavButton span/.setupSectionTitle/.toolsIndexButton
// styling, with no body[data-header-style] switch left to key off of.

test("Light reuses Industrial Slate (mse) as the default implementation", () => {
  assert.match(html, /<html lang="en" data-theme="mse">/);
  assert.match(html, /<body[^>]*data-theme="mse"/);
  const optStart = html.indexOf('value="mse"');
  const opt = html.slice(optStart, html.indexOf("</option>", optStart));
  assert.match(opt, /selected/);
  assert.match(opt, />Light/);
  assert.doesNotMatch(html, /value="everforest"/);
});

test("theme migration has a deterministic mse fallback", () => {
  assert.doesNotMatch(app, /: String\(t\) : "everforest"/);
  assert.doesNotMatch(app, /payload\.theme \|\| "everforest"/);
  assert.doesNotMatch(app, /applyTheme\("everforest"\)/);
  assert.doesNotMatch(app, /state\.theme \|\| "everforest"/);
  assert.match(app, /theme: "mse",/);
  assert.match(app, /const theme = migrations\.get\(saved\) \|\| "mse";/);
  assert.match(app, /applyTheme\(payload\.theme \|\| "mse"\);/);
  assert.match(app, /applyTheme\("mse"\);/);
  assert.match(app, /applyTheme\(state\.theme \|\| "mse"\);/);
});

test("the Header style picker is gone from Settings, and so is the body attribute it used to drive", () => {
  // headerStyleSel is gone outright - no id, no label referencing it. The
  // words "Header style" can still legitimately appear in the Changelog's
  // historical entry recording when the (now-removed) preference first
  // shipped, so that phrase alone isn't checked here.
  assert.doesNotMatch(html, /headerStyleSel/);
  assert.doesNotMatch(html, /data-header-style/);
});

test("app.js has no remaining headerStyle state, apply function, or select listener", () => {
  assert.doesNotMatch(app, /headerStyle/i);
  assert.doesNotMatch(app, /applyHeaderStyle/);
});

test("styles.css has no leftover body[data-header-style=...] rules for any of the 6 retired styles", () => {
  assert.doesNotMatch(styles, /data-header-style/);
});

test("Wide Display's look (thin weight, wide tracking, all caps) is now the permanent, unconditional .layerTitle/.workspaceNavButton span treatment", () => {
  const start = styles.indexOf(".layerTitle,\n.workspaceNavButton span{");
  assert.notEqual(start, -1, "expected .layerTitle and .workspaceNavButton span to share one unconditional rule");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;/);
  assert.match(rule, /font-weight: 300;/);
  assert.match(rule, /text-transform: uppercase;/);
  assert.match(rule, /letter-spacing: \.22em;/);
});

test("the one-level-down section headings (.setupSectionTitle, .toolsIndexButton) pick up the same font family unconditionally too", () => {
  const start = styles.indexOf(".setupSectionTitle,\n.toolsIndexButton{");
  assert.notEqual(start, -1);
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;/);
});
