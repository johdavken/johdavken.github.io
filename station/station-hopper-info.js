/* The hopper info panel: what a hopper is running, said beside it when
 * the pointer rests on it.
 *
 * WHAT IT IS
 *
 * A small glass card (glass.css) that stands next to the drawn hopper
 * under the pointer - on any layer, opened or not - with the four things
 * an operator asks of a hopper at a glance: the resin in it, what it is
 * putting out (lb/hr), its share of the layer's blend, and the weight it
 * holds. The timeline's detail panel says the same things of a TRACKED
 * hopper (station-rundown-timeline.js); this says them of every hopper,
 * where the hopper is, and nothing else - no times, no estimate, which
 * are the timeline's. The resin's name is not drawn on the hopper at
 * all, so this is where it is read.
 *
 * The arithmetic is the run-down module's (station-rundown.js):
 * consumption = line output x layer share x hopper share, formatted as
 * the timeline formats it, and the same words where a factor is missing.
 * Nothing is computed here that the timeline would compute differently.
 *
 * WHERE IT STANDS
 *
 * In the utility slot over the stage (station-shell.js): the same grid
 * cell the machine is drawn in, laid over it, inert to the pointer. The
 * panel is placed from the hopper's own screen box and the slot's, both
 * measured - never assumed - so it sits by the hopper wherever the stage
 * has scaled it to. Hung from the hopper's caption, centred on its
 * column: a bank's hoppers stand shoulder to shoulder, so a panel beside
 * one hopper would lie over its neighbours - the very hoppers the
 * pointer moves to next - where under the caption there is only the
 * mixer's frame. Above the hopper's top when there is no room under it;
 * held inside the slot across, and clear of anything the boot file
 * names (the machine rail, which stands where the first bank's panel
 * would fall). It never takes the pointer, so the pointer never leaves
 * the hopper for the panel and the panel never flickers, and it never
 * blocks the click under it.
 *
 * WHAT IT NEVER DOES
 *
 * It reads nothing itself: the boot file hands it an entry it built from
 * the resolved state and the element to stand beside, and hides it when
 * the stage is redrawn or turned over. No timers, no storage, no state
 * but what is on screen.
 *
 * Node standard library only; the browser surfaces (measurement) come in
 * through the options.
 */
(function (root, factory) {
  const rundown = typeof require === "function"
    ? require("./station-rundown.js")
    : (root && root.PolynStationRundown);
  const api = factory(rundown);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationHopperInfo = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (defaultRundown) {
  "use strict";

  /* The gap between the hopper's caption and the panel, and the panel's
   * size as placed when it cannot be measured: the stylesheet's width
   * (hopper-info.css) and the height of its head and three rows. Where
   * the panel has a screen box, that box is used instead. */
  const GAP = 6;
  const PANEL_WIDTH = 248;
  const PANEL_HEIGHT = 104;

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    for (const key of Object.keys(attributes || {})) {
      const value = attributes[key];
      if (value === null || value === undefined) continue;
      node.setAttribute(key, String(value));
    }
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function positive(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  /* What the panel says of an entry, as words: pure, so it is tested
   * without a document. The entry is the boot file's:
   *   { id, layer, resinName, pct, layerPct, lineRate, weight, computed }
   * Each missing factor is named the way the timeline names it, in the
   * warning colour (is-missing), so "—" is never the answer to "why". */
  function describe(entry, rundown) {
    const e = entry || {};
    const r = rundown || defaultRundown;
    const lineRate = positive(e.lineRate);
    const layerPct = positive(e.layerPct);
    const pct = positive(e.pct);
    const weight = positive(e.weight);

    let output;
    if (!lineRate) output = { value: r.reasonLabel("no-output"), missing: true };
    else if (!layerPct) output = { value: r.reasonLabel("no-share"), missing: true };
    else if (!pct) output = { value: r.reasonLabel("no-blend"), missing: true };
    else output = { value: r.formatRate(r.consumptionRate(lineRate, layerPct, pct)), missing: false };

    const blend = pct
      ? { value: `${round(pct)}% of layer ${e.layer || "—"} (${round(layerPct)}%)`, missing: false }
      : { value: "—", missing: !e.resinName ? false : true };

    const held = weight
      ? { value: `${weight.toLocaleString([], { maximumFractionDigits: 1 })} lb${e.computed ? " · computed" : ""}`, missing: false }
      : { value: "—", missing: false };

    return {
      id: String(e.id || ""),
      resin: e.resinName ? String(e.resinName) : "No resin",
      assigned: !!e.resinName,
      rows: [
        { term: "Output", value: output.value, missing: output.missing },
        { term: "Blend", value: blend.value, missing: blend.missing },
        { term: "Weight", value: held.value, missing: held.missing }
      ]
    };
  }

  /**
   * Build the panel.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {Element} [options.mount]   the slot the element will stand in;
   *        measured to place the panel. Without it the panel still says
   *        its words, at the slot's origin.
   * @param {function} [options.measure] (element) => client rect; defaults
   *        to getBoundingClientRect where the element has one
   * @param {object} [options.rundown]  the run-down module, for tests
   * @returns {{ element: Element, panel: Element, show: function, hide: function, visible: function }}
   */
  function create(doc, options) {
    const settings = options || {};
    const rundown = settings.rundown || defaultRundown;
    const measure = typeof settings.measure === "function"
      ? settings.measure
      : el => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);

    const container = element(doc, "div", "station-hopper-info", { "data-role": "hopper-info" });
    const panel = element(doc, "div", "station-hopper-info__panel station-glass", {
      role: "tooltip",
      id: "station-hopper-info",
      hidden: ""
    });
    const head = element(doc, "div", "station-hopper-info__head");
    const idNode = text(doc, "span", "station-hopper-info__id", "");
    const resinNode = text(doc, "span", "station-hopper-info__resin", "");
    head.appendChild(idNode);
    head.appendChild(resinNode);
    panel.appendChild(head);
    const list = element(doc, "dl", "station-hopper-info__list");
    panel.appendChild(list);
    container.appendChild(panel);

    function clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    /* Hung from the anchor's foot (the caption; the hopper's own box
     * otherwise, which reaches below the caption to the end of the
     * hopper's hit area), centred on the hopper's column; above the
     * hopper's top instead when the slot has no room under it. Across,
     * pushed right of anything to clear whose height it would share,
     * then held inside the slot. Measured after the panel is shown, so
     * its own box is the box it will take. */
    function place(target, options) {
      const opts = options || {};
      const box = target ? measure(target) : null;
      const slot = settings.mount ? measure(settings.mount) : null;
      const anchor = opts.anchor ? measure(opts.anchor) : null;
      const clear = opts.clear ? measure(opts.clear) : null;
      const own = measure(panel);
      const width = own && own.width > 0 ? own.width : PANEL_WIDTH;
      const height = own && own.height > 0 ? own.height : PANEL_HEIGHT;
      let x = 0;
      let y = 0;
      let side = "below";
      if (box && slot) {
        y = (anchor ? anchor.bottom : box.bottom) - slot.top + GAP;
        if (y + height > slot.height) {
          side = "above";
          y = Math.max(0, box.top - slot.top - GAP - height);
        }
        x = box.left + box.width / 2 - slot.left - width / 2;
        if (clear && y < clear.bottom - slot.top && y + height > clear.top - slot.top) {
          x = Math.max(x, clear.right - slot.left + GAP);
        }
        x = Math.max(GAP, Math.min(x, slot.width - width - GAP));
      }
      panel.setAttribute("data-side", side);
      panel.setAttribute("style", `--station-info-x: ${Math.round(x)}px; --station-info-y: ${Math.round(y)}px;`);
    }

    /* @param {object} [options]
     * @param {Element} [options.anchor] what the panel hangs from - the
     *        hopper's caption; the target's own box otherwise
     * @param {Element} [options.clear]  what the panel keeps right of when
     *        it would share its height - the machine rail */
    function show(entry, target, options) {
      const said = describe(entry, rundown);
      idNode.textContent = said.id;
      resinNode.textContent = said.resin;
      resinNode.classList.toggle("is-empty", !said.assigned);
      clear(list);
      for (const row of said.rows) {
        const item = element(doc, "div", "station-hopper-info__row");
        item.appendChild(text(doc, "dt", "station-hopper-info__term", row.term));
        item.appendChild(text(doc, "dd", `station-hopper-info__value${row.missing ? " is-missing" : ""}`, row.value));
        list.appendChild(item);
      }
      panel.removeAttribute("hidden");
      place(target, options);
      panel.setAttribute("data-hopper", said.id);
      return said;
    }

    function hide() {
      if (panel.getAttribute("hidden") !== null) return;
      panel.setAttribute("hidden", "");
      panel.removeAttribute("data-hopper");
      clear(list);
    }

    function visible() {
      return panel.getAttribute("hidden") === null;
    }

    return { element: container, panel, show, hide, visible };
  }

  return { GAP, PANEL_WIDTH, PANEL_HEIGHT, describe, create };
});
