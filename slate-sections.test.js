"use strict";

/* slate-sections.js and slate-rail.js: the registry, the swap, and the
 * rail that asks for it. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click, key } = require("./tools/slate-test/fake-dom.js");
const sections = require("./slate/slate-sections.js");
const rail = require("./slate/slate-rail.js");

function definitions(extra) {
  const log = [];
  const make = id => ({
    id, label: id[0].toUpperCase() + id.slice(1), group: id === "settings" ? "foot" : "sections", icon: id,
    create(doc, ctx) {
      const element = doc.createElement("div");
      element.textContent = id;
      return {
        element,
        update(resolved, meta) { log.push([id, "update", meta.kind, !!meta.own]); },
        onShow() { log.push([id, "show"]); },
        onHide() { log.push([id, "hide"]); }
      };
    }
  });
  return { log, list: [make("recipe"), ...(extra || []), make("settings")] };
}

test("every section is mounted once, hidden, and show() swaps exactly one into view", () => {
  const doc = makeDocument();
  const mount = doc.createElement("section");
  const { log, list } = definitions();
  const changes = [];
  const swap = sections.mountSections(doc, mount, list, {}, { onChange: definition => changes.push(definition.id) });
  assert.equal(mount.children.length, 2);
  for (const wrapper of mount.children) {
    assert.ok(wrapper.hasAttribute("hidden"));
    assert.ok(wrapper.classList.contains("slate-section"));
  }
  assert.equal(swap.current(), null);
  assert.equal(swap.show("recipe"), true);
  assert.equal(swap.current().id, "recipe");
  assert.ok(!swap.element("recipe").hasAttribute("hidden"));
  assert.ok(swap.element("recipe").classList.contains(sections.ENTERING));
  assert.ok(swap.element("settings").hasAttribute("hidden"));
  assert.deepEqual(changes, ["recipe"]);
  assert.deepEqual(log, [["recipe", "show"]]);

  // Showing the same section again is not a re-entry.
  swap.show("recipe");
  assert.deepEqual(changes, ["recipe"]);

  swap.show("settings");
  assert.ok(swap.element("recipe").hasAttribute("hidden"));
  assert.ok(!swap.element("settings").hasAttribute("hidden"));
  assert.deepEqual(log.slice(1), [["recipe", "hide"], ["settings", "show"]]);
  assert.equal(swap.show("nonsense"), false);
  assert.equal(swap.current().id, "settings");
  // The entering class leaves with the animation.
  swap.element("settings").dispatchEvent({ type: "animationend" });
  assert.ok(!swap.element("settings").classList.contains(sections.ENTERING));
});

test("update fans out to every section, visible or not, and one that throws stops none", () => {
  const doc = makeDocument();
  const mount = doc.createElement("section");
  const { log, list } = definitions([{
    id: "broken", label: "Broken", group: "tools", create: () => ({ element: doc.createElement("div"), update() { throw new Error("boom"); } })
  }]);
  const swap = sections.mountSections(doc, mount, list, {});
  swap.update({}, { kind: "values", own: true });
  assert.deepEqual(log, [["recipe", "update", "values", true], ["settings", "update", "values", true]]);
  assert.deepEqual(swap.definitions().map(one => one.id), ["recipe", "broken", "settings"]);
});

test("a definition without an id, label, group or create is refused, as is a duplicate", () => {
  const doc = makeDocument();
  const mount = doc.createElement("section");
  assert.throws(() => sections.mountSections(doc, mount, [{ id: "Bad Id", label: "x", group: "sections", create() {} }], {}), /invalid/);
  assert.throws(() => sections.mountSections(doc, mount, [{ id: "a", label: "", group: "sections", create() {} }], {}), /invalid/);
  assert.throws(() => sections.mountSections(doc, mount, [{ id: "a", label: "A", group: "elsewhere", create() {} }], {}), /invalid/);
  const { list } = definitions();
  assert.throws(() => sections.mountSections(doc, mount, [...list, list[0]], {}), /duplicate/);
  assert.equal(sections.valid({ id: "recipe", label: "Recipe", group: "sections", create() {} }), true);
});

/* ----------------------------------------------------------------------
 *   The rail
 * -------------------------------------------------------------------- */

test("the rail lists sections, then Tools, then the foot; selecting asks the boot and marks the active item", () => {
  const doc = makeDocument();
  const { list } = definitions();
  const selected = [];
  const view = rail.create(doc, { sections: list, onSelect: id => selected.push(id) });
  const items = view.element.querySelectorAll("[data-section]");
  assert.deepEqual(items.map(item => item.getAttribute("data-section")), ["recipe", "settings"]);
  assert.ok(view.element.querySelector(".slate-rail__brand .slate-logo"), "the mark is missing from the brand");
  assert.equal(view.element.querySelector(".slate-rail__word").textContent, "Resin.Tools");
  assert.ok(view.element.querySelector(".slate-rail__foot [data-section='settings']"), "Settings is not in the foot");
  assert.ok(view.element.querySelector(".slate-rail__sections [data-section='recipe']"));

  click(items[1]);
  assert.deepEqual(selected, ["settings"]);
  view.setActive("settings");
  assert.ok(items[1].classList.contains("is-active"));
  assert.equal(items[1].getAttribute("aria-current"), "page");
  assert.ok(!items[0].classList.contains("is-active"));
  assert.equal(items[0].getAttribute("aria-current"), null);
});

test("Tools drops a menu that says there are no tools yet; Escape and an outside press close it", () => {
  const doc = makeDocument();
  const { list } = definitions();
  const view = rail.create(doc, { sections: list, onSelect: () => {} });
  doc.body.appendChild(view.element);
  const tools = view.element.querySelector(".slate-rail__item--tools");
  const menu = view.element.querySelector(".slate-rail__menu");
  assert.equal(tools.getAttribute("aria-haspopup"), "menu");
  assert.equal(tools.getAttribute("aria-expanded"), "false");
  assert.ok(menu.hasAttribute("hidden"));
  assert.equal(menu.querySelector(".slate-rail__menu-empty").textContent, rail.TOOLS_EMPTY);

  click(tools);
  assert.equal(view.isToolsOpen(), true);
  assert.equal(tools.getAttribute("aria-expanded"), "true");
  assert.ok(!menu.hasAttribute("hidden"));
  assert.equal((doc.listeners.pointerdown || []).length, 1, "the outside listener is not on the document");

  const escape = key(menu, "Escape");
  assert.equal(view.isToolsOpen(), false);
  assert.equal(escape._stopped, true, "Escape was not stopped at the rail");
  assert.equal((doc.listeners.pointerdown || []).length, 0, "the outside listener was not removed");

  click(tools);
  const outside = doc.createElement("div");
  doc.body.appendChild(outside);
  doc.listeners.pointerdown[0]({ target: outside });
  assert.equal(view.isToolsOpen(), false);

  click(tools);
  doc.listeners.pointerdown[0]({ target: menu });
  assert.equal(view.isToolsOpen(), true, "a press inside the menu closed it");
  click(tools);
  assert.equal(view.isToolsOpen(), false);
});

test("a tool section lists inside the menu as a menuitem and selecting it closes the menu", () => {
  const doc = makeDocument();
  const { list } = definitions([{ id: "totals", label: "Resin Totals", group: "tools", icon: "totals", create: () => ({ element: doc.createElement("div") }) }]);
  const selected = [];
  const view = rail.create(doc, { sections: list, onSelect: id => selected.push(id) });
  const menu = view.element.querySelector(".slate-rail__menu");
  assert.equal(menu.querySelector(".slate-rail__menu-empty"), null);
  const item = menu.querySelector("[data-section='totals']");
  assert.equal(item.getAttribute("role"), "menuitem");
  click(view.element.querySelector(".slate-rail__item--tools"));
  click(item);
  assert.deepEqual(selected, ["totals"]);
  assert.equal(view.isToolsOpen(), false);
  view.setActive("totals");
  assert.ok(view.element.querySelector(".slate-rail__item--tools").classList.contains("is-active"));
});
