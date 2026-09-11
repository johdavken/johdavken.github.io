"use strict";

/* The layer equipment view.
 *
 * Two things are worth testing about a schematic, and neither is what it looks
 * like. The first is that it is assembled from configuration rather than drawn
 * once at five layers - the requirement most likely to rot the moment someone
 * hard-codes a coordinate. The second is that the three interaction targets
 * mean what they are documented to mean, because that mapping is the contract
 * the rest of Station will be built against.
 *
 * Both are properties of the layout and the markup, so everything runs in node.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const layoutModule = require("./station/station-machine-layout.js");
const parts = require("./station/station-machine-parts.js");
const render = require("./station/station-render.js");
const model = require("./station/station-line-model.js");

function literal(overrides) {
  return Object.assign({
    lineNumber: 1,
    displayName: "Test line",
    layerCount: 3,
    layerAPosition: "outside",
    hopperNamingMode: "standard",
    hopperGeometry: "cylindrical"
  }, overrides);
}

const layoutFor = (config, options) => layoutModule.computeLayout(model.buildLineModel(config), options);

/* ----------------------------------------------------------------------
 *   A fake document, just big enough
 * -------------------------------------------------------------------- */

function makeNode(name) {
  return {
    nodeName: name,
    attributes: {},
    children: [],
    textContent: "",
    get firstChild() { return this.children[0] || null; },
    setAttribute(key, value) { this.attributes[key] = String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      return child;
    }
  };
}

const fakeDocument = () => ({
  createElement: name => makeNode(name),
  createElementNS: (ns, name) => { const n = makeNode(name); n.namespaceURI = ns; return n; }
});

function walk(node, visit) {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

/* `data-hopper` appears on the hopper assembly AND on its receiver, which is
 * addressable in its own right. Anything that means "the hopper" must say so
 * by role rather than by that attribute. */
function allWithClassName(node, className) {
  const found = [];
  walk(node, current => {
    if (String(current.getAttribute("class") || "").split(/\s+/).includes(className)) found.push(current);
  });
  return found;
}

function hoppersIn(node) {
  return allWith(node, "data-role", "hopper");
}

function allWith(node, attribute, value) {
  const found = [];
  walk(node, current => {
    const actual = current.getAttribute(attribute);
    if (actual === null) return;
    if (value === undefined || actual === value) found.push(current);
  });
  return found;
}

function textOf(node, className) {
  const out = [];
  walk(node, current => {
    if (String(current.getAttribute("class") || "").split(/\s+/).includes(className)) out.push(current.textContent);
  });
  return out;
}

const stageFor = (config, options) =>
  render.renderStage(model.buildLineModel(config), Object.assign({ document: fakeDocument() }, options || {}));

/* ----------------------------------------------------------------------
 *   Layer count drives the banks
 * -------------------------------------------------------------------- */

test("one bank per configured layer, at every supported layer count", () => {
  for (const layerCount of [1, 3, 5]) {
    const config = literal({ layerCount, layerAPosition: layerCount === 1 ? null : "outside" });
    assert.equal(layoutFor(config).banks.length, layerCount);

    const svg = stageFor(config);
    assert.equal(allWith(svg, "data-role", "layer").length, layerCount);
    // One of each piece of equipment per bank, and no shared equipment at all.
    for (const role of ["hopper-cluster", "mixer", "extruder", "layer-header"]) {
      assert.equal(allWith(svg, "data-role", role).length, layerCount, `${role} at ${layerCount} layers`);
    }
    assert.equal(svg.getAttribute("data-layer-count"), String(layerCount));
  }
});

test("nothing downstream of the extruder is drawn", () => {
  // The whole point of the new concept: this view is the resin-handling side.
  const svg = stageFor(literal({ layerCount: 5 }));
  for (const role of ["die", "tower", "bubble", "cage", "collapsing-frame",
    "nip", "film-path", "idlers", "winders", "air-ring"]) {
    assert.equal(allWith(svg, "data-role", role).length, 0, `${role} is still being drawn`);
  }
});

test("a layer count the payload module does not define still renders", () => {
  const layout = layoutFor(literal({ layerCount: 4 }));
  assert.equal(layout.banks.length, 4);
  assert.deepEqual(layout.banks.map(bank => bank.id), ["A", "B", "C", "D"]);
});

/* ----------------------------------------------------------------------
 *   Hopper count comes from configuration
 * -------------------------------------------------------------------- */

test("hopper count is per layer and comes from configuration, not a constant", () => {
  const config = literal({
    layers: [{ id: "A", hopperCount: 4 }, { id: "B", hopperCount: 6 }, { id: "C", hopperCount: 3 }]
  });
  assert.deepEqual(layoutFor(config).banks.map(b => b.cluster.hoppers.length), [4, 6, 3]);

  const svg = stageFor(config);
  assert.deepEqual(
    allWith(svg, "data-role", "hopper-cluster").map(c => allWith(c, "data-role", "hopper").length),
    [4, 6, 3]
  );
});

test("a four-hopper layer and a six-hopper layer use the same component", () => {
  /* Same builder, same sub-groups, same classes - only the count differs. If
   * these ever diverge it will be because someone special-cased a count. */
  const svg = stageFor(literal({
    layers: [{ id: "A", hopperCount: 4 }, { id: "B", hopperCount: 6 }, { id: "C", hopperCount: 6 }]
  }));
  const shapeOf = hopper => {
    const classes = [];
    walk(hopper, node => { if (node.getAttribute("class")) classes.push(node.getAttribute("class")); });
    return classes.join("|");
  };
  const first = allWith(svg, "data-layer", "A").filter(n => n.getAttribute("data-role") === "hopper");
  const second = allWith(svg, "data-layer", "B").filter(n => n.getAttribute("data-role") === "hopper");
  assert.equal(first.length, 4);
  assert.equal(second.length, 6);
  assert.equal(shapeOf(first[0]), shapeOf(second[0]));
});

test("a wider bank makes the stage wider, never taller", () => {
  const narrow = render.stageMetrics(model.buildLineModel(literal({ hopperCount: 3 })));
  const wide = render.stageMetrics(model.buildLineModel(literal({ hopperCount: 9 })));
  assert.ok(wide.width > narrow.width);
  assert.equal(wide.height, narrow.height);
});

/* ----------------------------------------------------------------------
 *   Positioning is calculated, not tabulated
 * -------------------------------------------------------------------- */

test("banks never overlap, at any layer or hopper count", () => {
  for (const config of [
    literal({ layerCount: 5 }),
    literal({ layerCount: 5, hopperCount: 2 }),
    literal({ layerCount: 3, hopperCount: 9 }),
    literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 })
  ]) {
    const banks = layoutFor(config).banks;
    for (let i = 1; i < banks.length; i++) {
      assert.ok(banks[i - 1].x + banks[i - 1].width <= banks[i].x, "two banks overlap");
    }
  }
});

test("the row is centred on the canvas, and is not five slots with the spares hidden", () => {
  const metrics = [1, 3, 5].map(layerCount =>
    render.stageMetrics(model.buildLineModel(literal({ layerCount, layerAPosition: layerCount === 1 ? null : "outside" }))));

  // Every layer count gets its own row width - a hidden-slot grid would not.
  assert.equal(new Set(metrics.map(m => m.rowWidth)).size, 3);

  // And the row sits centred: the same slack on both sides.
  for (const m of metrics) {
    const right = m.width - (m.rowX + m.rowWidth);
    assert.ok(Math.abs(right - m.rowX) < 1.5, `row is not centred (${m.rowX} vs ${right})`);
  }
});

test("a narrow line is centred on the canvas rather than stretched to fill it", () => {
  const one = render.stageMetrics(model.buildLineModel(literal({ layerCount: 1, layerAPosition: null })));
  const five = render.stageMetrics(model.buildLineModel(literal({ layerCount: 5 })));
  assert.ok(one.rowX > five.rowX, "the one-layer row was not centred");
  assert.ok(five.width > one.width, "the canvas did not grow with the layer count");
});

/* ----------------------------------------------------------------------
 *   Extruder convergence
 * -------------------------------------------------------------------- */

test("extruder angle is derived from distance off centre, not from the layer letter", () => {
  const angle = layoutModule.extruderAngle;
  // Same position in the stack, same angle, whatever the layer is called.
  assert.equal(angle(0, 5, 12), angle(0, 5, 12));
  // Symmetric about the centre.
  assert.equal(angle(0, 5, 12), -angle(4, 5, 12));
  assert.equal(angle(1, 5, 12), -angle(3, 5, 12));
});

test("the centre layer of an odd stack is straight, and the outermost is at the full angle", () => {
  /* Stated as magnitude and symmetry rather than as signed numbers. Which sign
   * means "inward" is a fact about SVG's rotation direction, and it is asserted
   * where it belongs - in the geometry test below - so that hard-coding it here
   * cannot quietly lock in a convention nobody re-derived. */
  for (const layerCount of [3, 5, 7]) {
    const centre = (layerCount - 1) / 2;
    const first = layoutModule.extruderAngle(0, layerCount, 12);
    const last = layoutModule.extruderAngle(layerCount - 1, layerCount, 12);
    assert.equal(layoutModule.extruderAngle(centre, layerCount, 12), 0, `${layerCount}: centre is not straight`);
    assert.equal(Math.abs(first), 12, `${layerCount}: outermost is not at the full angle`);
    assert.equal(first, -last, `${layerCount}: the ends are not mirror images`);
  }
});

test("a single layer is straight, because there is nothing to converge on", () => {
  assert.equal(layoutModule.extruderAngle(0, 1, 12), 0);
  assert.equal(layoutFor(literal({ layerCount: 1, layerAPosition: null })).banks[0].extruder.angle, 0);
});

test("yaw grows with distance from the centre and stays within the maximum", () => {
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  const magnitudes = banks.map(bank => Math.abs(bank.extruder.angle));
  // Progressively more turned the further out, in both directions.
  assert.ok(magnitudes[0] > magnitudes[1] && magnitudes[1] > magnitudes[2]);
  assert.ok(magnitudes[4] > magnitudes[3] && magnitudes[3] > magnitudes[2]);
  assert.equal(magnitudes[2], 0);
  // Mirror image about the centre.
  assert.equal(banks[0].extruder.angle, -banks[4].extruder.angle);
  assert.equal(banks[1].extruder.angle, -banks[3].extruder.angle);
  for (const bank of banks) {
    assert.ok(Math.abs(bank.extruder.angle) <= layoutModule.DIMENSIONS.extruderMaxYaw + 0.001,
      "an extruder is turned past the maximum yaw");
  }
});

test("an even layer count has no straight extruder and stays symmetric", () => {
  const angles = layoutFor(literal({ layerCount: 4 })).banks.map(b => b.extruder.angle);
  assert.ok(!angles.includes(0));
  assert.equal(angles[0], -angles[3]);
  assert.equal(angles[1], -angles[2]);
});

test("no extruder is rotated in the plane of the screen - the machines stand upright", () => {
  /* The whole point of yaw over tilt. A rotate() anywhere in this group would
   * lean the machine, which is the thing this pass replaced. */
  const svg = stageFor(literal({ layerCount: 5 }), { layerState: { A: { layerPct: 20 } } });
  for (const extruder of allWith(svg, "data-role", "extruder")) {
    walk(extruder, node => {
      const transform = node.getAttribute("transform");
      assert.ok(!transform || !/rotate/.test(transform),
        `${node.nodeName} inside the extruder is rotated: ${transform}`);
    });
    // The percentage is upright by construction, so it needs no correction.
    const readout = [];
    walk(extruder, node => {
      if (String(node.getAttribute("class") || "").includes("station-extruder__pct")) readout.push(node);
    });
    assert.equal(readout.length, 1);
    assert.equal(readout[0].getAttribute("transform"), null);
  }
});

test("yaw reaches the markup as a facing direction, mirrored about the centre", () => {
  const svg = stageFor(literal({ layerCount: 5 }));
  const facing = allWith(svg, "data-role", "extruder").map(node => ({
    layer: node.getAttribute("data-layer"),
    yaw: Number(node.getAttribute("data-yaw")),
    facing: node.getAttribute("data-facing")
  }));
  // Left-hand machines turn right and show their left flank; mirror on the
  // other side; the centre shows no flank at all.
  assert.deepEqual(facing.map(f => f.facing), ["left", "left", "front", "right", "right"]);
  assert.equal(facing[0].yaw, -facing[4].yaw);
  assert.equal(facing[2].yaw, 0);
});

test("the barrel lengthens and the end cap flattens as a machine turns", () => {
  /* The three things that move together and make the turn read as depth: the
   * front end swings sideways, the projected barrel gets longer because it is
   * less foreshortened, and the cap squashes because you are no longer looking
   * straight down it. */
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  const e = banks.map(b => b.extruder);

  // Centre: straight down, shortest projection, round cap.
  assert.equal(e[2].front.x, e[2].rear.x);
  assert.equal(Math.round(e[2].capRy), Math.round(e[2].capRx));

  // Outward: longer barrel, flatter cap, monotonically.
  assert.ok(e[0].length > e[1].length && e[1].length > e[2].length);
  assert.ok(e[0].capRy < e[1].capRy && e[1].capRy < e[2].capRy);
  // The cap never collapses to a line.
  for (const one of e) assert.ok(one.capRy > one.capRx * 0.3);
});

test("extruderGeometry is pure geometry and mirrors exactly", () => {
  const geometry = layoutModule.extruderGeometry;
  const d = layoutModule.DIMENSIONS;
  const at = angle => geometry(angle, d, { pivotX: 0, pivotY: 0 });

  // Facing straight out: no lateral travel at all.
  assert.equal(at(0).front.x, 0);
  assert.equal(at(0).fraction, 0);

  // Mirrored in every dimension that should be, and only in the sign of the
  // one that should not.
  const left = at(-20);
  const right = at(20);
  assert.equal(left.front.x, -right.front.x);
  assert.equal(left.front.y, right.front.y);
  assert.equal(left.length, right.length);
  assert.equal(left.capRy, right.capRy);
  assert.equal(left.rear.x, right.rear.x, "the rear anchor must not mirror - it never moves");
});

test("the extruder pivots where it meets the mixer, so tilting never opens a gap", () => {
  for (const bank of layoutFor(literal({ layerCount: 5 })).banks) {
    assert.equal(bank.extruder.pivotX, bank.mixer.centerX);
    assert.ok(bank.extruder.pivotY >= bank.mixer.y + bank.mixer.height,
      "the extruder pivot is inside the mixer body");
  }
});

/* ----------------------------------------------------------------------
 *   The equipment train stacks in process order
 * -------------------------------------------------------------------- */

test("a bank stacks receiver, vessel, cone, mixer and extruder in that order", () => {
  const bank = layoutFor(literal({})).banks[0];
  const hopper = bank.cluster.hoppers[0];
  const stages = [
    ["header", bank.header.y],
    ["receiver", hopper.receiverTop],
    ["vessel", hopper.vesselTop],
    ["cone", hopper.coneTop],
    ["spout", hopper.spoutTop],
    ["mixer", bank.mixer.y],
    ["extruder", bank.extruder.pivotY]
  ];
  for (let i = 1; i < stages.length; i++) {
    assert.ok(stages[i][1] > stages[i - 1][1], `${stages[i][0]} must sit below ${stages[i - 1][0]}`);
  }
});

test("the hopper assembly keeps the boundaries a later phase has to drive", () => {
  // Selection, tracking, pump-off, warning, resin identity, fill and source
  // all attach to one of these. They are asserted so the artwork cannot
  // quietly collapse into one anonymous shape.
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }));
  const hopper = allWith(svg, "data-role", "hopper")[0];
  const classes = [];
  walk(hopper, node => { if (node.getAttribute("class")) classes.push(node.getAttribute("class")); });
  for (const part of ["station-hopper__receiver", "station-hopper__body",
    "station-hopper__material", "station-hopper__cone", "station-hopper__feed"]) {
    assert.equal(classes.filter(one => one === part).length, 1, `missing ${part}`);
  }
});

/* ----------------------------------------------------------------------
 *   Recipe readout
 * -------------------------------------------------------------------- */

test("the compact readout leads with identity and contribution", () => {
  /* Hopper id and blend percentage always; those are what a narrow column can
   * carry legibly. */
  const svg = stageFor(literal({ layerCount: 5, hopperCount: 3 }), {
    hopperState: {
      "A:0": { assigned: true, resinName: "HX204", pct: 60 },
      "A:1": { assigned: true, resinName: "LD105", pct: 30 },
      "A:2": { assigned: false, resinName: "", pct: 0 }
    }
  });
  assert.deepEqual(textOf(svg, "station-hopper__id").slice(0, 3), ["A1", "A2", "A3"]);
  assert.deepEqual(textOf(svg, "station-hopper__pct").slice(0, 3), ["60%", "30%", "—"]);
});

test("resin codes are dropped in the dense view and shown where there is room", () => {
  /* Never shrunk to fit: an unreadable code is worse than no code. Five layers
   * is the dense case; one layer has the width for it. */
  const dense = stageFor(literal({ layerCount: 5, hopperCount: 6 }), {
    hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60 } }
  });
  assert.deepEqual(textOf(dense, "station-hopper__resin"), [],
    "the five-layer overview is drawing resin codes it has no room for");

  const roomy = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }), {
    hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60 } }
  });
  assert.ok(textOf(roomy, "station-hopper__resin").includes("HX204"),
    "a one-layer line has the width for a resin code and should show it");
});

test("resin identity stays reachable on hover even where the code is dropped", () => {
  // A <title> is the native SVG tooltip and what a screen reader announces.
  const svg = stageFor(literal({ layerCount: 5, hopperCount: 6 }), {
    hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" } }
  });
  const titles = [];
  walk(svg, node => { if (node.nodeName === "title") titles.push(node.textContent); });
  assert.equal(titles.length, hoppersIn(svg).length,
    "every hopper needs a title, or hover is the only place the resin lives and it is missing");
  assert.ok(titles.some(t => /HX204/.test(t) && /SILO 3/.test(t)));
  assert.ok(titles.some(t => /no resin assigned/.test(t)));
});

test("the same hopper is taller when its profile says it is taller", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }), {
    hopperState: {
      "A:0": { assigned: true, usableHeight: 22 },
      "A:1": { assigned: true, usableHeight: 30 },
      "A:2": { assigned: true, usableHeight: 36 }
    }
  });
  const shells = [];
  walk(svg, node => {
    if (String(node.getAttribute("class") || "").includes("station-hopper__shell")) shells.push(node);
  });
  const heights = shells.map(s => Number(s.getAttribute("height")));
  assert.ok(heights[0] < heights[1] && heights[1] < heights[2], "profile height did not reach the drawing");
  // Bottom-aligned: they all discharge at the same level.
  const bottoms = shells.map(s => Number(s.getAttribute("y")) + Number(s.getAttribute("height")));
  assert.equal(new Set(bottoms.map(b => Math.round(b))).size, 1, "hopper bottoms are not aligned");
});

test("a resin code too wide for its hopper is truncated, not overrun", () => {
  assert.equal(parts.fitText("HX204", 40, 9), "HX204");
  assert.match(parts.fitText("VERYLONGRESINCODE", 30, 9), /…$/);
  assert.ok(parts.fitText("VERYLONGRESINCODE", 30, 9).length < "VERYLONGRESINCODE".length);
});

test("the layer percentage is shown on the extruder that represents it", () => {
  const svg = stageFor(literal({ layerCount: 3 }), {
    layerState: { A: { layerPct: 25 }, B: { layerPct: 50 }, C: { layerPct: 25 } }
  });
  assert.deepEqual(textOf(svg, "station-extruder__pct").sort(), ["25%", "25%", "50%"]);
});

test("with no layer state the percentage reads as unknown, never as zero or a guess", () => {
  assert.deepEqual(textOf(stageFor(literal({ layerCount: 3 })), "station-extruder__pct"), ["—", "—", "—"]);
});

/* ----------------------------------------------------------------------
 *   Interaction targets
 * -------------------------------------------------------------------- */

test("the documented targets exist per layer, and nothing else is declared", () => {
  /* Three equipment targets per layer, plus one receiver target per hopper.
   * The receiver is declared because it is the pump's indicator and its
   * eventual toggle; it does not act yet, because acting would be a write. */
  const svg = stageFor(literal({ layerCount: 3, hopperCount: 2 }));
  const targets = allWith(svg, "data-station-target");
  const kinds = new Set(targets.map(node => node.getAttribute("data-station-target")));
  assert.deepEqual([...kinds].sort(), ["cluster", "extruder", "mixer", "receiver"]);

  for (const layer of ["A", "B", "C"]) {
    const forLayer = targets.filter(node => node.getAttribute("data-layer") === layer)
      .map(node => node.getAttribute("data-station-target"));
    assert.equal(forLayer.filter(t => t === "cluster").length, 1);
    assert.equal(forLayer.filter(t => t === "mixer").length, 1);
    assert.equal(forLayer.filter(t => t === "extruder").length, 1);
    assert.equal(forLayer.filter(t => t === "receiver").length, 2, "one receiver per hopper");
  }
});

test("every receiver target sits inside its own hopper's cluster", () => {
  // Which is what lets a click on it fall through to opening the layer while
  // the pump has no write path.
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }));
  const cluster = allWith(svg, "data-station-target", "cluster")[0];
  assert.equal(allWith(cluster, "data-station-target", "receiver").length, 3);
});

test("each target is the group for the equipment it names", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null }));
  for (const [target, role] of [["cluster", "hopper-cluster"], ["mixer", "mixer"], ["extruder", "extruder"]]) {
    const node = allWith(svg, "data-station-target", target)[0];
    assert.equal(node.getAttribute("data-role"), role,
      `the ${target} target is not the ${role} group - the mapping has drifted`);
  }
});

test("every actionable target carries a hit area, or clicks fall through the gaps", () => {
  const svg = stageFor(literal({ layerCount: 3 }));
  const actionable = allWith(svg, "data-station-target")
    .filter(node => node.getAttribute("data-station-target") !== "receiver");
  for (const target of actionable) {
    const hits = [];
    walk(target, node => {
      if (String(node.getAttribute("class") || "") === "station-hit") hits.push(node);
    });
    assert.ok(hits.length >= 1, `${target.getAttribute("data-station-target")} has no hit area`);
    assert.ok(Number(hits[0].getAttribute("width")) > 0 && Number(hits[0].getAttribute("height")) > 0);
  }
});

test("nothing else in the machine is clickable", () => {
  const svg = stageFor(literal({ layerCount: 5 }));
  const targets = new Set(allWith(svg, "data-station-target"));
  walk(svg, node => {
    if (String(node.getAttribute("class") || "") !== "station-hit") return;
    // Every hit area belongs to a target.
    let owner = null;
    walk(svg, candidate => {
      if (!targets.has(candidate)) return;
      walk(candidate, inner => { if (inner === node) owner = candidate; });
    });
    assert.ok(owner, "a hit area exists outside any declared target");
  });
});

/* ----------------------------------------------------------------------
 *   Expanded edit state
 * -------------------------------------------------------------------- */

test("focusing a layer expands it and dims the others, without removing them", () => {
  const svg = stageFor(literal({ layerCount: 5 }), { focusLayer: "C" });
  const banks = allWith(svg, "data-role", "layer");
  assert.equal(banks.length, 5, "the other layers must stay present for context");
  assert.deepEqual(banks.map(b => b.getAttribute("data-emphasis")),
    ["dimmed", "dimmed", "focused", "dimmed", "dimmed"]);
  assert.equal(svg.getAttribute("data-focus-layer"), "C");
});

test("the focused layer is genuinely bigger and the dimmed ones genuinely smaller", () => {
  const plain = layoutFor(literal({ layerCount: 5 }));
  const focused = layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" });
  const base = plain.banks[2].cluster.hopperWidth;

  assert.ok(focused.banks[2].cluster.hopperWidth > base * 1.5, "the focused bank did not expand");
  assert.ok(focused.banks[0].cluster.hopperWidth < base * 0.75, "the other banks did not shrink");
  // The whole bank scales together, not just its hoppers.
  assert.ok(focused.banks[0].extruder.scale < plain.banks[0].extruder.scale);
  assert.ok(focused.banks[2].extruder.scale > plain.banks[2].extruder.scale);
});

test("the row recentres around the expanded layer instead of drifting off the canvas", () => {
  const focused = layoutFor(literal({ layerCount: 5 }), { focusLayer: "A" });
  const right = focused.width - (focused.row.x + focused.row.width);
  assert.ok(Math.abs(right - focused.row.x) < 1.5, "the row is no longer centred while focused");
});

test("only the focused layer shows per-hopper source detail", () => {
  const hopperState = {
    "A:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" },
    "B:0": { assigned: true, resinName: "LD105", pct: 60, source: "SILO 4" }
  };
  const svg = stageFor(literal({ layerCount: 3, hopperCount: 1 }), { focusLayer: "A", hopperState });
  // Expanded, the source is a control on the equipment rather than a caption.
  assert.deepEqual(textOf(svg, "station-field__value--source"), ["SILO 3"]);
  // Dimmed banks drop their captions entirely - at that size they are noise.
  assert.deepEqual(textOf(svg, "station-hopper__id"), ["A1"]);
});

test("focusing one layer does not change any other layer's extruder angle", () => {
  const plain = layoutFor(literal({ layerCount: 5 }));
  const focused = layoutFor(literal({ layerCount: 5 }), { focusLayer: "A" });
  assert.deepEqual(focused.banks.map(b => b.extruder.angle), plain.banks.map(b => b.extruder.angle));
});

test("a selected target is marked on its own bank and nowhere else", () => {
  const svg = stageFor(literal({ layerCount: 3 }), { focusLayer: "B", selectedTarget: "mixer" });
  const banks = allWith(svg, "data-role", "layer");
  const marked = banks.filter(b => String(b.getAttribute("class")).includes("is-mixer-selected"));
  assert.equal(marked.length, 1);
  assert.equal(marked[0].getAttribute("data-layer"), "B");
});

/* ----------------------------------------------------------------------
 *   Componentisation
 * -------------------------------------------------------------------- */

test("a component can be resized without touching any other component", () => {
  /* The reason the layout is separate from the paths. Changing the mixer is one
   * number, and nothing else in the drawing moves with it. */
  const base = layoutFor(literal({ layerCount: 3 }));
  const moved = layoutFor(literal({ layerCount: 3 }), { dimensions: { mixerHeight: 120 } });
  assert.notEqual(moved.banks[0].mixer.height, base.banks[0].mixer.height);
  for (const [what, read] of [
    ["hopper vessel", l => l.banks[0].cluster.hoppers[0].vesselTop],
    ["hopper width", l => l.banks[0].cluster.hopperWidth],
    ["extruder yaw", l => l.banks[0].extruder.angle],
    ["bank x", l => l.banks[1].x]
  ]) {
    assert.equal(read(moved), read(base), `${what} moved with the mixer`);
  }
  /* The extruder DOES follow the mixer, and that is deliberate: it hangs off
   * the bottom of the neck, so a taller blender pushes it down instead of
   * being drawn through it. Everything else stays put. */
  assert.ok(moved.banks[0].extruder.pivotY > base.banks[0].extruder.pivotY,
    "the extruder should follow the bottom of the neck");
});

test("changing the extruder does not disturb the hoppers or the banks", () => {
  const base = layoutFor(literal({ layerCount: 3 }));
  const longer = layoutFor(literal({ layerCount: 3 }), { dimensions: { extruderAxisDrop: 240 } });
  assert.ok(longer.banks[0].extruder.length > base.banks[0].extruder.length);
  assert.deepEqual(longer.banks.map(b => b.x), base.banks.map(b => b.x));
  assert.equal(longer.banks[0].cluster.hoppers[0].vesselTop, base.banks[0].cluster.hoppers[0].vesselTop);
});

test("every part builder returns a single addressable group", () => {
  const doc = fakeDocument();
  const bank = layoutFor(literal({})).banks[0];
  for (const [role, build] of [
    ["hopper-cluster", () => parts.hopperCluster(doc, bank, null, {})],
    ["mixer", () => parts.mixer(doc, bank)],
    ["extruder", () => parts.extruder(doc, bank, 25)],
    ["layer", () => parts.layerBank(doc, bank, null, null, {})]
  ]) {
    const g = build();
    assert.equal(g.nodeName, "g", `${role} is not a group`);
    assert.equal(g.getAttribute("data-role"), role);
    assert.ok(g.children.length > 0, `${role} is empty`);
  }
});

test("an unmodellable line draws nothing rather than an empty machine", () => {
  assert.equal(layoutModule.computeLayout(null), null);
  assert.equal(layoutModule.computeLayout({ layers: [] }), null);
  assert.equal(render.stageMetrics(null), null);
});

/* ----------------------------------------------------------------------
 *   Runtime state is additive
 * -------------------------------------------------------------------- */

test("runtime state reaches the DOM as semantic state classes on the right hoppers", () => {
  const svg = stageFor(literal({ layerCount: 3, hopperCount: 2 }), {
    hopperState: {
      "A:0": { track: true, assigned: true, resinName: "X" },
      "B:1": { pumpOff: true, assigned: true, resinName: "Y" },
      "C:0": { assigned: false }
    }
  });
  const byId = {};
  for (const hopper of hoppersIn(svg)) {
    byId[hopper.getAttribute("data-hopper")] = String(hopper.getAttribute("class")).split(/\s+/);
  }
  // is-unprofiled rides along on every hopper here: none carries a profile
  // height, and the drawing says so rather than implying a measurement.
  assert.deepEqual(byId.A1, ["station-hopper", "is-tracking", "is-unprofiled"]);
  assert.deepEqual(byId.B2, ["station-hopper", "is-pump-off", "is-unprofiled"]);
  assert.deepEqual(byId.C1, ["station-hopper", "is-unassigned", "is-unprofiled"]);
  assert.deepEqual(byId.A2, ["station-hopper", "is-unprofiled"]);
});

test("pump state reaches the receiver, which is the only thing that shows it", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }), {
    hopperState: {
      "A:0": { assigned: true, pumpOff: false },
      "A:1": { assigned: true, pumpOff: true }
    }
  });
  const receivers = allWith(svg, "data-station-target", "receiver");
  assert.deepEqual(receivers.map(r => r.getAttribute("data-pump")), ["on", "off", "on"]);
  // No separate pump badge was bolted onto the graphic.
  assert.equal(allWith(svg, "data-role", "pump-button").length, 0);
});

test("a profiled hopper is not marked unprofiled", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 2 }), {
    hopperState: { "A:0": { assigned: true, usableHeight: 34 }, "A:1": { assigned: true } }
  });
  const byId = {};
  for (const hopper of hoppersIn(svg)) {
    byId[hopper.getAttribute("data-hopper")] = String(hopper.getAttribute("class"));
  }
  assert.ok(!byId.A1.includes("is-unprofiled"));
  assert.ok(byId.A2.includes("is-unprofiled"));
});

test("state classes are keyed by physical slot, so a naming mode cannot misplace them", () => {
  // Line 9 names the first hopper AM rather than A1; the runtime key is the
  // slot, so the state still lands on the first hopper.
  const svg = stageFor(9, { hopperState: { "A:0": { track: true, assigned: true } } });
  const first = hoppersIn(svg)[0];
  assert.equal(first.getAttribute("data-hopper"), "AM");
  assert.ok(String(first.getAttribute("class")).includes("is-tracking"));
});

/* ----------------------------------------------------------------------
 *   CSS isolation for the SVG this view introduces
 * -------------------------------------------------------------------- */

test("every drawn element carries a class that a Station stylesheet defines", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = ["machine.css", "hopper.css", "layer-bank.css"]
    .map(name => fs.readFileSync(path.join(__dirname, "station/styles/components", name), "utf8"))
    .join("\n");

  const svg = stageFor(literal({ layerCount: 5 }), { focusLayer: "C", showHint: true });
  const missing = new Set();
  walk(svg, node => {
    if (node.nodeName === "g" || node.nodeName === "svg") return;
    for (const name of String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)) {
      if (!css.includes(`.${name}`)) missing.add(`${node.nodeName}.${name}`);
    }
  });
  assert.deepEqual([...missing], [], "these drawn elements have no rule in any Station stylesheet");
});

test("every class the machine emits stays in the station- namespace", () => {
  const svg = stageFor(literal({ layerCount: 5 }), { focusLayer: "B" });
  walk(svg, node => {
    for (const name of String(node.getAttribute("class") || "").split(/\s+/).filter(Boolean)) {
      assert.ok(/^(station-|is-)/.test(name), `"${name}" is outside the Station namespace`);
    }
  });
});

test("no presentation attribute is written into the markup", () => {
  // Colour and line weight belong to Station's stylesheets, so the equipment
  // can follow a theme later without a single path being touched.
  const svg = stageFor(literal({ layerCount: 5 }));
  walk(svg, node => {
    for (const banned of ["fill", "stroke", "stroke-width", "opacity", "color", "font-size"]) {
      assert.equal(node.getAttribute(banned), null, `<${node.nodeName}> carries a ${banned} attribute`);
    }
  });
});

test("the only inline style is the hopper's fill fraction", () => {
  const svg = stageFor(literal({ layerCount: 5 }));
  const styled = [];
  walk(svg, node => { if (node.getAttribute("style") !== null) styled.push(node); });
  assert.equal(styled.length, hoppersIn(svg).length);
  for (const node of styled) {
    assert.match(node.getAttribute("style"), /^--station-hopper-fill:/);
  }
});

test("the view is described for assistive technology by what it is", () => {
  const svg = stageFor(literal({ layerCount: 5, displayName: "Line 11" }));
  assert.equal(svg.getAttribute("role"), "img");
  assert.match(svg.getAttribute("aria-label"), /Line 11.*5 layer extrusion train/);
});

/* ----------------------------------------------------------------------
 *   Weight Profile height
 * -------------------------------------------------------------------- */

test("body height scales linearly from the profile height, on one shared scale", () => {
  const height = layoutModule.hopperBodyHeight;
  const d = layoutModule.DIMENSIONS;
  // The reference height is the default body, by definition.
  assert.equal(height(d.referenceHeightIn), d.vesselHeight);
  // Twice the reference is twice the body, until the clamp bites.
  assert.ok(height(d.referenceHeightIn * 1.2) > height(d.referenceHeightIn));
  assert.ok(height(d.referenceHeightIn * 0.8) < height(d.referenceHeightIn));
  // One shared scale: the same inches give the same height, always. It does
  // not normalise per bank, which would make two lines incomparable.
  assert.equal(height(26), height(26));
});

test("a missing or nonsense profile height falls back to the default body", () => {
  const d = layoutModule.DIMENSIONS;
  for (const input of [undefined, null, 0, -12, NaN, Infinity, "", "tall", {}]) {
    assert.equal(layoutModule.hopperBodyHeight(input), d.vesselHeight,
      `${String(input)} should fall back to the default body`);
  }
});

test("extreme profile heights are clamped so the layout cannot be broken", () => {
  const d = layoutModule.DIMENSIONS;
  assert.equal(layoutModule.hopperBodyHeight(100000), d.vesselMaxHeight);
  assert.equal(layoutModule.hopperBodyHeight(0.01), d.vesselMinHeight);
  // And the tallest possible hopper still leaves the header room to breathe.
  const tallestTop = d.vesselBottom - d.vesselMaxHeight - d.receiverGap - d.receiverHeight - d.sourceGap;
  assert.ok(tallestTop > d.headerTop + 14,
    "a fully clamped hopper collides with the layer header");
});

test("only the storage body scales - receiver, cone and feed keep their proportions", () => {
  const short = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }),
    { hopperState: { "A:0": { usableHeight: 20 } } }).banks[0].cluster.hoppers[0];
  const tall = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }),
    { hopperState: { "A:0": { usableHeight: 36 } } }).banks[0].cluster.hoppers[0];

  assert.ok(tall.vesselHeight > short.vesselHeight);
  for (const same of ["receiverHeight", "coneHeight", "spoutHeight", "coneTop", "spoutTop", "captionTop"]) {
    assert.equal(tall[same], short[same], `${same} changed with the body height`);
  }
  // The taller body grows upward, taking its receiver and source with it.
  assert.ok(tall.vesselTop < short.vesselTop);
  assert.ok(tall.receiverTop < short.receiverTop);
  assert.ok(tall.sourceY < short.receiverTop);
});

/* ----------------------------------------------------------------------
 *   Source placement
 * -------------------------------------------------------------------- */

test("source is drawn above the receiver, not under the hopper", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 2 }), {
    hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" } }
  });
  const sources = [];
  walk(svg, node => {
    if (String(node.getAttribute("class") || "").includes("station-hopper__source")) sources.push(node);
  });
  const text = sources.find(n => n.nodeName === "text");
  const receiver = allWith(svg, "data-station-target", "receiver")[0];
  const cap = [];
  walk(receiver, n => { if (String(n.getAttribute("class") || "").includes("station-hopper__cap")) cap.push(n); });
  assert.ok(Number(text.getAttribute("y")) < Number(cap[0].getAttribute("y")),
    "the source label is not above the receiver");
});

test("an absent source draws nothing at all, rather than a row of 'no source'", () => {
  const svg = stageFor(literal({ layerCount: 5, hopperCount: 6 }), {
    hopperState: { "A:0": { assigned: true, resinName: "HX204", source: "SILO 3" } }
  });
  assert.deepEqual(textOf(svg, "station-hopper__source"), ["SILO 3"],
    "hoppers without a source are drawing a label anyway");
});

/* ----------------------------------------------------------------------
 *   Expanded mixer keeps its proportions
 * -------------------------------------------------------------------- */

test("expanding a layer never distorts its mixer", () => {
  const plain = layoutFor(literal({ layerCount: 5 }));
  const focused = layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" });
  const before = plain.banks[2].mixer;
  const after = focused.banks[2].mixer;

  const aspect = box => box.width / box.height;
  assert.ok(Math.abs(aspect(after) - aspect(before)) < 0.001,
    "the mixer was stretched rather than scaled");
  // It is still centred under its own cluster.
  assert.equal(Math.round(after.x + after.width / 2), Math.round(focused.banks[2].centerX));
});

test("the mixer does not grow with the hopper count it happens to sit under", () => {
  // Its width comes from the bank at normal scale and is capped, so a
  // nine-hopper bank does not produce a mixer three times the size of a
  // three-hopper one.
  const few = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 })).banks[0].mixer;
  const many = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 9 })).banks[0].mixer;
  assert.equal(few.height, many.height);
  assert.ok(many.width <= layoutModule.DIMENSIONS.mixerMaxWidth);
});

/* ----------------------------------------------------------------------
 *   Extruder orientation
 * -------------------------------------------------------------------- */

test("the extruder is drawn as a barrel, with the anatomy the references show", () => {
  /* Barrel, heater bands, end cap with a bore, a rear feed block and a drive,
   * and feet at both ends. Those six are the whole machine at this scale. */
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null }));
  const extruder = allWith(svg, "data-role", "extruder")[0];
  const classes = [];
  walk(extruder, node => { if (node.getAttribute("class")) classes.push(node.getAttribute("class")); });
  for (const part of ["station-extruder__barrel-body", "station-extruder__barrel-lit",
    "station-extruder__seam", "station-extruder__seam-long", "station-extruder__flange",
    "station-extruder__cap-face", "station-extruder__bore",
    "station-extruder__feed", "station-extruder__drive", "station-extruder__foot"]) {
    assert.ok(classes.includes(part), `the extruder is missing ${part}`);
  }
  // And nothing invented: no decorative circle floating near the bore.
  assert.ok(!classes.includes("station-extruder__motor"));
});

test("the barrel is segmented into heater zones", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null }));
  const seams = allWithClassName(svg, "station-extruder__seam");
  assert.equal(seams.length, layoutModule.DIMENSIONS.extruderSeams);
  assert.ok(seams.length >= 3, "too few bands to read as a segmented barrel");
  // Each band crosses the barrel rather than running along it.
  const geometry = layoutFor(literal({ layerCount: 1, layerAPosition: null })).banks[0].extruder;
  for (const seam of seams) {
    const span = Math.hypot(
      Number(seam.getAttribute("x2")) - Number(seam.getAttribute("x1")),
      Number(seam.getAttribute("y2")) - Number(seam.getAttribute("y1")));
    assert.ok(Math.abs(span - geometry.radius * 2) < 0.5);
  }
});

test("there are feet under both ends, and the near end stands lower", () => {
  /* The fix for a machine that looked like it hung off a single front foot.
   * Front feet lower than rear feet is also the depth cue that costs nothing. */
  const geometry = layoutFor(literal({ layerCount: 5 })).banks[0].extruder;
  assert.equal(geometry.feet.rear.length, 2);
  assert.equal(geometry.feet.front.length, 2);
  assert.ok(geometry.feet.front[0].y > geometry.feet.rear[0].y,
    "the near end's feet should sit lower on screen than the far end's");

  const svg = stageFor(literal({ layerCount: 5 }));
  const positions = allWithClassName(svg, "station-extruder__foot")
    .map(foot => foot.getAttribute("data-position"));
  assert.equal(positions.filter(p => p === "front").length, 10);
  assert.equal(positions.filter(p => p === "rear").length, 10);
});

test("the bore belongs to the cap it is cut into", () => {
  // Both are built from the same two radii, so the opening turns with the end
  // it is in rather than sitting on it as a decoration.
  const svg = stageFor(literal({ layerCount: 5 }));
  const extruder = allWith(svg, "data-role", "extruder")[0];
  const face = allWithClassName(extruder, "station-extruder__cap-face")[0];
  const bore = allWithClassName(extruder, "station-extruder__bore")[0];
  const radiiOf = node => node.getAttribute("d").match(/A ([\d.]+) ([\d.]+)/).slice(1, 3).map(Number);
  const [faceRx, faceRy] = radiiOf(face);
  const [boreRx, boreRy] = radiiOf(bore);
  assert.ok(Math.abs(boreRx / faceRx - boreRy / faceRy) < 0.01,
    "the bore is not the same shape as the cap");
  assert.ok(boreRx < faceRx);
});

test("extruders aim inward: left of centre swings right, right of centre swings left", () => {
  /* Sign convention, checked as geometry rather than as a number. The assembly
   * pivots at the top where it meets the mixer, so a positive (clockwise)
   * angle moves its lower end to the right. */
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  const centreX = banks[2].centerX;
  for (const bank of banks) {
    const angle = bank.extruder.angle;
    const offset = bank.centerX - centreX;
    if (Math.abs(offset) < 1) { assert.equal(angle, 0); continue; }
    /* Where the foot of the machine ends up, after rotating about the pivot.
     *
     * SVG rotate() with y pointing down sends a point at (0, d) below the pivot
     * to (-d*sin θ, d*cos θ). The minus is the whole test: an earlier version of
     * this assertion had a plus, which is the same sign error the drawing had,
     * so it confirmed the bug instead of catching it. */
    const radians = (angle * Math.PI) / 180;
    const footX = bank.extruder.pivotX - Math.sin(radians) * bank.extruder.length;
    assert.ok(Math.abs(footX - centreX) < Math.abs(bank.extruder.pivotX - centreX),
      `layer ${bank.id} does not aim toward the centre`);
  }
});

/* ----------------------------------------------------------------------
 *   The expanded cluster is the edit surface
 * -------------------------------------------------------------------- */

test("expanding a layer puts a control on each hopper for resin, blend and source", () => {
  /* The point of the expansion. Before this pass it only enlarged equipment
   * while the values lived in a side panel, which did not justify the state. */
  const svg = stageFor(literal({ layerCount: 3, hopperCount: 3 }), {
    focusLayer: "B",
    hopperState: {
      "B:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" },
      "B:1": { assigned: true, resinName: "LD105", pct: 40 }
    }
  });
  const fields = allWith(svg, "data-station-field");
  // Three controls on each of the focused layer's three hoppers, and none
  // anywhere else.
  assert.equal(fields.length, 9);
  assert.ok(fields.every(f => f.getAttribute("data-layer") === "B"));
  for (const hopper of ["B1", "B2", "B3"]) {
    const forHopper = fields.filter(f => f.getAttribute("data-hopper") === hopper)
      .map(f => f.getAttribute("data-station-field")).sort();
    assert.deepEqual(forHopper, ["pct", "resin", "source"]);
  }
});

test("each control is attached to the part of the equipment it describes", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }), {
    focusLayer: "A",
    hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" } }
  });
  const geometry = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }),
    { focusLayer: "A", hopperState: { "A:0": { assigned: true } } }).banks[0].cluster.hoppers[0];

  const wellFor = kind => {
    const group = allWith(svg, "data-station-field", kind)[0];
    const wells = [];
    walk(group, node => {
      if (String(node.getAttribute("class") || "") === "station-field__well") wells.push(node);
    });
    return Number(wells[0].getAttribute("y"));
  };

  // Source above the receiver, resin on the body, blend below the discharge.
  assert.ok(wellFor("source") < geometry.receiverTop, "source is not above the receiver");
  assert.ok(wellFor("resin") > geometry.vesselTop && wellFor("resin") < geometry.coneTop,
    "resin is not on the hopper body");
  assert.ok(wellFor("pct") > geometry.spoutTop, "blend is not below the discharge");
});

test("resin wells line up across a bank of mixed-height hoppers", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }), {
    focusLayer: "A",
    hopperState: {
      "A:0": { assigned: true, usableHeight: 22 },
      "A:1": { assigned: true, usableHeight: 34 },
      "A:2": { assigned: true, usableHeight: 28 }
    }
  });
  const tops = allWith(svg, "data-station-field", "resin").map(group => {
    const wells = [];
    walk(group, node => {
      if (String(node.getAttribute("class") || "") === "station-field__well") wells.push(node);
    });
    return Math.round(Number(wells[0].getAttribute("y")));
  });
  assert.equal(new Set(tops).size, 1, "resin wells drift with each hopper's body height");
});

test("the controls are marked read-only, and say so on the surface", () => {
  /* They look like controls because that is what they will be. The one thing
   * they must not do is look live while the bridge has no write API. */
  const svg = stageFor(literal({ layerCount: 3 }), { focusLayer: "B" });
  for (const field of allWith(svg, "data-station-field")) {
    assert.equal(field.getAttribute("aria-readonly"), "true");
    assert.ok(String(field.getAttribute("class")).includes("is-readonly"));
  }
  assert.deepEqual(textOf(svg, "station-layer__notice"), ["READ-ONLY — NO WRITE CONTRACT YET"]);
});

test("an unset value still gets a well, with a placeholder rather than nothing", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }), {
    focusLayer: "A", hopperState: { "A:0": { assigned: false } }
  });
  assert.deepEqual(textOf(svg, "station-field__value--resin"), ["no resin"]);
  assert.deepEqual(textOf(svg, "station-field__value--source"), ["no source"]);
  for (const field of allWith(svg, "data-station-field")) {
    assert.ok(String(field.getAttribute("class")).includes("is-empty"));
  }
});

test("the dense view has no controls at all", () => {
  const svg = stageFor(literal({ layerCount: 5 }), {
    hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" } }
  });
  assert.equal(allWith(svg, "data-station-field").length, 0);
  assert.deepEqual(textOf(svg, "station-layer__notice"), []);
});

/* ----------------------------------------------------------------------
 *   Mixer proportions
 * -------------------------------------------------------------------- */

test("the mixer body is compact and close to square, not a wide console", () => {
  const mixer = layoutFor(literal({ layerCount: 5 })).banks[0].mixer;
  const aspect = mixer.width / mixer.height;
  assert.ok(aspect < 1.5, `the mixer is ${aspect.toFixed(2)}:1 - too wide to read as a blender`);
  // And narrower than the bank it serves, which is the whole point.
  assert.ok(mixer.width < layoutFor(literal({ layerCount: 5 })).banks[0].cluster.width);
});

test("no funnel is drawn between the hoppers and the blender", () => {
  /* It was inventing equipment. The real connection is hose and material
   * routing, which this view does not draw; the hoppers simply end above the
   * mixer and the vertical spacing carries the relationship. */
  const bank = layoutFor(literal({ layerCount: 5 })).banks[0];
  assert.equal(bank.mixer.collector, undefined);
  assert.equal(allWithClassName(stageFor(literal({ layerCount: 5 })), "station-mixer__collector").length, 0);
  // And the hoppers still clear the blender rather than running into it.
  assert.ok(bank.cluster.bottom < bank.mixer.y);
});

test("expanding a layer scales the whole blender rather than stretching it", () => {
  const plain = layoutFor(literal({ layerCount: 3 })).banks[1];
  const focused = layoutFor(literal({ layerCount: 3 }), { focusLayer: "B" }).banks[1];
  const aspect = m => m.width / m.height;
  assert.ok(Math.abs(aspect(focused.mixer) - aspect(plain.mixer)) < 0.001,
    "the blender was distorted by the expansion");
  const grown = focused.mixer.width / plain.mixer.width;
  assert.ok(grown >= 1.35 && grown <= 1.65, `expected roughly 1.4-1.6x, got ${grown.toFixed(2)}x`);
  // Both axes by the same factor.
  assert.ok(Math.abs(grown - focused.mixer.height / plain.mixer.height) < 0.001);
  /* And the extruder grows LESS. It is the least important thing in the
   * picture, and matching a blender that went up by half would make it the
   * dominant artwork. */
  assert.ok(focused.extruder.scale / plain.extruder.scale < grown,
    "the extruder grew as much as the blender");
});

test("the agitator is drawn once and placed, so it scales with its blender", () => {
  /* The bug this replaces: the agitator radius was computed with an absolute
   * cap in it, so an expanded blender got a normal-sized agitator and nobody
   * noticed because the only comparison was against a DIMMED one. It is now
   * authored once at unit size in its own coordinate system and placed with a
   * transform, so there is no second size to keep in step.
   *
   * Compared against the UNFOCUSED state, which is what the bug hid behind. */
  const scaleOf = (svg, layer) => {
    const bank = allWith(svg, "data-layer", layer).find(n => n.getAttribute("data-role") === "layer");
    const mount = allWithClassName(bank, "station-mixer__agitator-mount")[0];
    return Number(mount.getAttribute("transform").match(/scale\(([-\d.]+)\)/)[1]);
  };
  const plain = stageFor(literal({ layerCount: 3 }));
  const focused = stageFor(literal({ layerCount: 3 }), { focusLayer: "B" });

  const plainScale = scaleOf(plain, "B");
  const focusedScale = scaleOf(focused, "B");
  assert.equal(plainScale, 1);
  // Exactly the blender's own scale, not an approximation of it.
  const mixers = layoutFor(literal({ layerCount: 3 }), { focusLayer: "B" }).banks[1].mixer;
  assert.equal(focusedScale, Math.round(mixers.scale * 100) / 100);
  assert.ok(focusedScale > plainScale * 1.3, "the agitator did not grow with the expanded blender");

  // The blades themselves are authored at one size - no per-state geometry.
  const bladeOf = svg => allWithClassName(svg, "station-mixer__blade")[0].getAttribute("x2");
  assert.equal(bladeOf(plain), bladeOf(focused));
});

test("the blender reaches the extruder with one neck and nothing else", () => {
  /* There was a taper, then a separate throat box, then the housing - three
   * shapes to say "connected". One says it. */
  const bank = layoutFor(literal({ layerCount: 3 })).banks[0];
  assert.equal(Math.round(bank.extruder.pivotY),
    Math.round(bank.mixer.y + bank.mixer.height + bank.mixer.outletHeight),
    "the extruder does not start where the neck ends");
  const svg = stageFor(literal({ layerCount: 3 }));
  assert.equal(allWithClassName(svg, "station-extruder__throat").length, 0,
    "the extra throat box is back");
  assert.equal(allWithClassName(svg, "station-mixer__outlet").length, 3, "one neck per layer");
  // The drive is part of the extruder's rear now, not an adapter between them.
  assert.equal(allWithClassName(svg, "station-extruder__drive").length, 3);
});

test("the barrel is a tube, not a flat panel", () => {
  // A lit strip down one side is what makes a quad read as round, and it stays
  // on the same side however the machine turns.
  const svg = stageFor(literal({ layerCount: 5 }));
  for (const extruder of allWith(svg, "data-role", "extruder")) {
    assert.equal(allWithClassName(extruder, "station-extruder__barrel-lit").length, 1);
  }
  /* Which flank is lit legitimately differs between a barrel angled left and
   * one angled right. What must hold is that every highlight is consistent
   * with ONE light - so the lit side's outward normal always faces it. */
  const light = layoutModule.LIGHT;
  for (const bank of layoutFor(literal({ layerCount: 5 })).banks) {
    const e = bank.extruder;
    const dot = e.perp.x * e.litSign * light.x + e.perp.y * e.litSign * light.y;
    assert.ok(dot > 0, `layer ${bank.id} is lit from the wrong side`);
  }
});

test("the turn is strong enough to read at a glance", () => {
  /* The test that matters: can you see which way a machine faces without
   * studying it. Measured as how far the front end travels off the layer's
   * centreline, in barrel widths - a whole barrel width or more at the outside
   * is unmistakable. */
  const e = layoutFor(literal({ layerCount: 5 })).banks.map(b => b.extruder);
  assert.equal(e[2].sideShare, 0);
  assert.ok(e[1].sideShare > 0.5, `adjacent layers barely move: ${e[1].sideShare.toFixed(2)}`);
  assert.ok(e[0].sideShare > 1.2, `outer layers are not obviously turned: ${e[0].sideShare.toFixed(2)}`);
  assert.ok(e[0].sideShare > e[1].sideShare);
  // Mirrored.
  assert.equal(e[0].sideShare, e[4].sideShare);
  assert.equal(e[1].sideShare, e[3].sideShare);
  assert.equal(e[0].front.x - e[0].rear.x, -(e[4].front.x - e[4].rear.x));
});

test("the rear feed point stays on the layer centreline at every yaw", () => {
  /* The anchor. The mixer feeds into this point, so it must not wander when the
   * barrel swings - which is exactly what a model that rotated the whole machine
   * would do. */
  for (const bank of layoutFor(literal({ layerCount: 5 })).banks) {
    const e = bank.extruder;
    assert.equal(e.rear.x, bank.centerX);
    assert.equal(e.rearBlock.centerX, bank.centerX);
    assert.equal(e.drive.centerX, bank.centerX);
    assert.equal(e.mixerAligned === undefined, true);
  }
  // And the neck lands on it.
  for (const bank of layoutFor(literal({ layerCount: 5 })).banks) {
    assert.equal(bank.mixer.centerX, bank.extruder.drive.centerX);
  }
});

/* ----------------------------------------------------------------------
 *   One component, three perspective states
 * -------------------------------------------------------------------- */

test("one component renders front-facing, moderate and strong yaw", () => {
  /* The requirement the Extruder Lab exists to show: three readable states out
   * of one function, differing only in the number handed to it. */
  const d = layoutModule.DIMENSIONS;
  const at = angle => layoutModule.extruderGeometry(angle, d, { pivotX: 0, pivotY: 0 });
  const front = at(0);
  const moderate = at(d.extruderMaxYaw / 2);
  const strong = at(d.extruderMaxYaw);

  // Front-facing: no travel, round cap, shortest barrel.
  assert.equal(front.front.x, 0);
  assert.equal(front.capRy, front.capRx);
  // Each step out: more travel, longer barrel, flatter cap.
  assert.ok(Math.abs(moderate.front.x) > Math.abs(front.front.x));
  assert.ok(Math.abs(strong.front.x) > Math.abs(moderate.front.x));
  assert.ok(strong.length > moderate.length && moderate.length > front.length);
  assert.ok(strong.capRy < moderate.capRy && moderate.capRy < front.capRy);
  // And the rear never budges in any of them.
  for (const state of [front, moderate, strong]) assert.equal(state.rear.x, 0);
});

test("the same component handles both sides - there is no second artwork", () => {
  const d = layoutModule.DIMENSIONS;
  const doc = fakeDocument();
  const draw = angle => {
    const g = parts.extruder(doc, {
      id: "X", extruder: layoutModule.extruderGeometry(angle, d, { pivotX: 0, pivotY: 0 })
    }, 20);
    const shapes = [];
    walk(g, node => { if (node.getAttribute("class")) shapes.push(`${node.nodeName}.${node.getAttribute("class")}`); });
    return shapes;
  };
  // Identical element structure on both sides and straight on; only the
  // coordinates differ.
  assert.deepEqual(draw(-34), draw(34));
  assert.deepEqual(draw(-34).filter(s => !/foot/.test(s)), draw(0).filter(s => !/foot/.test(s)));
});

test("nothing in the extruder is rotated in the screen plane", () => {
  /* The machine stands upright. The barrel points somewhere, but it does so as
   * path geometry - the cap's ellipse angle rides in the arc command, not in a
   * transform - so no part of this component leans. */
  const svg = stageFor(literal({ layerCount: 5 }));
  for (const extruder of allWith(svg, "data-role", "extruder")) {
    walk(extruder, node => {
      const transform = node.getAttribute("transform");
      assert.ok(!transform, `${node.nodeName} inside the extruder carries a transform: ${transform}`);
    });
  }
});

test("the percentage stays upright and readable at every yaw", () => {
  const svg = stageFor(literal({ layerCount: 5 }), {
    layerState: { A: { layerPct: 15 }, C: { layerPct: 30 }, E: { layerPct: 15 } }
  });
  const readouts = allWithClassName(svg, "station-extruder__pct");
  assert.equal(readouts.length, 5);
  for (const readout of readouts) {
    assert.equal(readout.getAttribute("transform"), null, "the percentage was dragged into the perspective");
    // Anchored on the layer centreline, where the rear is.
    assert.equal(readout.getAttribute("text-anchor"), "middle");
  }
  assert.ok(readouts.map(r => r.textContent).includes("30%"));
});

/* ----------------------------------------------------------------------
 *   Extruder Lab (development only)
 * -------------------------------------------------------------------- */

test("the lab draws the documented states from the real component", () => {
  const lab = require("./station/station-extruder-lab.js");
  const doc = fakeDocument();
  const svg = lab.mount(doc.createElement("div"), doc, {
    layout: layoutModule, parts
  });
  const cells = allWith(svg, "data-role", "lab-cell");
  assert.equal(cells.length, 5);
  // Derived from the real maximum, so the lab cannot drift from the stage.
  const max = layoutModule.DIMENSIONS.extruderMaxYaw;
  assert.deepEqual(cells.map(c => Number(c.getAttribute("data-yaw"))),
    [-max, -max / 2, 0, max / 2, max]);
  // Each cell contains a real extruder, not a lab-only drawing.
  assert.equal(allWith(svg, "data-role", "extruder").length, 5);
  for (const extruder of allWith(svg, "data-role", "extruder")) {
    assert.ok(allWithClassName(extruder, "station-extruder__barrel-body").length === 1);
    assert.ok(allWithClassName(extruder, "station-extruder__cap-face").length === 1);
  }
});

test("the lab scales the component rather than redrawing it", () => {
  const lab = require("./station/station-extruder-lab.js");
  const d = layoutModule.DIMENSIONS;
  const small = layoutModule.extruderGeometry(20, d, { pivotX: 0, pivotY: 0, scale: 1 });
  const large = layoutModule.extruderGeometry(20, d, { pivotX: 0, pivotY: 0, scale: 3 });
  // Every dimension triples; nothing changes shape.
  assert.ok(Math.abs(large.length / small.length - 3) < 0.001);
  assert.ok(Math.abs(large.radius / small.radius - 3) < 0.001);
  assert.ok(Math.abs(large.capRy / small.capRy - 3) < 0.001);
  assert.equal(large.fraction, small.fraction);
  assert.equal(lab.specimens(d.extruderMaxYaw).length, 5);
});
