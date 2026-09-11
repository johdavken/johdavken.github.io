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
 * Three targets, and only three: the cluster edits the layer's recipe, the
 * mixer inspects the blend, the extruder inspects the layer percentage. They
 * are marked with data-station-target and nothing else is clickable, so the
 * mapping cannot drift. No listeners are attached here - the renderer stays
 * event-free and testable, and station.js delegates from the mount.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationMachineParts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

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

  /* A value attached to a piece of equipment.
   *
   * Drawn as a control - a bordered well with the value in it - because that is
   * what it will be. It is NOT editable yet: the Station state bridge is a
   * one-way window with no write API, so committing an edit is impossible and
   * offering an input that silently discarded one would be worse than not
   * offering it. The surface is built, marked read-only in the markup and
   * styled as read-only, and the day a write contract lands this becomes live
   * without the layout moving.
   */
  function field(doc, box, options) {
    const settings = options || {};
    const classes = ["station-field", "is-readonly"];
    if (!settings.value) classes.push("is-empty");

    const g = group(doc, classes.join(" "), "field", {
      "data-station-field": settings.kind,
      "data-layer": settings.layer,
      "data-hopper": settings.hopper,
      "aria-readonly": "true"
    });
    g.appendChild(node(doc, "rect", "station-field__well", {
      x: box.x, y: box.y, width: box.width, height: box.height, rx: 3
    }));
    g.appendChild(label(doc,
      settings.value ? fitText(settings.value, box.width - 8, 11) : (settings.placeholder || "—"),
      box.x + box.width / 2, box.y + box.height * 0.7,
      `station-field__value station-field__value--${settings.kind}`));
    return g;
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

  /* Structured as the real assembly stacks, so a later phase can drive each
   * part independently: the receiver shows loading, the material shows
   * calculated fill, the body carries selection and warning state, the feed
   * shows pump-off. `runtime` is optional; with none this emits the same
   * structure it emits with an empty one. */
  function hopper(doc, geometry, runtime, options) {
    const settings = options || {};
    const detail = settings.detail || "normal";   // "none" | "normal" | "full"

    const classes = ["station-hopper"];
    if (runtime) {
      if (runtime.track) classes.push("is-tracking");
      if (runtime.pumpOff) classes.push("is-pump-off");
      if (runtime.assigned === false) classes.push("is-unassigned");
    }
    if (!geometry.profiled) classes.push("is-unprofiled");

    const g = group(doc, classes.join(" "), "hopper", {
      "data-hopper": geometry.id,
      "data-layer": geometry.layer,
      "data-hopper-index": geometry.index
    });

    const x = geometry.x;
    const w = geometry.width;
    const right = x + w;
    const capHeight = Math.max(5, w * 0.22);
    const cx = x + w / 2;

    /* ---- Resin identity, for hover and assistive technology ----
     * The dense view drops the resin code because it cannot be drawn legibly
     * in a narrow column, so it has to remain reachable some other way. A
     * <title> is the native mechanism: it is the SVG tooltip and it is what a
     * screen reader announces for the group. */
    const name = doc.createElementNS
      ? doc.createElementNS(SVG_NS, "title")
      : doc.createElement("title");
    name.textContent = runtime && runtime.resinName
      ? `${geometry.id} · ${runtime.resinName}${runtime.pct ? ` · ${round(runtime.pct)}%` : ""}` +
        `${runtime.source ? ` · from ${runtime.source}` : ""}`
      : `${geometry.id} · no resin assigned`;
    g.appendChild(name);

    /* ---- Source ----
     * Above the receiver, because that is where the material arrives from.
     *
     * Expanded, it is a control and is always present - an unset source is
     * something you would want to set, so the well is drawn empty rather than
     * hidden. In the dense overview it appears only when it has a value: a bank
     * of six "no source" labels is noise that crowds out the fields that do
     * carry information. */
    if (detail === "full") {
      g.appendChild(field(doc, {
        x: cx - w * 0.56, y: geometry.sourceY - 13, width: w * 1.12, height: 17
      }, {
        kind: "source", value: runtime && runtime.source, placeholder: "no source",
        layer: geometry.layer, hopper: geometry.id
      }));
      g.appendChild(node(doc, "line", "station-hopper__source-drop", {
        x1: cx, y1: geometry.sourceY + 4, x2: cx, y2: geometry.receiverTop - 1
      }));
    } else if (detail !== "none" && runtime && runtime.source) {
      const source = group(doc, "station-hopper__source-mark", "hopper-source");
      source.appendChild(label(doc, fitText(runtime.source, w * 1.3, 9),
        cx, geometry.sourceY, "station-hopper__source"));
      source.appendChild(node(doc, "line", "station-hopper__source-drop", {
        x1: cx, y1: geometry.sourceY + 3, x2: cx, y2: geometry.receiverTop - 1
      }));
      g.appendChild(source);
    }

    /* ---- Vacuum receiver, which is also the pump indicator ----
     * Marked as its own target and carrying its own state, so the pump can
     * later be toggled here without the artwork changing. Nothing is bolted on
     * to say "pump": the receiver IS the control, which is how the equipment
     * reads on the floor. */
    const receiver = group(doc, "station-hopper__receiver", "hopper-receiver", {
      "data-station-target": "receiver",
      "data-layer": geometry.layer,
      "data-hopper": geometry.id,
      "data-pump": runtime && runtime.pumpOff ? "off" : "on"
    });
    receiver.appendChild(node(doc, "rect", "station-hopper__cap", {
      x: x + w * 0.16, y: geometry.receiverTop, width: w * 0.68, height: capHeight, rx: 2
    }));
    receiver.appendChild(taper(doc, "station-hopper__receiver-cone",
      x, right, x + w * 0.4, right - w * 0.4,
      geometry.receiverTop + capHeight, geometry.receiverTop + geometry.receiverHeight));
    receiver.appendChild(node(doc, "rect", "station-hopper__neck", {
      x: x + w * 0.4, y: geometry.receiverTop + geometry.receiverHeight,
      width: w * 0.2, height: Math.max(0, geometry.vesselTop - (geometry.receiverTop + geometry.receiverHeight))
    }));
    g.appendChild(receiver);

    /* ---- Material vessel ----
     * Drawn to the Receiver Weight Profile height. Band spacing is a fraction
     * of the body, so a short vessel gets the same three bands as a tall one
     * rather than looking like a different component. */
    const body = group(doc, "station-hopper__body", "hopper-body");
    body.appendChild(node(doc, "rect", "station-hopper__shell", {
      x, y: geometry.vesselTop, width: w, height: geometry.vesselHeight, rx: 2
    }));
    for (let band = 1; band <= 3; band++) {
      const y = geometry.vesselTop + (geometry.vesselHeight * band) / 4;
      body.appendChild(node(doc, "line", "station-hopper__band", { x1: x, y1: y, x2: right, y2: y }));
    }
    g.appendChild(body);

    /* ---- Material level ----
     * The one element driven by a live number. The fraction arrives as an
     * inline custom property because it is data, not design. It is 0 until a
     * later phase computes it. */
    const material = group(doc, "station-hopper__material", "hopper-material");
    const fill = node(doc, "rect", "station-hopper__fill", {
      x: x + 1.2, y: geometry.vesselTop + 1.2,
      width: Math.max(0, w - 2.4), height: Math.max(0, geometry.vesselHeight - 2.4), rx: 1
    });
    fill.setAttribute("style", "--station-hopper-fill: 0;");
    material.appendChild(fill);
    g.appendChild(material);

    /* ---- Discharge ---- */
    const cone = group(doc, "station-hopper__cone", "hopper-cone");
    cone.appendChild(taper(doc, "station-hopper__cone-shape",
      x, right, x + w * 0.37, right - w * 0.37,
      geometry.coneTop, geometry.coneTop + geometry.coneHeight));
    g.appendChild(cone);

    const feed = group(doc, "station-hopper__feed", "hopper-feed");
    feed.appendChild(node(doc, "rect", "station-hopper__spout", {
      x: x + w * 0.37, y: geometry.spoutTop, width: w * 0.26, height: geometry.spoutHeight
    }));
    g.appendChild(feed);

    /* ---- Expanded: the controls live on the equipment ----
     * Resin on the body, because that is what is in the vessel. Blend beneath
     * the discharge, because that is what comes out of it. Source above the
     * receiver, because that is where it came from. An operator reading this is
     * reading the hopper, not a form that happens to be next to one. */
    if (detail === "full") {
      const controls = group(doc, "station-hopper__controls", "hopper-controls");
      /* Anchored to the discharge, not to the top of the vessel. Bodies are
       * different heights, so following each one's top left the resin wells in
       * a ragged line across the bank; sitting them a fixed distance above the
       * cone keeps them in one readable row and still puts each one on its own
       * body, which is the placement that matters. */
      controls.appendChild(field(doc, {
        x: x + 3, y: geometry.coneTop - 40, width: w - 6, height: 22
      }, {
        kind: "resin", value: runtime && runtime.resinName, placeholder: "no resin",
        layer: geometry.layer, hopper: geometry.id
      }));
      controls.appendChild(label(doc, geometry.id, cx, geometry.captionTop, "station-hopper__id"));
      controls.appendChild(field(doc, {
        x: cx - w * 0.38, y: geometry.captionTop + 7, width: w * 0.76, height: 22
      }, {
        kind: "pct",
        value: runtime && runtime.pct ? `${round(runtime.pct)}%` : "",
        placeholder: "0%",
        layer: geometry.layer, hopper: geometry.id
      }));
      g.appendChild(controls);
      return g;
    }

    /* ---- Dense readout ----
     * Identity and contribution only. The resin code joins them when the hopper
     * is wide enough to draw it at full size; it is never shrunk to fit,
     * because an unreadable code is worse than no code. */
    if (detail !== "none") {
      const caption = group(doc, "station-hopper__caption", "hopper-caption");
      let y = geometry.captionTop;
      caption.appendChild(label(doc, geometry.id, cx, y, "station-hopper__id"));
      y += 13;
      caption.appendChild(label(doc,
        runtime && runtime.pct ? `${round(runtime.pct)}%` : "—",
        cx, y, "station-hopper__pct"));
      if (geometry.showResin) {
        y += 12;
        caption.appendChild(label(doc,
          runtime && runtime.resinName ? fitText(runtime.resinName, w, 9) : "",
          cx, y, "station-hopper__resin"));
      }
      g.appendChild(caption);
    }

    return g;
  }

  /* --------------------------------------------------------------------
   *   Hopper cluster - click target: edit the layer's recipe
   * ------------------------------------------------------------------ */

  function hopperCluster(doc, bank, hopperState, options) {
    const settings = options || {};
    const g = group(doc, "station-hopper-cluster", "hopper-cluster", {
      "data-layer": bank.id,
      "data-station-target": "cluster"
    });

    const cluster = bank.cluster;
    const detail = bank.emphasis === "dimmed" ? "none"
      : bank.emphasis === "focused" ? "full"
      : "normal";

    const padding = 8;
    g.appendChild(hitArea(doc,
      cluster.x - padding, cluster.y - padding,
      cluster.width + padding * 2,
      (cluster.bottom - cluster.y) + padding * 2 +
        (detail === "none" ? 0 : cluster.hoppers[0] ? cluster.hoppers[0].captionHeight + 12 : 0)));

    for (const geometry of cluster.hoppers) {
      const runtime = hopperState ? hopperState[`${bank.id}:${geometry.index}`] : null;
      g.appendChild(hopper(doc, Object.assign({ layer: bank.id }, geometry), runtime, { detail }));
    }
    if (settings.showHint && bank.emphasis === "normal") {
      g.appendChild(label(doc, "Edit recipe", bank.centerX,
        cluster.y - 12, "station-cluster__hint"));
    }
    return g;
  }

  /* --------------------------------------------------------------------
   *   Mixer - click target: inspect the layer blend
   * ------------------------------------------------------------------ */

  function mixer(doc, bank) {
    const m = bank.mixer;
    const g = group(doc, "station-mixer", "mixer", {
      "data-layer": bank.id,
      "data-station-target": "mixer"
    });

    g.appendChild(hitArea(doc, m.x - 6, m.y - 10, m.width + 12, m.height + m.outletHeight + 16));

    // Inlet band across the top of the body.
    g.appendChild(node(doc, "rect", "station-mixer__inlet", {
      x: m.x + m.width * 0.06, y: m.y - 5, width: m.width * 0.88, height: 7, rx: 2
    }));
    g.appendChild(node(doc, "rect", "station-mixer__body", {
      x: m.x, y: m.y, width: m.width, height: m.height, rx: 4
    }));
    /* Agitator: the detail that makes this read as a mixer and not a crate, and
     * the anchor for the one piece of motion in Station.
     *
     * Drawn ONCE at a unit size in its own local coordinate system and placed
     * with a translate+scale, so an expanded layer's larger blender gets a
     * larger agitator for free. The previous version computed a radius with an
     * absolute cap in it, which silently stopped the agitator growing while the
     * blender around it did - a focused mixer with a normal-sized agitator.
     * There is no focused size to maintain here because there is only one size.
     *
     * Two nested groups on purpose: the outer one carries the SVG transform,
     * the inner one is what CSS animates. A CSS transform on the outer group
     * would replace the placement rather than compose with it.
     */
    const mount = group(doc, "station-mixer__agitator-mount", "mixer-agitator", {
      transform: `translate(${round(m.centerX)} ${round(m.y + m.height * 0.52)}) ` +
                 `scale(${round(m.scale)})`
    });
    const unitRadius = 13;
    mount.appendChild(node(doc, "circle", "station-mixer__viewport", { cx: 0, cy: 0, r: unitRadius }));

    const blades = group(doc, "station-mixer__agitator", "mixer-blades");
    const reach = unitRadius * 0.74;
    for (const side of [-1, 1]) {
      blades.appendChild(node(doc, "line", "station-mixer__blade", {
        x1: -side * reach, y1: -side * reach * 0.34,
        x2: side * reach, y2: side * reach * 0.34
      }));
    }
    blades.appendChild(node(doc, "circle", "station-mixer__shaft", { cx: 0, cy: 0, r: unitRadius * 0.2 }));
    mount.appendChild(blades);
    g.appendChild(mount);

    /* One short neck down to the extruder. There was a taper, then a separate
     * throat box on the extruder, then the housing - three shapes to say
     * "connected". One says it. */
    const neckHalf = Math.max(9, m.width * 0.13);
    g.appendChild(taper(doc, "station-mixer__outlet",
      m.x + m.width * 0.34, m.x + m.width * 0.66,
      m.centerX - neckHalf, m.centerX + neckHalf,
      m.y + m.height, m.y + m.height + m.outletHeight));
    return g;
  }

  /* --------------------------------------------------------------------
   *   Extruder - click target: inspect the layer percentage
   * ------------------------------------------------------------------ */

  /* Tilted about the point where it meets the mixer outlet, so the convergence
   * never opens a gap between the two. The percentage readout is
   * counter-rotated so a tilted barrel does not produce tilted text. */
  /* --------------------------------------------------------------------
   *   Extruder
   * ------------------------------------------------------------------ */

  /* A long barrel projecting away from a fixed rear anchor, toward the core.
   *
   * WHAT THE REFERENCES GAVE US
   *
   * The anatomy, not the camera. A real extruder reads as: a heavy end cap with
   * a bore at the near end; a long barrel banded into heater zones with one
   * longitudinal seam down it; a compact drive and feed block at the far end;
   * and short feet under both ends of a base. Everything below is one of those
   * six things. The barrel is by far the largest, which is the single biggest
   * correction from the cabinet-shaped version this replaces.
   *
   * WHAT IS DELIBERATELY LEFT OUT
   *
   * Motor cowlings, couplings, hose fittings, vent stacks, wiring, bolt heads
   * and the base rail's own structure. None of them survives at Station scale,
   * and each one costs clarity at the size this is actually read.
   *
   * HOW THE TURN IS DRAWN
   *
   * Not with a transform. The barrel is a quad between two points the layout
   * computed, the seams are lines across it, and the cap is an arc pair with its
   * own axis rotation baked into the path data. Nothing is rotated in the screen
   * plane, so the drive, the feed block and every foot stay square and the
   * machine stays standing - only the barrel points somewhere.
   */
  function extruder(doc, bank, layerPct) {
    const e = bank.extruder;
    const g = group(doc, "station-extruder", "extruder", {
      "data-layer": bank.id,
      "data-station-target": "extruder",
      "data-yaw": round(e.angle),
      "data-facing": e.fraction < 0 ? "left" : e.fraction > 0 ? "right" : "front"
    });

    const { rear, front, perp, radius, litSign } = e;
    const along = (t, offset) => ({
      x: rear.x + (front.x - rear.x) * t + perp.x * offset,
      y: rear.y + (front.y - rear.y) * t + perp.y * offset
    });
    const point = p => `${round(p.x)} ${round(p.y)}`;

    g.appendChild(hitArea(doc, e.bounds.left - 4, e.bounds.top - 4,
      e.bounds.right - e.bounds.left + 8, e.bounds.bottom - e.bounds.top + 8));

    /* ---- Feet ----
     * Drawn first, so the machine stands on them rather than in front of them.
     * Front feet sit lower than rear feet because the front end is nearer; that
     * difference is most of what stops the barrel looking like it hangs in the
     * air off a single support. */
    const supports = group(doc, "station-extruder__supports", "extruder-supports");
    for (const [where, feet] of [["rear", e.feet.rear], ["front", e.feet.front]]) {
      for (const foot of feet) {
        supports.appendChild(node(doc, "rect", "station-extruder__foot", {
          x: foot.x, y: foot.y, width: foot.width, height: foot.height, rx: 1.5,
          "data-position": where
        }));
      }
    }
    g.appendChild(supports);

    /* ---- Barrel ----
     * One quad from the rear anchor to the front end, offset either side by the
     * barrel radius. This is the dominant form and everything else is sized
     * against it. */
    const barrel = group(doc, "station-extruder__barrel", "extruder-barrel");
    /* The barrel starts INSIDE the feed block, not flush with its underside.
     * Its rear edge is perpendicular to the axis, so on a yawed machine a flush
     * joint reads as a barrel stuck on the corner of the block; running it up
     * behind the block and letting the block cover the join is what makes it
     * emerge from the machine. */
    const barrelStart = -0.2;
    barrel.appendChild(node(doc, "path", "station-extruder__barrel-body", {
      d: `M ${point(along(barrelStart, radius))} L ${point(along(1, radius))} ` +
         `L ${point(along(1, -radius))} L ${point(along(barrelStart, -radius))} Z`
    }));
    /* A lit strip down one side turns a flat quad into a tube. Fixed to the
     * upper-left so the light never flips as the machine turns past straight-on. */
    barrel.appendChild(node(doc, "path", "station-extruder__barrel-lit", {
      d: `M ${point(along(barrelStart, radius * litSign))} L ${point(along(1, radius * litSign))} ` +
         `L ${point(along(1, radius * litSign * 0.42))} L ${point(along(barrelStart, radius * litSign * 0.42))} Z`
    }));
    // Heater-zone bands across the barrel.
    for (const t of e.seams) {
      barrel.appendChild(node(doc, "line", "station-extruder__seam", {
        x1: along(t, radius).x, y1: along(t, radius).y,
        x2: along(t, -radius).x, y2: along(t, -radius).y
      }));
    }
    // One longitudinal seam, on the shaded side so it does not fight the
    // highlight.
    barrel.appendChild(node(doc, "line", "station-extruder__seam-long", {
      x1: along(0.06, -radius * litSign * 0.5).x, y1: along(0.06, -radius * litSign * 0.5).y,
      x2: along(0.94, -radius * litSign * 0.5).x, y2: along(0.94, -radius * litSign * 0.5).y
    }));
    g.appendChild(barrel);

    /* ---- Front end cap ----
     * A disc on the end of the barrel: widest across it, squashed along it by
     * however much the machine is turned. Built from two arcs rather than a
     * rotated <ellipse>, so no part of this component carries a rotation. */
    const ellipse = (rx, ry) =>
      `M ${point({ x: front.x + perp.x * rx, y: front.y + perp.y * rx })} ` +
      `A ${round(rx)} ${round(ry)} ${round(e.capAngle)} 0 1 ` +
      `${point({ x: front.x - perp.x * rx, y: front.y - perp.y * rx })} ` +
      `A ${round(rx)} ${round(ry)} ${round(e.capAngle)} 0 1 ` +
      `${point({ x: front.x + perp.x * rx, y: front.y + perp.y * rx })} Z`;

    const cap = group(doc, "station-extruder__cap", "extruder-cap");
    // Flange first, then the face, then the bore: three rings reading inward.
    cap.appendChild(node(doc, "path", "station-extruder__flange", {
      d: ellipse(e.capRx * 1.24, e.capRy * 1.24)
    }));
    cap.appendChild(node(doc, "path", "station-extruder__cap-face", {
      d: ellipse(e.capRx, e.capRy)
    }));
    cap.appendChild(node(doc, "path", "station-extruder__bore", {
      d: ellipse(e.capRx * 0.42, e.capRy * 0.42)
    }));
    g.appendChild(cap);

    /* ---- Rear: feed block and drive ----
     * Square to the screen and centred on the layer, because this is the anchor
     * the mixer feeds into. Compact on purpose: the feed entry and the drive
     * need to be legible as a region, not as a mechanism. */
    const back = group(doc, "station-extruder__rear", "extruder-rear");
    back.appendChild(node(doc, "rect", "station-extruder__feed", {
      x: e.rearBlock.x, y: e.rearBlock.y,
      width: e.rearBlock.width, height: e.rearBlock.height, rx: 2
    }));
    back.appendChild(node(doc, "rect", "station-extruder__drive", {
      x: e.drive.x, y: e.drive.y, width: e.drive.width, height: e.drive.height, rx: 2
    }));
    // Drive cooling, as two ticks - enough to say "gearbox", cheap at any size.
    for (const side of [-1, 1]) {
      back.appendChild(node(doc, "line", "station-extruder__drive-vent", {
        x1: e.drive.centerX + side * e.drive.width * 0.22, y1: e.drive.y + e.drive.height * 0.25,
        x2: e.drive.centerX + side * e.drive.width * 0.22, y2: e.drive.y + e.drive.height * 0.75
      }));
    }
    g.appendChild(back);

    /* The layer's share of the film structure. Upright, always: it is data, and
     * it must not be dragged into the equipment's perspective. */
    g.appendChild(label(doc,
      Number.isFinite(layerPct) && layerPct > 0 ? `${round(layerPct)}%` : "—",
      e.rearBlock.centerX, e.rearBlock.y + e.rearBlock.height * 0.72,
      "station-extruder__pct"));

    return g;
  }

  /* --------------------------------------------------------------------
   *   Layer bank - one layer's whole equipment train
   * ------------------------------------------------------------------ */

  function layerBank(doc, bank, hopperState, layerState, options) {
    const settings = options || {};
    const classes = ["station-layer"];
    if (bank.emphasis === "focused") classes.push("is-focused");
    if (bank.emphasis === "dimmed") classes.push("is-dimmed");
    /* "Running" means the layer has a recipe to mix. Derived from the state
     * already on screen - no new field, no timer - and it is what gates the
     * agitator's motion, so an unconfigured layer sits still. */
    if (bank.cluster.hoppers.some(h => {
      const runtime = hopperState ? hopperState[`${bank.id}:${h.index}`] : null;
      return !!(runtime && runtime.resinName);
    })) classes.push("is-running");
    if (settings.selectedTarget) classes.push(`is-${settings.selectedTarget}-selected`);

    const g = group(doc, classes.join(" "), "layer", {
      "data-layer": bank.id,
      "data-layer-role": bank.role,
      "data-emphasis": bank.emphasis
    });

    const header = group(doc, "station-layer__header", "layer-header", { "data-layer": bank.id });
    header.appendChild(label(doc, bank.id, bank.header.x, bank.header.y, "station-layer__name"));
    header.appendChild(label(doc, String(bank.roleLabel || "").toUpperCase(),
      bank.header.x, bank.header.y + 14, "station-layer__role"));
    /* Said on the surface itself, not only in a side panel. The controls below
     * look like controls, so the one thing they must not do is look live. */
    if (bank.emphasis === "focused") {
      header.appendChild(label(doc, "READ-ONLY — NO WRITE CONTRACT YET",
        bank.header.x, bank.header.y + 28, "station-layer__notice"));
    }
    g.appendChild(header);

    g.appendChild(hopperCluster(doc, bank, hopperState, settings));
    g.appendChild(mixer(doc, bank));
    g.appendChild(extruder(doc, bank, layerState && layerState[bank.id] ? layerState[bank.id].layerPct : null));
    return g;
  }

  return {
    SVG_NS, node, label, group, taper, hitArea, fitText,
    field, hopper, hopperCluster, mixer, extruder, layerBank
  };
});
