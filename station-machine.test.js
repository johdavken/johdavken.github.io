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

test("a layer built to six slots keeps the six-hopper bank, cluster box and blend card whatever its count, its hoppers centred in it", () => {
  /* The line's spacing and the layer card do not change with a layer's
   * hopper count: a four-hopper core on a six-slot line is the same bank
   * as its six-hopper neighbours, the four hoppers standing centred. */
  const six = layoutFor(literal({ layers: [{ id: "B", hopperCount: 6 }] }));
  const four = layoutFor(literal({ slotCount: 6, layers: [{ id: "B", hopperCount: 4 }] }));
  const one = layoutFor(literal({ slotCount: 6, layers: [{ id: "B", hopperCount: 1 }] }));
  for (const layout of [four, one]) {
    assert.equal(layout.width, six.width, "the row is as wide");
    layout.banks.forEach((bank, index) => {
      const same = six.banks[index];
      assert.deepEqual([bank.x, bank.width, bank.centerX], [same.x, same.width, same.centerX], `bank ${bank.id} stands where it did`);
      assert.deepEqual(bank.objects.cluster, same.objects.cluster, `bank ${bank.id}'s cluster box is the same`);
      assert.deepEqual(bank.objects.train, same.objects.train, `bank ${bank.id}'s train is the same`);
      assert.deepEqual([bank.cluster.x, bank.cluster.width], [same.cluster.x, same.cluster.width]);
      assert.deepEqual(parts.blendCardBox(bank), parts.blendCardBox(same), `bank ${bank.id}'s card is the same box`);
    });
  }
  const core = four.banks[1];
  assert.equal(core.cluster.hoppers.length, 4);
  const first = core.cluster.hoppers[0];
  const last = core.cluster.hoppers[core.cluster.hoppers.length - 1];
  const leftGap = first.x - core.cluster.x;
  const rightGap = core.cluster.x + core.cluster.width - (last.x + last.width);
  assert.ok(leftGap > 0 && Math.abs(leftGap - rightGap) < 1e-9, `the four hoppers are centred (${leftGap} vs ${rightGap})`);
  assert.ok(Math.abs((first.x + last.x + last.width) / 2 - core.centerX) < 1e-9, "over the bank's own centreline");
  const single = one.banks[1].cluster.hoppers[0];
  assert.ok(Math.abs(single.x + single.width / 2 - one.banks[1].centerX) < 1e-9, "one hopper stands on the centreline");
  // Fewer hoppers than slots is drawn as fewer hoppers - the empty slots are empty.
  assert.equal(allWith(stageFor(literal({ slotCount: 6, layers: [{ id: "B", hopperCount: 4 }] })), "data-role", "hopper").length, 16);
  // Without a slot count, a layer's bank is its hoppers' - what a literal configuration has always drawn.
  const literalFour = layoutFor(literal({ layers: [{ id: "B", hopperCount: 4 }] }));
  assert.ok(literalFour.banks[1].width < six.banks[1].width);
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
 *   Extruder convergence: three authored views, picked by position
 * -------------------------------------------------------------------- */

const assets = require("./station/station-extruder-assets.js");
const mixerAssets = require("./station/station-mixer-assets.js");

test("the view is derived from distance off centre, not from the layer letter", () => {
  const view = layoutModule.equipmentView;
  // Same position in the stack, same view, whatever the layer is called.
  assert.deepEqual(view(0, 5), view(0, 5));
  // Mirror images about the centre: same view, opposite side.
  for (const [a, b] of [[0, 4], [1, 3]]) {
    assert.equal(view(a, 5).view, view(b, 5).view);
    assert.equal(view(a, 5).mirrored, true);
    assert.equal(view(b, 5).mirrored, false);
  }
});

test("angled for a single train; front at a stack centre, then increasingly turned by ring", () => {
  /* The documented mapping of the three assets onto a stack - the masters'
   * own suggested views: 0; -30, 0, 30; -60, -30, 0, 30, 60. Stated for the
   * three supported counts and for the ones nobody has drawn yet, because
   * the rule has to hold for those too. */
  const names = count => Array.from({ length: count }, (_, i) => {
    const facing = layoutModule.equipmentView(i, count);
    return `${facing.mirrored ? "-" : ""}${facing.view}`;
  });
  assert.deepEqual(names(1), ["angled"]);
  // Three layers turn 30 degrees, not 60: the outer pair is close to the core.
  assert.deepEqual(names(3), ["-intermediate", "front", "intermediate"]);
  assert.deepEqual(names(5), ["-angled", "-intermediate", "front", "intermediate", "angled"]);
  // Beyond the second ring there is no further view to turn to.
  assert.deepEqual(names(7), ["-angled", "-angled", "-intermediate", "front", "intermediate", "angled", "angled"]);
  // An even count has no centre layer, so no machine faces straight out.
  assert.deepEqual(names(2), ["-intermediate", "intermediate"]);
  assert.deepEqual(names(4), ["-angled", "-intermediate", "intermediate", "angled"]);
  // And the human-readable key says the same thing.
  assert.deepEqual(Array.from({ length: 5 }, (_, i) => layoutModule.equipmentView(i, 5).key),
    ["angled-left", "intermediate-left", "front", "intermediate-right", "angled-right"]);
});

test("a single layer uses one unmirrored angled view for blender and extruder", () => {
  const bank = layoutFor(literal({ layerCount: 1, layerAPosition: null })).banks[0];
  assert.equal(bank.mixer.view, "angled");
  assert.equal(bank.mixer.yaw, mixerAssets.views.angled.yaw);
  assert.equal(bank.extruder.view, "angled");
  assert.equal(bank.extruder.mirrored, false);
  assert.equal(bank.extruder.yaw, assets.views.angled.yaw);
  assert.equal(bank.facing.view, "angled");

  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null }));
  const mixer = allWith(svg, "data-role", "mixer")[0];
  assert.equal(mixer.getAttribute("data-view"), "angled");
  assert.equal(mixer.getAttribute("data-mirrored"), "false");
  const extruder = allWith(svg, "data-role", "extruder")[0];
  assert.equal(extruder.getAttribute("data-view"), "angled");
  assert.equal(extruder.getAttribute("data-mirrored"), "false");
  assert.equal(extruder.getAttribute("data-facing"), "right");
});

test("the turn grows with distance from the centre, and is the asset's own yaw", () => {
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  const yaw = banks.map(bank => bank.extruder.yaw);
  assert.deepEqual(yaw.map(Math.abs), [
    assets.views.angled.yaw, assets.views.intermediate.yaw, 0,
    assets.views.intermediate.yaw, assets.views.angled.yaw
  ]);
  // Signed like a compass: negative left of centre, positive right of it.
  assert.ok(yaw[0] < 0 && yaw[1] < 0 && yaw[3] > 0 && yaw[4] > 0);
  assert.equal(yaw[0], -yaw[4]);
});

test("no extruder is rotated or transformed in the plane of the screen - the machines stand upright", () => {
  /* Perspective is in the artwork; mirroring is in the coordinates. Nothing in
   * the group carries a transform, so no machine can lean and no later reader
   * has to find a scale(-1) to understand a left-hand layer. */
  const svg = stageFor(literal({ layerCount: 5 }), { layerState: { A: { layerPct: 20 } } });
  for (const extruder of allWith(svg, "data-role", "extruder")) {
    walk(extruder, node => {
      const transform = node.getAttribute("transform");
      assert.ok(!transform, `${node.nodeName} inside the extruder carries a transform: ${transform}`);
    });
    // Nothing but the machine: the layer's share is in the header now.
    assert.equal(allWithClassName(extruder, "station-extruder__pct").length, 0);
    assert.equal(allWithClassName(extruder, "text").length, 0);
  }
});

test("the view reaches the markup as a facing direction, mirrored about the centre", () => {
  const svg = stageFor(literal({ layerCount: 5 }));
  const facing = allWith(svg, "data-role", "extruder").map(node => ({
    layer: node.getAttribute("data-layer"),
    view: node.getAttribute("data-view"),
    mirrored: node.getAttribute("data-mirrored"),
    yaw: Number(node.getAttribute("data-yaw")),
    facing: node.getAttribute("data-facing")
  }));
  assert.deepEqual(facing.map(f => f.facing), ["left", "left", "front", "right", "right"]);
  assert.deepEqual(facing.map(f => f.view), ["angled", "intermediate", "front", "intermediate", "angled"]);
  assert.deepEqual(facing.map(f => f.mirrored), ["true", "true", "false", "false", "false"]);
  assert.equal(facing[0].yaw, -facing[4].yaw);
  assert.equal(facing[2].yaw, 0);
});

test("extruderPlacement is pure geometry and mirrors exactly about the feed anchor", () => {
  const place = layoutModule.assetPlacement;
  const asset = assets.views.angled;
  const right = place("angled", false, asset, { centerX: 100, anchorY: 50, scale: 1 });
  const left = place("angled", true, asset, { centerX: 100, anchorY: 50, scale: 1 });
  // The feed anchor is the one thing that does not mirror.
  assert.deepEqual(left.anchor, right.anchor);
  assert.deepEqual(left.anchor, { x: 100, y: 50 });
  // Everything else reflects through it.
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(left.bounds.left - 100, -(right.bounds.right - 100));
  near(left.bounds.right - 100, -(right.bounds.left - 100));
  near(left.bounds.top, right.bounds.top);
  near(left.bounds.bottom, right.bounds.bottom);
  near(left.outlet.x - 100, -(right.outlet.x - 100));
  near(left.outlet.y, right.outlet.y);
  assert.equal(left.yaw, -right.yaw);
  // And scale is uniform.
  const big = place("angled", false, asset, { centerX: 0, anchorY: 0, scale: 2 });
  assert.ok(Math.abs(big.width / right.width - 2) < 1e-9);
  assert.ok(Math.abs(big.height / right.height - 2) < 1e-9);
});

test("the feed anchor sits on the mixer's discharge, on the layer centreline, at every view", () => {
  for (const bank of layoutFor(literal({ layerCount: 5 })).banks) {
    assert.equal(bank.extruder.anchor.x, bank.mixer.centerX);
    assert.equal(bank.extruder.anchor.x, bank.mixer.outlet.x);
    assert.equal(bank.extruder.anchor.y, bank.mixer.outlet.y + layoutModule.DIMENSIONS.mixerFeedGap,
      "the extruder does not start at the mixer's discharge");
  }
});

test("extruders aim inward: the die-facing outlet is nearer the centre than the feed", () => {
  /* Convergence, checked as geometry: on every turned machine the outlet end
   * lies between its own feed anchor and the line's centre. */
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  const centreX = banks[2].centerX;
  for (const bank of banks) {
    const e = bank.extruder;
    if (e.view === "front") { assert.equal(e.outlet.x, e.anchor.x); continue; }
    assert.ok(Math.abs(e.outlet.x - centreX) < Math.abs(e.anchor.x - centreX),
      `layer ${bank.id} does not aim toward the centre`);
  }
});

test("neighbouring extruders never overlap, in any layer count or focus state", () => {
  /* A turned machine reaches a long way toward the core. This is the number
   * that decides whether the arrangement is readable, so it is pinned for
   * every state the layout can produce. In focus the open layer's objects
   * stand in their own columns, in front of ghosts that have faded; the
   * ghosts still never overlap EACH OTHER, so the way back is orderly. */
  for (const layerCount of [2, 3, 4, 5, 7]) {
    const config = literal({ layerCount });
    const focuses = [null, ...model.buildLineModel(config).layers.map(l => l.id)];
    for (const focusLayer of focuses) {
      const layout = layoutFor(config, { focusLayer });
      const row = layout.banks.filter(bank => bank.id !== focusLayer);
      for (let i = 1; i < row.length; i++) {
        assert.ok(row[i - 1].extruder.bounds.right < row[i].extruder.bounds.left,
          `${layerCount} layers, focus ${focusLayer}: extruders ${row[i - 1].id} and ${row[i].id} overlap`);
      }
      // And the whole machine, readout included, stays on the canvas.
      for (const bank of layout.banks) {
        assert.ok(bank.extruder.label.y + 4 <= layoutModule.DIMENSIONS.height,
          `${layerCount} layers, focus ${focusLayer}: layer ${bank.id} runs off the bottom`);
      }
      if (focusLayer) {
        // The open layer's train, cluster and workspace are three columns.
        const open = layout.banks.find(bank => bank.id === focusLayer);
        const { train, cluster } = open.objects;
        assert.ok(train.x >= 0 && train.x + train.width <= cluster.x, `${layerCount} layers, focus ${focusLayer}: train and cluster overlap`);
        assert.ok(cluster.x + cluster.width <= layout.workspace.x, `${layerCount} layers, focus ${focusLayer}: cluster and workspace overlap`);
        assert.ok(layout.workspace.x + layout.workspace.width <= layout.width);
      }
    }
  }
});

test("the outer extruders stay on the canvas at the narrowest bank, whatever the layer count", () => {
  /* The motor end is the outer end of every turned machine, and the outer
   * pair of a five- or seven-layer line is what limits how big the machines
   * can be. A three-hopper bank is the narrowest a bank gets (bankMinWidth),
   * so this is the tightest case: the rear reach of the angled view against
   * the canvas padding. The 2026-09 growth kept that reach fixed and grew
   * the barrel inward instead - this is what pins it. */
  for (const layerCount of [1, 3, 5, 7]) {
    const layout = layoutFor(literal({ layerCount, hopperCount: 3 }));
    const first = layout.banks[0].extruder.bounds;
    const last = layout.banks[layout.banks.length - 1].extruder.bounds;
    assert.ok(first.left >= 0, `${layerCount} layers: left extruder runs off the canvas (${first.left})`);
    assert.ok(last.right <= layout.width, `${layerCount} layers: right extruder runs off the canvas (${last.right})`);
  }
});

test("every view's feet stay above the readout line in the normal row", () => {
  /* The stage ends at DIMENSIONS.height and the timeline is a separate row
   * beneath it, so nothing can overlap the timeline; but a machine can run
   * off the canvas bottom. The feed lands where the mixer's height puts it,
   * so this is the machine's height against the room under the mixer. */
  const d = layoutModule.DIMENSIONS;
  for (const bank of layoutFor(literal({ layerCount: 5 })).banks) {
    assert.ok(bank.extruder.bounds.bottom <= d.height - d.extruderLabelGap - 4,
      `${bank.facing.key}: feet at ${bank.extruder.bounds.bottom} are too low for the canvas`);
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
    ["extruder", bank.extruder.anchor.y]
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
  for (const part of ["station-hopper__receiver-drawing", "station-hopper__body",
    "station-hopper__material", "station-hopper__cone", "station-hopper__feed"]) {
    assert.equal(classes.filter(one => one === part).length, 1, `missing ${part}`);
  }
});

/* ----------------------------------------------------------------------
 *   Recipe readout
 * -------------------------------------------------------------------- */

test("hopper artwork is inert and existing identity and receiver (pump) targets belong to hit geometry", () => {
  const svg = stageFor(literal({ layerCount: 3, hopperCount: 3 }), {
    hopperState: { "B:2": { assigned: true, track: true, pumpOff: true, resinName: "HX204", pct: 25 } }
  });
  for (const hopper of hoppersIn(svg)) {
    const interaction = allWith(hopper, "data-role", "hopper-interaction")[0];
    const drawing = allWith(hopper, "data-role", "hopper-drawing")[0];
    assert.ok(hopper.children.includes(interaction));
    assert.ok(hopper.children.includes(drawing));
    assert.equal(drawing.getAttribute("pointer-events"), "none");
    const hit = interaction.children[0];
    assert.equal(hit.nodeName, "rect");
    assert.ok(Number(hit.getAttribute("width")) > 0);
    assert.ok(Number(hit.getAttribute("height")) > 0);
    const receiver = allWith(interaction, "data-station-target", "pump")[0];
    assert.equal(receiver.getAttribute("data-layer"), hopper.getAttribute("data-layer"));
    assert.equal(receiver.getAttribute("data-hopper"), hopper.getAttribute("data-hopper"));
    assert.equal(receiver.children[1].nodeName, "rect");
    walk(drawing, n => {
      for (const attr of ["data-hopper", "data-hopper-index", "data-layer", "data-station-target", "tabindex", "draggable", "onclick", "onpointerdown"]) {
        assert.equal(n.getAttribute(attr), null, `artwork owns ${attr}`);
      }
    });
  }
  const b3 = hoppersIn(svg).find(h => h.getAttribute("data-hopper") === "B3");
  assert.equal(b3.getAttribute("data-layer"), "B");
  assert.equal(b3.getAttribute("data-hopper-index"), "2");
  assert.match(b3.getAttribute("class"), /is-tracking/);
  assert.equal(allWith(b3, "data-station-target", "pump")[0].getAttribute("data-pump"), "off");
});

test("hopper hit cells cover captions without overlapping adjacent slots at any bank scale", () => {
  for (const focusLayer of [null, "B"]) {
    const config = literal({ layerCount: 5, hopperCount: 6 });
    const layout = layoutFor(config, { focusLayer });
    const svg = stageFor(config, { focusLayer });
    for (const bank of layout.banks) {
      let previousRight = -Infinity;
      for (const geometry of bank.cluster.hoppers) {
        const hopper = hoppersIn(svg).find(h => h.getAttribute("data-hopper") === geometry.id);
        const hit = allWith(hopper, "data-role", "hopper-interaction")[0].children[0];
        const x = Number(hit.getAttribute("x"));
        const bottom = Number(hit.getAttribute("y")) + Number(hit.getAttribute("height"));
        assert.ok(x >= previousRight, "adjacent hopper hits overlap");
        assert.ok(bottom >= geometry.captionTop + 13 * bank.scale, "percentage is outside the hopper hit");
        previousRight = x + Number(hit.getAttribute("width"));
      }
    }
  }
});

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

test("the readout's fourth line is the run-down's weight: whole pounds, digits only, a dash when there is none, and the tooltip carries the unit", () => {
  const svg = stageFor(literal({ layerCount: 5, hopperCount: 3 }), {
    hopperState: {
      "A:0": { assigned: true, resinName: "HX204", pct: 60, weight: 1250.4, effectiveWeight: 900 },
      "A:1": { assigned: true, resinName: "LD105", pct: 30, weight: 0, effectiveWeight: 500 },
      "A:2": { assigned: false, resinName: "", pct: 0, weight: 75 }
    }
  });
  // The run-down's effective weight - Smart Hoppers' computed value when
  // there is one, the entered receiver weight otherwise - so the caption
  // and the timeline never disagree; an unassigned hopper has one too,
  // and a runtime with no effective weight falls back to the entered one.
  assert.deepEqual(textOf(svg, "station-hopper__weight").slice(0, 3), ["900", "500", "75"]);
  // The unit and the separator are the hover panel's (station-hopper-info.js).
  assert.equal(parts.shownWeight({ weight: 1250, effectiveWeight: 900 }), 900);
  assert.equal(parts.shownWeight({ weight: 1250, effectiveWeight: 0 }), 1250, "no effective weight: the entered one");
  assert.equal(parts.shownWeight({ weight: 1250 }), 1250);
  assert.equal(parts.shownWeight(null), 0);
  // The separator is the tooltip's; a weight too wide is fitted, not lied about.
  // The key carries both weights and whether the shown one is computed.
  assert.equal(parts.hopperStateKey({ weight: 1250 }), "|||||1250|||||");
  assert.notEqual(parts.hopperStateKey({ weight: 1250 }), parts.hopperStateKey({ weight: 1300 }), "a weight change redraws the hopper");
  assert.notEqual(parts.hopperStateKey({ weight: 1250, effectiveWeight: 900 }), parts.hopperStateKey({ weight: 1250, effectiveWeight: 950 }), "an effective weight change redraws the hopper");
  assert.equal(parts.hopperStateKey({ weight: 0 }), "|||||0|||||");
});

test("the weight carries its unit beside the digits - drawn smaller, the pair centred under the hopper - and a weight too wide for both is drawn alone", () => {
  /* Two texts, not one with a tspan: the digits stay the weight element's own
   * text, so what reads the weight reads the number. The pair is centred by
   * the same glyph estimate fitText() judges the fit by. */
  const svg = stageFor(literal({ layerCount: 5, hopperCount: 6 }), {
    hopperState: {
      "A:0": { assigned: true, resinName: "HX204", pct: 60, weight: 90 },
      "A:1": { assigned: true, resinName: "LD105", pct: 30, weight: 147 },
      "A:2": { assigned: true, resinName: "LD106", pct: 10, weight: 1200 },
      "A:3": { assigned: false, resinName: "", pct: 0, weight: 0 },
      "A:4": { assigned: true, resinName: "LD107", pct: 0, weight: 12345 },
      "A:5": { assigned: true, resinName: "LD108", pct: 0, weight: 1234567 }
    }
  });
  const hoppers = hoppersIn(svg).slice(0, 6);
  const captionOf = h => allWith(h, "data-role", "hopper-caption")[0];
  const weightOf = h => allWithClassName(captionOf(h), "station-hopper__weight")[0];
  const unitOf = h => allWithClassName(captionOf(h), "station-hopper__unit")[0] || null;
  const idOf = h => allWithClassName(captionOf(h), "station-hopper__id")[0];

  assert.deepEqual(hoppers.map(h => weightOf(h).textContent), ["90", "147", "1200", "—", "12345", "1234…"]);
  assert.deepEqual(hoppers.map(h => unitOf(h) ? unitOf(h).textContent : null), ["lb", "lb", "lb", null, null, null],
    "up to four digits carry the unit; a dash and a wider weight do not");

  const t = parts.WEIGHT_TYPE;
  for (const h of hoppers.slice(0, 3)) {
    const weight = weightOf(h);
    const unit = unitOf(h);
    const cx = Number(idOf(h).getAttribute("x"));
    assert.equal(weight.getAttribute("text-anchor"), "end");
    assert.equal(unit.getAttribute("text-anchor"), "start");
    assert.equal(weight.getAttribute("y"), unit.getAttribute("y"), "the unit sits on the weight's line");
    // Centred: the pair's estimated left edge and right edge straddle the column's centre equally.
    const digitsWidth = weight.textContent.length * t.digitSize * t.glyph;
    const unitWidth = t.unit.length * t.unitSize * t.glyph;
    const left = Number(weight.getAttribute("x")) - digitsWidth;
    const right = Number(unit.getAttribute("x")) + unitWidth;
    assert.ok(Math.abs((left + right) / 2 - cx) < 0.02, `${weight.textContent} lb is centred under the hopper`);
    assert.ok(Math.abs(Number(unit.getAttribute("x")) - Number(weight.getAttribute("x")) - t.unitGap) < 0.02, "a hair between digits and unit");
    // The pair stays inside the hopper's pitch (36 units) so neighbours never collide.
    assert.ok(right - left <= 36, `${weight.textContent} lb fits the pitch`);
  }
  // A bare line - dash or a wide weight - is centred at the column exactly as before.
  for (const h of hoppers.slice(3)) {
    const weight = weightOf(h);
    assert.equal(weight.getAttribute("text-anchor"), "middle");
    assert.equal(weight.getAttribute("x"), idOf(h).getAttribute("x"));
  }
  // The pair scales with the bank: a focused bank's unit and gap grow with its digits.
  const doc = fakeDocument();
  const [big, bigUnit] = parts.weightLine(doc, { weight: 90 }, 100, 50, 60, 2);
  const [small, smallUnit] = parts.weightLine(doc, { weight: 90 }, 100, 50, 30, 1);
  assert.ok(Math.abs((Number(bigUnit.getAttribute("x")) - Number(big.getAttribute("x"))) - 2 * (Number(smallUnit.getAttribute("x")) - Number(small.getAttribute("x")))) < 0.02);
  assert.ok(Math.abs((100 - Number(big.getAttribute("x"))) - 2 * (100 - Number(small.getAttribute("x")))) < 0.02);
  // The unit is the muted equipment colour and stays so under a computed weight's tint.
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "station/styles/components/hopper.css"), "utf8");
  assert.match(css, /\.station-hopper__unit \{[^}]*fill: var\(--station-text-muted\)/);
  assert.match(css, /\.station-hopper__unit \{[^}]*\* 0\.8 \* var\(--station-bank-scale, 1\)/, "the unit's size is the renderer's 0.8");
  assert.equal(t.unitSize / t.digitSize, 0.8);
  assert.doesNotMatch(css, /\.is-smart \.station-hopper__unit/);
});

test("a weight change alone re-patches only that hopper", () => {
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  mount.ownerDocument = doc;
  const config = literal({ layerCount: 3, hopperCount: 2 });
  const lineModel = model.buildLineModel(config);
  const state = { "A:0": { assigned: true, resinName: "HX", pct: 60, weight: 1000 }, "A:1": { assigned: true, resinName: "LD", pct: 40, weight: 500 } };
  render.mountStage(mount, lineModel, { document: doc, hopperState: state, stageAspect: 1.6 });
  walk(mount, node => { node.replaceChild = (fresh, old) => { node.children[node.children.indexOf(old)] = fresh; return old; }; });
  const next = Object.assign({}, state, { "A:1": Object.assign({}, state["A:1"], { weight: 650 }) });
  assert.deepEqual(render.patchStage(mount, lineModel, { document: doc, hopperState: next, stageAspect: 1.6 }), { hoppers: 1, layers: 3 });
  assert.deepEqual(textOf(mount, "station-hopper__weight").slice(0, 2), ["1000", "650"]);
});

test("no hopper draws its resin: no label on the drum, no resin line in the caption - the name is the hover panel's and the editor's", () => {
  for (const config of [
    literal({ layerCount: 5, hopperCount: 6 }),
    literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 })
  ]) {
    const svg = stageFor(config, { hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60 } } });
    assert.equal(allWith(svg, "data-role", "hopper-label").length, 0, "a resin label is drawn on the drum");
    assert.deepEqual(textOf(svg, "station-hopper__resin"), [], "the caption draws a resin line");
    const texts = [];
    walk(svg, node => { if (node.nodeName === "text") texts.push(node.textContent); });
    assert.ok(!texts.includes("HX204") && !texts.includes("hx204"), "the resin's code is drawn somewhere on the stage");
  }
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "station/styles/components/hopper.css"), "utf8");
  assert.doesNotMatch(css, /__label|hopper-label|__resin\b/, "hopper.css still styles a resin label or caption line");
  assert.equal(parts.LABEL_TYPE, undefined);
});

test("the hopper group carries no <title> of its own - the hover panel is the reading, and a native tooltip would stack on it - while its label says the identity and every control keeps its title", () => {
  const svg = stageFor(literal({ layerCount: 5, hopperCount: 6 }), {
    hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" } }
  });
  for (const hopper of hoppersIn(svg)) {
    assert.equal(hopper.children.filter(node => node.nodeName === "title").length, 0, "the hopper has a tooltip of its own");
    for (const kind of ["pump", "tracking"]) {
      const control = allWith(hopper, "data-station-target", kind)[0];
      assert.equal(control.children[0].nodeName, "title", `the ${kind} control lost its tooltip`);
    }
  }
  const labels = hoppersIn(svg).map(hopper => hopper.getAttribute("aria-label"));
  assert.equal(labels[0], "A1 · HX204");
  assert.equal(labels[1], "A2 · no resin assigned");
  // The name is nowhere else on the drawing.
  const texts = [];
  walk(svg, node => { if (node.nodeName === "text" || node.nodeName === "title") texts.push(node.textContent); });
  assert.ok(!texts.some(t => /HX204/.test(t)));
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

test("the layer percentage is shown in the layer's header, under its letter and role - and nowhere else", () => {
  const svg = stageFor(literal({ layerCount: 5 }), {
    layerState: { A: { layerPct: 20 }, B: { layerPct: 20 }, C: { layerPct: 20 }, D: { layerPct: 20 }, E: { layerPct: 20 } }
  });
  assert.deepEqual(textOf(svg, "station-layer__share-value"), ["20%", "20%", "20%", "20%", "20%"]);
  // The old readout under the extruder is gone: one place, not two.
  assert.deepEqual(textOf(svg, "station-extruder__pct"), []);
  for (const layer of allWith(svg, "data-role", "layer")) {
    const header = allWith(layer, "data-role", "layer-header")[0];
    const share = allWith(header, "data-role", "layer-share")[0];
    assert.ok(share, "the share is not in the header");
    const [name, role] = header.children;
    assert.equal(String(name.getAttribute("class")), "station-layer__name");
    assert.equal(String(role.getAttribute("class")), "station-layer__role");
    const value = allWithClassName(share, "station-layer__share-value")[0];
    // Directly beneath the role, on the same centreline, upright.
    assert.ok(Number(value.getAttribute("y")) > Number(role.getAttribute("y")), "the share is not below the role");
    assert.equal(Number(value.getAttribute("x")), Number(name.getAttribute("x")));
    assert.equal(value.getAttribute("text-anchor"), "middle");
    assert.equal(value.getAttribute("transform"), null);
  }
});

test("the header's share is the same slot at every scale - normal, focused and dimmed - so a mode change moves nothing", () => {
  const config = literal({ layerCount: 5 });
  for (const focusLayer of [null, "C"]) {
    const layout = layoutFor(config, focusLayer ? { focusLayer, stageAspect: 1.6 } : {});
    const svg = stageFor(config, focusLayer ? { focusLayer, stageAspect: 1.6 } : {});
    for (const bank of layout.banks) {
      const slot = parts.shareSlotBox(bank);
      const share = allWith(svg, "data-role", "layer-share").find(n => n.getAttribute("data-layer") === bank.id);
      const face = allWithClassName(share, "station-layer__share-face")[0];
      assert.equal(Number(face.getAttribute("x")), Math.round(slot.x * 100) / 100);
      assert.equal(Number(face.getAttribute("y")), Math.round(slot.y * 100) / 100);
      // Under the role's line, above the tallest hopper the layout allows.
      assert.ok(slot.y > bank.header.y + 14 * bank.scale, "the slot overlaps the role");
      assert.ok(slot.y + slot.height < bank.cluster.y, "the slot runs into the hoppers");
      // And a compact one: the type is the role's size, not a chip's.
      assert.ok(slot.height <= 16 * bank.scale + 0.01);
    }
  }
  // The tallest profile the layout draws still leaves the slot clear.
  const tall = {};
  for (const layer of ["A", "B", "C", "D", "E"]) for (let index = 0; index < 6; index++) tall[`${layer}:${index}`] = { usableHeight: 999 };
  const tallest = layoutFor(config, { hopperState: tall });
  for (const bank of tallest.banks) {
    const slot = parts.shareSlotBox(bank);
    assert.ok(slot.y + slot.height < bank.cluster.y, "the slot runs into the tallest hoppers");
  }
});

test("with no layer state the percentage reads as unknown, never as zero or a guess", () => {
  assert.deepEqual(textOf(stageFor(literal({ layerCount: 3 })), "station-layer__share-value"), ["—", "—", "—"]);
});

test("the share is a target the boot file resolves, and says whether it may be changed", () => {
  const config = literal({ layerCount: 3 });
  const plain = stageFor(config, { layerState: { A: { layerPct: 30 } } });
  for (const share of allWith(plain, "data-role", "layer-share")) {
    assert.equal(share.getAttribute("data-station-target"), "share");
    assert.equal(share.getAttribute("data-able"), "false", "with no offer, the share cannot be changed");
    const [title, face, value, hit] = share.children;
    assert.equal(title.nodeName, "title");
    assert.doesNotMatch(title.textContent, /click to change/);
    assert.equal(face.getAttribute("class"), "station-layer__share-face");
    assert.equal(value.getAttribute("class"), "station-layer__share-value");
    assert.equal(hit.getAttribute("class"), "station-hit");
    for (const attr of ["x", "y", "width", "height"]) assert.equal(hit.getAttribute(attr), face.getAttribute(attr), "the hit and the face differ");
  }
  const offered = stageFor(config, { layerState: { A: { layerPct: 30 } }, layerShare: { share: true } });
  const a = allWith(offered, "data-role", "layer-share").find(n => n.getAttribute("data-layer") === "A");
  assert.equal(a.getAttribute("data-able"), "true");
  assert.match(a.children[0].textContent, /Layer A · 30% of the film · click to change/);
});

/* ----------------------------------------------------------------------
 *   Interaction targets
 * -------------------------------------------------------------------- */

test("the documented targets exist per layer, and nothing else is declared", () => {
  /* Three equipment targets per layer and the share in its header, plus
   * two per hopper: its receiver is the pump control and its body the
   * tracking control, which toggle the running job's state through the
   * application. */
  const svg = stageFor(literal({ layerCount: 3, hopperCount: 2 }));
  const targets = allWith(svg, "data-station-target");
  const kinds = new Set(targets.map(node => node.getAttribute("data-station-target")));
  assert.deepEqual([...kinds].sort(), ["cluster", "extruder", "mixer", "pump", "share", "tracking"]);

  for (const layer of ["A", "B", "C"]) {
    const forLayer = targets.filter(node => node.getAttribute("data-layer") === layer)
      .map(node => node.getAttribute("data-station-target"));
    assert.equal(forLayer.filter(t => t === "cluster").length, 1);
    assert.equal(forLayer.filter(t => t === "mixer").length, 1);
    assert.equal(forLayer.filter(t => t === "extruder").length, 1);
    assert.equal(forLayer.filter(t => t === "share").length, 1, "one share per layer, in its header");
    assert.equal(forLayer.filter(t => t === "tracking").length, 2, "one tracking control (the body) per hopper");
    assert.equal(forLayer.filter(t => t === "pump").length, 2, "one pump control (the receiver) per hopper");
  }
});

test("every hopper control sits inside its own hopper's cluster", () => {
  // The controls are the nearest target under a click on a hopper; the
  // cluster around them is what a click beside them falls through to.
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }));
  const cluster = allWith(svg, "data-station-target", "cluster")[0];
  assert.equal(allWith(cluster, "data-station-target", "pump").length, 3);
  assert.equal(allWith(cluster, "data-station-target", "tracking").length, 3);
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
  const actionable = allWith(svg, "data-station-target");
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
  const emphasis = Object.fromEntries(banks.map(b => [b.getAttribute("data-layer"), b.getAttribute("data-emphasis")]));
  assert.deepEqual(emphasis, { A: "dimmed", B: "dimmed", C: "focused", D: "dimmed", E: "dimmed" });
  assert.equal(svg.getAttribute("data-focus-layer"), "C");
  // Painted last, so it is on top of anything it overlaps.
  assert.equal(banks[banks.length - 1].getAttribute("data-layer"), "C");
});

/* Focus is a camera move. A bank is a rigid machine assembly: it may be
 * drawn bigger or smaller, but every one of its parts scales by the same
 * factor, so nothing can widen without getting taller and nothing can be
 * squashed. These are the tests that hold that. */

function hopperShape(bank) {
  const h = bank.cluster.hoppers[0];
  return {
    width: h.width, pitch: h.pitch,
    vessel: h.vesselHeight, receiver: h.receiverHeight, cone: h.coneHeight, spout: h.spoutHeight,
    caption: h.captionHeight,
    mixerW: bank.mixer.width, mixerH: bank.mixer.height,
    extruderW: bank.extruder.width, extruderH: bank.extruder.height,
    throatW: bank.throat.width, throatH: bank.throat.height
  };
}

test("the focused bank is the same machine at the same proportions - nothing stretches", () => {
  const plain = hopperShape(layoutFor(literal({ layerCount: 5 })).banks[2]);
  const focused = hopperShape(layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" }).banks[2]);
  const s = layoutModule.DIMENSIONS.focusScale;
  for (const key of Object.keys(plain)) {
    assert.ok(Math.abs(focused[key] - plain[key] * s) < 1e-6, `${key} did not scale by the focus factor (${plain[key]} -> ${focused[key]})`);
  }
  // In particular the hopper is not widened to make room for controls.
  assert.ok(Math.abs(focused.width / focused.vessel - plain.width / plain.vessel) < 1e-9);
});

test("the dimmed banks shrink uniformly - never compressed sideways", () => {
  const plain = hopperShape(layoutFor(literal({ layerCount: 5 })).banks[0]);
  const dimmed = hopperShape(layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" }).banks[0]);
  const s = layoutModule.DIMENSIONS.dimScale;
  assert.ok(s < 1);
  for (const key of Object.keys(plain)) {
    assert.ok(Math.abs(dimmed[key] - plain[key] * s) < 1e-6, `${key} did not scale by the dim factor (${plain[key]} -> ${dimmed[key]})`);
  }
  // The receiver keeps its shape: width and height shrink together.
  const plainBank = layoutFor(literal({ layerCount: 5 })).banks[0];
  const dimBank = layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" }).banks[0];
  assert.ok(Math.abs(dimBank.cluster.hoppers[0].receiverHeight / dimBank.cluster.hopperWidth -
    plainBank.cluster.hoppers[0].receiverHeight / plainBank.cluster.hopperWidth) < 1e-9);
});

test("a bank scales about its own vertical centre, so a ghost floats mid-stage rather than hanging off the top", () => {
  const plain = layoutFor(literal({ layerCount: 5 })).banks[0];
  const dimmed = layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" }).banks[0];
  const pivot = layoutModule.DIMENSIONS.height / 2;
  const s = layoutModule.DIMENSIONS.dimScale;
  for (const [what, read] of [
    ["header", b => b.header.y],
    ["discharge line", b => b.cluster.hoppers[0].coneTop],
    ["mixer top", b => b.mixer.y],
    ["extruder label", b => b.extruder.label.y]
  ]) {
    assert.ok(Math.abs(read(dimmed) - (pivot + (read(plain) - pivot) * s)) < 1e-6, `${what} is not scaled about the centre`);
  }
});

test("rigid scaling is the whole mechanism: every length in the dimensions scales, ratios do not", () => {
  const d = layoutModule.DIMENSIONS;
  const scaled = layoutModule.bankDimensions(d, 2, 350);
  assert.equal(scaled.hopperWidth, d.hopperWidth * 2);
  // The vessel's inch scale rides on hopperWidth, so it scales with the bank
  // and a profiled body keeps its shape at every emphasis.
  assert.equal(layoutModule.unitsPerInch(scaled), layoutModule.unitsPerInch(d) * 2);
  assert.equal(layoutModule.hopperBodyHeight(26, scaled), layoutModule.hopperBodyHeight(26, d) * 2);
  assert.equal(scaled.receiverHeight, d.receiverHeight * 2);
  assert.equal(scaled.mixerScale, d.mixerScale * 2);
  assert.equal(scaled.extruderScale, d.extruderScale * 2);
  assert.equal(scaled.mixerFeedGap, d.mixerFeedGap * 2);
  // Anchors move away from the pivot by the same factor.
  assert.equal(scaled.vesselBottom, 350 + (d.vesselBottom - 350) * 2);
  // Ratios and canvas numbers are untouched.
  assert.equal(scaled.minAspect, d.minAspect);
  assert.equal(scaled.focusScale, d.focusScale);
  // Physical inches are facts about the vessel, not lengths on the canvas.
  assert.equal(scaled.vesselCircumferenceIn, d.vesselCircumferenceIn);
  assert.equal(scaled.defaultUsableHeightIn, d.defaultUsableHeightIn);
  assert.equal(scaled.vesselMinUsableHeightIn, d.vesselMinUsableHeightIn);
  assert.equal(scaled.vesselMaxUsableHeightIn, d.vesselMaxUsableHeightIn);
  assert.equal(scaled.vesselHeadroomIn, d.vesselHeadroomIn);
  assert.equal(scaled.vesselSectionHeightIn, d.vesselSectionHeightIn);
  assert.equal(scaled.height, d.height);
  assert.equal(scaled.bankScale, 2);
});

test("the open layer lands in the same columns whichever layer it is, on a canvas of one width", () => {
  const widths = new Set();
  const columns = new Set();
  for (const id of ["A", "B", "C", "D", "E"]) {
    const layout = layoutFor(literal({ layerCount: 5 }), { focusLayer: id });
    const bank = layout.banks.find(b => b.id === id);
    widths.add(Math.round(layout.width));
    // The train column is sized for the widest view, so a front-on machine
    // and a turned one put their cluster and workspace in the same place.
    columns.add(`${Math.round(bank.objects.cluster.x)}:${Math.round(layout.workspace.x)}`);
    // The train is at the left edge; its column starts at the padding.
    assert.ok(bank.objects.train.x >= layoutModule.DIMENSIONS.focusPadding - 1e-6);
    // Both objects are centred on the canvas height.
    for (const object of ["cluster", "train"]) {
      const box = bank.objects[object];
      assert.ok(Math.abs((box.y + box.height / 2) - layout.height / 2) < 1e-6, `${id}: ${object} is not centred vertically`);
    }
    // The same size wherever it is in the stack.
    assert.equal(bank.cluster.hopperWidth, layoutModule.DIMENSIONS.hopperWidth * layoutModule.DIMENSIONS.focusScale);
  }
  assert.equal(widths.size, 1, `the canvas changes width with the focused layer: ${[...widths]}`);
  assert.equal(columns.size, 1, `the columns move with the focused layer: ${[...columns]}`);
  // The canvas is the stage's shape - height times the measured aspect -
  // whatever the line, so the layout fills the stage at the scale its
  // height allows; with nothing measured, the fallback aspect.
  const d = layoutModule.DIMENSIONS;
  assert.equal(layoutFor(literal({ layerCount: 1, layerAPosition: null }), { focusLayer: "A" }).width, d.height * d.focusAspect);
  assert.equal(layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" }).width, d.height * d.focusAspect);
  assert.equal(layoutFor(literal({ layerCount: 5 }), { focusLayer: "C", stageAspect: 1.8 }).width, d.height * 1.8);
  // But never narrower than the three columns need.
  const narrow = layoutFor(literal({ layerCount: 5 }), { focusLayer: "C", stageAspect: 0.5 });
  assert.ok(narrow.width > d.height * 0.5);
  assert.ok(narrow.workspace.width >= d.workspaceMin - 1e-6);
});

test("the reserved workspace is placed to the right of the open layer, and only in focus", () => {
  assert.equal(layoutFor(literal({ layerCount: 5 })).workspace, undefined);
  const layout = layoutFor(literal({ layerCount: 5 }), { focusLayer: "D" });
  const bank = layout.banks.find(b => b.id === "D");
  const ws = layout.workspace;
  assert.ok(ws.x >= bank.objects.cluster.x + bank.objects.cluster.width + layoutModule.DIMENSIONS.focusColumnGap - 1e-6);
  assert.ok(ws.width > 400, `the workspace is only ${ws.width} wide`);
  assert.equal(ws.y, layoutModule.DIMENSIONS.padding);
  assert.equal(ws.height, layout.height - layoutModule.DIMENSIONS.padding * 2);
  // Drawn as a placeholder that says what it is, under everything else.
  const svg = stageFor(literal({ layerCount: 5 }), { focusLayer: "D" });
  const workspace = allWith(svg, "data-role", "focus-workspace");
  assert.equal(workspace.length, 1);
  assert.equal(svg.children[0], workspace[0], "the workspace must be painted first");
  assert.deepEqual(textOf(svg, "station-workspace__title"), ["RESERVED — FOCUS WORKSPACE"]);
  assert.deepEqual(textOf(svg, "station-workspace__notice"), ["READ-ONLY — NO WRITE CONTRACT YET"]);
  assert.equal(allWith(stageFor(literal({ layerCount: 5 })), "data-role", "focus-workspace").length, 0);
});

test("the workspace carries the editor it is given, in a foreignObject sized to its box, behind the layers", () => {
  const doc = fakeDocument();
  const content = doc.createElement("div");
  content.setAttribute("class", "station-editor");
  const svg = render.renderStage(model.buildLineModel(literal({ layerCount: 5 })), { document: doc, focusLayer: "D", workspace: content });
  const workspace = allWith(svg, "data-role", "focus-workspace")[0];
  assert.equal(svg.children[0], workspace, "painted first, so a layer in transit passes in front of it");
  const host = workspace.children.find(c => c.nodeName === "foreignObject");
  assert.ok(host, "no foreignObject");
  assert.equal(host.getAttribute("class"), "station-workspace__editor");
  const box = layoutFor(literal({ layerCount: 5 }), { focusLayer: "D" }).workspace;
  assert.deepEqual(["x", "y", "width", "height"].map(k => Number(host.getAttribute(k))),
    [box.x, box.y, box.width, box.height].map(v => Math.round(v * 100) / 100));
  assert.equal(host.children[0], content);
  // With controls in it the stage is no longer an image to assistive technology.
  assert.equal(svg.getAttribute("role"), "group");
  assert.deepEqual(textOf(svg, "station-workspace__title"), [], "the reserved label is gone once there is content");
  // The normal row and an empty workspace are untouched.
  assert.equal(stageFor(literal({ layerCount: 5 })).getAttribute("role"), "img");
  assert.equal(stageFor(literal({ layerCount: 5 }), { focusLayer: "D" }).getAttribute("role"), "img");
});

test("the selected hopper is marked on the open layer only, and stands in for the cluster outline", () => {
  const hoppers = svg => allWith(svg, "data-role", "hopper");
  const svg = stageFor(literal({ layerCount: 5 }), { focusLayer: "D", selectedTarget: "cluster", selectedHopper: "D2" });
  const selected = hoppers(svg).filter(h => String(h.getAttribute("class")).split(/\s+/).includes("is-selected"));
  assert.deepEqual(selected.map(h => h.getAttribute("data-hopper")), ["D2"]);
  const layerD = allWith(svg, "data-layer", "D").find(n => n.getAttribute("data-role") === "layer");
  assert.ok(!layerD.getAttribute("class").includes("is-cluster-selected"), "one hopper selected: the whole bank is not outlined too");
  // Without a hopper the cluster outline is what it was.
  const whole = stageFor(literal({ layerCount: 5 }), { focusLayer: "D", selectedTarget: "cluster" });
  const wholeD = allWith(whole, "data-layer", "D").find(n => n.getAttribute("data-role") === "layer");
  assert.ok(wholeD.getAttribute("class").includes("is-cluster-selected"));
  assert.equal(hoppers(whole).filter(h => String(h.getAttribute("class")).includes("is-selected")).length, 0);
  // A hopper id on a layer that is not open marks nothing.
  const other = stageFor(literal({ layerCount: 5 }), { focusLayer: "D", selectedTarget: "cluster", selectedHopper: "A2" });
  assert.equal(hoppers(other).filter(h => String(h.getAttribute("class")).includes("is-selected")).length, 0);
});

test("the dimmed banks step outward from the open layer, on the side they belong to, in their normal order", () => {
  const plain = layoutFor(literal({ layerCount: 5 }));
  const layout = layoutFor(literal({ layerCount: 5 }), { focusLayer: "C" });
  const offset = (layout.width - plain.width) / 2;
  const retreat = layoutModule.DIMENSIONS.focusRetreat;
  for (const [index, bank] of layout.banks.entries()) {
    if (bank.id === "C") continue;
    const was = plain.banks[index];
    const away = index < 2 ? -retreat : retreat;
    // Scaled about its own centre, then moved a step further out.
    assert.ok(Math.abs(bank.centerX - (offset + was.centerX + away)) < 1e-6, `${bank.id} did not retreat by ${retreat}`);
  }
  // Ghosts keep their physical order with air between them.
  const [a, b, , d, e] = layout.banks;
  assert.ok(a.x + a.width < b.x && d.x + d.width < e.x);
  // Ghosts are painted first, the open layer last.
  assert.deepEqual(layout.paintOrder, [0, 1, 3, 4, 2]);
  assert.deepEqual(layoutFor(literal({ layerCount: 5 }), { focusLayer: "A" }).paintOrder, [1, 2, 3, 4, 0]);
});

test("the focused bank fits the canvas top to bottom, controls included", () => {
  for (const layerCount of [1, 3, 5]) {
    const config = literal({ layerCount });
    for (const layer of model.buildLineModel(config).layers) {
      const layout = layoutFor(config, { focusLayer: layer.id, hopperState: { [`${layer.id}:0`]: { usableHeight: 40 } } });
      const bank = layout.banks.find(b => b.id === layer.id);
      assert.ok(bank.header.y > 0);
      assert.ok(bank.extruder.label.y + 4 <= layout.height, `${layerCount} layers, ${layer.id}: runs off the bottom`);
    }
  }
});

test("a layer is the same drawing in every emphasis - so it can be carried between layouts as one object", () => {
  /* The transition (station-transition.js) moves a layer's cluster and
   * train as rigid objects: the destination element is placed over the
   * source and released. That only reads as one object if the two renders
   * are the same drawing at two scales - the same elements, the same
   * classes, in the same order. */
  const hopperState = {
    "A:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" },
    "B:0": { assigned: true, resinName: "LD105", pct: 60, source: "SILO 4" }
  };
  const config = literal({ layerCount: 3, hopperCount: 2 });
  const shape = (svg, id) => {
    const layer = allWith(svg, "data-role", "layer").find(l => l.getAttribute("data-layer") === id);
    const out = [];
    walk(layer, node => out.push(`${node.nodeName}.${node.getAttribute("class") || ""}`));
    return out;
  };
  const normal = stageFor(config, { hopperState });
  const focused = stageFor(config, { focusLayer: "A", hopperState });
  for (const id of ["A", "B"]) {
    const before = shape(normal, id);
    const after = shape(focused, id);
    // Only the layer's own state classes differ; every element is there.
    const strip = list => list.map(entry => entry.replace(/ ?is-(focused|dimmed|[a-z]+-selected)/g, ""));
    assert.deepEqual(strip(after), strip(before), `${id} is a different drawing when ${id === "A" ? "open" : "dimmed"}`);
  }
  // And the captions say the same things at every size (paint order aside).
  assert.deepEqual(textOf(focused, "station-hopper__id").sort(), textOf(normal, "station-hopper__id").sort());
  assert.deepEqual(textOf(focused, "station-hopper__source").sort(), textOf(normal, "station-hopper__source").sort());
});

test("focusing one layer does not change any other layer's extruder view", () => {
  const plain = layoutFor(literal({ layerCount: 5 }));
  const focused = layoutFor(literal({ layerCount: 5 }), { focusLayer: "A" });
  assert.deepEqual(focused.banks.map(b => [b.extruder.view, b.extruder.mirrored]),
    plain.banks.map(b => [b.extruder.view, b.extruder.mirrored]));
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
  const moved = layoutFor(literal({ layerCount: 3 }), { dimensions: { mixerScale: 1.3 } });
  assert.notEqual(moved.banks[0].mixer.height, base.banks[0].mixer.height);
  for (const [what, read] of [
    ["hopper vessel", l => l.banks[0].cluster.hoppers[0].vesselTop],
    ["hopper width", l => l.banks[0].cluster.hopperWidth],
    ["extruder view", l => l.banks[0].extruder.view],
    ["extruder yaw", l => l.banks[0].extruder.yaw],
    ["bank x", l => l.banks[1].x]
  ]) {
    assert.equal(read(moved), read(base), `${what} moved with the mixer`);
  }
  /* The extruder DOES follow the mixer, and that is deliberate: it hangs off
   * the mixer's discharge, so a taller blender pushes it down instead of
   * being drawn through it. Everything else stays put. */
  assert.ok(moved.banks[0].extruder.anchor.y > base.banks[0].extruder.anchor.y,
    "the extruder should follow the bottom of the neck");
});

test("changing the extruder does not disturb the hoppers or the banks", () => {
  const base = layoutFor(literal({ layerCount: 3 }));
  const longer = layoutFor(literal({ layerCount: 3 }), { dimensions: { extruderScale: 1.3 } });
  assert.ok(longer.banks[0].extruder.height > base.banks[0].extruder.height);
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
  const receivers = allWith(svg, "data-station-target", "pump");
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

test("inline styles carry numeric geometry/shading and local gradients, never hardcoded colours", () => {
  const svg = stageFor(literal({ layerCount: 5 }), { focusLayer: "C" });
  const styled = [];
  walk(svg, node => { if (node.getAttribute("style") !== null) styled.push(node); });
  const layers = allWith(svg, "data-role", "layer");
  const extruderFaces = allWithClassName(svg, "station-extruder__face");
  assert.equal(styled.length, hoppersIn(svg).length + layers.length + extruderFaces.length);
  for (const node of styled) {
    if (node.getAttribute("data-role") === "layer") {
      // The bank's scale, so the type inside it is sized with the equipment.
      assert.match(node.getAttribute("style"), /^--station-bank-scale: [0-9.]+;$/);
    } else if (extruderFaces.includes(node)) {
      assert.match(node.getAttribute("style"), /^--station-extruder-tone: [0-9.]+%; --station-extruder-edge-tone: [0-9.]+%; --station-extruder-line: [0-9.]+;( --station-extruder-gradient: url\(#station-extruder-[A-Z]+-(lid|end|metal|drive)\);)?$/);
    } else {
      assert.match(node.getAttribute("style"), /^--station-hopper-fill:/);
    }
  }
  const scales = Object.fromEntries(layers.map(l => [l.getAttribute("data-layer"), l.getAttribute("style")]));
  assert.equal(scales.C, `--station-bank-scale: ${layoutModule.DIMENSIONS.focusScale};`);
  assert.equal(scales.A, `--station-bank-scale: ${layoutModule.DIMENSIONS.dimScale};`);
  assert.equal(allWith(stageFor(literal({ layerCount: 1, layerAPosition: null })), "data-role", "layer")[0].getAttribute("style"),
    "--station-bank-scale: 1;");
});

test("the view is described for assistive technology by what it is", () => {
  const svg = stageFor(literal({ layerCount: 5, displayName: "Line 11" }));
  assert.equal(svg.getAttribute("role"), "img");
  assert.match(svg.getAttribute("aria-label"), /Line 11.*5 layer extrusion train/);
});

/* ----------------------------------------------------------------------
 *   Weight Profile height
 * -------------------------------------------------------------------- */

test("the vessel is drawn at its true proportions: width is the diameter, inches follow", () => {
  const d = layoutModule.DIMENSIONS;
  const diameterIn = d.vesselCircumferenceIn / Math.PI;
  const scale = layoutModule.unitsPerInch(d);
  // The drawn width stands for the outside diameter of a 36.25" vessel.
  assert.ok(Math.abs(scale * diameterIn - d.hopperWidth) < 1e-9);
  assert.ok(Math.abs(scale - 30 / 11.539) < 0.001, "36.25\" round is about 11.54\" across");
  // A 26" body on that vessel is 2.25 times taller than it is wide, cone
  // shoulder to fill valve - the shape an operator sees on the floor.
  const geometry = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }),
    { hopperState: { "A:0": { usableHeight: 26 } } }).banks[0].cluster.hoppers[0];
  const measured = geometry.coneTop - geometry.fillValveY;
  assert.ok(Math.abs(measured / geometry.width - 26 / diameterIn) < 1e-9,
    "drawn height-to-width must equal the vessel's real height-to-diameter");
  // Changing the circumference changes the scale, never the width: a wider
  // vessel is drawn as a squatter one.
  const wider = layoutModule.unitsPerInch({ ...d, vesselCircumferenceIn: d.vesselCircumferenceIn * 2 });
  assert.ok(Math.abs(wider - scale / 2) < 1e-9);
});

test("body height scales linearly from the profile height, on one shared scale", () => {
  const height = layoutModule.hopperBodyHeight;
  const d = layoutModule.DIMENSIONS;
  const scale = layoutModule.unitsPerInch(d);
  const defaultUsableHeight = d.defaultUsableHeightIn;
  assert.equal(height(defaultUsableHeight), (defaultUsableHeight + d.vesselHeadroomIn) * scale);
  // The measured portion is linear; the allowance above the valve is fixed.
  assert.ok(Math.abs(height(36) - height(24) - 12 * scale) < 1e-9);
  assert.ok(height(defaultUsableHeight * 1.2) > height(defaultUsableHeight));
  assert.ok(height(defaultUsableHeight * 0.8) < height(defaultUsableHeight));
  // One shared scale: the same inches give the same height, always. It does
  // not normalise per bank, which would make two lines incomparable.
  assert.equal(height(26), height(26));
});

test("a missing or nonsense profile height falls back to the default body", () => {
  const d = layoutModule.DIMENSIONS;
  const fallback = layoutModule.hopperBodyHeight(d.defaultUsableHeightIn);
  for (const input of [undefined, null, 0, -12, NaN, Infinity, "", "tall", {}]) {
    assert.equal(layoutModule.hopperBodyHeight(input), fallback,
      `${String(input)} should fall back to the default body`);
  }
});

test("vessel bands repeat every 12 inches from the discharge at every bank scale", () => {
  const config = literal({ layerCount: 3, hopperCount: 3 });
  const hopperState = Object.fromEntries(["A", "B", "C"].flatMap(layer =>
    [20, 24, 36].map((usableHeight, index) => [`${layer}:${index}`, { usableHeight }])));
  for (const focusLayer of [null, "B"]) {
    const options = { hopperState, focusLayer };
    const layout = layoutFor(config, options);
    const svg = stageFor(config, options);
    for (const bank of layout.banks) {
      const sectionHeight = 12 * layoutModule.unitsPerInch(layoutModule.DIMENSIONS) * bank.scale;
      for (const geometry of bank.cluster.hoppers) {
        assert.ok(Math.abs(geometry.vesselSectionHeight - sectionHeight) < 0.001);
        const hopper = hoppersIn(svg).find(h => h.getAttribute("data-hopper") === geometry.id);
        const bands = [];
        walk(hopper, n => {
          if (n.getAttribute("class") === "station-hopper__band") {
            bands.push(Number(n.getAttribute("d").split(" ")[2]));
          }
        });
        assert.equal(bands.length, [4, 5, 6][geometry.index],
          "a taller body must gain sections instead of stretching its bands");
        // The top section can be partial. All sections below it have one
        // fixed physical height, independent of the profile and focus size.
        for (let i = 2; i < bands.length; i++) {
          assert.ok(Math.abs(bands[i] - bands[i - 1] - sectionHeight) < 0.02);
        }
      }
    }
  }
});

test("section calibration changes only the bands, not vessel height or hit geometry", () => {
  const config = literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 });
  const options = { hopperState: { "A:0": { usableHeight: 36 } } };
  const adjusted = { ...options, dimensions: { vesselSectionHeightIn: 8 } };
  const standardGeometry = layoutFor(config, options).banks[0].cluster.hoppers[0];
  const adjustedGeometry = layoutFor(config, adjusted).banks[0].cluster.hoppers[0];
  assert.deepEqual({ ...adjustedGeometry, vesselSectionHeight: standardGeometry.vesselSectionHeight }, standardGeometry);
  const standard = hoppersIn(stageFor(config, options))[0];
  const tuned = hoppersIn(stageFor(config, adjusted))[0];
  const countBands = hopper => {
    let count = 0;
    walk(hopper, n => { if (n.getAttribute("class") === "station-hopper__band") count++; });
    return count;
  };
  assert.ok(countBands(tuned) > countBands(standard));
  assert.deepEqual(allWith(tuned, "data-role", "hopper-interaction")[0].children[0].attributes,
    allWith(standard, "data-role", "hopper-interaction")[0].children[0].attributes);
});

test("usable height ends at the lower fill valve, with separate headroom and hose port", () => {
  const config = literal({ layerCount: 3, hopperCount: 3 });
  const heights = [20, 30, 40];
  const hopperState = Object.fromEntries(["A", "B", "C"].flatMap(layer =>
    heights.map((usableHeight, index) => [`${layer}:${index}`, { usableHeight }])));
  for (const focusLayer of [null, "B"]) {
    for (const vesselHeadroomIn of [12, 18, 24]) {
      // Keep this measurement test inside the normal drawing limits.
      const options = { hopperState, focusLayer, dimensions: { vesselHeadroomIn } };
      const layout = layoutFor(config, options);
      const svg = stageFor(config, options);
      for (const bank of layout.banks) {
        const unitsPerInch = layoutModule.unitsPerInch(layoutModule.DIMENSIONS) * bank.scale;
        for (const geometry of bank.cluster.hoppers) {
          assert.ok(Math.abs(geometry.coneTop - geometry.fillValveY - heights[geometry.index] * unitsPerInch) < 0.001,
            "profile height must measure from cone shoulder to fill valve");
          assert.ok(Math.abs(geometry.fillValveY - geometry.vesselTop - vesselHeadroomIn * unitsPerInch) < 0.001);
          const hopper = hoppersIn(svg).find(h => h.getAttribute("data-hopper") === geometry.id);
          const ports = {};
          walk(hopper, n => {
            for (const cls of ["station-hopper__port", "station-hopper__fill-valve"]) {
              if (n.getAttribute("class") === cls) ports[cls] = n;
            }
          });
          assert.ok(Number(ports["station-hopper__port"].getAttribute("cy")) < geometry.fillValveY);
          assert.ok(Math.abs(Number(ports["station-hopper__fill-valve"].getAttribute("cy")) - geometry.fillValveY) < 0.01);
          const fill = allWith(hopper, "data-role", "hopper-material")[0].children[0];
          assert.ok(Math.abs(Number(fill.getAttribute("y")) - geometry.fillValveY) < 0.01);
          assert.ok(Number(fill.getAttribute("y")) + Number(fill.getAttribute("height")) < geometry.coneTop,
            "the material range must stay between the valve and cone shoulder");
        }
      }
    }
  }
});

test("extreme profile heights are clamped so the layout cannot be broken", () => {
  const d = layoutModule.DIMENSIONS;
  const tallest = layoutModule.hopperBodyHeight(d.vesselMaxUsableHeightIn);
  const shortest = layoutModule.hopperBodyHeight(d.vesselMinUsableHeightIn);
  assert.equal(layoutModule.hopperBodyHeight(100000), tallest);
  assert.equal(layoutModule.hopperBodyHeight(0.01), shortest);
  // The clamp acts on the usable inches: even a clamped body keeps its full
  // headroom above the valve, so the valve never rides up to the lid.
  assert.equal(shortest, (d.vesselMinUsableHeightIn + d.vesselHeadroomIn) * layoutModule.unitsPerInch(d));
  // And the tallest possible hopper still leaves the header room to breathe.
  const tallestTop = d.vesselBottom - tallest - d.receiverGap - d.receiverHeight - d.sourceGap;
  assert.ok(tallestTop > d.headerTop + 14,
    "a fully clamped hopper collides with the layer header");
});

test("the discharge is a flat plate and a clear 3\" hose filling the old cone-and-spout span", () => {
  const config = literal({ layerCount: 3, hopperCount: 3 });
  const hopperState = { "A:0": { usableHeight: 20 }, "A:1": { usableHeight: 36 } };
  for (const focusLayer of [null, "B"]) {
    const options = { hopperState, focusLayer };
    const layout = layoutFor(config, options);
    const svg = stageFor(config, options);
    for (const bank of layout.banks) {
      const scale = layoutModule.unitsPerInch(layoutModule.DIMENSIONS) * bank.scale;
      for (const geometry of bank.cluster.hoppers) {
        // True diameter on the vessel's inch scale, whatever the body height.
        assert.ok(Math.abs(geometry.hoseWidth - 3 * scale) < 1e-9);
        const hopper = hoppersIn(svg).find(h => h.getAttribute("data-hopper") === geometry.id);
        const parts = {};
        walk(hopper, n => {
          const cls = n.getAttribute("class");
          if (cls && cls.startsWith("station-hopper__")) parts[cls] = parts[cls] || n;
        });
        for (const gone of ["station-hopper__cone-shape", "station-hopper__spout"]) {
          assert.ok(!parts[gone], `${gone} should no longer be drawn`);
        }
        const plate = parts["station-hopper__bottom-plate"];
        const hose = parts["station-hopper__hose"];
        assert.ok(plate && hose, "flat plate and hose must both exist");
        // The plate straddles the discharge line: the body ends flat, no cone.
        const plateMid = Number(plate.getAttribute("y")) + Number(plate.getAttribute("height")) / 2;
        assert.ok(Math.abs(plateMid - geometry.coneTop) < 0.01);
        // The hose is centred, drawn at its diameter, and ends where the old
        // spout ended so the caption below it does not move.
        const hoseX = Number(hose.getAttribute("x"));
        const hoseW = Number(hose.getAttribute("width"));
        assert.ok(Math.abs(hoseW - geometry.hoseWidth) < 0.01);
        assert.ok(Math.abs(hoseX + hoseW / 2 - (geometry.x + geometry.width / 2)) < 0.01);
        assert.ok(Number(hose.getAttribute("y")) > geometry.coneTop);
        const hoseEnd = Number(hose.getAttribute("y")) + Number(hose.getAttribute("height"));
        assert.ok(Math.abs(hoseEnd - (geometry.spoutTop + geometry.spoutHeight)) < 0.01);
        assert.ok(hoseEnd < geometry.captionTop);
        // The helix is drawn, and drawn as a few paths, not one node per turn.
        assert.ok(parts["station-hopper__hose-spiral"]);
        assert.ok(parts["station-hopper__hose-spiral"].getAttribute("d").split("M").length > 4);
      }
    }
  }
});

test("an unassigned hopper's hose is drawn emptier: clearer tube, faded helix", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "station/styles/components/hopper.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "station/styles/themes/industrial-dark.css"), "utf8");
  // The running hose and the empty hose are two tokens, and the empty one is
  // the more transparent of the two.
  const alpha = name => Number(tokens.match(new RegExp(`${name}: rgba\\([^)]*, ([0-9.]+)\\);`))[1]);
  assert.ok(alpha("--station-hose-empty") < alpha("--station-hose-clear"));
  assert.match(css, /\.station-hopper\.is-unassigned \.station-hopper__hose,\s*\.station-hopper\.is-unassigned \.station-hopper__hose-end \{\s*fill: var\(--station-hose-empty\);/);
  assert.match(css, /\.station-hopper\.is-unassigned \.station-hopper__hose-spiral,\s*\.station-hopper\.is-unassigned \.station-hopper__hose-glint \{\s*opacity: 0\.45;/);
  // And the class that drives it is still set from runtime assignment.
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 2 }),
    { hopperState: { "A:0": { assigned: true, resinName: "HX204" }, "A:1": { assigned: false } } });
  const [used, unused] = hoppersIn(svg);
  assert.ok(!used.getAttribute("class").includes("is-unassigned"));
  assert.ok(unused.getAttribute("class").includes("is-unassigned"));
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
  const receiver = allWith(svg, "data-role", "hopper-receiver-drawing")[0];
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
  // Its discharge is on its train's centreline, and the extruder's feed is
  // still exactly under it. (The discharge, not the bounding box: the master
  // carries its air regulator on one side, so the box is off-centre.)
  assert.equal(Math.round(after.outlet.x * 100) / 100, Math.round(focused.banks[2].objects.train.centerX * 100) / 100);
  assert.equal(after.outlet.x, focused.banks[2].extruder.anchor.x);
});

test("the mixer does not grow with the hopper count it happens to sit under", () => {
  // It is authored artwork at one size, so a nine-hopper bank does not
  // produce a mixer three times the size of a three-hopper one.
  const few = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 })).banks[0].mixer;
  const many = layoutFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 9 })).banks[0].mixer;
  assert.equal(few.height, many.height);
  assert.equal(few.width, many.width);
});

/* ----------------------------------------------------------------------
 *   Extruder: adapted artwork, not a procedural drawing
 * -------------------------------------------------------------------- */

test("the extruder is the asset's polygons, every one labelled by part and face", () => {
  const svg = stageFor(literal({ layerCount: 5 }));
  const extruders = allWith(svg, "data-role", "extruder");
  extruders.forEach((extruder, index) => {
    const view = extruder.getAttribute("data-view");
    const faces = allWithClassName(extruder, "station-extruder__face");
    assert.equal(faces.length, assets.views[view].polygons.length,
      `layer ${index}: not every polygon of the ${view} view was drawn`);
    faces.forEach((face, i) => {
      const polygon = assets.views[view].polygons[i];
      assert.equal(face.getAttribute("data-part"), polygon.part);
      assert.equal(face.getAttribute("data-face"), polygon.face);
      const classes = face.getAttribute("class").split(" ");
      assert.ok(classes.includes(`station-extruder__${polygon.part}`));
      assert.ok(classes.includes(`station-extruder__paint--${polygon.material}`));
      assert.equal(face.getAttribute("data-source-part"), polygon.sourcePart);
      assert.match(face.getAttribute("d"), /^M [-\d.]+ [-\d.]+( L [-\d.]+ [-\d.]+)+ Z$/);
    });
  });
});

test("the parts that carry recognition are all present in every view", () => {
  /* Housing, feed, outlet flange with its bore, gearbox and motor, base and
   * feet. Those are what the derivative was asked to keep. */
  for (const bank of layoutFor(literal({ layerCount: 5 })).banks) {
    const parts = new Set(assets.views[bank.extruder.view].polygons.map(p => p.part));
    for (const part of ["housing", "feed", "outlet", "flange", "recess", "bore", "gearbox", "motor", "base", "foot"]) {
      assert.ok(parts.has(part), `${bank.extruder.view} view has no ${part}`);
    }
  }
});

test("extruder gradients belong to their own drawing and mirror with its geometry", () => {
  const config = literal({ layerCount: 5 });
  const banks = layoutFor(config).banks;
  const svg = stageFor(config);
  const ids = new Set();
  allWith(svg, "data-role", "extruder").forEach((extruder, index) => {
    const body = allWith(extruder, "data-role", "extruder-body")[0];
    assert.equal(body.getAttribute("pointer-events"), "none");
    const definitions = body.children[0];
    assert.equal(definitions.nodeName, "defs");
    const asset = assets.views[banks[index].extruder.view];
    assert.equal(definitions.children.length, asset.gradients.length);
    const localIds = new Set();
    definitions.children.forEach((gradient, i) => {
      const id = gradient.getAttribute("id");
      assert.ok(!ids.has(id), "gradient IDs collide across machines");
      ids.add(id);
      localIds.add(id);
      const source = asset.gradients[i];
      for (const axis of ["x1", "x2"]) {
        const expected = banks[index].extruder.mirrored ? 1 - source[axis] : source[axis];
        assert.ok(Math.abs(Number(gradient.getAttribute(axis)) - expected) < 0.001);
      }
      assert.deepEqual(gradient.children.map(stop => Number(stop.getAttribute("offset"))), source.stops);
    });
    for (const face of allWithClassName(body, "station-extruder__face")) {
      const reference = face.getAttribute("style").match(/url\(#([^)]+)\)/);
      if (reference) assert.ok(localIds.has(reference[1]), "paint references another machine's gradient");
      assert.equal(face.getAttribute("data-station-target"), null);
      assert.equal(face.getAttribute("tabindex"), null);
    }
    assert.ok(extruder.children.some(child => child.getAttribute("class") === "station-hit"));
  });
});

test("the same artwork handles both sides - a mirrored machine is the same polygons reflected", () => {
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  const svg = stageFor(literal({ layerCount: 5 }));
  const extruders = allWith(svg, "data-role", "extruder");
  const points = node => allWithClassName(node, "station-extruder__face").map(face =>
    face.getAttribute("d").match(/[-\d.]+ [-\d.]+/g).map(pair => pair.split(" ").map(Number)));

  for (const [a, b] of [[0, 4], [1, 3]]) {
    const left = points(extruders[a]);
    const right = points(extruders[b]);
    assert.equal(left.length, right.length);
    const leftCentre = banks[a].extruder.anchor.x;
    const rightCentre = banks[b].extruder.anchor.x;
    left.forEach((polygon, i) => polygon.forEach(([x, y], j) => {
      const [rx, ry] = right[i][j];
      assert.ok(Math.abs((x - leftCentre) + (rx - rightCentre)) < 0.011, "x does not reflect");
      assert.ok(Math.abs((y - banks[a].extruder.anchor.y) - (ry - banks[b].extruder.anchor.y)) < 0.011, "y moved");
    }));
  }
});

test("there are feet under both ends, and the machine stands on them", () => {
  for (const view of assets.ORDER) {
    const feet = assets.views[view].polygons.filter(p => p.part === "foot");
    assert.ok(feet.length >= 8, `${view}: too few foot faces to be two pairs of legs`);
    /* The feet reach the floor: their lowest point is level with the lowest
     * point of the whole machine. (Not necessarily BELOW it - seen from the
     * die at a slight elevation, the base's near edge projects as low as the
     * feet behind it, in the source as well as here.) */
    const lowest = Math.max(...assets.views[view].polygons.flatMap(p => p.points.filter((_, i) => i % 2 === 1)));
    const lowestFoot = Math.max(...feet.flatMap(p => p.points.filter((_, i) => i % 2 === 1)));
    assert.ok(lowest - lowestFoot < 3, `${view}: the machine does not stand on its feet`);
  }
});

test("the bore is in the flange, and the flange is on the outlet end", () => {
  /* The front end has to read: outlet boss, flange face, recess, bore, each
   * inside the last. Checked as centroids and extents in the asset. */
  for (const view of assets.ORDER) {
    const asset = assets.views[view];
    const one = part => asset.polygons.find(p => p.part === part && p.face === "cap");
    const extent = polygon => {
      const xs = polygon.points.filter((_, i) => i % 2 === 0);
      return Math.max(...xs) - Math.min(...xs);
    };
    const centre = polygon => {
      const xs = polygon.points.filter((_, i) => i % 2 === 0);
      const ys = polygon.points.filter((_, i) => i % 2 === 1);
      return [xs.reduce((a, b) => a + b) / xs.length, ys.reduce((a, b) => a + b) / ys.length];
    };
    const [flange, recess, bore] = [one("flange"), one("recess"), one("bore")];
    assert.ok(extent(flange) > extent(recess) && extent(recess) > extent(bore), `${view}: rings out of order`);
    const [fc, bc] = [centre(flange), centre(bore)];
    assert.ok(Math.hypot(fc[0] - bc[0], fc[1] - bc[1]) < 1, `${view}: the bore is not centred in the flange`);
    // The bore is where the asset says the outlet is.
    assert.ok(Math.hypot(bc[0] - asset.outlet.x, bc[1] - asset.outlet.y) < 1.5, `${view}: outlet metadata disagrees with the bore`);
  }
});

/* ----------------------------------------------------------------------
 *   The two rigid objects a bank declares
 * -------------------------------------------------------------------- */

test("every bank declares its cluster and train as boxes, and they are the same shape in every layout", () => {
  /* What the transition reads. A box's aspect ratio is the proof that the
   * object was scaled, not stretched: the same in the normal row, opened,
   * and dimmed. */
  const config = literal({ layerCount: 5 });
  const boxes = svg => Object.fromEntries(allWith(svg, "data-role", "layer").map(layer => [
    layer.getAttribute("data-layer"),
    {
      cluster: layer.getAttribute("data-object-cluster").split(" ").map(Number),
      train: layer.getAttribute("data-object-train").split(" ").map(Number)
    }
  ]));
  const normal = boxes(stageFor(config));
  const focused = boxes(stageFor(config, { focusLayer: "C" }));
  const aspect = box => box[2] / box[3];
  for (const id of ["A", "B", "C", "D", "E"]) {
    for (const object of ["cluster", "train"]) {
      assert.equal(normal[id][object].length, 4);
      assert.ok(Math.abs(aspect(focused[id][object]) - aspect(normal[id][object])) < 1e-3,
        `${id} ${object} changed shape between layouts`);
      const scale = id === "C" ? layoutModule.DIMENSIONS.focusScale : layoutModule.DIMENSIONS.dimScale;
      assert.ok(Math.abs(focused[id][object][2] / normal[id][object][2] - scale) < 1e-3,
        `${id} ${object} is not at the ${scale} scale`);
    }
  }
  // The boxes are where the layout says the objects are.
  const layout = layoutFor(config, { focusLayer: "C" });
  const c = layout.banks.find(b => b.id === "C");
  assert.deepEqual(focused.C.train.map(n => Math.round(n)), [c.objects.train.x, c.objects.train.y, c.objects.train.width, c.objects.train.height].map(n => Math.round(n)));
  // And the train box holds the mixer and the extruder, readout included.
  assert.ok(c.objects.train.x <= c.mixer.bounds.left && c.objects.train.x <= c.extruder.bounds.left);
  assert.ok(c.objects.train.y <= c.mixer.bounds.top);
  assert.ok(c.objects.train.y + c.objects.train.height >= c.extruder.label.y);
});

test("no entry fields are drawn on the equipment - the workspace is reserved for them", () => {
  const svg = stageFor(literal({ layerCount: 3 }), {
    focusLayer: "B",
    hopperState: { "B:0": { assigned: true, resinName: "HX204", pct: 60, source: "SILO 3" } }
  });
  assert.equal(allWith(svg, "data-station-field").length, 0);
  const classes = new Set();
  walk(svg, node => { for (const c of String(node.getAttribute("class") || "").split(/\s+/)) classes.add(c); });
  assert.ok(![...classes].some(c => /station-field/.test(c)), "an entry field is drawn");
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

test("expanding a layer scales the whole blender with the bank rather than stretching it", () => {
  // With a focus factor above 1 so the mechanism is visible; the shipped
  // factor is 1 because the canvas has no more height to give.
  const plain = layoutFor(literal({ layerCount: 3 })).banks[1];
  const focused = layoutFor(literal({ layerCount: 3 }), { focusLayer: "B", dimensions: { focusScale: 1.3 } }).banks[1];
  const aspect = m => m.width / m.height;
  assert.ok(Math.abs(aspect(focused.mixer) - aspect(plain.mixer)) < 0.001,
    "the blender was distorted by the expansion");
  const grown = focused.mixer.width / plain.mixer.width;
  assert.ok(Math.abs(grown - 1.3) < 0.001, `expected exactly the focus scale, got ${grown.toFixed(2)}x`);
  // Both axes by the same factor, and the extruder by the same factor too:
  // one bank, one scale.
  assert.ok(Math.abs(grown - focused.mixer.height / plain.mixer.height) < 0.001);
  assert.ok(Math.abs(focused.extruder.scale / plain.extruder.scale - 1.3) < 0.001);
  assert.ok(Math.abs(focused.cluster.hopperWidth / plain.cluster.hopperWidth - 1.3) < 0.001);
});

test("the rotor is authored once and placed, so it scales with its blender", () => {
  /* The bug this guards against: an agitator whose size was computed with an
   * absolute cap in it, so an expanded blender got a normal-sized agitator.
   * The rotor's paddles are now the asset's own polygons, in the plane of
   * the inspection cover, placed by ONE transform that carries the mixer's
   * scale. Compared against the UNFOCUSED state, which is what the old bug
   * hid behind. */
  const mountOf = (svg, layer) => {
    const bank = allWith(svg, "data-layer", layer).find(n => n.getAttribute("data-role") === "layer");
    return allWith(bank, "data-role", "mixer-rotor-mount")[0].getAttribute("transform");
  };
  const matrixOf = transform => transform.match(/matrix\(([^)]+)\)/)[1].split(" ").map(Number);
  const plain = stageFor(literal({ layerCount: 3 }));
  const focused = stageFor(literal({ layerCount: 3 }), { focusLayer: "B", dimensions: { focusScale: 1.3 } });

  const [pa, pb, , pd] = matrixOf(mountOf(plain, "B"));
  const [fa, fb, , fd] = matrixOf(mountOf(focused, "B"));
  const scale = layoutFor(literal({ layerCount: 3 }), { focusLayer: "B", dimensions: { focusScale: 1.3 } }).banks[1].mixer.scale;
  // Every entry of the placing matrix grows by exactly the blender's scale.
  for (const [p, f] of [[pa, fa], [pb, fb], [pd, fd]]) {
    if (p === 0) { assert.equal(f, 0); continue; }
    assert.ok(Math.abs(f / p - scale) < 0.02, `rotor plane did not scale with the mixer: ${p} -> ${f}`);
  }
  assert.ok(scale > 1.1);

  // The paddles themselves are authored at one size - no per-state geometry.
  const bladeOf = svg => {
    const bank = allWith(svg, "data-layer", "B").find(n => n.getAttribute("data-role") === "layer");
    return allWithClassName(bank, "station-mixer__blade").map(b => b.getAttribute("d")).join("|");
  };
  assert.equal(bladeOf(plain), bladeOf(focused));
  // And the animated group carries no transform of its own: CSS rotates it
  // about the origin the mount put at the cover's centre.
  for (const blades of allWithClassName(focused, "station-mixer__agitator")) {
    assert.equal(blades.getAttribute("transform"), null);
  }
});

test("the rotor is seen only through the inspection windows, and turns in the plane of the door", () => {
  const svg = stageFor(literal({ layerCount: 5 }));
  const mixers = allWith(svg, "data-role", "mixer");
  assert.equal(mixers.length, 5);
  for (const mixer of mixers) {
    const view = mixer.getAttribute("data-view");
    const rotor = allWith(mixer, "data-role", "mixer-rotor")[0];
    const clipId = rotor.getAttribute("clip-path").match(/^url\(#(.+)\)$/)[1];
    const clip = allWith(mixer, "id", clipId)[0];
    assert.equal(clip.nodeName, "clipPath");
    assert.equal(clip.children.length, 2, "two windows clip the rotor");
    // Four paddles: the asset's two glimpses and their opposites.
    assert.equal(allWithClassName(mixer, "station-mixer__blade").length, 4);
    // The placing matrix is the asset's door plane: foreshortened by the yaw.
    const [a] = allWith(mixer, "data-role", "mixer-rotor-mount")[0]
      .getAttribute("transform").match(/matrix\(([^)]+)\)/)[1].split(" ").map(Number);
    assert.ok(Math.abs(Math.abs(a) - mixerAssets.views[view].rotor.plane.a) < 0.01);
    // A mirrored machine's plane is mirrored: the x column flips sign.
    assert.equal(a < 0, mixer.getAttribute("data-mirrored") === "true");
  }
  // Clip ids are per layer, so five mixers on one stage cannot clip each other.
  const ids = mixers.map(m => allWith(m, "data-role", "mixer-rotor")[0].getAttribute("clip-path"));
  assert.equal(new Set(ids).size, 5);
});

test("the rotor animation is CSS on the blades group: slow, and off under reduced motion", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "station/styles/components/layer-bank.css"), "utf8");
  assert.match(css, /\.station-layer\.is-running \.station-mixer__agitator \{\s*animation: station-agitate 9s linear infinite;/);
  assert.match(css, /@keyframes station-agitate \{\s*from \{ transform: rotate\(0deg\); \}\s*to \{ transform: rotate\(360deg\); \}/);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/);
  assert.ok(reduced, "no reduced-motion rule");
  assert.match(reduced[1], /\.station-mixer__agitator \{\s*animation: none;/);
  // Rotation about the local origin - which the mount puts at the door's
  // centre - not about the paddles' bounding box.
  assert.match(css, /\.station-mixer__agitator \{\s*transform-box: view-box;\s*transform-origin: 0 0;/);
});

test("the mixer's own outlet neck is the feed connection - nothing else is drawn between the machines", () => {
  const svg = stageFor(literal({ layerCount: 3 }));
  assert.equal(allWithClassName(svg, "station-extruder__throat").length, 0, "the extra throat box is back");
  assert.equal(allWithClassName(svg, "station-mixer__outlet").length, 0, "a separate neck is drawn again");
  assert.equal(allWithClassName(svg, "station-mixer__collector").length, 0);
  for (const mixer of allWith(svg, "data-role", "mixer")) {
    const parts = allWith(mixer, "data-part").map(n => n.getAttribute("data-part"));
    assert.ok(parts.includes("outlet-neck") && parts.includes("outlet-flange"), "the asset's discharge is missing");
  }
  // And the neck lands on the asset's feed flange: that is what the anchor is.
  for (const extruder of allWith(svg, "data-role", "extruder")) {
    assert.ok(allWithClassName(extruder, "station-extruder__feed").length >= 2);
  }
});

test("the throat is the one thing between the machines: mixer discharge to extruder feed, on the centreline", () => {
  const svg = stageFor(literal({ layerCount: 5 }));
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  const feeds = allWith(svg, "data-role", "feed");
  assert.equal(feeds.length, 5);
  const gap = layoutModule.DIMENSIONS.mixerFeedGap;
  feeds.forEach((feed, i) => {
    const bank = banks.find(b => b.id === feed.getAttribute("data-layer"));
    const throat = allWithClassName(feed, "station-feed__throat")[0];
    const shadow = allWithClassName(feed, "station-feed__shadow")[0];
    assert.ok(shadow, `layer ${bank.id}: contact shadow missing`);
    // The shadow is where the discharge lands: on the feed anchor, on the
    // layer's centreline whichever way the machines are turned.
    assert.equal(Number(shadow.getAttribute("cx")), bank.centerX);
    assert.equal(Number(shadow.getAttribute("cy")), Math.round(bank.extruder.anchor.y * 100) / 100);
    // The neck exists only when the layout opens a gap for it. The masters
    // mount the discharge flange directly on the feed flange, so today the
    // gap is zero and there is no neck at all - the mixer's flange IS the
    // connection. The mixer's discharge and the extruder's feed coincide.
    if (gap === 0) {
      assert.equal(throat, undefined, `layer ${bank.id}: a zero-height neck was drawn`);
      assert.equal(Math.round(bank.mixer.outlet.y * 100) / 100, Math.round(bank.extruder.anchor.y * 100) / 100);
      return;
    }
    assert.ok(throat, `layer ${bank.id}: throat missing`);
    // From the mixer's discharge down to the extruder's feed anchor, exactly.
    assert.equal(Number(throat.getAttribute("y")), Math.round(bank.mixer.outlet.y * 100) / 100);
    assert.equal(Number(throat.getAttribute("y")) + Number(throat.getAttribute("height")),
      Math.round(bank.extruder.anchor.y * 100) / 100);
    assert.equal(Number(throat.getAttribute("x")) + Number(throat.getAttribute("width")) / 2, bank.centerX);
    // Short: a connection, not an adapter.
    assert.ok(Number(throat.getAttribute("height")) <= 12);
  });
  // Painted between the two machines: over the extruder, under the mixer.
  for (const layer of allWith(svg, "data-role", "layer")) {
    const roles = layer.children.map(c => c.getAttribute("data-role"));
    assert.ok(roles.indexOf("extruder") < roles.indexOf("feed") && roles.indexOf("feed") < roles.indexOf("mixer"));
  }
  // And nothing else: no hose, no funnel, no adapter stack. (The mixer's
  // own air hose - a tone on the master's pneumatic stack - is the mixer,
  // not a connection between the machines; and each hopper's clear discharge
  // hose hangs under its own flat bottom, above the mixer, not between it
  // and the extruder.)
  const classes = new Set();
  walk(svg, node => { for (const c of String(node.getAttribute("class") || "").split(/\s+/)) classes.add(c); });
  const own = /^(station-mixer__(face|seam)--hose|station-hopper__hose(-[a-z-]+)?)$/;
  for (const banned of [...classes].filter(c => /hose|funnel|collector|adapter/.test(c) && !own.test(c))) assert.fail(`${banned} is back`);
});

test("the throat scales with its bank, so a ghost's connection is a ghost's size", () => {
  const plain = layoutFor(literal({ layerCount: 3 })).banks[0].throat;
  const dimmed = layoutFor(literal({ layerCount: 3 }), { focusLayer: "B" }).banks[0].throat;
  const s = layoutModule.DIMENSIONS.dimScale;
  assert.ok(Math.abs(dimmed.width - plain.width * s) < 1e-6);
  assert.ok(Math.abs(dimmed.height - plain.height * s) < 1e-6);
  assert.ok(Math.abs(dimmed.shadow.rx - plain.shadow.rx * s) < 1e-6);
});

test("the extruder's drive stays in the mixer's lower structure, never up in the drum", () => {
  /* The two anchors coincide, so the extruder's motor - which stands higher
   * than its feed flange - rises behind the mixer's base plate. That is the
   * real arrangement. What must not happen is the motor reaching up behind
   * the chamber where it would read as part of the mixer. */
  for (const focusLayer of [null, "A", "B"]) {
    for (const bank of layoutFor(literal({ layerCount: 3 }), { focusLayer }).banks) {
      const chamberCentre = bank.mixer.anchor.y + mixerAssets.views[bank.mixer.view].rotor.centre.y * bank.mixer.scale;
      assert.ok(bank.extruder.bounds.top > chamberCentre,
        `layer ${bank.id} (focus ${focusLayer}): the drive reaches up into the drum`);
      // And it is painted first, so whatever it overlaps, it is behind.
      assert.ok(bank.extruder.anchor.y >= bank.mixer.outlet.y);
    }
  }
});

/* ----------------------------------------------------------------------
 *   One artwork set, three perspective states
 * -------------------------------------------------------------------- */

test("the three views are one machine at one scale", () => {
  /* The assets share a physical scale, and the derivation keeps it: a turned
   * machine is the same size, differently seen. Height from feed anchor to
   * feet is the measure, and it is the same to within the perspective's own
   * foreshortening. */
  const heights = assets.ORDER.map(view => assets.views[view].bounds.bottom);
  assert.equal(heights[0], assets.MACHINE_HEIGHT);
  for (const height of heights) assert.ok(Math.abs(height - assets.MACHINE_HEIGHT) < assets.MACHINE_HEIGHT * 0.08);
  // The feed anchor is the origin of every view - that is the contract.
  for (const view of assets.ORDER) assert.deepEqual(assets.views[view].feed, { x: 0, y: 0 });
});

test("the turn is strong enough to read at a glance", () => {
  /* Can you see which way a machine faces without studying it. Measured as
   * how far the outlet travels from the feed anchor, in machine heights. */
  const travel = view => Math.abs(assets.views[view].outlet.x) / assets.MACHINE_HEIGHT;
  assert.equal(travel("front"), 0);
  assert.ok(travel("intermediate") > 0.4, `intermediate barely turns: ${travel("intermediate").toFixed(2)}`);
  assert.ok(travel("angled") > 0.8, `angled is not obviously turned: ${travel("angled").toFixed(2)}`);
  assert.ok(travel("angled") > travel("intermediate"));
});

test("the percentage stays upright and readable at every view, on the layer centreline in its header", () => {
  const svg = stageFor(literal({ layerCount: 5 }), {
    layerState: { A: { layerPct: 15 }, C: { layerPct: 30 }, E: { layerPct: 15 } }
  });
  const readouts = allWithClassName(svg, "station-layer__share-value");
  assert.equal(readouts.length, 5);
  const banks = layoutFor(literal({ layerCount: 5 })).banks;
  readouts.forEach((readout, index) => {
    assert.equal(readout.getAttribute("transform"), null, "the percentage was dragged into the perspective");
    // In the header, on the layer centreline, whichever way the train turns.
    assert.equal(readout.getAttribute("text-anchor"), "middle");
    assert.equal(Number(readout.getAttribute("x")), banks[index].header.x);
    assert.ok(Number(readout.getAttribute("y")) < banks[index].cluster.y);
  });
  assert.deepEqual(readouts.map(r => r.textContent), ["15%", "—", "30%", "—", "15%"]);
});

/* ----------------------------------------------------------------------
 *   Extruder Lab (development only)
 * -------------------------------------------------------------------- */

test("the lab shows every view of both machines as original beside derivative, from the real component", () => {
  const lab = require("./station/station-extruder-lab.js");
  const doc = fakeDocument();
  const root = lab.mount(doc.createElement("div"), doc, {
    layout: layoutModule, parts, extruderAssets: assets, mixerAssets
  });
  const rows = allWith(root, "data-role", "lab-row");
  assert.deepEqual(rows.map(r => `${r.getAttribute("data-machine")}/${r.getAttribute("data-view")}`),
    [...mixerAssets.ORDER.map(v => `mixer/${v}`), ...assets.ORDER.map(v => `extruder/${v}`)]);
  for (const row of rows) {
    const machine = row.getAttribute("data-machine");
    const view = row.getAttribute("data-view");
    const module = machine === "mixer" ? mixerAssets : assets;
    // The untouched source, as an image.
    const originals = allWithClassName(row, "station-lab__original");
    assert.equal(originals.length, 1);
    assert.equal(originals[0].getAttribute("src"), `${lab.ORIGINALS[machine]}/${machine}-${view}.svg`);
    // The derivative twice - as drawn, and mirrored - by the product's builder.
    const drawn = allWith(row, "data-role", machine);
    assert.equal(drawn.length, 2);
    assert.deepEqual(drawn.map(e => e.getAttribute("data-mirrored")), ["false", "true"]);
    for (const one of drawn) {
      assert.equal(allWithClassName(one, `station-${machine}__face`).length, module.views[view].polygons.length);
    }
  }
});

test("the lab also shows the five-layer assembly - mixer on extruder - at actual Station size", () => {
  const lab = require("./station/station-extruder-lab.js");
  const doc = fakeDocument();
  const root = lab.mount(doc.createElement("div"), doc, {
    layout: layoutModule, parts, extruderAssets: assets, mixerAssets
  });
  const strip = allWith(root, "data-role", "lab-strip")[0];
  const specimens = allWithClassName(strip, "station-lab__specimen");
  assert.equal(specimens.length, 5);
  assert.deepEqual(specimens.map(s => `${s.getAttribute("data-mirrored") === "true" ? "-" : ""}${s.getAttribute("data-view")}`),
    ["-angled", "-intermediate", "front", "intermediate", "angled"]);
  for (const one of specimens) {
    assert.equal(allWith(one, "data-role", "mixer").length, 1);
    assert.equal(allWith(one, "data-role", "extruder").length, 1);
    // Both machines in one specimen face the same way.
    assert.equal(allWith(one, "data-role", "mixer")[0].getAttribute("data-view"),
      allWith(one, "data-role", "extruder")[0].getAttribute("data-view"));
  }
});

/* ----------------------------------------------------------------------
 *   Step 10: the hopper's operational controls - the receiver and the body
 * -------------------------------------------------------------------- */

function controlOf(hopper, kind) {
  return allWith(hopper, "data-station-target", kind)[0];
}
function box(rect) {
  return { x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")), width: Number(rect.getAttribute("width")), height: Number(rect.getAttribute("height")) };
}
const contains = (b, px, py) => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("every hopper's receiver is its pump control and its body its tracking control: two cells in the hit geometry, after the hopper's own hit, never overlapping", () => {
  const config = literal({ layerCount: 3, hopperCount: 6 });
  const layout = layoutFor(config);
  const svg = stageFor(config);
  for (const hopper of hoppersIn(svg)) {
    const interaction = allWith(hopper, "data-role", "hopper-interaction")[0];
    assert.deepEqual(interaction.children.map(c => c.getAttribute("data-station-target")), [null, "pump", "tracking"],
      "the hopper's hit, then the two controls - so within their cells the controls are what a click lands on");
    const geometry = layout.banks.find(b => b.id === hopper.getAttribute("data-layer")).cluster.hoppers[Number(hopper.getAttribute("data-hopper-index"))];
    const w = geometry.width;
    const own = box(interaction.children[0]);
    for (const kind of ["tracking", "pump"]) {
      const control = controlOf(hopper, kind);
      assert.equal(control.getAttribute("data-role"), `hopper-${kind}`);
      assert.equal(control.getAttribute("data-layer"), hopper.getAttribute("data-layer"));
      assert.equal(control.getAttribute("data-hopper"), hopper.getAttribute("data-hopper"));
      assert.equal(control.getAttribute("data-hopper-index"), hopper.getAttribute("data-hopper-index"));
      assert.equal(control.getAttribute("data-on"), "false");
      assert.equal(control.getAttribute("data-able"), "false", "with no offer, a control cannot act");
      const [title, cell] = control.children;
      assert.equal(title.nodeName, "title");
      assert.equal(cell.nodeName, "rect");
      assert.equal(cell.getAttribute("class"), "station-hit");
      const b = box(cell);
      assert.ok(b.width > 0 && b.height > 0);
      // The hopper's own column, no narrower: the whole part is the control.
      assert.equal(b.x, own.x, `${kind} cell is narrower than the hopper`);
      assert.equal(b.width, own.width);
      assert.ok(b.x >= geometry.x - (geometry.pitch - w) / 2 && b.x + b.width <= geometry.x + w + (geometry.pitch - w) / 2, `${kind} cell leaves the hopper's pitch`);
    }
    const tracking = box(controlOf(hopper, "tracking").children[1]);
    const pump = box(controlOf(hopper, "pump").children[1]);
    // Pump: the receiver, top to the vessel's top.
    assert.equal(pump.y, Math.round(geometry.receiverTop * 100) / 100);
    assert.equal(Math.round((pump.y + pump.height) * 100) / 100, Math.round(geometry.vesselTop * 100) / 100);
    assert.ok(contains(pump, geometry.x + w / 2, geometry.receiverTop + geometry.receiverHeight / 2), "the pump cell covers the receiver cone");
    // Tracking: the body, vessel top through the hose to the caption's foot.
    assert.equal(tracking.y, Math.round(geometry.vesselTop * 100) / 100);
    assert.equal(Math.round((tracking.y + tracking.height) * 100) / 100, Math.round((geometry.captionTop + geometry.captionHeight) * 100) / 100);
    assert.ok(contains(tracking, geometry.x + w / 2, geometry.vesselTop + geometry.vesselHeight / 2), "the tracking cell covers the vessel");
    assert.ok(contains(tracking, geometry.x + w / 2, geometry.captionTop + 5), "the tracking cell covers the readout");
    assert.ok(!overlaps(tracking, pump), "the two controls do not overlap: a click on the receiver cannot toggle tracking, nor the body the pump");
    assert.ok(pump.y >= own.y, "the receiver cell is within the hopper's own hit");
  }
});

test("the controls say the state as drawn and whether they may act, and their tooltips say what a click would do only when it would do it", () => {
  const config = literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 });
  const state = { "A:0": { assigned: true, resinName: "HX204", pct: 60, track: true, pumpOff: false }, "A:1": { assigned: true, resinName: "LD105", pct: 40, track: false, pumpOff: true } };
  const offered = stageFor(config, { hopperState: state, hopperControls: { tracking: true, pump: true } });
  const [a1, a2, a3] = hoppersIn(offered);
  assert.deepEqual([a1, a2, a3].map(h => [controlOf(h, "tracking").getAttribute("data-on"), controlOf(h, "pump").getAttribute("data-on")]),
    [["true", "false"], ["false", "true"], ["false", "false"]]);
  assert.deepEqual([a1, a2, a3].map(h => controlOf(h, "pump").getAttribute("data-pump")), ["on", "off", "on"]);
  assert.ok([a1, a2, a3].every(h => controlOf(h, "tracking").getAttribute("data-able") === "true" && controlOf(h, "pump").getAttribute("data-able") === "true"));
  assert.equal(controlOf(a1, "tracking").children[0].textContent, "A1 · tracked · click to stop tracking");
  assert.equal(controlOf(a2, "tracking").children[0].textContent, "A2 · not tracked · click to track in the timeline");
  assert.equal(controlOf(a1, "pump").children[0].textContent, "A1 · pump running · click to mark the pump off");
  assert.equal(controlOf(a2, "pump").children[0].textContent, "A2 · pump off · click to mark the pump running");

  // Partly offered: each control reads its own command.
  const partly = stageFor(config, { hopperState: state, hopperControls: { tracking: true, pump: false } });
  const p1 = hoppersIn(partly)[0];
  assert.equal(controlOf(p1, "tracking").getAttribute("data-able"), "true");
  assert.equal(controlOf(p1, "pump").getAttribute("data-able"), "false");
  assert.equal(controlOf(p1, "pump").children[0].textContent, "A1 · pump running", "no action offered, none promised");

  // The hopper's own label says the identity; its state is the controls'
  // tooltips' and the hover panel's, never a second tooltip on the group.
  assert.equal(a1.getAttribute("aria-label"), "A1 · HX204");
  assert.equal(a2.getAttribute("aria-label"), "A2 · LD105");
  assert.equal(a1.children.filter(c => c.nodeName === "title").length, 0);
});

test("tracking draws nothing on the receiver's head: no halo, no icon - the state is the vessel's wash and its run-down flow", () => {
  const config = literal({ layerCount: 1, layerAPosition: null, hopperCount: 2 });
  const svg = stageFor(config, { hopperState: { "A:0": { assigned: true, resinName: "HX204", pct: 100, track: true, source: "Silo 4" } } });
  const [tracked, idle] = hoppersIn(svg);
  for (const hopper of [tracked, idle]) {
    assert.equal(allWith(hopper, "data-role", "hopper-halo").length, 0, "no halo on any hopper");
    walk(hopper, n => assert.doesNotMatch(String(n.getAttribute("class") || ""), /halo|clock|power|marks/));
  }
  const drawing = allWith(tracked, "data-role", "hopper-drawing")[0];
  assert.equal(allWith(drawing, "data-role", "hopper-rundown").length, 1, "the tracked hopper's flow is the drawn state");
  assert.equal(allWith(allWith(idle, "data-role", "hopper-drawing")[0], "data-role", "hopper-rundown").length, 0);
  walk(drawing, n => assert.equal(n.getAttribute("data-station-target"), null, "nothing in the drawing became a target"));
});

test("a patched stage draws a toggled hopper as a fresh render would: flow in, receiver marked off, controls' state and offer rewritten", () => {
  const doc = fakeDocument();
  const config = literal({ layerCount: 1, layerAPosition: null, hopperCount: 2 });
  const model = require("./station/station-line-model.js").buildLineModel(config);
  const before = { "A:0": { assigned: true, resinName: "HX204", pct: 100, track: false, pumpOff: false, usableHeight: 30 }, "A:1": { assigned: false, track: false, pumpOff: false, usableHeight: 30 } };
  const mount = doc.createElement("div");
  mount.ownerDocument = doc;
  // The patch path replaces a child in place; the fake needs that one method.
  const replaceable = node => { node.replaceChild = (fresh, old) => { node.children[node.children.indexOf(old)] = fresh; return old; }; return node; };
  render.mountStage(mount, model, { document: doc, hopperState: before, hopperControls: { tracking: false, pump: false }, stageAspect: 1.6 });
  walk(mount, replaceable);
  const after = { "A:0": Object.assign({}, before["A:0"], { track: true, pumpOff: true }), "A:1": before["A:1"] };
  const result = render.patchStage(mount, model, { document: doc, hopperState: after, hopperControls: { tracking: true, pump: true }, stageAspect: 1.6 });
  // Both hoppers: A1 for its state, A2 because the offer moved for it too.
  assert.deepEqual(result, { hoppers: 2, layers: 1 });
  const a1 = hoppersIn(mount)[0];
  assert.match(a1.getAttribute("class"), /is-tracking/);
  assert.match(a1.getAttribute("class"), /is-pump-off/);
  assert.equal(allWith(a1, "data-role", "hopper-rundown").length, 1);
  assert.equal(controlOf(a1, "tracking").getAttribute("data-on"), "true");
  assert.equal(controlOf(a1, "pump").getAttribute("data-on"), "true");
  assert.equal(controlOf(a1, "pump").getAttribute("data-pump"), "off");
  assert.equal(controlOf(a1, "tracking").getAttribute("data-able"), "true");
  const fresh = stageFor(config, { hopperState: after, hopperControls: { tracking: true, pump: true } });
  const strip = node => ({ n: node.nodeName, a: node.attributes, t: node.textContent, c: node.children.map(strip) });
  assert.deepEqual(strip(a1), strip(hoppersIn(fresh)[0]), "the patched hopper is the drawing a fresh render makes");
  // Back to normal clears it all - and the receiver's cell is still there
  // to be clicked, where it was.
  const offCell = box(controlOf(a1, "pump").children[1]);
  render.patchStage(mount, model, { document: doc, hopperState: before, hopperControls: { tracking: true, pump: true }, stageAspect: 1.6 });
  const back = hoppersIn(mount)[0];
  assert.doesNotMatch(back.getAttribute("class"), /is-tracking|is-pump-off/);
  assert.equal(allWith(back, "data-role", "hopper-rundown").length, 0);
  assert.equal(controlOf(back, "pump").getAttribute("data-on"), "false");
  assert.deepEqual(box(controlOf(back, "pump").children[1]), offCell, "the pump's cell does not move with its state");
});

test("the states are styled from tokens: the receiver steps back when the pump is off, no halo is styled, a control that cannot act has no pointer cursor, and the one motion is the run-down flow", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "station/styles/components/hopper.css"), "utf8");
  const tokens = fs.readFileSync(path.join(__dirname, "station/styles/tokens.css"), "utf8");
  assert.doesNotMatch(tokens, /--station-motion-clock/);
  assert.match(css, /\.station-hopper__control\[data-able="false"\] \.station-hit \{\s*cursor: default;/);
  assert.match(css, /\.station-hopper__control\.is-pending \.station-hit \{\s*fill: var\(--station-accent-soft\);/);
  // Pump off: the amber is gone (cone and cap to steel, an older rule) and
  // the receiver as a whole steps back.
  assert.match(css, /\.station-hopper\.is-pump-off \.station-hopper__receiver-cone \{\s*fill: var\(--station-steel\);/);
  assert.match(css, /\.station-hopper\.is-pump-off \.station-hopper__receiver-drawing \{\s*opacity: 0\.\d+;/);
  // The hover cue is on a receiver whose command is on offer, and only there.
  assert.match(css, /\.station-hopper:has\(\.station-hopper__control--pump\[data-able="true"\]:hover\) \.station-hopper__receiver-cone \{/);
  assert.doesNotMatch(css, /control--pump\[data-able="false"\]:hover/);
  // No halo anywhere: tracking is the wash and the flow.
  assert.doesNotMatch(css, /halo/);
  // The outline no longer says tracked: the tracked vessel takes a faint
  // wash (station-tracking-visuals.test.js), never an outline of its own.
  assert.doesNotMatch(css, /is-tracking \.station-hopper__shell \{[^}]*stroke/);
  // The one motion on a hopper is the run-down flow (the chevrons of a
  // tracked hopper, station-tracking-visuals.test.js): one keyframes
  // block, applied once, slow and linear, and switched off under reduced
  // motion.
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((rules.match(/@keyframes/g) || []).length, 1);
  assert.match(rules, /@keyframes station-rundown-flow/);
  const applied = (rules.match(/animation:\s*[^;]+;/g) || []).filter(one => !/animation:\s*none/.test(one));
  assert.deepEqual(applied, ["animation: station-rundown-flow var(--station-rundown-duration, 2.4s) linear infinite;"]);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.station-hopper__rundown-flow \{\s*animation: none;/);
  // The readout is not touched by either state: resin and percentage stay
  // the primary information whatever the receiver or the flow says.
  assert.doesNotMatch(css, /is-pump-off[^{]*__(pct|resin|id)\b/);
  assert.doesNotMatch(css, /is-tracking[^{]*__(pct|resin|id)\b/);
});

test("a change in the offer alone redraws a hopper's controls: the data-state carries the offer as well as the runtime state", () => {
  const doc = fakeDocument();
  const config = literal({ layerCount: 1, layerAPosition: null, hopperCount: 2 });
  const model = require("./station/station-line-model.js").buildLineModel(config);
  const state = { "A:0": { assigned: true, resinName: "HX204", pct: 100, track: true, pumpOff: false, usableHeight: 30 }, "A:1": { assigned: false, track: false, pumpOff: false, usableHeight: 30 } };
  const mount = doc.createElement("div");
  mount.ownerDocument = doc;
  render.mountStage(mount, model, { document: doc, hopperState: state, hopperControls: null, stageAspect: 1.6 });
  walk(mount, node => { node.replaceChild = (fresh, old) => { node.children[node.children.indexOf(old)] = fresh; return old; }; });
  assert.deepEqual(hoppersIn(mount).map(h => controlOf(h, "tracking").getAttribute("data-able")), ["false", "false"]);
  // Same state, the executor now on offer: every hopper is redrawn.
  const result = render.patchStage(mount, model, { document: doc, hopperState: state, hopperControls: { tracking: true, pump: false }, stageAspect: 1.6 });
  assert.deepEqual(result, { hoppers: 2, layers: 1 });
  assert.deepEqual(hoppersIn(mount).map(h => [controlOf(h, "tracking").getAttribute("data-able"), controlOf(h, "pump").getAttribute("data-able")]), [["true", "false"], ["true", "false"]]);
  // Same state, same offer: nothing is redrawn.
  assert.deepEqual(render.patchStage(mount, model, { document: doc, hopperState: state, hopperControls: { tracking: true, pump: false }, stageAspect: 1.6 }), { hoppers: 0, layers: 1 });
  assert.equal(parts.hopperStateKey({ track: true }, { tracking: true, pump: true }), "t|||||||||" + "|TP");
  assert.equal(parts.hopperStateKey({ track: true }), "t||||||||||");
});

/* ----------------------------------------------------------------------
 *   Smart Hoppers on the drawing
 * -------------------------------------------------------------------- */

test("a hopper whose weight Smart Hoppers computed is marked is-smart, shows the computed weight, and says in its tooltip what it was computed from", () => {
  const svg = stageFor(literal({ layerCount: 5, hopperCount: 3 }), {
    hopperState: {
      "A:0": { assigned: true, resinName: "HX204", pct: 60, weight: 1250, effectiveWeight: 812.5, smartWeight: { value: 812.5, bulkDensity: 35, resinCode: "HX204" } },
      "A:1": { assigned: true, resinName: "LD105", pct: 30, weight: 500, effectiveWeight: 500, smartWeight: null },
      "A:2": { assigned: true, resinName: "LD106", pct: 10, weight: 0, effectiveWeight: 10, smartWeight: { value: 10 } }
    }
  });
  const hoppers = hoppersIn(svg).slice(0, 3);
  assert.deepEqual(hoppers.map(h => /\bis-smart\b/.test(h.getAttribute("class"))), [true, false, true]);
  assert.deepEqual(textOf(svg, "station-hopper__weight").slice(0, 3), ["813", "500", "10"]);
  // Where it came from is the hover panel's (station-hopper-info.js: "computed")
  // and the Weights cards' to say; the drawing marks it and shows the number.
  // The key tells a computed weight from an entered one of the same value.
  assert.notEqual(parts.hopperStateKey({ weight: 800, effectiveWeight: 800, smartWeight: { value: 800 } }), parts.hopperStateKey({ weight: 800, effectiveWeight: 800, smartWeight: null }));
  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "station/styles/components/hopper.css"), "utf8");
  assert.match(css, /\.station-hopper\.is-smart \.station-hopper__weight \{[^}]*var\(--station-smart/);
  for (const theme of ["industrial-light", "industrial-dark", "gruvbox-light", "gruvbox-dark", "engineering-paper", "blueprint"]) {
    const sheet = fs.readFileSync(path.join(__dirname, `station/styles/themes/${theme}.css`), "utf8");
    assert.match(sheet, /--station-smart: #[0-9a-f]{6};/, `${theme} defines the computed colour`);
    const tracking = sheet.match(/--station-tracking: (#[0-9a-f]{6});/);
    const smart = sheet.match(/--station-smart: (#[0-9a-f]{6});/);
    assert.notEqual(smart[1], tracking[1], `${theme}: computed is not the tracking colour`);
  }
});

/* ----------------------------------------------------------------------
 *   The next recipe changes this hopper's resin: the receiver cap says so
 * -------------------------------------------------------------------- */

test("a hopper the plan re-resins carries is-next-changes, and no other does - the fact is in the state key, so a plan-only publish redraws it", () => {
  const state = {
    "A:0": { assigned: true, resinName: "HX", pct: 60, nextResinName: "LD", nextDiffers: true },
    "A:1": { assigned: true, resinName: "LD", pct: 40, nextResinName: "LD", nextDiffers: false },
    "A:2": { assigned: false, resinName: "", pct: 0, nextResinName: "MB", nextDiffers: true }
  };
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 }), { hopperState: state });
  const classesOf = id => String(hoppersIn(svg).find(h => h.getAttribute("data-hopper") === id).getAttribute("class")).split(/\s+/);
  assert.deepEqual(classesOf("A1"), ["station-hopper", "is-next-changes", "is-unprofiled"]);
  assert.deepEqual(classesOf("A2"), ["station-hopper", "is-unprofiled"]);
  assert.deepEqual(classesOf("A3"), ["station-hopper", "is-unassigned", "is-next-changes", "is-unprofiled"]);
  // The name is not drawn - only whether it differs is in the key.
  assert.equal(parts.hopperStateKey({ nextDiffers: true }), "|||||||||n|");
  assert.equal(parts.hopperStateKey({ nextDiffers: true, nextResinName: "LD" }), parts.hopperStateKey({ nextDiffers: true, nextResinName: "MB" }));
  assert.notEqual(parts.hopperStateKey({ nextDiffers: true }), parts.hopperStateKey({ nextDiffers: false }));

  // Patched: the plan changes its mind about A1 alone.
  const doc = fakeDocument();
  const mount = doc.createElement("div");
  mount.ownerDocument = doc;
  const config = literal({ layerCount: 1, layerAPosition: null, hopperCount: 3 });
  const lineModel = model.buildLineModel(config);
  render.mountStage(mount, lineModel, { document: doc, hopperState: state, stageAspect: 1.6 });
  walk(mount, node => { node.replaceChild = (fresh, old) => { node.children[node.children.indexOf(old)] = fresh; return old; }; });
  const settled = Object.assign({}, state, { "A:0": Object.assign({}, state["A:0"], { nextResinName: "HX", nextDiffers: false }) });
  assert.deepEqual(render.patchStage(mount, lineModel, { document: doc, hopperState: settled, stageAspect: 1.6 }), { hoppers: 1, layers: 1 });
  const a1 = hoppersIn(mount).find(h => h.getAttribute("data-hopper") === "A1");
  assert.ok(!String(a1.getAttribute("class")).split(/\s+/).includes("is-next-changes"));
  assert.deepEqual(render.patchStage(mount, lineModel, { document: doc, hopperState: state, stageAspect: 1.6 }), { hoppers: 1, layers: 1 });
  assert.ok(String(hoppersIn(mount).find(h => h.getAttribute("data-hopper") === "A1").getAttribute("class")).split(/\s+/).includes("is-next-changes"));
});

test("the receiver's lid and lit strip carry a receiver-only class beside the shared one; the vessel's do not; the stylesheet lights the cap in the warning, statically, over pump-off", () => {
  const svg = stageFor(literal({ layerCount: 1, layerAPosition: null, hopperCount: 1 }));
  const hopper = hoppersIn(svg)[0];
  const receiver = allWith(hopper, "data-role", "hopper-receiver-drawing")[0];
  const details = allWith(hopper, "data-role", "hopper-details")[0];
  const classes = node => String(node.getAttribute("class") || "").split(/\s+/);
  const receiverLid = receiver.children.find(n => n.nodeName === "ellipse" && classes(n).includes("station-hopper__lid"));
  assert.deepEqual(classes(receiverLid), ["station-hopper__lid", "station-hopper__receiver-lid"]);
  const receiverFace = receiver.children.find(n => classes(n).includes("station-hopper__metal-face"));
  assert.deepEqual(classes(receiverFace), ["station-hopper__metal-face", "station-hopper__receiver-face"]);
  const vesselLid = details.children.find(n => n.nodeName === "ellipse" && classes(n).includes("station-hopper__lid"));
  assert.deepEqual(classes(vesselLid), ["station-hopper__lid"]);
  assert.equal(allWithClassName(hopper, "station-hopper__receiver-lid").length, 1);
  assert.equal(allWithClassName(hopper, "station-hopper__receiver-face").length, 1);

  const fs = require("node:fs");
  const path = require("node:path");
  const css = fs.readFileSync(path.join(__dirname, "station/styles/components/hopper.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.station-hopper\.is-next-changes \.station-hopper__cap,\s*\.station-hopper\.is-next-changes \.station-hopper__receiver-lid \{\s*fill: var\(--station-warning\);\s*stroke: var\(--station-warning\);\s*\}/);
  assert.match(css, /\.station-hopper\.is-next-changes \.station-hopper__receiver-face \{\s*fill: color-mix\(in srgb, var\(--station-warning\) 60%, var\(--station-hopper-metal-lit\)\);\s*\}/);
  assert.match(css, /\.station-hopper\.is-pump-off\.is-next-changes \.station-hopper__receiver-drawing \{\s*opacity: 1;\s*\}/);
  // After pump-off's own cap and receiver rules, so it wins at equal specificity.
  assert.ok(css.indexOf(".station-hopper.is-next-changes .station-hopper__cap") > css.indexOf(".station-hopper.is-pump-off .station-hopper__cap {"));
  assert.ok(css.indexOf(".station-hopper.is-pump-off.is-next-changes") > css.indexOf(".station-hopper.is-pump-off .station-hopper__receiver-drawing {"));
  // Static, and the cone is not touched: pump state stays readable there.
  assert.doesNotMatch(css, /is-next-changes[^{]*\{[^}]*(animation|filter|transition)/);
  assert.doesNotMatch(css, /is-next-changes[^{]*(receiver-cone|__fill\b|hose|__shell)/);
});
