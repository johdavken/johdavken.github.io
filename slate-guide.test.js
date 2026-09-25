"use strict";

/* slate-guide.js: How to Use - a short changeover guide in the Timeline's
 * place. Short on purpose, in the controls' own words, reading and
 * dispatching nothing; its close hands the aside back. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const guide = require("./slate/slate-guide.js");

function boot() {
  const doc = makeDocument();
  const backs = [];
  const view = guide.create(doc, { back: () => backs.push(true) });
  doc.body.appendChild(view.element);
  return { doc, view, backs };
}

test("the guide walks a changeover in order: enter current, enter next, tracking, plan the blend change, several at once, print, run down, finish", () => {
  const { view } = boot();
  const titles = view.element.querySelectorAll(".slate-guide__step .slate-guide__title").map(one => one.textContent);
  assert.deepEqual(titles, ["Enter what's running", "Enter the next job", "Changes track themselves", "Plan the blend change", "Edit several at once", "Print the hookups", "Run it down", "Finish"]);
  assert.deepEqual(view.element.querySelectorAll(".slate-guide__number").map(one => one.textContent), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  const notes = view.element.querySelectorAll(".slate-guide__note-title").map(one => one.textContent);
  // Smart Hoppers is left out on purpose: too much for a first changeover.
  assert.deepEqual(notes, ["Ran out"]);
  assert.doesNotMatch(view.element.textContent, /Smart Hoppers/);
});

test("it stays short: no step runs past three sentences or 200 characters, and the whole guide stays under 1,600", () => {
  let total = 0;
  for (const item of [...guide.STEPS, ...guide.NOTES]) {
    const sentences = item.body.split(/[.?!](\s|$)/).filter(part => part && part.trim()).length;
    assert.ok(sentences <= 3, `"${item.title}" runs to ${sentences} sentences`);
    assert.ok(item.body.length <= 200, `"${item.title}" is ${item.body.length} characters`);
    total += item.title.length + item.body.length;
  }
  assert.ok(total < 1600, `the guide is ${total} characters: people will not read it`);
});

test("it names the controls as the screen does", () => {
  const all = [...guide.STEPS, ...guide.NOTES].map(item => item.body).join(" ");
  const plan = require("./slate/slate-plan-actions.js");
  for (const label of [plan.LABEL.copy, plan.LABEL.promote]) {
    assert.ok(all.toLowerCase().includes(label.toLowerCase()), `the guide does not say "${label}"`);
  }
  // Scanning is a phone's, and the pump is turned off, not "pumped off".
  assert.match(all, /scan[^.]*phone/i);
  assert.doesNotMatch(all, /pump (it|that hopper) off|tablet/i);
  // "Hookups" are which silos the hoppers are hooked to: the rearranging step is the blend change.
  assert.ok(guide.STEPS.some(step => step.title === "Plan the blend change" && step.drawing === "drag"));
  for (const word of ["Apply", "Fill", "Print", "Off", "Back on", "Reset tracking", "Ran out", "Confirm"]) {
    assert.ok(all.includes(word), `the guide does not say "${word}"`);
  }
  const recipe = fs.readFileSync(path.join(__dirname, "slate", "slate-recipe.js"), "utf8");
  assert.match(recipe, /const RESET_LABEL = "Reset tracking";/);
  assert.match(recipe, /const FILL_LABEL = "Fill";/);
  const timeline = fs.readFileSync(path.join(__dirname, "slate", "slate-timeline.js"), "utf8");
  assert.match(timeline, /"slate-timeline__ranout", "Ran out"/);
});

test("the one drawing is the drag: two cells, the lifted one marked, a path between them", () => {
  const { view } = boot();
  const drawings = view.element.querySelectorAll(".slate-guide__drawing");
  assert.equal(drawings.length, 1);
  assert.ok(drawings[0].closest(".slate-guide__step").getAttribute("data-step") === "4");
  assert.equal(drawings[0].querySelectorAll(".slate-guide__cell").length, 2);
  assert.equal(drawings[0].querySelectorAll(".is-lifted").length, 1);
  assert.ok(drawings[0].querySelectorAll(".slate-guide__arrow").length >= 1);
  assert.ok(drawings[0].getAttribute("aria-label"));
});

test("its close hands the aside back to the Timeline, and it offers nothing to update", () => {
  const { view, backs } = boot();
  const close = view.element.querySelector(".slate-panel__close");
  assert.equal(close.getAttribute("aria-label"), guide.CLOSE_LABEL);
  click(close);
  assert.deepEqual(backs, [true]);
  assert.equal(typeof view.update, "undefined", "the guide reads no state");
});

test("its sheet draws only in theme tokens and scrolls its body inside the panel", () => {
  const css = fs.readFileSync(path.join(__dirname, "slate", "styles", "components", "guide.css"), "utf8");
  assert.match(css, /\.slate-guide__body \{[^}]*overflow-y: auto;/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i);
  const host = fs.readFileSync(path.join(__dirname, "slate-host.js"), "utf8");
  assert.match(host, /"slate\/slate-guide\.js"/);
  assert.match(host, /"slate\/styles\/components\/guide\.css"/);
});
