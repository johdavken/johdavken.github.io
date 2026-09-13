/* The machine utility rail: a column of icon tiles standing over the
 * Operator Handbook's launcher in the stage's corner, for the operations
 * that act on the live machine as a whole.
 *
 * WHAT IT IS
 *
 * Three switches standing always, each with children that unfold while
 * its face is on (Reset Tracking is not here: it stands in the timeline's
 * Now column, station-rundown-timeline.js, beside the tracking it resets):
 *
 *   Blend Edit       the mode's one switch. On: every layer turns over to
 *                    its compact blend card (station.js owns the mode; the
 *                    rail only asks). On again: the mode ends along its one
 *                    exit, every layer back as hoppers. The control shows
 *                    the mode's state as its own. While this face is on,
 *                    one child unfolds to its RIGHT, as the Next switch's
 *                    two do:
 *   Bulk Edit        the Recipe grid's Bulk edit, on the stage: on, every
 *                    card's hopper badges become selection toggles (the
 *                    boot file keeps the selection and tells the cards).
 *                    The control then SWAPS IN PLACE for a Confirm and a
 *                    Cancel, and the resin field (station-bulk-field.js,
 *                    built by the boot file and handed in) stands ABOVE
 *                    the row, right-aligned to the two and reaching back
 *                    across the switch - over the stage above the dock,
 *                    where nothing is drawn. The boot file
 *                    tells the rail the draft; Confirm is held until a
 *                    hopper is selected and a resin is entered, and
 *                    writes it as one setHopperResins
 *                    (station-blend-actions.js). Cancel ends the
 *                    selection without writing. The SAME row - one Bulk
 *                    Edit, one Confirm, one Cancel, one field - is the
 *                    Next face's child as well: while that face is on it
 *                    stands in the Next switch's flyout, on the row above
 *                    the two moves (the row it stands on beside Blend
 *                    Edit), on the same bracket, and writes to the plan.
 *                    The boot file addresses the write; the rail only
 *                    moves the row to whichever face is on.
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
 *   Next             the mode's third face: every layer turns over to a
 *                    blend card of the PLANNED recipe - the Next Recipe the
 *                    application keeps beside the running one - edited
 *                    through the same card, addressed to the plan. A dot
 *                    on the control says a plan exists. It stands under
 *                    Blend Edit, the running recipe's face. While this face
 *                    is on, the Bulk Edit row and two more controls unfold
 *                    to its RIGHT, on a stem from the switch, as its
 *                    children - the flyout (station-rail__flyout), which
 *                    opens and folds with a short motion the stylesheet
 *                    owns: the bulk row above, the two moves on the
 *                    switch's own row:
 *   Load Next        the plan becomes the running recipe - the floor UI's
 *                    Load Next Recipe, as one promoteNextRecipe command
 *                    (station-plan-controls.js). A promotion is easy to
 *                    do by accident and slow to undo by hand, so it is
 *                    two clicks in place (station-armed.js): the first
 *                    ARMS the control, which says so and waits; the
 *                    second confirms. A pause, a click anywhere else,
 *                    Escape or the focus leaving all disarm it. No
 *                    dialog. The armed control's title says what the
 *                    promotion changes, in counts.
 *   Copy Current     the running recipe becomes the plan - Load Current
 *                    Recipe, as one copyCurrentToNext. One click: the plan
 *                    it overwrites is a draft, and the title says so.
 *
 * WHERE IT STANDS
 *
 * Over the Operator Handbook's launcher, in the stage's lower left
 * corner: a column of tiles the launcher's own size and make, stacked
 * up from it with the same gap between each - so the corner reads as one
 * dock of application icons, the Handbook at its foot, the machine's
 * controls above it:
 *
 *     [ Blend Edit   ]  -| [ Bulk Edit ]        (while the face is on)
 *     [ Next Recipe  ]  -| [ Load Next ] [ Copy Current ]
 *                          (Next on: the bulk row stands above these two,
 *                           on the Next bracket, in the Blend row's place)
 *     [ Weights      ]  -| [ Smart Hoppers ]
 *     [ Handbook     ]                          (station-handbook.js)
 *
 * The Handbook is the master of the tile: the launcher's 64px, its
 * radius, the plate it draws its icon on (handbook.css names the size
 * in tokens.css, and machine-rail.css reads it back), the stroke the
 * plate takes under the pointer. Each control is that plate with a
 * glyph on it, no more. Nothing is measured: the column stands in the
 * corner the launcher stands in, at every window and every line, and
 * the Handbook's panel keeps that column clear on either side of itself
 * (the clearance token) - so opening the Handbook covers no tile. A
 * face's children unfold to the RIGHT of their switch, out of the
 * column, on a stem; the panel, laid over the stage, covers what
 * reaches under it. The rail lives in its own slot over the stage's
 * cell (station-shell.js, shell.css), moves no hopper, adds no height
 * and covers only the corner.
 *
 * WHAT IT HOLDS
 *
 * Presentation state only: what each control was last told to show, and
 * whether Load Next is armed (station-armed.js keeps the timer and the
 * click-away listener). It reads no job, keeps no mode of its own and dispatches
 * nothing: every click is handed to the boot file through the callbacks
 * it was built with, and what the stage then shows is the boot file's to
 * tell it (update()).
 */
(function (root, factory) {
  const armed = typeof require === "function" ? require("./station-armed.js") : (root && root.PolynStationArmed);
  const api = factory(armed);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationMachineRail = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (armedModule) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* How long an armed Load Next waits for its confirming click: the
   * helper's own, so the timeline's reset waits the same. */
  const ARM_DURATION = armedModule ? armedModule.ARM_DURATION : 5000;
  /* The tile: the Handbook launcher's 64 by 64 (station-handbook.js,
   * handbook.css). The plate is drawn in that space exactly as the
   * launcher's is, and the glyph - drawn 20 by 20 - is doubled onto it. */
  const TILE = 64;
  const GLYPH = 20;

  const LABEL = Object.freeze({
    blend: "Blend Edit", weights: "Weights", smart: "Smart Hoppers",
    next: "Next Recipe", promote: "Load Next into Current", copy: "Copy Current into Next",
    bulk: "Bulk Edit", confirm: "Apply resin to selected hoppers", cancel: "Cancel bulk edit"
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
   *   The glyphs
   * ------------------------------------------------------------------
   * Each control is a tile: the launcher's plate - the same rounded rect
   * in the same 64-unit space, inset the same, as station-handbook.js
   * draws under its icon - with a glyph on it. The glyphs are drawn 20
   * by 20 and set on the plate at twice their size, centred; the
   * stylesheet halves their stroke widths back, so a line on a tile is
   * the weight of a line on the launcher's icon. Every part is in the
   * control's own colour (machine-rail.css) so each follows its control
   * through hover, focus, active and armed. No image asset, no glyph
   * from a font. */
  function glyphTile(doc) {
    const svg = svgNode(doc, "svg", "station-rail__glyph", {
      viewBox: `0 0 ${TILE} ${TILE}`, width: String(TILE), height: String(TILE), "aria-hidden": "true", focusable: "false"
    });
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-plate", { x: 1.5, y: 1.5, width: TILE - 3, height: TILE - 3, rx: 14 }));
    const inset = (TILE - GLYPH * 2) / 2;
    const art = svgNode(doc, "g", "station-rail__glyph-art", { transform: `translate(${inset} ${inset}) scale(2)` });
    svg.appendChild(art);
    return { svg, art };
  }


  /* Blend Edit: a card turning over. The face in front carries three
   * short rows - a blend, as the compact card lists one - and the face
   * behind it stands a little up and to the right, so the two read as
   * front and back of one card mid-turn; a small arrow over the top says
   * which way it goes. */
  function blendGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-back", { x: 7.5, y: 2.5, width: 10, height: 12, rx: 1.5 }));
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-face", { x: 2.5, y: 5.5, width: 10, height: 12, rx: 1.5 }));
    for (const [index, width] of [[0, 5], [1, 3.5], [2, 5]].values()) {
      const y = 9 + index * 2.6;
      svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: `M 5 ${y} L ${5 + width} ${y}` }));
    }
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 14 0.9 L 16 2.5 L 14 4.1" }));
    return tile.svg;
  }

  /* Weights: a weight of the kind set on a scale - a block, wider at
   * its foot, with the loop of a handle over it. */
  function weightsGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 7.4 6.2 A 2.6 2.6 0 0 1 12.6 6.2" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 6.2 6.6 L 13.8 6.6 L 16 17 L 4 17 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: "M 7.6 13.5 L 12.4 13.5" }));
    return tile.svg;
  }

  /* Smart Hoppers: a hopper as the stage draws one, with the ticks of a
   * gauge up its side - the measure a weight is computed from - and a
   * small spark above its rim for the computing. */
  function smartGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-hopper", { d: "M 4.6 5.4 L 15.4 5.4 L 12.8 13.6 L 11.6 17 L 8.4 17 L 7.2 13.6 Z" }));
    for (const [index, width] of [[0, 3], [1, 2.4], [2, 1.8]].values()) {
      const y = 7.6 + index * 2.6;
      const x = 6 + index * 0.8;
      svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: `M ${x} ${y} L ${x + width} ${y}` }));
    }
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 16.4 1 L 16.4 4.2 M 14.8 2.6 L 18 2.6" }));
    return tile.svg;
  }

  /* Next: the card as the Blend glyph draws it, but standing alone and
   * dog-eared - a sheet waiting its turn - with the three rows of a blend
   * on it. */
  function nextGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 5 2.5 L 12 2.5 L 15.5 6 L 15.5 17.5 L 5 17.5 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 12 2.5 L 12 6 L 15.5 6" }));
    for (const [index, width] of [[0, 5], [1, 3.5], [2, 5]].values()) {
      const y = 9.2 + index * 2.6;
      svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: `M 7.5 ${y} L ${7.5 + width} ${y}` }));
    }
    svg.appendChild(svgNode(doc, "circle", "station-rail__glyph-dot", { cx: 16.2, cy: 3.8, r: 2.2 }));
    return tile.svg;
  }

  /* Load Next: the sheet moving onto the machine - an arrow from a small
   * sheet at the top right down onto a hopper at the bottom left. */
  function promoteGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 11.5 1.5 L 16 1.5 L 18 3.5 L 18 9 L 11.5 9 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 12 11 L 7.5 15.5 M 7.5 11.5 L 7.5 15.5 L 11.5 15.5" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-hopper", { d: "M 1.6 10.4 L 7.2 10.4 L 5.8 14.6 L 5.2 16.6 L 3.6 16.6 L 3 14.6 Z" }));
    return tile.svg;
  }

  /* Copy Current: the reverse - a hopper at the top left, an arrow up
   * onto the sheet at the bottom right. */
  function copyGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-hopper", { d: "M 1.6 2.4 L 7.2 2.4 L 5.8 6.6 L 5.2 8.6 L 3.6 8.6 L 3 6.6 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 7.5 9 L 12 4.5 M 8 4.5 L 12 4.5 L 12 8.5" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 11.5 11 L 16 11 L 18 13 L 18 18.5 L 11.5 18.5 Z" }));
    return tile.svg;
  }

  /* Bulk Edit: three badges stacked as the card lists them, the lower two
   * ticked - a selection of hoppers, and one thing written onto it. */
  function bulkGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    for (const [index, ticked] of [[0, false], [1, true], [2, true]].values()) {
      const y = 2.5 + index * 5.4;
      svg.appendChild(svgNode(doc, "rect", ticked ? "station-rail__glyph-face" : "station-rail__glyph-back", { x: 2.5, y, width: 7, height: 4.4, rx: 1.2 }));
      if (ticked) svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: `M 4.4 ${y + 2.3} L 5.6 ${y + 3.4} L 7.8 ${y + 1.1}` }));
      svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: `M 11.5 ${y + 2.2} L 17.5 ${y + 2.2}` }));
    }
    return tile.svg;
  }

  /* Confirm: a tick. Cancel: a cross. Drawn plain, in the control's own
   * colour, as the two ends of one choice. */
  function confirmGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke station-rail__glyph-stroke--bold", { d: "M 4 10.5 L 8.2 14.5 L 16 5.5" }));
    return tile.svg;
  }

  function cancelGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke station-rail__glyph-stroke--bold", { d: "M 5.5 5.5 L 14.5 14.5 M 14.5 5.5 L 5.5 14.5" }));
    return tile.svg;
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
   * @param {function} [options.onNextEdit]     () => void; the Next face's switch
   * @param {function} [options.onPromote]      () => void; Load Next's confirming click
   * @param {function} [options.onCopy]         () => void; Copy Current's click
   * @param {function} [options.onBulkEdit]     () => void; Bulk Edit's click - the
   *        boot file starts the selection and tells the rail
   * @param {function} [options.onBulkConfirm]  () => void; Confirm - the boot file
   *        holds the draft it applies
   * @param {function} [options.onBulkCancel]   () => void; Cancel
   * @param {Element}  [options.bulkField]      the resin field's element, stood
   *        above the Blend row while the selection is on
   * @param {function} [options.setTimeout]     for the arm timer; the host's by default
   * @param {function} [options.clearTimeout]
   * @param {number}   [options.armDuration]    ms an armed Load Next waits
   */
  function create(doc, options) {
    const settings = options || {};
    const onBlendEdit = typeof settings.onBlendEdit === "function" ? settings.onBlendEdit : () => {};
    const onWeightsEdit = typeof settings.onWeightsEdit === "function" ? settings.onWeightsEdit : () => {};
    const onSmartHoppers = typeof settings.onSmartHoppers === "function" ? settings.onSmartHoppers : () => {};
    const onNextEdit = typeof settings.onNextEdit === "function" ? settings.onNextEdit : () => {};
    const onPromote = typeof settings.onPromote === "function" ? settings.onPromote : () => {};
    const onCopy = typeof settings.onCopy === "function" ? settings.onCopy : () => {};
    const onBulkEdit = typeof settings.onBulkEdit === "function" ? settings.onBulkEdit : () => {};
    const onBulkConfirm = typeof settings.onBulkConfirm === "function" ? settings.onBulkConfirm : () => {};
    const onBulkCancel = typeof settings.onBulkCancel === "function" ? settings.onBulkCancel : () => {};

    const state = {
      hidden: true,
      withdrawn: false,
      blend: { active: false, available: false },
      weights: { active: false, available: false },
      smart: { on: false, available: false, reason: "" },
      next: { active: false, available: false, planned: false },
      promote: { available: false, reason: "", summary: "" },
      copy: { available: false, reason: "" },
      /* The Blend face's child: whether the selection is on, whether the
       * application offers the write, how many hoppers are selected, and
       * the resin drafted on the cards' field. */
      bulk: { active: false, available: false, reason: "", count: 0, resin: "" }
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
    const bulkButton = element(doc, "button", "station-rail__control station-rail__control--bulk", {
      type: "button", "data-action": "bulk-edit", "aria-pressed": "false", "aria-label": LABEL.bulk, title: LABEL.bulk
    });
    bulkButton.appendChild(bulkGlyph(doc));
    const confirmButton = element(doc, "button", "station-rail__control station-rail__control--confirm", {
      type: "button", "data-action": "bulk-confirm", "aria-label": LABEL.confirm, title: LABEL.confirm
    });
    confirmButton.appendChild(confirmGlyph(doc));
    const cancelButton = element(doc, "button", "station-rail__control station-rail__control--cancel", {
      type: "button", "data-action": "bulk-cancel", "aria-label": LABEL.cancel, title: LABEL.cancel
    });
    cancelButton.appendChild(cancelGlyph(doc));
    /* A switch and its children as one group: the switch in the rail's
     * column, the flyout beside it to the right - out of the column's
     * flow, so the column stands where it stood, one tile wide. A flyout
     * is rows of controls, its foot on the switch's row and growing
     * upward (machine-rail.css). Closed, it is out of the tab order and
     * the reader's tree (inert, hidden by visibility once its motion has
     * ended). */
    function group(role, parent, label, children) {
      const wrapper = element(doc, "div", `station-rail__group station-rail__group--${role}`, { "data-role": `${role}-group`, "data-open": "false" });
      const fly = element(doc, "div", "station-rail__flyout", { role: "group", "aria-label": label, "data-open": "false", inert: "", "aria-hidden": "true" });
      for (const child of children) fly.appendChild(child);
      wrapper.appendChild(parent);
      wrapper.appendChild(fly);
      return { wrapper, fly };
    }
    /* The two moves, one row. */
    const movesRow = element(doc, "div", "station-rail__row station-rail__row--moves", { "data-role": "moves-row" });
    movesRow.appendChild(promoteButton);
    movesRow.appendChild(copyButton);
    const nextParts = group("next", nextButton, "Next Recipe actions", [movesRow]);
    const nextGroup = nextParts.wrapper;
    const flyout = nextParts.fly;
    /* The Weights switch and Smart Hoppers the same way: the switch's one
     * child, unfolded while the Weights face is on. */
    const weightsParts = group("weights", weightsButton, "Weights actions", [smartButton]);
    const weightsGroup = weightsParts.wrapper;
    const weightsFlyout = weightsParts.fly;
    /* The bulk row: Bulk Edit and what it becomes - Confirm and Cancel
     * while the selection is on - two sets in one place, the stylesheet
     * swapping them (data-bulk on the row). One row, built once: it
     * stands in the Blend flyout while that face is on and in the Next
     * flyout while that one is (draw() moves it), so a selection on the
     * plan's cards is worked exactly as one on the running recipe's. */
    const bulkRow = element(doc, "div", "station-rail__row station-rail__row--bulk", { "data-role": "bulk-row", "data-bulk": "false" });
    bulkRow.appendChild(bulkButton);
    bulkRow.appendChild(confirmButton);
    bulkRow.appendChild(cancelButton);
    /* The resin field's slot: above the bulk row, right-aligned to it
     * (machine-rail.css). The field itself is the boot file's; the slot
     * is hidden with it while no selection is on. */
    const fieldSlot = element(doc, "div", "station-rail__field-slot", { "data-role": "bulk-field-slot", hidden: "" });
    if (settings.bulkField && typeof settings.bulkField === "object") fieldSlot.appendChild(settings.bulkField);
    bulkRow.appendChild(fieldSlot);
    /* The Blend switch's flyout holds the bulk row and nothing else. */
    const blendParts = group("blend", blendButton, "Blend Edit actions", [bulkRow]);
    const blendGroup = blendParts.wrapper;
    const blendFlyout = blendParts.fly;

    /* The bulk row to whichever face is on: the Next flyout's top row
     * (above the moves) while the Next face is, the Blend flyout
     * otherwise. Appending moves the row; the moves are re-appended
     * after it so they keep the flyout's foot. */
    function placeBulkRow() {
      if (state.next.active) {
        if (bulkRow.parentNode !== flyout) { flyout.appendChild(bulkRow); flyout.appendChild(movesRow); }
      } else if (bulkRow.parentNode !== blendFlyout) {
        blendFlyout.appendChild(bulkRow);
      }
    }
    rootEl.appendChild(blendGroup);
    rootEl.appendChild(nextGroup);
    rootEl.appendChild(weightsGroup);

    /* Load Next armed and confirmed: the helper keeps which control is
     * armed and what disarms it; the rail draws the state. */
    const arming = armedModule ? armedModule.create({
      doc, controls: { promote: promoteButton }, onChange: () => draw(),
      setTimeout: settings.setTimeout, clearTimeout: settings.clearTimeout, armDuration: settings.armDuration
    }) : { arm: () => false, disarm: () => false, armed: () => null };

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
      // on; Smart Hoppers beside Weights only while that face is; Bulk
      // Edit beside Blend Edit only while that face is.
      placeBulkRow();
      unfold(nextGroup, flyout, state.next.active);
      unfold(weightsGroup, weightsFlyout, state.weights.active);
      unfold(blendGroup, blendFlyout, state.blend.active);
      drawBulk();
      const promoteArmed = arming.armed() === "promote";
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
    }

    /* The bulk row, in its two states. At rest Bulk Edit is the one
     * control; on, it is hidden (out of the tab order and the reader's
     * tree, as a folded flyout is) and Confirm and Cancel take its place.
     * On under either recipe's face - the Blend face's running recipe,
     * the Next face's plan. */
    function hide(node, on) {
      if (on) { node.setAttribute("hidden", ""); node.setAttribute("inert", ""); node.setAttribute("aria-hidden", "true"); }
      else { node.removeAttribute("hidden"); node.removeAttribute("inert"); node.removeAttribute("aria-hidden"); }
    }

    function drawBulk() {
      const bulk = state.bulk;
      const on = bulk.active && (state.blend.active || state.next.active);
      bulkRow.setAttribute("data-bulk", on ? "true" : "false");
      blendGroup.setAttribute("data-bulk", on && state.blend.active ? "true" : "false");
      nextGroup.setAttribute("data-bulk", on && state.next.active ? "true" : "false");
      rootEl.classList.toggle("is-bulk-active", on);
      bulkButton.setAttribute("aria-pressed", on ? "true" : "false");
      bulkButton.disabled = !bulk.available;
      bulkButton.setAttribute("title", !bulk.available
        ? `${LABEL.bulk} is not available: ${bulk.reason || "no application is connected to Station commands."}`
        : `${LABEL.bulk} · select hoppers on the cards, then write one resin onto all of them${state.next.active ? " in the plan" : ""}`);
      hide(bulkButton, on);
      hide(confirmButton, !on);
      hide(cancelButton, !on);
      if (on) fieldSlot.removeAttribute("hidden");
      else fieldSlot.setAttribute("hidden", "");
      const typed = String(bulk.resin || "").trim();
      const hoppers = `${bulk.count} hopper${bulk.count === 1 ? "" : "s"}`;
      confirmButton.disabled = !on || bulk.count === 0 || !typed;
      confirmButton.setAttribute("title", bulk.count === 0
        ? `${LABEL.confirm} · select a hopper on a card first`
        : (!typed ? `${LABEL.confirm} · enter the resin in the card's field for ${hoppers}` : `Apply "${typed}" to ${hoppers}`));
      confirmButton.setAttribute("aria-label", bulk.count === 0 ? LABEL.confirm : `Apply resin to ${hoppers}`);
      cancelButton.setAttribute("title", `${LABEL.cancel} · nothing is written; the selection is cleared`);
    }

    /* ---- Clicks ---- */

    function disarm() {
      return arming.disarm();
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
    nextButton.addEventListener("click", () => {
      disarm();
      onNextEdit();
    });
    promoteButton.addEventListener("click", () => {
      if (promoteButton.disabled) return;
      if (arming.armed() !== "promote") { arming.arm("promote"); return; }
      disarm();
      onPromote();
    });
    copyButton.addEventListener("click", () => {
      if (copyButton.disabled) return;
      disarm();
      onCopy();
    });
    bulkButton.addEventListener("click", () => {
      if (bulkButton.disabled) return;
      disarm();
      onBulkEdit();
    });
    confirmButton.addEventListener("click", () => {
      if (confirmButton.disabled) return;
      disarm();
      onBulkConfirm();
    });
    cancelButton.addEventListener("click", () => {
      if (cancelButton.disabled) return;
      disarm();
      onBulkCancel();
    });
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
     * @param {object}  [next.next]       { active, available, planned }
     * @param {object}  [next.promote]    { available, reason, summary }
     * @param {object}  [next.copy]       { available, reason }
     * @param {object}  [next.bulk]       { active, available, reason, count, resin }
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
      if (n.bulk && typeof n.bulk === "object") {
        state.bulk = {
          active: !!n.bulk.active,
          available: !!n.bulk.available,
          reason: typeof n.bulk.reason === "string" ? n.bulk.reason : "",
          count: Number.isInteger(n.bulk.count) && n.bulk.count > 0 ? n.bulk.count : 0,
          resin: typeof n.bulk.resin === "string" ? n.bulk.resin : ""
        };
      }
      // A control that stopped being possible while armed is not armed.
      const promoteGone = arming.armed() === "promote" && (!state.promote.available || !state.next.planned || !state.next.active);
      if (arming.armed() && (promoteGone || state.hidden || state.withdrawn)) disarm();
      else draw();
    }

    draw();

    return {
      element: rootEl,
      blendButton,
      weightsButton,
      smartButton,
      nextButton,
      nextGroup,
      flyout,
      weightsGroup,
      weightsFlyout,
      promoteButton,
      copyButton,
      blendGroup,
      blendFlyout,
      bulkRow,
      movesRow,
      bulkButton,
      confirmButton,
      cancelButton,
      fieldSlot,
      update,
      disarm,
      isArmed: () => !!arming.armed(),
      armedControl: () => arming.armed(),
      getState: () => ({
        hidden: state.hidden, withdrawn: state.withdrawn, armedControl: arming.armed(),
        blend: Object.assign({}, state.blend), weights: Object.assign({}, state.weights),
        smart: Object.assign({}, state.smart),
        next: Object.assign({}, state.next), promote: Object.assign({}, state.promote), copy: Object.assign({}, state.copy),
        bulk: Object.assign({}, state.bulk)
      })
    };
  }

  return Object.freeze({ ARM_DURATION, TILE, LABEL, blendGlyph, weightsGlyph, smartGlyph, nextGlyph, promoteGlyph, copyGlyph, bulkGlyph, confirmGlyph, cancelGlyph, create });
});
