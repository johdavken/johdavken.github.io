/* The hopper legend: what the drawn hopper's states mean, opened from an
 * info mark in the stage's corner.
 *
 * WHAT IT IS
 *
 * A small round "i" in the stage's bottom-right corner - the corner the
 * machine rail and the Handbook's launcher leave free - and the glass card
 * (glass.css) it opens above itself: one row per state a hopper can wear
 * on the stage, each with a swatch, a name and a line on what it means
 * and, where a click changes it, what a click does.
 *
 * THE SWATCHES ARE THE HOPPER
 *
 * Each swatch is the real hopper drawing (station-machine-parts.js:
 * hopper), built with the runtime state the row describes and cropped to
 * the part of the equipment that carries it - the receiver for the pump
 * and the cap, the vessel for tracking, the caption for the weight. The
 * stylesheet that colours a hopper on the stage colours the swatch the
 * same way in every theme (hopper.css), so a legend never drifts from
 * the machine: a state that changes how a hopper is drawn changes how
 * its row is drawn, with nothing to update here. The swatch's
 * interaction subtree is stripped - a legend is looked at, not clicked -
 * so no click target of the machine's is repeated under the pointer.
 *
 * WHERE IT STANDS
 *
 * In the utility slot over the stage (station-shell.js), like the hopper
 * info panel: laid over the machine's cell, inert to the pointer but for
 * the mark and the open card. The card opens upward from the mark, held
 * inside the slot; the Handbook's panel keeps the corners clear (its
 * clearance token), so the mark is never under it.
 *
 * WHAT IT NEVER DOES
 *
 * It reads no state and writes none: it says what the states mean, not
 * which hopper is in one. No bridge, no storage, no timers. Escape and a
 * click outside close it; the boot file gives Escape to the legend first
 * (station.js), since an open card is the nearest thing to leave.
 *
 * Node standard library only; the document comes in as an argument.
 */
(function (root, factory) {
  const parts = typeof require === "function"
    ? require("./station-machine-parts.js")
    : (root && root.PolynStationMachineParts);
  const api = factory(parts);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationLegend = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (parts) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* One hopper, in its own units, at the proportions the stage draws a
   * normal bank's hopper: the receiver over the vessel, the plate and
   * hose under it, the caption below. Every swatch is this hopper, so
   * the rows line up and a part is the same size in each. */
  const GEOMETRY = Object.freeze({
    id: "H", index: 0, layer: "L",
    x: 10, width: 24, pitch: 32,
    sourceY: 8,
    receiverTop: 14, receiverHeight: 12,
    vesselTop: 32, vesselHeight: 44, fillValveY: 36, vesselSectionHeight: 14,
    hoseWidth: 7,
    profiled: true,
    coneTop: 76, coneHeight: 8,
    spoutTop: 84, spoutHeight: 16,
    captionTop: 106, captionHeight: 36
  });
  const SWATCH_WIDTH = 44;

  /* The crops: which part of the hopper a row shows, as a viewBox in the
   * hopper's units. Each is the part that carries the state and a hair
   * around it, so the eye finds the same part on the stage. */
  const CROPS = Object.freeze({
    source: Object.freeze({ y: 0, height: 34 }),
    receiver: Object.freeze({ y: 10, height: 26 }),
    vessel: Object.freeze({ y: 30, height: 52 }),
    hose: Object.freeze({ y: 72, height: 52 }),
    caption: Object.freeze({ y: 96, height: 46 })
  });

  /* The states, in the order the equipment stacks - source, receiver,
   * vessel, hose, caption - so the legend reads down the hopper as the
   * stage draws it. `runtime` is the hopper state the swatch is built
   * with; `classes` are added on the group as the boot file adds them;
   * `geometry` overrides the hopper's own; `selected` is the drawing's
   * own option. The words are the whole of what the row says. */
  const ENTRIES = Object.freeze([
    Object.freeze({
      id: "source",
      term: "Source",
      note: "The number above a receiver is where its material is drawn from. Shown only where a source is set.",
      runtime: Object.freeze({ source: "26" }),
      crop: "source"
    }),
    Object.freeze({
      id: "pump-on",
      term: "Pump on",
      note: "An amber receiver is conveying. Click the receiver to stop its pump.",
      runtime: Object.freeze({}),
      crop: "receiver"
    }),
    Object.freeze({
      id: "pump-off",
      term: "Pump off",
      note: "A steel receiver, stepped back: the pump is stopped and the hose below runs empty. Click it to start the pump again.",
      runtime: Object.freeze({ pumpOff: true }),
      crop: "receiver"
    }),
    Object.freeze({
      id: "next-changes",
      term: "Next recipe changes this hopper",
      note: "A green cap: the planned Next recipe puts a different resin here, or empties it. Rest the pointer on the hopper to see which.",
      runtime: Object.freeze({ nextDiffers: true }),
      crop: "receiver"
    }),
    Object.freeze({
      id: "tracking",
      term: "Tracked",
      note: "Chevrons running down the vessel: this hopper's run-down is being timed on the timeline. Click the vessel to start or stop tracking.",
      runtime: Object.freeze({ track: true }),
      crop: "vessel"
    }),
    Object.freeze({
      id: "overdue",
      term: "Overdue",
      note: "A tracked vessel washed in the danger colour, its share under it in the same: the pump-off point has passed and the pump is still running.",
      runtime: Object.freeze({ track: true }),
      classes: Object.freeze(["is-overdue"]),
      crop: "vessel"
    }),
    Object.freeze({
      id: "selected",
      term: "Selected",
      note: "An outline in the accent: the hopper chosen in the open layer's editor, or by a click on the stage.",
      runtime: Object.freeze({}),
      selected: true,
      crop: "vessel"
    }),
    Object.freeze({
      id: "unprofiled",
      term: "No weight profile",
      note: "A dashed outline: the hopper is drawn at a default height because no Receiver Weight Profile gives it one, not because it is short.",
      runtime: Object.freeze({}),
      geometry: Object.freeze({ profiled: false }),
      crop: "vessel"
    }),
    Object.freeze({
      id: "unassigned",
      term: "No resin assigned",
      note: "A dark vessel, a clear hose and a faded caption: nothing is running in this hopper, whatever its pump is doing.",
      runtime: Object.freeze({ assigned: false }),
      crop: "hose"
    }),
    Object.freeze({
      id: "smart-weight",
      term: "Computed weight",
      note: "A weight in the Smart Hoppers colour was computed from the hopper's geometry and the resin's bulk density, not entered.",
      runtime: Object.freeze({ pct: 6, smartWeight: true, effectiveWeight: 156 }),
      crop: "caption"
    })
  ]);

  const FOOTNOTE = "Under each hopper: its id, its share of the layer's blend in the layer's colour, and the receiver weight it holds. Rest the pointer on a hopper for its resin and output.";

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

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    for (const key of Object.keys(attributes || {})) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  /* The swatch: the hopper drawn as the stage draws it, in the entry's
   * state, cropped to the entry's part. The interaction subtree - the
   * hit area and the two controls - is the drawing's first child; it is
   * removed, so the swatch has no click targets and no cursor. */
  function swatch(doc, entry) {
    const crop = CROPS[entry.crop] || CROPS.vessel;
    const svg = svgNode(doc, "svg", "station-legend__swatch", {
      viewBox: `0 ${crop.y} ${SWATCH_WIDTH} ${crop.height}`,
      preserveAspectRatio: "xMidYMid meet",
      "aria-hidden": "true",
      focusable: "false",
      "data-crop": entry.crop
    });
    if (!parts || typeof parts.hopper !== "function") return svg;
    const geometry = Object.assign({}, GEOMETRY, entry.geometry || {});
    const hopper = parts.hopper(doc, geometry, Object.assign({}, entry.runtime || {}), {
      scale: 1,
      selected: !!entry.selected
    });
    const first = hopper.firstChild;
    if (first && typeof first.getAttribute === "function" && first.getAttribute("data-role") === "hopper-interaction") {
      hopper.removeChild(first);
    }
    for (const cls of entry.classes || []) {
      hopper.setAttribute("class", `${hopper.getAttribute("class") || ""} ${cls}`.trim());
    }
    svg.appendChild(hopper);
    return svg;
  }

  /* The mark's glyph: a ring with the "i" on it, drawn here so it is in
   * the control's own colour and follows it through hover and focus. */
  function markGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-legend__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "circle", "station-legend__glyph-ring", { cx: 10, cy: 10, r: 8.25 }));
    svg.appendChild(svgNode(doc, "circle", "station-legend__glyph-dot", { cx: 10, cy: 6.4, r: 1.15 }));
    svg.appendChild(svgNode(doc, "path", "station-legend__glyph-stem", { d: "M 10 8.9 L 10 14.2" }));
    return svg;
  }

  /**
   * Build the legend: the mark and the card it opens.
   *
   * @param {Document} doc
   * @param {object} [options]
   * @param {function} [options.onOpenChange] told true/false as the card
   *        opens and closes
   * @returns {{ element: Element, mark: Element, panel: Element,
   *             show: function, hide: function, toggle: function, visible: function }}
   */
  function create(doc, options) {
    const settings = options || {};
    const container = element(doc, "div", "station-legend", { "data-role": "hopper-legend" });

    const panel = element(doc, "div", "station-legend__panel station-glass", {
      id: "station-legend",
      role: "region",
      "aria-label": "Hopper legend",
      hidden: ""
    });
    panel.appendChild(text(doc, "div", "station-legend__head", "Hopper states"));
    const list = element(doc, "dl", "station-legend__list");
    for (const entry of ENTRIES) {
      const row = element(doc, "div", "station-legend__row", { "data-state": entry.id });
      const term = element(doc, "dt", "station-legend__term");
      term.appendChild(swatch(doc, entry));
      term.appendChild(text(doc, "span", "station-legend__name", entry.term));
      row.appendChild(term);
      row.appendChild(text(doc, "dd", "station-legend__note", entry.note));
      list.appendChild(row);
    }
    panel.appendChild(list);
    panel.appendChild(text(doc, "p", "station-legend__foot", FOOTNOTE));

    const mark = element(doc, "button", "station-legend__mark", {
      type: "button",
      title: "Hopper legend",
      "aria-label": "Hopper legend",
      "aria-controls": "station-legend",
      "aria-expanded": "false"
    });
    mark.appendChild(markGlyph(doc));

    container.appendChild(panel);
    container.appendChild(mark);

    function visible() {
      return panel.getAttribute("hidden") === null;
    }

    function announce(open) {
      mark.setAttribute("aria-expanded", open ? "true" : "false");
      if (typeof settings.onOpenChange === "function") settings.onOpenChange(open);
    }

    function show() {
      if (visible()) return;
      panel.removeAttribute("hidden");
      announce(true);
    }

    function hide() {
      if (!visible()) return;
      panel.setAttribute("hidden", "");
      announce(false);
    }

    function toggle() {
      if (visible()) hide(); else show();
    }

    if (typeof mark.addEventListener === "function") {
      mark.addEventListener("click", event => {
        if (event && typeof event.preventDefault === "function") event.preventDefault();
        toggle();
      });
    }

    /* A press outside the legend closes it - on the machine, on the rail,
     * anywhere - so the card never has to be found and closed before the
     * stage is used again. The mark's own press is the toggle's. */
    if (doc && typeof doc.addEventListener === "function") {
      doc.addEventListener("pointerdown", event => {
        if (!visible()) return;
        const target = event ? event.target : null;
        if (target && typeof container.contains === "function" && container.contains(target)) return;
        hide();
      });
    }

    return { element: container, mark, panel, show, hide, toggle, visible };
  }

  return { GEOMETRY, CROPS, ENTRIES, FOOTNOTE, SWATCH_WIDTH, create };
});
