/* Composing the layer equipment view.
 *
 * This file assembles what station-machine-layout.js placed and
 * station-machine-parts.js shapes. It makes no geometry decisions and draws no
 * paths of its own; if something is in the wrong place the layout is wrong, and
 * if something is the wrong shape the parts file is wrong.
 *
 * WHAT IS DRAWN
 *
 * One bank per configured layer - hopper cluster, mixer, extruder - and nothing
 * downstream of the extruder. Convergence toward a shared die is implied by the
 * extruder angles, not drawn.
 *
 * WHY `doc` IS INJECTED
 *
 * The repo has no jsdom, and a renderer that can only run in a browser is a
 * renderer with no tests. Taking the document as an argument lets the suite
 * drive it with a small fake and count what was actually built - five banks for
 * a five-layer line, four hoppers where four are configured.
 */
(function (root, factory) {
  const deps = {
    layout: typeof require === "function" ? require("./station-machine-layout.js") : (root && root.PolynStationMachineLayout),
    parts: typeof require === "function" ? require("./station-machine-parts.js") : (root && root.PolynStationMachineParts)
  };
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationRender = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const machineLayout = deps.layout;
  const parts = deps.parts;
  const SVG_NS = parts.SVG_NS;

  /* The hopper's state classes. Kept here as well as in the hopper component
   * because callers outside the drawing (tests, and later the inspector) need
   * to ask what a given runtime state means without building SVG. */
  function hopperStateClasses(state) {
    const classes = ["station-hopper"];
    if (!state) return classes;
    if (state.track) classes.push("is-tracking");
    if (state.pumpOff) classes.push("is-pump-off");
    if (state.assigned === false) classes.push("is-unassigned");
    return classes;
  }

  /* Overall size, without building anything. */
  function stageMetrics(model, options) {
    const layout = machineLayout.computeLayout(model, options);
    if (!layout) return null;
    return {
      width: layout.width,
      height: layout.height,
      rowWidth: layout.row.width,
      rowX: layout.row.x,
      bankCount: layout.banks.length,
      focusLayer: layout.focusLayer || null
    };
  }

  /**
   * Build the layer equipment view for a model into a fresh <svg>.
   *
   * @param {object} model
   * @param {object} [options]
   * @param {Document} [options.document]
   * @param {object} [options.hopperState]  runtime state by "<layer>:<index>"
   * @param {object} [options.layerState]   per-layer state by layer id
   * @param {string} [options.focusLayer]   layer to expand, or null
   * @param {string} [options.selectedTarget] "cluster" | "mixer" | "extruder"
   * @param {object} [options.dimensions]   layout overrides
   */
  function renderStage(model, options) {
    const settings = options || {};
    const doc = settings.document || (typeof document !== "undefined" ? document : null);
    if (!doc) throw new Error("station-render: no document available");
    if (!model) return null;

    const layout = machineLayout.computeLayout(model, {
      focusLayer: settings.focusLayer || null,
      // Hopper bodies are drawn to their Receiver Weight Profile height, so
      // the layout needs the runtime state too - not just the renderer.
      hopperState: settings.hopperState || null,
      dimensions: settings.dimensions
    });
    if (!layout) return null;

    const svg = parts.node(doc, "svg", "station-machine__stage", {
      viewBox: `0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": `${model.line.displayName}: ${model.line.layerCount} layer extrusion train`,
      "data-layer-count": model.line.layerCount,
      "data-focus-layer": layout.focusLayer || null
    });

    const row = parts.group(doc, "station-machine__row", "layer-row");
    for (const bank of layout.banks) {
      row.appendChild(parts.layerBank(doc, bank, settings.hopperState, settings.layerState, {
        selectedTarget: bank.id === layout.focusLayer ? settings.selectedTarget : null,
        showHint: settings.showHint
      }));
    }
    svg.appendChild(row);
    return svg;
  }

  function clear(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  /**
   * Replace a mount point's contents with the machine for `model`.
   * Renders an explicit empty state rather than nothing when the model is null,
   * so a line that cannot be described reads as "not configured" instead of
   * "broken" - and never as demo data.
   */
  function mountStage(mount, model, options) {
    if (!mount) return null;
    const settings = options || {};
    const doc = settings.document || mount.ownerDocument || (typeof document !== "undefined" ? document : null);
    clear(mount);
    if (!model) {
      const empty = doc.createElement("p");
      empty.setAttribute("class", "station-machine__empty");
      empty.textContent = "This line has no known layer configuration, so its equipment cannot be drawn.";
      mount.appendChild(empty);
      mount.setAttribute("data-layer-count", "0");
      mount.removeAttribute("data-focus-layer");
      return null;
    }
    const svg = renderStage(model, {
      document: doc,
      hopperState: settings.hopperState,
      layerState: settings.layerState,
      focusLayer: settings.focusLayer,
      selectedTarget: settings.selectedTarget,
      showHint: settings.showHint,
      dimensions: settings.dimensions
    });
    mount.appendChild(svg);
    mount.setAttribute("data-layer-count", String(model.line.layerCount));
    if (settings.focusLayer) mount.setAttribute("data-focus-layer", settings.focusLayer);
    else mount.removeAttribute("data-focus-layer");
    return svg;
  }

  return {
    SVG_NS,
    DIMENSIONS: machineLayout.DIMENSIONS,
    hopperStateClasses,
    stageMetrics,
    renderStage,
    mountStage,
    clear
  };
});
