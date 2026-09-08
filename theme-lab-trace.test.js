"use strict";

/* Tests for the developer-only Theme Lab CSS cascade / token-source tracer
 * (tools/theme-lab/css-trace.js). Covers the pure, DOM-free helpers:
 * stylesheet parsing with line accuracy, specificity, and var() inspection.
 * The DOM-bound cascade resolution is exercised in-browser against the real
 * app (see the Phase 2 report), not here — the repo has no jsdom. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const T = require("./tools/theme-lab/css-trace.js");

const read = (f) => fs.readFileSync(path.join(__dirname, f), "utf8");

/* ------------------------- stripComments ------------------------- */

test("stripComments removes comments but preserves line numbers", () => {
  const src = "a{color:red}\n/* multi\n   line */\nb{color:blue}\n";
  const out = T.stripComments(src);
  assert.equal(out.split("\n").length, src.split("\n").length);
  assert.doesNotMatch(out, /multi/);
  assert.match(out.split("\n")[3], /b\{color:blue\}/);
});

/* ------------------------ parseStylesheet ----------------------- */

test("parseStylesheet reports accurate line numbers and media chains", () => {
  const css = [
    /* 1 */ ":root{",
    /* 2 */ "  --x: #111;",
    /* 3 */ "  --y: var(--x);",
    /* 4 */ "}",
    /* 5 */ "",
    /* 6 */ "@media (min-width: 901px) and (pointer: fine){",
    /* 7 */ "  .a,",
    /* 8 */ "  .b{",
    /* 9 */ "    color: var(--y);",
    /* 10 */ "    background: red !important;",
    /* 11 */ "  }",
    /* 12 */ "}",
  ].join("\n");
  const rules = T.parseStylesheet(css, { sheet: "t.css" });

  const root = rules.find((r) => r.selector === ":root");
  assert.equal(root.line, 1);
  assert.equal(root.declarations.find((d) => d.prop === "--x").line, 2);
  assert.equal(root.declarations.find((d) => d.prop === "--y").line, 3);
  assert.equal(root.declarations.find((d) => d.prop === "--y").value, "var(--x)");

  // grouped selector -> two rule records sharing declarations
  const a = rules.find((r) => r.selector === ".a");
  const b = rules.find((r) => r.selector === ".b");
  assert.ok(a && b);
  assert.equal(a.line, 7);
  assert.equal(b.line, 8);
  assert.deepEqual(
    a.media.map((m) => m.prelude),
    ["@media (min-width: 901px) and (pointer: fine)"]
  );
  const colorDecl = b.declarations.find((d) => d.prop === "color");
  assert.equal(colorDecl.line, 9);
  assert.equal(colorDecl.value, "var(--y)");
  const bg = b.declarations.find((d) => d.prop === "background");
  assert.equal(bg.important, true);
  assert.equal(bg.value, "red");
});

test("parseStylesheet skips @keyframes/@font-face bodies", () => {
  const css = [
    "@keyframes spin { from { transform: rotate(0) } to { transform: rotate(360deg) } }",
    ".x{color:red}",
  ].join("\n");
  const rules = T.parseStylesheet(css, { sheet: "k.css" });
  assert.ok(rules.every((r) => r.selector !== "from" && r.selector !== "to"));
  assert.ok(rules.some((r) => r.selector === ".x"));
});

test("parseStylesheet matches the real button-styling.css structure", () => {
  const rules = T.parseStylesheet(read("button-styling.css"), {
    sheet: "button-styling.css",
  });
  const bodyRule = rules.find(
    (r) => r.selector === "body" && r.declarations.some((d) => d.prop === "--btnstyle-ink")
  );
  assert.ok(bodyRule, "body{} rule with --btnstyle-ink");
  const ink = bodyRule.declarations.find((d) => d.prop === "--btnstyle-ink");
  assert.equal(ink.value, "var(--text)");
  assert.equal(ink.line, 87);

  const activeTab = rules.find(
    (r) =>
      r.selector === "body #splitsBlock .recipePageTab.active" &&
      r.declarations.some((d) => d.prop === "background")
  );
  assert.ok(activeTab, "active recipe page tab rule");
  assert.equal(activeTab.line, 220);
  assert.equal(
    activeTab.declarations.find((d) => d.prop === "background").value,
    "var(--btnstyle-ink)"
  );
  assert.deepEqual(
    activeTab.media.map((m) => m.prelude),
    ["@media (min-width: 901px) and (pointer: fine)"]
  );
});

test("parseStylesheet locates palette-block tokens in the real theme.css", () => {
  const rules = T.parseStylesheet(read("theme.css"), { sheet: "theme.css" });
  const ayu = rules.find(
    (r) => r.selector === ':where(html, body)[data-theme="ayu-light"]'
  );
  assert.ok(ayu, "ayu-light palette block");
  assert.equal(T.isPaletteBlock(ayu.selector), true);
  const bad = ayu.declarations.find((d) => d.prop === "--bad");
  assert.equal(bad.value, "#e65050");
  // The theme-scoped descendant overrides are NOT palette blocks.
  const logoOverride = rules.find(
    (r) => /\.rtLayerRed$/.test(r.selector) && /ayu-light/.test(r.selector)
  );
  if (logoOverride) assert.equal(T.isPaletteBlock(logoOverride.selector), false);
});

/* ------------------------- specificity ------------------------- */

test("computeSpecificity", () => {
  assert.deepEqual(T.computeSpecificity("body"), [0, 0, 1]);
  assert.deepEqual(T.computeSpecificity(":root"), [0, 1, 0]);
  assert.deepEqual(T.computeSpecificity("#id"), [1, 0, 0]);
  assert.deepEqual(T.computeSpecificity(".a .b"), [0, 2, 0]);
  assert.deepEqual(
    T.computeSpecificity('body #splitsBlock .recipePageTab.active'),
    [1, 2, 1]
  );
  // :where() contributes nothing; the attribute does
  assert.deepEqual(
    T.computeSpecificity(':where(html, body)[data-theme="ayu-light"]'),
    [0, 1, 0]
  );
  // :is() takes the max of its arguments
  assert.deepEqual(T.computeSpecificity(":is(#a, .b)"), [1, 0, 0]);
});

test("cmpSpec orders correctly", () => {
  assert.ok(T.cmpSpec([0, 1, 0], [0, 0, 5]) > 0);
  assert.ok(T.cmpSpec([1, 0, 0], [0, 9, 9]) > 0);
  assert.equal(T.cmpSpec([0, 1, 1], [0, 1, 1]), 0);
});

/* ---------------------- value inspection ---------------------- */

test("hasTopLevelVar vs hasAnyVar", () => {
  assert.equal(T.hasTopLevelVar("var(--x)"), true);
  assert.equal(T.hasTopLevelVar("color-mix(in srgb, var(--x) 50%, transparent)"), false);
  assert.equal(T.hasAnyVar("color-mix(in srgb, var(--x) 50%, transparent)"), true);
  assert.equal(T.hasAnyVar("#fff"), false);
});

test("firstVarRef handles a nested fallback", () => {
  const r = T.firstVarRef("var(--recipe-pill-danger, var(--bad))");
  assert.equal(r.name, "--recipe-pill-danger");
  assert.equal(r.fallback, "var(--bad)");
  assert.equal(r.before, "");
  assert.equal(r.after, "");
});

test("colorPartOf extracts the colour token from shorthands", () => {
  assert.equal(T.colorPartOf("border", "1px solid var(--btnstyle-edge)"), "var(--btnstyle-edge)");
  assert.equal(T.colorPartOf("background", "var(--btnstyle-ink)"), "var(--btnstyle-ink)");
  assert.equal(T.colorPartOf("background", "#f5f4f3 url(x.png) no-repeat"), "#f5f4f3");
  assert.equal(T.colorPartOf("color", "var(--panel)"), "var(--panel)");
  assert.equal(T.colorPartOf("background", "linear-gradient(#000, #111)"), null);
});

test("splitTopLevel respects parens and brackets", () => {
  assert.deepEqual(T.splitTopLevel("a, b, c", ","), ["a", " b", " c"]);
  assert.deepEqual(
    T.splitTopLevel(":is(a, b), .c[x=\"y,z\"]", ","),
    [":is(a, b)", ' .c[x="y,z"]']
  );
});

test("isPaletteBlock only matches the canonical palette root selector", () => {
  assert.equal(T.isPaletteBlock(':where(html, body)[data-theme="dark"]'), true);
  assert.equal(T.isPaletteBlock(':where(html, body)[data-theme="ayu-light"] .rtLayerRed'), false);
  assert.equal(T.isPaletteBlock('body[data-theme="ayu-light"] #splitsArea .splitInput'), false);
  assert.equal(T.isPaletteBlock(":root"), false);
});

/* ---------------- Phase 3: reverse lookup helpers --------------- */

test("allVarNames collects every referenced custom property, any depth", () => {
  assert.deepEqual(T.allVarNames("var(--a)"), ["--a"]);
  assert.deepEqual(
    T.allVarNames("var(--recipe-pill-danger, var(--bad))"),
    ["--recipe-pill-danger", "--bad"]
  );
  assert.deepEqual(
    T.allVarNames("color-mix(in srgb, var(--focus-border) 9%, transparent)"),
    ["--focus-border"]
  );
  assert.deepEqual(T.allVarNames("1px solid var(--x)"), ["--x"]);
  assert.deepEqual(T.allVarNames("#fff"), []);
  // de-duplicates
  assert.deepEqual(T.allVarNames("var(--x) var(--x)"), ["--x"]);
});

test("buildRefMap indexes real declarations that reference a token", () => {
  var files = ["styles.css", "theme.css", "button-styling.css", "desktop.css"];
  var rules = [];
  files.forEach(function (f) {
    rules = rules.concat(T.parseStylesheet(read(f), { sheet: f }));
  });
  var refMap = T.buildRefMap({ rules: rules, sheetOrder: files });

  // The base producer `--btnstyle-ink: var(--text)` REFERENCES --text, so it
  // is indexed under --text with producesToken === "--btnstyle-ink".
  var textRefs = refMap.byToken["--text"] || [];
  var base = textRefs.find(function (e) {
    return (
      e.file === "button-styling.css" &&
      e.producesToken === "--btnstyle-ink" &&
      e.line === 87
    );
  });
  assert.ok(base, "button-styling.css:87 --btnstyle-ink: var(--text) indexed under --text");
  assert.equal(base.value, "var(--text)");

  // ...and the active-tab consumer Phase 2 traced by hand is indexed under
  // the token it references, --btnstyle-ink.
  var ink = refMap.byToken["--btnstyle-ink"] || [];
  var activeTabBg = ink.find(function (e) {
    return (
      e.file === "button-styling.css" &&
      e.line === 224 &&
      e.prop === "background" &&
      /recipePageTab\.active/.test(e.selector)
    );
  });
  assert.ok(activeTabBg, "recipePageTab.active background: var(--btnstyle-ink) @ 224 is indexed");
  assert.equal(activeTabBg.producesToken, null, "it is a consumer, not a producer");
});

test("buildRefMap tags the theme a scoped consumer/producer belongs to", () => {
  var rules = T.parseStylesheet(read("theme.css"), { sheet: "theme.css" });
  var refMap = T.buildRefMap({ rules: rules, sheetOrder: ["theme.css"] });
  var btnText = (refMap.byToken["--text"] || []).filter(function (e) {
    return e.producesToken === "--btn-text";
  });
  assert.ok(btnText.length >= 10, "--btn-text: var(--text) appears in many palette blocks");
  // every one is scoped to a specific theme
  assert.ok(btnText.every(function (e) { return !!e.themeScopeMatch; }));
  assert.ok(btnText.some(function (e) { return e.themeScopeMatch === "ayu-light"; }));
});

test("buildRefMap: --focus-border is referenced by component tokens", () => {
  var files = ["styles.css", "theme.css", "button-styling.css", "desktop.css"];
  var rules = [];
  files.forEach(function (f) {
    rules = rules.concat(T.parseStylesheet(read(f), { sheet: f }));
  });
  var refMap = T.buildRefMap({ rules: rules, sheetOrder: files });
  var fb = refMap.byToken["--focus-border"] || [];
  var producers = {};
  fb.forEach(function (e) { if (e.producesToken) producers[e.producesToken] = true; });
  // From the project brief / button-styling.css:83-84
  assert.ok(producers["--recipe-pill-accent"], "--recipe-pill-accent references --focus-border");
  assert.ok(producers["--btnstyle-accent"], "--btnstyle-accent references --focus-border (fallback)");
});

test("subjectDesc builds a compact tag#id.class hint", () => {
  var fake = {
    nodeType: 1,
    tagName: "BUTTON",
    id: "resetAllSplits",
    className: "primary danger huge extra",
    getAttribute: function () { return this.className; },
  };
  var d = T.subjectDesc(fake);
  assert.equal(d.hint, "button#resetAllSplits.primary.danger.huge");
  assert.deepEqual(d.classes.slice(0, 2), ["primary", "danger"]);
});
