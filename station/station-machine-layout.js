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
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationMachineLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Every dimension the composition depends on. Corrections belong here, not
   * in path data. Values are viewBox units. */
  const DIMENSIONS = Object.freeze({
    height: 700,
    padding: 34,

    // --- Hopper ---------------------------------------------------------
    hopperWidth: 30,
    hopperGap: 6,

    /* Bodies are BOTTOM-aligned. The discharge geometry - cone, spout - sits at
     * one fixed height above the mixer for every hopper on the bank, because
     * that is where they physically all discharge into it. A taller vessel
     * therefore grows upward, taking its receiver with it, which is exactly
     * how a bank of mixed-height hoppers looks on the floor. */
    vesselBottom: 320,
    vesselHeight: 168,          // the default body, used when no profile height
    vesselMinHeight: 96,
    vesselMaxHeight: 210,
    /* Inches of usable height that the default body represents. One shared
     * constant, so two hoppers of the same profile height are the same size
     * on screen whichever bank or line they are on. */
    referenceHeightIn: 30,

    receiverHeight: 30,
    receiverGap: 8,             // neck between the receiver cone and the vessel
    sourceGap: 9,               // the source label sits above the receiver

    coneHeight: 26,
    spoutHeight: 12,
    // The compact readout under each hopper: id, blend, and resin when wide.
    hopperCaptionGap: 12,
    hopperCaptionHeight: 34,
    /* A resin code only appears when the hopper is at least this fraction of
     * the canvas width. The canvas is scaled to fit, so this is a proxy for how
     * big the hopper will actually be drawn - which is the thing that decides
     * whether a code is readable. Below it the code is dropped rather than
     * shrunk; it stays available on hover and in the expanded view. */
    resinVisibleRatio: 0.032,

    // --- Bank -----------------------------------------------------------
    bankPadding: 14,
    bankMinWidth: 132,
    bankGap: 30,
    headerTop: 22,

    // --- Mixer ----------------------------------------------------------
    /* Compact and close to square: a blender sitting under the bank, not a
     * console spanning it. Its width is capped well below a full hopper bank on
     * purpose - the aggregation point is a machine, and a machine that grows
     * with the number of hoppers above it stops reading as one.
     *
     * There is deliberately NO funnel between the bank and the blender. The
     * real connection is hose and material routing, which this view does not
     * draw; a bank-width funnel was inventing a piece of equipment to make the
     * drawing look continuous. The hoppers simply end above the mixer.
     */
    mixerTop: 424,
    mixerHeight: 68,
    mixerMaxWidth: 88,
    mixerMinWidth: 68,
    /* One short neck down to the extruder, and nothing else between them. The
     * UI does not need to show every physical transition. */
    mixerOutletHeight: 20,
    /* How much bigger the blender gets when its layer is expanded. Scaled
     * whole - width, height, agitator - never stretched, so it stays the same
     * component and the animation stays legible at the larger size. */
    mixerFocusScale: 1.45,

    // --- Extruder -------------------------------------------------------
    /* A long barrel projecting away from a fixed rear anchor.
     *
     * The previous version treated yaw as "narrower front rectangle plus a side
     * polygon", which reads as a cabinet however hard the shading works. A real
     * extruder is overwhelmingly BARREL: a long tube with an end cap at the near
     * end and the drive and feed at the far end. So the model here is an axis,
     * not a box.
     *
     * The rear feed point never moves - it is the anchor under the mixer - and
     * the barrel swings toward the core. That is what keeps the feed throat
     * centred on its layer at every yaw, and it is why the front end is the
     * thing that travels.
     */
    extruderBarrelRadius: 11,
    // How far the front end drops down the screen: the foreshortened length of
    // a machine pointing straight at you. Never zero, or the centre layer would
    // collapse to a disc.
    extruderAxisDrop: 60,
    // How far the front end swings sideways at full yaw. Larger than the drop
    // on purpose - lateral travel is what the eye reads as "turned".
    extruderAxisReach: 66,
    extruderRearWidth: 40,
    extruderRearHeight: 18,
    extruderDriveWidth: 26,
    extruderDriveHeight: 12,
    extruderFootHeight: 9,
    extruderFootWidth: 8,
    extruderSeams: 5,
    /* How much the end cap flattens at full yaw. Looking straight down the
     * barrel you see a circle; turned side-on you would see an edge. This is the
     * single value that makes the cap belong to the barrel it caps. */
    extruderCapFlatten: 0.52,
    extruderFocusScale: 1.2,

    /* Convergence, as YAW rather than as tilt.
     *
     * The machine stands upright. What changes with distance from the centre is
     * the direction its barrel projects: straight down the screen at the core,
     * swinging progressively toward the core on either side. The centre layer
     * is at 0; the outermost is at exactly `extruderMaxYaw`, with the rest
     * evenly spaced between.
     */
    extruderMaxYaw: 34,

    /* A line narrower than this ratio is CENTRED on the canvas rather than
     * stretched to fill it: the equipment that exists stays the same size, and
     * a one-layer line sits in the middle instead of being blown up. */
    /* This view is much narrower than a full line, so the old 1.55 left a
     * one-layer machine marooned in empty canvas. At 1.0 a narrow line scales
     * up to use the height it has, and a five-layer line still runs wide. */
    minAspect: 1.0,

    // --- Focus ----------------------------------------------------------
    /* Expanded edit state. The focused bank's hoppers grow, the rest shrink,
     * and the row recentres - so it reads as zooming into one layer rather
     * than as a panel opening over the top of everything. */
    focusScale: 2.3,
    dimScale: 0.52
  });

  /* --------------------------------------------------------------------
   *   Extruder convergence
   * ------------------------------------------------------------------ */

  /**
   * How far a layer's extruder is TURNED - yawed about its own vertical axis -
   * from its position in the stack. Degrees. Derived from distance off centre,
   * never from the layer's letter, which is what lets it be correct for a layer
   * count nobody has drawn yet.
   *
   * The machine does not lean: nothing rotates in the plane of the screen. Yaw
   * changes which faces you can see, and by how much - see extruderFaces().
   *
   * SIGN: negative for a bank LEFT of centre, positive for one to the right.
   * A left-hand machine turns to its right to face the core, which brings its
   * own left flank into view; the mirror holds on the other side. The centre
   * layer of an odd stack is exactly 0; an even stack has no centre layer and
   * its two middle banks are turned slightly, symmetrically.
   */
  function extruderAngle(index, layerCount, maxYaw) {
    const limit = maxYaw === undefined ? DIMENSIONS.extruderMaxYaw : maxYaw;
    if (!Number.isInteger(layerCount) || layerCount < 2) return 0;
    const centre = (layerCount - 1) / 2;
    const offset = index - centre;
    // Normalised so the outermost layer is always at the full yaw.
    const angle = (offset / centre) * limit;
    // The centre layer computes -0, which is not 0 under strict equality.
    return angle === 0 ? 0 : angle;
  }

  /* The stage's single light direction, pointing from the scene toward the
   * light: up and to the left. Everything that picks a lit side asks this. */
  const LIGHT = Object.freeze({ x: -0.6, y: -0.8 });

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /**
   * The drawn height of a hopper's storage body, from its Receiver Weight
   * Profile height in inches.
   *
   * One linear scale shared by every hopper on every line - a hopper profiled
   * at 42" is always drawn taller than one at 30", wherever it is - and clamped
   * at both ends so an unreasonable profile value cannot push a receiver off
   * the top of the canvas or collapse a body to nothing.
   *
   * Missing, zero, negative or non-finite input means "not profiled", and falls
   * back to the default body. That is deliberately not an error: volume-geometry
   * lines have no usable height at all, and a hopper nobody has measured yet is
   * the normal state of a new line.
   */
  function hopperBodyHeight(usableHeightIn, dimensions) {
    const d = dimensions || DIMENSIONS;
    const inches = Number(usableHeightIn);
    if (!Number.isFinite(inches) || inches <= 0) return d.vesselHeight;
    const scaled = d.vesselHeight * (inches / d.referenceHeightIn);
    return clamp(scaled, d.vesselMinHeight, d.vesselMaxHeight);
  }

  /**
   * The whole geometry of one extruder, from its yaw.
   *
   * PERSPECTIVE MODEL. Two points and everything hangs off them:
   *
   *   rear  - the anchor, always on the layer's centreline, under the mixer
   *   front - the near end, dropped down the screen and swung toward the core
   *
   * The axis between them is the barrel. At zero yaw the axis is straight down:
   * the machine points at the viewer, the barrel is foreshortened, and the end
   * cap is a full circle. As yaw grows the front swings sideways, the projected
   * barrel gets LONGER (less foreshortening, which is what actually happens),
   * and the cap flattens into an ellipse. Those three moving together are what
   * make the turn read as depth rather than as a decoration.
   *
   * MIRRORING is the sign of one number. `lateral` is negated from the yaw, so
   * a bank left of centre swings its front right and a bank right of centre
   * swings left. There is no left artwork and no right artwork.
   *
   * Nothing here is rotated in the screen plane. The drive, the feed block and
   * every foot are axis-aligned boxes; only the barrel and its cap follow the
   * axis, because those are the parts that are actually pointing somewhere.
   *
   * @param {number} angle    signed yaw in degrees
   * @param {object} d        dimensions
   * @param {object} options  { pivotX, pivotY, scale }
   */
  function extruderGeometry(angle, d, options) {
    const settings = options || {};
    const scale = settings.scale === undefined ? 1 : settings.scale;
    const pivotX = settings.pivotX === undefined ? 0 : settings.pivotX;
    const pivotY = settings.pivotY === undefined ? 0 : settings.pivotY;
    const maxYaw = d.extruderMaxYaw || 34;
    // -1 at the far left, 0 at the core, +1 at the far right.
    const fraction = clamp(angle / maxYaw, -1, 1);

    const radius = d.extruderBarrelRadius * scale;
    const drop = d.extruderAxisDrop * scale;
    const reach = d.extruderAxisReach * scale;
    const driveHeight = d.extruderDriveHeight * scale;
    const rearHeight = d.extruderRearHeight * scale;
    const rearWidth = d.extruderRearWidth * scale;
    const driveWidth = d.extruderDriveWidth * scale;
    const footHeight = d.extruderFootHeight * scale;
    const footWidth = d.extruderFootWidth * scale;

    // The feed throat lands here, on the centreline, whatever the yaw.
    const drive = {
      x: pivotX - driveWidth / 2, y: pivotY,
      width: driveWidth, height: driveHeight, centerX: pivotX
    };
    const rearBlock = {
      x: pivotX - rearWidth / 2, y: pivotY + driveHeight,
      width: rearWidth, height: rearHeight, centerX: pivotX
    };

    const rear = { x: pivotX, y: pivotY + driveHeight + rearHeight };
    const lateral = -fraction * reach;
    const front = { x: rear.x + lateral, y: rear.y + drop };

    const length = Math.sqrt(lateral * lateral + drop * drop);
    const axis = { x: lateral / length, y: drop / length };
    // Perpendicular, used for the barrel's width and for every seam across it.
    const perp = { x: -axis.y, y: axis.x };

    // End cap: a disc on the end of the barrel, so it is widest across the
    // barrel and squashed along it, by however much the machine is turned.
    const capRx = radius;
    const capRy = radius * (1 - d.extruderCapFlatten * Math.abs(fraction));
    const capAngle = (Math.atan2(perp.y, perp.x) * 180) / Math.PI;

    /* One light, from the upper left, for the whole stage.
     *
     * Which FLANK of a barrel that lights depends on where the barrel points,
     * so the sign genuinely differs between a machine angled left and one
     * angled right - that is correct shading, not an inconsistency. What must
     * stay constant is the light, and that is what the test checks. */
    const litSign = perp.x * LIGHT.x + perp.y * LIGHT.y >= 0 ? 1 : -1;

    const seams = Array.from({ length: d.extruderSeams }, (_, index) =>
      (index + 1) / (d.extruderSeams + 1));

    // Front feet sit lower than the rear feet because the front is nearer. That
    // is most of what stops the machine looking like it hangs off one foot.
    const feet = {
      /* Set wide, outside where the barrel emerges - a foot tucked under the
       * centre of the block disappears behind the barrel on a yawed machine and
       * the far end looks unsupported. */
      rear: [-1, 1].map(side => ({
        x: rear.x + side * rearWidth * 0.42 - footWidth / 2,
        y: rearBlock.y + rearHeight, width: footWidth, height: footHeight
      })),
      /* Below the cap, not beside it. A flattened cap on a strongly yawed
       * machine is shallow, so feet placed at a fraction of it ended up inside
       * the cap and invisible exactly when the machine was most turned. */
      front: [-1, 1].map(side => ({
        x: front.x + side * radius * 0.95 - footWidth / 2,
        y: front.y + capRy, width: footWidth, height: footHeight
      }))
    };

    const left = Math.min(rearBlock.x, front.x - radius) - footWidth;
    const right = Math.max(rearBlock.x + rearWidth, front.x + radius) + footWidth;
    const bottom = Math.max(
      feet.front[0].y + footHeight,
      feet.rear[0].y + footHeight
    );

    return {
      angle, fraction, scale,
      pivotX, pivotY,
      drive, rearBlock, rear, front,
      radius, length, axis, perp, litSign,
      capRx, capRy, capAngle,
      seams, feet,
      // How far the front travelled from the centreline, as a share of the
      // barrel's own width. The number the perspective is tuned against.
      sideShare: Math.abs(lateral) / (radius * 2),
      bounds: { left, right, top: pivotY, bottom },
      height: bottom - pivotY
    };
  }

  function bankInnerWidth(hopperCount, hopperWidth, hopperGap) {
    return hopperCount * hopperWidth + Math.max(0, hopperCount - 1) * hopperGap;
  }

  /* --------------------------------------------------------------------
   *   One layer bank
   * ------------------------------------------------------------------ */

  function layoutBank(layer, x, d, emphasis, index, layerCount, hopperState, canvasWidth) {
    // Emphasis scales the hoppers, and the bank is sized from its own hoppers,
    // so the whole bank grows and shrinks without a second set of dimensions.
    const scale = emphasis === "focused" ? d.focusScale
      : emphasis === "dimmed" ? d.dimScale
      : 1;
    const hopperWidth = d.hopperWidth * scale;
    const hopperGap = d.hopperGap * scale;
    const inner = bankInnerWidth(layer.hopperCount, hopperWidth, hopperGap);
    const width = Math.max(inner + d.bankPadding * 2, d.bankMinWidth * Math.min(scale, 1));
    const centerX = x + width / 2;
    const clusterX = centerX - inner / 2;
    // The discharge line: fixed for every hopper on the bank, whatever its
    // body height, because that is where they all feed the mixer.
    const coneTop = d.vesselBottom;

    /* Mixer PROPORTIONS are fixed; its SIZE is not. Width and height come from
     * the bank at its normal scale and are then scaled by one factor, so an
     * expanded layer gets a bigger blender - agitator and all - rather than a
     * stretched one. Deriving width from the expanded cluster is what turned it
     * into a console the first time.
     *
     * The extruder scales less. It is the least important thing in the picture
     * and should not grow to match a blender that just went up by half. */
    const baseInner = bankInnerWidth(layer.hopperCount, d.hopperWidth, d.hopperGap);
    const mixerScale = Math.min(scale, d.mixerFocusScale);
    const extruderScale = Math.min(scale, d.extruderFocusScale);
    const mixerWidth = clamp(baseInner + 8, d.mixerMinWidth, d.mixerMaxWidth) * mixerScale;
    const mixerHeight = d.mixerHeight * mixerScale;
    const mixerOutletHeight = d.mixerOutletHeight * mixerScale;
    // The extruder hangs off the bottom of the neck, wherever that ends up -
    // so a bigger blender pushes it down instead of colliding with it.
    const extruderTop = d.mixerTop + mixerHeight + mixerOutletHeight;

    /* A resin code is only legible when the hopper is a reasonable share of the
     * canvas, and the canvas is scaled to fit. Below the threshold the code is
     * dropped rather than shrunk - it stays on hover and in the expanded view. */
    const effectiveCanvas = canvasWidth || d.height * d.minAspect;
    const showResin = hopperWidth / effectiveCanvas >= d.resinVisibleRatio;

    const hoppers = layer.hoppers.map((hopper, hopperIndex) => {
      const runtime = hopperState ? hopperState[`${layer.id}:${hopper.index}`] : null;
      // Drawn to the Receiver Weight Profile, growing upward from the shared
      // discharge line.
      const vesselHeight = hopperBodyHeight(runtime ? runtime.usableHeight : null, d);
      const vesselTop = coneTop - vesselHeight;
      const receiverTop = vesselTop - d.receiverGap - d.receiverHeight;
      return {
        id: hopper.id,
        index: hopper.index,
        positionLabel: hopper.positionLabel,
        x: clusterX + hopperIndex * (hopperWidth + hopperGap),
        width: hopperWidth,
        // Above the receiver: where the material is connected from.
        sourceY: receiverTop - d.sourceGap,
        receiverTop,
        receiverHeight: d.receiverHeight,
        vesselTop,
        vesselHeight,
        // Whether this hopper was profiled at all, so the drawing can be honest
        // about a default rather than implying a measurement.
        profiled: !!(runtime && Number(runtime.usableHeight) > 0),
        coneTop,
        coneHeight: d.coneHeight,
        spoutTop: coneTop + d.coneHeight,
        spoutHeight: d.spoutHeight,
        captionTop: coneTop + d.coneHeight + d.spoutHeight + d.hopperCaptionGap,
        captionHeight: d.hopperCaptionHeight,
        showResin
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
      x,
      width,
      centerX,
      header: { x: centerX, y: d.headerTop },
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
      mixer: {
        x: centerX - mixerWidth / 2,
        y: d.mixerTop,
        width: mixerWidth,
        height: mixerHeight,
        centerX,
        outletHeight: mixerOutletHeight,
        scale: mixerScale
      },
      extruder: extruderGeometry(
        extruderAngle(index, layerCount, d.extruderMaxYaw), d,
        {
          // The feed throat lands exactly here for every layer and every yaw:
          // the rear is the anchor, and only the barrel travels.
          pivotX: centerX,
          pivotY: extruderTop,
          scale: extruderScale
        })
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
   */
  function computeLayout(model, options) {
    if (!model || !Array.isArray(model.layers) || !model.layers.length) return null;
    const settings = options || {};
    const d = Object.assign({}, DIMENSIONS, settings.dimensions || {});
    const focusLayer = settings.focusLayer || null;

    // Laid out twice: once to measure the row, then again shifted so it sits
    // centred on a canvas that respects minAspect. Two cheap passes beat
    // threading an offset through every placement.
    const hopperState = settings.hopperState || null;
    const natural = place(d, model, focusLayer, 0, undefined, hopperState);
    const canvasWidth = Math.max(natural.width, d.height * d.minAspect);
    return place(d, model, focusLayer, (canvasWidth - natural.width) / 2, canvasWidth, hopperState);
  }

  function place(d, model, focusLayer, offset, canvasWidth, hopperState) {
    const layerCount = model.layers.length;
    const banks = [];
    let cursor = d.padding + offset;

    model.layers.forEach((layer, index) => {
      const emphasis = !focusLayer ? "normal"
        : layer.id === focusLayer ? "focused"
        : "dimmed";
      const bank = layoutBank(layer, cursor, d, emphasis, index, layerCount, hopperState, canvasWidth);
      banks.push(bank);
      cursor += bank.width + d.bankGap;
    });

    const rowWidth = cursor - d.bankGap - d.padding - offset;
    const naturalRight = d.padding + offset + rowWidth + d.padding;

    return {
      dimensions: d,
      width: canvasWidth === undefined ? naturalRight : canvasWidth,
      height: d.height,
      focusLayer,
      row: { x: d.padding + offset, width: rowWidth, banks },
      // Kept as its own field so callers do not have to know it is row.banks.
      banks
    };
  }

  function totalHopperCount(layout) {
    if (!layout) return 0;
    return layout.banks.reduce((total, bank) => total + bank.cluster.hoppers.length, 0);
  }

  return {
    DIMENSIONS,
    LIGHT,
    extruderAngle,
    extruderGeometry,
    hopperBodyHeight,
    bankInnerWidth,
    layoutBank,
    computeLayout,
    totalHopperCount
  };
});
