"use strict";

/* Slate's theme system: the registry and controller (slate-theme.js) and
 * the contract every theme stylesheet has to meet - the same token set,
 * colours only in theme files, and contrast floors for everything that
 * carries text.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const theme = require("./slate-theme.js");

const ROOT = __dirname;
const THEMES_DIR = path.join(ROOT, "slate/styles/themes");
const GALLERY_ORDER = ["yaru-light", "yaru-dark"];

function node(tag) {
  return {
    tagName: tag.toUpperCase(), attributes: {}, children: [],
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    appendChild(child) { this.children.push(child); return child; }
  };
}

function storage(initial) {
  const store = Object.assign({}, initial || {});
  return {
    getItem: key => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem(key, value) { store[key] = String(value); },
    value: key => store[key]
  };
}

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

function tokensOf(css) {
  const out = new Map();
  for (const match of css.matchAll(/(--slate-[a-z0-9-]+)\s*:\s*([^;]+);/g)) out.set(match[1], match[2].trim());
  return out;
}

/* ----------------------------------------------------------------------
 *   Registry and controller
 * -------------------------------------------------------------------- */

test("the Slate registry is Yaru Light over Yaru Dark, default light, and its own storage key", () => {
  assert.deepEqual([...theme.THEME_IDS], GALLERY_ORDER);
  assert.equal(theme.DEFAULT_THEME, "yaru-light");
  assert.equal(theme.STORAGE_KEY, "polyn.slate.theme.v1");
  assert.deepEqual(theme.THEMES.map(item => item.scheme), ["light", "dark"]);
  assert.deepEqual(theme.THEMES.map(item => item.label), ["Yaru Light", "Yaru Dark"]);
  assert.ok(Object.isFrozen(theme.THEMES) && theme.THEMES.every(Object.isFrozen));
  // Station's preference is a different key: choosing here never recolours Station.
  const station = require("./station-theme.js");
  assert.notEqual(theme.STORAGE_KEY, station.STORAGE_KEY);
});

test("each theme selects and persists on its own, and nothing else moves", () => {
  for (const id of GALLERY_ORDER) {
    const root = node("div");
    const saved = storage();
    const controller = theme.create(root, saved);
    assert.equal(controller.setTheme(id), id);
    assert.equal(root.getAttribute("data-theme"), id);
    assert.equal(saved.value(theme.STORAGE_KEY), id);
    assert.deepEqual(Object.keys(root.attributes), ["data-theme"], "selection wrote something besides data-theme");
  }
});

test("persisted themes restore and invalid, Station-only or obsolete values fall back safely", () => {
  for (const id of theme.THEME_IDS) {
    const controller = theme.create(node("div"), storage({ [theme.STORAGE_KEY]: id }));
    assert.equal(controller.getTheme(), id);
  }
  for (const invalid of ["", "dark", "system", "industrial-dark", "gruvbox-light", "yaru", "__proto__", null]) {
    const root = node("div");
    const controller = theme.create(root, storage({ [theme.STORAGE_KEY]: invalid }));
    assert.equal(controller.getTheme(), theme.DEFAULT_THEME, `${invalid} was accepted`);
    assert.equal(root.getAttribute("data-theme"), theme.DEFAULT_THEME);
  }
  assert.equal(theme.create(node("div"), { getItem() { throw new Error("blocked"); } }).getTheme(), theme.DEFAULT_THEME);
  assert.equal(theme.create(node("div"), null).getTheme(), theme.DEFAULT_THEME);
});

test("subscribers hear a change once, and a throwing subscriber stops nobody", () => {
  const controller = theme.create(node("div"), storage());
  const heard = [];
  controller.subscribe(() => { throw new Error("boom"); });
  const off = controller.subscribe(value => heard.push(value));
  controller.setTheme("yaru-dark");
  controller.setTheme("yaru-dark");
  assert.deepEqual(heard, ["yaru-dark"]);
  off();
  controller.setTheme("yaru-light");
  assert.deepEqual(heard, ["yaru-dark"]);
});

test("initialize reads the environment's localStorage and survives one that throws", () => {
  const saved = storage({ [theme.STORAGE_KEY]: "yaru-dark" });
  const root = node("div");
  assert.equal(theme.initialize(root, { localStorage: saved }).getTheme(), "yaru-dark");
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("denied"); } });
  assert.equal(theme.initialize(node("div"), blocked).getTheme(), "yaru-light");
  assert.equal(theme.create(null, saved), null);
});

/* ----------------------------------------------------------------------
 *   Stylesheet contract
 * -------------------------------------------------------------------- */

test("there is one theme file per registered id, each scoped to its own id on the Slate root", () => {
  const files = fs.readdirSync(THEMES_DIR).filter(name => name.endsWith(".css")).sort();
  assert.deepEqual(files, [...GALLERY_ORDER].sort().map(id => `${id}.css`));
  for (const id of GALLERY_ORDER) {
    const css = fs.readFileSync(path.join(THEMES_DIR, `${id}.css`), "utf8");
    assert.ok(css.includes(`.slate-root[data-theme="${id}"]`), `${id}.css is not scoped to its own id`);
    for (const other of GALLERY_ORDER) {
      if (other !== id) assert.ok(!css.includes(`[data-theme="${other}"]`), `${id}.css names ${other}`);
    }
    assert.doesNotMatch(css, /station-/, `${id}.css spends a Station token`);
  }
});

test("every theme declares the identical token set", () => {
  const sets = GALLERY_ORDER.map(id => ({
    id, tokens: tokensOf(fs.readFileSync(path.join(THEMES_DIR, `${id}.css`), "utf8"))
  }));
  const reference = [...sets[0].tokens.keys()].sort();
  assert.ok(reference.length >= 36, `the contract has shrunk to ${reference.length} tokens`);
  for (const set of sets) {
    assert.deepEqual([...set.tokens.keys()].sort(), reference, `${set.id}.css declares a different token set`);
  }
  for (const required of ["--slate-bg", "--slate-surface", "--slate-text", "--slate-text-muted", "--slate-accent",
    "--slate-focus-ring", "--slate-tracking", "--slate-pump-off", "--slate-overdue",
    "--slate-layer-outside", "--slate-layer-subskin", "--slate-layer-core", "--slate-layer-inside", "--slate-layer-single",
    "--slate-color-scheme"]) {
    assert.ok(reference.includes(required), `the contract lacks ${required}`);
  }
});

test("colour literals live only in theme files", () => {
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "themes") walk(full); continue; }
      if (!entry.name.endsWith(".css")) continue;
      const css = fs.readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, `${path.relative(ROOT, full)} has a hex colour`);
      assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/i, `${path.relative(ROOT, full)} has a colour function`);
    }
  })(path.join(ROOT, "slate/styles"));
});

test("every theme meets the contrast floors for text and status colours", () => {
  for (const id of GALLERY_ORDER) {
    const tokens = tokensOf(fs.readFileSync(path.join(THEMES_DIR, `${id}.css`), "utf8"));
    const get = name => tokens.get(`--slate-${name}`);
    const bg = get("bg");
    const surface = get("surface");
    for (const name of ["text", "text-muted", "text-faint", "accent", "success", "warning", "danger", "info"]) {
      const ratio = contrastRatio(get(name), bg);
      assert.ok(ratio >= 4.5, `${id}: ${name} ${get(name)} on bg ${bg} is ${ratio.toFixed(2)}:1`);
    }
    for (const name of ["text", "text-muted", "text-faint", "tracking", "pump-off", "overdue"]) {
      const ratio = contrastRatio(get(name), surface);
      assert.ok(ratio >= 4.5, `${id}: ${name} ${get(name)} on surface ${surface} is ${ratio.toFixed(2)}:1`);
    }
    const onAccent = contrastRatio(get("text-on-accent"), get("accent"));
    assert.ok(onAccent >= 4.5, `${id}: text-on-accent on accent is ${onAccent.toFixed(2)}:1`);
    assert.equal(get("color-scheme"), theme.THEMES.find(item => item.id === id).scheme);
  }
});
