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
  assert.deepEqual(display.normalize(null), { readOnly: null });
  assert.deepEqual(display.normalize({ readOnly: "yes", other: 1 }), { readOnly: null });
  assert.deepEqual(display.normalize({ readOnly: false }), { readOnly: false });
  assert.equal(display.modeOf(null), "auto");
  assert.equal(display.modeOf(true), "on");
  assert.equal(display.modeOf(false), "off");
  assert.equal(display.readOnlyOf("on"), true);
  assert.equal(display.readOnlyOf("off"), false);
  assert.equal(display.readOnlyOf("auto"), null);
  assert.equal(display.readOnlyOf("nonsense"), null);

  const saved = storage();
  const controller = display.create(node(), saved);
  assert.equal(controller.getReadOnly(), null);
  assert.equal(controller.getReadOnlyMode(), "auto");
  const heard = [];
  controller.subscribe(value => heard.push(value.readOnly));
  assert.equal(controller.setReadOnly("on"), true);
  assert.equal(JSON.parse(saved.store[display.STORAGE_KEY]).readOnly, true);
  controller.setReadOnly("on");
  assert.equal(controller.setReadOnly("off"), false);
  assert.equal(controller.setReadOnly("auto"), null);
  assert.deepEqual(heard, [true, false, null]);

  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: JSON.stringify({ readOnly: false }) })).getReadOnly(), false);
  assert.equal(display.create(node(), storage({ [display.STORAGE_KEY]: "{broken" })).getReadOnly(), null);
  assert.equal(display.create(node(), { getItem() { throw new Error("blocked"); } }).getReadOnly(), null);
  assert.equal(display.create(null, saved), null);
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("denied"); } });
  assert.equal(display.initialize(node(), blocked).getReadOnly(), null);
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

const ALL = ["setHopperTracking", "setPumpOff", "resetTracking", "setChangeover", "setLineRate", "setProductionPounds", "setScrapPounds"];

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
  const view = recipe.create(doc, { commands: () => commands, say: message => said.push(message), readOnly: () => readOnly, timers: { setTimeout: () => 1, clearTimeout() {} } });
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
  assert.deepEqual(modes.map(one => one.getAttribute("data-readonly-mode")), ["auto", "on", "off"]);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["true", "false", "false"]);
  click(view.mode("on"));
  assert.equal(controller.getReadOnly(), true);
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "true", "false"]);
  controller.setReadOnly("off");
  assert.deepEqual(modes.map(one => one.getAttribute("aria-checked")), ["false", "false", "true"]);
  assert.match(view.element.querySelector(".slate-settings__lead").textContent, /Connecting to and leaving lines is not affected/);
  const inert = settings.create(doc, { theme: null, themes: [], display: null });
  assert.match(inert.element.querySelectorAll(".slate-settings__note").map(one => one.textContent).join(" "), /Read-only cannot be changed/);
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
  doc.body.appendChild(hostEl);
  const root = { document: doc, location: doc.location, setTimeout: () => 1, clearTimeout: () => {}, Date, console };
  root.globalThis = root;
  vm.createContext(root);
  const load = file => new vm.Script(read(file), { filename: file }).runInContext(root);
  for (const file of ["scheduling.js", "station-command-contract.js", "station-command-bridge.js", "station-state-bridge.js", "slate-theme.js", "slate-display.js"]) load(file);
  hostEl.slateTheme = root.PolynSlateTheme.create(hostEl, null);
  const saved = storage(settings2.stored ? { [display.STORAGE_KEY]: JSON.stringify(settings2.stored) } : {});
  hostEl.slateDisplay = root.PolynSlateDisplay.create(hostEl, saved);
  const snap = demo.snapshot(Date.now());
  snap.line.linked = settings2.linked !== false;
  root.PolynStationStateBridge.connect({ read: () => snap }).publish();
  const executed = [];
  root.PolynStationCommandBridge.connect({
    capabilities: ALL,
    execute(command, args) { executed.push({ command, args }); return root.PolynStationCommandContract.success({ changed: true, revision: 1, persisted: true, snapshot: root.PolynStationStateBridge.getSnapshot() }); }
  });
  const scripts = [...host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").matchAll(/"((?:slate|station)\/[^"]+\.js)"/g)].map(match => match[1]);
  for (const file of scripts) load(file);
  return { hostEl, executed, controller: hostEl.slateDisplay };
}

test("hosted on a linked line, Slate is read-only by default: badge shown, toggles unable, no command reaches the executor", () => {
  const { hostEl, executed, controller } = bootHosted({ linked: true });
  assert.equal(hostEl.getAttribute("data-readonly"), "on");
  const badge = hostEl.querySelector("[data-slate-readonly]");
  assert.ok(!badge.hasAttribute("hidden"), "the badge is hidden on a linked line");
  const toggle = hostEl.querySelector(".slate-hopper[data-hopper='A3'] [data-slate-control='tracking']");
  assert.equal(toggle.getAttribute("data-able"), "false");
  toggle.dispatchEvent({ type: "click", target: toggle, stopPropagation() {} });
  assert.equal(executed.length, 0);
  assert.ok(hostEl.querySelector(".slate-card--rate").classList.contains("is-readonly"));

  // The badge opens Settings; choosing Off makes the line writable at once.
  badge.dispatchEvent({ type: "click", target: badge, stopPropagation() {} });
  assert.equal(hostEl.querySelector(".slate-header__title").textContent, "Settings");
  controller.setReadOnly("off");
  assert.equal(hostEl.getAttribute("data-readonly"), "off");
  assert.ok(badge.hasAttribute("hidden"));
  assert.equal(toggle.getAttribute("data-able"), "true");
  toggle.dispatchEvent({ type: "click", target: toggle, stopPropagation() {} });
  assert.equal(executed.length, 1);
});

test("hosted on the device's own session, automatic is writable; an explicit On still holds", () => {
  const own = bootHosted({ linked: false });
  assert.equal(own.hostEl.getAttribute("data-readonly"), "off");
  assert.ok(own.hostEl.querySelector("[data-slate-readonly]").hasAttribute("hidden"));
  assert.equal(own.hostEl.querySelector(".slate-hopper[data-hopper='A3'] [data-slate-control='tracking']").getAttribute("data-able"), "true");

  const forced = bootHosted({ linked: false, stored: { readOnly: true } });
  assert.equal(forced.hostEl.getAttribute("data-readonly"), "on");
  assert.equal(forced.hostEl.querySelector(".slate-hopper[data-hopper='A3'] [data-slate-control='tracking']").getAttribute("data-able"), "false");
});
