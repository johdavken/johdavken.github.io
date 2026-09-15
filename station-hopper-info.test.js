"use strict";

/* The hopper info panel (station/station-hopper-info.js): what a hopper is
 * running, said under it while the pointer rests on it.
 *
 * Tested for its words (the run-down's arithmetic, the timeline's names
 * for a missing factor), its placement (from measured boxes, never
 * assumed), its inertness to the pointer, and its registration in both
 * hosts. Everything runs in node on a fake document; the browser
 * surfaces come in through the options. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const info = require("./station/station-hopper-info.js");
const rundown = require("./station/station-rundown.js");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

/* ----------------------------------------------------------------------
 *   A fake document, just big enough
 * -------------------------------------------------------------------- */

function makeNode(name) {
  const node = {
    nodeName: name, tagName: name.toUpperCase(), attributes: {}, children: [], parent: null, textContent: "",
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    removeAttribute(key) { delete this.attributes[key]; },
    hasAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key); },
    appendChild(child) { child.parent = this; this.children.push(child); return child; },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); return child; },
    classList: {
      toggle(cls, force) {
        const set = new Set(String(node.attributes.class || "").split(/\s+/).filter(Boolean));
        const on = force === undefined ? !set.has(cls) : !!force;
        if (on) set.add(cls); else set.delete(cls);
        node.attributes.class = [...set].join(" ");
        return on;
      },
      contains(cls) { return String(node.attributes.class || "").split(/\s+/).includes(cls); }
    }
  };
  return node;
}

const fakeDocument = () => ({ createElement: name => makeNode(name) });

function walk(node, visit) { visit(node); for (const child of node.children) walk(child, visit); }
function byClass(node, cls) {
  const out = [];
  walk(node, n => { if (String(n.getAttribute("class") || "").split(/\s+/).includes(cls)) out.push(n); });
  return out;
}

const ENTRY = { id: "A1", layer: "A", resinName: "HX204", pct: 5, layerPct: 25, lineRate: 1000, weight: 1250, computed: false };

/* ----------------------------------------------------------------------
 *   The words
 * -------------------------------------------------------------------- */

test("describe: the resin, the output as the run-down computes it, the blend as the timeline words it, and the weight held", () => {
  const said = info.describe(ENTRY);
  assert.equal(said.id, "A1");
  assert.equal(said.resin, "HX204");
  assert.equal(said.assigned, true);
  assert.deepEqual(said.rows.map(r => r.term), ["Output", "Blend", "Weight"]);
  // 1000 lb/hr x 25% x 5% = 12.5 lb/hr, formatted by the run-down module.
  assert.deepEqual(said.rows[0], { term: "Output", value: rundown.formatRate(rundown.consumptionRate(1000, 25, 5)), missing: false });
  assert.equal(said.rows[0].value, "12.5 lb/hr");
  assert.deepEqual(said.rows[1], { term: "Blend", value: "5% of layer A (25%)", missing: false });
  assert.deepEqual(said.rows[2], { term: "Weight", value: "1,250 lb", missing: false });
});

test("describe: each missing factor is named the way the timeline names it, in order of what is missing first", () => {
  const rows = entry => info.describe(Object.assign({}, ENTRY, entry)).rows;
  assert.deepEqual(rows({ lineRate: 0 })[0], { term: "Output", value: "No output", missing: true });
  assert.deepEqual(rows({ layerPct: 0 })[0], { term: "Output", value: "No layer share", missing: true });
  assert.deepEqual(rows({ pct: 0 })[0], { term: "Output", value: "No blend", missing: true });
  // A blend of nothing on a hopper with a resin is a thing to notice; on an empty hopper it is nothing.
  assert.deepEqual(rows({ pct: 0 })[1], { term: "Blend", value: "—", missing: true });
  assert.deepEqual(rows({ pct: 0, resinName: "" })[1], { term: "Blend", value: "—", missing: false });
  assert.deepEqual(rows({ weight: 0 })[2], { term: "Weight", value: "—", missing: false });
  // The run-down's own zero is not trusted to say why: 0 x anything is 0, not null.
  assert.equal(rundown.consumptionRate(0, 25, 5), 0);
  assert.equal(rows({ lineRate: 0 })[0].value, rundown.reasonLabel("no-output"));
  assert.equal(rows({ layerPct: 0 })[0].value, rundown.reasonLabel("no-share"));
  assert.equal(rows({ pct: 0 })[0].value, rundown.reasonLabel("no-blend"));
});

test("describe: no resin reads as such; a computed weight says so; a nonsense entry says nothing false", () => {
  const empty = info.describe({ id: "B4", layer: "B", resinName: "", pct: 0, layerPct: 50, lineRate: 800, weight: 400 });
  assert.equal(empty.resin, "No resin");
  assert.equal(empty.assigned, false);
  assert.equal(empty.rows[2].value, "400 lb");
  const smart = info.describe(Object.assign({}, ENTRY, { weight: 812.5, computed: true }));
  assert.equal(smart.rows[2].value, "812.5 lb · computed");
  const nothing = info.describe(null);
  assert.equal(nothing.id, "");
  assert.equal(nothing.resin, "No resin");
  assert.deepEqual(nothing.rows.map(r => r.value), ["No output", "—", "—"]);
  assert.equal(info.describe({ pct: 60, layerPct: 25, lineRate: "x", weight: -5 }).rows[0].value, "No output");
});

/* ----------------------------------------------------------------------
 *   The panel: shown, placed, hidden
 * -------------------------------------------------------------------- */

function build(boxes) {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  const measure = el => (boxes && el && boxes.get(el)) || null;
  const handle = info.create(doc, { mount, measure, rundown });
  mount.appendChild(handle.element);
  return { doc, mount, handle, measure };
}

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });

test("the panel is hidden until shown, says the entry in the timeline's rows, and is emptied when hidden - shown twice, it is replaced, not stacked", () => {
  const { doc, handle } = build();
  assert.equal(handle.element.getAttribute("data-role"), "hopper-info");
  assert.equal(handle.panel.getAttribute("role"), "tooltip");
  assert.equal(handle.panel.getAttribute("hidden"), "");
  assert.ok(handle.panel.classList.contains("station-glass"), "the panel is not the console's glass");
  assert.equal(handle.visible(), false);

  const target = doc.createElement("g");
  const said = handle.show(ENTRY, target);
  assert.equal(said.resin, "HX204");
  assert.equal(handle.visible(), true);
  assert.equal(handle.panel.getAttribute("hidden"), null);
  assert.equal(handle.panel.getAttribute("data-hopper"), "A1");
  assert.equal(byClass(handle.panel, "station-hopper-info__id")[0].textContent, "A1");
  assert.equal(byClass(handle.panel, "station-hopper-info__resin")[0].textContent, "HX204");
  const rows = byClass(handle.panel, "station-hopper-info__row");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => [r.children[0].nodeName, r.children[0].textContent, r.children[1].nodeName, r.children[1].textContent]), [
    ["dt", "Output", "dd", "12.5 lb/hr"], ["dt", "Blend", "dd", "5% of layer A (25%)"], ["dt", "Weight", "dd", "1,250 lb"]
  ]);
  assert.ok(rows.every(r => !r.children[1].classList.contains("is-missing")));

  handle.show(Object.assign({}, ENTRY, { id: "A2", resinName: "", lineRate: 0, weight: 0 }), target);
  assert.equal(byClass(handle.panel, "station-hopper-info__row").length, 3, "rows accumulated");
  assert.equal(byClass(handle.panel, "station-hopper-info__resin")[0].textContent, "No resin");
  assert.ok(byClass(handle.panel, "station-hopper-info__resin")[0].classList.contains("is-empty"));
  assert.ok(byClass(handle.panel, "station-hopper-info__value")[0].classList.contains("is-missing"));

  handle.hide();
  assert.equal(handle.visible(), false);
  assert.equal(handle.panel.getAttribute("hidden"), "");
  assert.equal(handle.panel.getAttribute("data-hopper"), null);
  assert.equal(byClass(handle.panel, "station-hopper-info__row").length, 0);
  handle.hide();
  assert.equal(handle.visible(), false);
});

test("placed from measured boxes: hung from the caption, centred on the hopper's column, held inside the slot across and clear of the rail; above the hopper where the slot has no room under it; never beside it", () => {
  const doc = fakeDocument();
  const boxes = new Map();
  const { mount, handle } = (() => {
    const mount = doc.createElement("div");
    const handle = info.create(doc, { mount, measure: el => boxes.get(el) || null, rundown });
    mount.appendChild(handle.element);
    return { mount, handle };
  })();
  boxes.set(mount, rect(100, 50, 1200, 700));
  boxes.set(handle.panel, rect(0, 0, 240, 100));
  const mid = doc.createElement("g");
  boxes.set(mid, rect(300, 250, 28, 120));
  handle.show(ENTRY, mid);
  assert.equal(handle.panel.getAttribute("data-side"), "below");
  // Centre 314 - 100 - 120 across; the hopper's foot 370 - 50 + GAP down.
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: 94px; --station-info-y: ${320 + info.GAP}px;`);

  // Given the caption, the panel hangs from ITS foot - the hopper's box
  // reaches below the caption to the end of its hit area.
  const caption = doc.createElement("g");
  boxes.set(caption, rect(304, 330, 20, 24));
  handle.show(ENTRY, mid, { anchor: caption });
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: 94px; --station-info-y: ${304 + info.GAP}px;`);

  // A hopper at the slot's edge: the panel is held inside, not centred.
  const edge = doc.createElement("g");
  boxes.set(edge, rect(1270, 250, 28, 120));
  handle.show(ENTRY, edge);
  assert.equal(handle.panel.getAttribute("data-side"), "below");
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: ${1200 - 240 - info.GAP}px; --station-info-y: ${320 + info.GAP}px;`);
  const first = doc.createElement("g");
  boxes.set(first, rect(102, 250, 28, 120));
  handle.show(ENTRY, first);
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: ${info.GAP}px; --station-info-y: ${320 + info.GAP}px;`);

  // Given something to clear (the rail), the panel keeps right of it
  // while it would share its height - and ignores it when it would not.
  const rail = doc.createElement("div");
  boxes.set(rail, rect(110, 300, 64, 200));
  handle.show(ENTRY, first, { clear: rail });
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: ${174 - 100 + info.GAP}px; --station-info-y: ${320 + info.GAP}px;`);
  handle.show(ENTRY, mid, { clear: rail });
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: 94px; --station-info-y: ${320 + info.GAP}px;`, "centred where the rail allows");
  boxes.set(rail, rect(110, 500, 64, 200));
  handle.show(ENTRY, first, { clear: rail });
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: ${info.GAP}px; --station-info-y: ${320 + info.GAP}px;`, "a rail below the panel's height is nothing to clear");

  // No room under it: above the hopper's top.
  const low = doc.createElement("g");
  boxes.set(low, rect(300, 600, 28, 120));
  handle.show(ENTRY, low);
  assert.equal(handle.panel.getAttribute("data-side"), "above");
  // Top 600 - 50 - GAP - height 100.
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: 94px; --station-info-y: ${550 - info.GAP - 100}px;`);

  // The panel's own box is measured AFTER it is shown, so the box is the
  // one it takes; without one, the stylesheet's width and the rows' height.
  boxes.delete(handle.panel);
  handle.show(ENTRY, mid);
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: ${314 - 100 - info.PANEL_WIDTH / 2}px; --station-info-y: ${320 + info.GAP}px;`);
  handle.show(ENTRY, low);
  assert.equal(handle.panel.getAttribute("style"), `--station-info-x: ${314 - 100 - info.PANEL_WIDTH / 2}px; --station-info-y: ${550 - info.GAP - info.PANEL_HEIGHT}px;`);

  // Nothing measurable: the words still stand, at the slot's origin.
  const blind = info.create(doc, { rundown });
  blind.show(ENTRY, doc.createElement("g"));
  assert.equal(blind.visible(), true);
  assert.equal(blind.panel.getAttribute("style"), "--station-info-x: 0px; --station-info-y: 0px;");
  assert.equal(blind.panel.getAttribute("data-side"), "below");
});

/* ----------------------------------------------------------------------
 *   Discipline: inert, stateless, styled from tokens, registered
 * -------------------------------------------------------------------- */

test("the module holds nothing and reaches for nothing: no timers, no storage, no network, no dispatch", () => {
  const source = read("station/station-hopper-info.js");
  for (const banned of ["setTimeout", "setInterval", "localStorage", "sessionStorage", "fetch(", ".dispatch(", "requestAnimationFrame"]) {
    assert.ok(!source.includes(banned), `station-hopper-info.js reaches for ${banned}`);
  }
  assert.match(source, /require\("\.\/station-rundown\.js"\)/, "the arithmetic is the run-down module's");
  assert.doesNotMatch(source, /\* \(layerPct \/ 100\)|\/ 100 \*/, "the formula is restated here");
});

test("the stylesheet: container and panel inert to the pointer, placed by the two variables, the glass worn and not restated, rows in the timeline detail's vocabulary, no colour named", () => {
  const css = read("station/styles/components/hopper-info.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = name => { const at = css.indexOf(`${name} {`); assert.ok(at >= 0, `${name} has no rule`); return css.slice(at, css.indexOf("}", at)); };
  assert.match(rule(".station-hopper-info"), /position: absolute;[^}]*inset: 0;[^}]*pointer-events: none;/);
  const panel = rule(".station-hopper-info__panel");
  assert.match(panel, /position: absolute;/);
  assert.match(panel, /top: var\(--station-info-y, 0\);/);
  assert.match(panel, /left: var\(--station-info-x, 0\);/);
  assert.match(panel, /pointer-events: none;/);
  assert.match(panel, new RegExp(`width: ${info.PANEL_WIDTH}px;`), "the placement's fallback width is not the stylesheet's");
  assert.doesNotMatch(css, /data-side="left"|data-side="right"|translateX/, "the panel is placed beside the hopper - over the bank's other hoppers");
  assert.doesNotMatch(css, /backdrop-filter|--station-handbook-glass\)|--station-handbook-glass-blur/, "the glass is restated");
  assert.match(rule(".station-hopper-info__value"), /font-family: var\(--station-font-mono\);[^}]*font-variant-numeric: tabular-nums;/);
  assert.match(rule(".station-hopper-info__value.is-missing"), /color: var\(--station-warning\);/);
  assert.match(rule(".station-hopper-info__term"), /color: var\(--station-text-muted\);/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|\brgba?\(|!important|@media/i);
});

test("the panel is loaded by the host and the harness after the run-down module it computes with and before the boot file, with its stylesheet", () => {
  const host = read("station-host.js");
  const harness = read("station/station.html");
  for (const [name, text, script, style] of [
    ["station-host.js", host, '"station/station-hopper-info.js"', '"station/styles/components/hopper-info.css"'],
    ["station.html", harness, "station-hopper-info.js?v=", "hopper-info.css?v="]
  ]) {
    assert.ok(text.includes(script), `${name} does not load the panel`);
    assert.ok(text.includes(style), `${name} does not load its stylesheet`);
    assert.ok(text.indexOf("station-rundown.js") < text.indexOf("station-hopper-info.js"), `${name}: the panel loads before the run-down module`);
    assert.ok(text.indexOf("station-hopper-info.js") < (name === "station.html" ? text.indexOf("station.js?") : text.indexOf('"station/station.js"')), `${name}: the panel loads after the boot file`);
    assert.ok(text.indexOf("glass.css") < text.indexOf("hopper-info.css"), `${name}: the panel's sheet loads before the glass it wears`);
  }
});

test("the boot file mounts the panel in the utility slot, shows it for the drawn hopper under the pointer on any layer, and hides it whenever the drawing under the pointer is replaced", () => {
  const boot = read("station/station.js");
  const body = name => { const at = boot.indexOf(`function ${name}(`); assert.ok(at >= 0, `${name} not found`); return boot.slice(at, boot.indexOf("\n  }\n", at) + 4); };
  assert.match(boot, /const hopperInfo = root\.PolynStationHopperInfo \|\| null;/);
  assert.match(boot, /if \(hopperInfo && mounts\.utility\) \{\n\s+infoPanel = hopperInfo\.create\(doc, \{ mount: mounts\.utility \}\);\n\s+if \(infoPanel\) mounts\.utility\.appendChild\(infoPanel\.element\);/);
  // Any layer: the resolver is the drawn hopper's role, not the focused-layer lookup the highlight uses.
  assert.match(body("drawnHopperAt"), /closest\("\[data-role='hopper'\]"\)/);
  assert.match(body("hopperAt"), /stage\.getState\(\)\.focusLayer/, "the highlight's lookup was changed");
  const entry = body("hopperInfoEntry");
  assert.match(entry, /parts\.shownWeight\(runtime\)/);
  assert.match(entry, /computed: !!runtime\.smartWeight/);
  assert.match(entry, /lineRate: r\.job && Number\.isFinite\(r\.job\.lineRate\) \? r\.job\.lineRate : 0/);
  // Listeners at the machine's edge, after the highlight's own.
  const start = boot.slice(boot.indexOf("function start()"));
  const focusout = start.indexOf('mounts.machine?.addEventListener("focusout"');
  const hover = start.indexOf("const el = drawnHopperAt(event.target);");
  assert.ok(focusout > 0 && hover > focusout, "the panel's listener stands before the highlight's");
  assert.match(start, /if \(el\) \{\n\s+infoPanel\.show\(hopperInfoEntry\(el\), el, \{\n\s+anchor: el\.querySelector\("\[data-role='hopper-caption'\]"\),\n\s+clear: railPanel \? railPanel\.element : null\n\s+\}\);\n\s+\} else infoPanel\.hide\(\);/, "the panel hangs from the caption and keeps clear of the rail");
  assert.match(start, /mounts\.machine\?\.addEventListener\("mouseleave", \(\) => \{ if \(infoPanel\) infoPanel\.hide\(\); \}\);/);
  // Hidden where the drawing under the pointer is replaced: a render, a value patch, a turn.
  assert.match(body("drawStage"), /if \(infoPanel\) infoPanel\.hide\(\);/);
  assert.match(body("flipLayer"), /if \(infoPanel\) infoPanel\.hide\(\);/);
  const publish = body("onPublish");
  assert.ok(publish.indexOf("if (infoPanel) infoPanel.hide();") > publish.indexOf("render.patchStage(mounts.machine, model, {"));
});
