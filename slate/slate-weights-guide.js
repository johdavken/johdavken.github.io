/* Hopper Weights Configuration: how a hopper's weight becomes a pump-off
 * time, and how Smart Hoppers works that weight out.
 *
 * Opened from How to Use's "Good to know" (slate-guide.js), in the same
 * aside place, for whoever wants the specifics. It starts simple and works
 * up: the line rate split by layer and hopper, the time to empty and the
 * pump-off time, the receiver weight, then Smart Hoppers - the hopper's
 * volume from its inside diameter (or circumference) and its height from
 * the floor to the fill valve (or its gallons), times the resin's bulk density - and why a
 * resin's density alone cannot stand in for bulk density. Every formula
 * is the application's own (station-rundown.js, calculators.js,
 * bulk-density-measurement.js; slate-weights-guide.test.js checks the
 * worked numbers against them). Three drawings where words are slow: the
 * split, the hopper and the pellets.
 *
 * A way back to How to Use (ctx.guide) at the top, and the head's close
 * hands the aside back to the Timeline (ctx.back). It reads nothing and
 * dispatches nothing.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynSlateWeightsGuide = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TITLE = "Hopper Weights Configuration";
  const CLOSE_LABEL = "Back to the Timeline";
  const BACK_LABEL = "← How to Use";
  const SVG = "http://www.w3.org/2000/svg";

  /* The worked example, carried through every section so each number can
   * be followed from the one before. */
  const EXAMPLE = Object.freeze({
    lineRate: 850,          // lb/hr
    layerPct: 50,           // layer B's share
    hopperPct: 20,          // B2's share of layer B
    diameter: 15,           // in, inside wall to inside wall, shared by the line's hoppers
    height: 36,             // in, floor to fill valve
    gallons: 25,            // a volume-measured line's hopper
    bulkDensity: 35,        // lb/ft³, measured
    solidDensity: 0.918,    // g/cm³, the resin's own density
    waterLb: 32,            // the bucket, full of water
    resinLb: 18,            // the same bucket, level-full of resin
    changeover: "9:00 PM"
  });

  const WATER_LB_FT3 = 62.43;
  const GALLON_FT3 = 0.133681;

  /* The example's numbers, worked as the application works them. */
  function worked() {
    const e = EXAMPLE;
    const layerLbHr = e.lineRate * (e.layerPct / 100);
    const hopperLbHr = layerLbHr * (e.hopperPct / 100);
    const circumference = Math.PI * e.diameter;
    const cubicInches = Math.PI * (e.diameter / 2) ** 2 * e.height;
    const cubicFeet = cubicInches / 1728;
    const weight = cubicFeet * e.bulkDensity;
    const hours = weight / hopperLbHr;
    const gallonFeet = e.gallons * GALLON_FT3;
    const gallonWeight = gallonFeet * e.bulkDensity;
    const solidLbFt3 = e.solidDensity * WATER_LB_FT3;
    const measured = (e.resinLb / e.waterLb) * WATER_LB_FT3;
    return { layerLbHr, hopperLbHr, circumference, cubicInches, cubicFeet, weight, hours, gallonFeet, gallonWeight, solidLbFt3, packing: e.bulkDensity / solidLbFt3, measured };
  }

  function round(value, places) {
    const factor = 10 ** (places || 0);
    return (Math.round(value * factor) / factor).toLocaleString("en-US", { minimumFractionDigits: places || 0, maximumFractionDigits: places || 0 });
  }

  function clock(hours) {
    const minutes = Math.round(hours * 60);
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
  }

  /* The sections, in order: each a heading and blocks - p (words),
   * formula (the rule, then the example worked), drawing, list. */
  function sections() {
    const e = EXAMPLE;
    const w = worked();
    return [
      {
        title: "1. The line rate, split",
        blocks: [
          { p: "Every pound the line makes comes from the hoppers. The line rate is split first by layer, then by hopper within the layer." },
          { formula: ["layer lb/hr = line rate × layer %", "hopper lb/hr = layer lb/hr × hopper %"],
            worked: `${e.lineRate} lb/hr × ${e.layerPct}% = ${round(w.layerLbHr)} lb/hr for layer B; × ${e.hopperPct}% = ${round(w.hopperLbHr)} lb/hr through B2.` },
          { drawing: "split" },
          { p: "The layer percentages add to 100 across the line, and each layer's hopper percentages add to 100 within it. Hopper 1 takes whatever the others leave: H1 = 100 − (H2 + H3 + …)." }
        ]
      },
      {
        title: "2. Time to empty, and when to turn the pump off",
        blocks: [
          { p: "With the pump off, a hopper feeds only what is already in its receiver. How long that lasts is its weight over its rate." },
          { formula: ["hours to empty = weight ÷ hopper lb/hr", "turn the pump off at = changeover − hours to empty"],
            worked: `${round(w.weight)} lb ÷ ${round(w.hopperLbHr)} lb/hr = ${clock(w.hours)}. With the changeover at ${e.changeover}, turn B2's pump off about ${clock(w.hours)} before it.` },
          { p: "So the receiver runs out at the changeover, not before it: the weight counts only what the receiver is sure to hold (section 3), so any more feeds a little past. The weight is the one number the whole schedule hangs on." }
        ]
      },
      {
        title: "3. The weight",
        blocks: [
          { p: "It is the resin a receiver is sure to hold: filled to its fill valve. The loader calls for resin when the level falls below the valve, so there is usually more above it, but how much is never known - the weight counts only up to the valve, the least the receiver holds. Enter it on the Weights page, or let Smart Hoppers work it out." },
          { p: "An entered weight is right for one resin. The same receiver holds more of a heavy-packing resin and less of a light one, so on a line that changes resins often a single weight drifts wrong." }
        ]
      },
      {
        title: "4. Smart Hoppers: volume × bulk density",
        blocks: [
          { p: "Smart Hoppers measures the hopper once and weighs the resin by what it is: the space the resin fills, times how many pounds of that resin fill a cubic foot." },
          { formula: ["weight = volume (ft³) × bulk density (lb/ft³)"] },
          { p: "Where the volume comes from is set per line, in Line Configuration: Diameter & height, or Capacity. Both end in a volume; they differ in what you measure." },
          { p: "Diameter & height, for a line of round receivers: the receiver's size - one figure for the line, since its receivers match - and each hopper's height." },
          { drawing: "hopper" },
          { list: [
            "Diameter (D): with the lid off, from inside wall to inside wall across the centre, in inches - swing the tape and take the widest reading. Inside is what the resin fills, so no wall to allow for.",
            "Or circumference (C): a tape around the outside. It includes the steel wall, so it reads a little large - about 0.8 in on an ⅛ in wall, some 3% more volume. The Weights page takes either: choose Diameter or Circumference beside the field.",
            "Height (h): from the floor of the receiver to the fill valve, in inches. Resin usually stands above the valve too, but that amount is unknown, so the height stops at the valve: the least the hopper holds."
          ] },
          { formula: ["volume (in³) = 0.7854 × D² × h", "  or with C: C² × h ÷ (4π)", "volume (ft³) = in³ ÷ 1,728"],
            worked: `0.7854 × ${e.diameter}² × ${e.height} = ${round(w.cubicInches)} in³ = ${round(w.cubicFeet, 2)} ft³; × ${e.bulkDensity} lb/ft³ = ${round(w.weight)} lb.` },
          { p: `(Both are the circle's area times the height: πr², the radius being D ÷ 2 - or C ÷ 2π. A ${e.diameter} in diameter is a ${round(w.circumference, 1)} in circumference; the line stores the circumference either way.)` },
          { p: "Capacity, for receivers of any shape: each hopper carries its capacity in gallons up to the fill valve - the maker's figure, or measured - and the volume is that:" },
          { formula: ["volume (ft³) = gallons × 0.1337"],
            worked: `${e.gallons} gal × 0.1337 = ${round(w.gallonFeet, 2)} ft³; × ${e.bulkDensity} lb/ft³ = ${round(w.gallonWeight)} lb.` },
          { p: "Where Smart Hoppers cannot work a weight out - no height or diameter yet, or a resin with no measured bulk density - it uses the entered weight. The Weights page shows which one each hopper is using." }
        ]
      },
      {
        title: "5. Why the resin's density is not enough",
        blocks: [
          { p: "A resin's datasheet density (say 0.918 g/cm³) is the plastic itself: a solid block, no gaps. Pellets in a hopper are not a block - there is air between them." },
          { drawing: "pellets" },
          { formula: ["solid lb/ft³ = density (g/cm³) × 62.43", "bulk density = solid lb/ft³ × packing"],
            worked: `${e.solidDensity} × 62.43 = ${round(w.solidLbFt3, 1)} lb/ft³ solid; measured bulk density ${e.bulkDensity} lb/ft³, so only ${round(w.packing * 100)}% of the hopper is plastic.` },
          { p: "That share - the packing - depends on the pellet: its size, its shape, how round or flat, how it settles. Two resins of the same density can pack very differently, so no single factor turns density into bulk density safely. Guess it 10% wrong and every weight, and every pump-off time, is 10% wrong. So Smart Hoppers uses only a measured bulk density." }
        ]
      },
      {
        title: "6. Measuring bulk density",
        blocks: [
          { p: "It takes a bucket and a scale - nothing to measure volume with. Weigh the bucket full of water once; then fill the same bucket level with the resin and weigh it. Water is 62.43 lb/ft³, so:" },
          { formula: ["bulk density = resin lb ÷ water lb × 62.43"],
            worked: `${e.resinLb} lb ÷ ${e.waterLb} lb × 62.43 = ${round(w.measured, 1)} lb/ft³.` },
          { p: "Use net weights - the bucket's own weight taken off - and fill it as the hopper fills: poured, not packed down. An administrator keeps the measured figure with the resin in the Resin Database, for every line to use." }
        ]
      },
      {
        title: "7. When the numbers are off",
        blocks: [
          { p: "If a hopper runs dry before its time, press Ran out on its row at the Timeline's foot. From when the pump went off and when it ran out, Slate works out what the hopper actually held and corrects it: the entered weight, or under Smart Hoppers the height (or gallons), so the next run-down is on time." },
          { p: "If several hoppers run out early by about the same share, the weights are probably fine and the line rate is set too high: check the Line rate card first." }
        ]
      }
    ];
  }

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  function text(doc, name, className, value, attributes) {
    const node = element(doc, name, className, attributes);
    node.textContent = value;
    return node;
  }

  function svg(doc, name, attributes, content) {
    const node = typeof doc.createElementNS === "function" ? doc.createElementNS(SVG, name) : doc.createElement(name);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    if (content !== undefined) node.textContent = content;
    return node;
  }

  /* The split: the line's rate as a bar, layer B's half of it, B2's fifth
   * of that - each bar as wide as its pounds. */
  function splitDrawing(doc) {
    const w = worked();
    const e = EXAMPLE;
    const figure = svg(doc, "svg", { class: "slate-wguide__drawing", viewBox: "0 0 260 124", role: "img", "aria-label": `${e.lineRate} lb/hr split to ${round(w.layerLbHr)} for the layer and ${round(w.hopperLbHr)} for the hopper` });
    const full = 240;
    const rows = [
      ["line", `Line  ${e.lineRate} lb/hr`, full],
      ["layer", `Layer B  ${e.layerPct}% → ${round(w.layerLbHr)}`, full * e.layerPct / 100],
      ["hopper", `B2  ${e.hopperPct}% → ${round(w.hopperLbHr)}`, full * e.layerPct / 100 * e.hopperPct / 100]
    ];
    rows.forEach(([kind, label, width], i) => {
      // The label's baseline, clear of the top edge; its bar under it.
      const y = 16 + i * 36;
      figure.appendChild(svg(doc, "text", { class: "slate-wguide__label", x: 10, y }, label));
      figure.appendChild(svg(doc, "rect", { class: `slate-wguide__bar is-${kind}`, x: 10, y: y + 6, width: Math.max(width, 4), height: 14, rx: 3 }));
    });
    return figure;
  }

  /* The receiver: a cylinder filled with pellets to its fill valve, the
   * height measured from its floor to the valve, the circumference around
   * it. */
  function hopperDrawing(doc) {
    const figure = svg(doc, "svg", { class: "slate-wguide__drawing", viewBox: "0 0 260 200", role: "img", "aria-label": "A receiver: the height from its floor to the fill valve, the diameter across its inside" });
    // The loader and its fill valve above the receiver.
    figure.appendChild(svg(doc, "rect", { class: "slate-wguide__steel", x: 104, y: 6, width: 52, height: 18, rx: 3 }));
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__note", x: 164, y: 19 }, "loader"));
    figure.appendChild(svg(doc, "path", { class: "slate-wguide__valve", d: "M118 30h24l-6 10h-12Z" }));
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__note is-strong", x: 148, y: 33 }, "fill valve"));
    // The receiver: resin up to the valve.
    figure.appendChild(svg(doc, "rect", { class: "slate-wguide__resin", x: 80, y: 44, width: 100, height: 120 }));
    figure.appendChild(svg(doc, "path", { class: "slate-wguide__steel-line", d: "M80 44v120M180 44v120" }));
    figure.appendChild(svg(doc, "ellipse", { class: "slate-wguide__rim", cx: 130, cy: 44, rx: 50, ry: 8 }));
    figure.appendChild(svg(doc, "path", { class: "slate-wguide__steel-line", d: "M80 164a50 8 0 0 0 100 0" }));
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__note", x: 186, y: 172 }, "floor"));
    // Diameter: across the open top, inside wall to inside wall.
    figure.appendChild(svg(doc, "path", { class: "slate-wguide__measure", d: "M82 58h96M82 53v10M178 53v10" }));
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__measure-label", x: 130, y: 74, "text-anchor": "middle" }, "D  inside"));
    // Height: floor to valve.
    figure.appendChild(svg(doc, "path", { class: "slate-wguide__measure", d: "M60 44v120M54 44h12M54 164h12" }));
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__measure-label", x: 50, y: 108, "text-anchor": "end" }, "h"));
    // The blender below.
    figure.appendChild(svg(doc, "path", { class: "slate-wguide__steel-line", d: "M110 172v14h40v-14" }));
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__note", x: 130, y: 197, "text-anchor": "middle" }, "to the blender"));
    return figure;
  }

  /* Solid versus bulk: a block of plastic beside a box of pellets, the air
   * between them showing. */
  function pelletsDrawing(doc) {
    const figure = svg(doc, "svg", { class: "slate-wguide__drawing", viewBox: "0 0 260 116", role: "img", "aria-label": "Solid plastic beside pellets with air between them" });
    figure.appendChild(svg(doc, "rect", { class: "slate-wguide__solid", x: 14, y: 12, width: 84, height: 70, rx: 4 }));
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__label", x: 56, y: 100, "text-anchor": "middle" }, "density: solid"));
    figure.appendChild(svg(doc, "rect", { class: "slate-wguide__box", x: 150, y: 12, width: 84, height: 70, rx: 4 }));
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 6; col += 1) {
        const offset = row % 2 ? 7 : 0;
        const cx = 158 + col * 13.5 + offset;
        if (cx > 229) continue;
        figure.appendChild(svg(doc, "ellipse", { class: "slate-wguide__pellet", cx, cy: 20 + row * 13.5, rx: 5.6, ry: 4.6 }));
      }
    }
    figure.appendChild(svg(doc, "text", { class: "slate-wguide__label", x: 192, y: 100, "text-anchor": "middle" }, "bulk: pellets + air"));
    return figure;
  }

  const DRAWINGS = Object.freeze({ split: splitDrawing, hopper: hopperDrawing, pellets: pelletsDrawing });

  /**
   * @param {Document} doc
   * @param {object} [ctx]
   * @param {function} [ctx.back]   hand the aside back to the Timeline
   * @param {function} [ctx.guide]  go back to How to Use
   */
  function create(doc, ctx) {
    const settings = ctx || {};
    const back = typeof settings.back === "function" ? settings.back : () => {};
    const guide = typeof settings.guide === "function" ? settings.guide : null;

    const rootEl = element(doc, "section", "slate-panel slate-guide slate-wguide", { "aria-label": TITLE });
    const head = element(doc, "div", "slate-panel__head");
    head.appendChild(text(doc, "h2", "slate-panel__title", TITLE));
    const close = element(doc, "button", "slate-panel__close", { type: "button", "aria-label": CLOSE_LABEL, title: CLOSE_LABEL, "data-slate-back": "" });
    close.appendChild(text(doc, "span", "slate-panel__close-glyph", "×", { "aria-hidden": "true" }));
    close.addEventListener("click", () => back());
    head.appendChild(close);
    rootEl.appendChild(head);

    const body = element(doc, "div", "slate-guide__body");
    if (guide) {
      const toGuide = text(doc, "button", "slate-guide__link", BACK_LABEL, { type: "button", "data-slate-guide": "back" });
      toGuide.addEventListener("click", () => guide());
      body.appendChild(toGuide);
    }
    body.appendChild(text(doc, "p", "slate-guide__caption", "How a hopper's weight becomes a pump-off time, and how Smart Hoppers works that weight out. One example runs through it all."));
    for (const section of sections()) {
      const block = element(doc, "section", "slate-wguide__section");
      block.appendChild(text(doc, "h3", "slate-wguide__heading", section.title));
      for (const item of section.blocks) {
        if (item.p) block.appendChild(text(doc, "p", "slate-guide__text", item.p));
        if (item.formula) {
          const formula = element(doc, "div", "slate-wguide__formula");
          for (const line of item.formula) formula.appendChild(text(doc, "code", "slate-wguide__rule", line));
          if (item.worked) formula.appendChild(text(doc, "p", "slate-wguide__worked", item.worked));
          block.appendChild(formula);
        }
        if (item.drawing && DRAWINGS[item.drawing]) block.appendChild(DRAWINGS[item.drawing](doc));
        if (item.list) {
          const list = element(doc, "ul", "slate-wguide__list");
          for (const entry of item.list) list.appendChild(text(doc, "li", "slate-guide__text", entry));
          block.appendChild(list);
        }
      }
      body.appendChild(block);
    }
    rootEl.appendChild(body);

    return Object.freeze({ element: rootEl });
  }

  return Object.freeze({ TITLE, CLOSE_LABEL, BACK_LABEL, EXAMPLE, WATER_LB_FT3, GALLON_FT3, worked, sections, create });
});
