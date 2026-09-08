"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const probe = require("./tools/css-parity/probe.js");

// The probe is the one check in this repo that reads the rendered page rather
// than the stylesheet text, so its own logic needs to be trustworthy: a diff
// that silently returns "no change" would be worse than having no tool.

function snapshot(overrides) {
  return Object.assign({
    viewport: "1600x1000",
    sheets: 5,
    ruleCount: 2,
    rulesSum: "aaaaaaaa",
    outlineCount: 1,
    outlinesSum: "bbbbbbbb",
    offsets: { "2px": 40, "1px": 12 },
    themeSums: { "ayu-light": "1111", "industrial-slate": "1111" },
  }, overrides);
}

test("an unchanged snapshot diffs to nothing", () => {
  assert.deepEqual(probe.diff(snapshot(), snapshot()), []);
});

test("a changed rule set is reported", () => {
  const found = probe.diff(snapshot(), snapshot({ rulesSum: "cccccccc" }));
  assert.equal(found.length, 1);
  assert.match(found[0].what, /set of CSS rules changed/);
});

test("a lost or gained rule is reported through the count as well as the checksum", () => {
  const found = probe.diff(snapshot(), snapshot({ ruleCount: 1, rulesSum: "cccccccc" }));
  assert.equal(found.length, 2);
  assert.ok(found.some(f => f.what === "ruleCount"));
});

test("a moved outline-offset is reported per bucket", () => {
  const found = probe.diff(snapshot(), snapshot({ offsets: { "2px": 39, "1px": 13 } }));
  assert.deepEqual(found.map(f => f.what).sort(), ["outline-offset 1px count", "outline-offset 2px count"]);
});

test("a theme whose layout moved is named, so the drill-down knows where to look", () => {
  const found = probe.diff(snapshot(), snapshot({ themeSums: { "ayu-light": "9999", "industrial-slate": "1111" } }));
  assert.equal(found.length, 1);
  assert.match(found[0].what, /theme ayu-light layout changed/);
  assert.match(found[0].what, /--print-detail ayu-light/);
});

test("snapshots from different viewports refuse to be compared at all", () => {
  // Comparing them would produce a wall of meaningless differences and hide
  // whatever the change actually did.
  const found = probe.diff(snapshot(), snapshot({ viewport: "390x844", ruleCount: 999 }));
  assert.equal(found.length, 1);
  assert.match(found[0].what, /not comparable/);
});

test("the drill-down diff names the exact property, not just the theme", () => {
  const detail = t => ({ theme: t, snapshot: { rail: { box: "240x900", style: { paddingTop: "5px", minHeight: "84px" } } } });
  const before = snapshot({ detail: detail("ayu-light") });
  const afterDetail = detail("ayu-light");
  afterDetail.snapshot.rail.style.paddingTop = "14px";
  afterDetail.snapshot.rail.box = "226x900";
  const found = probe.diff(before, snapshot({ detail: afterDetail }));
  assert.deepEqual(found.map(f => f.what).sort(), ["ayu-light / rail box", "ayu-light / rail paddingTop"]);
});

test("themeParity groups by identical layout", () => {
  const one = probe.themeParity(snapshot());
  assert.equal(one.length, 1, "themes with the same checksum are one group");
  const two = probe.themeParity(snapshot({ themeSums: { a: "1111", b: "2222", c: "1111" } }));
  assert.equal(two.length, 2);
  assert.deepEqual(two.map(g => g.sort()).sort(), [["a", "c"], ["b"]]);
});

test("the generated probe expression is self-contained and safely evaluable", () => {
  const src = probe.buildProbe();
  assert.match(src, /^\(\(\) => \{/);
  assert.match(src, /\}\)\(\)$/);
  // It must carry its own constants - nothing is injected at eval time.
  for (const theme of probe.THEMES) assert.ok(src.includes(theme), `probe omits ${theme}`);
  // The CSS Nesting trap: recursion must test .length, not truthiness, or it
  // skips every style rule and silently reports zero.
  assert.match(src, /r\.cssRules && r\.cssRules\.length/);
  // It must put the page back the way it found it.
  assert.match(src, /if \(htmlTheme\) document\.documentElement\.setAttribute\("data-theme", htmlTheme\)/);
  assert.doesNotMatch(src, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage/);
});

test("the drill-down variants are distinct and carry their target", () => {
  assert.match(probe.buildProbe({ detail: "ayu-light" }), /const DETAIL = "ayu-light"/);
  assert.match(probe.buildProbe({ detail: "rules" }), /const DETAIL = "rules"/);
  assert.match(probe.buildProbe(), /const DETAIL = null/);
});

test("the tool stays out of the shipped app", () => {
  // build-www copies only what index.html references; tools/ must never be
  // reachable from it, or the probe would ship inside the Android APK.
  const html = fs.readFileSync("index.html", "utf8");
  assert.doesNotMatch(html, /tools\/css-parity/);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  for (const name of ["playwright", "puppeteer", "jsdom", "postcss"]) {
    assert.ok(!deps.includes(name), `${name} must not become a dependency of this project`);
  }
});

test("the probe's derived-attribute map stays in step with app.js", () => {
  // The probe sets data-theme itself instead of calling applyTheme, so if
  // app.js changes which themes belong to a group and the probe does not
  // follow, every capture silently mismeasures those themes.
  const app = fs.readFileSync("app.js", "utf8");
  for (const derived of probe.DERIVED_ATTRIBUTES) {
    assert.ok(app.includes(`"${derived.attr}", "${derived.value}"`),
      `app.js no longer sets ${derived.attr}="${derived.value}" - the probe would mismeasure`);
    const block = app.slice(app.indexOf("const TERMINAL_RAIL_THEMES"), app.indexOf("function applyThemeGroupings"));
    for (const theme of derived.themes) {
      assert.ok(block.includes(`"${theme}"`), `app.js does not list ${theme} in the ${derived.attr} group`);
    }
    const listed = [...block.matchAll(/"([a-z-]+)"/g)].map(m => m[1]);
    assert.deepEqual(listed.sort(), [...derived.themes].sort(),
      `the probe and app.js disagree about which themes get ${derived.attr}`);
  }
});
