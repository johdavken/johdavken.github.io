"use strict";

/* slate-home.js: a phone's first page - the mark, the line, the two
 * figures and the three steps, each saying how it stands. It asks the
 * boot for everything and dispatches nothing. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const homeModule = require("./slate/slate-home.js");

const NOW = new Date(2026, 8, 22, 23, 0, 0).getTime();
const clock = at => { const d = new Date(at); return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`; };

test("the steps' lines: the hoppers changing resin, the timeline's late and next, the balance's pounds", () => {
  assert.equal(homeModule.recipeLine(null), "No line");
  assert.equal(homeModule.recipeLine({ line: true, planned: false }), "Running · nothing planned");
  assert.equal(homeModule.recipeLine({ line: true, planned: true, resinChanges: 0 }), "No resin changes at the changeover");
  assert.equal(homeModule.recipeLine({ line: true, planned: true, resinChanges: 1 }), "1 hopper changes resin at the changeover");
  assert.equal(homeModule.recipeLine({ line: true, planned: true, resinChanges: 4 }), "4 hoppers change resin at the changeover");
  assert.equal(homeModule.timelineLine([], NOW, clock), "No hoppers tracked");
  const entries = [
    { id: "A4", overdue: true, markAt: NOW - 3600e3 },
    { id: "C3", overdue: true, markAt: NOW - 600e3 },
    { id: "B3", overdue: false, markAt: NOW + 75 * 60e3 },
    { id: "B1", overdue: false, markAt: NOW + 30 * 60e3 },
    { id: "E1", pumpOff: true, markAt: NOW + 10 * 60e3 }
  ];
  assert.equal(homeModule.timelineLine(entries, NOW, clock), "2 late for pump-off · next B1 at 11:30 PM");
  assert.equal(homeModule.timelineLine(entries.slice(2), NOW, clock), "Next: B1 at 11:30 PM");
  assert.equal(homeModule.timelineLine([{ id: "A1", overdue: false, markAt: NaN }], NOW, clock), "Nothing due before the horizon");
  assert.equal(homeModule.balanceLine(0), "No production entered");
  assert.equal(homeModule.balanceLine(8660.7), "8,660 lb in the job");
});

test("the page draws the mark, the line, the two figures and the three steps from what the boot hands it; a figure opens its card's editor and a step its page", () => {
  const doc = makeDocument();
  const opened = [];
  const went = [];
  const view = homeModule.create(doc, {
    now: () => NOW,
    home: {
      line: () => "Line 10",
      readout: field => (field === "changeover" ? { value: "1:15 AM", sub: "in 2h 15m" } : { value: "900 lb/hr", sub: "" }),
      open: field => opened.push(field),
      go: id => went.push(id),
      recipe: () => ({ line: true, planned: true, resinChanges: 3 }),
      timeline: () => [{ id: "B3", overdue: false, markAt: NOW + 3600e3 }],
      balance: () => 8660,
      clock
    }
  });
  doc.body.appendChild(view.element);
  view.update({});
  const q = selector => view.element.querySelector(selector);
  assert.ok(q(".slate-home__brand svg.slate-logo"), "no mark");
  assert.equal(q(".slate-home__line").textContent, "Line 10");
  assert.equal(q("[data-home-field='changeover'] .slate-home__readout-value").textContent, "1:15 AM");
  assert.equal(q("[data-home-field='changeover'] .slate-home__readout-sub").textContent, "in 2h 15m");
  assert.equal(q("[data-home-field='rate'] .slate-home__readout-value").textContent, "900 lb/hr");
  assert.deepEqual(view.element.querySelectorAll("[data-home-step]").map(one => one.getAttribute("data-home-step")), ["recipe", "timeline", "resin-balance"]);
  assert.equal(q("[data-home-step='recipe'] .slate-home__step-line").textContent, "3 hoppers change resin at the changeover");
  assert.equal(q("[data-home-step='timeline'] .slate-home__step-line").textContent, "Next: B3 at 12:00 AM");
  assert.equal(q("[data-home-step='resin-balance'] .slate-home__step-line").textContent, "8,660 lb in the job");
  click(q("[data-home-field='changeover']"));
  click(q("[data-home-field='rate']"));
  assert.deepEqual(opened, ["changeover", "rate"]);
  for (const step of view.element.querySelectorAll("[data-home-step]")) click(step);
  assert.deepEqual(went, ["recipe", "timeline", "resin-balance"]);
});

test("Home dispatches nothing, requests nothing and keeps no timer", () => {
  const source = fs.readFileSync(path.join(__dirname, "slate", "slate-home.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /dispatch|request\(|setTimeout|Bridge/);
});

test("on a phone Home is one screen that never scrolls: it takes the page cell's height, and the mark alone gives - shrinking on a short screen, never below a glance - the rest keeping their size", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/home.css"), "utf8");
  const phone = '.slate-root[data-input="touch"][data-viewport="phone"]';
  const rule = selector => { const at = css.indexOf(`${phone} ${selector} {`); assert.ok(at > -1, `no phone rule for ${selector}`); return css.slice(at, css.indexOf("}", at)); };
  assert.match(rule('.slate-section[data-section="home"]'), /height: 100%;/);
  const home = rule(".slate-home");
  assert.match(home, /height: 100%;/);
  assert.match(home, /box-sizing: border-box;/);
  assert.match(home, /justify-content: center;/);
  const brand = rule(".slate-home__brand");
  assert.match(brand, /flex: 0 1 auto;/, "the mark does not give");
  assert.match(brand, /min-height: \d+px;/, "the mark can shrink to nothing");
  assert.match(css, /\n\.slate-home__brand \.slate-logo \{[^}]*max-height: 100%;/);
  assert.match(css, new RegExp(`\\.slate-home__steps \\{\\s*flex: none;`), "the steps give instead of the mark");
});
