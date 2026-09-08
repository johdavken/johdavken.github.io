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
  assert.equal(T.isPaletteBlock(':where(html, body)[data-theme="industrial-slate-dark"]'), true);
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

/* ---------------- Phase 4: impactCount / walkConsumers -------------- */

// A DOM-free stand-in for document.body: matches nothing, has no ancestors.
// Lets walkConsumers' direct-consumer collection + theme filtering + BFS
// structure be unit-tested; routing (which needs live computed styles) then
// resolves to "not confirmed" for every branch, which is the expected
// DOM-free outcome.
function fakeBody() {
  var win = {
    matchMedia: function () { return { matches: true }; },
    CSS: { supports: function () { return true; } },
    getComputedStyle: function () { return { getPropertyValue: function () { return ""; } }; },
  };
  var body = {
    nodeType: 1,
    tagName: "BODY",
    id: "",
    className: "",
    style: { getPropertyValue: function () { return ""; } },
    parentElement: null,
    matches: function () { return false; },
  };
  body.ownerDocument = { documentElement: body, body: body, defaultView: win };
  return body;
}

function realIndexAndRefMap() {
  var files = ["styles.css", "theme.css", "button-styling.css", "desktop.css"];
  var rules = [];
  files.forEach(function (f) {
    rules = rules.concat(T.parseStylesheet(read(f), { sheet: f }));
  });
  var index = { rules: rules, sheetOrder: files, sheets: files };
  return { index: index, refMap: T.buildRefMap(index) };
}

test("walkConsumers: direct consumers of --btnstyle-ink are all in the ayu-light-allowed set", () => {
  var b = realIndexAndRefMap();
  var walk = T.walkConsumers(
    "--btnstyle-ink",
    b.index,
    b.refMap.byToken,
    { name: "ayu-light" },
    fakeBody()
  );
  // Every direct entry is a real CSS property (not a producer) and either
  // theme-agnostic or scoped to ayu-light.
  assert.ok(walk.direct.length > 20, "--btnstyle-ink has many direct consumers");
  walk.direct.forEach(function (e) {
    assert.equal(e.producesToken, null);
    assert.ok(!e.themeScopeMatch || e.themeScopeMatch === "ayu-light");
  });
  // The Phase 2 / Phase 3 landmark: recipePageTab.active background @ 224.
  assert.ok(
    walk.direct.some(function (e) {
      return e.file === "button-styling.css" && e.line === 224 && e.prop === "background";
    })
  );
  // --btnstyle-ink is a leaf token: nothing defines a component token as
  // var(--btnstyle-ink), so no branches.
  assert.equal(walk.branches.length, 0);
});

test("walkConsumers: --focus-border produces component-token branches", () => {
  var b = realIndexAndRefMap();
  var walk = T.walkConsumers(
    "--focus-border",
    b.index,
    b.refMap.byToken,
    { name: "ayu-light" },
    fakeBody()
  );
  var throughTokens = walk.branches.map(function (br) { return br.through[br.through.length - 1]; });
  assert.ok(throughTokens.indexOf("--recipe-pill-accent") !== -1);
  assert.ok(throughTokens.indexOf("--btnstyle-accent") !== -1);
  // every branch carries a through-path starting at the target
  walk.branches.forEach(function (br) {
    assert.equal(br.through[0], "--focus-border");
    assert.ok(Array.isArray(br.entries));
  });
});

test("walkConsumers: theme scoping splits direct vs otherThemeDirect", () => {
  var b = realIndexAndRefMap();
  var ayu = T.walkConsumers("--text", b.index, b.refMap.byToken, { name: "ayu-light" }, fakeBody());
  var gruv = T.walkConsumers("--text", b.index, b.refMap.byToken, { name: "gruvbox-dark" }, fakeBody());
  // --text has consumers scoped to specific themes; the allowed set differs
  // between two themes, but the union (direct + otherThemeDirect) is stable.
  assert.equal(
    ayu.direct.length + ayu.otherThemeDirect.length,
    gruv.direct.length + gruv.otherThemeDirect.length
  );
  assert.notDeepEqual(
    ayu.direct.map(function (e) { return e.selector; }).sort(),
    gruv.direct.map(function (e) { return e.selector; }).sort()
  );
});

test("bumpLiveGen advances the generation and invalidate() bumps it too", () => {
  var g0 = T.liveGen();
  T.bumpLiveGen();
  assert.equal(T.liveGen(), g0 + 1);
  T.invalidate();
  assert.equal(T.liveGen(), g0 + 2);
});

/* ---------------- Phase 5: coverage summary + state-pseudo split -------- */

test("hasStatePseudo flags interaction states, not structural pseudos", () => {
  assert.equal(T.hasStatePseudo("a:hover"), true);
  assert.equal(T.hasStatePseudo("button:focus-visible"), true);
  assert.equal(T.hasStatePseudo(".x:active .y"), true);
  assert.equal(T.hasStatePseudo("li:first-child"), false);
  assert.equal(T.hasStatePseudo(".card .title"), false);
  assert.equal(T.hasStatePseudo("input:disabled"), false); // not a transient state
});

test("summarizeCoverage: rendering vs off-screen vs unused vs pending", () => {
  const counts = {
    "--a": { onScreen: 5, hasConsumers: true },   // rendering
    "--b": { onScreen: 0, hasConsumers: true },   // off-screen (used, not visible)
    "--c": { onScreen: 0, hasConsumers: false },  // unused (nothing references it)
    "--d": { pending: true },                     // not counted yet
    "--e": { onScreen: 1, hasConsumers: true },   // rendering
    "--f": { onScreen: 0, hasConsumers: false },  // unused
    "--g": { error: "bad selector" },             // errored, excluded from buckets
  };
  const inherited = new Set(["--c"]); // palette doesn't declare --c
  const s = T.summarizeCoverage(counts, inherited);
  assert.equal(s.total, 7);
  assert.equal(s.rendering, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.errored, 1);
  assert.deepEqual(s.offScreen.map((x) => x.name), ["--b"]);
  assert.deepEqual(s.unused.map((x) => x.name).sort(), ["--c", "--f"]);
  assert.equal(s.unused.find((x) => x.name === "--c").inherited, true);
  assert.equal(s.unused.find((x) => x.name === "--f").inherited, false);
  assert.equal(s.zero, 3);
});

test("summarizeCoverage accepts a plain array for `inherited` too", () => {
  const s = T.summarizeCoverage(
    { "--x": { onScreen: 0, hasConsumers: false } },
    ["--x"]
  );
  assert.equal(s.unused[0].inherited, true);
});

// Minimal fake document for countVisibleUnique: each selector maps to a list
// of fake elements; getClientRects() length flags "visible".
function fakeDoc(map) {
  var nodes = {};
  function node(id, visible) {
    if (!nodes[id]) nodes[id] = { _id: id, getClientRects: function () { return visible ? [{}] : []; } };
    return nodes[id];
  }
  return {
    querySelectorAll: function (sel) {
      var spec = map[sel] || [];
      return spec.map(function (s) { return node(s.id, s.visible !== false); });
    },
  };
}

test("countVisibleUnique splits static vs state-pseudo matches and de-dupes", () => {
  // Selectors are pseudo-stripped before matching, so the fake doc is keyed
  // by the stripped form. Static consumers reach A,B (visible) + C (hidden);
  // a :focus-visible consumer strips to `.copyBtn`, matching D (a new,
  // visible element) plus A (already counted in the static pass).
  const doc = fakeDoc({
    ".btn": [{ id: "A" }, { id: "B" }, { id: "C", visible: false }],
    ".tab": [{ id: "A" }],
    ".copyBtn": [{ id: "D" }, { id: "A" }],
  });
  const r = T.countVisibleUnique(doc, [".btn", ".tab", ".copyBtn:focus-visible"]);
  assert.equal(r.onScreenStatic, 2); // A, B
  assert.equal(r.onScreenStateExtra, 1); // D only (A already seen, C hidden)
  assert.equal(r.onScreen, 3);
  assert.equal(r.stateSelectorCount, 1);
});

/* ---------------- Phase 6: coverage filter predicate ------------------- */

test("coverageMatch: All passes everything", () => {
  assert.equal(T.coverageMatch({ onScreen: 0, hasConsumers: true }, "all"), true);
  assert.equal(T.coverageMatch({ onScreen: 5 }, "all"), true);
  assert.equal(T.coverageMatch(undefined, "all"), true);
  assert.equal(T.coverageMatch({ pending: true }, undefined), true); // default = all
});

test("coverageMatch: Rendering only keeps onScreen>0", () => {
  assert.equal(T.coverageMatch({ onScreen: 3 }, "rendering"), true);
  assert.equal(T.coverageMatch({ onScreen: 0, hasConsumers: true }, "rendering"), false);
  assert.equal(T.coverageMatch({ onScreen: 0, hasConsumers: false }, "rendering"), false);
});

test("coverageMatch: Off screen only keeps onScreen===0", () => {
  assert.equal(T.coverageMatch({ onScreen: 0, hasConsumers: true }, "offscreen"), true);
  assert.equal(T.coverageMatch({ onScreen: 0, hasConsumers: false }, "offscreen"), true);
  assert.equal(T.coverageMatch({ onScreen: 2 }, "offscreen"), false);
});

test("coverageMatch: pending/errored tokens pass every mode (never hidden)", () => {
  ["rendering", "offscreen", "all"].forEach((mode) => {
    assert.equal(T.coverageMatch({ pending: true }, mode), true);
    assert.equal(T.coverageMatch({ error: "bad" }, mode), true);
    assert.equal(T.coverageMatch(null, mode), true);
  });
});

test("coverageMatch composes with summarizeCoverage — counts add up", () => {
  const counts = {
    "--a": { onScreen: 5, hasConsumers: true },
    "--b": { onScreen: 0, hasConsumers: true },
    "--c": { onScreen: 0, hasConsumers: false },
    "--d": { onScreen: 1, hasConsumers: true },
  };
  const s = T.summarizeCoverage(counts, []);
  const names = Object.keys(counts);
  const rendering = names.filter((n) => T.coverageMatch(counts[n], "rendering"));
  const offscreen = names.filter((n) => T.coverageMatch(counts[n], "offscreen"));
  assert.equal(rendering.length, s.rendering);          // 2
  assert.equal(offscreen.length, s.zero);               // 2
  assert.equal(rendering.length + offscreen.length, names.length);
});
