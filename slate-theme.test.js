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
const GALLERY_ORDER = ["yaru-light", "yaru-dark", "rose-pine", "tokyo-night", "gruvbox", "everforest", "catppuccin", "retro-82"];

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

function rgb(value) {
  if (Array.isArray(value)) return value;
  if (value.startsWith("#")) return value.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  assert.match(value, /^rgba\(/, `unsupported colour: ${value}`);
  return value.match(/[\d.]+/g).map(Number);
}

function composite(foreground, background) {
  const front = rgb(foreground);
  const back = rgb(background);
  const alpha = front.length === 4 ? front[3] : 1;
  return front.slice(0, 3).map((channel, i) => channel * alpha + back[i] * (1 - alpha));
}

function relativeLuminance(value) {
  const channels = rgb(value).map(channel => channel / 255);
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

test("the Slate registry is Yaru Light over Yaru Dark, then the six palettes, default light, and its own storage key", () => {
  assert.deepEqual([...theme.THEME_IDS], GALLERY_ORDER);
  assert.equal(theme.DEFAULT_THEME, "yaru-dark");
  assert.equal(theme.STORAGE_KEY, "polyn.slate.theme.v1");
  assert.deepEqual(theme.THEMES.map(item => item.scheme), ["light", "dark", "light", "dark", "dark", "dark", "dark", "dark"]);
  assert.deepEqual(theme.THEMES.map(item => item.label), ["Yaru Light", "Yaru Dark", "Rosé Pine", "Tokyo Night", "Gruvbox", "Everforest", "Catppuccin", "Retro 82"]);
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
  controller.setTheme("yaru-light");
  controller.setTheme("yaru-light");
  assert.deepEqual(heard, ["yaru-light"]);
  off();
  controller.setTheme("yaru-dark");
  assert.deepEqual(heard, ["yaru-light"]);
});

test("initialize reads the environment's localStorage and survives one that throws", () => {
  const saved = storage({ [theme.STORAGE_KEY]: "yaru-dark" });
  const root = node("div");
  assert.equal(theme.initialize(root, { localStorage: saved }).getTheme(), "yaru-dark");
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("denied"); } });
  assert.equal(theme.initialize(node("div"), blocked).getTheme(), "yaru-dark");
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
    "--slate-accent-text", "--slate-focus-ring", "--slate-tracking", "--slate-pump-off", "--slate-pump-off-soft",
    "--slate-overdue", "--slate-smart",
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
    for (const name of ["text", "text-muted", "text-faint", "accent-text", "success", "warning", "danger", "info"]) {
      const ratio = contrastRatio(get(name), bg);
      assert.ok(ratio >= 4.5, `${id}: ${name} ${get(name)} on bg ${bg} is ${ratio.toFixed(2)}:1`);
    }
    for (const name of ["text", "text-muted", "text-faint", "tracking", "pump-off", "overdue", "smart"]) {
      const ratio = contrastRatio(get(name), surface);
      assert.ok(ratio >= 4.5, `${id}: ${name} ${get(name)} on surface ${surface} is ${ratio.toFixed(2)}:1`);
    }
    const onAccent = contrastRatio(get("text-on-accent"), get("accent"));
    assert.ok(onAccent >= 4.5, `${id}: text-on-accent on accent is ${onAccent.toFixed(2)}:1`);
    assert.equal(get("color-scheme"), theme.THEMES.find(item => item.id === id).scheme);
  }
});

test("text stays readable on raised, recessed, hovered and selected surfaces", () => {
  for (const id of GALLERY_ORDER) {
    const tokens = tokensOf(fs.readFileSync(path.join(THEMES_DIR, `${id}.css`), "utf8"));
    const get = name => tokens.get(`--slate-${name}`);
    for (const surface of ["bg", "surface", "surface-raised", "surface-sunken", "surface-hover", "surface-selected"]) {
      for (const foreground of ["text", "text-muted", "text-faint", "accent-text"]) {
        const ratio = contrastRatio(get(foreground), get(surface));
        assert.ok(ratio >= 4.5, `${id}: ${foreground} on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
    for (const state of ["accent", "accent-hover", "accent-active"]) {
      const ratio = contrastRatio(get("text-on-accent"), get(state));
      assert.ok(ratio >= 4.5, `${id}: filled control ${state}: ${ratio.toFixed(2)}:1`);
    }
  }
});

test("status and accent text meet contrast floors on their composited tinted backgrounds", () => {
  const pairs = [
    ["tracking", "success-soft"], ["success", "success-soft"],
    ["warning", "warning-soft"], ["danger", "danger-soft"], ["overdue", "danger-soft"],
    ["pump-off", "pump-off-soft"], ["accent-text", "accent-soft"],
    ["text-muted", "danger-soft"], ["text-faint", "danger-soft"]
  ];
  for (const id of GALLERY_ORDER) {
    const tokens = tokensOf(fs.readFileSync(path.join(THEMES_DIR, `${id}.css`), "utf8"));
    const get = name => tokens.get(`--slate-${name}`);
    for (const surface of ["bg", "surface", "surface-raised"]) {
      for (const [foreground, tint] of pairs) {
        const ratio = contrastRatio(get(foreground), composite(get(tint), get(surface)));
        assert.ok(ratio >= 4.5, `${id}: ${foreground} on ${tint} over ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test("focus rings and dark control borders remain distinct from every control surface", () => {
  for (const id of GALLERY_ORDER) {
    const tokens = tokensOf(fs.readFileSync(path.join(THEMES_DIR, `${id}.css`), "utf8"));
    const get = name => tokens.get(`--slate-${name}`);
    for (const surface of ["bg", "surface", "surface-raised", "surface-sunken", "surface-hover", "surface-selected"]) {
      const ratio = contrastRatio(get("focus-ring"), get(surface));
      assert.ok(ratio >= 3, `${id}: focus ring on ${surface}: ${ratio.toFixed(2)}:1`);
    }
    if (theme.THEMES.find(item => item.id === id).scheme === "dark") {
      for (const surface of ["surface", "surface-raised"]) {
        const ratio = contrastRatio(get("border"), get(surface));
        assert.ok(ratio >= 3, `${id}: control border on ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
});

test("enabled controls own pressed states and disabled controls do not own hover states", () => {
  const component = file => fs.readFileSync(path.join(ROOT, "slate/styles/components", file), "utf8");
  const base = fs.readFileSync(path.join(ROOT, "slate/styles/base.css"), "utf8");
  assert.match(base, /button:not\(:disabled\):not\(\[aria-disabled="true"\]\):not\(\[data-able="false"\]\):active/);
  for (const file of ["rail.css", "recipe.css", "recipe-book.css", "sync.css", "timeline.css"]) {
    assert.match(component(file), /background:\s*var\(--slate-accent-active\)/, `${file} lacks an active accent state`);
  }
  assert.match(component("recipe.css"), /\.slate-toggle:not\(:disabled\):not\(\[data-able="false"\]\):hover/);
  assert.match(component("recipe-book.css"), /\.slate-book__action:not\(:disabled\):not\(\[data-able="false"\]\):hover/);
  assert.match(component("sync.css"), /\.slate-sync__button:not\(:disabled\):hover/);
  for (const control of ["slate-layer-menu__item", "slate-print__item"]) {
    assert.match(component("recipe-edit.css"), new RegExp(`\\.${control}:not\\(\\[aria-disabled="true"\\]\\):hover`));
  }
  assert.match(component("timeline.css"), /\.slate-timeline__range:focus-visible\s*\{[^}]*outline-offset:\s*-2px/s);
  for (const [file, selector, token] of [
    ["recipe.css", "slate-switch[^\\n{]*\\[aria-checked=\\\"true\\\"\\][^\\n{]*:active", "slate-accent-soft"],
    ["recipe.css", "slate-toggle--tracking[^\\n{]*\\[aria-pressed=\\\"true\\\"\\][^\\n{]*:active", "slate-success-soft"],
    ["recipe.css", "slate-toggle--pump[^\\n{]*\\[aria-pressed=\\\"true\\\"\\][^\\n{]*:active", "slate-pump-off-soft"],
    ["recipe-book.css", "slate-book__action--danger[^\\n{]*:active", "slate-danger-soft"],
    ["sync.css", "slate-sync__button--danger[^\\n{]*:active", "slate-danger-soft"]
  ]) {
    assert.match(component(file), new RegExp(`\\.${selector}\\s*\\{[^}]*background:\\s*var\\(--${token}\\)`, "s"));
  }
});

test("accent text consumers use the text role, not the filled-control colour", () => {
  for (const file of ["recipe.css", "timeline.css"]) {
    const css = fs.readFileSync(path.join(ROOT, "slate/styles/components", file), "utf8");
    assert.doesNotMatch(css, /(?:^|[;{])\s*color:\s*var\(--slate-accent\)/m);
    assert.match(css, /color:\s*var\(--slate-accent-text\)/);
  }
});

test("the overdue pulse animates only the line and respects reduced motion", () => {
  const css = fs.readFileSync(path.join(ROOT, "slate/styles/components/timeline.css"), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const pulse = rules.filter(match => /animation:\s*slate-now-pulse/.test(match[2]));
  assert.equal(pulse.length, 1);
  assert.match(pulse[0][1], /\.slate-timeline__now::before\s*$/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.slate-timeline__now::before,[^{]*\{\s*animation:\s*none/);
});
