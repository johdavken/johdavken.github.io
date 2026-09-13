/* Equipment Lab - a development-only review, not part of the product.
 *
 * WHY IT EXISTS
 *
 * The mixer and extruder artwork is derived from authored assets
 * (images/mixer/, images/extruder/) by the tools in tools/station-mixer/ and
 * tools/station-extruder/: the extruder is reduced and relabelled, the mixer
 * carried whole and recoloured through classes. The only way to judge that
 * is to see the source and the derivative side by side, large - and then to
 * see the derivative at the size it is actually drawn, because a detail
 * that survives review at 400px may be a smudge at 60. This page shows
 * both, for both machines, and finishes with the five-layer assembly at
 * actual Station size.
 *
 * IT IS THE SAME COMPONENT. Every derivative below is drawn by
 * PolynStationMachineParts.mixer() / .extruder() placed by
 * PolynStationMachineLayout.assetPlacement(), from the same asset modules the
 * stage uses. There is no lab-only artwork and no second renderer. The
 * originals are shown as plain <img> of the untouched source files.
 *
 * REMOVING IT
 *
 * Delete this file, its <script> tag in station/station.html, and the
 * `labRequested()` branch in station/station.js. Nothing else refers to it,
 * and it is never loaded by station-host.js - so the real application cannot
 * reach it at all.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationExtruderLab = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* Where the untouched sources live, relative to station/station.html. */
  const ORIGINALS = Object.freeze({
    mixer: "../images/mixer",
    extruder: "../images/extruder"
  });

  function element(doc, name, className, attributes) {
    const el = doc.createElement(name);
    if (className) el.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) el.setAttribute(key, String(attributes[key]));
    return el;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function caption(doc, text) {
    const el = element(doc, "figcaption", "station-lab__caption");
    el.textContent = text;
    return el;
  }

  /* The two machines, described the same way so the page treats them the
   * same way. */
  function machines(deps) {
    return [
      {
        name: "mixer", assets: deps.mixerAssets,
        draw: (doc, id, placement) => deps.parts.mixer(doc, { id, mixer: placement })
      },
      {
        name: "extruder", assets: deps.extruderAssets,
        draw: (doc, id, placement) => deps.parts.extruder(doc, { id, extruder: placement }, 20)
      }
    ];
  }

  /* One derivative, drawn by the product's builder into its own <svg>, sized
   * to its own bounds. `scale` is the placement scale, so the stage's numbers
   * are the numbers here - scale 1 is the actual Station size. */
  function specimen(doc, deps, machine, view, mirrored, scale, margin) {
    const asset = machine.assets.views[view];
    const placement = deps.layout.assetPlacement(view, mirrored, asset, { centerX: 0, anchorY: 0, scale });
    const b = placement.bounds;
    const pad = margin === undefined ? 8 : margin;
    const width = b.right - b.left + pad * 2;
    const height = b.bottom - b.top + pad * 2 + (machine.name === "extruder" ? 18 : 0);
    const svg = deps.parts.node(doc, "svg", "station-machine__stage station-lab__specimen", {
      viewBox: `${round(b.left - pad)} ${round(b.top - pad)} ${round(width)} ${round(height)}`,
      width: round(width),
      height: round(height),
      "data-machine": machine.name,
      "data-view": view,
      "data-mirrored": mirrored ? "true" : "false",
      role: "img",
      "aria-label": `${machine.name} ${view} view${mirrored ? ", mirrored" : ""} at ${scale}x`
    });
    // The anchor line, so where the machine connects is visible.
    svg.appendChild(deps.parts.node(doc, "line", "station-lab__centreline", {
      x1: 0, y1: round(b.top - pad), x2: 0, y2: round(b.bottom + pad)
    }));
    // Wrapped in a running layer so the rotor turns here as it does on stage.
    const layer = deps.parts.group(doc, "station-layer is-running", "lab-layer");
    layer.appendChild(machine.draw(doc, `LAB-${machine.name}-${view}${mirrored ? "-m" : ""}`, placement));
    svg.appendChild(layer);
    return svg;
  }

  /* One layer's whole train - mixer on extruder - placed exactly as the
   * layout places it, at scale 1. */
  function assembly(doc, deps, index, layerCount) {
    const [mixer, extruder] = machines(deps);
    const facing = deps.layout.equipmentView(index, layerCount);
    const mixerAsset = mixer.assets.views[facing.view];
    const mixerPlacement = deps.layout.assetPlacement(facing.view, facing.mirrored, mixerAsset, {
      centerX: 0, anchorY: -mixerAsset.bounds.top, scale: 1
    });
    const d = deps.layout.DIMENSIONS;
    const extruderPlacement = deps.layout.assetPlacement(facing.view, facing.mirrored, extruder.assets.views[facing.view], {
      centerX: 0, anchorY: mixerPlacement.outlet.y + d.mixerFeedGap, scale: 1
    });
    // The throat between them, exactly as the layout builds it.
    const throat = {
      x: -d.throatWidth / 2, y: mixerPlacement.outlet.y, width: d.throatWidth, height: d.mixerFeedGap, centerX: 0,
      shadow: { cx: 0, cy: extruderPlacement.anchor.y, rx: d.throatShadowRx, ry: d.throatShadowRy }
    };
    const left = Math.min(mixerPlacement.bounds.left, extruderPlacement.bounds.left) - 6;
    const right = Math.max(mixerPlacement.bounds.right, extruderPlacement.bounds.right) + 6;
    const bottom = extruderPlacement.label.y + 6;
    const svg = deps.parts.node(doc, "svg", "station-machine__stage station-lab__specimen", {
      viewBox: `${round(left)} -6 ${round(right - left)} ${round(bottom + 6)}`,
      width: round(right - left),
      height: round(bottom + 6),
      "data-view": facing.view,
      "data-mirrored": facing.mirrored ? "true" : "false",
      role: "img",
      "aria-label": `${facing.key} assembly at 1x`
    });
    const layer = deps.parts.group(doc, "station-layer is-running", "lab-layer");
    const id = `LAB-${facing.key}`;
    layer.appendChild(extruder.draw(doc, id, extruderPlacement));
    layer.appendChild(deps.parts.throat(doc, { id, throat }));
    layer.appendChild(mixer.draw(doc, id, mixerPlacement));
    svg.appendChild(layer);
    return { svg, facing };
  }

  /**
   * @param {Document} doc
   * @param {object} deps  { layout, parts, mixerAssets, extruderAssets }
   * @param {object} [options]  { originals, reviewScale }
   */
  function render(doc, deps, options) {
    const settings = options || {};
    const originals = Object.assign({}, ORIGINALS, settings.originals || {});
    const reviewScale = settings.reviewScale || 2.4;

    const lab = element(doc, "div", "station-lab", { "data-role": "lab" });
    const heading = element(doc, "h2", "station-lab__title");
    heading.textContent = "Equipment: original asset vs Station derivative";
    lab.appendChild(heading);

    /* ---- One row per machine per view: original, derivative, mirrored ---- */
    for (const machine of machines(deps)) {
      for (const view of machine.assets.ORDER) {
        const asset = machine.assets.views[view];
        const row = element(doc, "section", "station-lab__row", {
          "data-role": "lab-row", "data-machine": machine.name, "data-view": view
        });

        const original = element(doc, "figure", "station-lab__cell station-lab__cell--original");
        original.appendChild(element(doc, "img", "station-lab__original", {
          src: `${originals[machine.name]}/${machine.name}-${view}.svg`,
          alt: `Original ${view} ${machine.name} asset`
        }));
        original.appendChild(caption(doc, `original ${machine.name} · ${view} · ${asset.yaw}°`));
        row.appendChild(original);

        const derived = element(doc, "figure", "station-lab__cell station-lab__cell--derived");
        derived.appendChild(specimen(doc, deps, machine, view, false, reviewScale));
        derived.appendChild(caption(doc,
          `Station derivative · ${asset.polygons.length} faces · ${reviewScale}x`));
        row.appendChild(derived);

        const mirrored = element(doc, "figure", "station-lab__cell station-lab__cell--derived");
        mirrored.appendChild(specimen(doc, deps, machine, view, true, reviewScale));
        mirrored.appendChild(caption(doc, "mirrored · left of centre"));
        row.appendChild(mirrored);

        lab.appendChild(row);
      }
    }

    /* ---- The five-layer assembly at actual Station size ----
     * The test that matters. Anything that has to be squinted at here goes. */
    const strip = element(doc, "section", "station-lab__row station-lab__row--scale", { "data-role": "lab-strip" });
    const layerCount = 5;
    for (let index = 0; index < layerCount; index++) {
      const { svg, facing } = assembly(doc, deps, index, layerCount);
      const cell = element(doc, "figure", "station-lab__cell station-lab__cell--scale");
      cell.appendChild(svg);
      cell.appendChild(caption(doc, `${facing.key} · 1x`));
      strip.appendChild(cell);
    }
    lab.appendChild(strip);

    return lab;
  }

  function mount(host, doc, deps, options) {
    if (!host) return null;
    while (host.firstChild) host.removeChild(host.firstChild);
    const lab = render(doc, deps, options);
    host.appendChild(lab);
    host.setAttribute("data-station-lab", "extruder");
    return lab;
  }

  return { SVG_NS, ORIGINALS, render, mount };
});
