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
  const mark = view.element.querySelector(".slate-rail__brand .slate-logo");
  assert.ok(mark, "the mark is missing from the brand");
  assert.equal(mark.getAttribute("aria-label"), "Resin.Tools", "the mark lost its name when the wordmark went");
  assert.equal(view.element.querySelector(".slate-rail__word"), null, "the wordmark is still in the rail");
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

test("Tools drops a menu that says there are no tools yet; it stays open through a press elsewhere, and closes on Escape or the item again", () => {
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
  assert.equal((doc.listeners.pointerdown || []).length, 0, "the rail listens to the document for a press outside");

  const escape = key(menu, "Escape");
  assert.equal(view.isToolsOpen(), false);
  assert.equal(escape._stopped, true, "Escape was not stopped at the rail");

  // Open, it stays open: a press elsewhere is no request to close it.
  click(tools);
  const outside = doc.createElement("div");
  doc.body.appendChild(outside);
  click(outside);
  assert.equal(view.isToolsOpen(), true, "a press outside closed the menu");
  click(tools);
  assert.equal(view.isToolsOpen(), false);
});

test("a tool section lists inside the menu as a menuitem and selecting it leaves the menu open", () => {
  const doc = makeDocument();
  const { list } = definitions([{ id: "totals", label: "Resin Totals", group: "tools", pane: "aside", icon: "totals", create: () => ({ element: doc.createElement("div") }) }]);
  const selected = [];
  const view = rail.create(doc, { sections: list, onSelect: id => selected.push(id) });
  const menu = view.element.querySelector(".slate-rail__menu");
  assert.equal(menu.querySelector(".slate-rail__menu-empty"), null);
  const item = menu.querySelector("[data-section='totals']");
  assert.equal(item.getAttribute("role"), "menuitem");
  click(view.element.querySelector(".slate-rail__item--tools"));
  click(item);
  assert.deepEqual(selected, ["totals"]);
  assert.equal(view.isToolsOpen(), true, "selecting a tool closed the menu");
  click(view.element.querySelector("[data-section='recipe']"));
  assert.equal(view.isToolsOpen(), true, "selecting a section closed the menu");
  // A tool shows in the aside (pane "aside"), marked apart from the
  // centre's section: both stay current.
  view.setActive("recipe");
  view.setActivePane("aside", "totals");
  const tools = view.element.querySelector(".slate-rail__item--tools");
  assert.ok(!tools.classList.contains("is-active"), "the Tools item lit: the mark belongs to the tool's own item");
  assert.ok(item.classList.contains("is-active"));
  assert.equal(item.getAttribute("aria-current"), "page");
  assert.ok(view.element.querySelector("[data-section='recipe']").classList.contains("is-active"), "marking the tool unmarked the section");
  view.setActive("settings");
  assert.ok(item.classList.contains("is-active"), "marking a section unmarked the tool");
  assert.ok(!view.element.querySelector("[data-section='recipe']").classList.contains("is-active"));
  view.setActivePane("aside", null);
  assert.ok(!item.classList.contains("is-active"));
  assert.equal(item.getAttribute("aria-current"), null);
  assert.ok(view.element.querySelector("[data-section='settings']").classList.contains("is-active"), "clearing the tool unmarked the section");
});

test("a section listed with the sections but shown in the aside sits in the list, under the Recipe Book, and is marked with the aside", () => {
  const doc = makeDocument();
  const { list } = definitions();
  const balance = { id: "resin-balance", label: "Resin Balance", group: "sections", pane: "aside", icon: "balance", create: () => ({ element: doc.createElement("div") }) };
  const withBalance = [list[0], balance, list[1]];
  const view = rail.create(doc, { sections: withBalance, onSelect: () => {} });
  assert.deepEqual(view.element.querySelectorAll(".slate-rail__sections [data-section]").map(item => item.getAttribute("data-section")), ["recipe", "resin-balance"]);
  assert.equal(view.element.querySelector(".slate-rail__menu [data-section='resin-balance']"), null, "the aside section landed in Tools");
  const item = view.element.querySelector("[data-section='resin-balance']");
  view.setActive("recipe");
  view.setActivePane("aside", "resin-balance");
  assert.ok(item.classList.contains("is-active"));
  assert.ok(view.element.querySelector("[data-section='recipe']").classList.contains("is-active"));
  view.setActive("settings");
  assert.ok(item.classList.contains("is-active"), "the centre's change unmarked the aside's section");
  view.setActivePane("aside", null);
  assert.ok(!item.classList.contains("is-active"));
});

test("a tool in the stats pane marks apart from the aside's, and the Tools item itself never lights", () => {
  const doc = makeDocument();
  const { list } = definitions([
    { id: "pressure", label: "PSI", group: "tools", pane: "stats", icon: "gauge", create: () => ({ element: doc.createElement("div") }) },
    { id: "winding", label: "Winding", group: "tools", pane: "aside", icon: "winding", create: () => ({ element: doc.createElement("div") }) }
  ]);
  const view = rail.create(doc, { sections: list, onSelect: () => {} });
  const tools = view.element.querySelector(".slate-rail__item--tools");
  const pressure = view.element.querySelector("[data-section='pressure']");
  const windingItem = view.element.querySelector("[data-section='winding']");
  assert.equal(rail.CENTRE, "centre");
  view.setActive("recipe");
  view.setActivePane("stats", "pressure");
  assert.ok(!tools.classList.contains("is-active"), "the Tools item lit");
  assert.equal(pressure.getAttribute("aria-current"), "page");
  assert.equal(windingItem.getAttribute("aria-current"), null);
  view.setActivePane("aside", "winding");
  assert.ok(pressure.classList.contains("is-active"), "the aside's mark unmarked the stats pane");
  assert.ok(windingItem.classList.contains("is-active"));
  assert.ok(!tools.classList.contains("is-active"), "the Tools item lit");
  view.setActivePane("stats", null);
  assert.ok(!pressure.classList.contains("is-active"));
  assert.ok(windingItem.classList.contains("is-active"), "the stats pane's home unmarked the aside's tool");
  assert.ok(view.element.querySelector("[data-section='recipe']").classList.contains("is-active"), "the centre lost its mark");
  view.setActivePane("aside", null);
  assert.ok(!windingItem.classList.contains("is-active"));
  // The stats group is a valid home for a swap and is listed nowhere.
  const scrap = { id: "scrap", label: "Scrap", group: "stats", pane: "stats", create: () => ({ element: doc.createElement("div") }) };
  assert.ok(sections.valid(scrap));
  assert.ok(sections.GROUPS.includes("stats"));
  const listed = rail.create(doc, { sections: list.concat([scrap]), onSelect: () => {} });
  assert.equal(listed.element.querySelector("[data-section='scrap']"), null, "the rail lists the Scrap card");
});

test("the rail draws a glyph for every section the boot defines", () => {
  const boot = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/slate.js"), "utf8");
  const icons = [...boot.matchAll(/icon: "([a-z-]+)"/g)].map(match => match[1]);
  assert.deepEqual(icons, ["home", "recipe", "book", "weights", "balance", "workspaces", "lines", "resins", "gauge", "winding", "settings", "timeline"],
    "the boot's sections changed: a phone's Home, Recipe, Recipe Book, Weights, Resin Balance, the administrator's three, the two Tools, Settings; the aside's Timeline");
  for (const icon of icons) assert.ok(rail.GLYPHS[icon], `no glyph for ${icon}`);
});

test("an aside definition is a valid section the rail lists nowhere: the Timeline swaps in the aside without a rail item", () => {
  const doc = makeDocument();
  const mount = doc.createElement("aside");
  const { list } = definitions();
  const timeline = { id: "timeline", label: "Timeline", group: "aside", icon: "timeline", create: () => ({ element: doc.createElement("div") }) };
  const tool = { id: "totals", label: "Resin Totals", group: "tools", pane: "aside", icon: "totals", create: () => ({ element: doc.createElement("div") }) };
  assert.ok(sections.valid(timeline));
  assert.ok(sections.GROUPS.includes("aside"));
  const swap = sections.mountSections(doc, mount, [timeline, tool], {});
  assert.ok(swap.show("timeline"));
  assert.ok(!swap.element("timeline").hasAttribute("hidden"));
  assert.ok(swap.element("totals").hasAttribute("hidden"));
  assert.ok(swap.show("totals"));
  assert.ok(swap.element("timeline").hasAttribute("hidden"), "the Timeline stayed while the tool arrived");
  const view = rail.create(doc, { sections: list.concat([timeline, tool]), onSelect: () => {} });
  assert.equal(view.element.querySelector("[data-section='timeline']"), null, "the rail lists the Timeline");
  assert.ok(view.element.querySelector(".slate-rail__menu [data-section='totals']"));
});

test("a section left behind lets go of the focus, so a field in it does not keep a tablet's keyboard up over the next", () => {
  const doc = makeDocument();
  const mount = doc.createElement("div");
  doc.body.appendChild(mount);
  const fieldOf = {};
  const make = id => ({ id, label: id, group: "sections", icon: id, create(d) { const element = d.createElement("div"); const input = d.createElement("input"); element.appendChild(input); fieldOf[id] = input; return { element }; } });
  const view = sections.mountSections(doc, mount, [make("one"), make("two")], {}, {});
  view.show("one");
  let blurred = false;
  fieldOf.one.blur = () => { blurred = true; };
  fieldOf.one.focus();
  view.show("two");
  assert.equal(blurred, true, "the hidden section kept its field focused");
  let other = false;
  fieldOf.two.blur = () => { other = true; };
  doc.activeElement = null;
  view.show("one");
  assert.equal(other, false, "a field that had no focus was blurred");
});
