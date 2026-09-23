"use strict";

/* slate-phone-bar.js: a phone's five keys along the foot - they only ask,
 * and show what the boot tells them. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const barModule = require("./slate/slate-phone-bar.js");
const rail = require("./slate/slate-rail.js");

function boot() {
  const doc = makeDocument();
  const asked = [];
  const bar = barModule.create(doc, { onSelect: id => asked.push(id) });
  doc.body.appendChild(bar.element);
  return { doc, bar, asked, keys: bar.element.querySelectorAll("[data-bar-key]") };
}

test("five keys, left to right - Weights, Tools, Home in the middle, Settings, Menu - each a button with the rail's glyph and a word", () => {
  const { keys } = boot();
  assert.deepEqual(keys.map(key => key.getAttribute("data-bar-key")), ["weights", "tools", "home", "settings", "menu"]);
  assert.deepEqual(keys.map(key => key.querySelector(".slate-bar__label").textContent), ["Weights", "Tools", "Home", "Settings", "Menu"]);
  for (const key of keys) {
    assert.equal(key.tagName, "BUTTON");
    assert.equal(key.getAttribute("type"), "button");
    assert.ok(key.querySelector("svg.slate-bar__glyph"));
  }
  assert.equal(keys[0].querySelector("path").getAttribute("d"), rail.GLYPHS.weights);
  assert.equal(keys[2].querySelector("path").getAttribute("d"), rail.GLYPHS.home);
  assert.equal(keys[1].getAttribute("aria-haspopup"), "dialog", "Tools raises a sheet");
  assert.equal(keys[4].getAttribute("aria-haspopup"), "dialog");
  assert.equal(keys[4].getAttribute("aria-expanded"), "false");
});

test("a key only asks: its id goes to onSelect, and nothing is marked until the boot says so", () => {
  const { bar, asked, keys } = boot();
  for (const key of keys) click(key);
  assert.deepEqual(asked, ["weights", "tools", "home", "settings", "menu"]);
  assert.ok(keys.every(key => !key.classList.contains("is-active")));
  bar.setActive("weights");
  assert.deepEqual(keys.filter(key => key.classList.contains("is-active")).map(key => key.getAttribute("data-bar-key")), ["weights"]);
  assert.equal(bar.key("weights").getAttribute("aria-current"), "page");
  bar.setActive(null);
  assert.ok(keys.every(key => !key.hasAttribute("aria-current")));
});

test("a key's dot and the Menu's expanded state follow the boot", () => {
  const { bar } = boot();
  const dot = bar.key("home").querySelector(".slate-bar__dot");
  assert.ok(dot.hasAttribute("hidden"));
  assert.equal(bar.setDot("home", true), true);
  assert.ok(!dot.hasAttribute("hidden"));
  assert.ok(bar.key("home").classList.contains("has-dot"));
  bar.setDot("home", false);
  assert.ok(dot.hasAttribute("hidden"));
  assert.equal(bar.setDot("nowhere", true), false);
  bar.setExpanded(true);
  assert.equal(bar.key("menu").getAttribute("aria-expanded"), "true");
  bar.setExpanded(true, "tools");
  assert.equal(bar.key("tools").getAttribute("aria-expanded"), "true");
});

test("the bar reads no state, dispatches nothing and keeps no timer", () => {
  const source = fs.readFileSync(path.join(__dirname, "slate", "slate-phone-bar.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /dispatch|request\(|setTimeout|Bridge/);
});
