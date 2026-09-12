"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const theme = require("./station-theme.js");
const appearance = require("./station/station-appearance.js");
const ROOT = __dirname;

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); }
  };
}

function node(name) {
  const el = {
    tagName: name.toUpperCase(), attributes: {}, children: [], listeners: {}, parent: null, textContent: "",
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    appendChild(child) { this.children.push(child); child.parent = this; return child; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    dispatchEvent(event) { event.target = this; for (const fn of this.listeners[event.type] || []) fn(event); },
    focus() { this.focused = true; }
  };
  return el;
}

function walk(el, visit) { visit(el); for (const child of el.children) walk(child, visit); }
function find(el, predicate) { const out = []; walk(el, candidate => { if (predicate(candidate)) out.push(candidate); }); return out; }
const doc = () => ({ createElement: node });

function relativeLuminance(hex) {
  const channels = hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("the Station registry contains exactly the first three permanent theme ids", () => {
  assert.deepEqual([...theme.THEME_IDS], ["industrial-light", "industrial-dark", "gruvbox-dark"]);
  assert.equal(theme.DEFAULT_THEME, "industrial-dark");
  assert.deepEqual(theme.THEMES.map(item => item.label), ["Industrial Light", "Industrial Dark", "Gruvbox Dark"]);
});

test("a selection changes only the authoritative root attribute and persists locally", () => {
  const root = node("div");
  const machine = node("svg");
  const recipeState = Object.freeze({ resin: "LDPE", pct: 60, revision: 7 });
  root.appendChild(machine);
  const saved = storage();
  const controller = theme.create(root, saved);
  assert.equal(root.getAttribute("data-theme"), "industrial-dark");
  const beforeChild = root.children[0];
  const beforeState = recipeState;
  assert.equal(controller.setTheme("gruvbox-dark"), "gruvbox-dark");
  assert.equal(root.getAttribute("data-theme"), "gruvbox-dark");
  assert.equal(saved.value(theme.STORAGE_KEY), "gruvbox-dark");
  assert.equal(root.children[0], beforeChild, "theme switching recreated Station content");
  assert.equal(recipeState, beforeState, "theme switching replaced machine/recipe state");
});

test("persisted themes restore and invalid or obsolete values fall back safely", () => {
  for (const id of theme.THEME_IDS) {
    const root = node("div");
    const controller = theme.create(root, storage({ [theme.STORAGE_KEY]: id }));
    assert.equal(controller.getTheme(), id);
    assert.equal(root.getAttribute("data-theme"), id);
  }
  for (const invalid of ["", "dark", "system", "rose-pine", "__proto__"]) {
    const root = node("div");
    const controller = theme.create(root, storage({ [theme.STORAGE_KEY]: invalid }));
    assert.equal(controller.getTheme(), theme.DEFAULT_THEME);
    assert.equal(root.getAttribute("data-theme"), theme.DEFAULT_THEME);
  }
  assert.equal(theme.create(node("div"), { getItem() { throw new Error("blocked"); } }).getTheme(), theme.DEFAULT_THEME);
});

test("Handbook Appearance controls select the expected controller theme immediately", () => {
  const root = node("div");
  const saved = storage();
  const controller = theme.create(root, saved);
  const view = appearance.section.create(doc(), { theme: controller, themes: theme.THEMES });
  const choices = find(view.element, el => el.getAttribute("data-theme-choice"));
  assert.deepEqual(choices.map(el => el.getAttribute("data-theme-choice")), [...theme.THEME_IDS]);
  assert.deepEqual(choices.map(el => el.getAttribute("aria-checked")), ["false", "true", "false"]);
  choices[0].dispatchEvent({ type: "click" });
  assert.equal(root.getAttribute("data-theme"), "industrial-light");
  assert.equal(saved.value(theme.STORAGE_KEY), "industrial-light");
  assert.deepEqual(choices.map(el => el.getAttribute("aria-checked")), ["true", "false", "false"]);
});

test("every theme implements one matching semantic token contract and components contain no literal palette", () => {
  const files = theme.THEME_IDS.map(id => path.join(ROOT, "station/styles/themes", `${id}.css`));
  const tokens = css => new Set([...css.matchAll(/--(station-[a-z0-9-]+)\s*:/g)].map(match => match[1]));
  const contracts = files.map(file => tokens(fs.readFileSync(file, "utf8")));
  assert.ok(contracts[0].size > 60, "the semantic contract is unexpectedly small");
  for (const contract of contracts.slice(1)) assert.deepEqual([...contract].sort(), [...contracts[0]].sort());
  for (const [index, file] of files.entries()) {
    const css = fs.readFileSync(file, "utf8");
    assert.match(css, new RegExp(`\\.station-root\\[data-theme="${theme.THEME_IDS[index]}"\\]`));
  }
  const componentFiles = [];
  (function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.name.endsWith(".css") && !file.includes(`${path.sep}themes${path.sep}`)) componentFiles.push(file);
    }
  })(path.join(ROOT, "station/styles"));
  for (const file of componentFiles) {
    const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i, `${path.relative(ROOT, file)} contains a literal palette colour`);
  }
});

test("theme text and semantic status colours meet normal-text contrast against the Station canvas", () => {
  const foregrounds = ["text", "text-muted", "text-faint", "accent", "success", "warning", "danger", "info"];
  for (const id of theme.THEME_IDS) {
    const css = fs.readFileSync(path.join(ROOT, "station/styles/themes", `${id}.css`), "utf8");
    const colours = Object.fromEntries(
      [...css.matchAll(/--station-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})/gi)].map(match => [match[1], match[2]])
    );
    for (const token of foregrounds) {
      assert.ok(contrastRatio(colours[token], colours.bg) >= 4.5, `${id} ${token} is below 4.5:1 on the canvas`);
    }
    assert.ok(contrastRatio(colours["text-on-accent"], colours.accent) >= 4.5, `${id} accent label is below 4.5:1`);
  }
});

test("host and harness restore the Station theme before Station content or styles paint", () => {
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  assert.ok(host.indexOf("theme.initialize(host, root)") < host.indexOf("doc.body.appendChild(host)"));
  assert.ok(harness.indexOf("PolynStationTheme.initialize(document.documentElement") < harness.indexOf("styles/tokens.css"));
});
