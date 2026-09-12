#!/usr/bin/env node
/* Station browser spec - see README.md beside this file. */
"use strict";

const path = require("path");
const fs = require("fs");

const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
let playwright;
try {
  playwright = require(playwrightModule);
} catch (error) {
  console.error(`Playwright is not a project dependency. Install it outside the repo and set PLAYWRIGHT_MODULE (tried "${playwrightModule}").`);
  process.exit(2);
}

const BASE = process.env.STATION_BASE || "http://127.0.0.1:8765";
const BROWSERS = (process.env.BROWSERS || "chromium,firefox").split(",").map(s => s.trim()).filter(Boolean);
const OUT = path.join(__dirname, "out");
/* The application host, with the executor connected, so the editor's
 * search and fields are the real thing. The standalone harness has no
 * producer and is read-only there by design; it is visited once at the
 * end to check exactly that. */
const PAGE = "/?view=station";
const DEMO_PAGE = "/station/station.html?source=demo";

/* A three-layer session seeded into the browser's own storage before the
 * page loads - the same shape the application saves - so the host has a
 * line to draw and a recipe to edit. Local only: every request that is
 * not to BASE is aborted, so nothing here can reach RT Sync or Supabase. */
const SESSION_KEY = "resinTimer.session.v0.09";
const SESSION = {
  version: "0.17", lineRate: 1200, lineType: 3, changeoverTime: "", offsets: { A: 0, B: 0, C: 0 },
  layers: ["A", "B", "C"].map((name, i) => ({
    name, layerPct: i === 1 ? 40 : 30,
    hoppers: [
      { pct: 60, weight: 500, resinName: "HX204", track: true, pumpOff: false, usableHeight: 40 },
      { pct: 30, weight: 400, resinName: "LD105", track: true, pumpOff: false, usableHeight: 30 },
      { pct: 10, weight: 0, resinName: "EVA340", track: false, pumpOff: false, usableHeight: 0 },
      { pct: 0, weight: 0, resinName: "", track: false, pumpOff: false },
      { pct: 0, weight: 0, resinName: "", track: false, pumpOff: false },
      { pct: 0, weight: 0, resinName: "", track: false, pumpOff: false }
    ]
  })),
  hookupSources: { current: { "B:0": { resin: "HX204", source: "SILO 3" }, "B:2": { resin: "EVA340", source: "BOX 12" } }, next: {} },
  theme: "industrial-slate"
};

let failures = 0;
function check(browser, name, ok, detail) {
  const mark = ok ? "ok  " : "FAIL";
  console.log(`${mark} [${browser}] ${name}${ok ? "" : ` - ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!ok) failures += 1;
}

const settled = async page => {
  await page.waitForFunction(() => !document.querySelector("[data-station-mount='machine']").classList.contains("is-transitioning"), null, { timeout: 5000 });
  await page.waitForTimeout(120);
};
const stateOf = page => page.evaluate(() => { const m = document.querySelector("[data-station-mount='machine']"); return { transitioning: m.classList.contains("is-transitioning"), focus: m.getAttribute("data-focus-layer") }; });
const active = page => page.evaluate(() => { const a = document.activeElement; const c = a.className && a.className.baseVal !== undefined ? a.className.baseVal : a.className; return { cls: String(c || "").split(" ")[0], hopper: a.closest && a.closest("[data-hopper]") ? a.closest("[data-hopper]").getAttribute("data-hopper") : null, slot: a.getAttribute ? a.getAttribute("data-slot") : null }; });
const listInfo = page => page.evaluate(() => {
  const r = document.querySelector(".station-editor__results");
  if (!r) return null;
  const opts = Array.from(r.querySelectorAll(".station-editor__option"));
  const visible = o => { const b = o.getBoundingClientRect(); const h = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return !!(h && o.contains(h)); };
  return { placement: r.getAttribute("data-placement"), count: opts.length, firstVisible: opts.length ? visible(opts[0]) : null, lastVisible: opts.length ? visible(opts[opts.length - 1]) : null, ariaActive: document.querySelector(".station-editor__search").getAttribute("aria-activedescendant"), activeIndex: opts.findIndex(o => o.classList.contains("is-active")) };
});
const clusterAt = (page, layer) => page.evaluate(id => { const c = document.querySelector(`[data-role='layer'][data-layer='${id}'] [data-role='hopper-cluster']`).getBoundingClientRect(); const s = document.querySelector(".station-machine__stage").getBoundingClientRect(); return [c.x - s.x, c.y - s.y, c.width, c.height].map(n => +n.toFixed(1)); }, layer);
const mixerHit = layer => `[data-role='layer'][data-layer='${layer}'] [data-role='mixer'] .station-hit`;
const dispatchClick = (page, selector) => page.evaluate(sel => { document.querySelector(sel).dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true })); }, selector);

/* Test real pointer routing through the decorative drawing, including the
 * receiver's retained target. Synthetic events alone bypass pointer-events. */
const hopperHitFailures = page => page.evaluate(() => {
  const failures = [];
  for (const hopper of document.querySelectorAll(".station-layer:not(.is-dimmed) .station-hopper")) {
    for (const part of ["shell", "band", "port", "fill-valve", "valve-core", "cone-shape", "spout", "id", "pct", "receiver-cone"]) {
      const shape = hopper.querySelector(`.station-hopper__${part}`);
      const box = shape.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const target = hit && hit.closest("[data-station-target]");
      if (getComputedStyle(shape).pointerEvents !== "none" || !hit ||
          !hit.classList.contains("station-hit") || hit.closest(".station-hopper") !== hopper ||
          !target || target.getAttribute("data-station-target") !== (part === "receiver-cone" ? "receiver" : "cluster")) {
        failures.push(`${hopper.getAttribute("data-hopper")}:${part}`);
      }
    }
  }
  return failures;
});

async function run(browserName) {
  const type = playwright[browserName];
  if (!type) { console.error(`unknown browser ${browserName}`); failures += 1; return; }
  const browser = await type.launch();
  for (const [w, h] of [[1920, 1080], [1440, 900], [1160, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.route("**/*", route => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    await ctx.addInitScript(({ key, value }) => { try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* no storage: the host draws nothing and the checks say so */ } }, { key: SESSION_KEY, value: SESSION });
    const page = await ctx.newPage();
    const errors = [];
    // The host's own noise from aborted RT Sync requests is not Station's.
    page.on("pageerror", e => { if (!/LockManager|Failed to fetch/.test(e.message)) errors.push(e.message); });
    await page.goto(BASE + PAGE, { waitUntil: "load" });
    await page.waitForSelector("[data-role='layer']", { timeout: 15000 });
    await page.waitForTimeout(300);
    const tag = `${w}x${h}`;
    check(browserName, `${tag} the host offers editing`, (await page.$eval(".station-editor__mode, [data-station-mount='machine']", () => true)) && (await page.evaluate(() => window.PolynStationCommandBridge.isAvailable())));

    /* viewport */
    const pageState = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, innerW: innerWidth, innerH: innerHeight, tooSmall: getComputedStyle(document.querySelector(".station-too-small")).display !== "none" }));
    check(browserName, `${tag} no page scrollbar`, pageState.scrollW <= pageState.innerW && pageState.scrollH <= pageState.innerH, pageState);
    check(browserName, `${tag} too-small notice hidden`, !pageState.tooSmall);
    let hopperHits = await hopperHitFailures(page);
    check(browserName, `${tag} overview hopper artwork routes through stable hit areas`, hopperHits.length === 0, hopperHits);

    /* open / close */
    const normalCluster = await clusterAt(page, "B");
    await dispatchClick(page, mixerHit("B"));
    const opening = await stateOf(page);
    check(browserName, `${tag} fast click on the mixer opens with no prior hover`, opening.transitioning || opening.focus === "B", opening);
    await settled(page);
    check(browserName, `${tag} transition reaches focused`, (await stateOf(page)).focus === "B");
    hopperHits = await hopperHitFailures(page);
    check(browserName, `${tag} focused hopper artwork routes through stable hit areas`, hopperHits.length === 0, hopperHits);
    const editorScroll = await page.evaluate(() => { const e = document.querySelector(".station-editor"); return { sh: e.scrollHeight, ch: e.clientHeight }; });
    check(browserName, `${tag} editor content fits its workspace`, editorScroll.sh <= editorScroll.ch, editorScroll);

    /* click targets through the foreignObject */
    const hits = await page.evaluate(() => { const out = {}; for (const [k, sel] of [["resin", ".station-editor__item[data-hopper='B1'] .station-editor__resin-value"], ["pct", ".station-editor__item[data-hopper='B1'] .station-editor__pct-input"], ["source", ".station-editor__item[data-hopper='B3'] .station-editor__source-value"], ["badge", ".station-editor__item[data-hopper='B1'] .station-editor__badge"], ["add", ".station-editor__item[data-hopper='B4'] .station-editor__resin-value"]]) { const el = document.querySelector(sel); const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); out[k] = hit === el || el.contains(hit); } return out; });
    check(browserName, `${tag} every editor control hit-tests to itself`, Object.values(hits).every(Boolean), hits);

    /* linkage */
    const link = id => page.evaluate(id => ({ hopperHi: document.querySelector(`[data-role='hopper'][data-hopper='${id}']`).classList.contains("is-highlighted"), rowHi: document.querySelector(`.station-editor__item[data-hopper='${id}']`).classList.contains("is-highlighted"), hopperSel: document.querySelector(`[data-role='hopper'][data-hopper='${id}']`).classList.contains("is-selected"), rowSel: document.querySelector(`.station-editor__item[data-hopper='${id}']`).classList.contains("is-selected") }), id);
    await page.hover(".station-editor__item[data-hopper='B2']"); await page.waitForTimeout(40);
    let l = await link("B2");
    check(browserName, `${tag} hovering a row highlights its hopper`, l.rowHi && l.hopperHi, l);
    await page.mouse.move(5, 5);
    await page.hover("[data-role='layer'][data-layer='B'] [data-role='hopper'][data-hopper='B2'] .station-hopper__shell", { force: true }); await page.waitForTimeout(40);
    l = await link("B2");
    check(browserName, `${tag} hovering a hopper highlights its row`, l.rowHi && l.hopperHi, l);
    await page.mouse.move(5, 5);
    await dispatchClick(page, "[data-role='layer'][data-layer='B'] [data-role='hopper'][data-hopper='B3'] .station-hopper__interaction > .station-hit");
    l = await link("B3");
    check(browserName, `${tag} fast click on a hopper selects it and its row`, l.hopperSel && l.rowSel, l);
    await dispatchClick(page, ".station-editor__item[data-hopper='B1'] .station-editor__badge");
    l = await link("B1");
    check(browserName, `${tag} fast click on a row selects it and its hopper`, l.hopperSel && l.rowSel, l);
    check(browserName, `${tag} hopper clicks never close the layer`, (await stateOf(page)).focus === "B");

    /* search keyboard flow */
    await page.focus(".station-editor__item[data-hopper='B1'] .station-editor__resin-value");
    await page.keyboard.press("Enter"); await page.waitForTimeout(60);
    let a = await active(page);
    const sel = await page.evaluate(() => { const s = document.querySelector(".station-editor__search"); return s && [s.selectionStart, s.selectionEnd, s.value.length]; });
    check(browserName, `${tag} Enter on the value opens the search with the value selected`, a.cls === "station-editor__search" && sel && sel[0] === 0 && sel[1] === sel[2], { a, sel });
    await page.keyboard.type("l"); await page.waitForTimeout(40);
    let info = await listInfo(page);
    check(browserName, `${tag} top row: list below, fully hit-testable`, info.placement === "below" && info.count > 1 && info.firstVisible && info.lastVisible, info);
    await page.keyboard.press("ArrowDown"); await page.waitForTimeout(30);
    info = await listInfo(page);
    check(browserName, `${tag} ArrowDown moves the active option and aria-activedescendant`, info.activeIndex === 1 && /-1$/.test(info.ariaActive || ""), info);
    const chosen = await page.$eval(".station-editor__option.is-active .station-editor__option-code", n => n.textContent);
    await page.keyboard.press("Enter"); await page.waitForTimeout(120);
    a = await active(page);
    const note = await page.$eval(".station-editor__note", n => n.textContent);
    const applied = await page.evaluate(() => ({ row: document.querySelector(".station-editor__item[data-hopper='B1'] .station-editor__resin-value").textContent, app: window.PolynStationStateBridge.getSnapshot().layers[1].hoppers[0].resinName, legacy: document.getElementById("r_B_0").value }));
    check(browserName, `${tag} Enter chooses, applies through the application, closes, returns focus to the value`, !(await page.$(".station-editor__search")) && a.cls === "station-editor__resin-value" && a.hopper === "B1" && note === "" && applied.row === chosen && applied.app === chosen && applied.legacy === chosen, { a, note, chosen, applied });
    await page.keyboard.press("Enter"); await page.waitForTimeout(60);
    await page.keyboard.press("Escape"); await page.waitForTimeout(60);
    a = await active(page);
    check(browserName, `${tag} Escape closes the search only`, !(await page.$(".station-editor__search")) && (await stateOf(page)).focus === "B" && a.cls === "station-editor__resin-value", a);
    await page.keyboard.press("Enter"); await page.waitForTimeout(60);
    await page.keyboard.press("Tab"); await page.waitForTimeout(60);
    a = await active(page);
    // The row's source value is visibility:hidden while its search is open,
    // so Tab lands on the next control that is focusable at that instant: the
    // percentage. Either is "moved on"; leaving the row or the layer is not.
    check(browserName, `${tag} Tab closes the search and moves on`, !(await page.$(".station-editor__search")) && ["source", "pct"].includes(a.slot) && a.hopper === "B1", a);
    await page.focus(".station-editor__item[data-hopper='B1'] .station-editor__resin-value");
    await page.keyboard.press("Enter"); await page.waitForTimeout(60);
    const keep = await page.evaluate(() => { const r = document.querySelector(".station-editor__results"); r.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true })); return !!document.querySelector(".station-editor__search"); });
    check(browserName, `${tag} mousedown on the list does not close it`, keep);
    await page.keyboard.press("Escape"); await page.waitForTimeout(40);

    /* bottom row placement */
    await page.focus(".station-editor__item[data-hopper='B6'] .station-editor__resin-value");
    await page.keyboard.press("Enter"); await page.waitForTimeout(60);
    info = await listInfo(page);
    check(browserName, `${tag} bottom row: list above, fully hit-testable`, info.placement === "above" && info.count > 1 && info.firstVisible && info.lastVisible, info);
    await page.keyboard.type("zzqq"); await page.waitForTimeout(40);
    info = await listInfo(page);
    check(browserName, `${tag} bottom row: a no-match list is re-placed and visible`, info.count === 0 && info.placement, info);
    await page.keyboard.press("Escape"); await page.waitForTimeout(40);

    /* percentage field */
    const pct = await page.evaluate(() => { const i = document.querySelector(".station-editor__item[data-hopper='B1'] .station-editor__pct-input"); const was = i.value; const out = {}; for (const v of ["60", "100", "33.33"]) { i.value = v; out[v] = i.scrollWidth <= i.clientWidth; } i.value = was; return out; });
    check(browserName, `${tag} the percentage field fits 60, 100 and 33.33`, Object.values(pct).every(Boolean), pct);

    /* hopper drag: a row carried onto another, through the application */
    const centreOf = async selector => { const b = await page.locator(selector).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const badgeOf = id => `.station-editor__item[data-hopper='${id}'] .station-editor__badge`;
    const marksOf = () => page.evaluate(() => ({
      dragging: [...document.querySelectorAll(".station-editor__item.is-dragging")].map(i => i.getAttribute("data-hopper")),
      target: [...document.querySelectorAll(".station-editor__item.is-drop-target")].map(i => i.getAttribute("data-hopper")),
      moving: document.querySelector(".station-editor__list").classList.contains("is-moving"),
      selection: String(window.getSelection && window.getSelection().toString())
    }));
    const layoutOf = () => page.evaluate(() => ({
      app: window.PolynStationStateBridge.getSnapshot().layers[1].hoppers.map(h => `${h.resinName}:${h.pct}`),
      rows: [...document.querySelectorAll(".station-editor__item")].map(i => `${i.getAttribute("data-hopper")}:${(i.querySelector(".station-editor__resin-value") || {}).textContent}`),
      legacy: [0, 1, 2, 3, 4, 5].map(i => document.getElementById(`r_B_${i}`).value),
      canUndo: window.PolynStationStateBridge.getSnapshot().history.current.canUndo,
      focus: document.querySelector("[data-station-mount='machine']").getAttribute("data-focus-layer")
    }));
    const from = await centreOf(badgeOf("B2")); const to = await centreOf(badgeOf("B4"));
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 2, from.y + 2, { steps: 2 });
    const beforeThreshold = await marksOf();
    await page.mouse.move(to.x, to.y, { steps: 8 }); await page.waitForTimeout(40);
    const midDrag = await marksOf();
    await page.mouse.up(); await page.waitForTimeout(200);
    const moved = await layoutOf(); const afterDrop = await marksOf();
    check(browserName, `${tag} a press that does not travel is not a drag`, !beforeThreshold.moving && beforeThreshold.dragging.length === 0, beforeThreshold);
    check(browserName, `${tag} dragging a row marks it and the row under the pointer, with no text selected`, midDrag.moving && midDrag.dragging[0] === "B2" && midDrag.target[0] === "B4" && midDrag.selection === "", midDrag);
    check(browserName, `${tag} dropping moves the assignment through the application: row, bridge and legacy field agree, one history entry`,
      moved.app[3].startsWith("LD105:") && moved.app[1] === ":0" && moved.rows[3] === "B4:LD105" && moved.legacy[3] === "LD105" && moved.legacy[1] === "" && moved.canUndo && moved.focus === "B",
      moved);
    check(browserName, `${tag} every drag mark is gone after the drop`, !afterDrop.moving && afterDrop.dragging.length === 0 && afterDrop.target.length === 0, afterDrop);
    // Back where it was, so what follows sees the seeded layout.
    await page.mouse.move(to.x, to.y); await page.mouse.down(); await page.mouse.move(from.x, from.y, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(200);
    const restored = await layoutOf();
    check(browserName, `${tag} dragging it back restores the layout`, restored.rows[1] === "B2:LD105" && restored.app[3] === ":0", restored);
    const pctBox = await page.locator(".station-editor__item[data-hopper='B1'] .station-editor__pct-input").boundingBox();
    await page.mouse.move(pctBox.x + 2, pctBox.y + pctBox.height / 2); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 });
    const fieldDrag = await marksOf();
    await page.mouse.up(); await page.waitForTimeout(60);
    check(browserName, `${tag} a press in the percentage field never becomes a drag`, !fieldDrag.moving && fieldDrag.dragging.length === 0, fieldDrag);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.keyboard.press("Escape"); await page.waitForTimeout(40);
    const escaped = await marksOf(); const escapedLayout = await layoutOf();
    await page.mouse.up(); await page.waitForTimeout(100);
    check(browserName, `${tag} Escape cancels a drag and leaves the layer open`, !escaped.moving && escaped.dragging.length === 0 && escapedLayout.focus === "B" && (await layoutOf()).rows[1] === "B2:LD105", { escaped, escapedLayout });

    /* close, reverse, rapid */
    await page.keyboard.press("Escape"); await settled(page);
    check(browserName, `${tag} Escape closes the layer`, (await stateOf(page)).focus === null);
    const backCluster = await clusterAt(page, "B");
    check(browserName, `${tag} the cluster lands back on its normal position`, JSON.stringify(backCluster) === JSON.stringify(normalCluster), { normalCluster, backCluster });
    await dispatchClick(page, mixerHit("B"));
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape");
    await settled(page);
    const reversed = await page.evaluate(() => ({ focus: document.querySelector("[data-station-mount='machine']").getAttribute("data-focus-layer"), activating: !!document.querySelector(".is-activating"), leftover: Array.from(document.querySelectorAll("[data-role='layer']")).some(l => /is-[a-z]+-selected/.test(l.className.baseVal)) }));
    check(browserName, `${tag} Escape mid-flight reverses to normal with no leftover marks`, reversed.focus === null && !reversed.activating && !reversed.leftover, reversed);
    for (let i = 0; i < 3; i++) { await dispatchClick(page, mixerHit("B")); await page.waitForTimeout(40); }
    await settled(page);
    check(browserName, `${tag} three rapid clicks end focused`, (await stateOf(page)).focus === "B");

    if (w === 1440) {
      fs.mkdirSync(OUT, { recursive: true });
      const fo = await page.$eval(".station-workspace__editor", el => el.getBoundingClientRect().toJSON());
      await page.screenshot({ path: path.join(OUT, `${browserName}-editor-2x.png`), clip: { x: fo.x - 4, y: fo.y - 4, width: fo.width + 8, height: Math.min(fo.height + 8, h - fo.y) } });
    }
    check(browserName, `${tag} no page errors`, errors.length === 0, errors);
    await ctx.close();
  }

  /* The standalone harness: nothing is connected, so the editor is
   * read-only - the values read, the search does not open, the field
   * says why. */
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route("**/*", route => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE + DEMO_PAGE, { waitUntil: "load" });
  await page.waitForSelector("[data-role='layer']");
  await page.click("[data-demo='three-layer']");
  await page.waitForTimeout(150);
  await dispatchClick(page, mixerHit("B"));
  await settled(page);
  const mode = await page.$eval(".station-editor__mode", n => n.textContent);
  await page.focus(".station-editor__item[data-hopper='B1'] .station-editor__resin-value");
  await page.keyboard.press("Enter"); await page.waitForTimeout(60);
  const readOnly = await page.evaluate(() => ({
    search: !!document.querySelector(".station-editor__search"),
    resin: document.querySelector(".station-editor__item[data-hopper='B1'] .station-editor__resin-value").textContent,
    disabled: document.querySelector(".station-editor__item[data-hopper='B1'] .station-editor__resin-value").getAttribute("aria-disabled"),
    cursor: getComputedStyle(document.querySelector(".station-editor__item[data-hopper='B1'] .station-editor__resin-value")).cursor,
    pctReadOnly: document.querySelector(".station-editor__item[data-hopper='B2'] .station-editor__pct-input").hasAttribute("readonly"),
    note: document.querySelector(".station-editor__note").textContent
  }));
  check(browserName, "harness: read-only throughout, the value reads, the search does not open, and the note says why",
    mode === "Read-only" && !readOnly.search && readOnly.resin && readOnly.disabled === "true" && readOnly.cursor === "default" && readOnly.pctReadOnly && /no application is connected/.test(readOnly.note), { mode, readOnly });
  await ctx.close();
  await browser.close();
}

(async () => {
  for (const name of BROWSERS) {
    try { await run(name); } catch (error) { failures += 1; console.error(`FAIL [${name}] ${error && error.stack || error}`); }
  }
  console.log(failures ? `\n${failures} failure(s)` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
