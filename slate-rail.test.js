"use strict";

/* slate-rail.js: the rail lists the sections, marks what each pane shows,
 * and keeps the administrator's sections off an operator's rail until
 * there is an administrator. It reads no state of its own. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const rail = require("./slate/slate-rail.js");

const SECTIONS = [
  { id: "recipe", label: "Recipe", group: "sections", icon: "recipe" },
  { id: "recipe-book", label: "Recipe Book", group: "sections", icon: "book" },
  { id: "resin-balance", label: "Resin Balance", group: "sections", pane: "aside", icon: "balance" },
  { id: "workspaces", label: "Workspaces", group: "sections", admin: true, icon: "workspaces" },
  { id: "line-config", label: "Line Configuration", group: "sections", admin: true, icon: "lines" },
  { id: "resins", label: "Resin Database", group: "sections", admin: true, icon: "resins" },
  { id: "pressure", label: "PSI ⇄ bar", group: "tools", pane: "stats", icon: "gauge" },
  { id: "settings", label: "Settings", group: "foot", icon: "settings" }
];

function boot(options) {
  const doc = makeDocument();
  const chosen = [];
  const view = rail.create(doc, Object.assign({ sections: SECTIONS, onSelect: id => chosen.push(id) }, options || {}));
  doc.body.appendChild(view.element);
  return { doc, view, chosen, item: id => view.element.querySelector(`[data-section='${id}']`) };
}

/* The section column itself: the Tools menu hangs inside it, so its items
   are left out here. */
const listedIds = view => view.element
  .querySelectorAll(".slate-rail__sections [data-section]")
  .filter(node => !node.hasAttribute("hidden") && !node.closest(".slate-rail__menu"))
  .map(node => node.getAttribute("data-section"));

test("the sections are listed in order, the tools go in the menu, the foot takes the rest, and every item carries its glyph", () => {
  const { view, item } = boot();
  assert.deepEqual(listedIds(view), ["recipe", "recipe-book", "resin-balance"]);
  assert.deepEqual(view.element.querySelectorAll(".slate-rail__menu [data-section]").map(node => node.getAttribute("data-section")), ["pressure"]);
  assert.ok(view.element.querySelector(".slate-rail__foot [data-section='settings']"));
  assert.ok(item("recipe").querySelector(".slate-rail__glyph"));
  assert.equal(item("recipe").querySelector(".slate-rail__label").textContent, "Recipe");
  // A name too long for the rail is ellipsised, so each item carries it whole.
  assert.equal(item("resin-balance").getAttribute("title"), "Resin Balance");
});

test("an administrator's sections are built with the rest but unlisted, and the rule above them is drawn only with them", () => {
  const { view, item } = boot();
  const divider = view.element.querySelector(".slate-rail__divider");
  assert.ok(divider, "no rule was drawn for the administrator's sections");
  assert.ok(divider.hasAttribute("hidden"));
  for (const id of ["workspaces", "line-config", "resins"]) {
    assert.ok(item(id), `${id} was not built`);
    assert.ok(item(id).hasAttribute("hidden"), `${id} was listed with nobody signed in`);
    assert.equal(view.isListed(id), false);
  }
  // The rule stands before the first of them, after the ordinary sections.
  const nodes = view.element.querySelector(".slate-rail__sections").children.map(node => node.getAttribute("data-section") || node.getAttribute("class"));
  assert.equal(nodes[3], "slate-rail__divider");
  assert.equal(nodes[4], "workspaces");

  // Signed in: all three, and the rule.
  for (const id of ["workspaces", "line-config", "resins"]) assert.equal(view.setListed(id, true), true);
  assert.deepEqual(listedIds(view), ["recipe", "recipe-book", "resin-balance", "workspaces", "line-config", "resins"]);
  assert.ok(!divider.hasAttribute("hidden"));
  assert.equal(view.isListed("workspaces"), true);

  // One at a time back off: the rule stays while any of them is listed.
  view.setListed("workspaces", false);
  assert.ok(!divider.hasAttribute("hidden"));
  view.setListed("line-config", false);
  view.setListed("resins", false);
  assert.ok(divider.hasAttribute("hidden"));
  assert.deepEqual(listedIds(view), ["recipe", "recipe-book", "resin-balance"]);
  assert.equal(view.setListed("nope", true), false);
  assert.equal(view.isListed("nope"), false);
});

test("a press on an item names it; the marks are kept per pane, and the Tools item never lights", () => {
  const { view, chosen, item } = boot();
  click(item("recipe-book"));
  assert.deepEqual(chosen, ["recipe-book"]);
  view.setActive("recipe-book");
  assert.ok(item("recipe-book").classList.contains("is-active"));
  assert.equal(item("recipe-book").getAttribute("aria-current"), "page");

  // The aside's own mark does not unmark the centre's.
  view.setActivePane("aside", "resin-balance");
  assert.ok(item("resin-balance").classList.contains("is-active"));
  assert.ok(item("recipe-book").classList.contains("is-active"), "the aside's mark took the centre's");
  view.setActivePane("aside", null);
  assert.ok(!item("resin-balance").classList.contains("is-active"));

  // An administrator's section is a centre section: it marks with them.
  view.setListed("resins", true);
  view.setActive("resins");
  assert.ok(item("resins").classList.contains("is-active"));
  assert.ok(!item("recipe-book").classList.contains("is-active"));
});

test("the Tools menu opens and closes on its own item and on Escape", () => {
  const { view } = boot();
  const button = view.element.querySelector(".slate-rail__item--tools");
  const menu = view.element.querySelector(".slate-rail__menu");
  assert.ok(menu.hasAttribute("hidden"));
  click(button);
  assert.equal(view.isToolsOpen(), true);
  assert.ok(!menu.hasAttribute("hidden"));
  assert.equal(button.getAttribute("aria-expanded"), "true");
  click(button);
  assert.equal(view.isToolsOpen(), false);
  view.openTools();
  view.element.dispatchEvent({ type: "keydown", key: "Escape", target: view.element, stopPropagation() {} });
  assert.equal(view.isToolsOpen(), false);
});
