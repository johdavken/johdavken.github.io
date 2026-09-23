"use strict";

/* The production chain: index.html -> the bridges -> app.js -> slate-host.js
 * -> slate.js. What has to be true of the shipped document for Slate to
 * find a connected application when it arrives, and what Slate says when
 * it does not.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = __dirname;
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const indexHtml = read("index.html");
const app = read("app.js");
const host = read("slate-host.js");
const boot = read("slate/slate.js");
const scriptTags = [...indexHtml.matchAll(/<script src="([^"?]+)\?v=([^"]+)"[^>]*>/g)].map(match => ({ file: match[1], tag: match[2] }));
const order = file => scriptTags.findIndex(one => one.file === file);
const tagOf = file => (scriptTags.find(one => one.file === file) || {}).tag;

/* ----------------------------------------------------------------------
 *   1. index.html
 * -------------------------------------------------------------------- */

test("index.html loads the theme controller and the host, each once, both before app.js, and no Slate UI module", () => {
  for (const file of ["slate-theme.js", "slate-display.js", "slate-host.js"]) {
    assert.equal(scriptTags.filter(one => one.file === file).length, 1, `${file} is loaded ${scriptTags.filter(one => one.file === file).length} times`);
    assert.ok(order(file) < order("app.js"), `${file} loads after app.js`);
    assert.match(tagOf(file), /^\d+\.\d+\.\d+$/);
  }
  assert.ok(order("slate-theme.js") < order("slate-host.js"), "the host runs before the theme controller it initialises");
  assert.ok(order("slate-display.js") < order("slate-host.js"), "the host runs before the display controller it initialises");
  assert.doesNotMatch(indexHtml, /["'/]slate\//, "index.html references the slate/ directory");
  assert.doesNotMatch(indexHtml, /<link[^>]+slate/, "index.html links a Slate stylesheet");
  // Every bridge Slate consumes is loaded once, before app.js, as before.
  for (const bridge of ["station-state-bridge.js", "station-command-bridge.js", "station-command-contract.js", "station-connection-bridge.js", "station-admin-bridge.js", "station-recipes-bridge.js"]) {
    assert.equal(scriptTags.filter(one => one.file === bridge).length, 1);
    assert.ok(order(bridge) < order("app.js"));
  }
});

test("the host's index.html tag and its internal VERSION are both recorded, so a Slate change cannot ship under a stale tag", () => {
  const manifest = JSON.parse(read("script-cache-tags.json"));
  for (const file of ["slate-theme.js", "slate-display.js", "slate-host.js"]) {
    assert.ok(manifest[file], `${file} is not in script-cache-tags.json`);
    assert.equal(manifest[file].v, tagOf(file), `${file}'s manifest tag differs from index.html's`);
  }
  assert.match(host, /const VERSION = "\d+\.\d+\.\d+";/);
  // The stylesheets and modules the host loads are tagged with that one VERSION.
  assert.match(host, /link\.href = `\$\{href\}\?v=\$\{VERSION\}`/);
  assert.match(host, /script\.src = `\$\{src\}\?v=\$\{VERSION\}`/);
});

/* ----------------------------------------------------------------------
 *   2. app.js is untouched by Slate
 * -------------------------------------------------------------------- */

test("app.js knows nothing of Slate: no new producer, no attribute, no global", () => {
  // "slate" the word is a legacy theme's name (industrial-slate); Slate the layer is these.
  const SLATE = /data-slate|PolynSlate|slate-root|slate-host|slate\/|\?view=slate/;
  assert.doesNotMatch(app, SLATE, "app.js mentions Slate");
  // The producers Slate reads through are the ones Station already has.
  assert.equal((app.match(/stationBridge\.connect\(/g) || []).length, 1);
  assert.match(app, /function connectStationCommands\(\)\{/);
  assert.match(app, /function connectStationConnection\(/);
});

test("no Station file knows Slate exists either", () => {
  const SLATE = /data-slate|PolynSlate|slate-root|slate-host|slate\/|\?view=slate/;
  for (const file of fs.readdirSync(ROOT).filter(name => /^station-.*\.js$/.test(name) && !name.endsWith(".test.js"))) {
    assert.ok(!SLATE.test(read(file)), `${file} mentions Slate`);
  }
  for (const file of fs.readdirSync(path.join(ROOT, "station")).filter(name => name.endsWith(".js"))) {
    assert.ok(!SLATE.test(read(path.join("station", file))), `station/${file} mentions Slate`);
  }
});

/* ----------------------------------------------------------------------
 *   3. The boot file consumes, never produces
 * -------------------------------------------------------------------- */

test("slate.js takes every bridge as an optional global, subscribes once to the state bridge, and hands the command bridge only to a live source", () => {
  assert.match(boot, /const bridge = root\.PolynStationStateBridge \|\| null;/);
  assert.match(boot, /const commands = root\.PolynStationCommandBridge \|\| null;/);
  assert.match(boot, /const connection = root\.PolynStationConnectionBridge \|\| null;/);
  assert.match(boot, /const admin = root\.PolynStationAdminBridge \|\| null;/);
  assert.match(boot, /const recipes = root\.PolynStationRecipesBridge \|\| null;/);
  assert.match(boot, /const weightProfiles = root\.PolynStationWeightProfilesBridge \|\| null;/);
  assert.equal((boot.match(/bridge\.subscribe\(/g) || []).length, 1);
  assert.match(boot, /return commands && resolved && resolved\.live \? commands : null;/);
  assert.doesNotMatch(boot, /\.connect\(|\.publish\(/);
  assert.doesNotMatch(boot, /searchParams\.get\("source"\)|source=demo/, "the hosted page honours a demo pin");
});

/* ----------------------------------------------------------------------
 *   4. A cached application under a fresh Slate is named as such
 * -------------------------------------------------------------------- */

function statusHelpersFrom(root, bridge) {
  const from = boot.indexOf("function hosted()");
  const to = boot.indexOf("\n  }\n", boot.indexOf("function standaloneHarness()")) + 4;
  return new Function("root", "bridge", `${boot.slice(from, to)}; return { hostWithoutApplication, standaloneHarness };`)(root, bridge);
}

test("inside the host, an unconnected state bridge is reported as a stale application, never as 'no application'", () => {
  const hosted = { document: { body: { hasAttribute: name => name === "data-slate-view" } } };
  const harness = { document: { body: { hasAttribute: () => false } } };
  const connected = { isConnected: () => true };
  const unconnected = { isConnected: () => false };
  assert.equal(statusHelpersFrom(hosted, unconnected).hostWithoutApplication(), true);
  assert.equal(statusHelpersFrom(hosted, connected).hostWithoutApplication(), false);
  assert.equal(statusHelpersFrom(harness, unconnected).hostWithoutApplication(), false);
  assert.equal(statusHelpersFrom(harness, null).hostWithoutApplication(), false);
  assert.equal(statusHelpersFrom(harness, unconnected).standaloneHarness(), true);
  assert.equal(statusHelpersFrom(hosted, unconnected).standaloneHarness(), false, "a hosted page with no application is the stale case, not the harness");
  assert.match(boot, /const STALE_APPLICATION = "The application on this page did not connect to Slate - it is likely a cached copy from before Slate\. Reload bypassing the cache\."/);
  assert.match(boot, /const HARNESS = "Standalone harness: demo data, read-only\. The application's Slate view is index\.html\?view=slate\."/);
  const notice = boot.slice(boot.indexOf("function renderNotice("), boot.indexOf("\n  }\n", boot.indexOf("function renderNotice(")));
  assert.match(notice, /if \(hostWithoutApplication\(\)\) message = STALE_APPLICATION;/);
  assert.match(notice, /classList\.toggle\("is-stale-application", message === STALE_APPLICATION\)/);
});

/* ----------------------------------------------------------------------
 *   5. The chain, executed
 * -------------------------------------------------------------------- */

test("with the bridges connected, the hosted boot draws the recipe, the cards, the sync trigger, the timeline, the tools and the weights from live state", async () => {
  const { makeDocument } = require("./tools/slate-test/fake-dom.js");
  const doc = makeDocument({ href: "https://resin.tools/?view=slate" });
  doc.body.setAttribute("data-slate-view", "slate");
  const hostEl = doc.createElement("div");
  hostEl.setAttribute("data-slate-host", "");
  hostEl.setAttribute("data-slate-app", "");
  hostEl.setAttribute("class", "slate-root");
  doc.body.appendChild(hostEl);

  const root = { document: doc, location: doc.location, setTimeout: () => 1, clearTimeout: () => {}, Date, console };
  root.globalThis = root;
  vm.createContext(root);
  const load = file => new vm.Script(read(file), { filename: file }).runInContext(root);
  for (const file of ["scheduling.js", "station-command-contract.js", "station-command-bridge.js", "station-state-bridge.js",
    "station-connection-bridge.js", "station-admin-bridge.js", "station-recipes-bridge.js", "station-weight-profiles-bridge.js", "resin-totals.js", "pressure-conversion.js", "winding-tension.js", "slate-theme.js", "slate-display.js"]) load(file);
  hostEl.slateTheme = root.PolynSlateTheme.create(hostEl, null);
  // Read-only is automatic on a linked line (slate-display.test.js covers it); this test wants the writable path.
  hostEl.slateDisplay = root.PolynSlateDisplay.create(hostEl, null);
  hostEl.slateDisplay.setReadOnly("off");

  // The application's side: a producer on the state bridge and an executor.
  const demo = require("./slate/slate-demo.js");
  const snap = demo.snapshot(Date.now());
  snap.line.linked = true;
  const stateHandle = root.PolynStationStateBridge.connect({ read: () => snap });
  stateHandle.publish();
  const executed = [];
  root.PolynStationCommandBridge.connect({
    capabilities: ["setHopperTracking", "setPumpOff", "resetTracking", "setLineRate", "setHopperWeight", "setHopperGeometry", "setHopperCircumference", "setSmartHoppers"],
    execute(command, args) {
      executed.push({ command, args });
      return root.PolynStationCommandContract.success({ changed: true, revision: 1, persisted: true, snapshot: root.PolynStationStateBridge.getSnapshot() });
    }
  });
  const connectionHandle = root.PolynStationConnectionBridge.connect({
    read: () => root.PolynStationConnectionBridge.project({ enabled: true, assigned: true, linked: true, workspaceId: "ws-1", workspaceName: "Line 5", displayName: "Line 5", devices: [], deviceLabel: "PC", status: { key: "synced", label: "Synced" } }),
    actions: { refresh() {}, reconnect() {}, generateJoinCode() {}, renderJoinQr() {}, joinWorkspace() {}, selectWorkspace() {}, leaveWorkspace() {}, relabelDevice() {} }
  });
  connectionHandle.publish();
  // The line's saved recipes: one, from the service's cache shape.
  const recipeRequests = [];
  const recipesHandle = root.PolynStationRecipesBridge.connect({
    read: () => root.PolynStationRecipesBridge.project({ workspaceId: "ws-1", cachedAt: 1, items: { recipe: [{ id: "r1", type: "recipe", name: "Blue film", favorite: true, updatedAt: "2026-09-21T10:00:00Z", payload: { line_type: 3, hopper_naming_mode: "standard", layers: [{ name: "A", layer_pct: 25, hoppers: [{ index: 0, pct: 100, resin_name: "HX204" }] }] } }] } }, { workspaceId: "ws-1", displayName: "Line 5" }),
    actions: { loadRecipe(args) { recipeRequests.push(args); return { ok: true }; } }
  });
  recipesHandle.publish();

  const hostScripts = [...host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").matchAll(/"((?:slate|station)\/[^"]+\.js)"/g)].map(match => match[1]);
  for (const file of hostScripts) load(file);

  assert.equal(root.PolynStationStateBridge.isConnected(), true);
  assert.equal(hostEl.querySelectorAll(".slate-hopper").length, 16, "the recipe did not draw from the live snapshot");
  assert.equal(hostEl.querySelector(".slate-header__title").textContent, "Recipe");
  assert.match(hostEl.querySelector(".slate-section__subtitle").textContent, /Live$/);
  assert.equal(hostEl.querySelector(".slate-card--rate .slate-card__value").textContent, "850 lb/hr");
  assert.ok(!hostEl.querySelector(".slate-sync").hasAttribute("hidden"), "the sync trigger is hidden with a connected connection bridge");
  assert.ok(hostEl.querySelectorAll(".slate-timeline__member").length > 0, "the timeline drew no tracked hopper");
  assert.ok(hostEl.querySelector("[data-slate-mount='notice']").hasAttribute("hidden"), "a connected host shows a notice");

  // A toggle goes through the application's executor, addressed to Current.
  const toggle = hostEl.querySelector(".slate-hopper[data-hopper='A3'] [data-slate-control='tracking']");
  assert.equal(toggle.getAttribute("data-able"), "true");
  toggle.dispatchEvent({ type: "click", target: toggle, stopPropagation() {} });
  // Objects from the vm realm have another Object prototype: compare as JSON.
  // The line's saved weight profiles: one, from the service's cache shape.
  const profileRequests = [];
  const profilesHandle = root.PolynStationWeightProfilesBridge.connect({
    read: () => root.PolynStationWeightProfilesBridge.project({ workspaceId: "ws-1", cachedAt: 1, items: { receiver_weight_profile: [{ id: "w1", type: "receiver_weight_profile", name: "Standard 48in", updatedAt: "2026-09-21T10:00:00Z", payload: { line_type: 3, hopper_naming_mode: "standard", layers: [{ name: "A", weights: [400, 380, 120, 0, 0, 0] }, { name: "B", weights: [620, 260, 140, 0] }, { name: "C", weights: [500, 90, 0, 0, 0, 0] }] } }] } }, { workspaceId: "ws-1", displayName: "Line 5" }),
    actions: { loadWeightProfile(args) { profileRequests.push(args); return { ok: true }; } }
  });
  // Connected after Slate booted, as a late producer would be: its publish
  // reaches the section through the subscription, on the bridge's own
  // microtask.
  profilesHandle.publish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(JSON.stringify(executed), JSON.stringify([{ command: "setHopperTracking", args: { recipe: "current", layer: "A", index: 2, track: true } }]));

  // The timeline's Pump off goes through the same executor, addressed to Current.
  const pump = hostEl.querySelector(".slate-timeline__member[data-key='A:0'] [data-slate-control='pump']");
  assert.equal(pump.getAttribute("data-able"), "true");
  pump.dispatchEvent({ type: "click", target: pump, stopPropagation() {} });
  assert.equal(JSON.stringify(executed[1]), JSON.stringify({ command: "setPumpOff", args: { recipe: "current", layer: "A", index: 0, pumpOff: true } }));

  // Resin Balance runs the application's own resin-totals.js (loaded by
  // index.html, never by the host) in the Timeline's place, and its close
  // brings the Timeline back; the centre stays on the recipe throughout.
  const timelineWrap = hostEl.querySelector(".slate-aside .slate-section[data-section='timeline']");
  const balanceWrap = hostEl.querySelector(".slate-aside .slate-section[data-section='resin-balance']");
  assert.ok(timelineWrap && balanceWrap, "the aside does not hold both the Timeline and the tool");
  assert.ok(!timelineWrap.hasAttribute("hidden") && balanceWrap.hasAttribute("hidden"));
  const railItems = hostEl.querySelectorAll(".slate-rail__sections [data-section]");
  const listed = railItems.filter(item => !item.hasAttribute("hidden")).map(item => item.getAttribute("data-section"));
  assert.deepEqual(listed, ["recipe", "recipe-book", "weights", "resin-balance", "pressure", "winding-tension"], "the sections are Recipe, Recipe Book, Weights, Resin Balance, with the two calculators in the Tools menu after");
  // The administrator's three are built with the rest and stand unlisted:
  // no administrator is signed in on this boot (no producer connects the
  // admin bridge), so they are not on the rail and the rule above them is
  // not drawn.
  // A phone's Home is built and unlisted too, on a screen that is not one.
  assert.deepEqual(railItems.filter(item => item.hasAttribute("hidden")).map(item => item.getAttribute("data-section")), ["home", "workspaces", "line-config", "resins"]);
  assert.ok(hostEl.querySelector(".slate-rail__divider").hasAttribute("hidden"), "the administrator's rule is drawn with nobody signed in");
  for (const id of ["workspaces", "line-config", "resins"]) {
    assert.ok(hostEl.querySelector(`.slate-centre .slate-section[data-section='${id}']`), `${id} was not mounted in the centre`);
  }
  assert.deepEqual(hostEl.querySelectorAll(".slate-rail__menu [data-section]").map(item => item.getAttribute("data-section")), ["pressure", "winding-tension"]);
  const toolItem = hostEl.querySelector(".slate-rail__sections [data-section='resin-balance']");
  toolItem.dispatchEvent({ type: "click", target: toolItem, stopPropagation() {} });
  assert.ok(timelineWrap.hasAttribute("hidden") && !balanceWrap.hasAttribute("hidden"), "selecting the tool did not swap the aside");
  assert.equal(hostEl.querySelector(".slate-header__title").textContent, "Recipe", "a tool took the centre");
  assert.ok(toolItem.classList.contains("is-active"));
  assert.ok(hostEl.querySelector(".slate-rail [data-section='recipe']").classList.contains("is-active"), "the recipe lost its mark to the tool");
  const balanceRows = hostEl.querySelectorAll(".slate-balance__row");
  assert.ok(balanceRows.length > 0, "the tool drew no rows from the live job");
  assert.equal(balanceRows[0].getAttribute("data-resin"), "LL318");
  const back = hostEl.querySelector(".slate-balance [data-slate-back]");
  back.dispatchEvent({ type: "click", target: back, stopPropagation() {} });
  assert.ok(!timelineWrap.hasAttribute("hidden") && balanceWrap.hasAttribute("hidden"), "close did not bring the Timeline back");
  assert.ok(!toolItem.classList.contains("is-active"));
  // The rail item again: open, and once more, closed.
  toolItem.dispatchEvent({ type: "click", target: toolItem, stopPropagation() {} });
  assert.ok(!balanceWrap.hasAttribute("hidden"));
  toolItem.dispatchEvent({ type: "click", target: toolItem, stopPropagation() {} });
  assert.ok(!timelineWrap.hasAttribute("hidden") && balanceWrap.hasAttribute("hidden"), "selecting the showing tool again did not close it");
  assert.ok(!toolItem.classList.contains("is-active"));

  // The two calculators list under Tools. PSI ⇄ bar takes the Scrap
  // card's place in the job's row; Winding Tension takes the Timeline's.
  // Each runs the application's own module (loaded by index.html, never
  // by the host), each hands its place back, and the two are open at
  // once with the centre untouched. The menu stays open through it all.
  const toolsButton = hostEl.querySelector(".slate-rail__item--tools");
  toolsButton.dispatchEvent({ type: "click", target: toolsButton, stopPropagation() {} });
  assert.equal(toolsButton.getAttribute("aria-expanded"), "true");
  const scrapWrap = hostEl.querySelector(".slate-cards__slot[data-slot='scrap'] .slate-section[data-section='scrap']");
  const pressureWrap = hostEl.querySelector(".slate-cards__slot[data-slot='scrap'] .slate-section[data-section='pressure']");
  assert.ok(scrapWrap && pressureWrap, "the Scrap slot does not hold both the card and the converter");
  assert.ok(scrapWrap.querySelector(".slate-card--scrap"), "the Scrap card left its slot");
  assert.ok(!scrapWrap.hasAttribute("hidden") && pressureWrap.hasAttribute("hidden"));
  const pressureItem = hostEl.querySelector(".slate-rail__menu [data-section='pressure']");
  pressureItem.dispatchEvent({ type: "click", target: pressureItem, stopPropagation() {} });
  assert.ok(scrapWrap.hasAttribute("hidden") && !pressureWrap.hasAttribute("hidden"), "selecting the converter did not swap the Scrap slot");
  assert.ok(!timelineWrap.hasAttribute("hidden"), "the converter took the aside");
  assert.equal(toolsButton.getAttribute("aria-expanded"), "true", "selecting a tool closed the menu");
  assert.ok(!toolsButton.classList.contains("is-active"), "the Tools item lit: the mark is the tool's own");
  assert.ok(pressureItem.classList.contains("is-active"));
  assert.ok(hostEl.querySelector(".slate-rail [data-section='recipe']").classList.contains("is-active"), "the recipe lost its mark to the converter");
  const pressureInput = hostEl.querySelector(".slate-pressure__input");
  assert.ok(pressureInput.focused, "the converter did not take focus on arrival");
  pressureInput.value = "120";
  pressureInput.dispatchEvent({ type: "input", target: pressureInput });
  assert.equal(hostEl.querySelector(".slate-pressure__answer").textContent, "8.27 bar");
  assert.equal(hostEl.querySelector(".slate-card--rate .slate-card__value").textContent, "850 lb/hr", "the other cards changed under the converter");

  const windingWrap = hostEl.querySelector(".slate-aside .slate-section[data-section='winding-tension']");
  const windingItem = hostEl.querySelector(".slate-rail__menu [data-section='winding-tension']");
  windingItem.dispatchEvent({ type: "click", target: windingItem, stopPropagation() {} });
  assert.ok(timelineWrap.hasAttribute("hidden") && !windingWrap.hasAttribute("hidden"), "selecting the calculator did not swap the aside");
  assert.ok(!pressureWrap.hasAttribute("hidden"), "the aside's tool closed the converter");
  assert.ok(windingItem.classList.contains("is-active") && pressureItem.classList.contains("is-active"));
  const thickness = hostEl.querySelector(".slate-winding__input[data-field='thickness']");
  const width = hostEl.querySelector(".slate-winding__input[data-field='width']");
  thickness.value = "2.3"; thickness.dispatchEvent({ type: "input", target: thickness });
  width.value = "40"; width.dispatchEvent({ type: "input", target: width });
  assert.equal(hostEl.querySelector(".slate-winding__target").textContent, "13.2");
  assert.equal(hostEl.querySelector(".slate-header__title").textContent, "Recipe", "a tool took the centre");
  assert.equal(executed.length, 2, "a calculator dispatched a command");

  // Each close hands its own place back and unmarks its own item.
  const pressureClose = hostEl.querySelector(".slate-pressure [data-slate-back]");
  pressureClose.dispatchEvent({ type: "click", target: pressureClose, stopPropagation() {} });
  assert.ok(!scrapWrap.hasAttribute("hidden") && pressureWrap.hasAttribute("hidden"), "the converter's close did not bring Scrap back");
  assert.ok(!pressureItem.classList.contains("is-active"));
  assert.ok(windingItem.classList.contains("is-active"), "the converter's close unmarked the calculator");
  assert.equal(hostEl.querySelector(".slate-card--scrap .slate-card__value").textContent, "310 lb", "the Scrap card came back unpainted");
  windingItem.dispatchEvent({ type: "click", target: windingItem, stopPropagation() {} });
  assert.ok(!timelineWrap.hasAttribute("hidden") && windingWrap.hasAttribute("hidden"), "selecting the showing calculator again did not close it");
  assert.ok(!windingItem.classList.contains("is-active"));
  assert.ok(!toolsButton.classList.contains("is-active"));
  assert.equal(toolsButton.getAttribute("aria-expanded"), "true", "the menu closed on its own");
  toolsButton.dispatchEvent({ type: "click", target: toolsButton, stopPropagation() {} });
  assert.equal(toolsButton.getAttribute("aria-expanded"), "false");

  // Weights: a section of its own, under the Recipe Book. A weight goes
  // through the same executor as one setHopperWeight to Current, the
  // profiles come off the weight-profiles bridge the application
  // connected (loaded by index.html, never by the host), and the Recipe's
  // rows are untouched by the visit.
  const weightsItem = hostEl.querySelector(".slate-rail__sections [data-section='weights']");
  weightsItem.dispatchEvent({ type: "click", target: weightsItem, stopPropagation() {} });
  assert.equal(hostEl.querySelector(".slate-header__title").textContent, "Weights");
  assert.ok(!hostEl.querySelector(".slate-centre .slate-section[data-section='weights']").hasAttribute("hidden"));
  const weightField = hostEl.querySelector(".slate-weights__field[data-key='A:0'][data-kind='weight']");
  assert.equal(weightField.value, "400");
  assert.equal(weightField.getAttribute("readonly"), null, "the field is withheld on a writable live line");
  weightField.dispatchEvent({ type: "focus", target: weightField });
  weightField.value = "450";
  weightField.dispatchEvent({ type: "keydown", key: "Enter", target: weightField, preventDefault() {} });
  // The contract read the draft text into pounds before the executor saw it.
  assert.equal(JSON.stringify(executed[2]), JSON.stringify({ command: "setHopperWeight", args: { recipe: "current", layer: "A", index: 0, weight: 450 } }));
  assert.equal(hostEl.querySelector(".slate-weights [data-slate-smart]").getAttribute("data-able"), "false", "Smart Hoppers offered off an identified line");
  assert.equal(hostEl.querySelectorAll(".slate-book__row[data-profile]").length, 1);
  assert.equal(hostEl.querySelector(".slate-book__row[data-profile='w1'] .slate-book__row-name").textContent, "Standard 48in");
  const profileRow = hostEl.querySelector(".slate-book__row[data-profile='w1']");
  profileRow.dispatchEvent({ type: "click", target: profileRow, stopPropagation() {} });
  const loadButton = hostEl.querySelector(".slate-weights [data-book-action='load']");
  assert.equal(loadButton.getAttribute("data-able"), "true");
  assert.equal(hostEl.querySelectorAll(".slate-hopper").length, 16, "the Weights rows count as recipe rows");
  const recipeItem = hostEl.querySelector(".slate-rail__sections [data-section='recipe']");
  recipeItem.dispatchEvent({ type: "click", target: recipeItem, stopPropagation() {} });
  assert.equal(hostEl.querySelector(".slate-header__title").textContent, "Recipe");
  profilesHandle.disconnect();

  // The Recipe Book reads the recipes bridge the application connected.
  const bookRow = hostEl.querySelector(".slate-book__row[data-recipe='r1']");
  assert.ok(bookRow, "the Recipe Book did not list the line's recipe");
  assert.equal(bookRow.querySelector(".slate-book__row-name").textContent, "Blue film");
  assert.match(hostEl.querySelector(".slate-book .slate-section__subtitle").textContent, /^Line 5 /);
  assert.equal(hostEl.querySelector(".slate-recipe__save[data-slate-save='current']").getAttribute("data-able"), "false", "Save is offered although the application declared no save action");
});

test("with no producer inside the host, the boot names the stale application; on the harness it names itself", () => {
  const { makeDocument } = require("./tools/slate-test/fake-dom.js");
  function bootWith(hosted) {
    const doc = makeDocument({ href: hosted ? "https://resin.tools/?view=slate" : "https://resin.tools/slate/slate.html" });
    if (hosted) doc.body.setAttribute("data-slate-view", "slate");
    const container = doc.createElement("div");
    container.setAttribute("data-slate-app", "");
    doc.body.appendChild(container);
    const root = { document: doc, location: doc.location, setTimeout: () => 1, clearTimeout: () => {}, Date, console };
    root.globalThis = root;
    vm.createContext(root);
    const load = file => new vm.Script(read(file), { filename: file }).runInContext(root);
    for (const file of ["scheduling.js", "station-command-contract.js", "station-command-bridge.js", "station-state-bridge.js", "slate-theme.js"]) load(file);
    const hostScripts = [...host.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").matchAll(/"((?:slate|station)\/[^"]+\.js)"/g)].map(match => match[1]);
    for (const file of hostScripts) load(file);
    return container;
  }
  const hosted = bootWith(true);
  const notice = hosted.querySelector("[data-slate-mount='notice']");
  assert.ok(!notice.hasAttribute("hidden"));
  assert.match(notice.textContent, /did not connect to Slate/);
  assert.ok(notice.classList.contains("is-stale-application"));

  const harness = bootWith(false);
  const harnessNotice = harness.querySelector("[data-slate-mount='notice']");
  assert.match(harnessNotice.textContent, /^Standalone harness/);
  assert.ok(harnessNotice.classList.contains("is-quiet"));
  assert.match(harness.querySelector(".slate-section__subtitle").textContent, /Demo$/);
  // Demo is never writable: every toggle is unable and the cards are read-only.
  assert.equal(harness.querySelector("[data-slate-control='tracking']").getAttribute("data-able"), "false");
  assert.ok(harness.querySelector(".slate-card").classList.contains("is-readonly"));
  assert.ok(harness.querySelector(".slate-sync").hasAttribute("hidden"));
});

test("the rail's own display rule never out-specifies [hidden]: an unlisted item is not drawn", () => {
  const css = require("node:fs").readFileSync(require("node:path").join(__dirname, "slate/styles/components/rail.css"), "utf8");
  assert.match(css, /\.slate-root \.slate-rail__item\[hidden\] \{[^}]*display: none;/);
});
