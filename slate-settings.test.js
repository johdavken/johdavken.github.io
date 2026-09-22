"use strict";

/* slate-settings.js: the theme picker over the controller. */

const test = require("node:test");
const assert = require("node:assert/strict");

const { makeDocument, click } = require("./tools/slate-test/fake-dom.js");
const settings = require("./slate/slate-settings.js");
const theme = require("./slate-theme.js");

function storage() {
  const store = {};
  return { getItem: key => (key in store ? store[key] : null), setItem(key, value) { store[key] = String(value); }, store };
}

/* aria-checked down the gallery with exactly one tile on. */
const checkedOnly = id => theme.THEME_IDS.map(one => (one === id ? "true" : "false"));

test("the picker offers every registered theme as a radio, marks the current one, and drives the controller", () => {
  const doc = makeDocument();
  const root = doc.createElement("div");
  const saved = storage();
  const controller = theme.create(root, saved);
  const view = settings.create(doc, { theme: controller, themes: theme.THEMES });
  const tiles = view.element.querySelectorAll("[data-theme-choice]");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("data-theme-choice")), [...theme.THEME_IDS]);
  assert.deepEqual(tiles.map(tile => tile.getAttribute("role")), theme.THEME_IDS.map(() => "radio"));
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru-light"));
  assert.equal(view.element.querySelector("[role='radiogroup']").getAttribute("aria-label"), "Theme");
  // The swatch draws in the tile's own theme, not the live one.
  assert.equal(tiles[1].querySelector(".slate-theme-scope").getAttribute("data-theme"), "yaru-dark");
  assert.equal(tiles[0].querySelector(".slate-theme-tile__selected-mark").textContent, "✓");
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-title"));
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-status"));
  assert.ok(tiles[0].querySelector(".slate-theme-tile__preview-action"));

  click(tiles[1]);
  assert.equal(controller.getTheme(), "yaru-dark");
  assert.equal(root.getAttribute("data-theme"), "yaru-dark");
  assert.equal(saved.store[theme.STORAGE_KEY], "yaru-dark");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru-dark"));
  assert.ok(tiles[1].classList.contains("is-selected"));

  // A change from elsewhere (another Settings, the harness) is followed.
  controller.setTheme("yaru-light");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), checkedOnly("yaru-light"));
});

test("with no controller the tiles are inert and the section says so; the later-preferences stub is present", () => {
  const doc = makeDocument();
  const view = settings.create(doc, { theme: null, themes: theme.THEMES });
  const tiles = view.element.querySelectorAll("[data-theme-choice]");
  assert.deepEqual(tiles.map(tile => tile.getAttribute("aria-checked")), theme.THEME_IDS.map(() => "false"));
  assert.doesNotThrow(() => click(tiles[0]));
  assert.match(view.element.querySelector(".slate-settings__note").textContent, /cannot be changed/);
  assert.match(view.element.querySelector(".slate-stub").textContent, /later phases/);
  assert.equal(view.tile("yaru-dark"), tiles[1]);
  assert.equal(view.tile("nope"), null);
});
