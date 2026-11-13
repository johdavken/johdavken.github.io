"use strict";

/* recipe-scan-ui.js's presenter seam: a host that draws the scan in its own
 * clothes (Slate's scan sheet) registers a presenter, and the flow hands it
 * every step instead of opening the three dialogs in index.html. The
 * capture, upload, mapping and apply are the flow's, unchanged - these
 * tests run the module itself in a context with a stubbed bridge, network
 * and dialogs, and drive it the way the sheet does. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "recipe-scan-ui.js"), "utf8");

const SCANNED = {
  layer_percentage_total_status: "ok",
  layers: [
    { name: "A", component_percentage_total_status: "ok" },
    { name: "B", component_percentage_total_status: "over" }
  ]
};
function payload() {
  return {
    layers: [
      { name: "A", layer_pct: 30, hoppers: [{ resin_name: "LL1001", pct: 80 }, { resin_name: "MB12", pct: 20 }] },
      { name: "B", layer_pct: 0, layer_pct_estimated: true, hoppers: [{ resin_name: "", pct: 0 }, { resin_name: "SLIP", pct: 0, percentage_estimated: true }] }
    ]
  };
}

/* The module in a context of its own: a bridge, dialogs that record what
 * is asked of them, a network that answers with a scan. */
function load(options) {
  const settings = options || {};
  const dialogs = new Map();
  const dialogCalls = [];
  function dialog(id) {
    if (!dialogs.has(id)) {
      dialogs.set(id, {
        id, hidden: false, textContent: "", value: "", returnValue: "",
        classList: { toggle() {} },
        addEventListener() {},
        showModal() { dialogCalls.push(["show", id]); },
        close() { dialogCalls.push(["close", id]); },
        replaceChildren() {}, append() {}, querySelectorAll: () => [], click() {}
      });
    }
    return dialogs.get(id);
  }
  const applied = [];
  const bridge = {
    getWorkspaceId: () => "ws-10",
    getLineType: () => settings.lineType || 3,
    getLineConfiguration: () => (settings.orientation === null ? null : { layerAPosition: settings.orientation || "inside" }),
    getHopperNamingMode: () => "numbers",
    getAccessToken: async () => "token",
    getRecipePageLabel: destination => (destination === "next" ? "Next Recipe" : "Current Recipe"),
    hasNonEmptyRecipe: () => true,
    applyPayload(built, lots, destination) {
      applied.push({ built: JSON.parse(JSON.stringify(built)), destination });
      return settings.refuse ? { ok: false, message: "The recipe could not be applied." } : { ok: true };
    }
  };
  const fetches = [];
  const context = {
    console: { error() {}, log() {} },
    alert() { throw new Error("alerted"); },
    FormData: class { constructor() { this.parts = []; } append(name, value) { this.parts.push([name, value]); } },
    navigator: { onLine: true },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { getElementById: dialog, addEventListener() {} },
    fetch: async (url, init) => {
      fetches.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { recipe: SCANNED } }) };
    },
    PolynRecipeScanBridge: bridge,
    POLYN_SUPABASE_CONFIG: { url: "https://example.supabase.co" },
    PolynRecipeScanMapping: {
      buildDosingScreenRecipePayloadFromScan: () => ({ ok: true, payload: payload(), lotByResin: {} }),
      buildRecipePayloadFromScan: () => ({ ok: true, payload: payload(), lotByResin: {} })
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);
  return { ui: context.PolynRecipeScanUI, dialogCalls, applied, fetches };
}

/* A presenter that writes down what it is handed. */
function recorder() {
  const calls = [];
  return {
    calls,
    presenter: {
      orientation() { calls.push(["orientation"]); },
      capture(step) { calls.push(["capture", JSON.parse(JSON.stringify(step))]); },
      status(step, message, error) { calls.push(["status", step, message, error]); },
      review(model) { calls.push(["review", JSON.parse(JSON.stringify(model))]); }
    },
    last(kind) { return calls.filter(one => one[0] === kind).pop() || null; }
  };
}

const PHOTO = { type: "image/jpeg", arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer };

test("a registered presenter is handed the capture step, and no dialog opens", () => {
  const { ui, dialogCalls } = load();
  const seen = recorder();
  const flow = ui.setPresenter(seen.presenter);
  assert.ok(flow && typeof flow.submitFile === "function");
  ui.startScan("dosing_screen", { destination: "next" });
  const capture = seen.last("capture");
  assert.deepEqual(capture[1], {
    kind: "dosing_screen",
    title: "Scan Dosing Screen",
    description: "Take a photo of the dosing controller's material overview screen, or choose an existing photo (screen photo or printout).",
    native: false
  });
  assert.deepEqual(dialogCalls, [], "a dialog opened behind the presenter");
});

test("a photo goes up through the flow's own request, and the review comes back as data - in the destination's words", async () => {
  const { ui, dialogCalls, fetches } = load();
  const seen = recorder();
  const flow = ui.setPresenter(seen.presenter);
  ui.startScan("job_traveler", { destination: "next" });
  const sent = flow.submitFile(PHOTO);
  assert.equal(flow.busy(), true, "the flow is not busy while it scans");
  assert.deepEqual(seen.last("status"), ["status", "capture", "Scanning…", false]);
  await sent;
  assert.equal(fetches.length, 1);
  assert.equal(fetches[0].url, "https://example.supabase.co/functions/v1/recipe-scan");
  const review = seen.last("review")[1];
  assert.equal(review.title, "Review Scanned Recipe — Next Recipe");
  assert.equal(review.applyLabel, "Apply to Next Recipe");
  assert.deepEqual(review.warnings, ["This will overwrite the next recipe assignments."]);
  assert.deepEqual(review.layers.map(layer => [layer.name, layer.pct, layer.pctState, layer.componentsOff]), [
    ["A", 30, "read", false],
    ["B", 0, "estimated", true]
  ]);
  assert.deepEqual(review.layers[0].hoppers, [
    { label: "H1", resin: "LL1001", pct: 80, state: "auto" },
    { label: "H2", resin: "MB12", pct: 20, state: "read" }
  ]);
  assert.deepEqual(review.layers[1].hoppers.map(hopper => hopper.state), ["missing", "estimated"]);
  assert.deepEqual(dialogCalls, []);
});

test("the typed layer percentage is what Apply writes, to the recipe the scan was started for", async () => {
  const { ui, applied } = load();
  const seen = recorder();
  const flow = ui.setPresenter(seen.presenter);
  ui.startScan("dosing_screen", { destination: "next" });
  await flow.submitFile(PHOTO);
  flow.setLayerPct(1, "70");
  flow.setLayerPct(0, "not a number");
  flow.setLayerPct(9, "50"); // no such layer: nothing
  assert.equal(flow.apply().ok, true);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].destination, "next");
  assert.deepEqual(applied[0].built.layers.map(layer => layer.layer_pct), [0, 70]);
  // Applied, the scan is spent: a second Apply writes nothing.
  assert.equal(flow.apply().ok, false);
  assert.equal(applied.length, 1);
});

test("a refused apply keeps the scan and says why through the review's status", async () => {
  const { ui, applied } = load({ refuse: true });
  const seen = recorder();
  const flow = ui.setPresenter(seen.presenter);
  ui.startScan("dosing_screen");
  await flow.submitFile(PHOTO);
  assert.equal(flow.apply().ok, false);
  assert.deepEqual(seen.last("status"), ["status", "review", "The recipe could not be applied.", true]);
  assert.equal(applied.length, 1);
  assert.equal(flow.apply().ok, false, "the kept scan was lost");
  assert.equal(applied.length, 2);
});

test("Retake goes back to the capture with the same scan kind; Cancel spends the scan", async () => {
  const { ui, applied } = load();
  const seen = recorder();
  const flow = ui.setPresenter(seen.presenter);
  ui.startScan("job_traveler");
  await flow.submitFile(PHOTO);
  flow.retake();
  assert.equal(seen.last("capture")[1].kind, "job_traveler");
  await flow.submitFile(PHOTO);
  flow.cancel();
  assert.equal(flow.apply().ok, false);
  assert.equal(applied.length, 0);
});

test("a line the app cannot orient asks the presenter which layer is A; only inside or outside goes on", () => {
  const { ui } = load({ orientation: null });
  const seen = recorder();
  const flow = ui.setPresenter(seen.presenter);
  ui.startScan("job_traveler");
  assert.deepEqual(seen.calls.map(one => one[0]).filter(kind => kind !== "status"), ["orientation"]);
  flow.chooseOrientation("sideways");
  assert.equal(seen.last("capture"), null);
  ui.startScan("job_traveler");
  flow.chooseOrientation("outside");
  assert.equal(seen.last("capture")[1].kind, "job_traveler");
});

test("a presenter missing a step is refused, and null puts the floor UI's dialogs back", () => {
  const { ui, dialogCalls } = load();
  assert.equal(ui.setPresenter({ capture() {} }), null);
  ui.startScan("dosing_screen");
  assert.deepEqual(dialogCalls, [["show", "recipeScanCaptureDialog"]]);
  const seen = recorder();
  ui.setPresenter(seen.presenter);
  assert.equal(ui.setPresenter(null), null);
  ui.startScan("dosing_screen");
  assert.equal(seen.calls.length, 0);
  assert.equal(dialogCalls.length, 2);
});
