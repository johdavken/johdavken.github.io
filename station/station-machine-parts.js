/* The layer equipment's SVG components.
 *
 * One builder per real piece of equipment - hopper, hopper cluster, mixer,
 * extruder, layer bank. Each takes the numbers it needs from
 * station-machine-layout.js and returns a single <g> with a semantic role on
 * it. Nothing here decides where anything goes, and nothing here decides what
 * colour anything is: position comes from the layout, appearance comes from
 * Station's stylesheets. What lives here is shape.
 *
 * THE TEST OF THIS FILE
 *
 * Adjusting the mixer must not require touching a hopper path, and adjusting
 * the extruder must not require touching the bank. It holds because each
 * builder reads only its own slice of the layout and draws into its own group.
 *
 * INTERACTION
 *
 * Three equipment targets: the mixer and the extruder - the equipment
 * train - open the layer in the workspace (and inspect the blend and the
 * layer percentage respectively); the hopper cluster is the hoppers
 * themselves. On each hopper, two more: its receiver is the pump control
 * and its body the tracking control, toggling the running job's
 * operational state and nothing else (station-hopper-controls.js). They
 * are marked with data-station-target and nothing else is clickable, so
 * the mapping cannot drift. No listeners are attached here - the renderer
 * stays event-free and testable, and station.js delegates from the mount.
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
  if (root) root.PolynStationMachineParts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const extruderAssets = deps.extruderAssets;
  const mixerAssets = deps.mixerAssets;
  const tsmAssets = deps.tsmAssets || null;

  const SVG_NS = "http://www.w3.org/2000/svg";

  function round(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function node(doc, name, className, attributes) {
    const element = doc.createElementNS ? doc.createElementNS(SVG_NS, name) : doc.createElement(name);
    if (className) element.setAttribute("class", className);
    if (attributes) {
      for (const key of Object.keys(attributes)) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        element.setAttribute(key, typeof value === "number" ? round(value) : String(value));
      }
    }
    return element;
  }

  function label(doc, text, x, y, className, anchor) {
    const element = node(doc, "text", className, { x, y, "text-anchor": anchor || "middle" });
    element.textContent = String(text);
    return element;
  }

  function group(doc, className, role, attributes) {
    return node(doc, "g", className, Object.assign({ "data-role": role }, attributes || {}));
  }

  /* Most of this equipment is trapezoids: hopper cones, receiver pinches,
   * mixer outlets, extruder heads. */
  function taper(doc, className, topLeft, topRight, bottomLeft, bottomRight, topY, bottomY) {
    return node(doc, "path", className, {
      d: `M ${round(topLeft)} ${round(topY)} L ${round(topRight)} ${round(topY)} ` +
         `L ${round(bottomRight)} ${round(bottomY)} L ${round(bottomLeft)} ${round(bottomY)} Z`
    });
  }

  /* An invisible rectangle over a click target. SVG groups only receive
   * pointer events where they are actually painted, so without this a click
   * between two shapes inside the target falls through to nothing. */
  function hitArea(doc, x, y, width, height) {
    return node(doc, "rect", "station-hit", {
      x, y, width: Math.max(0, width), height: Math.max(0, height)
    });
  }

  /* Truncate to what the cell can actually show. Roughly 0.58em per character
   * at this type size; a label that overruns its hopper is worse than one that
   * ends in an ellipsis. */
  function fitText(text, width, fontSize) {
    const value = String(text || "");
    const maximum = Math.max(1, Math.floor(width / (fontSize * 0.58)));
    return value.length <= maximum ? value : `${value.slice(0, Math.max(1, maximum - 1))}…`;
  }

  /* --------------------------------------------------------------------
   *   Hopper - the one reusable material-handling component
   * ------------------------------------------------------------------ */

  /* The runtime facts a hopper's drawing depends on - and the offer its
   * controls act on - as one string. Carried on the group (data-state) so
   * the renderer's patch path can tell an unchanged hopper from a changed
   * one without reading the drawing back.
   * Geometry is deliberately not in it: a profile height changes the
   * layout, and that is a render, not a patch. */
  function hopperStateKey(runtime, controls) {
    const r = runtime || {};
    const c = controls || {};
    return [
      r.track ? "t" : "",
      r.pumpOff ? "p" : "",
      r.assigned === false ? "u" : "",
      r.resinName || "",
      Number.isFinite(r.pct) ? r.pct : "",
      // The entered receiver weight, and the run-down's effective one -
      // the caption draws the effective weight, marked when computed.
      Number.isFinite(r.weight) ? r.weight : "",
      Number.isFinite(r.effectiveWeight) ? r.effectiveWeight : "",
      r.smartWeight ? "s" : "",
      r.source || "",
      // Whether the planned recipe changes this hopper's resin: the
      // receiver cap is drawn from it, so a plan-only publish redraws
      // the hopper (station-source.js, nextDiffers).
      r.nextDiffers ? "n" : "",
      // Which of the hopper's controls may act: written on the drawing, so
      // a change in the offer alone redraws the controls as a change in
      // state does.
      (c.tracking ? "T" : "") + (c.pump ? "P" : "")
    ].join("|");
  }

  /* The weight the caption shows: the run-down's effective weight - Smart
   * Hoppers' computed value when there is one, the entered receiver
   * weight otherwise - so the drawing and the timeline never disagree.
   * Falls back to the entered weight for a runtime that carries no
   * effective one (a fixture, an older producer). */
  function shownWeight(runtime) {
    if (!runtime) return 0;
    if (Number.isFinite(runtime.effectiveWeight) && runtime.effectiveWeight > 0) return runtime.effectiveWeight;
    return Number.isFinite(runtime.weight) ? runtime.weight : 0;
  }

  /* The caption's weight line: whole pounds, digits fitted to the column;
   * "—" when no weight is entered. The unit is weightLine()'s. */
  function weightText(weight, width, scale) {
    return Number.isFinite(weight) && weight > 0 ? fitText(String(Math.round(weight)), width, 9 * scale) : "—";
  }

  /* The weight line's type, in caption units at scale 1: the digits at the
   * caption's own size, the unit smaller beside them, a hair between. The
   * widths are the same estimate fitText() makes (0.58 em per glyph), so
   * the pair is centred by the rule the fit is judged by. */
  const WEIGHT_TYPE = Object.freeze({
    digitSize: 9,
    unitSize: 7.2,
    unitGap: 1.5,
    glyph: 0.58,
    unit: "lb",
    // Digits up to this many carry the unit beside them (four digits and
    // "lb" span about 31 units - the 30-unit column and a hair of its gap).
    // A wider weight is drawn alone, centred, the unit the tooltip's:
    // a real weight is never truncated to make room for its unit.
    unitUpToDigits: 4
  });

  /* The weight line: the digits, and the unit beside them when they fit.
   * Two texts rather than one with a tspan, so the digits stay the
   * weight element's own text - what the tooltip, the tests and any
   * reader of `.station-hopper__weight` take the weight to be. Anchored
   * end and start about a centre the pair's estimated width puts under
   * the hopper; a bare weight (no unit, or "—") is anchored middle at
   * the column's centre exactly as before. */
  function weightLine(doc, runtime, cx, y, width, scale) {
    const digits = weightText(shownWeight(runtime), width, scale);
    const t = WEIGHT_TYPE;
    const withUnit = digits !== "—" && /^\d+$/.test(digits) && digits.length <= t.unitUpToDigits;
    if (!withUnit) return [label(doc, digits, cx, y, "station-hopper__weight")];
    const digitsWidth = digits.length * t.digitSize * scale * t.glyph;
    const unitWidth = t.unit.length * t.unitSize * scale * t.glyph;
    const gap = t.unitGap * scale;
    const start = cx - (digitsWidth + gap + unitWidth) / 2;
    const weightX = round(start + digitsWidth);
    return [
      label(doc, digits, weightX, y, "station-hopper__weight", "end"),
      label(doc, t.unit, round(weightX + gap), y, "station-hopper__unit", "start")
    ];
  }

  /* The layer's share of the film structure, as the layer header shows it. */
  function shareText(layerPct) {
    return Number.isFinite(layerPct) && layerPct > 0 ? `${round(layerPct)}%` : "—";
  }

  /* Structured as the real assembly stacks, so a later phase can drive each
   * part independently: the receiver shows loading, the material shows
   * calculated fill, the body carries selection and warning state, the feed
   * shows pump-off. `runtime` is optional; with none this emits the same
   * structure it emits with an empty one. */
  function hopper(doc, geometry, runtime, options) {
    const settings = options || {};
    /* The bank's scale, for the things drawn in TYPE rather than geometry:
     * the caption's line spacing and its fit. The layout has already scaled
     * every length; this keeps the text in step so a hopper is the same
     * drawing at every scale - which is what lets it be carried between
     * layouts as one rigid object. */
    const scale = settings.scale === undefined ? 1 : settings.scale;

    const classes = ["station-hopper"];
    if (runtime) {
      if (runtime.track) classes.push("is-tracking");
      if (runtime.pumpOff) classes.push("is-pump-off");
      if (runtime.assigned === false) classes.push("is-unassigned");
      // The caption's weight is Smart Hoppers' computed one, not entered.
      if (runtime.smartWeight) classes.push("is-smart");
      // The planned recipe puts a different resin in this hopper (or
      // empties it): the receiver cap wears the warning, static (hopper.css).
      if (runtime.nextDiffers) classes.push("is-next-changes");
    }
    if (!geometry.profiled) classes.push("is-unprofiled");
    // Selected in the focused editor, or by a click on the hopper itself.
    if (settings.selected) classes.push("is-selected");

    const g = group(doc, classes.join(" "), "hopper", {
      "data-hopper": geometry.id,
      "data-layer": geometry.layer,
      "data-hopper-index": geometry.index,
      "data-state": hopperStateKey(runtime, settings.controls)
    });

    const x = geometry.x;
    const w = geometry.width;
    const right = x + w;
    const top = geometry.vesselTop;
    const bottom = geometry.coneTop;
    const cx = x + w / 2;
    const rim = w * 0.095;

    // Local drawing helpers. All dimensions follow the existing layout;
    // none of these paths participates in hit testing or stores state.
    const path = (className, d) => node(doc, "path", className, { d });
    const ellipse = (className, cy, rx, ry) => node(doc, "ellipse", className, { cx, cy, rx, ry });
    const arc = y => `M ${round(x)} ${round(y)} Q ${round(cx)} ${round(y + rim * 2)} ${round(right)} ${round(y)}`;

    /* ---- Resin identity, for assistive technology ----
     * No <title> on the group: the hover panel (station-hopper-info.js)
     * says the resin, the output and the weight beside the hopper, and a
     * native tooltip on top of it would stack two readings of the same
     * thing. The controls keep their own titles, which say what a click
     * does. What a screen reader announces for the group is the label:
     * the hopper's id and the resin in it. */
    g.setAttribute("aria-label", runtime && runtime.resinName
      ? `${geometry.id} · ${runtime.resinName}`
      : `${geometry.id} · no resin assigned`);

    /* Interaction geometry is independent of the equipment silhouette.
     * The drawing below is pointer-inert; what a click means is said by
     * the targets here, and station.js reads it off the element it hit.
     *
     * The hopper's own hit covers its whole column, source label to
     * caption, and stops inside its pitch so adjacent hoppers never
     * overlap; a click on it falls through to the cluster it sits in, as
     * it always has. Painted over it are the two operational controls,
     * which station.js hands to station-hopper-controls.js:
     *
     *   pump      the receiver - cap, cone and neck: the amber feed area
     *             that IS the pump indicator. A click toggles pump-off.
     *   tracking  the hopper body - vessel, hose and caption. A click
     *             toggles tracking.
     *
     * The two never overlap: the receiver ends where the vessel starts.
     * Each carries the hopper's address, the state as drawn (`data-on`)
     * and whether the application offers the command (`data-able`), so
     * the click needs nothing but the element it landed on and the
     * stylesheet can quieten a control that cannot act. The cells are
     * the same at every state: a pump that is off is still where it was,
     * so a click there marks it running again. */
    const interaction = group(doc, "station-hopper__interaction", "hopper-interaction");
    const hitPadding = Math.min(w * 0.08, Math.max(0, ((geometry.pitch || w) - w) / 2));
    const hitTop = geometry.sourceY - 10 * scale;
    interaction.appendChild(hitArea(doc, x - hitPadding, hitTop, w + hitPadding * 2,
      geometry.captionTop + geometry.captionHeight - hitTop));

    const controls = settings.controls || null;
    const tracked = !!(runtime && runtime.track);
    const pumpOff = !!(runtime && runtime.pumpOff);
    const trackingAble = !!(controls && controls.tracking);
    const pumpAble = !!(controls && controls.pump);
    const control = (kind, on, able, title, box, extra) => {
      const target = group(doc, `station-hopper__control station-hopper__control--${kind}`, `hopper-${kind}`, Object.assign({
        "data-station-target": kind,
        "data-layer": geometry.layer,
        "data-hopper": geometry.id,
        "data-hopper-index": geometry.index,
        "data-on": on ? "true" : "false",
        "data-able": able ? "true" : "false"
      }, extra || {}));
      // The tooltip says the state and, when a click can act, what it does.
      const tip = doc.createElementNS ? doc.createElementNS(SVG_NS, "title") : doc.createElement("title");
      tip.textContent = title;
      target.appendChild(tip);
      target.appendChild(hitArea(doc, box.x, box.y, box.width, box.height));
      return target;
    };
    interaction.appendChild(control("pump", pumpOff, pumpAble,
      `${geometry.id} · ${pumpOff ? "pump off" : "pump running"}` +
        (pumpAble ? ` · click to ${pumpOff ? "mark the pump running" : "mark the pump off"}` : ""),
      { x: x - hitPadding, y: geometry.receiverTop, width: w + hitPadding * 2, height: geometry.vesselTop - geometry.receiverTop },
      { "data-pump": pumpOff ? "off" : "on" }));
    interaction.appendChild(control("tracking", tracked, trackingAble,
      `${geometry.id} · ${tracked ? "tracked" : "not tracked"}` +
        (trackingAble ? ` · click to ${tracked ? "stop tracking" : "track in the timeline"}` : ""),
      { x: x - hitPadding, y: geometry.vesselTop, width: w + hitPadding * 2,
        height: geometry.captionTop + geometry.captionHeight - geometry.vesselTop }));
    g.appendChild(interaction);

    const drawing = group(doc, "station-hopper__drawing", "hopper-drawing", { "pointer-events": "none" });
    g.appendChild(drawing);

    const capHeight = geometry.receiverHeight * 0.38;

    /* ---- Source ----
     * Above the receiver, because that is where the material arrives from.
     * Shown only when it has a value: a bank of six "no source" labels is
     * noise that crowds out the fields that do carry information. */
    if (runtime && runtime.source) {
      const source = group(doc, "station-hopper__source-mark", "hopper-source");
      source.appendChild(label(doc, fitText(runtime.source, w * 1.3, 9 * scale),
        cx, geometry.sourceY, "station-hopper__source"));
      source.appendChild(node(doc, "line", "station-hopper__source-drop", {
        x1: cx, y1: geometry.sourceY + 3 * scale, x2: cx, y2: geometry.receiverTop - 1
      }));
      drawing.appendChild(source);
    }

    /* ---- Vacuum receiver: steel canister, lid and conveying cone ---- */
    const receiver = group(doc, "station-hopper__receiver-drawing", "hopper-receiver-drawing");
    const shoulder = geometry.receiverTop + capHeight;
    const receiverBottom = geometry.receiverTop + geometry.receiverHeight;
    receiver.appendChild(node(doc, "rect", "station-hopper__cap", {
      x: x + w * 0.09, y: geometry.receiverTop, width: w * 0.82, height: capHeight, rx: rim
    }));
    /* The receiver's lit strip and its lid carry a second, receiver-only
     * class beside the one they share with the vessel's, so a state that
     * is the receiver's alone (is-next-changes) can reach them in two
     * selector steps. */
    receiver.appendChild(node(doc, "rect", "station-hopper__metal-face station-hopper__receiver-face", {
      x: x + w * 0.23, y: geometry.receiverTop + rim, width: w * 0.3, height: capHeight - rim, rx: rim / 2
    }));
    receiver.appendChild(ellipse("station-hopper__lid station-hopper__receiver-lid", geometry.receiverTop + rim / 2, w * 0.43, rim));
    receiver.appendChild(path("station-hopper__receiver-cone",
      `M ${round(x)} ${round(shoulder)} Q ${round(cx)} ${round(shoulder - rim)} ${round(right)} ${round(shoulder)} ` +
      `L ${round(right - w * 0.06)} ${round(shoulder + rim * 2)} L ${round(cx + w * 0.1)} ${round(receiverBottom)} ` +
      `L ${round(cx - w * 0.1)} ${round(receiverBottom)} L ${round(x + w * 0.06)} ${round(shoulder + rim * 2)} Z`));
    receiver.appendChild(path("station-hopper__receiver-shade",
      `M ${round(cx + w * 0.18)} ${round(shoulder + rim)} L ${round(right - w * 0.05)} ${round(shoulder)} ` +
      `L ${round(cx + w * 0.1)} ${round(receiverBottom)} L ${round(cx)} ${round(receiverBottom)} Z`));
    receiver.appendChild(path("station-hopper__receiver-rim", arc(shoulder)));
    receiver.appendChild(node(doc, "rect", "station-hopper__neck", {
      x: x + w * 0.4, y: receiverBottom,
      width: w * 0.2, height: Math.max(0, top - receiverBottom)
    }));
    drawing.appendChild(receiver);

    /* ---- Material vessel ----
     * Drawn to the Receiver Weight Profile height. The decorative bands below
     * use a physical section height from layout, independent of body height. */
    const body = group(doc, "station-hopper__body", "hopper-body");
    body.appendChild(node(doc, "rect", "station-hopper__shell", {
      x, y: top, width: w, height: geometry.vesselHeight, rx: rim
    }));
    body.appendChild(node(doc, "rect", "station-hopper__metal-face", {
      x: x + w * 0.13, y: top + rim, width: w * 0.42, height: geometry.vesselHeight - rim * 2, rx: rim
    }));
    body.appendChild(node(doc, "rect", "station-hopper__metal-glint", {
      x: x + w * 0.18, y: top + rim * 2, width: w * 0.055, height: geometry.vesselHeight - rim * 4, rx: rim / 2
    }));
    body.appendChild(node(doc, "rect", "station-hopper__metal-shadow", {
      x: x + w * 0.78, y: top + rim, width: w * 0.18, height: geometry.vesselHeight - rim * 2, rx: rim / 2
    }));
    drawing.appendChild(body);

    /* ---- Material level ----
     * The one element driven by a live number. The fraction arrives as an
     * inline custom property because it is data, not design. It is 0 until a
     * later phase computes it. Its full range ends at the fill valve, so a
     * future 100% level does not fill the unmeasured space above that valve. */
    const material = group(doc, "station-hopper__material", "hopper-material");
    const fill = node(doc, "rect", "station-hopper__fill", {
      x: x + w * 0.04, y: geometry.fillValveY,
      width: w * 0.92, height: Math.max(0, bottom - geometry.fillValveY - w * 0.04), rx: w * 0.04
    });
    fill.setAttribute("style", "--station-hopper-fill: 0;");
    material.appendChild(fill);
    drawing.appendChild(material);

    /* ---- Run-down flow ----
     * Drawn only while the hopper is tracked: a column of large downward
     * chevrons travelling down the vessel, material seen running down.
     * Few and wide: each chevron spans the vessel's interior from clamp
     * to clamp, stands a third of the width tall, and the next is more
     * than a width below it, so a vessel shows two to four of them and
     * they read as flow, not as a patterned fill. The arms are bowed -
     * steep at the vessel's edges and flatter towards the point - which
     * is how a straight mark on a cylinder foreshortens when seen from the
     * front, so the chevrons lie on the drum rather than on the screen.
     *
     * The lane is the interior between the top and bottom rims. The clamp
     * bands, the ports and the fill valve are drawn OVER it (the details
     * group, below), so the flow passes behind the hardware and never
     * covers it; the caption, the id and the percentage are not under it.
     *
     * A nested <svg> is the clip: an inner svg clips its content to its
     * own box by default, in every engine, without a clipPath and the
     * document-unique id one would need. The column tiles the box: one
     * chevron above its top edge and then one every spacing down to its
     * bottom, and the stylesheet moves the group down by one spacing and
     * repeats (hopper.css), so the chevron leaving at the bottom is the
     * one arriving at the top and the column is seamless at every phase.
     * That includes phase zero: with reduced motion the group stands
     * where it was drawn and the vessel still shows its full column, so
     * "tracked" is said without any motion at all. A CSS animation, no
     * script, nothing rendered per frame here. The period and the
     * duration are the group's own custom properties, in the hopper's
     * units: the duration follows the period, so the chevrons travel at
     * the one speed (an eighth of the vessel's width a second) on every
     * vessel, tall or short, at every scale.
     *
     * What stands outside the box at the loop's ends is one spacing above
     * it (phase zero) or under a spacing and a chevron below it (the end),
     * inside the receiver and the hose - never past the hopper's own
     * extent, so a client rect of the hopper or its cluster (Chromium's
     * counts an inner svg's clipped content) stays within the hopper
     * whatever the phase. An untracked hopper draws nothing here. */
    if (tracked) {
      const bayLeft = x + w * 0.16;
      const bayWidth = w * 0.68;
      const bayTop = top + rim * 2.6;
      const bayHeight = Math.max(0, bottom - rim * 2.6 - bayTop);
      if (bayHeight > 0) {
        const strokeWidth = w * 0.085;
        const chevronHeight = w * 0.34;
        const spacing = w * 1.15;
        // The ends sit inside the box by the cap's radius, so a round cap
        // is never clipped flat.
        const left = strokeWidth / 2;
        const rightEnd = bayWidth - strokeWidth / 2;
        const mid = bayWidth / 2;
        const period = spacing;
        const seconds = period / (w * 0.125);
        const flowBox = node(doc, "svg", "station-hopper__rundown", {
          x: round(bayLeft), y: round(bayTop), width: round(bayWidth), height: round(bayHeight),
          viewBox: `0 0 ${round(bayWidth)} ${round(bayHeight)}`, "aria-hidden": "true"
        });
        flowBox.setAttribute("style",
          `--station-rundown-period: ${round(period)}px; --station-rundown-duration: ${round(seconds)}s;`);
        const flow = group(doc, "station-hopper__rundown-flow", "hopper-rundown");
        // One arm: a quadratic from the end to the point, its control
        // pulled down and outward, so the arm drops steeply off the edge
        // and flattens into the point - the drum's foreshortening.
        const arm = (fromX, cy) => {
          const controlX = fromX + (mid - fromX) * 0.5;
          const controlY = cy + chevronHeight * 0.62;
          return `Q ${round(controlX)} ${round(controlY)} ${round(mid)} ${round(cy + chevronHeight)}`;
        };
        const segments = [];
        for (let cy = -spacing; cy < bayHeight; cy += spacing) {
          segments.push(`M ${round(left)} ${round(cy)} ${arm(left, cy)} M ${round(rightEnd)} ${round(cy)} ${arm(rightEnd, cy)}`);
        }
        const chevrons = node(doc, "path", "station-hopper__rundown-chevrons", {
          d: segments.join(" "), "stroke-width": round(strokeWidth)
        });
        flow.appendChild(chevrons);
        flowBox.appendChild(flow);
        drawing.appendChild(flowBox);
      }
    }

    /* ---- Discharge: flat bottom plate and a clear spiral hose ----
     * On this floor the vessel shows no cone. It ends in a flat plate with an
     * outlet flange, and a clear 3" spiral-reinforced hose carries the
     * material down towards the mixer. The hose fills exactly the span the
     * cone and spout used to (coneTop to the bottom of spoutHeight), so the
     * caption and the bank's vertical rhythm do not move. Group names keep
     * their roles: `cone` is the discharge hardware, `feed` is the line the
     * material travels down, which pump-off tints. */
    const plateHeight = rim * 0.8;
    const collarHeight = rim * 0.7;
    const hoseW = geometry.hoseWidth;
    const hoseLeft = cx - hoseW / 2;
    const hoseRight = cx + hoseW / 2;
    const hoseTop = bottom + plateHeight / 2 + collarHeight;
    const hoseBottom = geometry.spoutTop + geometry.spoutHeight;

    const discharge = group(doc, "station-hopper__cone", "hopper-cone");
    discharge.appendChild(node(doc, "rect", "station-hopper__bottom-plate", {
      x: x - w * 0.02, y: bottom - plateHeight / 2, width: w * 1.04, height: plateHeight, rx: plateHeight / 2
    }));
    discharge.appendChild(node(doc, "rect", "station-hopper__outlet-flange", {
      x: cx - hoseW * 0.75, y: bottom + plateHeight / 2, width: hoseW * 1.5, height: collarHeight, rx: collarHeight / 3
    }));
    drawing.appendChild(discharge);

    const feed = group(doc, "station-hopper__feed", "hopper-feed");
    feed.appendChild(node(doc, "rect", "station-hopper__hose", {
      x: hoseLeft, y: hoseTop, width: hoseW, height: Math.max(0, hoseBottom - hoseTop), rx: hoseW * 0.12
    }));
    /* The embedded helix: one slanted, bowed rib per turn, drawn as one path
     * for the near side and a fainter one for the far side, half a turn out
     * of phase, which is what makes a flat tube read as a round one. */
    const pitch = hoseW * 0.42;
    const bow = hoseW * 0.22;
    const slant = hoseW * 0.12;
    const near = [];
    const far = [];
    for (let ribY = hoseTop + pitch * 0.7; ribY < hoseBottom - pitch * 0.3; ribY += pitch) {
      near.push(`M ${round(hoseLeft)} ${round(ribY)} Q ${round(cx)} ${round(ribY + bow)} ${round(hoseRight)} ${round(ribY - slant)}`);
      const farY = ribY - pitch / 2;
      if (farY > hoseTop) {
        far.push(`M ${round(hoseLeft)} ${round(farY)} Q ${round(cx)} ${round(farY - bow)} ${round(hoseRight)} ${round(farY + slant)}`);
      }
    }
    if (far.length) feed.appendChild(node(doc, "path", "station-hopper__hose-spiral-far", { d: far.join(" ") }));
    if (near.length) feed.appendChild(node(doc, "path", "station-hopper__hose-spiral", { d: near.join(" ") }));
    feed.appendChild(node(doc, "rect", "station-hopper__hose-glint", {
      x: cx - hoseW * 0.34, y: hoseTop + pitch * 0.3, width: hoseW * 0.1,
      height: Math.max(0, hoseBottom - hoseTop - pitch * 0.6), rx: hoseW * 0.05
    }));
    feed.appendChild(node(doc, "ellipse", "station-hopper__hose-end", {
      cx, cy: hoseBottom, rx: hoseW / 2, ry: hoseW * 0.16
    }));
    drawing.appendChild(feed);

    /* ---- Decorative hardware: rolled rims, curved clamp bands, side port ----
     * Kept separate from both the shell outline and future material fill. */
    const details = group(doc, "station-hopper__details", "hopper-details");
    details.appendChild(ellipse("station-hopper__lid", top + rim / 2, w / 2, rim));
    // Build upward from the discharge: full sections stay the same height
    // on every vessel, with any partial section at the top. The top and
    // bottom rims are hardware insets, not an extra section of material.
    const bandYs = [top + rim, bottom - rim];
    const sectionHeight = geometry.vesselSectionHeight;
    if (Number.isFinite(sectionHeight) && sectionHeight > 0) {
      for (let y = bottom - rim - sectionHeight; y > top + rim * 3; y -= sectionHeight) {
        bandYs.push(y);
      }
    }
    for (const y of bandYs.sort((a, b) => a - b)) {
      details.appendChild(path("station-hopper__band-shadow", arc(y + rim * 0.5)));
      details.appendChild(path("station-hopper__band", arc(y)));
      for (const offset of [0.08, 0.82]) {
        details.appendChild(node(doc, "rect", "station-hopper__clamp", {
          x: x + w * offset, y: y - rim * 0.25,
          width: w * 0.1, height: rim * 1.6, rx: rim * 0.2
        }));
      }
    }
    details.appendChild(node(doc, "ellipse", "station-hopper__port", {
      cx: right - w * 0.2, cy: top + w * 0.47, rx: w * 0.115, ry: w * 0.15
    }));
    // The upper port is the hose connection. This second, collared port is
    // the fill valve: its centre is the upper endpoint of usable height.
    details.appendChild(node(doc, "ellipse", "station-hopper__fill-valve", {
      cx: right - w * 0.2, cy: geometry.fillValveY, rx: w * 0.14, ry: w * 0.17
    }));
    details.appendChild(node(doc, "ellipse", "station-hopper__valve-core", {
      cx: right - w * 0.2, cy: geometry.fillValveY, rx: w * 0.055, ry: w * 0.085
    }));
    drawing.appendChild(details);

    /* ---- Readout ----
     * Identity, contribution, and the receiver weight. The resin's name is
     * not drawn on the hopper at all: it is the hover panel's
     * (station-hopper-info.js) and the editor's, so the column stays three
     * lines at every layer count. The weight is the run-down's effective weight - the entered
     * receiver weight (the Weights page's value), or Smart Hoppers'
     * computed one, marked `is-smart` and tinted - in whole pounds, with
     * the unit drawn smaller beside the digits so the number is never read
     * as anything else. The column has room for four digits and the unit;
     * a wider weight is drawn alone, and the unit, the thousands separator
     * and where a computed value came from are the tooltip's; "—" when
     * there is none. */
    const caption = group(doc, "station-hopper__caption", "hopper-caption");
    let y = geometry.captionTop;
    caption.appendChild(label(doc, geometry.id, cx, y, "station-hopper__id"));
    y += 13 * scale;
    caption.appendChild(label(doc,
      runtime && runtime.pct ? `${round(runtime.pct)}%` : "—",
      cx, y, "station-hopper__pct"));
    y += 12 * scale;
    for (const line of weightLine(doc, runtime, cx, y, w, scale)) caption.appendChild(line);
    drawing.appendChild(caption);

    return g;
  }

  /* --------------------------------------------------------------------
   *   Hopper cluster - click target: the hoppers' own controls (pumps, tracking)
   * ------------------------------------------------------------------ */

  function hopperCluster(doc, bank, hopperState, options) {
    const settings = options || {};
    const g = group(doc, "station-hopper-cluster", "hopper-cluster", {
      "data-layer": bank.id,
      "data-station-target": "cluster"
    });

    const cluster = bank.cluster;
    const padding = 8;
    g.appendChild(hitArea(doc,
      cluster.x - padding, cluster.y - padding,
      cluster.width + padding * 2,
      (cluster.bottom - cluster.y) + padding * 2 + (cluster.hoppers[0] ? cluster.hoppers[0].captionHeight + 12 : 0)));

    /* The same drawing whatever the bank's emphasis. A focused or dimmed
     * cluster is this cluster placed and scaled, never a different one, so
     * the transition can carry it as one object. */
    cluster.hoppers.forEach(geometry => {
      const runtime = hopperState ? hopperState[`${bank.id}:${geometry.index}`] : null;
      g.appendChild(hopper(doc, Object.assign({ layer: bank.id }, geometry), runtime, {
        scale: bank.scale,
        selected: !!settings.selectedHopper && settings.selectedHopper === geometry.id,
        // Which of the hopper's controls may act, as the bridge offers them.
        controls: settings.hopperControls || null
      }));
    });
    if (settings.showHint && bank.emphasis === "normal") {
      g.appendChild(label(doc, "Hopper controls", bank.centerX,
        cluster.y - 12, "station-cluster__hint"));
    }
    return g;
  }

  /* --------------------------------------------------------------------
   *   Mixer - click target: open the layer; inspect the blend
   * ------------------------------------------------------------------ */

  /* Shared by both authored machines: map an asset polygon through its
   * placement into stage coordinates. The mapping goes into the COORDINATES,
   * not a transform attribute, so strokes stay in stage units like every
   * other component's and mirroring is geometry rather than a scale(-1) a
   * later reader has to find. */
  function placed(placement) {
    const px = value => round(placement.anchor.x + placement.sign * placement.scale * value);
    const py = value => round(placement.anchor.y + placement.scale * value);
    return points => {
      const out = [];
      for (let i = 0; i < points.length; i += 2) out.push(`${px(points[i])} ${py(points[i + 1])}`);
      return `M ${out.join(" L ")} Z`;
    };
  }

  /* Authored artwork, placed - the same scheme as the extruder below, from
   * station-mixer-assets.js. This builder does not know what a weigh hopper
   * is; it labels each path with the TONE the asset says it was painted in
   * and lets the stylesheet colour it.
   *
   * THE ROTOR is the one thing built rather than copied. The asset supplies
   * four paddles in the plane of the inspection cover, the 2x2 projection of
   * that plane, where its centre sits, and the two window outlines. They are
   * assembled as:
   *
   *   <g clip-path=windows>            seen only through the openings
   *     <g transform=place the plane>  translate + the plane's matrix, scaled
   *       <g class=agitator>           what CSS rotates, about its own origin
   *         paddles                    authored once, in plane units
   *
   * The rotation therefore happens in the plane of the door - foreshortened
   * on a yawed machine exactly as the door is - and at whatever scale the
   * mixer is drawn, because the scale is in the placing transform and the
   * paddles never change. There is no focused rotor size to keep in step.
   */
  function mixer(doc, bank) {
    const m = bank.mixer;
    // Which blender the layout placed: the batch mixer's artwork, or the
    // TSM blender's (station-tsm-assets.js) - the same classes, the same
    // target, the same placement; only the polygons differ.
    const blender = m.blender === "tsm" && tsmAssets ? "tsm" : "batch";
    const asset = (blender === "tsm" ? tsmAssets : mixerAssets).views[m.view];
    const g = group(doc, "station-mixer", "mixer", {
      "data-layer": bank.id,
      "data-station-target": "mixer",
      "data-blender": blender,
      "data-view": m.view,
      "data-mirrored": m.mirrored ? "true" : "false",
      "data-yaw": round(m.yaw)
    });

    g.appendChild(hitArea(doc, m.bounds.left - 4, m.bounds.top - 4,
      m.bounds.right - m.bounds.left + 8, m.bounds.bottom - m.bounds.top + 8));

    const pathFor = placed(m);
    // A face the master stroked in its own colour (a curved band's facet)
    // carries the seam classes too; the stylesheet gives those the fill's
    // colour at seam width, so facets meet without a visible line.
    const face = polygon => node(doc, "path",
      `station-mixer__face station-mixer__face--${polygon.tone}` +
        (polygon.seamless ? ` station-mixer__seam station-mixer__seam--${polygon.tone}` : ""),
      { "data-part": polygon.part, d: pathFor(polygon.points) });

    // Painter's order is the asset's order, with the rotor slotted in where
    // the asset says: after the windows, before the frame in front of them.
    const body = group(doc, "station-mixer__body", "mixer-body");
    asset.polygons.slice(0, asset.rotorAfter).forEach(polygon => body.appendChild(face(polygon)));

    // A blender with nothing that turns (the TSM) has no rotor to build.
    const r = asset.rotor;
    if (!r) {
      asset.polygons.slice(asset.rotorAfter).forEach(polygon => body.appendChild(face(polygon)));
      g.appendChild(body);
      return g;
    }
    const clipId = `station-mixer-windows-${bank.id}`;
    const clip = node(doc, "clipPath", null, { id: clipId });
    for (const window of r.windows) clip.appendChild(node(doc, "path", null, { d: pathFor(window) }));
    body.appendChild(clip);

    const shutter = group(doc, null, "mixer-rotor", { "clip-path": `url(#${clipId})` });
    const mount = group(doc, null, "mixer-rotor-mount", {
      transform: `translate(${round(m.anchor.x + m.sign * m.scale * r.centre.x)} ` +
                 `${round(m.anchor.y + m.scale * r.centre.y)}) ` +
                 `matrix(${round(m.sign * m.scale * r.plane.a)} ${round(m.scale * r.plane.b)} ` +
                 `${round(m.sign * m.scale * r.plane.c)} ${round(m.scale * r.plane.d)} 0 0)`
    });
    const blades = group(doc, "station-mixer__agitator", "mixer-blades");
    for (const paddle of r.paddles) {
      const points = [];
      for (let i = 0; i < paddle.length; i += 2) points.push(`${round(paddle[i])} ${round(paddle[i + 1])}`);
      blades.appendChild(node(doc, "path", "station-mixer__blade", { d: `M ${points.join(" L ")} Z` }));
    }
    mount.appendChild(blades);
    shutter.appendChild(mount);
    body.appendChild(shutter);

    asset.polygons.slice(asset.rotorAfter).forEach(polygon => body.appendChild(face(polygon)));
    g.appendChild(body);
    return g;
  }

  /* --------------------------------------------------------------------
   *   Downcomer - on a TSM line, between the blender and the extruder
   * ------------------------------------------------------------------
   * The same drawing scheme as the blender (station-tsm-assets.js:
   * downcomer), placed by the layout with its inlet on the blender's
   * discharge and its outlet on the extruder's feed. It wears the mixer's
   * tone classes, so it is coloured as the blender is, and it is the
   * blender's target: a click on it is a click on the blender. */
  function downcomer(doc, bank) {
    const dc = bank.downcomer;
    if (!dc || !tsmAssets || !tsmAssets.downcomer) return null;
    const asset = tsmAssets.downcomer.views[dc.view];
    const g = group(doc, "station-downcomer", "downcomer", {
      "data-layer": bank.id,
      "data-station-target": "mixer",
      "data-view": dc.view,
      "data-mirrored": dc.mirrored ? "true" : "false"
    });
    g.appendChild(hitArea(doc, dc.bounds.left - 4, dc.bounds.top, dc.bounds.right - dc.bounds.left + 8, dc.bounds.bottom - dc.bounds.top));
    const pathFor = placed(dc);
    const body = group(doc, "station-mixer__body", "downcomer-body");
    for (const polygon of asset.polygons) {
      body.appendChild(node(doc, "path",
        `station-mixer__face station-mixer__face--${polygon.tone}` +
          (polygon.seamless ? ` station-mixer__seam station-mixer__seam--${polygon.tone}` : ""),
        { "data-part": polygon.part, d: pathFor(polygon.points) }));
    }
    g.appendChild(body);
    return g;
  }

  /* --------------------------------------------------------------------
   *   Extruder - click target: open the layer; inspect the layer percentage
   * ------------------------------------------------------------------ */

  /* Authored artwork, placed.
   *
   * The polygons come from station-extruder-assets.js - three views of one
   * machine, derived from the authored SVGs in images/extruder/ and already
   * in stage units with the feed anchor at their origin. This builder does
   * not know what a barrel is. It maps every point through the placement the
   * layout computed (translate to the feed point, scale, and a sign flip in x
   * for a mirrored machine), and labels each path with the part and face the
   * asset says it is, so the stylesheet can colour it.
   *
   * The mapping is applied to the COORDINATES, not as a transform attribute:
   * the whole group stays free of transforms, strokes stay in stage units
   * like every other component's, and mirroring is a matter of geometry
   * rather than of a scale(-1) somewhere a later reader has to find.
   */
  function extruder(doc, bank) {
    const e = bank.extruder;
    const asset = extruderAssets.views[e.view];
    const g = group(doc, "station-extruder", "extruder", {
      "data-layer": bank.id,
      "data-station-target": "extruder",
      "data-view": e.view,
      "data-mirrored": e.mirrored ? "true" : "false",
      "data-yaw": round(e.yaw),
      "data-facing": e.yaw === 0 ? "front" : e.mirrored ? "left" : "right"
    });

    g.appendChild(hitArea(doc, e.bounds.left - 4, e.bounds.top - 4,
      e.bounds.right - e.bounds.left + 8, e.bounds.bottom - e.bounds.top + 8));

    const pathFor = placed(e);

    // Painter's order is the asset's order: it was depth-sorted at source.
    const body = group(doc, "station-extruder__body", "extruder-body", { "pointer-events": "none" });
    const gradientPrefix = `station-extruder-${bank.id}`;
    const defs = node(doc, "defs");
    for (const definition of asset.gradients) {
      const gradient = node(doc, "linearGradient", null, {
        id: `${gradientPrefix}-${definition.name}`,
        x1: e.mirrored ? 1 - definition.x1 : definition.x1, y1: definition.y1,
        x2: e.mirrored ? 1 - definition.x2 : definition.x2, y2: definition.y2
      });
      definition.stops.forEach((offset, index) => gradient.appendChild(node(doc, "stop",
        `station-extruder__stop--${definition.name}-${index}`, { offset })));
      defs.appendChild(gradient);
    }
    body.appendChild(defs);
    for (const polygon of asset.polygons) {
      body.appendChild(node(doc, "path",
        extruderAssets.classesFor(polygon), {
          "data-part": polygon.part,
          "data-face": polygon.face,
          "data-source-part": polygon.sourcePart,
          style: extruderAssets.styleFor(polygon, gradientPrefix, e.scale),
          d: pathFor(polygon.points)
        }));
    }
    g.appendChild(body);
    return g;
  }

  /* --------------------------------------------------------------------
   *   Throat - the one thing drawn between the mixer and the extruder
   * ------------------------------------------------------------------ */

  /* A short dark neck from the mixer's discharge flange down into the
   * extruder's feed flange, and a contact shadow where it lands. Nothing
   * mechanical is being claimed: it is the cue that makes a mixer over a
   * strongly turned extruder read as feeding the rear of the machine rather
   * than standing beside it. Not a target; it belongs to the two things it
   * joins. */
  function throat(doc, bank) {
    const t = bank.throat;
    const g = group(doc, "station-feed", "feed", { "data-layer": bank.id });
    g.appendChild(node(doc, "ellipse", "station-feed__shadow", {
      cx: t.shadow.cx, cy: t.shadow.cy, rx: t.shadow.rx, ry: t.shadow.ry
    }));
    if (t.height > 0) {
      g.appendChild(node(doc, "rect", "station-feed__throat", {
        x: t.x, y: t.y, width: t.width, height: t.height
      }));
    }
    return g;
  }

  /* --------------------------------------------------------------------
   *   Layer bank - one layer's whole equipment train
   * ------------------------------------------------------------------ */

  /* --------------------------------------------------------------------
   *   Layer share: the header's third line
   * ------------------------------------------------------------------
   * The layer's share of the film structure, under the layer's letter and
   * role - where the value belongs, with the identity it qualifies, and
   * clear of anything the Operator Handbook can cover. One slot, in every
   * mode: the same box in Blend Edit as out of it, so the header never
   * changes height and nothing below it moves. It is drawn as a target
   * (data-station-target "share") that the boot file resolves to the
   * share editor (station-layer-share.js), which puts its field in this
   * same box; `data-able` says whether the application offers the
   * command, so a share that cannot be changed reads as a label.
   */

  /* The slot's place: under the layer's header, centred on the cluster,
   * sized in type against the bank's scale like the labels beside it. */
  function shareSlotBox(bank) {
    const scale = bank.scale || 1;
    const width = 64 * scale;
    const height = 16 * scale;
    return {
      x: bank.header.x - width / 2,
      y: bank.header.y + 20 * scale,
      width,
      height
    };
  }

  /* The slot's tooltip: the value, and the invitation only when the
   * application offers the change. Exported so the renderer's patch path
   * writes the same words a fresh render would. */
  function shareTitle(layerId, layerPct, able) {
    return able
      ? `Layer ${layerId} · ${shareText(layerPct)} of the film · click to change`
      : `Layer ${layerId} · ${shareText(layerPct)} of the film`;
  }

  function layerShare(doc, bank, layerPct, able) {
    const box = shareSlotBox(bank);
    const g = group(doc, "station-layer__share", "layer-share", {
      "data-station-target": "share",
      "data-layer": bank.id,
      "data-able": able ? "true" : "false"
    });
    const tip = doc.createElementNS ? doc.createElementNS(SVG_NS, "title") : doc.createElement("title");
    tip.textContent = shareTitle(bank.id, layerPct, able);
    g.appendChild(tip);
    /* The face under the value: transparent at rest, lit on hover and
     * while the editor is in the slot. The hit area over both is the
     * slot itself - a pointer target wider than the digits, without
     * larger type. */
    g.appendChild(node(doc, "rect", "station-layer__share-face", {
      x: box.x, y: box.y, width: box.width, height: box.height, rx: 3 * (bank.scale || 1)
    }));
    g.appendChild(label(doc, shareText(layerPct), box.x + box.width / 2, box.y + box.height * 0.72, "station-layer__share-value"));
    g.appendChild(hitArea(doc, box.x, box.y, box.width, box.height));
    return g;
  }

  /* --------------------------------------------------------------------
   *   Blend Edit: the cluster's other face
   * ------------------------------------------------------------------
   * While Blend Edit is on (station.js), a layer's hopper cluster can be
   * turned over to show a compact editor of its blend - the same layer,
   * in the same place, the cluster's drawing hidden under it. Which
   * layers are turned over is the Handbook's to say (its A-E selectors,
   * Edit all and Show all); nothing on the stage turns one. One builder:
   * the card, the frame and the <foreignObject> that carries the editor
   * the boot file built (station-focus-editor.js, compact variant), sized
   * to the cluster's own footprint so nothing around it moves.
   */

  /* The card's footprint: the cluster's column, no narrower than the
   * bank's own, from under the header's share slot to the bottom of the
   * captions. Read off the layout the cluster was drawn from, so the card
   * and the cluster it stands in for are the same box in every layout. */
  function blendCardBox(bank) {
    const scale = bank.scale || 1;
    const slot = shareSlotBox(bank);
    const cluster = bank.objects.cluster;
    const x = Math.min(cluster.x, bank.x);
    const width = Math.max(cluster.width, bank.width);
    const y = slot.y + slot.height + 6 * scale;
    return { x, y, width, height: cluster.y + cluster.height - y };
  }

  /* The card's other size (the card rail's Large switch, station-card-
   * rail.js): the same box, the type on it up by a quarter - the card's
   * faces read the size off the group (focus-editor.css). No length
   * changes: the header above, the train below and the neighbours
   * beside it stand where they are, and so does the card. */
  function cardSizeOf(size) { return size === "large" ? "large" : "normal"; }

  function blendCard(doc, bank, content, size) {
    const box = blendCardBox(bank);
    const g = group(doc, "station-blend-card", "blend-card", { "data-layer": bank.id, "data-size": cardSizeOf(size) });
    g.appendChild(node(doc, "rect", "station-blend-card__frame", {
      x: box.x, y: box.y, width: box.width, height: box.height, rx: 6
    }));
    const host = node(doc, "foreignObject", "station-blend-card__editor", {
      x: box.x, y: box.y, width: box.width, height: box.height
    });
    host.appendChild(content);
    g.appendChild(host);
    return g;
  }

  /* The card rail (station-card-rail.js): the boot file's element, stood
   * against the far-right card's box - a gap off its right edge, top-
   * aligned, as tall as the card - in a <foreignObject> of the rail's
   * own width. The canvas keeps `padding` past the last bank (station-
   * machine-layout.js), which the rail fits inside; the box is read off
   * the bank the card rides, so it moves with the card and with nothing
   * else. */
  const CARD_RAIL = Object.freeze({ gap: 6, width: 26 });
  function cardRailBox(bank) {
    const card = blendCardBox(bank);
    return { x: card.x + card.width + CARD_RAIL.gap, y: card.y, width: CARD_RAIL.width, height: card.height };
  }

  function cardRail(doc, bank, content) {
    const box = cardRailBox(bank);
    const host = node(doc, "foreignObject", "station-card-rail__host", {
      "data-role": "card-rail", "data-layer": bank.id,
      x: box.x, y: box.y, width: box.width, height: box.height
    });
    host.appendChild(content);
    return host;
  }

  function layerBank(doc, bank, hopperState, layerState, options) {
    const settings = options || {};
    const classes = ["station-layer"];
    if (bank.emphasis === "focused") classes.push("is-focused");
    if (bank.emphasis === "dimmed") classes.push("is-dimmed");
    /* Blend Edit: every normal bank can be turned over while the mode is
     * on. A bank handed a card carries it beside its cluster - both built,
     * one shown (hopper.css) - and which one is `flipped`: the card when
     * the caller says so, or says nothing (a card handed is a card shown);
     * the cluster when the caller says not, the card waiting hidden under
     * it. Either way a patch finds the hoppers it expects and the layer
     * turns over without being redrawn (station-face-turn.js). */
    const flippable = !!settings.blendEdit && bank.emphasis === "normal";
    const card = flippable && settings.blendCard ? settings.blendCard : null;
    const flipped = !!card && (settings.flipped === undefined || settings.flipped === null || !!settings.flipped);
    if (flippable) classes.push("is-flippable");
    if (flipped) classes.push("is-flipped");
    /* "Running" means the layer has a recipe to mix. Derived from the state
     * already on screen - no new field, no timer - and it is what gates the
     * agitator's motion, so an unconfigured layer sits still. */
    if (bank.cluster.hoppers.some(h => {
      const runtime = hopperState ? hopperState[`${bank.id}:${h.index}`] : null;
      return !!(runtime && runtime.resinName);
    })) classes.push("is-running");
    /* Which target the inspector is showing. A selected hopper stands for
     * the cluster on its own - the whole bank is not outlined as well. */
    if (settings.selectedTarget && !(settings.selectedTarget === "cluster" && settings.selectedHopper)) {
      classes.push(`is-${settings.selectedTarget}-selected`);
    }

    const box = b => [b.x, b.y, b.width, b.height].map(round).join(" ");
    const g = group(doc, classes.join(" "), "layer", {
      "data-layer": bank.id,
      "data-layer-role": bank.role,
      "data-emphasis": bank.emphasis,
      /* The bank's two rigid objects, declared on the markup so the transition
       * (station-transition.js) can carry each between layouts without
       * measuring anything the drawing did not already decide. Canvas units. */
      "data-object-cluster": box(bank.objects.cluster),
      "data-object-train": box(bank.objects.train),
      /* The footprint the bank's upper half takes whichever face is
       * showing: the card's box, which is the cluster's column widened to
       * the bank (blendCardBox). What stands beside the bank - the machine
       * rail (station-machine-rail.js) - keeps its distance from this, so
       * it neither crowds a card nor drifts from the hoppers. */
      "data-object-card": box(blendCardBox(bank))
    });
    /* The one inline value besides the hopper's fill fraction, and for the
     * same reason: it is a number from the layout, not a design decision.
     * Type inside the bank is sized against it, so text scales with the
     * equipment it labels. */
    g.setAttribute("style", `--station-bank-scale: ${round(bank.scale)};`);

    const header = group(doc, "station-layer__header", "layer-header", { "data-layer": bank.id });
    header.appendChild(label(doc, bank.id, bank.header.x, bank.header.y, "station-layer__name"));
    header.appendChild(label(doc, String(bank.roleLabel || "").toUpperCase(),
      bank.header.x, bank.header.y + 14 * bank.scale, "station-layer__role"));
    header.appendChild(layerShare(doc, bank,
      layerState && layerState[bank.id] ? layerState[bank.id].layerPct : null,
      !!(settings.layerShare && settings.layerShare.share)));
    g.appendChild(header);

    g.appendChild(hopperCluster(doc, bank, hopperState, settings));
    if (card) g.appendChild(blendCard(doc, bank, card, settings.cardSize));
    /* Extruder, then the throat, then the mixer. The throat lands on the feed
     * flange, which stands in front of the gearbox and motor; drawn the other
     * way round the motor would paint over it and the two would look
     * unconnected. */
    g.appendChild(extruder(doc, bank));
    g.appendChild(throat(doc, bank));
    // The downcomer, on a TSM line, under the blender and over the throat.
    const dc = downcomer(doc, bank);
    if (dc) g.appendChild(dc);
    g.appendChild(mixer(doc, bank));
    return g;
  }

  /* --------------------------------------------------------------------
   *   Focus workspace
   * ------------------------------------------------------------------ */

  /* The surface the focused layer's editor occupies. Placed by the layout;
   * what goes in it is built by the boot file (station-focus-editor.js)
   * and handed in as `content`, so this builder stays as ignorant of
   * recipes as it is of blend percentages. The content is HTML, carried
   * into the drawing by a <foreignObject> sized to the box: that keeps it
   * locked to the layout's geometry at any stage size, lets the transition
   * fade it with the workspace it belongs to, and keeps it BEHIND a layer
   * in transit, since the workspace is painted first. Without content
   * (a renderer with nothing to show) the frame says what the space is. */
  function workspace(doc, box, content) {
    const g = group(doc, "station-workspace", "focus-workspace");
    g.appendChild(node(doc, "rect", "station-workspace__frame", {
      x: box.x, y: box.y, width: box.width, height: box.height, rx: 6
    }));
    if (content) {
      const host = node(doc, "foreignObject", "station-workspace__editor", {
        x: box.x, y: box.y, width: box.width, height: box.height
      });
      host.appendChild(content);
      g.appendChild(host);
      return g;
    }
    g.appendChild(label(doc, "RESERVED — FOCUS WORKSPACE", box.x + box.width / 2, box.y + box.height / 2 - 6,
      "station-workspace__title"));
    g.appendChild(label(doc, "READ-ONLY — NO WRITE CONTRACT YET", box.x + box.width / 2, box.y + box.height / 2 + 14,
      "station-workspace__notice"));
    return g;
  }

  return {
    SVG_NS, node, label, group, taper, hitArea, fitText, hopperStateKey, shownWeight, weightLine, WEIGHT_TYPE, shareText,
    hopper, hopperCluster, mixer, downcomer, throat, extruder, layerBank, workspace,
    shareSlotBox, shareTitle, layerShare, blendCardBox, blendCard,
    CARD_RAIL, cardSizeOf, cardRailBox, cardRail
  };
});
