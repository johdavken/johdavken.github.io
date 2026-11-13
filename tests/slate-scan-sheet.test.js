"use strict";

/* slate-scan-sheet.js: the recipe scan's steps in Slate's own sheet. It is
 * the presenter the application's scan flow hands each step to, and it
 * answers through the flow it is handed - nothing of the scan is its
 * own. Opening it changes nothing; Cancel, Escape, the scrim and Back all
 * spend the scan through the flow; a reply that lands after a Cancel is not
 * drawn. */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { makeDocument, click, key, makeEvent } = require("../tools/slate-test/fake-dom.js");
const sheetModule = require("../slate/slate-scan-sheet.js");
const dismiss = require("../slate/slate-dismiss.js");

/* A flow that writes down what it is asked. */
function fakeFlow(options) {
  const settings = options || {};
  const asked = [];
  let busy = false;
  return {
    asked,
    setBusy(on) { busy = on; },
    flow: {
      chooseOrientation: value => asked.push(["orientation", value]),
      submitFile: file => asked.push(["submit", file]),
      takePhoto: () => asked.push(["take"]),
      choosePhoto: () => asked.push(["choose"]),
      busy: () => busy,
      setLayerPct: (index, value) => asked.push(["pct", index, value]),
      apply: () => { asked.push(["apply"]); return { ok: !settings.refuse }; },
      retake: () => asked.push(["retake"]),
      cancel: () => asked.push(["cancel"])
    }
  };
}

function harness(options) {
  const doc = makeDocument();
  const sheet = sheetModule.create(doc);
  doc.body.appendChild(sheet.element);
  const fake = fakeFlow(options);
  sheet.useFlow(fake.flow);
  const el = sheet.element;
  const doButton = what => el.querySelector(`[data-scan-do='${what}']`);
  const labels = () => el.querySelectorAll(".slate-scan-sheet__actions button").map(node => node.textContent);
  const status = () => el.querySelector(".slate-scan-sheet__status");
  return { doc, sheet, el, fake, doButton, labels, status };
}

const CAPTURE = { kind: "dosing_screen", title: "Scan Dosing Screen", description: "Take a photo of the dosing controller's material overview screen.", native: false };

const MODEL = {
  kind: "dosing_screen",
  title: "Review Scanned Recipe — Next Recipe",
  applyLabel: "Apply to Next Recipe",
  warnings: ["This will overwrite the next recipe assignments."],
  layers: [
    { index: 0, name: "A", pct: 30, pctState: "read", componentsOff: false, hoppers: [
      { label: "H1", resin: "LL1001", pct: 79.5, state: "auto" },
      { label: "H2", resin: "MB12", pct: 20.5, state: "read" }
    ] },
    { index: 1, name: "B", pct: 0, pctState: "estimated", componentsOff: true, hoppers: [
      { label: "H1", resin: "", pct: 0, state: "missing" },
      { label: "H2", resin: "SLIP", pct: 0, state: "estimated" }
    ] },
    { index: 2, name: "C", pct: 70, pctState: "calculated", componentsOff: false, hoppers: [] }
  ]
};

test("shut until the flow hands it a step; the capture on the web is one photo button and Cancel, in the flow's words", () => {
  const { sheet, el, labels } = harness();
  assert.ok(el.hasAttribute("hidden"));
  assert.equal(sheet.isOpen(), false);
  sheet.presenter.capture(CAPTURE);
  assert.ok(!el.hasAttribute("hidden"));
  assert.equal(sheet.step(), "capture");
  assert.equal(el.getAttribute("data-scan-step"), "capture");
  assert.equal(el.querySelector(".slate-scan-sheet__title").textContent, "Scan Dosing Screen");
  assert.equal(el.querySelector(".slate-modal__body").textContent, CAPTURE.description);
  assert.deepEqual(labels(), ["Take or choose a photo", "Cancel"]);
  assert.ok(el.querySelector(".slate-scan-sheet__card").getAttribute("aria-modal") === "true");
});

test("on Android the capture offers the camera and the gallery, each through the flow", () => {
  const { sheet, fake, doButton, labels } = harness();
  sheet.presenter.capture(Object.assign({}, CAPTURE, { native: true }));
  assert.deepEqual(labels(), ["Take photo", "Choose photo", "Cancel"]);
  click(doButton("take"));
  click(doButton("choose"));
  assert.deepEqual(fake.asked, [["take"], ["choose"]]);
});

test("the web's photo is the browser's picker; the file it hands back goes to the flow", () => {
  const { sheet, el, fake, doButton } = harness();
  sheet.presenter.capture(CAPTURE);
  const input = el.querySelector(".slate-scan-sheet__file");
  let picked = 0;
  input.click = () => { picked += 1; };
  click(doButton("pick"));
  assert.equal(picked, 1);
  const file = { name: "screen.jpg" };
  input.files = [file];
  input.dispatchEvent(makeEvent("change"));
  assert.equal(fake.asked.length, 1);
  assert.ok(fake.asked[0][1] === file);
});

test("while the flow scans, the answers are held except Cancel; an error frees them and says why", () => {
  const { sheet, fake, doButton, status } = harness();
  sheet.presenter.capture(CAPTURE);
  fake.setBusy(true);
  sheet.presenter.status("capture", "Scanning…", false);
  assert.equal(status().textContent, "Scanning…");
  assert.ok(!status().hasAttribute("hidden"));
  assert.ok(doButton("pick").hasAttribute("disabled"));
  assert.ok(!doButton("cancel").hasAttribute("disabled"));
  click(doButton("pick"));
  // The flow says why, then clears its own flag: the error frees the sheet.
  sheet.presenter.status("capture", "The photo couldn't be read clearly.", true);
  assert.ok(status().classList.contains("is-error"));
  assert.ok(!doButton("pick").hasAttribute("disabled"));
  // A status for a step not on screen is not shown.
  sheet.presenter.status("review", "elsewhere", true);
  assert.equal(status().textContent, "The photo couldn't be read clearly.");
});

test("the review: the warnings, each layer with its share, what was not read in amber, and the one unread share to type", () => {
  const { sheet, el, fake, labels } = harness();
  sheet.presenter.capture(CAPTURE);
  sheet.presenter.review(MODEL);
  assert.equal(sheet.step(), "review");
  assert.equal(el.querySelector(".slate-scan-sheet__title").textContent, "Review Scanned Recipe — Next Recipe");
  assert.deepEqual(el.querySelectorAll(".slate-scan-sheet__warning").map(node => node.textContent), ["This will overwrite the next recipe assignments."]);
  const layers = el.querySelectorAll(".slate-scan-sheet__layer");
  assert.equal(layers.length, 3);
  assert.equal(layers[0].querySelector(".slate-scan-sheet__layer-name").textContent, "Layer A");
  assert.equal(layers[0].querySelector(".slate-scan-sheet__layer-pct").textContent, "30%");
  assert.equal(layers[2].querySelector(".slate-scan-sheet__layer-pct").textContent, "70%calculated");
  const rowsA = layers[0].querySelectorAll(".slate-scan-sheet__hopper");
  assert.deepEqual(rowsA.map(row => row.textContent), ["H1LL100179.5%auto", "H2MB1220.5%"]);
  assert.ok(rowsA[0].classList.contains("is-auto"));
  const rowsB = layers[1].querySelectorAll(".slate-scan-sheet__hopper");
  assert.deepEqual(rowsB.map(row => row.textContent), ["H1not read—", "H2SLIPnot read · 0%"]);
  assert.ok(rowsB[0].classList.contains("is-missing"));
  assert.equal(layers[1].querySelector(".slate-scan-sheet__flag--line").textContent, "Components didn't total 100%");
  // Only the unread share is a field, and it goes straight to the flow.
  const inputs = el.querySelectorAll("[data-scan-layer-pct]");
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].getAttribute("aria-label"), "Layer B percentage");
  assert.ok(inputs[0].focused, "the unread share is not where the review starts");
  inputs[0].value = "70";
  inputs[0].dispatchEvent(makeEvent("input"));
  assert.deepEqual(fake.asked, [["pct", 1, "70"]]);
  assert.deepEqual(labels(), ["Apply to Next Recipe", "Retake photo", "Cancel"]);
  assert.ok(el.querySelector("[data-scan-do='apply']").classList.contains("slate-recipe__plan-action--promote"));
});

test("Apply goes through the flow and the sheet closes when it lands; a refusal keeps it up for the reason", () => {
  const landed = harness();
  landed.sheet.presenter.capture(CAPTURE);
  landed.sheet.presenter.review(MODEL);
  click(landed.doButton("apply"));
  assert.deepEqual(landed.fake.asked, [["apply"]]);
  assert.equal(landed.sheet.isOpen(), false);

  const refused = harness({ refuse: true });
  refused.sheet.presenter.capture(CAPTURE);
  refused.sheet.presenter.review(MODEL);
  click(refused.doButton("apply"));
  refused.sheet.presenter.status("review", "The recipe could not be applied.", true);
  assert.equal(refused.sheet.isOpen(), true);
  assert.equal(refused.status().textContent, "The recipe could not be applied.");
  assert.deepEqual(refused.fake.asked, [["apply"]], "a refused apply was cancelled");
});

test("Retake asks the flow, which hands the capture back", () => {
  const { sheet, fake, doButton } = harness();
  sheet.presenter.capture(CAPTURE);
  sheet.presenter.review(MODEL);
  click(doButton("retake"));
  assert.deepEqual(fake.asked, [["retake"]]);
  sheet.presenter.capture(CAPTURE);
  assert.equal(sheet.step(), "capture");
});

test("Cancel, Escape, the scrim and Back each close it and spend the scan; a review landing afterwards is not drawn", () => {
  for (const how of ["button", "escape", "scrim", "back"]) {
    const { sheet, el, fake, doButton } = harness();
    sheet.presenter.capture(CAPTURE);
    if (how === "button") click(doButton("cancel"));
    else if (how === "escape") key(el, "Escape");
    else if (how === "scrim") click(el.querySelector(".slate-modal__scrim"));
    else assert.equal(dismiss.dismissTop(), true);
    assert.equal(sheet.isOpen(), false, how);
    assert.deepEqual(fake.asked, [["cancel"]], how);
    sheet.presenter.review(MODEL);
    sheet.presenter.status("capture", "late", true);
    assert.equal(sheet.isOpen(), false, `${how}: a late review reopened it`);
    assert.equal(el.querySelectorAll(".slate-scan-sheet__layer").length, 0);
  }
});

test("which layer is A: two answers and Cancel, through the flow", () => {
  const { sheet, fake, doButton, labels } = harness();
  sheet.presenter.orientation();
  assert.equal(sheet.step(), "orientation");
  assert.deepEqual(labels(), ["A is the inside layer", "A is the outside layer", "Cancel"]);
  click(doButton("outside"));
  assert.deepEqual(fake.asked, [["orientation", "outside"]]);
});

test("without a flow, the answers do nothing but Cancel close it", () => {
  const doc = makeDocument();
  const sheet = sheetModule.create(doc);
  sheet.presenter.capture(CAPTURE);
  click(sheet.element.querySelector("[data-scan-do='pick']"));
  assert.equal(sheet.isOpen(), true);
  click(sheet.element.querySelector("[data-scan-do='cancel']"));
  assert.equal(sheet.isOpen(), false);
});

test("percent: two places at most, trailing zeros dropped, nothing for no number", () => {
  assert.equal(sheetModule.percent(12.5), "12.5%");
  assert.equal(sheetModule.percent(70), "70%");
  assert.equal(sheetModule.percent(33.33333), "33.33%");
  assert.equal(sheetModule.percent(null), "");
});

test("the sheet requests nothing, dispatches nothing, keeps no timer and reads no application global", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "slate", "slate-scan-sheet.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\.request\s*\(|dispatch|setTimeout|setInterval|Bridge|localStorage|PolynRecipeScan|fetch\(/);
});

test("the boot registers the sheet as the scan flow's presenter, in the root beside the conflict question", () => {
  const boot = fs.readFileSync(path.join(__dirname, "..", "slate", "slate.js"), "utf8");
  assert.match(boot, /const scanSheet = scanSheetModule\.create\(doc\);\s*container\.appendChild\(scanSheet\.element\);\s*scanSheet\.useFlow\(scanUi\.setPresenter\(scanSheet\.presenter\)\);/);
});

test("on a phone the card rises from the foot as a sheet; it scrolls its body and keeps its answers in reach", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "slate", "styles", "components", "scan.css"), "utf8");
  assert.match(css, /\.slate-root\[data-input="touch"\]\[data-viewport="phone"\] \.slate-scan-sheet \{\n  align-items: flex-end;/);
  assert.match(css, /\.slate-scan-sheet__body \{[^}]*overflow-y: auto;/);
  assert.match(css, /\.slate-scan-sheet__actions \{\n  flex: none;/);
});

test("on a phone the lead answer spans the foot over the other two; two answers or the orientation's three stack", () => {
  const { sheet, el } = harness();
  const actions = () => el.querySelector(".slate-scan-sheet__actions");
  sheet.presenter.capture(CAPTURE);
  assert.ok(actions().classList.contains("slate-scan-sheet__actions--stack"), "the web capture's two answers do not stack");
  sheet.presenter.review(MODEL);
  assert.ok(!actions().classList.contains("slate-scan-sheet__actions--stack"));
  assert.ok(el.querySelector("[data-scan-do='apply']").classList.contains("slate-scan-sheet__answer--lead"));
  sheet.presenter.capture(Object.assign({}, CAPTURE, { native: true }));
  assert.ok(!actions().classList.contains("slate-scan-sheet__actions--stack"));
  sheet.presenter.orientation();
  assert.ok(actions().classList.contains("slate-scan-sheet__actions--stack"));
  assert.equal(el.querySelectorAll(".slate-scan-sheet__answer--lead").length, 0);
});
