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
 *   Current Recipe   the mode's first switch - the RUNNING recipe's face.
 *                    On: every layer turns over to its compact blend card
 *                    (station.js owns the mode; the rail only asks). On
 *                    again: the mode ends along its one exit, every layer
 *                    back as hoppers. The control shows the mode's state
 *                    as its own. While this face is on, its row unfolds
 *                    to its RIGHT: Load Next. (Editing a selection of
 *                    hoppers is not the rail's: a card's badge selects
 *                    its hopper and the header's hopper editor writes
 *                    to the selection, station-hopper-edit.js.)
 *   Load Next        the Current face's move: the plan becomes the running
 *                    recipe - the floor UI's Load Next Recipe, as one
 *                    promoteNextRecipe command (station-plan-controls.js).
 *                    It stands on the Current row, so the switch it
 *                    points at is the face it writes to, and the operator
 *                    watches the rows change. A promotion is easy
 *                    to do by accident and slow to undo by hand, so it is
 *                    two clicks in place (station-armed.js): the first
 *                    ARMS the control, which says so and waits; the
 *                    second confirms. A pause, a click anywhere else,
 *                    Escape or the focus leaving all disarm it. No
 *                    dialog. The armed control's title says what the
 *                    promotion changes, in counts. Held while a hopper
 *                    selection is open on the cards: the edit is applied
 *                    or cancelled first, never dropped by a promotion.
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
 *                    exactly as the recipe switches' rows are. The boot
 *                    file asks the application (one setSmartHoppers) and
 *                    tells the rail what the application then holds; held
 *                    with the reason when this desktop is not on an
 *                    identified line, or the command is not offered.
 *   Next Recipe      the mode's third face: every layer turns over to a
 *                    blend card of the PLANNED recipe - the Next Recipe the
 *                    application keeps beside the running one - edited
 *                    through the same card, addressed to the plan. A dot
 *                    on the control says a plan exists. It stands under
 *                    Current Recipe. While this face is on, its row
 *                    unfolds to its RIGHT, on a stem from the switch, as
 *                    its children - the flyout (station-rail__flyout),
 *                    which opens and folds with a short motion the
 *                    stylesheet owns: Copy Current.
 *   Copy Current     the Next face's move: the running recipe becomes the
 *                    plan - Load Current Recipe, as one copyCurrentToNext.
 *                    Armed and confirmed exactly as Load Next is: the plan
 *                    it overwrites may be an afternoon's work, and one
 *                    stray click on an unfolded row should not cost it.
 *                    The armed title says what is replaced.
 *   Tools            the fourth switch, and not a face: the console's
 *                    calculators, standing at the foot of the column
 *                    just over the Handbook. On, its row unfolds to its
 *                    RIGHT exactly as a face's does; the boot file keeps
 *                    whether it is open and tells the rail. Nothing on
 *                    the stage turns over for it.
 *   Winding Tension  the Tools row's first tool: the application's
 *                    Winding Tension calculator, opened out of this tile
 *                    into a window over the stage
 *                    (station-winding-tension.js). The tile shows the
 *                    window's state as its own - on while it is open -
 *                    and is the tile the window flies out of and back
 *                    to.
 *   Resin Totals     the row's second tool: the application's Resin
 *                    Totals (station-resin-totals.js), once a Handbook
 *                    page, in a window of its own out of this tile the
 *                    same way.
 *   Pressure         the row's third tool: the console's Pressure
 *                    converter (station-pressure.js), psi to bar and
 *                    back, in a window of its own out of this tile the
 *                    same way. More tools stand beside these on the row.
 *   Print            the fifth switch, under Tools: the floor UI's Print
 *                    Recipe. On, its row unfolds to its RIGHT with the
 *                    choice the floor UI's dialog asks - Current, Next,
 *                    Both - as three tiles; Next and Both are held while
 *                    nothing is planned, as the dialog's are. A tile's
 *                    click is handed to the boot file, which prints the
 *                    sheet (station-print-sheet.js) and folds the row, as
 *                    the dialog closes. Held while there is nothing to
 *                    print: no resin in any hopper and no plan.
 *
 * WHERE IT STANDS
 *
 * Over the Operator Handbook's launcher, in the stage's lower left
 * corner: a column of tiles the launcher's own size and make, stacked
 * up from it with the same gap between each - so the corner reads as one
 * dock of application icons, the Handbook at its foot, the machine's
 * controls above it:
 *
 *     [ Current      ]  -| [ Load Next ]     (while its face is on)
 *     [ Next Recipe  ]  -| [ Copy Current ]  (while its face is on)
 *     [ Weights      ]  -| [ Smart Hoppers ]
 *     [ Tools        ]  -| [ Winding Tension ] [ Resin Totals ] [ Pressure ]  (while the row is open)
 *     [ Print        ]  -| [ Current ] [ Next ] [ Both ]  (while the row is open)
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
 * whether Load Next or Copy Current is armed (station-armed.js keeps the
 * timer and the click-away listener). It reads no job, keeps no mode of its own and dispatches
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

  /* How long an armed Load Next or Copy Current waits for its confirming
   * click: the helper's own, so the timeline's reset waits the same. */
  const ARM_DURATION = armedModule ? armedModule.ARM_DURATION : 5000;
  /* The tile: the Handbook launcher's 64 by 64 (station-handbook.js,
   * handbook.css). The plate is drawn in that space exactly as the
   * launcher's is, and the glyph - drawn 20 by 20 - is doubled onto it. */
  const TILE = 64;
  const GLYPH = 20;

  const LABEL = Object.freeze({
    blend: "Current Recipe", weights: "Weights", smart: "Smart Hoppers",
    next: "Next Recipe", promote: "Load Next into Current", copy: "Copy Current into Next",
    tools: "Tools", winding: "Winding Tension", totals: "Resin Totals", pressure: "Pressure",
    print: "Print Recipe", printCurrent: "Print Current Recipe", printNext: "Print Next Recipe", printBoth: "Print both recipes"
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


  /* The recipe faces' vocabulary: the HOPPER is the running line - the
   * Current recipe - and the folded SHEET is the plan - the Next recipe.
   * Each switch draws its own object, centred. Each move draws the OTHER
   * face's object stood to the right, with one arrow leaving it through
   * an opening in its side and pointing LEFT, at the switch its row hangs
   * from - the face the move writes to. The two moves share every arrow
   * coordinate and differ only in the object; a move's object is the
   * switch's, unchanged in size, stood to the right and opened. Both
   * objects are drawn as the launcher's face is - a surface fill under the
   * control's stroke - so each reads as a thing on the plate. */
  const HOPPER = "M 4.75 3 L 15.25 3 L 12.25 12.5 L 11.25 16.5 L 8.75 16.5 L 7.75 12.5 Z";
  const HOPPER_OPEN = "M 10.6 13 L 11.5 16.5 L 14 16.5 L 15 12.5 L 18 3 L 7.5 3 L 8.8 7";
  const SHEET = "M 4.75 2.5 L 11.75 2.5 L 15.25 6 L 15.25 17.5 L 4.75 17.5 Z";
  const SHEET_FOLD = "M 11.75 2.5 L 11.75 6 L 15.25 6";
  const SHEET_OPEN = "M 7 13 L 7 17.5 L 17.5 17.5 L 17.5 6 L 14 2.5 L 7 2.5 L 7 7";
  const SHEET_OPEN_FOLD = "M 14 2.5 L 14 6 L 17.5 6";
  const ARROW_SHAFT = "M 10.5 10 L 2 10";
  const ARROW_HEAD = "M 4.8 7.2 L 2 10 L 4.8 12.8";

  /* Current Recipe: the hopper. */
  function blendGlyph(doc) {
    const tile = glyphTile(doc);
    tile.art.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: HOPPER }));
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

  /* Next Recipe: the folded sheet - a page waiting its turn - with the
   * planned dot on its corner. */
  function nextGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: SHEET }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: SHEET_FOLD }));
    svg.appendChild(svgNode(doc, "circle", "station-rail__glyph-dot", { cx: 15.95, cy: 3.8, r: 2.2 }));
    return tile.svg;
  }

  /* Load Next: the sheet, and the arrow leaving it for the Current switch. */
  function promoteGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: SHEET_OPEN }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: SHEET_OPEN_FOLD }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: ARROW_SHAFT }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: ARROW_HEAD }));
    return tile.svg;
  }

  /* Copy Current: the hopper, and the same arrow leaving it for the Next switch. */
  function copyGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: HOPPER_OPEN }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: ARROW_SHAFT }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: ARROW_HEAD }));
    return tile.svg;
  }

  /* Tools: a spanner, its open jaw to the upper right and its handle
   * down to the lower left - the head an arc open at the jaw, the two
   * jaw faces turned in, the handle one bold line. */
  function toolsGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke station-rail__glyph-stroke--bold", { d: "M 13.5 3.4 A 3.4 3.4 0 1 0 16.6 6.5" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 13.5 3.4 L 13.4 4.9 M 16.6 6.5 L 15.1 6.6" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke station-rail__glyph-stroke--bold", { d: "M 10.8 9.2 L 4 16" }));
    return tile.svg;
  }

  /* Winding Tension: a length of web pinched narrow by the pull on it -
   * a face whose long edges bow inward - with an arrow leaving each end
   * and the radiating ticks of strain above and below. */
  function windingGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 5.5 6.5 Q 10 8.2 14.5 6.5 L 14.5 13.5 Q 10 11.8 5.5 13.5 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 4.5 10 L 1 10 M 2.6 8.4 L 1 10 L 2.6 11.6" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 15.5 10 L 19 10 M 17.4 8.4 L 19 10 L 17.4 11.6" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: "M 10 1.6 L 10 3.8 M 6.4 2.6 L 7.4 4.6 M 13.6 2.6 L 12.6 4.6" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: "M 10 18.4 L 10 16.2 M 6.4 17.4 L 7.4 15.4 M 13.6 17.4 L 12.6 15.4" }));
    return tile.svg;
  }

  /* Resin Totals: pounds by material as a chart - three bars of rising
   * height on a baseline, the tallest the total, with the sigma of a sum
   * standing over them as a small stroke. */
  function totalsGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-face", { x: 3, y: 11, width: 3.6, height: 6.5, rx: 0.6 }));
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-face", { x: 8.2, y: 8, width: 3.6, height: 9.5, rx: 0.6 }));
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-face", { x: 13.4, y: 4.5, width: 3.6, height: 13, rx: 0.6 }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: "M 2 18.4 L 18 18.4" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 8.6 1.8 L 4.2 1.8 L 6.6 4.2 L 4.2 6.6 L 8.6 6.6" }));
    return tile.svg;
  }

  /* Pressure: a gauge - the round case, its scale an arc of ticks over
   * the top, the needle on its pivot swung to the upper right, as a
   * gauge reads under pressure. */
  function pressureGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "circle", "station-rail__glyph-face", { cx: 10, cy: 10.5, r: 8 }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: "M 4.4 8.2 L 5.8 8.9 M 7.2 4.4 L 7.9 5.7 M 10 3.5 L 10 5 M 12.8 4.4 L 12.1 5.7 M 15.6 8.2 L 14.2 8.9" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke station-rail__glyph-stroke--bold", { d: "M 10 10.5 L 13.6 6.6" }));
    svg.appendChild(svgNode(doc, "circle", "station-rail__glyph-stroke", { cx: 10, cy: 10.5, r: 1.2 }));
    return tile.svg;
  }

  /* Print: a printer as the floor UI's own button draws it - a sheet
   * standing into the body from above, the body, the printed sheet
   * coming out below. */
  function printGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: "M 6 7.5 L 6 3 L 14 3 L 14 7.5" }));
    svg.appendChild(svgNode(doc, "rect", "station-rail__glyph-face", { x: 3.5, y: 7.5, width: 13, height: 6, rx: 1 }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: "M 6 12 L 14 12 L 14 17 L 6 17 Z" }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-row", { d: "M 8 14.5 L 12 14.5" }));
    return tile.svg;
  }

  /* The Print row's choices, in the recipe faces' vocabulary: the hopper
   * for Current, the folded sheet for Next, and both stood side by side
   * for Both - each the object the switch draws, reduced to fit two. */
  const SMALL_HOPPER = "M 2.5 4 L 9.5 4 L 7.5 10.5 L 6.9 13.5 L 5.1 13.5 L 4.5 10.5 Z";
  const SMALL_SHEET = "M 11 5 L 15.5 5 L 18 7.5 L 18 16 L 11 16 Z";
  const SMALL_SHEET_FOLD = "M 15.5 5 L 15.5 7.5 L 18 7.5";

  function printCurrentGlyph(doc) {
    const tile = glyphTile(doc);
    tile.art.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: HOPPER }));
    return tile.svg;
  }

  function printNextGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: SHEET }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: SHEET_FOLD }));
    return tile.svg;
  }

  function printBothGlyph(doc) {
    const tile = glyphTile(doc);
    const svg = tile.art;
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: SMALL_HOPPER }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-face", { d: SMALL_SHEET }));
    svg.appendChild(svgNode(doc, "path", "station-rail__glyph-stroke", { d: SMALL_SHEET_FOLD }));
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
   * @param {function} [options.onCopy]         () => void; Copy Current's confirming click
   * @param {function} [options.onTools]        () => void; the Tools switch's click -
   *        the boot file keeps whether the row is open and tells the rail
   * @param {function} [options.onResinTotals] () => void; the Resin Totals tile
   * @param {function} [options.onWindingTension] () => void; the Winding Tension
   *        tile's click - the boot file opens or closes the surface and tells the rail
   * @param {function} [options.onPressure]     () => void; the Pressure tile
   * @param {function} [options.onPrint]        () => void; the Print switch's click -
   *        the boot file keeps whether the row is open and tells the rail
   * @param {function} [options.onPrintRecipe]  (which) => void; a choice on the
   *        Print row - "current", "next" or "both"; the boot file prints
   * @param {function} [options.setTimeout]     for the arm timer; the host's by default
   * @param {function} [options.clearTimeout]
   * @param {number}   [options.armDuration]    ms an armed move waits
   */
  function create(doc, options) {
    const settings = options || {};
    const onBlendEdit = typeof settings.onBlendEdit === "function" ? settings.onBlendEdit : () => {};
    const onWeightsEdit = typeof settings.onWeightsEdit === "function" ? settings.onWeightsEdit : () => {};
    const onSmartHoppers = typeof settings.onSmartHoppers === "function" ? settings.onSmartHoppers : () => {};
    const onNextEdit = typeof settings.onNextEdit === "function" ? settings.onNextEdit : () => {};
    const onPromote = typeof settings.onPromote === "function" ? settings.onPromote : () => {};
    const onCopy = typeof settings.onCopy === "function" ? settings.onCopy : () => {};
    const onTools = typeof settings.onTools === "function" ? settings.onTools : () => {};
    const onWindingTension = typeof settings.onWindingTension === "function" ? settings.onWindingTension : () => {};
    const onResinTotals = typeof settings.onResinTotals === "function" ? settings.onResinTotals : () => {};
    const onPressure = typeof settings.onPressure === "function" ? settings.onPressure : () => {};
    const onPrint = typeof settings.onPrint === "function" ? settings.onPrint : () => {};
    const onPrintRecipe = typeof settings.onPrintRecipe === "function" ? settings.onPrintRecipe : () => {};

    const state = {
      hidden: true,
      withdrawn: false,
      blend: { active: false, available: false },
      weights: { active: false, available: false },
      smart: { on: false, available: false, reason: "" },
      next: { active: false, available: false, planned: false },
      promote: { available: false, reason: "", summary: "" },
      copy: { available: false, reason: "" },
      /* Whether a hopper selection is open on the cards (the header's
       * hopper editor is showing): the two moves are held while it is. */
      selection: { active: false },
      /* The Tools row: whether it is unfolded, and whether any tool stands
       * on it; each tool's tile: whether its window is open and whether
       * the page has the window at all. */
      tools: { open: false, available: false },
      winding: { active: false, available: false },
      totals: { active: false, available: false },
      pressure: { active: false, available: false },
      /* The Print row: whether it is unfolded, whether there is anything
       * to print at all, and whether a plan exists for Next and Both. */
      print: { open: false, available: false, planned: false }
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
    const toolsButton = element(doc, "button", "station-rail__control station-rail__control--tools", {
      type: "button", "data-action": "tools", "aria-pressed": "false", "aria-label": LABEL.tools, title: LABEL.tools
    });
    toolsButton.appendChild(toolsGlyph(doc));
    const windingButton = element(doc, "button", "station-rail__control station-rail__control--winding", {
      type: "button", "data-action": "winding-tension", "aria-pressed": "false", "aria-label": LABEL.winding, title: LABEL.winding
    });
    windingButton.appendChild(windingGlyph(doc));
    const totalsButton = element(doc, "button", "station-rail__control station-rail__control--totals", {
      type: "button", "data-action": "resin-totals", "aria-pressed": "false", "aria-label": LABEL.totals, title: LABEL.totals
    });
    totalsButton.appendChild(totalsGlyph(doc));
    const pressureButton = element(doc, "button", "station-rail__control station-rail__control--pressure", {
      type: "button", "data-action": "pressure", "aria-pressed": "false", "aria-label": LABEL.pressure, title: LABEL.pressure
    });
    pressureButton.appendChild(pressureGlyph(doc));
    const printButton = element(doc, "button", "station-rail__control station-rail__control--print", {
      type: "button", "data-action": "print", "aria-pressed": "false", "aria-label": LABEL.print, title: LABEL.print
    });
    printButton.appendChild(printGlyph(doc));
    const printCurrentButton = element(doc, "button", "station-rail__control station-rail__control--print-current", {
      type: "button", "data-action": "print-current", "aria-label": LABEL.printCurrent, title: LABEL.printCurrent
    });
    printCurrentButton.appendChild(printCurrentGlyph(doc));
    const printNextButton = element(doc, "button", "station-rail__control station-rail__control--print-next", {
      type: "button", "data-action": "print-next", "aria-label": LABEL.printNext, title: LABEL.printNext
    });
    printNextButton.appendChild(printNextGlyph(doc));
    const printBothButton = element(doc, "button", "station-rail__control station-rail__control--print-both", {
      type: "button", "data-action": "print-both", "aria-label": LABEL.printBoth, title: LABEL.printBoth
    });
    printBothButton.appendChild(printBothGlyph(doc));
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
    /* Each recipe switch has one row: the Current row ends in Load Next,
     * the Next row in Copy Current - the move that writes to the face
     * the row hangs from, so the arrow on its tile points at the switch
     * it changes. Each row is its flyout's one child. */
    const blendRow = element(doc, "div", "station-rail__row station-rail__row--blend", { "data-role": "blend-row" });
    const nextRow = element(doc, "div", "station-rail__row station-rail__row--next", { "data-role": "next-row" });
    nextRow.appendChild(copyButton);
    const nextParts = group("next", nextButton, "Next Recipe actions", [nextRow]);
    const nextGroup = nextParts.wrapper;
    const flyout = nextParts.fly;
    /* The Weights switch and Smart Hoppers the same way: the switch's one
     * child, unfolded while the Weights face is on. */
    const weightsParts = group("weights", weightsButton, "Weights actions", [smartButton]);
    const weightsGroup = weightsParts.wrapper;
    const weightsFlyout = weightsParts.fly;
    /* The Tools switch and its row the same way: the tools side by side,
     * unfolded while the row is open. */
    const toolsRow = element(doc, "div", "station-rail__row station-rail__row--tools", { "data-role": "tools-row" });
    toolsRow.appendChild(windingButton);
    toolsRow.appendChild(totalsButton);
    toolsRow.appendChild(pressureButton);
    const toolsParts = group("tools", toolsButton, "Tools", [toolsRow]);
    const toolsGroup = toolsParts.wrapper;
    const toolsFlyout = toolsParts.fly;
    /* The Print switch and its row: the three choices side by side, in
     * the dialog's order, unfolded while the row is open. */
    const printRow = element(doc, "div", "station-rail__row station-rail__row--print", { "data-role": "print-row" });
    printRow.appendChild(printCurrentButton);
    printRow.appendChild(printNextButton);
    printRow.appendChild(printBothButton);
    const printParts = group("print", printButton, "Print Recipe choices", [printRow]);
    const printGroup = printParts.wrapper;
    const printFlyout = printParts.fly;
    blendRow.appendChild(promoteButton);
    /* The Current switch's flyout holds its row and nothing else. */
    const blendParts = group("blend", blendButton, "Current Recipe actions", [blendRow]);
    const blendGroup = blendParts.wrapper;
    const blendFlyout = blendParts.fly;

    rootEl.appendChild(blendGroup);
    rootEl.appendChild(nextGroup);
    rootEl.appendChild(weightsGroup);
    rootEl.appendChild(toolsGroup);
    rootEl.appendChild(printGroup);

    /* Load Next and Copy Current armed and confirmed: the helper keeps
     * which control is armed (one at a time) and what disarms it; the
     * rail draws the state. */
    const arming = armedModule ? armedModule.create({
      doc, controls: { promote: promoteButton, copy: copyButton }, onChange: () => draw(),
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

      rootEl.classList.toggle("is-tools-open", state.tools.open);
      toolsButton.setAttribute("aria-pressed", state.tools.open ? "true" : "false");
      toolsButton.classList.toggle("is-active", state.tools.open);
      toolsButton.disabled = !state.tools.available && !state.tools.open;
      toolsButton.setAttribute("title", state.tools.open
        ? `${LABEL.tools} · open — click to fold the row`
        : (state.tools.available ? `${LABEL.tools} · the console's calculators` : `${LABEL.tools} has nothing to offer on this page`));

      windingButton.setAttribute("aria-pressed", state.winding.active ? "true" : "false");
      windingButton.classList.toggle("is-active", state.winding.active);
      windingButton.disabled = !state.winding.available;
      windingButton.setAttribute("title", !state.winding.available
        ? `${LABEL.winding} is not available on this page`
        : (state.winding.active
          ? `${LABEL.winding} · open — click to close the calculator`
          : `${LABEL.winding} · a starting tension from film thickness and roll width`));

      totalsButton.setAttribute("aria-pressed", state.totals.active ? "true" : "false");
      totalsButton.classList.toggle("is-active", state.totals.active);
      totalsButton.disabled = !state.totals.available;
      totalsButton.setAttribute("title", !state.totals.available
        ? `${LABEL.totals} is not available on this page`
        : (state.totals.active
          ? `${LABEL.totals} · open — click to close`
          : `${LABEL.totals} · pounds of each resin the job consumed`));

      pressureButton.setAttribute("aria-pressed", state.pressure.active ? "true" : "false");
      pressureButton.classList.toggle("is-active", state.pressure.active);
      pressureButton.disabled = !state.pressure.available;
      pressureButton.setAttribute("title", !state.pressure.available
        ? `${LABEL.pressure} is not available on this page`
        : (state.pressure.active
          ? `${LABEL.pressure} · open — click to close the converter`
          : `${LABEL.pressure} · psi to bar, and bar to psi`));

      rootEl.classList.toggle("is-print-open", state.print.open);
      printButton.setAttribute("aria-pressed", state.print.open ? "true" : "false");
      printButton.classList.toggle("is-active", state.print.open);
      printButton.disabled = !state.print.available && !state.print.open;
      printButton.setAttribute("title", state.print.open
        ? `${LABEL.print} · choose Current, Next or Both — click to fold the row`
        : (state.print.available ? `${LABEL.print} · a sheet of the running recipe, the plan, or both` : `${LABEL.print} · nothing to print: no resin in any hopper and nothing planned`));
      printCurrentButton.disabled = !state.print.available;
      printCurrentButton.setAttribute("title", `${LABEL.printCurrent} · the running recipe, layer by layer`);
      for (const [button, label] of [[printNextButton, LABEL.printNext], [printBothButton, LABEL.printBoth]]) {
        button.disabled = !state.print.available || !state.print.planned;
        button.setAttribute("title", state.print.planned ? `${label}` : `${label} · nothing is planned`);
      }

      // Each row unfolds beside its switch only while that face is on:
      // Load Next beside Current Recipe, Copy Current beside Next Recipe,
      // Smart Hoppers beside Weights, the tools beside Tools while its
      // row is open.
      unfold(nextGroup, flyout, state.next.active);
      unfold(weightsGroup, weightsFlyout, state.weights.active);
      unfold(blendGroup, blendFlyout, state.blend.active);
      unfold(toolsGroup, toolsFlyout, state.tools.open);
      unfold(printGroup, printFlyout, state.print.open);
      const selecting = state.selection.active;
      rootEl.classList.toggle("is-selection-open", selecting);
      const promoteArmed = arming.armed() === "promote";
      promoteButton.disabled = !state.promote.available || !state.next.planned || selecting;
      promoteButton.classList.toggle("is-armed", promoteArmed);
      if (promoteArmed) promoteButton.setAttribute("data-armed", "true");
      else promoteButton.removeAttribute("data-armed");
      promoteButton.setAttribute("aria-label", promoteArmed ? `Confirm: load the planned recipe into Current · ${state.promote.summary}` : LABEL.promote);
      promoteButton.setAttribute("title", promoteArmed
        ? `Click again to load the plan into Current · ${state.promote.summary} · receiver weights, tracking and pump state stay with their hoppers; the plan is kept`
        : (!state.promote.available
          ? `${LABEL.promote} is not available: ${state.promote.reason || "no application is connected to Station commands."}`
          : (!state.next.planned
            ? `${LABEL.promote} · nothing is planned`
            : (selecting
              ? `${LABEL.promote} · apply or cancel the hopper edit first`
              : `${LABEL.promote} · ${state.promote.summary || "the plan becomes the running recipe"}`))));
      const copyArmed = arming.armed() === "copy";
      copyButton.disabled = !state.copy.available || selecting;
      copyButton.classList.toggle("is-armed", copyArmed);
      if (copyArmed) copyButton.setAttribute("data-armed", "true");
      else copyButton.removeAttribute("data-armed");
      copyButton.setAttribute("aria-label", copyArmed
        ? `Confirm: copy the running recipe into Next${state.next.planned ? ", replacing what is planned" : ""}`
        : LABEL.copy);
      copyButton.setAttribute("title", copyArmed
        ? `Click again to copy the running recipe into Next${state.next.planned ? " · what is planned is replaced" : ""} · the running job is untouched`
        : (!state.copy.available
          ? `${LABEL.copy} is not available: ${state.copy.reason || "no application is connected to Station commands."}`
          : (selecting
            ? `${LABEL.copy} · apply or cancel the hopper edit first`
            : `${LABEL.copy} · the running recipe becomes the plan${state.next.planned ? ", replacing what is planned" : ""}; the running job is untouched`)));
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
      if (arming.armed() !== "copy") { arming.arm("copy"); return; }
      disarm();
      onCopy();
    });
    toolsButton.addEventListener("click", () => {
      if (toolsButton.disabled) return;
      disarm();
      onTools();
    });
    windingButton.addEventListener("click", () => {
      if (windingButton.disabled) return;
      disarm();
      onWindingTension();
    });
    totalsButton.addEventListener("click", () => {
      if (totalsButton.disabled) return;
      disarm();
      onResinTotals();
    });
    pressureButton.addEventListener("click", () => {
      if (pressureButton.disabled) return;
      disarm();
      onPressure();
    });
    printButton.addEventListener("click", () => {
      if (printButton.disabled) return;
      disarm();
      onPrint();
    });
    for (const [button, which] of [[printCurrentButton, "current"], [printNextButton, "next"], [printBothButton, "both"]]) {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        disarm();
        onPrintRecipe(which);
      });
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
     * @param {object}  [next.next]       { active, available, planned }
     * @param {object}  [next.promote]    { available, reason, summary }
     * @param {object}  [next.copy]       { available, reason }
     * @param {object}  [next.selection]  { active }: a hopper selection is open on the cards
     * @param {object}  [next.tools]      { open, available }
     * @param {object}  [next.winding]    { active, available }
     * @param {object}  [next.totals]     { active, available }
     * @param {object}  [next.pressure]   { active, available }
     * @param {object}  [next.print]      { open, available, planned }
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
      if (n.selection && typeof n.selection === "object") {
        state.selection = { active: !!n.selection.active };
      }
      if (n.tools && typeof n.tools === "object") {
        state.tools = { open: !!n.tools.open, available: !!n.tools.available };
      }
      if (n.winding && typeof n.winding === "object") {
        state.winding = { active: !!n.winding.active, available: !!n.winding.available };
      }
      if (n.totals && typeof n.totals === "object") {
        state.totals = { active: !!n.totals.active, available: !!n.totals.available };
      }
      if (n.pressure && typeof n.pressure === "object") {
        state.pressure = { active: !!n.pressure.active, available: !!n.pressure.available };
      }
      if (n.print && typeof n.print === "object") {
        state.print = { open: !!n.print.open, available: !!n.print.available, planned: !!n.print.planned };
      }
      // A control that stopped being possible while armed is not armed:
      // Load Next stands on the Current face and Copy Current on the Next
      // face, and a hopper selection opening on either drops the arming.
      const selecting = state.selection.active;
      const promoteGone = arming.armed() === "promote" && (!state.promote.available || !state.next.planned || !state.blend.active || selecting);
      const copyGone = arming.armed() === "copy" && (!state.copy.available || !state.next.active || selecting);
      if (arming.armed() && (promoteGone || copyGone || state.hidden || state.withdrawn)) disarm();
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
      blendRow,
      nextRow,
      toolsButton,
      windingButton,
      totalsButton,
      pressureButton,
      toolsGroup,
      toolsFlyout,
      toolsRow,
      printButton,
      printCurrentButton,
      printNextButton,
      printBothButton,
      printGroup,
      printFlyout,
      printRow,
      update,
      disarm,
      isArmed: () => !!arming.armed(),
      armedControl: () => arming.armed(),
      getState: () => ({
        hidden: state.hidden, withdrawn: state.withdrawn, armedControl: arming.armed(),
        blend: Object.assign({}, state.blend), weights: Object.assign({}, state.weights),
        smart: Object.assign({}, state.smart),
        next: Object.assign({}, state.next), promote: Object.assign({}, state.promote), copy: Object.assign({}, state.copy),
        selection: Object.assign({}, state.selection),
        tools: Object.assign({}, state.tools), winding: Object.assign({}, state.winding), totals: Object.assign({}, state.totals),
        pressure: Object.assign({}, state.pressure),
        print: Object.assign({}, state.print)
      })
    };
  }

  return Object.freeze({ ARM_DURATION, TILE, LABEL, blendGlyph, weightsGlyph, smartGlyph, nextGlyph, promoteGlyph, copyGlyph, toolsGlyph, windingGlyph, totalsGlyph, pressureGlyph, printGlyph, printCurrentGlyph, printNextGlyph, printBothGlyph, create });
});
