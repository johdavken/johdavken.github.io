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
 * Three targets, and only three: the mixer and the extruder - the equipment
 * train - open the layer in the workspace (and inspect the blend and the
 * layer percentage respectively); the hopper cluster is the hoppers
 * themselves, where pump and tracking controls will live. They are marked
 * with data-station-target and nothing else is clickable, so the mapping
 * cannot drift. No listeners are attached here - the renderer stays
 * event-free and testable, and station.js delegates from the mount.
 */
(function (root, factory) {
  const deps = {
    extruderAssets: typeof require === "function"
      ? require("./station-extruder-assets.js")
      : (root && root.PolynStationExtruderAssets),
    mixerAssets: typeof require === "function"
      ? require("./station-mixer-assets.js")
      : (root && root.PolynStationMixerAssets)
  };
  const api = factory(deps);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationMachineParts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const extruderAssets = deps.extruderAssets;
  const mixerAssets = deps.mixerAssets;

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
    }
    if (!geometry.profiled) classes.push("is-unprofiled");
    // Selected in the focused editor, or by a click on the hopper itself.
    if (settings.selected) classes.push("is-selected");

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
     * Shown only when it has a value: a bank of six "no source" labels is
     * noise that crowds out the fields that do carry information. */
    if (runtime && runtime.source) {
      const source = group(doc, "station-hopper__source-mark", "hopper-source");
      source.appendChild(label(doc, fitText(runtime.source, w * 1.3, 9 * scale),
        cx, geometry.sourceY, "station-hopper__source"));
      source.appendChild(node(doc, "line", "station-hopper__source-drop", {
        x1: cx, y1: geometry.sourceY + 3 * scale, x2: cx, y2: geometry.receiverTop - 1
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

    /* ---- Readout ----
     * Identity and contribution. The resin code joins them when the hopper
     * is wide enough to draw it at full size; it is never shrunk to fit,
     * because an unreadable code is worse than no code. */
    const caption = group(doc, "station-hopper__caption", "hopper-caption");
    let y = geometry.captionTop;
    caption.appendChild(label(doc, geometry.id, cx, y, "station-hopper__id"));
    y += 13 * scale;
    caption.appendChild(label(doc,
      runtime && runtime.pct ? `${round(runtime.pct)}%` : "—",
      cx, y, "station-hopper__pct"));
    if (geometry.showResin) {
      y += 12 * scale;
      caption.appendChild(label(doc,
        runtime && runtime.resinName ? fitText(runtime.resinName, w, 9 * scale) : "",
        cx, y, "station-hopper__resin"));
    }
    g.appendChild(caption);

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
        selected: !!settings.selectedHopper && settings.selectedHopper === geometry.id
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
    const asset = mixerAssets.views[m.view];
    const g = group(doc, "station-mixer", "mixer", {
      "data-layer": bank.id,
      "data-station-target": "mixer",
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

    const r = asset.rotor;
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
  function extruder(doc, bank, layerPct) {
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
    const body = group(doc, "station-extruder__body", "extruder-body");
    for (const polygon of asset.polygons) {
      body.appendChild(node(doc, "path",
        `station-extruder__face station-extruder__${polygon.part} ` +
        `station-extruder__${polygon.part}--${polygon.face}`, {
          "data-part": polygon.part,
          "data-face": polygon.face,
          d: pathFor(polygon.points)
        }));
    }
    g.appendChild(body);

    /* The layer's share of the film structure. Upright, always, and under the
     * machine on the layer centreline: it is data, and it must not be dragged
     * into the equipment's perspective. */
    g.appendChild(label(doc,
      Number.isFinite(layerPct) && layerPct > 0 ? `${round(layerPct)}%` : "—",
      e.label.x, e.label.y, "station-extruder__pct"));

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
      "data-object-train": box(bank.objects.train)
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
    g.appendChild(header);

    g.appendChild(hopperCluster(doc, bank, hopperState, settings));
    /* Extruder, then the throat, then the mixer. The throat lands on the feed
     * flange, which stands in front of the gearbox and motor; drawn the other
     * way round the motor would paint over it and the two would look
     * unconnected. */
    g.appendChild(extruder(doc, bank, layerState && layerState[bank.id] ? layerState[bank.id].layerPct : null));
    g.appendChild(throat(doc, bank));
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
    SVG_NS, node, label, group, taper, hitArea, fitText,
    hopper, hopperCluster, mixer, throat, extruder, layerBank, workspace
  };
});
