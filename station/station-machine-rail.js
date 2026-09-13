/* The machine utility rail: a short stack of icon controls standing at the
 * outer edge of the far-right hopper cluster, for the operations that act
 * on the live machine as a whole.
 *
 * WHAT IT IS
 *
 * Four controls, and nothing else for now:
 *
 *   Blend Edit       the mode's one switch. On: every layer turns over to
 *                    its compact blend card (station.js owns the mode; the
 *                    rail only asks). On again: the mode ends along its one
 *                    exit, every layer back as hoppers. The control shows
 *                    the mode's state as its own.
 *   Weights          the other mode's switch: every layer turns over to
 *                    its weight card (station-weight-cards.js) - the
 *                    receiver weights, and with Smart Hoppers on the
 *                    geometry each is computed from. The two modes share
 *                    one stage: one is on, or neither. The control shows
 *                    the mode's state as its own.
 *   Smart Hoppers    the application's device-local switch: weights
 *                    computed from hopper geometry and each resin's bulk
 *                    density, or the entered weights. Not a mode of the
 *                    stage - it acts on every hopper at once, in every
 *                    view - so it stands here with the other operations
 *                    over the whole machine. The boot file asks the
 *                    application (one setSmartHoppers) and tells the rail
 *                    what the application then holds; held with the
 *                    reason when this desktop is not on an identified
 *                    line, or the command is not offered.
 *   Reset Tracking   every hopper untracked and its pump marked running -
 *                    the floor UI's Reset tracking, as the one resetTracking
 *                    command (station-hopper-controls.js). A reset is easy
 *                    to do by accident and slow to undo by hand, so it is
 *                    two clicks in place: the first ARMS the control, which
 *                    says so and waits; the second confirms. A pause, a
 *                    click anywhere else, Escape or the focus leaving all
 *                    disarm it. No dialog.
 *
 * WHERE IT STANDS
 *
 * Beside the machine, not above it: the rail stands along the outer
 * edge of whichever bank is furthest right - a strip the height of that
 * bank's card box (the hoppers' column, or the blend card that takes its
 * place), spaced a little off its edge, with the controls stacked from
 * its top - so it reads as a fitting on that bank rather than as a
 * toolbar of the page:
 *
 *     +----------------------+
 *     | hopper / blend card  |  |o
 *     |                      |  |o   utility rail
 *     |                      |  |
 *     +----------------------+
 *
 * The stage is an SVG scaled to fit its cell, so that edge is measured,
 * not assumed: every drawn bank declares its card box in canvas units
 * (data-object-card, from the layout), the SVG declares its viewBox, and
 * anchor() maps the far-right box through the scale-to-fit arithmetic
 * (xMidYMid meet) onto the rail's host. The boot file asks for a placement after every render of the
 * normal layout and whenever the stage's cell resizes; nothing here
 * watches anything. The stage's geometry is never touched: the rail lives
 * in its own slot over the stage's cell (station-shell.js, shell.css) and
 * moves no hopper, adds no height and covers no drawn part of the
 * machine.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: what each control was last told to show, and
 * whether the reset is armed, with the timer and the click-away listener
 * that disarm it. It reads no job, keeps no mode of its own and dispatches
 * nothing: every click is handed to the boot file through the callbacks
 * it was built with, and what the stage then shows is the boot file's to
 * tell it (update()).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationMachineRail = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* How long an armed reset waits for its confirming click. */
  const ARM_DURATION = 5000;
  /* The gap between the card box's outer edge and the rail, and the least
   * the rail keeps from its host's edges when the bank stands too near
   * one. Screen pixels: the rail is not part of the drawing and does not
   * scale with it. The fallback box is four controls and the gaps between. */
  const GAP = 10;
  const EDGE = 4;
  /* The rail's box before it has been measured (a host that cannot
   * measure, or a rail not yet laid out): the control size the stylesheet
   * sets, two of them and the gap between - the least height the strip
   * is ever given. */
  const FALLBACK_SIZE = Object.freeze({ width: 36, height: 162 });

  const LABEL = Object.freeze({ blend: "Blend Edit", weights: "Weights", smart: "Smart Hoppers", reset: "Reset Tracking" });

  function element(doc, name, className, attributes) {
    const node = doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  function svgNode(doc, name, className, attributes) {
    const node = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) node.setAttribute("class", className);
    if (attributes) for (const key of Object.keys(attributes)) node.setAttribute(key, String(attributes[key]));
    return node;
  }

  /* --------------------------------------------------------------------
   *   The two glyphs
   * ------------------------------------------------------------------
   * Drawn here, 20 by 20, in the control's own colour (machine-rail.css)
   * so each follows its control through hover, focus, active and armed.
   * No image asset, no glyph from a font. */

  /* Blend Edit: a card turning over. The face in front carries three
   * short rows - a blend, as the compact card lists one - and the face
   * behind it stands a little up and to the right, so the two read as
   * front and back of one card mid-turn; a small arrow over the top says
   * which way it goes. */
  function blendGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-back", { x: 7.5, y: 2.5, width: 10, height: 12, rx: 1.5 }));
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-face", { x: 2.5, y: 5.5, width: 10, height: 12, rx: 1.5 }));
    for (const [index, width] of [[0, 5], [1, 3.5], [2, 5]].values()) {
      const y = 9 + index * 2.6;
      svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: `M 5 ${y} L ${5 + width} ${y}` }));
    }
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 14 0.9 L 16 2.5 L 14 4.1" }));
    return svg;
  }

  /* Reset Tracking: a circular arrow - the reset - around a hopper, drawn
   * as the stage draws one: a vessel that narrows to its outlet. The
   * arrow is open at the top right, where its head is, so it reads as a
   * turn back and not as a page reloading. */
  function resetGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 16.6 8.2 A 7 7 0 1 0 17 10.8" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 17.4 4.4 L 17 8.6 L 12.8 8.2" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-hopper", { d: "M 7.2 7.4 L 12.8 7.4 L 11.4 11.6 L 10.8 13.6 L 9.2 13.6 L 8.6 11.6 Z" }));
    return svg;
  }

  /* Weights: a weight of the kind set on a scale - a block, wider at
   * its foot, with the loop of a handle over it. */
  function weightsGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 7.4 6.2 A 2.6 2.6 0 0 1 12.6 6.2" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 6.2 6.6 L 13.8 6.6 L 16 17 L 4 17 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: "M 7.6 13.5 L 12.4 13.5" }));
    return svg;
  }

  /* Smart Hoppers: a hopper as the stage draws one, with the ticks of a
   * gauge up its side - the measure a weight is computed from - and a
   * small spark above its rim for the computing. */
  function smartGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-hopper", { d: "M 4.6 5.4 L 15.4 5.4 L 12.8 13.6 L 11.6 17 L 8.4 17 L 7.2 13.6 Z" }));
    for (const [index, width] of [[0, 3], [1, 2.4], [2, 1.8]].values()) {
      const y = 7.6 + index * 2.6;
      const x = 6 + index * 0.8;
      svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: `M ${x} ${y} L ${x + width} ${y}` }));
    }
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 16.4 1 L 16.4 4.2 M 14.8 2.6 L 18 2.6" }));
    return svg;
  }

  /* --------------------------------------------------------------------
   *   Placement
   * ------------------------------------------------------------------ */

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  /* The four numbers of a box attribute, "x y width height", as the
   * layout wrote them. Null for anything else. */
  function parseBox(text) {
    const parts = String(text || "").trim().split(/\s+/).map(Number);
    if (parts.length !== 4 || !parts.every(finite)) return null;
    return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
  }

  /* What the drawn stage declares: its viewBox, and for every bank in the
   * normal layout the box its upper half takes - the card's footprint
   * (data-object-card: the cluster's column widened to the bank), which
   * is the same with the hoppers showing as with the card out, so the
   * rail stands still when the mode turns a layer over. A drawing that
   * declares no card box (an older renderer) is read by its cluster box.
   * A focused or dimmed bank is not read - the rail is not placed against
   * the focused layout. */
  function readStage(svg) {
    if (!svg || typeof svg.getAttribute !== "function") return null;
    const viewBox = String(svg.getAttribute("viewBox") || "").trim().split(/\s+/).map(Number);
    if (viewBox.length !== 4 || !viewBox.every(finite) || viewBox[2] <= 0 || viewBox[3] <= 0) return null;
    const clusters = [];
    const layers = typeof svg.querySelectorAll === "function" ? svg.querySelectorAll("[data-role='layer']") : [];
    for (const layer of layers) {
      if (layer.getAttribute("data-emphasis") !== "normal") continue;
      const box = parseBox(layer.getAttribute("data-object-card")) || parseBox(layer.getAttribute("data-object-cluster"));
      if (box) clusters.push(box);
    }
    return { viewBox: { width: viewBox[2], height: viewBox[3] }, clusters };
  }

  /**
   * Where the rail stands, in its host's pixels: a strip along the far
   * right box's outer edge, its top and height the box's own.
   *
   * @param {object} input
   * @param {object} input.viewBox   { width, height } in canvas units
   * @param {Array}  input.clusters  [{ x, y, width, height }] in canvas units
   * @param {object} input.stage     the SVG element's client rect
   * @param {object} input.host      the rail host's client rect
   * @param {object} input.rail      { width, height } of the rail's controls, px
   * @param {number} [input.gap]     px between the box and the rail
   * @param {number} [input.edge]    px the rail keeps from the host's edges
   * @returns {{ left: number, top: number, height: number }|null}  null
   *          when there is nothing to stand beside
   */
  function anchor(input) {
    const settings = input || {};
    const vb = settings.viewBox;
    const stage = settings.stage;
    const host = settings.host;
    const rail = settings.rail || FALLBACK_SIZE;
    const clusters = Array.isArray(settings.clusters) ? settings.clusters : [];
    if (!vb || !stage || !host || !clusters.length) return null;
    if (!(vb.width > 0 && vb.height > 0 && stage.width > 0 && stage.height > 0)) return null;
    const gap = finite(settings.gap) ? settings.gap : GAP;
    const edge = finite(settings.edge) ? settings.edge : EDGE;
    // xMidYMid meet: one scale, the smaller, and the drawing centred in
    // whichever dimension has room to spare.
    const scale = Math.min(stage.width / vb.width, stage.height / vb.height);
    const offsetX = (stage.width - vb.width * scale) / 2;
    const offsetY = (stage.height - vb.height * scale) / 2;
    // The box standing furthest right; its top and its height are the
    // rail's, and the strip is never shorter than its controls.
    let far = clusters[0];
    for (const box of clusters) if (box.x + box.width > far.x + far.width) far = box;
    const right = (far.x + far.width) * scale + offsetX + (stage.left - host.left);
    const boxTop = far.y * scale + offsetY + (stage.top - host.top);
    const height = Math.max(far.height * scale, rail.height);
    let left = right + gap;
    let top = boxTop;
    // Never past the host's edges: a bank drawn to the very edge of its
    // cell puts the rail against that edge rather than outside it.
    left = Math.min(left, host.width - rail.width - edge);
    left = Math.max(left, edge);
    top = Math.max(top, edge);
    top = Math.min(top, Math.max(edge, host.height - height - edge));
    return { left: Math.round(left), top: Math.round(top), height: Math.round(height) };
  }

  /* --------------------------------------------------------------------
   *   The rail
   * ------------------------------------------------------------------ */

  /**
   * Build the rail.
   *
   * @param {Document} doc
   * @param {object} options
   * @param {function} options.onBlendEdit      () => void; the click, whichever
   *        way the mode is going - the boot file toggles and tells the rail
   * @param {function} [options.onWeightsEdit]  () => void; the same for the Weights mode
   * @param {function} [options.onSmartHoppers] () => void; the switch's click - the
   *        boot file asks the application and tells the rail what it holds
   * @param {function} options.onResetTracking  () => void; the confirming click
   * @param {function} [options.setTimeout]     for the arm timer; the host's by default
   * @param {function} [options.clearTimeout]
   * @param {number}   [options.armDuration]    ms an armed reset waits
   * @param {function} [options.measure]        (element) => client rect
   */
  function create(doc, options) {
    const settings = options || {};
    const onBlendEdit = typeof settings.onBlendEdit === "function" ? settings.onBlendEdit : () => {};
    const onWeightsEdit = typeof settings.onWeightsEdit === "function" ? settings.onWeightsEdit : () => {};
    const onSmartHoppers = typeof settings.onSmartHoppers === "function" ? settings.onSmartHoppers : () => {};
    const onResetTracking = typeof settings.onResetTracking === "function" ? settings.onResetTracking : () => {};
    const timers = {
      set: typeof settings.setTimeout === "function" ? settings.setTimeout : (typeof setTimeout === "function" ? setTimeout : null),
      clear: typeof settings.clearTimeout === "function" ? settings.clearTimeout : (typeof clearTimeout === "function" ? clearTimeout : null)
    };
    const armDuration = finite(settings.armDuration) && settings.armDuration >= 0 ? settings.armDuration : ARM_DURATION;
    const measure = typeof settings.measure === "function"
      ? settings.measure
      : el => (el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null);

    const state = {
      hidden: true,
      withdrawn: false,
      blend: { active: false, available: false },
      weights: { active: false, available: false },
      smart: { on: false, available: false, reason: "" },
      reset: { available: false, reason: "", count: 0 },
      armed: false,
      timer: null,
      placed: null
    };

    const rootEl = element(doc, "div", "station-rail", { "data-role": "machine-rail", role: "group", "aria-label": "Machine utilities", hidden: "" });

    const blendButton = element(doc, "button", "station-rail__control station-rail__control--blend", {
      type: "button", "data-action": "blend-edit", "aria-pressed": "false", "aria-label": LABEL.blend, title: LABEL.blend
    });
    blendButton.appendChild(blendGlyph(doc));
    const weightsButton = element(doc, "button", "station-rail__control station-rail__control--weights", {
      type: "button", "data-action": "weights-edit", "aria-pressed": "false", "aria-label": LABEL.weights, title: LABEL.weights
    });
    weightsButton.appendChild(weightsGlyph(doc));
    const smartButton = element(doc, "button", "station-rail__control station-rail__control--smart", {
      type: "button", role: "switch", "data-action": "smart-hoppers", "aria-checked": "false", "aria-label": LABEL.smart, title: LABEL.smart
    });
    smartButton.appendChild(smartGlyph(doc));
    const resetButton = element(doc, "button", "station-rail__control station-rail__control--reset", {
      type: "button", "data-action": "reset-tracking", "aria-label": LABEL.reset, title: LABEL.reset
    });
    resetButton.appendChild(resetGlyph(doc));
    rootEl.appendChild(blendButton);
    rootEl.appendChild(weightsButton);
    rootEl.appendChild(smartButton);
    rootEl.appendChild(resetButton);

    /* ---- Drawing what it was told ---- */

    function draw() {
      if (state.hidden) rootEl.setAttribute("hidden", "");
      else rootEl.removeAttribute("hidden");
      rootEl.classList.toggle("is-withdrawn", state.withdrawn);
      rootEl.classList.toggle("is-blend-active", state.blend.active);
      rootEl.classList.toggle("is-weights-active", state.weights.active);

      blendButton.setAttribute("aria-pressed", state.blend.active ? "true" : "false");
      blendButton.classList.toggle("is-active", state.blend.active);
      blendButton.disabled = !state.blend.available && !state.blend.active;
      blendButton.setAttribute("title", state.blend.active
        ? `${LABEL.blend} · on — click to finish and show every hopper`
        : (state.blend.available ? LABEL.blend : `${LABEL.blend} needs a line with layers on the stage`));

      weightsButton.setAttribute("aria-pressed", state.weights.active ? "true" : "false");
      weightsButton.classList.toggle("is-active", state.weights.active);
      weightsButton.disabled = !state.weights.available && !state.weights.active;
      weightsButton.setAttribute("title", state.weights.active
        ? `${LABEL.weights} · on — click to finish and show every hopper`
        : (state.weights.available ? `${LABEL.weights} · receiver weights and hopper geometry, on every layer` : `${LABEL.weights} needs a line with layers on the stage`));

      smartButton.setAttribute("aria-checked", state.smart.on ? "true" : "false");
      smartButton.classList.toggle("is-on", state.smart.on);
      smartButton.disabled = !state.smart.available;
      smartButton.setAttribute("title", !state.smart.available
        ? `${LABEL.smart} is not available: ${state.smart.reason || "no application is connected to Station commands."}`
        : (state.smart.on
          ? `${LABEL.smart} · on — weights computed from hopper geometry and each resin's bulk density; click to use the entered weights`
          : `${LABEL.smart} · off — click to compute weights from hopper geometry and each resin's bulk density`));

      const count = state.reset.count;
      const hoppers = `${count} hopper${count === 1 ? "" : "s"}`;
      resetButton.disabled = !state.reset.available || count === 0;
      resetButton.classList.toggle("is-armed", state.armed);
      if (state.armed) resetButton.setAttribute("data-armed", "true");
      else resetButton.removeAttribute("data-armed");
      resetButton.setAttribute("aria-label", state.armed ? `Confirm: reset tracking for ${hoppers}` : LABEL.reset);
      resetButton.setAttribute("title", state.armed
        ? `Click again to reset tracking · ${hoppers} untracked, pumps marked running`
        : (!state.reset.available
          ? `${LABEL.reset} is not available: ${state.reset.reason || "no application is connected to Station commands."}`
          : (count === 0 ? `${LABEL.reset} · nothing is tracked` : `${LABEL.reset} · ${hoppers}`)));
    }

    /* ---- Arming the reset ---- */

    function onDocumentPointerDown(event) {
      const target = event && event.target;
      if (target && typeof resetButton.contains === "function" && resetButton.contains(target)) return;
      disarm();
    }

    function disarm() {
      if (!state.armed) return false;
      state.armed = false;
      if (state.timer !== null && timers.clear) timers.clear(state.timer);
      state.timer = null;
      if (typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      draw();
      return true;
    }

    function arm() {
      if (state.armed) return false;
      state.armed = true;
      if (timers.set && armDuration > 0) state.timer = timers.set(() => { state.timer = null; disarm(); }, armDuration);
      if (typeof doc.addEventListener === "function") doc.addEventListener("pointerdown", onDocumentPointerDown, true);
      draw();
      return true;
    }

    blendButton.addEventListener("click", () => {
      disarm();
      onBlendEdit();
    });
    weightsButton.addEventListener("click", () => {
      disarm();
      onWeightsEdit();
    });
    smartButton.addEventListener("click", () => {
      if (smartButton.disabled) return;
      disarm();
      onSmartHoppers();
    });
    resetButton.addEventListener("click", () => {
      if (resetButton.disabled) return;
      if (!state.armed) { arm(); return; }
      disarm();
      onResetTracking();
    });
    resetButton.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !state.armed) return;
      if (typeof event.stopPropagation === "function") event.stopPropagation();
      if (typeof event.preventDefault === "function") event.preventDefault();
      disarm();
    });
    resetButton.addEventListener("blur", () => { disarm(); });

    /* ---- The surface ---- */

    /**
     * Tell the rail what to show.
     *
     * @param {object} next
     * @param {boolean} [next.hidden]     no line on the stage: nothing to stand beside
     * @param {boolean} [next.withdrawn]  a layer is open: the rail steps back
     * @param {object}  [next.blend]      { active, available }
     * @param {object}  [next.weights]    { active, available }
     * @param {object}  [next.smart]      { on, available, reason }
     * @param {object}  [next.reset]      { available, reason, count }
     */
    function update(next) {
      const n = next || {};
      if (typeof n.hidden === "boolean") state.hidden = n.hidden;
      if (typeof n.withdrawn === "boolean") state.withdrawn = n.withdrawn;
      if (n.blend && typeof n.blend === "object") {
        state.blend = {
          active: !!n.blend.active,
          available: !!n.blend.available
        };
      }
      if (n.weights && typeof n.weights === "object") {
        state.weights = {
          active: !!n.weights.active,
          available: !!n.weights.available
        };
      }
      if (n.smart && typeof n.smart === "object") {
        state.smart = {
          on: !!n.smart.on,
          available: !!n.smart.available,
          reason: typeof n.smart.reason === "string" ? n.smart.reason : ""
        };
      }
      if (n.reset && typeof n.reset === "object") {
        state.reset = {
          available: !!n.reset.available,
          reason: typeof n.reset.reason === "string" ? n.reset.reason : "",
          count: Number.isInteger(n.reset.count) && n.reset.count > 0 ? n.reset.count : 0
        };
      }
      // A reset that stopped being possible while armed is not armed.
      if (state.armed && (!state.reset.available || state.reset.count === 0 || state.hidden || state.withdrawn)) disarm();
      else draw();
    }

    /**
     * Stand beside the far-right cluster of the drawn stage.
     *
     * @param {Element} svg   the mounted stage
     * @param {Element} host  the rail's slot, which the rail is positioned in
     * @returns {{left, top}|null} what was applied, or null when the stage
     *          declares nothing to stand beside (the rail keeps its place)
     */
    function place(svg, host) {
      const read = readStage(svg);
      if (!read || !host) return null;
      const stageRect = measure(svg);
      const hostRect = measure(host);
      const railRect = measure(rootEl);
      const size = railRect && railRect.width > 0 && railRect.height > 0 ? railRect : FALLBACK_SIZE;
      const at = anchor({ viewBox: read.viewBox, clusters: read.clusters, stage: stageRect, host: hostRect, rail: size });
      if (!at) return null;
      state.placed = at;
      rootEl.style.left = `${at.left}px`;
      rootEl.style.top = `${at.top}px`;
      rootEl.style.height = `${at.height}px`;
      rootEl.classList.add("is-placed");
      return at;
    }

    draw();

    return {
      element: rootEl,
      blendButton,
      weightsButton,
      smartButton,
      resetButton,
      update,
      place,
      disarm,
      isArmed: () => state.armed,
      getState: () => ({
        hidden: state.hidden, withdrawn: state.withdrawn, armed: state.armed,
        blend: Object.assign({}, state.blend), weights: Object.assign({}, state.weights),
        smart: Object.assign({}, state.smart), reset: Object.assign({}, state.reset),
        placed: state.placed ? Object.assign({}, state.placed) : null
      })
    };
  }

  return Object.freeze({ ARM_DURATION, GAP, EDGE, LABEL, FALLBACK_SIZE, blendGlyph, weightsGlyph, smartGlyph, resetGlyph, parseBox, readStage, anchor, create });
});
