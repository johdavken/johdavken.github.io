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
   * @param {string} [options.selectedHopper] the selected hopper's id, on the open layer
   * @param {Element} [options.workspace]   HTML content for the focus workspace
   * @param {string} [options.raiseLayer]    layer to paint last (in transit)
   * @param {number} [options.stageAspect]  the stage's width/height, for the focus canvas
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
      dimensions: settings.dimensions,
      stageAspect: settings.stageAspect
    });
    if (!layout) return null;

    /* A drawing, until the workspace holds an editor - then it is a region
     * with controls in it, and an image role would hide them from
     * assistive technology. */
    const svg = parts.node(doc, "svg", "station-machine__stage", {
      viewBox: `0 0 ${Math.round(layout.width)} ${Math.round(layout.height)}`,
      preserveAspectRatio: "xMidYMid meet",
      role: layout.workspace && settings.workspace ? "group" : "img",
      "aria-label": `${model.line.displayName}: ${model.line.layerCount} layer extrusion train`,
      "data-layer-count": model.line.layerCount,
      "data-focus-layer": layout.focusLayer || null
    });

    /* The reserved workspace goes down first: it is a surface the focused
     * layer's objects sit in front of, never something they pass behind. */
    if (layout.workspace) svg.appendChild(parts.workspace(doc, layout.workspace, settings.workspace || null));

    const row = parts.group(doc, "station-machine__row", "layer-row");
    /* Paint order is the layout's: in focus mode the dimmed banks go down
     * first so the focused one is on top of anything it overlaps. A layer in
     * TRANSIT (`raiseLayer`) is painted last whatever the layout says, so a
     * layer travelling home through the normal row passes over its
     * neighbours rather than behind them. */
    let order = layout.paintOrder || layout.banks.map((_, index) => index);
    const raised = settings.raiseLayer ? layout.banks.findIndex(bank => bank.id === settings.raiseLayer) : -1;
    if (raised >= 0) order = order.filter(index => index !== raised).concat([raised]);
    for (const index of order) {
      const bank = layout.banks[index];
      row.appendChild(parts.layerBank(doc, bank, settings.hopperState, settings.layerState, {
        selectedTarget: bank.id === layout.focusLayer ? settings.selectedTarget : null,
        selectedHopper: bank.id === layout.focusLayer ? settings.selectedHopper || null : null,
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

  /* --------------------------------------------------------------------
   *   Patching a mounted stage
   * ------------------------------------------------------------------
   * The bridge publishes on every committed change, and most of those are
   * values - a weight, a tracking toggle, a resin on another device - not
   * structure. Rebuilding the stage for a value throws away the focused
   * editor with its open search and its focus, so a value-only change is
   * applied to the drawing that is already mounted:
   *
   *   - a hopper whose runtime facts changed is drawn again by the same
   *     builder that drew it, and swapped for the old group in place - so
   *     a patched stage and a fresh one are the same drawing;
   *   - a layer's running state and its extruder's share are updated on
   *     the elements that carry them;
   *   - everything else, the workspace and its <foreignObject> above all,
   *     is not touched.
   *
   * Which hoppers changed is read off the data-state each group carries,
   * not off any state held here: the renderer owns no state between calls.
   *
   * Works on element children and attributes only, so it runs against the
   * same small fake document the rest of the renderer is tested with. */

  function childrenOf(node) {
    return node && node.children ? Array.from(node.children) : [];
  }

  function attributeOf(node, name) {
    return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
  }

  function findAll(node, predicate, out) {
    const found = out || [];
    for (const child of childrenOf(node)) {
      if (predicate(child)) found.push(child);
      findAll(child, predicate, found);
    }
    return found;
  }

  function hasClass(node, name) {
    return String(attributeOf(node, "class") || "").split(/\s+/).includes(name);
  }

  function setClass(node, name, on) {
    const classes = String(attributeOf(node, "class") || "").split(/\s+/).filter(Boolean);
    const has = classes.includes(name);
    if (on && !has) classes.push(name);
    if (!on && has) classes.splice(classes.indexOf(name), 1);
    node.setAttribute("class", classes.join(" "));
  }

  /**
   * Update the mounted stage in place from new runtime state.
   *
   * Takes the same model and options renderStage takes, so a patched stage
   * shows exactly what a fresh render of the same inputs would. Returns a
   * count of what was touched, or null when there is no stage to patch
   * (nothing mounted, no model, or a mounted structure that does not match
   * the model's) - in which case the caller should render instead.
   *
   * @param {Element} mount
   * @param {object} model
   * @param {object} [options]  hopperState, layerState, focusLayer,
   *        selectedHopper, dimensions, stageAspect - as for renderStage
   */
  function patchStage(mount, model, options) {
    if (!mount || !model) return null;
    const settings = options || {};
    const doc = settings.document || mount.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return null;
    const layout = machineLayout.computeLayout(model, {
      focusLayer: settings.focusLayer || null,
      hopperState: settings.hopperState || null,
      dimensions: settings.dimensions,
      stageAspect: settings.stageAspect
    });
    if (!layout) return null;

    const layers = {};
    for (const el of findAll(mount, node => attributeOf(node, "data-role") === "layer")) {
      layers[attributeOf(el, "data-layer")] = el;
    }
    if (layout.banks.some(bank => !layers[bank.id])) return null;

    const hopperState = settings.hopperState || null;
    const layerState = settings.layerState || null;
    let hoppers = 0;

    for (const bank of layout.banks) {
      const layerEl = layers[bank.id];
      const running = bank.cluster.hoppers.some(h => {
        const runtime = hopperState ? hopperState[`${bank.id}:${h.index}`] : null;
        return !!(runtime && runtime.resinName);
      });
      setClass(layerEl, "is-running", running);

      const cluster = findAll(layerEl, node => attributeOf(node, "data-role") === "hopper-cluster")[0];
      if (!cluster) return null;
      const drawn = {};
      for (const el of childrenOf(cluster)) {
        if (attributeOf(el, "data-role") === "hopper") drawn[attributeOf(el, "data-hopper-index")] = el;
      }
      for (const geometry of bank.cluster.hoppers) {
        const old = drawn[String(geometry.index)];
        if (!old) return null;
        const runtime = hopperState ? hopperState[`${bank.id}:${geometry.index}`] : null;
        if (attributeOf(old, "data-state") === parts.hopperStateKey(runtime)) continue;
        const fresh = parts.hopper(doc, Object.assign({ layer: bank.id }, geometry), runtime, {
          scale: bank.scale,
          selected: bank.id === layout.focusLayer && !!settings.selectedHopper && settings.selectedHopper === geometry.id
        });
        // Presentation the boot file put on the old group, carried over so
        // the pointer does not lose its place.
        if (hasClass(old, "is-highlighted")) setClass(fresh, "is-highlighted", true);
        cluster.replaceChild(fresh, old);
        hoppers += 1;
      }

      const share = findAll(layerEl, node => hasClass(node, "station-extruder__pct"))[0];
      if (share) {
        share.textContent = parts.shareText(layerState && layerState[bank.id] ? layerState[bank.id].layerPct : null);
      }
    }
    return { hoppers, layers: layout.banks.length };
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
    /* The focus canvas takes the stage's shape, so it is measured here -
     * once, before anything is built or animated. The mount's size does not
     * depend on what is drawn in it. */
    const stageAspect = settings.stageAspect !== undefined
      ? settings.stageAspect
      : (mount.clientWidth > 0 && mount.clientHeight > 0 ? mount.clientWidth / mount.clientHeight : undefined);
    const svg = renderStage(model, {
      document: doc,
      hopperState: settings.hopperState,
      layerState: settings.layerState,
      focusLayer: settings.focusLayer,
      selectedTarget: settings.selectedTarget,
      selectedHopper: settings.selectedHopper,
      workspace: settings.workspace,
      raiseLayer: settings.raiseLayer,
      showHint: settings.showHint,
      dimensions: settings.dimensions,
      stageAspect
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
    patchStage,
    clear
  };
});
