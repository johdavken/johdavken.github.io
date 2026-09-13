"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const theme = require("./station-theme.js");
const appearance = require("./station/station-appearance.js");
const preview = require("./station/station-theme-preview.js");
const ROOT = __dirname;
const GALLERY_ORDER = ["industrial-light", "industrial-dark", "gruvbox-light", "gruvbox-dark", "engineering-paper", "blueprint"];

function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    value(key) { return values.get(key); }
  };
}

function node(name, namespace) {
  const el = {
    tagName: name.toUpperCase(), namespace: namespace || null, attributes: {}, children: [], listeners: {}, parent: null, textContent: "",
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
const doc = () => ({ createElement: node, createElementNS: (namespace, name) => node(name, namespace) });
const SVG_NS = "http://www.w3.org/2000/svg";
const galleryFor = (controller, options) => appearance.section.create(doc(), Object.assign({
  theme: controller, themes: theme.THEMES, families: theme.FAMILIES, preview
}, options || {}));

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

test("the Station registry contains exactly the six permanent theme ids, in gallery order, in three families", () => {
  assert.deepEqual([...theme.THEME_IDS], GALLERY_ORDER);
  assert.equal(theme.DEFAULT_THEME, "industrial-dark");
  assert.deepEqual(theme.THEMES.map(item => item.label),
    ["Industrial Light", "Industrial Dark", "Gruvbox Light", "Gruvbox Dark", "Engineering Paper", "Blueprint"]);
  assert.deepEqual(theme.FAMILIES.map(family => family.id), ["standard", "gruvbox", "technical"]);
  // Each family is one light theme over one dark one, in that order.
  for (const family of theme.FAMILIES) {
    const members = theme.THEMES.filter(item => item.family === family.id);
    assert.deepEqual(members.map(item => item.scheme), ["light", "dark"], `${family.id} is not a light/dark pair`);
  }
  assert.ok(Object.isFrozen(theme.THEMES) && theme.THEMES.every(Object.isFrozen));
});

test("each of the three new themes selects and persists on its own, and nothing else moves", () => {
  for (const id of ["gruvbox-light", "blueprint", "engineering-paper"]) {
    const root = node("div");
    const saved = storage();
    const controller = theme.create(root, saved);
    assert.equal(controller.setTheme(id), id);
    assert.equal(root.getAttribute("data-theme"), id);
    assert.equal(saved.value(theme.STORAGE_KEY), id);
    assert.deepEqual(Object.keys(root.attributes), ["data-theme"], "selection wrote something besides data-theme");
  }
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

test("Handbook Appearance offers six tiles in gallery order and selects the controller theme immediately", () => {
  const root = node("div");
  const saved = storage();
  const controller = theme.create(root, saved);
  const view = galleryFor(controller);
  const tiles = find(view.element, el => el.getAttribute("data-theme-choice"));
  assert.deepEqual(tiles.map(el => el.getAttribute("data-theme-choice")), GALLERY_ORDER);
  assert.deepEqual(tiles.map(el => el.getAttribute("role")), Array(6).fill("radio"));
  assert.deepEqual(tiles.map(el => el.getAttribute("aria-checked")), ["false", "true", "false", "false", "false", "false"]);
  // The whole tile is the control: one button, the picture and the name inside it.
  for (const tile of tiles) {
    assert.equal(tile.tagName, "BUTTON");
    assert.equal(find(tile, el => el.getAttribute("class") === "station-appearance__name").length, 1);
    assert.equal(find(tile, el => el.tagName === "BUTTON").length, 1, "a tile nests a second control");
  }
  for (const [index, id] of GALLERY_ORDER.entries()) {
    tiles[index].dispatchEvent({ type: "click" });
    assert.equal(root.getAttribute("data-theme"), id);
    assert.equal(saved.value(theme.STORAGE_KEY), id);
    assert.deepEqual(tiles.map(el => el.getAttribute("aria-checked")), GALLERY_ORDER.map(other => other === id ? "true" : "false"));
  }
  // Grouped by family, the light theme over the dark, family columns in registry order.
  const columns = find(view.element, el => el.getAttribute("data-family"));
  assert.deepEqual(columns.map(el => el.getAttribute("data-family")), ["standard", "gruvbox", "technical"]);
  assert.deepEqual(columns.map(column => find(column, el => el.getAttribute("data-theme-choice")).map(el => el.getAttribute("data-theme-choice"))),
    [["industrial-light", "industrial-dark"], ["gruvbox-light", "gruvbox-dark"], ["engineering-paper", "blueprint"]]);
});

test("every tile carries a miniature in its own theme scope, so a preview shows its theme whichever theme is on", () => {
  const root = node("div");
  const controller = theme.create(root, storage({ [theme.STORAGE_KEY]: "gruvbox-dark" }));
  const view = galleryFor(controller);
  const tiles = find(view.element, el => el.getAttribute("data-theme-choice"));
  for (const tile of tiles) {
    const scopes = find(tile, el => (el.getAttribute("class") || "").split(" ").includes("station-theme-scope"));
    assert.equal(scopes.length, 1, `${tile.getAttribute("data-theme-choice")} has ${scopes.length} theme scopes`);
    assert.equal(scopes[0].getAttribute("data-theme"), tile.getAttribute("data-theme-choice"));
    const pictures = find(scopes[0], el => el.tagName === "SVG");
    assert.equal(pictures.length, 1);
    assert.equal(pictures[0].namespace, SVG_NS, "the miniature is not an SVG element");
    assert.equal(pictures[0].getAttribute("aria-hidden"), "true");
  }
  // Drawing the gallery changed nothing: the root still wears the stored theme.
  assert.equal(root.getAttribute("data-theme"), "gruvbox-dark");
  assert.equal(controller.getTheme(), "gruvbox-dark");
});

test("the miniature is the same composition under every theme and spends only semantic tokens", () => {
  const shapes = id => find(preview.create(doc(), id), el => el.tagName !== "SPAN")
    .map(el => `${el.tagName}.${el.getAttribute("class") || ""}`);
  const first = shapes(GALLERY_ORDER[0]);
  assert.ok(first.length > 40, "the miniature is unexpectedly sparse");
  for (const id of GALLERY_ORDER.slice(1)) assert.deepEqual(shapes(id), first, `${id} draws a different miniature`);
  const css = fs.readFileSync(path.join(ROOT, "station/styles/components/theme-preview.css"), "utf8");
  // Every painted class the drawing uses is styled, and styled only in
  // tokens (groups only gather; they carry no paint).
  const classes = new Set(first.filter(entry => !entry.startsWith("G."))
    .flatMap(entry => entry.split(".")[1].split(" ")).filter(name => name.startsWith("station-theme-preview")));
  for (const name of classes) assert.match(css, new RegExp(`\\.${name}\\b`), `${name} has no style`);
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(body, /#[0-9a-f]{3,8}\b|rgba?\s*\(/i, "theme-preview.css names a colour");
  const inline = find(preview.create(doc(), "blueprint"), el => el.getAttribute("style") || el.getAttribute("fill") || el.getAttribute("stroke"));
  assert.deepEqual(inline, [], "the miniature carries an inline colour");
  // The layer banks carry the roles the layer stylesheet keys colour on.
  const roles = find(preview.create(doc(), "blueprint"), el => el.getAttribute("data-layer-role")).map(el => el.getAttribute("data-layer-role"));
  assert.deepEqual(roles, ["outside", "core", "inside"]);
});

test("previews are pictures: no bridge, no subscription, no storage, no root theme, no live machine", () => {
  const source = fs.readFileSync(path.join(ROOT, "station/station-theme-preview.js"), "utf8");
  for (const pattern of [/\.subscribe\s*\(/, /PolynStationStateBridge/, /PolynStationRender/, /PolynStationMachine/, /localStorage/,
    /sessionStorage/, /\bfetch\s*\(/, /XMLHttpRequest/, /supabase/i, /requestAnimationFrame/, /setInterval/, /addEventListener/,
    /documentElement/, /querySelector/, /\bdocument\b/]) {
    assert.doesNotMatch(source, pattern, `station-theme-preview.js matches ${pattern}`);
  }
  // Creating the gallery's six pictures neither reads nor writes the theme controller.
  const controller = { getTheme() { this.reads = (this.reads || 0) + 1; return "industrial-dark"; }, setTheme() { throw new Error("preview set the theme"); } };
  const view = galleryFor(controller);
  assert.equal(find(view.element, el => (el.getAttribute("class") || "").includes("station-theme-scope")).length, 6);
  assert.equal(controller.reads, 1, "the gallery read the theme more than once while drawing");
  // A gallery with no preview module still lists the six themes.
  const bare = galleryFor(theme.create(node("div"), storage()), { preview: null });
  assert.equal(find(bare.element, el => el.getAttribute("data-theme-choice")).length, 6);
  assert.equal(find(bare.element, el => (el.getAttribute("class") || "").includes("station-theme-scope")).length, 0);
});

test("every theme implements one matching semantic token contract and components contain no literal palette", () => {
  const files = theme.THEME_IDS.map(id => path.join(ROOT, "station/styles/themes", `${id}.css`));
  const tokens = css => new Set([...css.matchAll(/--(station-[a-z0-9-]+)\s*:/g)].map(match => match[1]));
  const contracts = files.map(file => tokens(fs.readFileSync(file, "utf8")));
  assert.ok(contracts[0].size > 60, "the semantic contract is unexpectedly small");
  for (const contract of contracts.slice(1)) assert.deepEqual([...contract].sort(), [...contracts[0]].sort());
  for (const [index, file] of files.entries()) {
    const css = fs.readFileSync(file, "utf8");
    const id = theme.THEME_IDS[index];
    assert.match(css, new RegExp(`\\.station-root\\[data-theme="${id}"\\]`));
    // The same mapping is offered to a preview's scope, which is how a
    // miniature resolves under a theme that is not the root's.
    assert.match(css, new RegExp(`\\.station-theme-scope\\[data-theme="${id}"\\]`));
    assert.doesNotMatch(css, /data-theme="(?!.*?\b(?:industrial-light|industrial-dark|gruvbox-light|gruvbox-dark|engineering-paper|blueprint)\b)/,
      `${id}.css names a theme it is not`);
    assert.equal((css.match(/data-theme="([a-z-]+)"/g) || []).every(match => match.includes(`"${id}"`)), true, `${id}.css maps another theme's id`);
  }
  // The character tokens every theme must answer: line weight, the
  // schematic outline share, the annotation face, the canvas grid, and
  // the stage atmosphere.
  for (const token of ["line-scale", "schematic-outline", "font-annotation", "grid-major", "grid-minor", "canvas-pattern",
    "atmosphere-glow", "atmosphere-horizon", "atmosphere-floor", "atmosphere-vignette", "stage-atmosphere"]) {
    assert.ok(contracts[0].has(`station-${token}`), `--station-${token} is missing from the contract`);
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

test("the header ribbon's four text segments read against their own fills in every theme, and every theme names all eight stops", () => {
  for (const id of theme.THEME_IDS) {
    const css = fs.readFileSync(path.join(ROOT, "station/styles/themes", `${id}.css`), "utf8");
    const colours = Object.fromEntries(
      [...css.matchAll(/--station-([a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})/gi)].map(match => [match[1], match[2]])
    );
    for (let n = 1; n <= 8; n += 1) assert.match(colours[`ribbon-${n}`] || "", /^#[0-9a-f]{6}$/i, `${id} names no stop ${n}`);
    for (const n of [1, 2, 6, 8]) {
      assert.ok(contrastRatio(colours[`ribbon-ink-${n}`], colours[`ribbon-${n}`]) >= 4.5, `${id} ribbon ink ${n} is below 4.5:1 on its fill`);
    }
    // No two adjacent text-bearing or sliver stops are the same colour:
    // the run is a ramp, not a band.
    for (let n = 1; n < 8; n += 1) assert.notEqual(colours[`ribbon-${n}`], colours[`ribbon-${n + 1}`], `${id} stops ${n} and ${n + 1} are the same`);
  }
});

test("the technical pair draws the grid and the schematic; the other four draw neither", () => {
  const read = id => fs.readFileSync(path.join(ROOT, "station/styles/themes", `${id}.css`), "utf8");
  const token = (css, name) => (css.match(new RegExp(`--station-${name}:\\s*([^;]+);`)) || [])[1];
  for (const id of ["blueprint", "engineering-paper"]) {
    const css = read(id);
    assert.equal(token(css, "canvas-pattern"), "var(--station-canvas-grid)", `${id} has no drafting grid`);
    assert.equal(token(css, "schematic-outline"), "100%", `${id} does not outline the extruder`);
    assert.ok(parseFloat(token(css, "line-scale")) > 1, `${id} does not draw heavier lines`);
    assert.equal(token(css, "font-annotation"), "var(--station-font-mono)");
    for (const grid of ["grid-major", "grid-minor"]) {
      const alpha = Number((token(css, grid).match(/rgba\([^)]*,\s*([0-9.]+)\)/) || [])[1]);
      assert.ok(alpha > 0 && alpha <= 0.16, `${id} ${grid} is not a faint grid (alpha ${alpha})`);
    }
  }
  for (const id of ["industrial-light", "industrial-dark", "gruvbox-light", "gruvbox-dark"]) {
    const css = read(id);
    assert.equal(token(css, "canvas-pattern"), "none", `${id} gained a canvas pattern`);
    assert.equal(token(css, "schematic-outline"), "0%");
    assert.equal(token(css, "line-scale"), "1");
    assert.equal(token(css, "font-annotation"), "var(--station-font)");
    assert.equal(token(css, "grid-major"), "transparent");
    assert.equal(token(css, "grid-minor"), "transparent");
  }
  // Gruvbox Light is Gruvbox's own light scheme, not Gruvbox Dark inverted:
  // the canonical light background family and the faded accents.
  const light = read("gruvbox-light");
  assert.match(light, /--station-bg: #f2e5bc;/);
  assert.match(light, /--station-text: #3c3836;/);
  assert.match(light, /--station-accent: #af3a03;/);
  assert.notEqual(token(light, "layer-outside"), token(read("gruvbox-dark"), "layer-outside"));
  // The canvas pattern is composed once, theme-independently, from the grid tokens.
  const tokens = fs.readFileSync(path.join(ROOT, "station/styles/tokens.css"), "utf8");
  assert.match(tokens, /--station-canvas-grid:\s*linear-gradient\([^;]*var\(--station-grid-major\)[^;]*var\(--station-grid-minor\)/);
  const base = fs.readFileSync(path.join(ROOT, "station/styles/base.css"), "utf8");
  assert.match(base, /\.station-root \{[^}]*background-image: var\(--station-canvas-pattern\);/);
});

test("the rendered dark pair stands the machine in a lit room; the other four stand it on the sheet", () => {
  const read = id => fs.readFileSync(path.join(ROOT, "station/styles/themes", `${id}.css`), "utf8");
  const token = (css, name) => (css.match(new RegExp(`--station-${name}:\\s*([^;]+);`)) || [])[1];
  const alphaOf = value => Number((value.match(/rgba\([^)]*,\s*([0-9.]+)\)/) || [])[1]);
  for (const id of ["industrial-dark", "gruvbox-dark"]) {
    const css = read(id);
    assert.equal(token(css, "stage-atmosphere"), "var(--station-atmosphere)", `${id} has no atmosphere`);
    // The light, the horizon and the floor are whispers, never a wash
    // the machine would have to read through; the vignette darkens the
    // edges without swallowing them.
    for (const name of ["atmosphere-glow", "atmosphere-horizon", "atmosphere-floor"]) {
      const alpha = alphaOf(token(css, name));
      assert.ok(alpha > 0 && alpha <= 0.15, `${id} ${name} is not faint (alpha ${alpha})`);
    }
    const vignette = alphaOf(token(css, "atmosphere-vignette"));
    assert.ok(vignette > 0 && vignette <= 0.5, `${id} vignette is not a falling-away (alpha ${vignette})`);
  }
  // Blueprint is dark, and is a drafting sheet: a sheet has no room.
  for (const id of ["industrial-light", "gruvbox-light", "engineering-paper", "blueprint"]) {
    const css = read(id);
    assert.equal(token(css, "stage-atmosphere"), "none", `${id} gained an atmosphere`);
    for (const name of ["atmosphere-glow", "atmosphere-horizon", "atmosphere-floor", "atmosphere-vignette"]) {
      assert.equal(token(css, name), "transparent", `${id} ${name} is not transparent`);
    }
  }
  // The atmosphere is composed once, theme-independently, from the four
  // colour tokens and the horizon's height; the stage cell spends the
  // theme's switch, and the root does not (it keeps the drafting grid).
  const tokens = fs.readFileSync(path.join(ROOT, "station/styles/tokens.css"), "utf8");
  const composed = (tokens.match(/--station-atmosphere:\s*([^;]+);/) || [])[1] || "";
  for (const name of ["atmosphere-glow", "atmosphere-horizon", "atmosphere-floor", "atmosphere-vignette", "atmosphere-horizon-y"]) {
    assert.ok(composed.includes(`var(--station-${name})`), `--station-atmosphere does not spend --station-${name}`);
  }
  assert.match(tokens, /--station-atmosphere-horizon-y:\s*\d+%;/);
  const shell = fs.readFileSync(path.join(ROOT, "station/styles/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(shell, /\.station-machine \{[^}]*background-image: var\(--station-stage-atmosphere\);/);
  const base = fs.readFileSync(path.join(ROOT, "station/styles/base.css"), "utf8");
  assert.doesNotMatch(base, /stage-atmosphere/);
});

test("host and harness load every registered theme and the preview, in the same order as the registry", () => {
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  const themesIn = source => [...source.matchAll(/styles\/themes\/([a-z-]+)\.css/g)].map(match => match[1]);
  assert.deepEqual(themesIn(host), GALLERY_ORDER);
  assert.deepEqual(themesIn(harness), GALLERY_ORDER);
  for (const source of [host, harness]) {
    assert.ok(source.includes("styles/components/theme-preview.css"), "the preview stylesheet is not loaded");
    assert.ok(source.indexOf("station-theme-preview.js") < source.indexOf("station-appearance.js"),
      "the preview module must load before the Appearance section that draws with it");
  }
  // The boot file hands the section the registry's families and the preview module, nothing more.
  const boot = fs.readFileSync(path.join(ROOT, "station/station.js"), "utf8");
  assert.match(boot, /families: theme \? theme\.FAMILIES : \[\]/);
  assert.match(boot, /preview: themePreview/);
});

test("host and harness restore the Station theme before Station content or styles paint", () => {
  const host = fs.readFileSync(path.join(ROOT, "station-host.js"), "utf8");
  const harness = fs.readFileSync(path.join(ROOT, "station/station.html"), "utf8");
  assert.ok(host.indexOf("theme.initialize(host, root)") < host.indexOf("doc.body.appendChild(host)"));
  assert.ok(harness.indexOf("PolynStationTheme.initialize(document.documentElement") < harness.indexOf("styles/tokens.css"));
});
