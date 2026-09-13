/* The machine utility rail: a short stack of icon controls standing at the
 * outer edge of the far-right hopper cluster, for the operations that act
 * on the live machine as a whole.
 *
 * WHAT IT IS
 *
 * Five controls standing always, and two more while the Next face is on:
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
 *                    view - but it is the Weights face's concern, so it
 *                    stands as that switch's child: in a flyout to the
 *                    right of Weights, unfolded while that face is on,
 *                    exactly as the Next switch's two moves are. The boot
 *                    file asks the application (one setSmartHoppers) and
 *                    tells the rail what the application then holds; held
 *                    with the reason when this desktop is not on an
 *                    identified line, or the command is not offered.
 *   Reset Tracking   every hopper untracked and its pump marked running -
 *                    the floor UI's Reset tracking, as the one resetTracking
 *                    command (station-hopper-controls.js). A reset is easy
 *                    to do by accident and slow to undo by hand, so it is
 *                    two clicks in place: the first ARMS the control, which
 *                    says so and waits; the second confirms. A pause, a
 *                    click anywhere else, Escape or the focus leaving all
 *                    disarm it. No dialog.
 *   Next             the mode's third face: every layer turns over to a
 *                    blend card of the PLANNED recipe - the Next Recipe the
 *                    application keeps beside the running one - edited
 *                    through the same card, addressed to the plan. A dot
 *                    on the control says a plan exists. It stands under
 *                    Blend Edit, the running recipe's face. While this face
 *                    is on, two more controls unfold to its RIGHT, on a
 *                    stem from the switch, as its children - the flyout
 *                    (station-rail__flyout), which opens and folds with a
 *                    short motion the stylesheet owns:
 *   Load Next        the plan becomes the running recipe - the floor UI's
 *                    Load Next Recipe, as one promoteNextRecipe command
 *                    (station-plan-controls.js). Armed and confirmed
 *                    exactly as the reset is; the armed control's title
 *                    says what the promotion changes, in counts.
 *   Copy Current     the running recipe becomes the plan - Load Current
 *                    Recipe, as one copyCurrentToNext. One click: the plan
 *                    it overwrites is a draft, and the title says so.
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

  const LABEL = Object.freeze({
    blend: "Blend Edit", weights: "Weights", smart: "Smart Hoppers", reset: "Reset Tracking",
    next: "Next Recipe", promote: "Load Next into Current", copy: "Copy Current into Next"
  });

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

  /* Next: the card as the Blend glyph draws it, but standing alone and
   * dog-eared - a sheet waiting its turn - with the three rows of a blend
   * on it. */
  function nextGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 5 2.5 L 12 2.5 L 15.5 6 L 15.5 17.5 L 5 17.5 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 12 2.5 L 12 6 L 15.5 6" }));
    for (const [index, width] of [[0, 5], [1, 3.5], [2, 5]].values()) {
      const y = 9.2 + index * 2.6;
      svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: `M 7.5 ${y} L ${7.5 + width} ${y}` }));
    }
    svg.appendChild(svgNode(doc, "circle", "station-rail__glyph-dot", { cx: 16.2, cy: 3.8, r: 2.2 }));
    return svg;
  }

  /* Load Next: the sheet moving onto the machine - an arrow from a small
   * sheet at the top right down onto a hopper at the bottom left. */
  function promoteGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 11.5 1.5 L 16 1.5 L 18 3.5 L 18 9 L 11.5 9 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 12 11 L 7.5 15.5 M 7.5 11.5 L 7.5 15.5 L 11.5 15.5" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-hopper", { d: "M 1.6 10.4 L 7.2 10.4 L 5.8 14.6 L 5.2 16.6 L 3.6 16.6 L 3 14.6 Z" }));
    return svg;
  }

  /* Copy Current: the reverse - a hopper at the top left, an arrow up
   * onto the sheet at the bottom right. */
  function copyGlyph(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: "0 0 20 20", width: "20", height: "20", "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-hopper", { d: "M 1.6 2.4 L 7.2 2.4 L 5.8 6.6 L 5.2 8.6 L 3.6 8.6 L 3 6.6 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 7.5 9 L 12 4.5 M 8 4.5 L 12 4.5 L 12 8.5" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 11.5 11 L 16 11 L 18 13 L 18 18.5 L 11.5 18.5 Z" }));
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
   * @param {function} [options.onNextEdit]     () => void; the Next face's switch
   * @param {function} [options.onPromote]      () => void; Load Next's confirming click
   * @param {function} [options.onCopy]         () => void; Copy Current's click
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
    const onNextEdit = typeof settings.onNextEdit === "function" ? settings.onNextEdit : () => {};
    const onPromote = typeof settings.onPromote === "function" ? settings.onPromote : () => {};
    const onCopy = typeof settings.onCopy === "function" ? settings.onCopy : () => {};
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
      next: { active: false, available: false, planned: false },
      promote: { available: false, reason: "", summary: "" },
      copy: { available: false, reason: "" },
      /* Which control is armed - "reset" or "promote" - or null: one at a
       * time, whichever was clicked last. */
      armed: null,
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
    const nextButton = element(doc, "button", "station-rail__control station-rail__control--next", {
      type: "button", "data-action": "next-edit", "aria-pressed": "false", "aria-label": LABEL.next, title: LABEL.next
    });
    nextButton.appendChild(nextGlyph(doc));
    const promoteButton = element(doc, "button", "station-rail__control station-rail__control--promote", {
      type: "button", "data-action": "promote-next", "aria-label": LABEL.promote, title: LABEL.promote
    });
    promoteButton.appendChild(promoteGlyph(doc));
    const copyButton = element(doc, "button", "station-rail__control station-rail__control--copy", {
      type: "button", "data-action": "copy-current", "aria-label": LABEL.copy, title: LABEL.copy
    });
    copyButton.appendChild(copyGlyph(doc));
    /* The Next switch and its two children as one group: the switch in
     * the rail's column, the flyout beside it to the right - out of the
     * column's flow, so the rail's width and placement are the column's
     * alone. Closed, the flyout is out of the tab order and the reader's
     * tree (inert, hidden by visibility once its motion has ended). */
    function group(role, parent, label, children) {
      const wrapper = element(doc, "div", `station-rail__group station-rail__group--${role}`, { "data-role": `${role}-group`, "data-open": "false" });
      const fly = element(doc, "div", "station-rail__flyout", { role: "group", "aria-label": label, "data-open": "false", inert: "", "aria-hidden": "true" });
      for (const child of children) fly.appendChild(child);
      wrapper.appendChild(parent);
      wrapper.appendChild(fly);
      return { wrapper, fly };
    }
    const nextParts = group("next", nextButton, "Next Recipe actions", [promoteButton, copyButton]);
    const nextGroup = nextParts.wrapper;
    const flyout = nextParts.fly;
    /* The Weights switch and Smart Hoppers the same way: the switch's one
     * child, unfolded while the Weights face is on. */
    const weightsParts = group("weights", weightsButton, "Weights actions", [smartButton]);
    const weightsGroup = weightsParts.wrapper;
    const weightsFlyout = weightsParts.fly;
    rootEl.appendChild(blendButton);
    rootEl.appendChild(nextGroup);
    rootEl.appendChild(weightsGroup);
    rootEl.appendChild(resetButton);

    function unfold(wrapper, fly, open) {
      wrapper.setAttribute("data-open", open ? "true" : "false");
      fly.setAttribute("data-open", open ? "true" : "false");
      if (open) { fly.removeAttribute("inert"); fly.setAttribute("aria-hidden", "false"); }
      else { fly.setAttribute("inert", ""); fly.setAttribute("aria-hidden", "true"); }
    }

    /* ---- Drawing what it was told ---- */

    function draw() {
      if (state.hidden) rootEl.setAttribute("hidden", "");
      else rootEl.removeAttribute("hidden");
      rootEl.classList.toggle("is-withdrawn", state.withdrawn);
      rootEl.classList.toggle("is-blend-active", state.blend.active);
      rootEl.classList.toggle("is-weights-active", state.weights.active);
      rootEl.classList.toggle("is-next-active", state.next.active);
      if (state.next.active) rootEl.setAttribute("data-face", "next");
      else rootEl.removeAttribute("data-face");

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

      nextButton.setAttribute("aria-pressed", state.next.active ? "true" : "false");
      nextButton.classList.toggle("is-active", state.next.active);
      nextButton.classList.toggle("is-planned", state.next.planned);
      nextButton.disabled = !state.next.available && !state.next.active;
      nextButton.setAttribute("title", state.next.active
        ? `${LABEL.next} · on — click to finish and show every hopper`
        : (state.next.available
          ? `${LABEL.next} · ${state.next.planned ? "a recipe is planned: edit it on every layer" : "nothing is planned yet: plan the next run on every layer"}`
          : `${LABEL.next} needs a line with layers on the stage`));

      // The two moves unfold beside the switch only while the Next face is
      // on; Smart Hoppers beside Weights only while that face is.
      unfold(nextGroup, flyout, state.next.active);
      unfold(weightsGroup, weightsFlyout, state.weights.active);
      const promoteArmed = state.armed === "promote";
      promoteButton.disabled = !state.promote.available || !state.next.planned;
      promoteButton.classList.toggle("is-armed", promoteArmed);
      if (promoteArmed) promoteButton.setAttribute("data-armed", "true");
      else promoteButton.removeAttribute("data-armed");
      promoteButton.setAttribute("aria-label", promoteArmed ? `Confirm: load the planned recipe into Current · ${state.promote.summary}` : LABEL.promote);
      promoteButton.setAttribute("title", promoteArmed
        ? `Click again to load the plan into Current · ${state.promote.summary} · receiver weights, tracking and pump state stay with their hoppers; the plan is kept`
        : (!state.promote.available
          ? `${LABEL.promote} is not available: ${state.promote.reason || "no application is connected to Station commands."}`
          : (!state.next.planned ? `${LABEL.promote} · nothing is planned` : `${LABEL.promote} · ${state.promote.summary || "the plan becomes the running recipe"}`)));
      copyButton.disabled = !state.copy.available;
      copyButton.setAttribute("title", !state.copy.available
        ? `${LABEL.copy} is not available: ${state.copy.reason || "no application is connected to Station commands."}`
        : `${LABEL.copy} · the running recipe becomes the plan${state.next.planned ? ", replacing what is planned" : ""}; the running job is untouched`);

      const count = state.reset.count;
      const hoppers = `${count} hopper${count === 1 ? "" : "s"}`;
      const resetArmed = state.armed === "reset";
      resetButton.disabled = !state.reset.available || count === 0;
      resetButton.classList.toggle("is-armed", resetArmed);
      if (resetArmed) resetButton.setAttribute("data-armed", "true");
      else resetButton.removeAttribute("data-armed");
      resetButton.setAttribute("aria-label", resetArmed ? `Confirm: reset tracking for ${hoppers}` : LABEL.reset);
      resetButton.setAttribute("title", resetArmed
        ? `Click again to reset tracking · ${hoppers} untracked, pumps marked running`
        : (!state.reset.available
          ? `${LABEL.reset} is not available: ${state.reset.reason || "no application is connected to Station commands."}`
          : (count === 0 ? `${LABEL.reset} · nothing is tracked` : `${LABEL.reset} · ${hoppers}`)));
    }

    /* ---- Arming a control: the reset, or the promotion ---- */

    function armedButton() {
      return state.armed === "promote" ? promoteButton : resetButton;
    }

    function onDocumentPointerDown(event) {
      const target = event && event.target;
      const button = armedButton();
      if (target && typeof button.contains === "function" && button.contains(target)) return;
      disarm();
    }

    function disarm() {
      if (!state.armed) return false;
      state.armed = null;
      if (state.timer !== null && timers.clear) timers.clear(state.timer);
      state.timer = null;
      if (typeof doc.removeEventListener === "function") doc.removeEventListener("pointerdown", onDocumentPointerDown, true);
      draw();
      return true;
    }

    function arm(which) {
      if (state.armed === which) return false;
      if (state.armed) disarm();
      state.armed = which;
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
      if (state.armed !== "reset") { arm("reset"); return; }
      disarm();
      onResetTracking();
    });
    nextButton.addEventListener("click", () => {
      disarm();
      onNextEdit();
    });
    promoteButton.addEventListener("click", () => {
      if (promoteButton.disabled) return;
      if (state.armed !== "promote") { arm("promote"); return; }
      disarm();
      onPromote();
    });
    copyButton.addEventListener("click", () => {
      if (copyButton.disabled) return;
      disarm();
      onCopy();
    });
    for (const button of [resetButton, promoteButton]) {
      button.addEventListener("keydown", event => {
        if (event.key !== "Escape" || !state.armed) return;
        if (typeof event.stopPropagation === "function") event.stopPropagation();
        if (typeof event.preventDefault === "function") event.preventDefault();
        disarm();
      });
      button.addEventListener("blur", () => { disarm(); });
    }

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
     * @param {object}  [next.next]       { active, available, planned }
     * @param {object}  [next.promote]    { available, reason, summary }
     * @param {object}  [next.copy]       { available, reason }
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
      if (n.next && typeof n.next === "object") {
        state.next = { active: !!n.next.active, available: !!n.next.available, planned: !!n.next.planned };
      }
      if (n.promote && typeof n.promote === "object") {
        state.promote = {
          available: !!n.promote.available,
          reason: typeof n.promote.reason === "string" ? n.promote.reason : "",
          summary: typeof n.promote.summary === "string" ? n.promote.summary : ""
        };
      }
      if (n.copy && typeof n.copy === "object") {
        state.copy = { available: !!n.copy.available, reason: typeof n.copy.reason === "string" ? n.copy.reason : "" };
      }
      // A control that stopped being possible while armed is not armed.
      const resetGone = state.armed === "reset" && (!state.reset.available || state.reset.count === 0);
      const promoteGone = state.armed === "promote" && (!state.promote.available || !state.next.planned || !state.next.active);
      if (state.armed && (resetGone || promoteGone || state.hidden || state.withdrawn)) disarm();
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
      nextButton,
      nextGroup,
      flyout,
      weightsGroup,
      weightsFlyout,
      promoteButton,
      copyButton,
      update,
      place,
      disarm,
      isArmed: () => !!state.armed,
      armedControl: () => state.armed,
      getState: () => ({
        hidden: state.hidden, withdrawn: state.withdrawn, armed: state.armed === "reset", armedControl: state.armed,
        blend: Object.assign({}, state.blend), weights: Object.assign({}, state.weights),
        smart: Object.assign({}, state.smart), reset: Object.assign({}, state.reset),
        next: Object.assign({}, state.next), promote: Object.assign({}, state.promote), copy: Object.assign({}, state.copy),
        placed: state.placed ? Object.assign({}, state.placed) : null
      })
    };
  }

  return Object.freeze({ ARM_DURATION, GAP, EDGE, LABEL, FALLBACK_SIZE, blendGlyph, weightsGlyph, smartGlyph, resetGlyph, nextGlyph, promoteGlyph, copyGlyph, parseBox, readStage, anchor, create });
});
