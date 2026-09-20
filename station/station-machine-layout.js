/* Where every piece of the layer equipment sits, as numbers.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE ARTWORK
 *
 * The first review of a schematic is always "the mixer is too big", "the banks
 * need more spacing", "the angle is too strong". Those have to be cheap. If the
 * coordinates live inside the path data, every one of them is a rewrite of
 * unrelated geometry; here each is one number in DIMENSIONS, and everything
 * that depends on it follows.
 *
 * WHAT THIS VIEW SHOWS
 *
 * The resin-handling and extrusion side only:
 *
 *     hopper cluster  ->  mixer  ->  extruder
 *
 * repeated once per configured layer. There is no die, tower, bubble or
 * winder: convergence toward a common extrusion process is implied by angling
 * the extruders inward, not by drawing the equipment they feed.
 *
 * COORDINATE SYSTEM
 *
 * viewBox units, y increasing downward. Width comes from the configuration;
 * height is fixed, so a wider line scales down rather than reflowing into
 * something unrecognizable.
 */
(function (root, factory) {
  const deps = {
    extruderAssets: typeof require === "function"
      ? require("./station-extruder-assets.js")
      : (root && root.PolynStationExtruderAssets),
    mixerAssets: typeof require === "function"
      ? require("./station-mixer-assets.js")
      : (root && root.PolynStationMixerAssets),
    tsmAssets: typeof require === "function"
      ? require("./station-tsm-assets.js")
      : (root && root.PolynStationTsmAssets)
  };
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationMachineLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  /* The mixer and the extruder are authored artwork, placed rather than
   * drawn: the layout needs their measurements (bounds, anchors) and nothing
   * else. */
  const extruderAssets = deps.extruderAssets;
  const mixerAssets = deps.mixerAssets;
  const tsmAssets = deps.tsmAssets || null;

  /* The blender a layer's bank feeds, by the line model's word for it:
   * the batch mixer (station-mixer-assets.js), or the TSM gravimetric
   * blender (station-tsm-assets.js) on the lines that run one. Without
   * the TSM module every layer gets the mixer. */
  function blenderOf(layer) {
    return layer && layer.blender === "tsm" && tsmAssets ? "tsm" : "batch";
  }
  function blenderAssets(blender) {
    return blender === "tsm" ? tsmAssets : mixerAssets;
  }
  /* The TSM blender comes in two: the six-loader machine with its side
   * storage (the 5A and A6 wedges), and the four-loader core machine
   * without. A bank of more than four loaders gets the storage. */
  const CORE_LOADERS = 4;
  function blenderVariant(layer) {
    return blenderOf(layer) === "tsm" && Number(layer.hopperCount) <= CORE_LOADERS && tsmAssets.core ? "core" : "storage";
  }
  function blenderViews(layer) {
    const blender = blenderOf(layer);
    if (blender === "tsm" && blenderVariant(layer) === "core") return tsmAssets.core.views;
    return blenderAssets(blender).views;
  }

  /* Every dimension the composition depends on. Corrections belong here, not
   * in path data. Values are viewBox units. */
  const DIMENSIONS = Object.freeze({
    /* Tall enough for the equipment train at the masters' own scale: hopper
     * stack, the batch mixer (185 units at UNIT 0.42), the extruder and its
     * readout, with the read-only notice under that when a layer is open. */
    height: 740,
    padding: 34,

    // --- Hopper ---------------------------------------------------------
    hopperWidth: 30,
    hopperGap: 6,
    /* The TSM bank's loaders are short drums, every one the same: drawn
     * this tall, whatever a profile says, on the vessel's inch scale. */
    tsmVesselHeightIn: 12,

    /* Bodies are BOTTOM-aligned. The discharge geometry - flat plate, hose -
     * sits at one fixed height above the mixer for every hopper on the bank,
     * because that is where they physically all discharge into it. A taller vessel
     * therefore grows upward, taking its receiver with it, which is exactly
     * how a bank of mixed-height hoppers looks on the floor. */
    vesselBottom: 320,
    /* The vessel's true proportions. The drawn hopper width IS the vessel's
     * outside diameter, and that diameter comes from the measured
     * circumference of the receivers on the floor. Every vertical inch -
     * usable height, headroom, clamp-band spacing - is drawn on the scale
     * that implies, so a profiled hopper is the same shape on screen as it is
     * in the plant. See unitsPerInch(). */
    vesselCircumferenceIn: 36.25,
    /* Usable inches (cone shoulder to fill valve) drawn when a hopper has no
     * profile height, and the range a profile value is clamped to so an
     * unreasonable entry cannot push a receiver off the canvas or collapse a
     * body to nothing. */
    defaultUsableHeightIn: 30,
    vesselMinUsableHeightIn: 8,
    vesselMaxUsableHeightIn: 48,
    // Drawing allowance above the measured fill valve (1.5 twelve-inch
    // sections). This is not added to stored usable height or calculations.
    vesselHeadroomIn: 18,
    // Physical distance between vessel clamp bands. Adjust this to tune the
    // section model; it uses the same inches-to-drawing scale as body height.
    vesselSectionHeightIn: 12,

    receiverHeight: 30,
    receiverGap: 8,             // neck between the receiver cone and the vessel
    sourceGap: 9,               // the source label sits above the receiver

    /* The discharge below the flat bottom plate. On this floor there is no
     * visible cone: a clear spiral hose hangs from an outlet flange and fills
     * the space down to the caption. The two lengths are kept under their
     * original names - together they are the span the hose fills - so the
     * bank's vertical rhythm is exactly what it was with the cone. */
    coneHeight: 26,
    spoutHeight: 12,
    // The hose's outside diameter, drawn on the vessel's own inch scale.
    hoseDiameterIn: 3,
    // The compact readout under each hopper: id, blend and the receiver
    // weight (three lines at 13/12 units). No resin line: the resin is
    // said by the hover panel and the editor. The height keeps the room
    // the fourth line had: it is the blend card's box too.
    hopperCaptionGap: 12,
    hopperCaptionHeight: 46,

    // --- Bank -----------------------------------------------------------
    bankPadding: 14,
    bankMinWidth: 132,
    bankGap: 30,
    headerTop: 22,

    // --- Mixer ----------------------------------------------------------
    /* Authored artwork, placed - see station-mixer-assets.js. Three views of
     * one batch mixer, carried whole from the masters by
     * tools/station-mixer/derive.js at the masters' own assembly scale, in
     * stage units with the discharge at the origin. The layout hangs the
     * machine from `mixerTop` and puts the extruder's feed anchor on its
     * discharge: the mixer's own outlet flange sits on the extruder's feed
     * flange, exactly as the masters' assembly previews stack them.
     *
     * There is deliberately NO funnel between the bank and the blender. The
     * real connection is hose and material routing, which this view does not
     * draw; a bank-width funnel was inventing a piece of equipment to make
     * the drawing look continuous. The hoppers simply end above the mixer,
     * with the caption's four lines and a 10-unit clearance between.
     */
    mixerTop: 426,
    /* The TSM train is a machine taller - the downcomer stands between
     * the blender and the extruder - and its loaders are short, so the
     * whole bank is hung higher: the discharge line and the blender's top
     * from here, and the extruder's feed lands where it lands under the
     * batch mixer. */
    tsmVesselBottom: 204,
    tsmMixerTop: 310,
    // Multiplier on the asset's native stage-unit size, for tuning.
    mixerScale: 1,
    /* The throat: the only thing drawn BETWEEN the two machines - a dark
     * neck `mixerFeedGap` tall from the mixer's discharge flange down to
     * the extruder's feed flange, with a contact shadow where it lands.
     * The masters mount the discharge flange directly on the feed flange,
     * so the gap is ZERO and the neck collapses to nothing; only the
     * contact shadow remains, tucked under the flange. The machinery stays
     * because it is one number to open the gap again. */
    mixerFeedGap: 0,
    throatWidth: 13,
    throatShadowRx: 13,
    throatShadowRy: 3.5,

    // --- Extruder -------------------------------------------------------
    /* Authored artwork, placed - not a procedural drawing.
     *
     * Three views of one machine (front, intermediate, angled) come from
     * station-extruder-assets.js, already in stage units with the feed
     * anchor at their origin. The layout's whole job is to pick a view for
     * the layer's position in the stack, mirror it for the left-hand side,
     * and put its origin under the mixer neck. Which view a layer gets is
     * decided in equipmentView(); how it is placed in assetPlacement().
     */
    // Multiplier on the asset's native stage-unit size, for tuning. The
    // machine's SIZE and PROPORTION are not decided here: the masters are
    // generated by tools/extruder-svg/generate.py (section scale, barrel
    // stretch ahead of the fixed feed flange and motor end) and carried to
    // stage units at a fixed UNIT by tools/station-extruder/derive.js.
    extruderScale: 1,
    // The layer-share readout sits this far under the lowest foot.
    extruderLabelGap: 14,

    /* A line narrower than this ratio is CENTRED on the canvas rather than
     * stretched to fill it: the equipment that exists stays the same size, and
     * a one-layer line sits in the middle instead of being blown up. */
    /* This view is much narrower than a full line, so the old 1.55 left a
     * one-layer machine marooned in empty canvas. At 1.0 a narrow line scales
     * up to use the height it has, and a five-layer line still runs wide. */
    minAspect: 1.0,

    // --- Focus ----------------------------------------------------------
    /* The expanded state is a WINDOW OPENING, not a re-layout.
     *
     * A bank is two rigid objects - its hopper cluster (with the layer's
     * header) and its equipment train (mixer, throat, extruder) - and
     * focusing a layer moves those two objects, whole, into a workspace:
     * the train to the left edge, the cluster beside it, and the rest of
     * the canvas reserved for the editing surface that a later phase will
     * design. Both objects are drawn at `focusScale`, vertically centred on
     * the canvas. Nothing changes shape: every dimension the bank is built
     * from scales by the one factor (see bankDimensions()), so a hopper
     * cannot widen without getting taller, a receiver cannot squash, and
     * mixer and extruder keep exactly their authored proportions.
     *
     * The other banks become secondary: drawn at `dimScale` about their own
     * centre, moved `focusRetreat` outward from the focused layer, and faded
     * (the opacity is the stylesheet's). They keep their normal positions
     * otherwise, so the transition that carries a layer into focus and back
     * (station-transition.js) has a real place to return everything to.
     *
     * The canvas is the STAGE'S OWN SHAPE - its height times the aspect the
     * renderer measures on the mount - so the focused layout fills the
     * stage edge to edge and is drawn at the scale the stage's height
     * allows, never letterboxed smaller. `focusAspect` is the fallback when
     * nothing can be measured. The canvas is never narrower than the three
     * columns need, with `workspaceMin` for the workspace: the narrowest
     * the focused editor's rows can be drawn without truncating their
     * quiet placeholders ("Add resin", "Add source"), which only binds on
     * a compact stage - a wide one gives the workspace the rest of the
     * canvas.
     */
    focusScale: 1.25,
    dimScale: 0.9,
    focusRetreat: 90,
    focusAspect: 1.5,
    workspaceMin: 280,
    // Left edge to the train, and the gutters between the three columns.
    focusPadding: 40,
    focusColumnGap: 48
  });

  /* --------------------------------------------------------------------
   *   Extruder convergence
   * ------------------------------------------------------------------ */

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /**
   * Which authored view a layer's equipment gets from its position in the
   * stack. A single-layer train uses the angled view to show the equipment's
   * depth; multi-layer trains turn inward by ring. Never derive a view from
   * the layer's letter.
   *
   * The views are discrete perspective STATES, not samples of a continuous
   * angle: a layer is either on the centreline (front), one ring out
   * (intermediate, 30 degrees), or further out (angled, 60 degrees). Rings
   * are distinct distances from the centre, nearest first. So a three-layer
   * line is intermediate / front / intermediate, a five-layer line angled /
   * intermediate / front / intermediate / angled, and a seven-layer line has
   * two angled rings each side. A stack with no centre layer - an even
   * count - has no front view at all. These are the masters' own suggested
   * views (images/mixer/README.md).
   *
   * MIRRORING is a flag, not artwork. Every view is authored with its near
   * end toward the viewer's left, which is the turn a machine RIGHT of centre
   * makes to face the core; a machine left of centre is the same view
   * mirrored. Which side a layer is on is `offset < 0`, and nothing else.
   *
   * @returns {{view: string, mirrored: boolean, side: string, key: string, ring: number}}
   *   `key` is the human form: "front", "intermediate-left", "angled-right".
   */
  function equipmentView(index, layerCount) {
    if (!Number.isInteger(layerCount) || layerCount < 1 || !Number.isInteger(index)) {
      return { view: "front", mirrored: false, side: "centre", key: "front", ring: 0 };
    }
    if (layerCount === 1 && index === 0) {
      return { view: "angled", mirrored: false, side: "right", key: "angled-right", ring: 2 };
    }
    const centre = (layerCount - 1) / 2;
    const offset = index - centre;
    const distances = [...new Set(
      Array.from({ length: layerCount }, (_, i) => Math.abs(i - centre)))].sort((a, b) => a - b);
    // Ring 0 is the centreline itself. If no layer sits on it, the nearest
    // ring is still ring 1: it is turned, just not much.
    const ring = distances.indexOf(Math.abs(offset)) + (distances[0] === 0 ? 0 : 1);
    // A layer one ring out is turned 30 degrees; from two rings out, 60 -
    // so a three-layer line is 30/0/30 and only the fourth ring of a
    // five-layer line reaches 60. The masters' own suggested views.
    const view = ring === 0 ? "front" : ring === 1 ? "intermediate" : "angled";
    const side = offset < 0 ? "left" : offset > 0 ? "right" : "centre";
    return {
      view,
      mirrored: offset < 0,
      side,
      key: side === "centre" ? view : `${view}-${side}`,
      ring
    };
  }

  /**
   * Where one piece of authored equipment goes, from its view and the point
   * its anchor lands on.
   *
   * An asset's origin IS its anchor (the extruder's feed flange, the mixer's
   * discharge), so placement is a translate to (centerX, anchorY), a uniform
   * scale, and for a left-hand layer a sign flip in x. The anchor therefore
   * lands on the layer's centreline at every view by construction - it is
   * the one point that cannot move - and only the machine around it swings.
   * Nothing is rotated in the screen plane.
   *
   * Returns numbers only. The renderer applies the same mapping to the
   * asset's polygons; the two agree because they read the same three values.
   *
   * @param {string}  view      "front" | "intermediate" | "angled"
   * @param {boolean} mirrored
   * @param {object}  asset     a view from station-*-assets.js
   * @param {object}  options   { centerX, anchorY, scale, labelGap }
   */
  function assetPlacement(view, mirrored, asset, options) {
    const settings = options || {};
    const scale = settings.scale === undefined ? 1 : settings.scale;
    const centerX = settings.centerX === undefined ? 0 : settings.centerX;
    const anchorY = settings.anchorY === undefined ? 0 : settings.anchorY;
    const labelGap = settings.labelGap === undefined ? DIMENSIONS.extruderLabelGap : settings.labelGap;
    const sign = mirrored ? -1 : 1;
    const x = value => centerX + sign * scale * value;
    const y = value => anchorY + scale * value;
    const b = asset.bounds;
    const edges = [x(b.left), x(b.right)];
    const bounds = {
      left: Math.min(edges[0], edges[1]),
      right: Math.max(edges[0], edges[1]),
      top: y(b.top),
      bottom: y(b.bottom)
    };

    return {
      view,
      mirrored,
      sign,
      // Signed like a compass: negative for a machine left of centre.
      yaw: sign * asset.yaw,
      scale,
      anchor: { x: centerX, y: anchorY },
      outlet: { x: x(asset.outlet.x), y: y(asset.outlet.y) },
      inlet: asset.inlet ? { x: x(asset.inlet.x), y: y(asset.inlet.y) } : null,
      bounds,
      // The bounds again, in the shape every other component reports.
      x: bounds.left,
      y: bounds.top,
      width: (b.right - b.left) * scale,
      height: (b.bottom - b.top) * scale,
      centerX,
      // A readout under the machine, on the layer centreline, upright.
      label: { x: centerX, y: y(b.bottom) + labelGap }
    };
  }

  /**
   * Drawing units per physical inch, for a bank drawn from `dimensions`.
   *
   * The hopper is drawn `hopperWidth` units wide and that width stands for the
   * vessel's outside diameter, circumference / pi. Dividing the two gives the
   * one scale every vertical measurement on the vessel is drawn on, so a
   * 26" body on an 11.5" vessel is drawn 2.25 times taller than it is wide -
   * its true shape - rather than on some unrelated vertical scale. Because
   * hopperWidth is a bank length, the scale follows rigid bank scaling for
   * free: a focused bank is the same shape drawn larger.
   */
  function unitsPerInch(dimensions) {
    const d = dimensions || DIMENSIONS;
    return d.hopperWidth / (d.vesselCircumferenceIn / Math.PI);
  }

  /**
   * The complete drawn vessel body. Receiver Weight Profile usable height
   * measures from the top of the cone to the fill valve, not to the lid;
   * the unmeasured headroom above that valve is a drawing allowance.
   *
   * One linear scale shared by every hopper on every line - a hopper profiled
   * at 42" is always drawn taller than one at 30", wherever it is - and clamped
   * at both ends so an unreasonable profile value cannot push a receiver off
   * the top of the canvas or collapse a body to nothing. The clamp is applied
   * to the usable inches, before the headroom, so a clamped body still shows
   * its full drawing allowance above the valve.
   *
   * Missing, zero, negative or non-finite input means "not profiled", and falls
   * back to the default body. That is deliberately not an error: volume-geometry
   * lines have no usable height at all, and a hopper nobody has measured yet is
   * the normal state of a new line.
   */
  function hopperBodyHeight(usableHeightIn, dimensions) {
    const d = dimensions || DIMENSIONS;
    const inches = Number(usableHeightIn);
    const usable = Number.isFinite(inches) && inches > 0
      ? clamp(inches, d.vesselMinUsableHeightIn, d.vesselMaxUsableHeightIn)
      : d.defaultUsableHeightIn;
    return (usable + d.vesselHeadroomIn) * unitsPerInch(d);
  }

  function bankInnerWidth(hopperCount, hopperWidth, hopperGap) {
    return hopperCount * hopperWidth + Math.max(0, hopperCount - 1) * hopperGap;
  }

  /* --------------------------------------------------------------------
   *   Rigid scaling
   * ------------------------------------------------------------------ */

  /* Every dimension a bank is built from that is a LENGTH, and so scales with
   * the bank. Anything not listed is a ratio, a count, or a canvas-level
   * number, and is left alone. */
  const BANK_LENGTHS = Object.freeze([
    "hopperWidth", "hopperGap",
    /* Vessel heights are not listed: they are inches, drawn through
     * unitsPerInch(), which scales with hopperWidth. */
    "receiverHeight", "receiverGap", "sourceGap",
    "coneHeight", "spoutHeight", "hopperCaptionGap", "hopperCaptionHeight",
    "bankPadding", "bankMinWidth",
    "mixerFeedGap", "throatWidth", "throatShadowRx", "throatShadowRy", "extruderLabelGap",
    // The asset multipliers are lengths per stage unit, so they scale too.
    "mixerScale", "extruderScale"
  ]);
  /* The three absolute vertical positions a bank hangs from. Everything else
   * vertical is derived from these plus lengths. */
  const BANK_ANCHORS = Object.freeze(["headerTop", "vesselBottom", "mixerTop", "tsmVesselBottom", "tsmMixerTop"]);

  /**
   * The dimensions for one bank drawn at `scale`, scaled about `pivotY`.
   *
   * This is what makes a bank rigid. A bank is laid out from these numbers
   * and nothing else, so scaling all of them by one factor scales the whole
   * assembly by that factor - width and height together, hoppers and
   * receivers and machines alike - and there is no way to widen one part
   * without the rest. Ratios (the resin threshold) and counts are untouched.
   */
  function bankDimensions(d, scale, pivotY) {
    const out = Object.assign({}, d, { bankScale: scale });
    for (const key of BANK_LENGTHS) out[key] = d[key] * scale;
    for (const key of BANK_ANCHORS) out[key] = pivotY + (d[key] - pivotY) * scale;
    return out;
  }

  /* The slots a bank is built to: the layer's own, or its hoppers when the
   * model gave it none. A four-hopper core on a six-slot line keeps the
   * six-wide bank, so the machine's spacing and the layer's card are the
   * same whatever a layer's count. */
  function bankSlotCount(layer) {
    const slots = Number(layer.slotCount);
    return Number.isInteger(slots) && slots >= layer.hopperCount ? slots : layer.hopperCount;
  }

  /* A bank's width from its slot count alone - needed before it is placed. */
  function bankWidth(layer, d) {
    const inner = bankInnerWidth(bankSlotCount(layer), d.hopperWidth, d.hopperGap);
    return Math.max(inner + d.bankPadding * 2, d.bankMinWidth);
  }

  /* --------------------------------------------------------------------
   *   One layer bank
   * ------------------------------------------------------------------ */

  /* `d` is this bank's own dimensions - already scaled for its emphasis by
   * bankDimensions() - so nothing in here knows or cares whether the bank is
   * focused, dimmed or plain. Emphasis only decides how much detail is drawn. */
  /* `composition`, when given, moves the bank's two rigid objects apart: the
   * cluster (with the header) by `cluster`, the train (mixer, throat,
   * extruder, readout) by `train`, each {dx, dy} from where the bank would
   * put them. That is the whole of the focus composition: two objects
   * carried to new places, unchanged. */
  function layoutBank(layer, x, d, emphasis, index, layerCount, hopperState, composition) {
    const scale = d.bankScale === undefined ? 1 : d.bankScale;
    const hopperWidth = d.hopperWidth;
    const hopperGap = d.hopperGap;
    // The cluster's column is the bank's slots; the hoppers, fewer or as
    // many, stand centred in it.
    const inner = bankInnerWidth(bankSlotCount(layer), hopperWidth, hopperGap);
    const hoppersInner = bankInnerWidth(layer.hopperCount, hopperWidth, hopperGap);
    const width = bankWidth(layer, d);
    const move = Object.assign({ cluster: { dx: 0, dy: 0 }, train: { dx: 0, dy: 0 } }, composition || {});
    const bankCenterX = x + width / 2;
    // The cluster's centreline and the train's: one and the same unless the
    // composition has carried them apart.
    const centerX = bankCenterX + move.cluster.dx;
    const trainX = bankCenterX + move.train.dx;
    const headerY = d.headerTop + move.cluster.dy;
    // Which blender: the batch mixer, or the TSM blender on its lines. A
    // TSM bank hangs higher: its train has the downcomer in it.
    const blender = blenderOf(layer);
    const mixerTop = (blender === "tsm" ? d.tsmMixerTop : d.mixerTop) + move.train.dy;
    const clusterX = centerX - inner / 2;
    const hoppersX = centerX - hoppersInner / 2;
    // The discharge line: fixed for every hopper on the bank, whatever its
    // body height, because that is where they all feed the mixer.
    const coneTop = (blender === "tsm" ? d.tsmVesselBottom : d.vesselBottom) + move.cluster.dy;

    /* Mixer and extruder turn together. Both are authored artwork hung from
     * anchors and scale whole with the bank. */
    const facing = equipmentView(index, layerCount);
    const mixerScale = d.mixerScale;
    const extruderScale = d.extruderScale;
    const mixerAsset = blenderViews(layer)[facing.view];
    const mixer = assetPlacement(facing.view, facing.mirrored, mixerAsset, {
      centerX: trainX,
      // Hung from the top: the discharge lands wherever the machine's height
      // puts it, and the extruder follows.
      anchorY: mixerTop - mixerAsset.bounds.top * mixerScale,
      scale: mixerScale
    });
    mixer.blender = blender;
    mixer.variant = blender === "tsm" ? blenderVariant(layer) : null;
    /* The downcomer, on TSM lines: hung from the blender's discharge - its
     * inlet on the discharge, its outlet where the extruder's feed then
     * lands - at the blender's scale and view. None on a batch line. */
    const downcomerAsset = blender === "tsm" && tsmAssets && tsmAssets.downcomer ? tsmAssets.downcomer.views[facing.view] : null;
    const downcomer = downcomerAsset ? assetPlacement(facing.view, facing.mirrored, downcomerAsset, {
      centerX: trainX,
      anchorY: mixer.outlet.y - downcomerAsset.inlet.y * mixerScale,
      scale: mixerScale
    }) : null;
    // The extruder's feed anchor sits under the train's last discharge -
    // the downcomer's, or the mixer's - the throat's length below it.
    const feedFrom = downcomer || mixer;
    const extruderTop = feedFrom.outlet.y + d.mixerFeedGap;
    const throat = {
      x: trainX - d.throatWidth / 2,
      y: feedFrom.outlet.y,
      width: d.throatWidth,
      height: d.mixerFeedGap,
      centerX: trainX,
      // The contact shadow, on the extruder's feed flange where the throat lands.
      shadow: { cx: trainX, cy: extruderTop, rx: d.throatShadowRx, ry: d.throatShadowRy }
    };
    const extruder = assetPlacement(facing.view, facing.mirrored, extruderAssets.views[facing.view], {
      // The feed anchor lands exactly here for every layer and every view:
      // it is the asset's origin, so only the machine around it swings.
      centerX: trainX,
      anchorY: extruderTop,
      scale: extruderScale,
      labelGap: d.extruderLabelGap
    });

    // The vessel's inch scale for this bank: true proportions at this width.
    const inchScale = unitsPerInch(d);
    // A TSM bank's loaders: short drums, all one height, whatever a profile
    // says - the machine's own, not a measurement.
    const tsm = blender === "tsm";
    const hoppers = layer.hoppers.map((hopper, hopperIndex) => {
      const runtime = hopperState ? hopperState[`${layer.id}:${hopper.index}`] : null;
      // Drawn to the Receiver Weight Profile, growing upward from the shared
      // discharge line; on a TSM bank to the loader's own height.
      const vesselHeight = tsm ? d.tsmVesselHeightIn * inchScale : hopperBodyHeight(runtime ? runtime.usableHeight : null, d);
      const vesselTop = coneTop - vesselHeight;
      const fillValveY = tsm ? vesselTop + vesselHeight * 0.5 : vesselTop + d.vesselHeadroomIn * inchScale;
      const receiverTop = vesselTop - d.receiverGap - d.receiverHeight;
      return {
        id: hopper.id,
        index: hopper.index,
        positionLabel: hopper.positionLabel,
        x: hoppersX + hopperIndex * (hopperWidth + hopperGap),
        width: hopperWidth,
        // Centre-to-centre distance to the next hopper: what a control that
        // has to be wider than its hopper is sized against.
        pitch: hopperWidth + hopperGap,
        // Above the receiver: where the material is connected from.
        sourceY: receiverTop - d.sourceGap,
        receiverTop,
        receiverHeight: d.receiverHeight,
        vesselTop,
        vesselHeight,
        fillValveY,
        vesselSectionHeight: d.vesselSectionHeightIn * inchScale,
        // The discharge hose, at true diameter against the vessel.
        hoseWidth: d.hoseDiameterIn * inchScale,
        // Whether this hopper was profiled at all, so the drawing can be honest
        // about a default rather than implying a measurement. A TSM loader's
        // height is the machine's: nothing to profile.
        profiled: tsm || !!(runtime && Number(runtime.usableHeight) > 0),
        coneTop,
        coneHeight: d.coneHeight,
        spoutTop: coneTop + d.coneHeight,
        spoutHeight: d.spoutHeight,
        captionTop: coneTop + d.coneHeight + d.spoutHeight + d.hopperCaptionGap,
        captionHeight: d.hopperCaptionHeight
      };
    });

    return {
      id: layer.id,
      role: layer.role,
      roleLabel: layer.roleLabel,
      stackIndex: layer.stackIndex,
      recipeIndex: layer.recipeIndex,
      emphasis,
      scale,
      // The bank's column: where its cluster stands. In the normal row that
      // is the whole bank; in focus the train has its own place (below).
      x: x + move.cluster.dx,
      width,
      centerX,
      header: { x: centerX, y: headerY },
      cluster: {
        x: clusterX,
        // Bodies differ in height, so the cluster's top is whichever hopper
        // reaches highest - there is no single receiver line any more.
        y: hoppers.reduce((top, h) => Math.min(top, h.sourceY - 8), Infinity),
        width: inner,
        bottom: coneTop + d.coneHeight + d.spoutHeight,
        hopperWidth,
        hoppers
      },
      /* Where the layer's blend card ends (station-machine-parts.js,
       * blendCardBox): the BATCH bank's caption bottom, on every blender.
       * A card is a sheet of rows, and it needs the same room whatever
       * hangs under it; the TSM bank's short loaders and higher discharge
       * line would leave it a third shorter, so it is sized to the batch
       * geometry instead - the default card - and on a TSM line stands over
       * the top of the blender. Moves with the cluster in a composition. */
      cardBottom: d.vesselBottom + d.coneHeight + d.spoutHeight + d.hopperCaptionGap + d.hopperCaptionHeight + move.cluster.dy,
      // Which way this layer's mixer and extruder face.
      facing,
      mixer,
      // The downcomer under a TSM blender; null on a batch line.
      downcomer,
      throat,
      extruder,
      /* The bank's two RIGID OBJECTS, as boxes in canvas units. These are
       * what the transition carries between layouts (station-transition.js
       * reads them off the markup): each is the same shape in every layout,
       * only placed and scaled differently, which is what lets an object be
       * moved as one thing rather than re-drawn. `objects.cluster` is the
       * header and the hoppers; `objects.train` the mixer, throat, extruder
       * and readout. */
      objects: {
        cluster: {
          x: clusterX,
          y: headerY - 12 * scale,
          width: inner,
          height: coneTop + d.coneHeight + d.spoutHeight + d.hopperCaptionGap + d.hopperCaptionHeight - (headerY - 12 * scale)
        },
        train: {
          x: Math.min(mixer.bounds.left, extruder.bounds.left, downcomer ? downcomer.bounds.left : Infinity),
          y: mixer.bounds.top,
          width: Math.max(mixer.bounds.right, extruder.bounds.right, downcomer ? downcomer.bounds.right : -Infinity)
            - Math.min(mixer.bounds.left, extruder.bounds.left, downcomer ? downcomer.bounds.left : Infinity),
          height: extruder.label.y + 6 * scale - mixer.bounds.top,
          centerX: trainX
        }
      }
    };
  }

  /* --------------------------------------------------------------------
   *   The whole stage
   * ------------------------------------------------------------------ */

  /**
   * @param {object} model      from station-line-model.js
   * @param {object} [options]
   * @param {string} [options.focusLayer]  layer id to expand, or null
   * @param {object} [options.dimensions]  DIMENSIONS overrides
   * @param {number} [options.stageAspect] width/height of the stage the canvas fills (focus only)
   */
  function computeLayout(model, options) {
    if (!model || !Array.isArray(model.layers) || !model.layers.length) return null;
    const settings = options || {};
    const d = Object.assign({}, DIMENSIONS, settings.dimensions || {});
    const focusLayer = settings.focusLayer || null;
    const hopperState = settings.hopperState || null;

    if (focusLayer && model.layers.some(layer => layer.id === focusLayer)) {
      const aspect = Number.isFinite(settings.stageAspect) && settings.stageAspect > 0 ? settings.stageAspect : d.focusAspect;
      return placeFocused(d, model, focusLayer, hopperState, aspect);
    }

    // Laid out twice: once to measure the row, then again shifted so it sits
    // centred on a canvas that respects minAspect. Two cheap passes beat
    // threading an offset through every placement.
    const natural = place(d, model, 0, undefined, hopperState);
    const canvasWidth = Math.max(natural.width, d.height * d.minAspect);
    return place(d, model, (canvasWidth - natural.width) / 2, canvasWidth, hopperState);
  }

  /* The normal row: every bank at scale 1, in physical order, centred. */
  function place(d, model, offset, canvasWidth, hopperState) {
    const layerCount = model.layers.length;
    const bankD = bankDimensions(d, 1, d.height / 2);
    const banks = [];
    let cursor = d.padding + offset;

    model.layers.forEach((layer, index) => {
      const bank = layoutBank(layer, cursor, bankD, "normal", index, layerCount, hopperState);
      banks.push(bank);
      cursor += bank.width + d.bankGap;
    });

    const rowWidth = cursor - d.bankGap - d.padding - offset;
    const naturalRight = d.padding + offset + rowWidth + d.padding;

    return {
      dimensions: d,
      width: canvasWidth === undefined ? naturalRight : canvasWidth,
      height: d.height,
      focusLayer: null,
      row: { x: d.padding + offset, width: rowWidth, banks },
      // Kept as its own field so callers do not have to know it is row.banks.
      banks,
      // Painted in physical order; nothing overlaps.
      paintOrder: banks.map((_, index) => index)
    };
  }

  /* The focus composition: the chosen bank's train at the left edge, its
   * cluster beside it, the rest of the canvas reserved as the workspace;
   * the other banks smaller, faded, and moved a little outward from where
   * they were. See the Focus notes in DIMENSIONS. */
  function placeFocused(d, model, focusLayer, hopperState, stageAspect) {
    const layerCount = model.layers.length;
    const focusIndex = model.layers.findIndex(layer => layer.id === focusLayer);
    const pivotY = d.height / 2;

    // The normal row is the reference: ghosts retreat from where they stand
    // there.
    const normal = computeLayout(model, { dimensions: d, hopperState });

    /* The focused bank: laid out once where it stands, to learn the size of
     * its two objects at focus scale, then again with each object carried to
     * its column and centred on the canvas height. */
    const focusedD = bankDimensions(d, d.focusScale, pivotY);
    const layer = model.layers[focusIndex];
    const probe = layoutBank(layer, normal.banks[focusIndex].x, focusedD, "focused", focusIndex, layerCount, hopperState);
    const train = probe.objects.train;
    const cluster = probe.objects.cluster;
    /* The train column is as wide as the widest VIEW of the train, not this
     * layer's, so the columns are in the same place whichever layer opens
     * and a turned machine and a front-on one share one workspace. */
    // Every machine the line's blender can put in the train, at every view:
    // the batch mixer, or the TSM blender and its downcomer.
    const trainMachines = view => {
      const machines = [];
      if (blenderOf(layer) === "tsm") {
        machines.push({ bounds: blenderViews(layer)[view].bounds, scale: focusedD.mixerScale });
        if (tsmAssets.downcomer) machines.push({ bounds: tsmAssets.downcomer.views[view].bounds, scale: focusedD.mixerScale });
      } else {
        machines.push({ bounds: mixerAssets.views[view].bounds, scale: focusedD.mixerScale });
      }
      machines.push({ bounds: extruderAssets.views[view].bounds, scale: focusedD.extruderScale });
      return machines;
    };
    const trainColumn = Math.max(train.width, ...Object.keys(mixerAssets.views).map(view => {
      const machines = trainMachines(view);
      return Math.max(...machines.map(m => m.bounds.right * m.scale)) - Math.min(...machines.map(m => m.bounds.left * m.scale));
    }));
    const trainLeft = d.focusPadding + (trainColumn - train.width) / 2;
    const clusterLeft = d.focusPadding + trainColumn + d.focusColumnGap;
    const workspaceLeft = clusterLeft + cluster.width + d.focusColumnGap;
    // The stage's own shape, or as wide as the three columns need.
    const canvasWidth = Math.max(d.height * stageAspect, workspaceLeft + d.workspaceMin + d.focusPadding);
    const offset = (canvasWidth - normal.width) / 2;
    const centreOn = box => pivotY - (box.y + box.height / 2);
    const focused = layoutBank(layer, normal.banks[focusIndex].x, focusedD, "focused", focusIndex, layerCount, hopperState, {
      cluster: { dx: clusterLeft - cluster.x, dy: centreOn(cluster) },
      train: { dx: trainLeft - train.x, dy: centreOn(train) }
    });

    const banks = new Array(layerCount);
    banks[focusIndex] = focused;
    const ghostD = bankDimensions(d, d.dimScale, pivotY);
    model.layers.forEach((other, index) => {
      if (index === focusIndex) return;
      const was = normal.banks[index];
      const width = bankWidth(other, ghostD);
      // Smaller about its own centre, and a step further from the focused
      // layer on the side it is already on.
      const away = index < focusIndex ? -d.focusRetreat : d.focusRetreat;
      const x = offset + was.centerX - width / 2 + away;
      banks[index] = layoutBank(other, x, ghostD, "dimmed", index, layerCount, hopperState);
    });

    const left = Math.min(...banks.map(bank => bank.x));
    const right = Math.max(...banks.map(bank => bank.x + bank.width));
    return {
      dimensions: d,
      width: canvasWidth,
      height: d.height,
      focusLayer,
      row: { x: left, width: right - left, banks },
      banks,
      /* The reserved editing surface: placed, not designed. Its geometry is
       * the point - a later phase fills it - so it is a box and a label. */
      workspace: {
        x: workspaceLeft,
        y: d.padding,
        width: Math.max(0, canvasWidth - d.focusPadding - workspaceLeft),
        height: d.height - d.padding * 2
      },
      // Ghosts first, so the focused bank is always on top of anything it
      // happens to overlap.
      paintOrder: banks.map((_, index) => index).filter(index => index !== focusIndex).concat([focusIndex])
    };
  }

  function totalHopperCount(layout) {
    if (!layout) return 0;
    return layout.banks.reduce((total, bank) => total + bank.cluster.hoppers.length, 0);
  }

  return {
    DIMENSIONS,
    equipmentView,
    assetPlacement,
    blenderOf,
    blenderAssets,
    blenderVariant,
    blenderViews,
    unitsPerInch,
    hopperBodyHeight,
    bankInnerWidth,
    bankDimensions,
    bankWidth,
    layoutBank,
    computeLayout,
    totalHopperCount
  };
});
