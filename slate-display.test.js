"use strict";

/* slate-display.js and the read-only mode it carries: the preference, its
 * resolution against the line, and what the sections do with it. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const { makeDocument, click, makeCommands } = require("./tools/slate-test/fake-dom.js");
const display = require("./slate-display.js");
const tracking = require("./slate/slate-tracking.js");
const recipe = require("./slate/slate-recipe.js");
const cards = require("./slate/slate-stat-cards.js");
const settings = require("./slate/slate-settings.js");
const theme = require("./slate-theme.js");
const source = require("./slate/slate-source.js");
const demo = require("./slate/slate-demo.js");

function storage(initial) {
  const store = Object.assign({}, initial || {});
  return { getItem: key => (key in store ? store[key] : null), setItem(key, value) { store[key] = String(value); }, store };
}

function node() {
  return { attributes: {}, setAttribute(key, value) { this.attributes[key] = String(value); }, getAttribute(key) { return this.attributes[key] ?? null; } };
}

/* ----------------------------------------------------------------------
 *   The preference
 * -------------------------------------------------------------------- */

test("the preference is three-valued, defaults to automatic, and persists under its own key", () => {
  assert.equal(display.STORAGE_KEY, "polyn.slate.display.v1");
  assert.notEqual(display.STORAGE_KEY, theme.STORAGE_KEY);
  assert.deepEqual(display.normalize(null), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.deepEqual(display.normalize({ readOnly: "yes", other: 1 }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.deepEqual(display.normalize({ readOnly: false }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  // A stored null is the automatic choice and is kept; only a missing key reads the default (off).
  assert.deepEqual(display.normalize({ readOnly: null }), { readOnly: null, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.deepEqual(display.normalize({ readOnly: true }), { readOnly: true, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.equal(display.modeOf(null), "auto");
  assert.equal(display.modeOf(true), "on");
  assert.equal(display.modeOf(false), "off");
  assert.equal(display.readOnlyOf("on"), true);
  assert.equal(display.readOnlyOf("off"), false);
  assert.equal(display.readOnlyOf("auto"), null);
  assert.equal(display.readOnlyOf("nonsense"), null);

  const saved = storage();
  const controller = display.create(node(), saved);
  assert.equal(controller.getReadOnly(), false);
  assert.equal(controller.getReadOnlyMode(), "off");
  const heard = [];
  controller.subscribe(value => heard.push(value.readOnly));
  assert.equal(controller.setReadOnly("on"), true);
  assert.equal(JSON.parse(saved.store[display.STORAGE_KEY]).readOnly, true);
  controller.setReadOnly("on");
  assert.equal(controller.setReadOnly("off"), false);
  assert.equal(controller.setReadOnly("auto"), null);
  assert.deepEqual(heard, [true, false, null]);

  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ readOnly: false }) })).getReadOnly(), false);
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: "{broken" })).getReadOnly(), false);
  assert.equal(display.create(node(), { getItem() { throw new Error("blocked"); } }).getReadOnly(), false);
  // The automatic choice survives a reload as itself.
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ readOnly: null }) })).getReadOnly(), null);
  assert.equal(display.create(null, saved), null);
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("denied"); } });
  assert.equal(display.initialize(node(), blocked).getReadOnly(), false);
});

test("the tracking mode is one of three words, defaults to automatic, persists beside read-only, and an old record without it reads automatic", () => {
  assert.deepEqual(display.TRACKING_MODES, ["automatic", "assisted", "manual"]);
  assert.equal(display.DEFAULTS.tracking, "automatic");
  assert.deepEqual(display.normalize({ tracking: "manual" }), { readOnly: false, tracking: "manual", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.deepEqual(display.normalize({ tracking: "nope" }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.equal(display.trackingModeOf("assisted"), "assisted");
  assert.equal(display.trackingModeOf("AUTOMATIC"), "automatic");
  assert.equal(display.trackingModeOf(undefined), "automatic");

  const saved = storage();
  const controller = display.create(node(), saved);
  assert.equal(controller.getTrackingMode(), "automatic");
  const heard = [];
  controller.subscribe(value => heard.push(`${value.tracking}/${value.readOnly}`));
  assert.equal(controller.setTrackingMode("manual"), "manual");
  assert.deepEqual(JSON.parse(saved.store[display.STORAGE_KEY]), { readOnly: false, tracking: "manual", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  controller.setTrackingMode("manual");
  assert.equal(controller.setTrackingMode("nonsense"), "automatic");
  controller.setReadOnly("on");
  assert.equal(controller.getTrackingMode(), "automatic", "read-only moved the tracking mode");
  assert.deepEqual(heard, ["manual/false", "automatic/false", "automatic/true"]);
  assert.deepEqual(JSON.parse(saved.store[display.STORAGE_KEY]), { readOnly: true, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });

  // The record a browser saved before the mode existed.
  const older = display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ readOnly: false }) }));
  assert.equal(older.getReadOnly(), false);
  assert.equal(older.getTrackingMode(), "automatic");
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ tracking: "manual" }) })).getTrackingMode(), "manual");
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: "{broken" })).getTrackingMode(), "automatic");
});

test("the effective mode: automatic follows the line, an explicit choice does not", () => {
  assert.equal(display.effectiveReadOnly(null, true), true);
  assert.equal(display.effectiveReadOnly(null, false), false);
  assert.equal(display.effectiveReadOnly(true, false), true);
  assert.equal(display.effectiveReadOnly(false, true), false);
  assert.equal(display.effectiveReadOnly(undefined, true), true);
});

/* ----------------------------------------------------------------------
 *   What the sections do with it
 * -------------------------------------------------------------------- */

const ALL = [...require("./station-command-contract.js").COMMANDS];

function resolved() {
  const snap = demo.snapshot(5000);
  snap.revision = 2;
  snap.line.linked = true;
  return source.resolveSource({ snapshot: snap });
}

test("read-only withholds every tracking ability and names itself as the reason, whatever the bridge offers", () => {
  const commands = makeCommands({ capabilities: ALL });
  assert.deepEqual(tracking.abilities(commands, { readOnly: true }), { tracking: false, pump: false, reset: false });
  assert.deepEqual(tracking.abilities(commands, { readOnly: false }), { tracking: true, pump: true, reset: true });
  assert.equal(tracking.reason(commands, "tracking", { readOnly: true }), tracking.READ_ONLY_REASON);
  assert.equal(cards.able(commands, "rate", { readOnly: true }), false);
  assert.equal(cards.reason(commands, "rate", { readOnly: true }), cards.READ_ONLY_REASON);
  assert.match(tracking.READ_ONLY_REASON, /Settings/);
});

test("with read-only on, a toggle click dispatches nothing and explains; flipping it off restores the controls in place", () => {
  const doc = makeDocument();
  const commands = makeCommands({ capabilities: ALL });
  let readOnly = true;
  const said = [];
  const view = recipe.create(doc, { commands: () => commands, say: message => said.push(message), readOnly: () => readOnly, timers: { setTimeout: () => 1, clearTimeout() {} }, print: { print: () => ({ ok: true }) } });
  view.update(resolved(), { kind: "structural" });
  const toggle = view.element.querySelector(".slate-hopper[data-hopper='A1'] [data-slate-control='tracking']");
  assert.equal(toggle.getAttribute("data-able"), "false");
  assert.match(toggle.getAttribute("title"), /read-only/);
  assert.ok(view.element.classList.contains("is-readonly"));
  click(toggle);
  assert.equal(commands.calls.length, 0);
  assert.match(said[0], /read-only/);
  const reset = view.element.querySelector(".slate-recipe__reset");
  assert.equal(reset.getAttribute("data-able"), "false");
  click(reset);
  assert.ok(!reset.hasAttribute("data-armed"), "a read-only reset armed");

  readOnly = false;
  view.refresh();
  assert.equal(toggle.getAttribute("data-able"), "true");
  assert.ok(!view.element.classList.contains("is-readonly"));
  click(toggle);
  assert.equal(commands.calls.length, 1);
});

test("with read-only on, a card never opens and says why; one already open cannot commit once the mode flips", () => {
  const doc = makeDocument();
  const commands = makeCommands({ capabilities: ALL });
  let readOnly = true;
  const view = cards.create(doc, { commands: () => commands, readOnly: () => readOnly, now: () => 5000 });
  view.update(resolved(), {});
  const rate = view.card("rate");
  assert.ok(rate.card.classList.contains("is-readonly"));
  assert.match(rate.trigger.getAttribute("title"), /read-only/);
  click(rate.trigger);
  assert.equal(view.editing(), null);
  assert.match(rate.note.textContent, /read-only/);

  readOnly = false;
  view.refresh();
  assert.ok(!rate.card.classList.contains("is-readonly"));
  click(rate.trigger);
  assert.equal(view.editing(), "rate");
  readOnly = true;
  rate.input.value = "900";
  const result = view.commit();
  assert.equal(result.ok, false);
  assert.equal(commands.calls.length, 0, "a commit went through under read-only");
  assert.equal(view.editing(), "rate");
  assert.match(rate.note.textContent, /read-only/);
});

test("Settings offers Automatic / On / Off as radios, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const controller = display.create(node(), storage());
  const view = settings.create(doc, { theme: null, themes: [], display: controller });
  const modes = view.element.querySelectorAll("[data-readonly-mode]");
  assert.deepEqual(modes.map(one => one.getAttribute("data-readonly-mode")), ["off", "on", "auto"]);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  click(view.mode("on"));
  assert.equal(controller.getReadOnly(), true);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "true", "false"]);
  controller.setReadOnly("auto");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "false", "true"]);
  // Safety stands after Tracking, before Layout.
  assert.deepEqual(view.element.querySelectorAll(".slate-settings__group").map(one => one.getAttribute("aria-label")).slice(0, 4), ["Appearance", "Tracking", "Safety", "Layout"]);
  assert.match(view.element.querySelectorAll(".slate-settings__lead")[1].textContent, /Connecting to and leaving lines is not affected/);
  const inert = settings.create(doc, { theme: null, themes: [], display: null });
  assert.match(inert.element.querySelectorAll(".slate-settings__note").map(one => one.textContent).join(" "), /Read-only cannot be changed/);
});

test("Settings offers Automatic / Assisted / Manual tracking as radios after Safety, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const controller = display.create(node(), storage());
  const view = settings.create(doc, { theme: null, themes: [], display: controller });
  assert.deepEqual(view.element.querySelectorAll(".slate-settings__group").map(one => one.getAttribute("aria-label")), ["Appearance", "Tracking", "Safety", "Layout", "Layer order", "Timeline", "Input", "This device opens", "More settings", "Administrator access"]);
  const group = view.element.querySelector("[role='radiogroup'][aria-label='Tracking']");
  assert.ok(group, "no Tracking radiogroup");
  const modes = view.element.querySelectorAll("[data-tracking-mode]");
  assert.deepEqual(modes.map(one => one.getAttribute("data-tracking-mode")), ["automatic", "assisted", "manual"]);
  assert.deepEqual(modes.map(one => one.getAttribute("role")), ["radio", "radio", "radio"]);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  assert.deepEqual(modes.map(one => one.querySelector(".slate-settings__mode-label").textContent), ["Automatic", "Assisted", "Manual"]);
  click(view.trackingMode("manual"));
  assert.equal(controller.getTrackingMode(), "manual");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "false", "true"]);
  assert.ok(view.trackingMode("manual").classList.contains("is-selected"));
  controller.setTrackingMode("automatic");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  // The read-only radios are untouched by a tracking click.
  assert.deepEqual(view.element.querySelectorAll("[data-readonly-mode]").map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  const leads = view.element.querySelectorAll(".slate-settings__lead").map(one => one.textContent);
  assert.match(leads[0], /Read-only Off/);
  assert.match(leads[0], /only ever turns tracking on/);
  assert.match(view.trackingMode("automatic").querySelector(".slate-settings__mode-note").textContent, /Reset tracking/);
  const inert = settings.create(doc, { theme: null, themes: [], display: null });
  assert.match(inert.element.querySelectorAll(".slate-settings__note").map(one => one.textContent).join(" "), /Tracking cannot be changed/);
  click(inert.trackingMode("manual"));
});

test("the layer orientation is left, top or grid, defaults to grid, persists beside the others, and an old record without it reads grid", () => {
  assert.deepEqual(display.LAYER_ORIENTATIONS, ["left", "top", "grid"]);
  assert.equal(display.DEFAULTS.layers, "grid");
  assert.deepEqual(display.normalize({ layers: "top" }), { readOnly: false, tracking: "automatic", layers: "top", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.deepEqual(display.normalize({ layers: "sideways" }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.equal(display.layerOrientationOf("top"), "top");
  assert.equal(display.layerOrientationOf("grid"), "grid");
  assert.equal(display.layerOrientationOf("left"), "left");
  assert.equal(display.layerOrientationOf("TOP"), "grid");
  assert.equal(display.layerOrientationOf(undefined), "grid");

  const saved = storage();
  const controller = display.create(node(), saved);
  assert.equal(controller.getLayerOrientation(), "grid");
  const heard = [];
  controller.subscribe(value => heard.push(`${value.layers}/${value.tracking}/${value.readOnly}`));
  assert.equal(controller.setLayerOrientation("top"), "top");
  assert.deepEqual(JSON.parse(saved.store[display.STORAGE_KEY]), { readOnly: false, tracking: "automatic", layers: "top", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  controller.setLayerOrientation("top");
  assert.equal(controller.setLayerOrientation("nonsense"), "grid");
  controller.setLayerOrientation("top");
  controller.setTrackingMode("manual");
  controller.setReadOnly("on");
  assert.equal(controller.getLayerOrientation(), "top", "another preference moved the orientation");
  assert.deepEqual(heard, ["top/automatic/false", "grid/automatic/false", "top/automatic/false", "top/manual/false", "top/manual/true"]);

  // The record a browser saved before the orientation existed.
  const older = display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ readOnly: false, tracking: "manual" }) }));
  assert.equal(older.getLayerOrientation(), "grid");
  // An operator who chose Left keeps it.
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ layers: "left" }) })).getLayerOrientation(), "left");
  assert.equal(older.getLayerOrder(), "forward");
  assert.equal(older.getTrackingMode(), "manual");
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ layers: "top" }) })).getLayerOrientation(), "top");
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ layers: "grid" }) })).getLayerOrientation(), "grid");
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: "{broken" })).getLayerOrientation(), "grid");
});

test("Settings offers Left / Top / Grid layers as radios after Tracking, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const controller = display.create(node(), storage());
  const view = settings.create(doc, { theme: null, themes: [], display: controller });
  const group = view.element.querySelector("[role='radiogroup'][aria-label='Layers']");
  assert.ok(group, "no Layers radiogroup");
  assert.equal(group.closest(".slate-settings__group").getAttribute("aria-label"), "Layout");
  const modes = view.element.querySelectorAll("[data-layer-orientation]");
  assert.deepEqual(modes.map(one => one.getAttribute("data-layer-orientation")), ["left", "top", "grid"]);
  assert.deepEqual(modes.map(one => one.getAttribute("role")), ["radio", "radio", "radio"]);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "false", "true"], "Grid is the default");
  assert.deepEqual(modes.map(one => one.querySelector(".slate-settings__mode-label").textContent), ["Left", "Top", "Grid"]);
  assert.match(view.element.querySelectorAll(".slate-settings__lead").map(one => one.textContent).join(" "), /Recipe and Weights pages/);
  click(view.layerOrientation("top"));
  assert.equal(controller.getLayerOrientation(), "top");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "true", "false"]);
  click(view.layerOrientation("grid"));
  assert.equal(controller.getLayerOrientation(), "grid");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "false", "true"]);
  click(view.layerOrientation("top"));
  assert.ok(view.layerOrientation("top").classList.contains("is-selected"));
  controller.setLayerOrientation("left");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  // The other radios are untouched by an orientation click.
  assert.deepEqual(view.element.querySelectorAll("[data-readonly-mode]").map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  assert.deepEqual(view.element.querySelectorAll("[data-tracking-mode]").map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  assert.deepEqual(view.element.querySelectorAll("[data-layer-order]").map(one => one.getAttribute("aria-checked")), ["true", "false"]);
  const inert = settings.create(doc, { theme: null, themes: [], display: null });
  assert.match(inert.element.querySelectorAll(".slate-settings__note").map(one => one.textContent).join(" "), /Layout cannot be changed/);
  click(inert.layerOrientation("top"));
});

/* ----------------------------------------------------------------------
 *   The sheets: the orientation is one attribute on the root
 * -------------------------------------------------------------------- */

test("every Top and Grid rule is scoped to the root's data-layers attribute, left has no rule of its own, and the layers become a wrapping grid", () => {
  const sheets = ["recipe.css", "recipe-edit.css", "weights.css"].map(name => ({ name, css: fs.readFileSync(path.join(__dirname, "slate", "styles", "components", name), "utf8") }));
  for (const sheet of sheets) {
    for (const match of sheet.css.matchAll(/^[^\n{]*data-layers[^\n{]*\{/gm)) {
      assert.match(match[0], /^\s*\.slate-root\[data-layers="(top|grid)"\] \.slate-[a-z_-]+/, `${sheet.name}: "${match[0].trim()}" is not scoped to the root's top or grid orientation`);
    }
    assert.doesNotMatch(sheet.css, /data-layers="left"/, `${sheet.name} styles the left orientation, which is the sheet itself`);
  }
  // Neither page has a heading row over its layers any more.
  for (const [name, block] of [["recipe.css", "slate-recipe"], ["weights.css", "slate-weights"]]) {
    assert.doesNotMatch(sheets.find(sheet => sheet.name === name).css, new RegExp(`${block}__columns`), `${name} still styles a heading row the page no longer has`);
  }
  for (const [name, block] of [["recipe.css", "slate-recipe"], ["weights.css", "slate-weights"]]) {
    const css = sheets.find(sheet => sheet.name === name).css;
    assert.match(css, new RegExp(`\\.slate-root\\[data-layers="top"\\] \\.${block}__layers(,\\n[^{]*)? \\{[^}]*grid-template-columns: repeat\\(auto-fill, minmax\\(260px, 1fr\\)\\)`), `${name}: the layers do not wrap`);
  }
  // Both sections' sheets stay free of any width breakpoint: the wrap is the grid's own.
  for (const sheet of sheets) assert.doesNotMatch(sheet.css, /@media \(m(in|ax)-width/, `${sheet.name} gained a breakpoint`);
});

test("the Grid layout: a row per layer, the head a tile at its start and one cell per position in the same columns on every row, and Compare's band kept to the Grid and a phone", () => {
  const css = fs.readFileSync(path.join(__dirname, "slate", "styles", "components", "recipe.css"), "utf8");
  const rule = selector => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at > -1, `no rule for ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  // Every row the same columns: the head, then the deepest layer's positions.
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer'), /grid-template-columns: var\(--slate-grid-head-width\) repeat\(var\(--slate-hopper-rows, 6\), minmax\(0, 1fr\)\);/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer__rows'), /display: contents;/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper[data-recipe]'), /grid-column: calc\(var\(--slate-hopper-slot, 0\) \+ 2\);[^}]*border: var\(--slate-stroke\) solid light-dark\(transparent, var\(--slate-border\)\);/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper.is-empty'), /--slate-grid-unset: hidden;[^}]*--slate-grid-plus: "\+";/);
  // Outlined on a dark theme only: a light theme's tiles are their fill; a dark theme's need the edge.
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper.is-tracked'), /border-color: light-dark\(transparent, /);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper.is-pump-off'), /border-color: light-dark\(transparent, var\(--slate-pump-off\)\);/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper.is-empty'), /background: light-dark\([^;]*, transparent\);/);
  for (const theme of fs.readdirSync(path.join(__dirname, "slate", "styles", "themes"))) {
    assert.match(fs.readFileSync(path.join(__dirname, "slate", "styles", "themes", theme), "utf8"), /--slate-color-scheme: (light|dark);/, `${theme} does not say whether it is light or dark`);
  }
  // An empty cell's + stands on its resin (which opens the editor); its blend, weight and Track keep their room, unseen.
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper__resin::after'), /content: var\(--slate-grid-plus, none\);/);
  for (const part of ["pct", "weight", "controls"]) {
    assert.match(rule(`.slate-root[data-layers="grid"] .slate-hopper__${part}`), /visibility: var\(--slate-grid-unset, visible\);/, `${part} still shows in an empty cell`);
  }
  // The row is washed in the layer's tone, from the head fading across; the wash replaces the head's stripe.
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer'), /background: linear-gradient\(90deg, color-mix\(in srgb, var\(--slate-layer-tone\) 22%, transparent\)/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-layer__head'), /border-left-color: transparent;/, "the Grid's head drew the stripe the wash replaces");
  for (const tone of ["outside", "subskin", "core", "inside"]) {
    assert.match(rule(`.slate-layer[data-tone="${tone}"]`), new RegExp(`--slate-layer-tone: var\\(--slate-layer-${tone}\\)`));
  }
  const tokens = fs.readFileSync(path.join(__dirname, "slate", "styles", "tokens.css"), "utf8");
  assert.match(tokens, /--slate-grid-head-width: \d+px;/);
  // The band is withheld from the Left and Top rows; the Grid and a phone show it, a phone without the blend.
  assert.match(rule(".slate-hopper__next"), /display: none;/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper__next:not([hidden])'), /display: flex;/);
  // Short on room, the resin gives way and the blend stays whole.
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper__next-resin'), /min-width: 0;[^}]*text-overflow: ellipsis;/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper__next-pct'), /flex: none;/);
  // No arrow in a Grid cell: its width is the resin's.
  assert.doesNotMatch(css, /\.slate-root\[data-layers="grid"\] \.slate-hopper__next\[data-way/);
  // Compare never resizes a cell: what moves takes the weight's place, and the weight steps aside there.
  for (const selector of ['.slate-root[data-layers="grid"] .slate-hopper__next:not([hidden])', '.slate-root[data-layers="grid"] .slate-hopper__other:not([hidden])']) {
    assert.match(rule(selector), /grid-area: weight;/, `${selector} is not in the weight's place`);
  }
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper__weight'), /display: var\(--slate-grid-weight, block\);/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper.is-comparing'), /--slate-grid-weight: none;\s*--slate-toggle-label: none;/);
  assert.match(rule(".slate-toggle__label"), /display: var\(--slate-toggle-label, inline\);/);
  assert.match(rule('.slate-root[data-layers="grid"] .slate-hopper.is-offering'), /--slate-grid-say-end: 2;/);
  assert.doesNotMatch(css, /--slate-grid-strip/, "the reserved strip is back");
  assert.match(rule('.slate-root[data-input="touch"][data-viewport="phone"] .slate-hopper__next-pct'), /display: none;/);
  // A phone's own grid is written after the Grid layout's, so a phone keeps it.
  assert.ok(css.indexOf('.slate-root[data-layers="grid"] .slate-recipe__layers {') < css.indexOf('.slate-root[data-input="touch"][data-viewport="phone"] .slate-recipe__layers {'));
});

/* ----------------------------------------------------------------------
 *   The boot: automatic against a linked line
 * -------------------------------------------------------------------- */

function bootHosted(options) {
  const settings2 = options || {};
  const ROOT = __dirname;
  const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
  const host = read("slate-host.js");
  const doc = makeDocument({ href: "https://resin.tools/?view=slate" });
  doc.body.setAttribute("data-slate-view", "slate");
  const hostEl = doc.createElement("div");
  hostEl.setAttribute("data-slate-host", "");
  hostEl.setAttribute("data-slate-app", "");
  hostEl.setAttribute("class", "slate-root");
  // The host's mark for a visit (slate-host.js), before the boot reads it.
  if (settings2.visit) hostEl.setAttribute("data-slate-visit", "");
  doc.body.appendChild(hostEl);
  // Zero-delay timers are kept so a test can run Automatic tracking's
  // batch; the Timeline's tick and the notice's timer stay unfired.
  const queued = [];
  let handle = 0;
  const root = {
    document: doc, location: doc.location, Date, console,
    setTimeout: (fn, ms) => { handle += 1; queued.push({ handle, fn, ms: Number(ms) || 0 }); return handle; },
    clearTimeout: id => { const at = queued.findIndex(one => one.handle === id); if (at > -1) queued.splice(at, 1); }
  };
  const flush = () => { const due = queued.filter(one => one.ms === 0); for (const one of due) { queued.splice(queued.indexOf(one), 1); one.fn(); } return due.length; };
  // The window's own facts (matchMedia, Capacitor), for the tier.
  Object.assign(root, settings2.env || {});
  root.globalThis = root;
  vm.createContext(root);
  const load = file => new vm.Script(read(file), { filename: file }).runInContext(root);
  for (const file of ["scheduling.js", "station-command-contract.js", "station-command-bridge.js", "station-state-bridge.js", "slate-theme.js", "slate-display.js"]) load(file);
  hostEl.slateTheme = root.PolynSlateTheme.create(hostEl, null);
  const saved = storage(settings2.stored ? { [display.STORAGE_KEY]: JSON.stringify(settings2.stored) } : {});
  hostEl.slateDisplay = root.PolynSlateDisplay.create(hostEl, saved);
  const snap = demo.snapshot(Date.now());
  snap.line.linked = settings2.linked !== false;
  if (typeof settings2.mutate === "function") settings2.mutate(snap);
  root.PolynStationStateBridge.connect({ read: () => snap }).publish();
  const executed = [];
  root.PolynStationCommandBridge.connect({
    capabilities: ALL,
    execute(command, args) { executed.push({ command, args }); return root.PolynStationCommandContract.success({ changed: true, revision: 1, persisted: true, snapshot: root.PolynStationStateBridge.getSnapshot() }); }
  });
  const scripts = [...host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").matchAll(/"((?:slate|station)\/[^"]+\.js)"/g)].map(match => match[1]);
  for (const file of scripts) load(file);
  return { hostEl, executed, controller: hostEl.slateDisplay, flush };
}

/* A plan that swaps A1's resin (A1 untracked) and empties B3. */
function planForAutomatic(snap) {
  snap.layers[0].hoppers[0].track = false;
  snap.nextRecipe = { layers: snap.layers.map(layer => ({ name: layer.name, layerPct: layer.layerPct, hoppers: layer.hoppers.map(h => ({ index: h.index, pct: h.pct, resinName: h.resinName })) })) };
  snap.nextRecipe.layers[0].hoppers[0].resinName = "ZZ1";
  snap.nextRecipe.layers[1].hoppers[2] = { index: 2, pct: 0, resinName: "" };
}

test("hosted on a linked line under Automatic read-only, Slate is read-only: badge shown, toggles unable, no command reaches the executor", () => {
  const { hostEl, executed, controller } = bootHosted({ linked: true, stored: { readOnly: null } });
  assert.equal(hostEl.getAttribute("data-readonly"), "on");
  const badge = hostEl.querySelector("[data-slate-readonly]");
  assert.ok(!badge.hasAttribute("hidden"), "the badge is hidden on a linked line");
  const toggle = hostEl.querySelector(".slate-hopper[data-hopper='A3'] [data-slate-control='tracking']");
  assert.equal(toggle.getAttribute("data-able"), "false");
  toggle.dispatchEvent({ type: "click", target: toggle, stopPropagation() {} });
  assert.equal(executed.length, 0);
  assert.ok(hostEl.querySelector(".slate-card--rate").classList.contains("is-readonly"));
  // The recipe's edits are withheld too: a cell never opens, the badge never lifts.
  const resinCell = hostEl.querySelector(".slate-hopper[data-hopper='A3'] .slate-hopper__resin");
  assert.equal(resinCell.getAttribute("data-able"), "false");
  resinCell.dispatchEvent({ type: "click", target: resinCell, stopPropagation() {} });
  assert.equal(hostEl.querySelector(".slate-combobox"), null, "a resin editor opened under read-only");
  assert.ok(!hostEl.querySelector(".slate-hopper[data-hopper='A3']").classList.contains("is-movable"));

  // The badge opens Settings; choosing Off makes the line writable at once.
  badge.dispatchEvent({ type: "click", target: badge, stopPropagation() {} });
  assert.equal(hostEl.querySelector(".slate-header__title").textContent, "Settings");
  controller.setReadOnly("off");
  assert.equal(hostEl.getAttribute("data-readonly"), "off");
  assert.ok(badge.hasAttribute("hidden"));
  assert.equal(toggle.getAttribute("data-able"), "true");
  toggle.dispatchEvent({ type: "click", target: toggle, stopPropagation() {} });
  assert.equal(executed.length, 1);
  assert.equal(resinCell.getAttribute("data-able"), "true");
  assert.ok(hostEl.querySelector(".slate-hopper[data-hopper='A3']").classList.contains("is-movable"));
});

test("with no record Slate is writable, linked line or not - Off is the default; automatic follows the line; an explicit On still holds", () => {
  const fresh = bootHosted({ linked: true });
  assert.equal(fresh.hostEl.getAttribute("data-readonly"), "off");
  assert.ok(fresh.hostEl.querySelector("[data-slate-readonly]").hasAttribute("hidden"));
  assert.equal(fresh.hostEl.querySelector("[data-readonly-mode='off']").getAttribute("aria-checked"), "true");
  const own = bootHosted({ linked: false, stored: { readOnly: null } });
  assert.equal(own.hostEl.getAttribute("data-readonly"), "off");
  assert.ok(own.hostEl.querySelector("[data-slate-readonly]").hasAttribute("hidden"));
  assert.equal(own.hostEl.querySelector(".slate-hopper[data-hopper='A3'] [data-slate-control='tracking']").getAttribute("data-able"), "true");

  const forced = bootHosted({ linked: false, stored: { readOnly: true } });
  assert.equal(forced.hostEl.getAttribute("data-readonly"), "on");
  assert.equal(forced.hostEl.querySelector(".slate-hopper[data-hopper='A3'] [data-slate-control='tracking']").getAttribute("data-able"), "false");
});

test("hosted under Automatic tracking on the device's own session, no Track is offered and the batch reaches the executor on the next tick; on a linked line read-only holds it back", () => {
  const own = bootHosted({ linked: false, stored: { tracking: "automatic" }, mutate: planForAutomatic });
  const toggles = own.hostEl.querySelectorAll(".slate-recipe__body[data-recipe='current'] [data-slate-control='tracking']");
  assert.ok(toggles.length > 0);
  assert.ok(toggles.every(one => one.hasAttribute("hidden")), "a Track toggle shows under Automatic");
  assert.equal(own.executed.length, 0, "a command ran inside the boot's publish");
  own.flush();
  assert.deepEqual(own.executed.map(one => `${one.command} ${one.args.layer}:${one.args.index}:${one.args.track}`), ["setHopperTracking A:0:true", "setHopperTracking B:2:true"]);

  const linked = bootHosted({ linked: true, stored: { readOnly: null, tracking: "automatic" }, mutate: planForAutomatic });
  linked.flush();
  assert.equal(linked.executed.length, 0, "Automatic tracked under read-only");
  // Read-only Off in Settings: the batch follows at once.
  linked.controller.setReadOnly("off");
  linked.flush();
  assert.equal(linked.executed.length, 2);
});

test("hosted, the root carries the layer orientation; the switch flips the attribute alone - no command, no rebuild, every row keeps its element", () => {
  const { hostEl, executed, controller } = bootHosted({ linked: false });
  assert.equal(hostEl.getAttribute("data-layers"), "grid");
  const rows = hostEl.querySelectorAll(".slate-hopper");
  assert.ok(rows.length > 0);
  const resinCell = hostEl.querySelector(".slate-hopper[data-hopper='A3'] .slate-hopper__resin");
  resinCell.dispatchEvent({ type: "click", target: resinCell, stopPropagation() {} });
  assert.ok(hostEl.querySelector(".slate-combobox"), "the resin editor did not open");
  controller.setLayerOrientation("top");
  assert.equal(hostEl.getAttribute("data-layers"), "top");
  assert.equal(executed.length, 0);
  const after = hostEl.querySelectorAll(".slate-hopper");
  assert.equal(after.length, rows.length);
  for (let i = 0; i < rows.length; i += 1) assert.ok(rows[i] === after[i], `row ${i} was rebuilt by the orientation switch`);
  assert.ok(hostEl.querySelector(".slate-combobox"), "the orientation switch closed the open editor");
  controller.setLayerOrientation("left");
  assert.equal(hostEl.getAttribute("data-layers"), "left");

  const stored = bootHosted({ linked: false, stored: { layers: "top" } });
  assert.equal(stored.hostEl.getAttribute("data-layers"), "top");
  assert.equal(stored.hostEl.querySelector("[data-layer-orientation='top']").getAttribute("aria-checked"), "true");
});

/* ----------------------------------------------------------------------
 *   Layer order: A first, or the last layer first
 * -------------------------------------------------------------------- */

test("the layer order is forward or reversed, defaults to forward, persists beside the others, and an old record without it reads forward", () => {
  assert.deepEqual(display.LAYER_ORDERS, ["forward", "reversed"]);
  assert.equal(display.DEFAULTS.layerOrder, "forward");
  assert.deepEqual(display.normalize({ layerOrder: "reversed", timeline: "realtime", input: "auto", host: "auto" }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "reversed", timeline: "realtime", input: "auto", host: "auto" });
  assert.deepEqual(display.normalize({ layerOrder: "backwards" }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.equal(display.layerOrderOf("reversed"), "reversed");
  assert.equal(display.layerOrderOf("REVERSED"), "forward");
  assert.equal(display.layerOrderOf(undefined), "forward");

  const saved = storage();
  const controller = display.create(node(), saved);
  assert.equal(controller.getLayerOrder(), "forward");
  const heard = [];
  controller.subscribe(value => heard.push(`${value.layerOrder}/${value.layers}`));
  assert.equal(controller.setLayerOrder("reversed"), "reversed");
  assert.deepEqual(JSON.parse(saved.store[display.STORAGE_KEY]), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "reversed", timeline: "realtime", input: "auto", host: "auto" });
  controller.setLayerOrder("reversed");
  assert.equal(controller.setLayerOrder("nonsense"), "forward");
  controller.setLayerOrder("reversed");
  controller.setLayerOrientation("top");
  assert.equal(controller.getLayerOrder(), "reversed", "the orientation moved the order");
  assert.deepEqual(heard, ["reversed/grid", "forward/grid", "reversed/grid", "reversed/top"]);
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ layers: "top" }) })).getLayerOrder(), "forward");
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ layerOrder: "reversed", timeline: "realtime", input: "auto", host: "auto" }) })).getLayerOrder(), "reversed");
});

test("Settings offers A → E / E → A as radios after Layout, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const controller = display.create(node(), storage());
  const view = settings.create(doc, { theme: null, themes: [], display: controller });
  const group = view.element.querySelector("[role='radiogroup'][aria-label='Layer order']");
  assert.ok(group, "no Layer order radiogroup");
  const labels = view.element.querySelectorAll(".slate-settings__group").map(one => one.getAttribute("aria-label"));
  assert.equal(labels.indexOf("Layer order"), labels.indexOf("Layout") + 1);
  const modes = view.element.querySelectorAll("[data-layer-order]");
  assert.deepEqual(modes.map(one => one.getAttribute("data-layer-order")), ["forward", "reversed"]);
  assert.deepEqual(modes.map(one => one.getAttribute("role")), ["radio", "radio"]);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false"]);
  assert.deepEqual(modes.map(one => one.querySelector(".slate-settings__mode-label").textContent), ["A → E", "E → A"]);
  click(view.layerOrder("reversed"));
  assert.equal(controller.getLayerOrder(), "reversed");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "true"]);
  assert.ok(view.layerOrder("reversed").classList.contains("is-selected"));
  controller.setLayerOrder("forward");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false"]);
  assert.deepEqual(view.element.querySelectorAll("[data-layer-orientation]").map(one => one.getAttribute("aria-checked")), ["false", "false", "true"]);
  const inert = settings.create(doc, { theme: null, themes: [], display: null });
  assert.match(inert.element.querySelectorAll(".slate-settings__note").map(one => one.textContent).join(" "), /Layer order cannot be changed/);
  click(inert.layerOrder("reversed"));
});

test("every layer card carries its index for the sheets, and the reversed rule turns the cards around in both sections' sheets", () => {
  for (const [name, block] of [["recipe.css", "slate-layer"], ["weights.css", "slate-weights__layer"]]) {
    const css = fs.readFileSync(path.join(__dirname, "slate", "styles", "components", name), "utf8");
    assert.match(css, new RegExp(`\\.slate-root\\[data-layer-order="reversed"\\] \\.${block} \\{\\s*order: calc\\(-1 \\* var\\(--slate-layer-i, 0\\)\\);`), `${name}: no reversed rule`);
    assert.doesNotMatch(css, /data-layer-order="forward"/, `${name} styles the forward order, which is the sheet itself`);
  }
  const { hostEl, controller } = bootHosted({ linked: false });
  assert.equal(hostEl.getAttribute("data-layer-order"), "forward");
  const cards = hostEl.querySelectorAll(".slate-recipe__body[data-recipe='current'] .slate-layer");
  assert.deepEqual(cards.map(card => card.getAttribute("data-layer")), ["A", "B", "C"]);
  assert.deepEqual(cards.map(card => card.style.getPropertyValue("--slate-layer-i")), ["0", "1", "2"]);
  const before = hostEl.querySelectorAll(".slate-hopper");
  controller.setLayerOrder("reversed");
  assert.equal(hostEl.getAttribute("data-layer-order"), "reversed");
  const after = hostEl.querySelectorAll(".slate-hopper");
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i += 1) assert.ok(before[i] === after[i], `row ${i} was rebuilt by the order switch`);
  // The Weights cards carry the same index.
  const weights = hostEl.querySelectorAll(".slate-weights__layer");
  assert.deepEqual(weights.map(card => card.style.getPropertyValue("--slate-layer-i")), ["0", "1", "2"]);
  const stored = bootHosted({ linked: false, stored: { layerOrder: "reversed", timeline: "realtime", input: "auto", host: "auto" } });
  assert.equal(stored.hostEl.getAttribute("data-layer-order"), "reversed");
});

/* ----------------------------------------------------------------------
 *   The timeline's view: realtime, or a list
 * -------------------------------------------------------------------- */

test("the timeline view is realtime or list, defaults to realtime, persists beside the others, and an old record without it reads realtime", () => {
  assert.deepEqual(display.TIMELINE_VIEWS, ["realtime", "list"]);
  assert.equal(display.DEFAULTS.timeline, "realtime");
  assert.deepEqual(display.normalize({ timeline: "list", input: "auto", host: "auto" }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "list", input: "auto", host: "auto" });
  assert.deepEqual(display.normalize({ timeline: "table" }), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "realtime", input: "auto", host: "auto" });
  assert.equal(display.timelineViewOf("list"), "list");
  assert.equal(display.timelineViewOf("LIST"), "realtime");
  const saved = storage();
  const controller = display.create(node(), saved);
  assert.equal(controller.getTimelineView(), "realtime");
  const heard = [];
  controller.subscribe(value => heard.push(value.timeline));
  assert.equal(controller.setTimelineView("list"), "list");
  assert.deepEqual(JSON.parse(saved.store[display.STORAGE_KEY]), { readOnly: false, tracking: "automatic", layers: "grid", layerOrder: "forward", timeline: "list", input: "auto", host: "auto" });
  controller.setTimelineView("list");
  assert.equal(controller.setTimelineView("nonsense"), "realtime");
  controller.setLayerOrder("reversed");
  assert.deepEqual(heard, ["list", "realtime", "realtime"]);
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ layers: "top" }) })).getTimelineView(), "realtime");
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ timeline: "list", input: "auto", host: "auto" }) })).getTimelineView(), "list");
});

test("Settings offers Realtime / List as radios after Layer order, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const controller = display.create(node(), storage());
  const view = settings.create(doc, { theme: null, themes: [], display: controller });
  const group = view.element.querySelector("[role='radiogroup'][aria-label='Timeline view']");
  assert.ok(group, "no Timeline view radiogroup");
  const labels = view.element.querySelectorAll(".slate-settings__group").map(one => one.getAttribute("aria-label"));
  assert.equal(labels.indexOf("Timeline"), labels.indexOf("Layer order") + 1);
  const modes = view.element.querySelectorAll("[data-timeline-view]");
  assert.deepEqual(modes.map(one => one.getAttribute("data-timeline-view")), ["realtime", "list"]);
  assert.deepEqual(modes.map(one => one.getAttribute("role")), ["radio", "radio"]);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false"]);
  assert.deepEqual(modes.map(one => one.querySelector(".slate-settings__mode-label").textContent), ["Realtime", "List"]);
  click(view.timelineView("list"));
  assert.equal(controller.getTimelineView(), "list");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "true"]);
  assert.ok(view.timelineView("list").classList.contains("is-selected"));
  controller.setTimelineView("realtime");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false"]);
  const inert = settings.create(doc, { theme: null, themes: [], display: null });
  assert.match(inert.element.querySelectorAll(".slate-settings__note").map(one => one.textContent).join(" "), /timeline's view cannot be changed/);
  click(inert.timelineView("list"));
});

test("hosted, the Timeline follows the controller's view: List hides the axis and lists the rows, Realtime brings the cards back, the rows are the same elements throughout", () => {
  const { hostEl, executed, controller } = bootHosted({ linked: false });
  const timeline = hostEl.querySelector(".slate-timeline");
  assert.equal(timeline.getAttribute("data-view"), "realtime");
  const before = new Map(timeline.querySelectorAll(".slate-timeline__member").map(row => [row.getAttribute("data-key"), row]));
  assert.ok(before.size > 0);
  controller.setTimelineView("list");
  assert.equal(timeline.getAttribute("data-view"), "list");
  assert.ok(timeline.querySelector(".slate-timeline__axis").hasAttribute("hidden"));
  assert.ok(timeline.querySelectorAll(".slate-timeline__list .slate-timeline__member").length > 0);
  assert.equal(timeline.querySelectorAll(".slate-timeline__event").length, 0);
  assert.equal(executed.length, 0);
  for (const row of timeline.querySelectorAll(".slate-timeline__member")) assert.ok(before.get(row.getAttribute("data-key")) === row, "a row was rebuilt");
  controller.setTimelineView("realtime");
  assert.equal(timeline.getAttribute("data-view"), "realtime");
  assert.ok(timeline.querySelectorAll(".slate-timeline__event").length > 0);
  for (const row of timeline.querySelectorAll(".slate-timeline__member")) assert.ok(before.get(row.getAttribute("data-key")) === row, "a row was rebuilt");
  const stored = bootHosted({ linked: false, stored: { timeline: "list", input: "auto", host: "auto" } });
  assert.equal(stored.hostEl.querySelector(".slate-timeline").getAttribute("data-view"), "list");
  assert.equal(stored.hostEl.querySelector("[data-timeline-view='list']").getAttribute("aria-checked"), "true");
});

/* ----------------------------------------------------------------------
 *   Input: touch or pointer
 * -------------------------------------------------------------------- */

/* A window whose media queries answer from `state` and tell their
 * listeners when `change()` moves it - a rotation, a mouse plugged in. */
function fakeMedia(state) {
  const lists = [];
  function answer(query) {
    if (query === "(pointer: coarse)") return !!state.coarse;
    const min = query.match(/\(min-width: (\d+)px\)/);
    return min ? state.width >= Number(min[1]) : false;
  }
  return {
    matchMedia(query) {
      const listeners = new Set();
      const list = { query, get matches() { return answer(query); }, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn), listeners };
      lists.push(list);
      return list;
    },
    change(next) {
      Object.assign(state, next);
      for (const list of lists) for (const fn of [...list.listeners]) fn({ matches: list.matches });
    }
  };
}

test("the input mode is auto, touch or pointer, defaults to auto, persists beside the others, and an old record without it reads auto", () => {
  assert.deepEqual(display.INPUT_MODES, ["auto", "touch", "pointer"]);
  assert.equal(display.DEFAULTS.input, "auto");
  assert.equal(display.normalize({ input: "touch" }).input, "touch");
  assert.equal(display.normalize({ input: "finger" }).input, "auto");
  assert.equal(display.inputModeOf("pointer"), "pointer");
  assert.equal(display.inputModeOf("POINTER"), "auto");
  const saved = storage();
  const controller = display.create(node(), saved);
  assert.equal(controller.getInputMode(), "auto");
  const heard = [];
  controller.subscribe(value => heard.push(value.input));
  assert.equal(controller.setInputMode("touch"), "touch");
  assert.equal(JSON.parse(saved.store[display.STORAGE_KEY]).input, "touch");
  controller.setInputMode("touch");
  assert.equal(controller.setInputMode("nonsense"), "auto");
  assert.deepEqual(heard, ["touch", "auto"]);
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ layers: "top" }) })).getInputMode(), "auto");
});

test("Settings offers Automatic / Touch / Mouse input as radios after Timeline, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const controller = display.create(node(), storage());
  const view = settings.create(doc, { theme: null, themes: [], display: controller });
  const labels = view.element.querySelectorAll(".slate-settings__group").map(one => one.getAttribute("aria-label"));
  assert.equal(labels.indexOf("Input"), labels.indexOf("Timeline") + 1);
  const modes = view.element.querySelectorAll("[data-input-mode]");
  assert.deepEqual(modes.map(one => one.getAttribute("data-input-mode")), ["auto", "touch", "pointer"]);
  assert.deepEqual(modes.map(one => one.getAttribute("role")), ["radio", "radio", "radio"]);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  assert.deepEqual(modes.map(one => one.querySelector(".slate-settings__mode-label").textContent), ["Automatic", "Touch", "Mouse"]);
  click(view.inputMode("touch"));
  assert.equal(controller.getInputMode(), "touch");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "true", "false"]);
  const inert = settings.create(doc, { theme: null, themes: [], display: null });
  assert.match(inert.element.querySelectorAll(".slate-settings__note").map(one => one.textContent).join(" "), /input cannot be changed/);
  click(inert.inputMode("touch"));
});

test("hosted, the root carries the tier: a desktop is pointer and wide; a coarse or native window is touch; the width follows a rotation; the Settings choice wins - and nothing is rebuilt or dispatched", () => {
  const desk = bootHosted({ linked: false, env: fakeMedia({ coarse: false, width: 1440 }) });
  assert.equal(desk.hostEl.getAttribute("data-input"), "pointer");
  assert.equal(desk.hostEl.getAttribute("data-viewport"), "wide");

  const native = bootHosted({ linked: false, env: Object.assign(fakeMedia({ coarse: false, width: 1280 }), { Capacitor: { isNativePlatform: () => true } }) });
  assert.equal(native.hostEl.getAttribute("data-input"), "touch");

  const media = fakeMedia({ coarse: true, width: 1280 });
  const { hostEl, executed, controller } = bootHosted({ linked: false, env: media });
  assert.equal(hostEl.getAttribute("data-input"), "touch");
  assert.equal(hostEl.getAttribute("data-viewport"), "wide");
  const rows = hostEl.querySelectorAll(".slate-hopper");
  assert.ok(rows.length > 0);
  media.change({ width: 800 });
  assert.equal(hostEl.getAttribute("data-viewport"), "narrow", "a rotation to portrait did not reach the root");
  controller.setInputMode("pointer");
  assert.equal(hostEl.getAttribute("data-input"), "pointer");
  controller.setInputMode("auto");
  assert.equal(hostEl.getAttribute("data-input"), "touch");
  const after = hostEl.querySelectorAll(".slate-hopper");
  assert.equal(after.length, rows.length);
  for (let i = 0; i < rows.length; i += 1) assert.ok(rows[i] === after[i], `row ${i} was rebuilt by a tier change`);
  assert.equal(executed.length, 0);

  const bare = bootHosted({ linked: false });
  assert.equal(bare.hostEl.getAttribute("data-input"), "pointer", "a window with nothing to measure is not a touch screen");
  assert.equal(bare.hostEl.getAttribute("data-viewport"), "wide");
});

test("on a narrow touch screen the aside is a drawer: its handle and a rail item open it, the scrim and Escape close it, widening shuts it - and a mouse never has one", () => {
  const media = fakeMedia({ coarse: true, width: 800 });
  const { hostEl, executed } = bootHosted({ linked: false, env: media });
  const aside = hostEl.querySelector("[data-slate-mount='aside']");
  const toggle = hostEl.querySelector("[data-slate-aside-handle]");
  const scrim = hostEl.querySelector("[data-slate-scrim]");
  assert.ok(toggle && scrim, "the shell has no drawer handle or scrim");
  assert.equal(toggle.getAttribute("aria-label"), "Timeline");
  assert.ok(!aside.classList.contains("is-open"));
  assert.ok(scrim.hasAttribute("hidden"));
  click(toggle);
  assert.ok(aside.classList.contains("is-open"));
  assert.ok(!scrim.hasAttribute("hidden"));
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  click(scrim);
  assert.ok(!aside.classList.contains("is-open"));
  assert.ok(scrim.hasAttribute("hidden"));

  // A rail item for an aside section opens the drawer on that section, and names it on the button.
  click(hostEl.querySelector(".slate-rail__item[data-section='resin-balance']"));
  assert.ok(aside.classList.contains("is-open"));
  assert.equal(toggle.getAttribute("aria-label"), "Resin Balance");
  assert.ok(toggle.classList.contains("is-open"), "the handle does not ride the open drawer");
  hostEl.dispatchEvent({ type: "keydown", key: "Escape", target: hostEl, stopPropagation() {} });
  assert.ok(!aside.classList.contains("is-open"), "Escape left the drawer open");

  click(toggle);
  media.change({ width: 1280 });
  assert.ok(!aside.classList.contains("is-open"), "a drawer stayed open once the aside had room again");
  assert.equal(executed.length, 0);

  const desk = bootHosted({ linked: false, env: fakeMedia({ coarse: false, width: 800 }) });
  click(desk.hostEl.querySelector("[data-slate-aside-handle]"));
  assert.ok(!desk.hostEl.querySelector("[data-slate-mount='aside']").classList.contains("is-open"), "a mouse window opened a drawer");
});

test("the Android Back key, asked first, closes the drawer; with nothing open it lets the app go to the background", () => {
  const media = fakeMedia({ coarse: true, width: 800 });
  const { hostEl } = bootHosted({ linked: false, env: media });
  const doc = hostEl.ownerDocument;
  const aside = hostEl.querySelector("[data-slate-mount='aside']");
  const back = () => {
    const event = { type: "polyn:android-back", detail: { minimize: false }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const handler of doc.listeners["polyn:android-back"] || []) handler(event);
    return event;
  };
  click(hostEl.querySelector("[data-slate-aside-handle]"));
  assert.ok(aside.classList.contains("is-open"));
  const first = back();
  assert.equal(first.defaultPrevented, true);
  assert.equal(first.detail.minimize, false);
  assert.ok(!aside.classList.contains("is-open"), "Back left the drawer open");
  const second = back();
  assert.equal(second.defaultPrevented, true, "Slate let the hidden floor UI take the key");
  assert.equal(second.detail.minimize, true);
});

test("the drawer's handle carries a dot while a hopper is overdue and running", () => {
  const { hostEl } = bootHosted({ linked: false, env: fakeMedia({ coarse: true, width: 800 }) });
  const handle = hostEl.querySelector("[data-slate-aside-handle]");
  const dot = handle.querySelector(".slate-shell__handle-dot");
  assert.ok(dot, "the handle has no dot");
  const timeline = hostEl.querySelector(".slate-timeline");
  const overdue = timeline.classList.contains("is-overdue");
  assert.equal(!dot.hasAttribute("hidden"), overdue, "the dot disagrees with the Timeline");
  assert.equal(handle.classList.contains("is-overdue"), overdue);
});

test("on a phone the layers stand on top whatever is chosen, the app opens on Home, Home and the bar move between pages, Tools and Menu raise sheets, and Back walks back Home before it lets the app go", () => {
  const media = fakeMedia({ coarse: true, width: 412 });
  const { hostEl, executed } = bootHosted({ linked: false, env: media, stored: { layers: "left" } });
  const doc = hostEl.ownerDocument;
  assert.equal(hostEl.getAttribute("data-viewport"), "phone");
  assert.equal(hostEl.getAttribute("data-layers"), "top", "a phone stood the layer heads at the left");
  assert.equal(hostEl.slateDisplay.getLayerOrientation(), "left", "the operator's choice was overwritten");
  const aside = hostEl.querySelector("[data-slate-mount='aside']");
  const rail = hostEl.querySelector("[data-slate-mount='rail']");
  const scrim = hostEl.querySelector("[data-slate-scrim]");
  const tools = hostEl.querySelector(".slate-toolsheet");
  const title = () => hostEl.querySelector(".slate-header__title").textContent;
  const keys = [...hostEl.querySelectorAll("[data-slate-mount='bar'] [data-bar-key]")];
  assert.deepEqual(keys.map(one => one.getAttribute("data-bar-key")), ["weights", "tools", "home", "settings", "menu"]);
  const bar = id => keys.find(one => one.getAttribute("data-bar-key") === id);
  const step = id => hostEl.querySelector(`[data-home-step='${id}']`);
  const active = () => keys.filter(one => one.classList.contains("is-active")).map(one => one.getAttribute("data-bar-key"));
  const shown = () => hostEl.querySelector("[data-slate-mount='centre']").querySelectorAll(".slate-section").find(one => !one.hasAttribute("hidden"));
  const back = () => {
    const event = { type: "polyn:android-back", detail: { minimize: false }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const handler of doc.listeners["polyn:android-back"] || []) handler(event);
    return event;
  };
  // A phone opens on Home.
  assert.deepEqual(active(), ["home"]);
  assert.equal(shown().getAttribute("data-section"), "home");
  // Home's steps lead to the Recipe, the Timeline (the page over the centre, no scrim) and Resin Balance; all light Home.
  click(step("recipe"));
  assert.equal(shown().getAttribute("data-section"), "recipe");
  assert.deepEqual(active(), ["home"]);
  click(bar("home"));
  click(step("timeline"));
  assert.ok(aside.classList.contains("is-open"));
  assert.ok(scrim.hasAttribute("hidden"), "the Timeline's page raised a scrim");
  assert.deepEqual(active(), ["home"]);
  assert.equal(title(), "Timeline");
  click(bar("weights"));
  assert.ok(!aside.classList.contains("is-open"));
  assert.deepEqual(active(), ["weights"]);
  assert.equal(shown().getAttribute("data-section"), "weights");
  click(bar("settings"));
  assert.deepEqual(active(), ["settings"]);
  assert.equal(shown().getAttribute("data-section"), "settings");
  assert.ok(hostEl.querySelector(".slate-settings__legacy-link"), "Settings has no way back to the floor UI");

  // Tools raises its sheet over the scrim; a choice opens the tool and lights Tools.
  click(bar("tools"));
  assert.ok(!tools.hasAttribute("hidden"));
  assert.ok(!scrim.hasAttribute("hidden"));
  assert.equal(bar("tools").getAttribute("aria-expanded"), "true");
  assert.deepEqual(tools.querySelectorAll("[data-tool]").map(one => one.getAttribute("data-tool")), ["pressure", "winding-tension"]);
  click(tools.querySelector("[data-tool='winding-tension']"));
  assert.ok(tools.hasAttribute("hidden"));
  assert.ok(aside.classList.contains("is-open"));
  assert.deepEqual(active(), ["tools"]);
  // Menu raises the rail with everything; the Book, which the bar does not name, lights Menu.
  click(bar("menu"));
  assert.ok(rail.classList.contains("is-open"));
  assert.ok(!scrim.hasAttribute("hidden"));
  click(hostEl.querySelector(".slate-rail__item[data-section='recipe-book']"));
  assert.ok(!rail.classList.contains("is-open"));
  assert.ok(!aside.classList.contains("is-open"));
  assert.deepEqual(active(), ["menu"]);
  // The scrim lowers a sheet.
  click(bar("tools"));
  click(scrim);
  assert.ok(tools.hasAttribute("hidden"));

  // Back: a sheet, the page, then the section, then the app.
  click(bar("tools"));
  let event = back();
  assert.ok(tools.hasAttribute("hidden"), "Back left the Tools sheet up");
  assert.equal(event.detail.minimize, false);
  click(step("timeline")); // not on screen, but the step stays wired
  event = back();
  assert.ok(!aside.classList.contains("is-open"), "Back left the page up");
  event = back();
  assert.equal(event.detail.minimize, false);
  assert.deepEqual(active(), ["home"], "Back did not come home");
  event = back();
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.detail.minimize, true);

  // The drawer's handle does nothing on a phone.
  click(hostEl.querySelector("[data-slate-aside-handle]"));
  assert.ok(!aside.classList.contains("is-open"));

  // Wider again: no page, no sheet, the operator's layout back, Home unlisted.
  click(step("timeline"));
  click(bar("menu"));
  media.change({ width: 1280 });
  assert.equal(hostEl.getAttribute("data-viewport"), "wide");
  assert.equal(hostEl.getAttribute("data-layers"), "left");
  assert.ok(!aside.classList.contains("is-open"));
  assert.ok(!rail.classList.contains("is-open"));
  assert.ok(hostEl.querySelector(".slate-rail__item[data-section='home']").hasAttribute("hidden"));
  assert.equal(executed.length, 0);
});

test("the application's pump-off alert is Slate's to show: the event is taken, the alert says which hopper, and Dismiss or Back closes it and stops the vibration", () => {
  const { hostEl } = bootHosted({ linked: false, env: fakeMedia({ coarse: true, width: 412 }) });
  const doc = hostEl.ownerDocument;
  const alert = hostEl.querySelector("[data-slate-alert]");
  assert.ok(alert.hasAttribute("hidden"));
  assert.equal(alert.getAttribute("role"), "alert");
  const fire = detail => {
    const event = { type: "polyn:pump-off-alert", detail, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const handler of doc.listeners["polyn:pump-off-alert"] || []) handler(event);
    return event;
  };
  let stopped = 0;
  const event = fire({ hopper: "B2", resin: "HD622", dismiss: () => { stopped += 1; } });
  assert.equal(event.defaultPrevented, true, "the floor UI's hidden banner would be the only one");
  assert.ok(!alert.hasAttribute("hidden"));
  assert.equal(alert.querySelector(".slate-alert__text").textContent, "Pump off B2: HD622 is due now.");
  click(alert.querySelector(".slate-alert__dismiss"));
  assert.ok(alert.hasAttribute("hidden"));
  assert.equal(stopped, 1);
  fire({ hopper: "A1", resin: "", dismiss: () => { stopped += 1; } });
  assert.equal(alert.querySelector(".slate-alert__text").textContent, "Pump off A1: Tracked hopper is due now.");
  const back = { type: "polyn:android-back", detail: { minimize: false }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  for (const handler of doc.listeners["polyn:android-back"] || []) handler(back);
  assert.ok(alert.hasAttribute("hidden"), "Back left the alert up");
  assert.equal(back.detail.minimize, false);
  assert.equal(stopped, 2);
});

test("Back closes a tool in the Scrap card's place on a phone, where it is a sheet; on a tablet Back leaves it and lets the app go, as before", () => {
  const back = doc => {
    const event = { type: "polyn:android-back", detail: { minimize: false }, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const handler of doc.listeners["polyn:android-back"] || []) handler(event);
    return event;
  };
  const shown = hostEl => hostEl.querySelector("[data-slate-mount='stats']").querySelectorAll(".slate-section").filter(one => !one.hasAttribute("hidden")).map(one => one.getAttribute("data-section"));
  const phone = bootHosted({ linked: false, env: fakeMedia({ coarse: true, width: 412 }) });
  click(phone.hostEl.querySelector(".slate-rail__item[data-section='pressure']"));
  assert.deepEqual(shown(phone.hostEl), ["pressure"]);
  assert.equal(back(phone.hostEl.ownerDocument).detail.minimize, false);
  assert.deepEqual(shown(phone.hostEl), ["scrap"]);
  const tablet = bootHosted({ linked: false, env: fakeMedia({ coarse: true, width: 800 }) });
  click(tablet.hostEl.querySelector(".slate-rail__item[data-section='pressure']"));
  assert.deepEqual(shown(tablet.hostEl), ["pressure"]);
  assert.equal(back(tablet.hostEl.ownerDocument).detail.minimize, true, "a tablet's Back changed");
  assert.deepEqual(shown(tablet.hostEl), ["pressure"]);
});

test("a visit - the address asked for Slate where the device would have opened the floor UI - offers to open Slate every time; Always makes it this device's choice, Not now only closes; a device that chose, or no visit, is not asked", () => {
  const offer = hostEl => hostEl.querySelector("[data-slate-offer]");
  const visit = bootHosted({ linked: false, env: fakeMedia({ coarse: true, width: 412 }), visit: true });
  assert.ok(!offer(visit.hostEl).hasAttribute("hidden"));
  click(offer(visit.hostEl).querySelector("[data-slate-offer-do='always']"));
  assert.equal(visit.hostEl.slateDisplay.getHostChoice(), "slate");
  assert.ok(offer(visit.hostEl).hasAttribute("hidden"));
  const later = bootHosted({ linked: false, env: fakeMedia({ coarse: true, width: 412 }), visit: true });
  click(offer(later.hostEl).querySelector("[data-slate-offer-do='dismiss']"));
  assert.equal(later.hostEl.slateDisplay.getHostChoice(), "auto");
  assert.ok(offer(later.hostEl).hasAttribute("hidden"));
  const chose = bootHosted({ linked: false, env: fakeMedia({ coarse: true, width: 412 }), visit: true, stored: { host: "legacy" } });
  assert.ok(offer(chose.hostEl).hasAttribute("hidden"), "a device that chose the floor UI was asked");
  const desk = bootHosted({ linked: false, env: fakeMedia({ coarse: false, width: 1440 }) });
  assert.ok(offer(desk.hostEl).hasAttribute("hidden"));
});
