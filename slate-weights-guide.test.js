"use strict";

/* slate-weights-guide.js: Hopper Weights Configuration - the specifics
 * How to Use points to. Its worked numbers are checked against the
 * application's own arithmetic, so the guide cannot teach a formula the
 * application does not use. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const wguide = require("./slate/slate-weights-guide.js");
const guide = require("./slate/slate-guide.js");
const calculators = require("./calculators.js");
const rundown = require("./station/station-rundown.js");
const bulk = require("./bulk-density-measurement.js");

const e = wguide.EXAMPLE;
const w = wguide.worked();

test("the worked example is the application's arithmetic: the split and the time to empty (station-rundown.js)", () => {
  assert.equal(w.hopperLbHr, rundown.consumptionRate ? rundown.consumptionRate(e.lineRate, e.layerPct, e.hopperPct) : e.lineRate * e.layerPct / 100 * e.hopperPct / 100);
  const projected = rundown.hopperRundown({ track: true, effectiveWeight: w.weight, pct: e.hopperPct, layerPct: e.layerPct, lineRate: e.lineRate, observedAt: 0 }, { now: 0 });
  assert.ok(Math.abs(projected.durationMs / 3600000 - w.hours) < 1e-9, "the guide's hours to empty are not the run-down's");
  assert.equal(projected.rate, w.hopperLbHr);
});

test("the weights are calculators.js's: the round receiver and the volume-measured one", () => {
  // The line stores the circumference; the guide's diameter stands for it (C = pi x D).
  assert.ok(Math.abs(calculators.calculateHopperWeight(Math.PI * e.diameter, e.height, e.bulkDensity) - w.weight) < 1e-9);
  const actions = require("./slate/slate-weight-actions.js");
  assert.equal(actions.diameterFrom(actions.circumferenceFrom(e.diameter)), e.diameter, "a typed diameter does not come back as typed");
  assert.ok(Math.abs(calculators.calculateHopperVolumeWeight(e.gallons, e.bulkDensity) - w.gallonWeight) < 1e-9);
  assert.equal(wguide.GALLON_FT3, 0.133681);
});

test("bulk density is measured as the application measures it: resin over water, times water's density", () => {
  const measured = bulk.calculate({ waterCalibrationLb: e.waterLb, resinWeightLb: e.resinLb, polymerDensityGCm3: e.solidDensity });
  assert.ok(measured.valid);
  assert.ok(Math.abs(measured.bulkDensityLbFt3 - w.measured) < 0.01, `${measured.bulkDensityLbFt3} vs ${w.measured}`);
  assert.ok(Math.abs(bulk.WATER_DENSITY_LB_FT3 - wguide.WATER_LB_FT3) < 0.01);
});

test("it starts simple and works up: split, time, weight, Smart Hoppers, density, measuring, corrections - and says height runs floor to fill valve", () => {
  const titles = wguide.sections().map(section => section.title);
  assert.deepEqual(titles.map(title => title.replace(/^\d+\. /, "")), [
    "The line rate, split", "Time to empty, and when to turn the pump off", "The weight",
    "Smart Hoppers: volume × bulk density", "Why the resin's density is not enough", "Measuring bulk density", "When the numbers are off"
  ]);
  const all = JSON.stringify(wguide.sections());
  assert.match(all, /from the floor of the receiver to the fill valve/);
  // Resin does stand above the valve - the loader calls below it - but an
  // unknown amount, so the weight counts the least: never "resin never reaches".
  assert.doesNotMatch(all, /never reaches|where the loader stops|runs dry right at the changeover/);
  assert.match(all, /calls for resin when the level falls below the valve/);
  assert.match(all, /the least the (hopper|receiver) holds/);
  assert.match(all, /0\.7854 × D² × h/);
  assert.match(all, /C² × h ÷ \(4π\)/);
  assert.match(all, /inside wall to inside wall/);
  // The two ways by Line Configuration's own names: both are a volume.
  const lineConfig = require("./slate/slate-line-config.js");
  for (const label of lineConfig.GEOMETRIES.map(one => one.label)) assert.ok(all.includes(label), `the guide does not name "${label}"`);
  assert.doesNotMatch(all, /measure their hoppers by volume|Cylindrical/);
  assert.match(all, /bulk density = resin lb ÷ water lb × 62\.43/);
  assert.match(all, /H1 = 100 − /);
  assert.doesNotMatch(all, /pump (it|that hopper) off|tablet/i, "the floor's words: turn the pump off; phones scan");
});

test("it draws the split, the hopper and the pellets, and every formula carries its rule in the monospace face", () => {
  const doc = makeDocument();
  const backs = [];
  const guides = [];
  const view = wguide.create(doc, { back: () => backs.push(true), guide: () => guides.push(true) });
  const drawings = view.element.querySelectorAll(".slate-wguide__drawing");
  assert.equal(drawings.length, 3);
  assert.ok(drawings.every(one => one.getAttribute("aria-label")));
  assert.ok(view.element.querySelectorAll(".slate-wguide__rule").length >= 8);
  click(view.element.querySelector("[data-slate-guide='back']"));
  assert.deepEqual(guides, [true]);
  click(view.element.querySelector(".slate-panel__close"));
  assert.deepEqual(backs, [true]);
});

test("How to Use ends Good to know with the way to it - only when there is one to open", () => {
  const doc = makeDocument();
  const opened = [];
  const view = guide.create(doc, { more: () => opened.push(true) });
  const link = view.element.querySelector("[data-slate-guide='weights']");
  assert.ok(link, "no link to Hopper Weights Configuration");
  assert.equal(link.textContent, guide.MORE_LINK);
  const body = view.element.querySelector(".slate-guide__body");
  assert.ok(body.children[body.children.length - 1].contains(link), "the link is not at the foot");
  click(link);
  assert.deepEqual(opened, [true]);
  assert.equal(guide.create(doc, {}).element.querySelector("[data-slate-guide='weights']"), null);
});

test("hosted, the link swaps How to Use for Hopper Weights Configuration in the aside, and its way back returns", () => {
  const vm = require("node:vm");
  const read = file => fs.readFileSync(path.join(__dirname, file), "utf8");
  const doc = makeDocument({ href: "https://resin.tools/?view=slate" });
  doc.body.setAttribute("data-slate-view", "slate");
  const hostEl = doc.createElement("div");
  hostEl.setAttribute("data-slate-host", "");
  hostEl.setAttribute("data-slate-app", "");
  hostEl.setAttribute("class", "slate-root");
  doc.body.appendChild(hostEl);
  const root = { document: doc, location: doc.location, Date, console, setTimeout: () => 1, clearTimeout() {} };
  root.globalThis = root;
  vm.createContext(root);
  const load = file => new vm.Script(read(file), { filename: file }).runInContext(root);
  for (const file of ["scheduling.js", "station-command-contract.js", "station-command-bridge.js", "station-state-bridge.js", "slate-theme.js", "slate-display.js"]) load(file);
  hostEl.slateTheme = root.PolynSlateTheme.create(hostEl, null);
  hostEl.slateDisplay = root.PolynSlateDisplay.create(hostEl, null);
  const host = read("slate-host.js");
  for (const file of [...host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").matchAll(/"((?:slate|station)\/[^"]+\.js)"/g)].map(match => match[1])) load(file);
  const aside = id => hostEl.querySelector(`.slate-aside .slate-section[data-section='${id}']`);
  const item = hostEl.querySelector(".slate-rail__item[data-section='guide']");
  item.dispatchEvent({ type: "click", target: item, stopPropagation() {} });
  assert.ok(!aside("guide").hasAttribute("hidden"));
  assert.equal(hostEl.querySelector(".slate-rail__item[data-section='weights-guide']"), null, "the rail lists Hopper Weights Configuration");
  const link = aside("guide").querySelector("[data-slate-guide='weights']");
  link.dispatchEvent({ type: "click", target: link, stopPropagation() {} });
  assert.ok(!aside("weights-guide").hasAttribute("hidden"), "the link did not open Hopper Weights Configuration");
  assert.ok(aside("guide").hasAttribute("hidden"));
  const backLink = aside("weights-guide").querySelector("[data-slate-guide='back']");
  backLink.dispatchEvent({ type: "click", target: backLink, stopPropagation() {} });
  assert.ok(!aside("guide").hasAttribute("hidden"), "the way back did not return to How to Use");
});

test("its sheet draws in theme tokens only", () => {
  const css = fs.readFileSync(path.join(__dirname, "slate", "styles", "components", "guide.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(css, /\.slate-wguide__rule \{[^}]*font-family: var\(--slate-font-mono\)/);
});
