/* The Handling preview: the chosen drag style, played on a loop in Settings.
 *
 * A small stage under the Handling choices. It is built from the drag's
 * own parts - the proxy and its card (slate-recipe-drag.js's classes) and
 * a Grid cell as the hopper it lands on - so the sheet that styles a real
 * drag styles this one too, by the root's data-drag-motion, and a choice
 * shows at once what it will do. Nothing here names a handling.
 *
 * One pass: the card is lifted (built anew, so its entrance plays), carried
 * onto the cell leaning the way it goes, rests there as a card over a
 * hopper does (is-over on the card, is-drop-target on the cell), and is
 * carried home; then again. The loop runs only while Settings shows
 * (start / stop) and starts over when the choice changes (replay). It
 * reads nothing and dispatches nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateHandlingPreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* How far the card travels, in px, and when each moment of a pass falls. */
  const DISTANCE = 176;
  const SWAY = 6;
  const PASS = Object.freeze([
    [700, "carry"],
    [950, "lean-half"],
    [1200, "upright"],
    [1300, "over"],
    [2600, "home"],
    [2850, "lean-half"],
    [3100, "upright"],
    [3600, "again"]
  ]);
  const CARD = Object.freeze({ id: "A2", pct: "10%", resin: "MS0100" });
  const CELL = Object.freeze({ id: "B3", pct: "13%", resin: "CCWHITE04" });

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function text(doc, name, className, value) {
    const node = element(doc, name, className);
    node.textContent = value;
    return node;
  }

  /**
   * @param {Document} doc
   * @param {object} [options]
   * @param {object} [options.timers]  { setTimeout, clearTimeout }
   */
  function create(doc, options) {
    const settings = options || {};
    const timers = settings.timers || { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id) };

    const stage = element(doc, "div", "slate-handling-preview", { "aria-hidden": "true" });
    // The hopper it lands on: a Grid cell, so the Grid's marks are its marks.
    const cell = element(doc, "div", "slate-hopper slate-handling-preview__cell", { "data-recipe": "preview" });
    cell.appendChild(text(doc, "span", "slate-hopper__id", CELL.id));
    cell.appendChild(text(doc, "span", "slate-hopper__pct", CELL.pct));
    cell.appendChild(text(doc, "span", "slate-hopper__resin", CELL.resin));
    stage.appendChild(cell);
    // The proxy that follows the pointer; the card inside it is the style's.
    const carry = element(doc, "div", "slate-drag-proxy slate-handling-preview__carry");
    stage.appendChild(carry);

    let card = null;
    let pending = [];
    let running = false;

    function lift() {
      if (card && card.parentNode) card.parentNode.removeChild(card);
      card = element(doc, "div", "slate-drag-proxy__card");
      card.appendChild(text(doc, "span", "slate-drag-proxy__id", CARD.id));
      card.appendChild(text(doc, "span", "slate-drag-proxy__pct", CARD.pct));
      card.appendChild(text(doc, "span", "slate-drag-proxy__resin", CARD.resin));
      carry.appendChild(card);
    }

    function lean(deg) {
      if (card) card.style.setProperty("--slate-drag-sway", `${deg}deg`);
    }

    function over(on) {
      if (card) card.classList.toggle("is-over", on);
      cell.classList.toggle("is-drop-target", on);
    }

    function at(x) {
      carry.style.transform = `translate(${x}px, 0)`;
    }

    lift();

    let heading = 1;
    const MOMENTS = {
      carry() { heading = 1; at(DISTANCE); lean(SWAY); },
      home() { heading = -1; over(false); at(0); lean(-SWAY); },
      "lean-half"() { lean((SWAY / 2) * heading); },
      upright() { lean(0); },
      over() { over(true); },
      again() { pass(); }
    };

    function clear() {
      for (const id of pending) timers.clearTimeout(id);
      pending = [];
    }

    function pass() {
      clear();
      over(false);
      at(0);
      lift();
      lean(0);
      for (const [ms, moment] of PASS) pending.push(timers.setTimeout(() => { if (running) MOMENTS[moment](); }, ms));
    }

    return Object.freeze({
      element: stage,
      start() { if (running) return; running = true; pass(); },
      stop() { running = false; clear(); over(false); at(0); lean(0); },
      /* The choice changed: play it from the lift. */
      replay() { if (running) pass(); else lift(); },
      running: () => running,
      card: () => card,
      cell: () => cell
    });
  }

  return Object.freeze({ DISTANCE, SWAY, PASS, create });
});
