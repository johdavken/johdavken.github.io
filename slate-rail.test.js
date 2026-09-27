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
  { id: "formulas", label: "Formulas", group: "tools", pane: "aside", icon: "gauge" },
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
  assert.deepEqual(view.element.querySelectorAll(".slate-rail__menu[data-menu='tools'] [data-section]").map(node => node.getAttribute("data-section")), ["formulas"]);
  assert.ok(view.element.querySelector(".slate-rail__foot [data-section='settings']"));
  assert.ok(item("recipe").querySelector(".slate-rail__glyph"));
  assert.equal(item("recipe").querySelector(".slate-rail__label").textContent, "Recipe");
  // A name too long for the rail is ellipsised, so each item carries it whole.
  assert.equal(item("resin-balance").getAttribute("title"), "Resin Balance");
});

test("an administrator's sections wait in an Admin drop-down after Tools, behind a rule, and the drop-down and rule are drawn only with them", () => {
  const { view, item } = boot();
  const divider = view.element.querySelector(".slate-rail__divider");
  const admin = view.element.querySelector("[data-menu='admin'].slate-rail__tools");
  assert.ok(divider, "no rule was drawn for the administrator's sections");
  assert.ok(admin, "no Admin drop-down");
  assert.ok(divider.hasAttribute("hidden") && admin.hasAttribute("hidden"));
  for (const id of ["workspaces", "line-config", "resins"]) {
    assert.ok(item(id), `${id} was not built`);
    assert.ok(item(id).closest(".slate-rail__menu[data-menu='admin']"), `${id} is not in the Admin menu`);
    assert.ok(item(id).hasAttribute("hidden"), `${id} was listed with nobody signed in`);
    assert.equal(view.isListed(id), false);
  }
  // Order: the ordinary sections, Tools, the rule, Admin.
  const nodes = view.element.querySelector(".slate-rail__sections").children.map(node => node.getAttribute("data-section") || node.getAttribute("data-menu") || node.getAttribute("class"));
  assert.deepEqual(nodes, ["recipe", "recipe-book", "resin-balance", "tools", "slate-rail__divider", "admin"]);
  assert.deepEqual(listedIds(view), ["recipe", "recipe-book", "resin-balance"]);

  // Signed in: the drop-down and the rule, the three inside it, the column unchanged.
  for (const id of ["workspaces", "line-config", "resins"]) assert.equal(view.setListed(id, true), true);
  assert.ok(!divider.hasAttribute("hidden") && !admin.hasAttribute("hidden"));
  assert.deepEqual(listedIds(view), ["recipe", "recipe-book", "resin-balance"]);
  assert.deepEqual(view.element.querySelectorAll(".slate-rail__menu[data-menu='admin'] [data-section]").filter(node => !node.hasAttribute("hidden")).map(node => node.getAttribute("data-section")),
    ["workspaces", "line-config", "resins"]);
  assert.equal(view.isListed("workspaces"), true);
  assert.equal(admin.querySelector(".slate-rail__item--admin .slate-rail__label").textContent, "Admin");

  // One at a time back off: the drop-down stays while any of them is listed,
  // and closes with the last.
  view.setListed("workspaces", false);
  assert.ok(!admin.hasAttribute("hidden"));
  view.openAdmin();
  assert.equal(view.isAdminOpen(), true);
  view.setListed("line-config", false);
  view.setListed("resins", false);
  assert.ok(divider.hasAttribute("hidden") && admin.hasAttribute("hidden"));
  assert.equal(view.isAdminOpen(), false);
  assert.equal(view.setListed("nope", true), false);
  assert.equal(view.isListed("nope"), false);
});

test("one drop-down collapses the other: opening Admin closes Tools, opening Tools closes Admin", () => {
  const { view } = boot();
  for (const id of ["workspaces", "line-config", "resins"]) view.setListed(id, true);
  const toolsButton = view.element.querySelector(".slate-rail__item--tools");
  const adminButton = view.element.querySelector(".slate-rail__item--admin");
  click(toolsButton);
  assert.equal(view.isToolsOpen(), true);
  click(adminButton);
  assert.equal(view.isAdminOpen(), true);
  assert.equal(view.isToolsOpen(), false, "Tools stayed open under Admin");
  assert.equal(toolsButton.getAttribute("aria-expanded"), "false");
  assert.ok(view.element.querySelector(".slate-rail__menu[data-menu='tools']").hasAttribute("hidden"));
  click(toolsButton);
  assert.equal(view.isToolsOpen(), true);
  assert.equal(view.isAdminOpen(), false);
  // Escape closes the open one.
  view.element.dispatchEvent({ type: "keydown", key: "Escape", target: view.element, stopPropagation() {} });
  assert.equal(view.isToolsOpen(), false);
  // A press on an admin section still selects it.
  click(adminButton);
  click(view.element.querySelector("[data-section='line-config']"));
  assert.equal(view.isAdminOpen(), true, "the sidebar's menu closed on a selection");
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

test("every item carries its name as its accessible label, so it survives a compact rail that hides the words", () => {
  const { makeDocument } = require("./tools/slate-test/fake-dom.js");
  const railModule = require("./slate/slate-rail.js");
  const doc = makeDocument();
  const view = railModule.create(doc, { sections: [{ id: "recipe", label: "Recipe", group: "sections", icon: "recipe" }, { id: "winding", label: "Winding Tension", group: "tools", pane: "aside", icon: "winding" }, { id: "settings", label: "Settings", group: "foot", icon: "settings" }], onSelect: () => {} });
  const items = view.element.querySelectorAll("[data-section]");
  assert.ok(items.length === 3);
  for (const item of items) assert.equal(item.getAttribute("aria-label"), item.getAttribute("title"));
});

test("as a flyout the Tools menu closes on a press outside it and on a selection; as the sidebar it stays, as before", () => {
  const { makeDocument, click, pointer } = require("./tools/slate-test/fake-dom.js");
  const railModule = require("./slate/slate-rail.js");
  const defs = [{ id: "recipe", label: "Recipe", group: "sections", icon: "recipe" }, { id: "winding", label: "Winding Tension", group: "tools", pane: "aside", icon: "winding" }, { id: "settings", label: "Settings", group: "foot", icon: "settings" }];
  for (const compact of [true, false]) {
    const doc = makeDocument();
    const selected = [];
    const view = railModule.create(doc, { sections: defs, onSelect: id => selected.push(id), flyout: () => compact });
    doc.body.appendChild(view.element);
    const label = view.element.querySelector(".slate-rail__menu .slate-rail__label");
    assert.ok(label.classList.contains("slate-rail__label--menu"), "a tool's name is not marked to show in the flyout");
    view.openTools();
    pointer("pointerdown", doc.body);
    assert.equal(view.isToolsOpen(), !compact, compact ? "the flyout stayed open through a press outside" : "the sidebar menu closed on a press elsewhere");
    view.openTools();
    click(view.element.querySelector("[data-section='winding']"));
    assert.deepEqual(selected, ["winding"]);
    assert.equal(view.isToolsOpen(), !compact);
  }
});

test("the flyout is placed beside the Tools item each time it opens, so it can stand outside the rail's scrolling box; the sidebar's menu is not placed", () => {
  const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
  const railModule = require("./slate/slate-rail.js");
  const defs = [{ id: "recipe", label: "Recipe", group: "sections", icon: "recipe" }, { id: "winding", label: "Winding Tension", group: "tools", pane: "aside", icon: "winding" }];
  for (const compact of [true, false]) {
    const doc = makeDocument();
    const view = railModule.create(doc, { sections: defs, onSelect: () => {}, flyout: () => compact });
    doc.body.appendChild(view.element);
    const button = view.element.querySelector(".slate-rail__item--tools");
    const menu = view.element.querySelector(".slate-rail__menu");
    button._rect = { left: 8, top: 412.4, width: 48, height: 48 };
    click(button);
    assert.equal(menu.style.getPropertyValue("--slate-flyout-top"), compact ? "412px" : "");
    assert.equal(menu.style.getPropertyValue("--slate-flyout-left"), compact ? "56px" : "");
  }
});

test("opened in a phone's sheet or the sidebar, the Tools menu scrolls itself into view, so its last tool is never left below the sheet's foot; a flyout is placed instead", () => {
  const { view } = boot();
  const menu = view.element.querySelector(".slate-rail__menu");
  const scrolls = [];
  menu.scrollIntoView = options => scrolls.push(options);
  view.openTools();
  assert.deepEqual(scrolls, [{ block: "nearest" }]);
  view.closeTools();

  const flyout = boot({ flyout: () => true });
  const flyMenu = flyout.view.element.querySelector(".slate-rail__menu");
  const flyScrolls = [];
  flyMenu.scrollIntoView = options => flyScrolls.push(options);
  flyout.view.openTools();
  assert.deepEqual(flyScrolls, [], "a flyout scrolled the page");
});
