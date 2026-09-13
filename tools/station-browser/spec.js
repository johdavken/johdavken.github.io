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
const DEMO_PAGE = "/station/station.html?source=demo&demo=three-layer";

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

/* Test real pointer routing through the decorative drawing: the receiver
 * is the pump control, everything below it the tracking control. Synthetic
 * events alone bypass pointer-events. */
const hopperHitFailures = page => page.evaluate(() => {
  const failures = [];
  for (const hopper of document.querySelectorAll(".station-layer:not(.is-dimmed) .station-hopper")) {
    for (const part of ["shell", "band", "port", "fill-valve", "valve-core", "bottom-plate", "hose", "id", "pct", "receiver-cone"]) {
      const shape = hopper.querySelector(`.station-hopper__${part}`);
      const box = shape.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const target = hit && hit.closest("[data-station-target]");
      // The receiver's cone is under the pump control's cell; the vessel,
      // its hardware, the hose and the readout under the tracking control's.
      const expected = part === "receiver-cone" ? "pump" : "tracking";
      if (getComputedStyle(shape).pointerEvents !== "none" || !hit ||
          !hit.classList.contains("station-hit") || hit.closest(".station-hopper") !== hopper ||
          !target || target.getAttribute("data-station-target") !== expected) {
        failures.push(`${hopper.getAttribute("data-hopper")}:${part}`);
      }
    }
  }
  return failures;
});

/* The hopper's operational controls, read through the application: the
 * bridge's snapshot, the legacy grid's own clock button, and the saved
 * session - all three must agree after a Station toggle - and the drawing:
 * the run-down flow through a tracked hopper, the receiver stepping back
 * when its pump is off. */
const hopperSel = (layer, id) => `[data-role='layer'][data-layer='${layer}'] [data-role='hopper'][data-hopper='${id}']`;
const controlSel = (layer, id, kind) => `${hopperSel(layer, id)} [data-station-target='${kind}'] .station-hit`;
const opState = (page, layer, index, id) => page.evaluate(([layer, index, id, key]) => {
  const snapshot = window.PolynStationStateBridge.getSnapshot();
  const layerIndex = snapshot.layers.findIndex(l => l.name === layer);
  const hopper = document.querySelector(`[data-role='layer'][data-layer='${layer}'] [data-role='hopper'][data-hopper='${id}']`);
  const control = kind => hopper.querySelector(`[data-station-target='${kind}']`);
  const legacyCell = document.getElementById(`r_${layer}_${index}`) && document.getElementById(`r_${layer}_${index}`).closest("td");
  const session = JSON.parse(localStorage.getItem(key)).layers[layerIndex].hoppers[index];
  const row = document.querySelector(`.station-editor__item[data-hopper='${id}']`);
  return {
    app: { track: snapshot.layers[layerIndex].hoppers[index].track, pumpOff: snapshot.layers[layerIndex].hoppers[index].pumpOff },
    session: { track: !!session.track, pumpOff: !!session.pumpOff },
    legacyTrack: legacyCell ? legacyCell.querySelector(".splitTrackButton").getAttribute("aria-pressed") : null,
    drawn: {
      tracking: hopper.classList.contains("is-tracking"), pumpOff: hopper.classList.contains("is-pump-off"),
      flow: !!hopper.querySelector(".station-hopper__rundown"), halo: !!hopper.querySelector(".station-hopper__halo"), receiver: control("pump").getAttribute("data-pump"),
      layerAccent: getComputedStyle(hopper.closest("[data-role='layer']")).getPropertyValue("--station-layer-accent").trim(),
      receiverOpacity: Number(getComputedStyle(hopper.querySelector(".station-hopper__receiver-drawing")).opacity),
      coneFill: getComputedStyle(hopper.querySelector(".station-hopper__receiver-cone")).fill,
      icons: hopper.querySelectorAll(".station-hopper__clock, .station-hopper__power-ring").length
    },
    control: { tracking: control("tracking").getAttribute("data-on"), pump: control("pump").getAttribute("data-on"), able: [control("tracking").getAttribute("data-able"), control("pump").getAttribute("data-able")] },
    pending: !!document.querySelector(".is-pending"),
    selected: !!document.querySelector(".station-hopper.is-selected"),
    focus: document.querySelector("[data-station-mount='machine']").getAttribute("data-focus-layer"),
    // The open layer's rows carry no operational controls.
    rowOps: row ? row.querySelectorAll(".station-editor__op, [data-slot='tracking'], [data-slot='pump']").length : null,
    hover: !!hopper.querySelector(".station-hopper__control:hover")
  };
}, [layer, index, id, SESSION_KEY]);
const clickCentre = async (page, selector) => { const b = await page.locator(selector).first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(120); };
const flows = page => page.evaluate(() => ({
  tracked: document.querySelectorAll(".station-layer:not(.is-dimmed) .station-hopper.is-tracking").length,
  halos: document.querySelectorAll(".station-hopper__halo, [data-role='hopper-halo']").length,
  // The one thing that moves on a hopper is a tracked hopper's run-down
  // flow: one animated group per tracked hopper, nothing else.
  animated: [...document.querySelectorAll(".station-layer:not(.is-dimmed) .station-hopper *")].filter(el => getComputedStyle(el).animationName !== "none" && !el.classList.contains("station-hopper__rundown-flow")).length,
  flows: [...document.querySelectorAll(".station-layer:not(.is-dimmed) .station-hopper.is-tracking .station-hopper__rundown-flow")].filter(el => getComputedStyle(el).animationName === "station-rundown-flow").length,
  icons: document.querySelectorAll(".station-hopper__clock, .station-hopper__power-ring, .station-hopper__marks").length
}));

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
    const frame = await page.evaluate(() => {
      const rect = sel => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
      const shell = rect(".station-shell"), header = rect(".station-header"), machine = rect(".station-machine"), timeline = rect(".station-timeline"), status = rect(".station-status");
      const stage = rect(".station-machine__stage");
      return {
        columns: getComputedStyle(document.querySelector(".station-shell")).gridTemplateColumns.split(" ").length,
        regions: [...document.querySelector(".station-shell").children].map(el => el.className),
        panes: document.querySelectorAll(".station-sidebar, .station-inspector, .station-recipe-strip, .station-nav, [data-station-mount='inspector'], [data-station-mount='nav'], [data-station-mount='recipe-strip']").length,
        headerFull: header && Math.abs(header.width - shell.width) < 1 && header.y === shell.y,
        machineFull: machine && Math.abs(machine.width - shell.width) < 1 && Math.abs(machine.y - header.bottom) < 1 && Math.abs(timeline.y - machine.bottom) < 1,
        // The run-down timeline: one modest row between the stage and the
        // status bar, the full width, no heading.
        timelineFull: timeline && Math.abs(timeline.width - shell.width) < 1 && Math.abs(status.y - timeline.bottom) < 1 && timeline.height < shell.height * 0.14 && !document.querySelector(".station-timeline h1, .station-timeline h2, .station-timeline h3"),
        statusFull: status && Math.abs(status.width - shell.width) < 1 && Math.abs(status.bottom - shell.bottom) < 1,
        stageWide: stage && stage.width > shell.width * 0.9,
        shellWidth: shell.width, machineWidth: machine.width, stageWidth: stage ? stage.width : null,
        console: !!document.querySelector("[data-station-mount='connection'] *")
      };
    });
    /* The Handbook's slot lies over the stage's cell (shell.css: grid-area
     * machine, pointer-events none), so it is a child of the shell without
     * being a region of it. */
    check(browserName, `${tag} the shell is header, stage, run-down timeline and status bar across the full width - no side pane, no recipe strip, no spare track`,
      frame.columns === 1 && frame.regions.join() === "station-header,station-machine,station-handbook-slot,station-utility-slot,station-timeline,station-status" && frame.panes === 0 && frame.headerFull && frame.machineFull && frame.timelineFull && frame.statusFull && frame.stageWide && frame.console, frame);

    /* The header: Station's name, the way back, the two job readouts and
     * the line console - one row, no badge, no scale. Legacy is a plain
     * link to the page without the Station flag, in the header's muted
     * small caps, never a box. */
    const chrome = await page.evaluate(() => {
      const header = document.querySelector(".station-header");
      const legacy = header.querySelector(".station-header__legacy");
      const cs = getComputedStyle(legacy);
      const ls = legacy.getBoundingClientRect(), title = header.querySelector(".station-header__title").getBoundingClientRect();
      const keys = [...header.querySelectorAll(".station-job__key")].map(k => k.textContent);
      const values = [...header.querySelectorAll(".station-job__value")].map(v => v.textContent);
      return {
        text: header.textContent, badge: !!header.querySelector(".station-header__tag, .pill, .badge"),
        scaleInHeader: !!header.querySelector("[data-window], .station-job__scale, .station-job__window"),
        legacy: legacy && legacy.tagName === "A" && legacy.textContent === "Legacy" ? legacy.getAttribute("href") : null,
        legacyQuiet: cs.borderStyle === "none" && cs.backgroundColor === "rgba(0, 0, 0, 0)" && cs.textDecorationLine === "underline" && parseFloat(cs.fontSize) <= 12,
        legacyBesideName: ls.x > title.right && ls.x - title.right < 24 && Math.abs((ls.y + ls.height / 2) - (title.y + title.height / 2)) < 6,
        keys, values, headerHeight: header.getBoundingClientRect().height,
        oneRow: [...header.children].every(el => Math.abs(el.getBoundingClientRect().height) <= header.getBoundingClientRect().height)
      };
    });
    check(browserName, `${tag} the header is Station, Legacy, Output and Changeover, then the console: no EXPERIMENTAL, no 6H | 12H, one 52px row`,
      !/experimental/i.test(chrome.text) && !chrome.badge && !chrome.scaleInHeader && chrome.keys.join() === "Output,Changeover" && /lb\/hr/.test(chrome.values[0]) && /Not set|PM|AM/.test(chrome.values[1]) && chrome.headerHeight === 52 && chrome.oneRow, chrome);
    check(browserName, `${tag} Legacy is a quiet link beside the name to the application without the Station flag`,
      chrome.legacy === "/" && chrome.legacyQuiet && chrome.legacyBesideName, chrome);

    /* Station's picture: a 32px rounded face immediately left of the name,
     * inside the header's row and clear of everything else in it; pressed,
     * it opens the larger picture under itself, rounded, over the stage
     * and inside the window; Escape and a press outside put it away. */
    const avatarGeometry = () => page.evaluate(() => {
      const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
      const header = document.querySelector(".station-header");
      const slot = header.querySelector(".station-header__avatar");
      const trigger = header.querySelector(".station-avatar__trigger");
      const face = header.querySelector(".station-avatar__face");
      const panel = header.querySelector(".station-avatar__panel");
      const portrait = header.querySelector(".station-avatar__portrait");
      if (!slot || !trigger || !face || !panel || !portrait) return { missing: true };
      const tcs = getComputedStyle(trigger), pcs = getComputedStyle(panel), ics = getComputedStyle(portrait);
      const others = [".station-header__title", ".station-header__legacy", ".station-job", ".station-sync"].map(sel => header.querySelector(sel)).filter(Boolean).map(r);
      const t = r(trigger), h = r(header), title = r(header.querySelector(".station-header__title"));
      const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
      return {
        firstInHeader: header.firstElementChild === slot && slot.nextElementSibling === header.querySelector(".station-header__title"),
        size: [t.w, t.h], radius: tcs.borderTopLeftRadius, overflow: tcs.overflow,
        inRow: t.y >= h.y && t.bottom <= h.bottom, headerHeight: h.h,
        leftOfTitle: t.right <= title.x && title.x - t.right < 24 && Math.abs((t.y + t.h / 2) - (title.y + title.h / 2)) < 4,
        clear: others.every(o => !overlaps(t, o)),
        faceLoaded: face.complete && face.naturalWidth === 96 && face.naturalHeight === 96,
        expanded: trigger.getAttribute("aria-expanded"), open: pcs.display !== "none",
        panel: r(panel), panelRadius: pcs.borderTopLeftRadius, portrait: r(portrait), portraitRadius: ics.borderTopLeftRadius,
        portraitLoaded: portrait.complete && portrait.naturalWidth === 640 && portrait.naturalHeight === 760,
        focused: document.activeElement === panel ? "panel" : document.activeElement === trigger ? "trigger" : document.activeElement ? document.activeElement.className : null,
        innerW: innerWidth, innerH: innerHeight
      };
    });
    let avatar = await avatarGeometry();
    check(browserName, `${tag} the picture is a 32px rounded face immediately left of the name, inside the 52px row, clear of the title, Legacy, the readouts and the console`,
      !avatar.missing && avatar.firstInHeader && avatar.size.join() === "32,32" && parseFloat(avatar.radius) >= 4 && avatar.overflow === "hidden" && avatar.inRow && avatar.headerHeight === 52 && avatar.leftOfTitle && avatar.clear && avatar.faceLoaded && avatar.expanded === "false" && !avatar.open, avatar);
    await page.click(".station-avatar__trigger");
    await page.waitForFunction(() => { const img = document.querySelector(".station-avatar__portrait"); return img && img.complete && img.naturalWidth > 0; }, null, { timeout: 5000 }).catch(() => {});
    avatar = await avatarGeometry();
    check(browserName, `${tag} pressing the face opens the larger picture under it: rounded, its full 320px width, inside the window, over the stage, focused, the header unmoved`,
      avatar.open && avatar.expanded === "true" && avatar.portraitLoaded && avatar.portrait.w === 320 && avatar.portrait.h === 380 && parseFloat(avatar.panelRadius) >= 8 && parseFloat(avatar.portraitRadius) >= 4
      && avatar.panel.y >= 52 && avatar.panel.x >= 0 && avatar.panel.right <= avatar.innerW && avatar.panel.bottom <= avatar.innerH && avatar.headerHeight === 52 && avatar.focused === "panel", avatar);
    await page.keyboard.press("Escape"); await page.waitForTimeout(50);
    avatar = await avatarGeometry();
    check(browserName, `${tag} Escape closes the picture and returns focus to the face`, !avatar.open && avatar.expanded === "false" && avatar.focused === "trigger", avatar);
    await page.click(".station-avatar__trigger"); await page.waitForTimeout(50);
    avatar = await avatarGeometry();
    check(browserName, `${tag} the face opens the picture again`, avatar.open, avatar);
    await page.mouse.click(avatar.innerW / 2, avatar.innerH - 8); await page.waitForTimeout(50);
    avatar = await avatarGeometry();
    check(browserName, `${tag} a press outside closes the picture`, !avatar.open && avatar.expanded === "false", avatar);
    await page.click(".station-avatar__trigger"); await page.waitForTimeout(50);
    await page.click(".station-avatar__trigger"); await page.waitForTimeout(50);
    avatar = await avatarGeometry();
    check(browserName, `${tag} pressing the face again closes the picture`, !avatar.open && avatar.headerHeight === 52, avatar);

    /* The timeline's scale: 6H | 12H under the Now clock, in the anchor's
     * column, one pressed - and choosing the other redraws the row at the
     * new window without moving the axis a pixel. */
    const scaleGeometry = () => page.evaluate(() => {
      const r = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom }; };
      const options = [...document.querySelectorAll(".station-rundown__range-option")];
      const pressed = options.find(o => o.getAttribute("aria-pressed") === "true");
      const pcs = pressed ? getComputedStyle(pressed) : null, other = options.find(o => o !== pressed), ocs = other ? getComputedStyle(other) : null;
      return {
        now: r(".station-rundown__now"), clock: r(".station-rundown__now-clock"), range: r(".station-rundown__range"), axis: r(".station-rundown__axis"), track: r(".station-rundown__track"), timeline: r(".station-timeline"),
        options: options.map(o => [o.textContent, o.getAttribute("aria-pressed")]), window: document.querySelector(".station-rundown").getAttribute("data-window"),
        // The pressed segment is told apart by weight and a rule, not colour alone.
        pressedMarked: !!pcs && parseInt(pcs.fontWeight, 10) >= 700 && parseFloat(pcs.borderBottomWidth) >= 2 && pcs.borderBottomColor !== "rgba(0, 0, 0, 0)",
        otherPlain: !!ocs && parseInt(ocs.fontWeight, 10) < 700 && (ocs.borderBottomColor === "rgba(0, 0, 0, 0)" || parseFloat(ocs.borderBottomWidth) === 0),
        markers: [...document.querySelectorAll(".station-rundown__marker")].map(m => [m.getAttribute("data-hopper"), m.style.getPropertyValue("--station-rundown-x")])
      };
    });
    let scale = await scaleGeometry();
    check(browserName, `${tag} 6H | 12H sits under Now in the timeline's anchor column, 6H pressed and marked by weight and a rule`,
      scale.options.join() === "6H,true,12H,false" && scale.window === "6" && scale.range.y >= scale.clock.bottom && scale.range.x >= scale.now.x && scale.range.x + scale.range.w <= scale.track.x + 1 && scale.range.bottom <= scale.timeline.bottom && scale.pressedMarked && scale.otherPlain, scale);
    const sixAxis = scale.axis, sixMarkers = scale.markers;
    await page.click(".station-rundown__range-option[data-window='12']"); await page.waitForTimeout(150);
    scale = await scaleGeometry();
    const halved = sixMarkers.length > 0 && sixMarkers.every(([id, x]) => { const now = scale.markers.find(m => m[0] === id); return now && Math.abs(parseFloat(now[1]) - parseFloat(x) / 2) < 0.01; });
    check(browserName, `${tag} 12H presses the other segment and redraws every marker at half its fraction; the axis and the row do not move`,
      scale.options.join() === "6H,false,12H,true" && scale.window === "12" && halved && scale.axis.x === sixAxis.x && scale.axis.y === sixAxis.y && scale.axis.w === sixAxis.w && scale.pressedMarked && scale.otherPlain, { scale, sixAxis, sixMarkers });
    await page.focus(".station-rundown__range-option[data-window='6']"); await page.keyboard.press("Space"); await page.waitForTimeout(150);
    scale = await scaleGeometry();
    // The clock ran on between the two presses: a marker moves a hair with
    // it, so the six-hour picture is the same to within a tick's drift.
    const sixAgain = sixMarkers.every(([id, x]) => { const now = scale.markers.find(m => m[0] === id); return now && Math.abs(parseFloat(now[1]) - parseFloat(x)) < 0.02; });
    check(browserName, `${tag} 6H by keyboard brings the six-hour picture back exactly`, scale.window === "6" && scale.options.join() === "6H,true,12H,false" && sixAgain && scale.axis.x === sixAxis.x && scale.axis.w === sixAxis.w, { scale, sixMarkers });

    /* A modal the application opens (a sync conflict, a join code) must be
     * SEEN over Station, not hidden with the rest of the legacy shell: a
     * hidden modal leaves the document inert, and Station then answers
     * nothing with no sign of why (host.css: the :modal exception). Opened
     * here the way resolveLineSyncConflict opens it; closed again after. */
    const modal = await page.evaluate(() => {
      const dialog = document.getElementById("lineSyncConflictDialog");
      if (!dialog || typeof dialog.showModal !== "function") return { missing: true };
      dialog.showModal();
      const box = dialog.getBoundingClientRect();
      const button = dialog.querySelector("button");
      const bb = button ? button.getBoundingClientRect() : null;
      const at = bb ? document.elementFromPoint(bb.x + bb.width / 2, bb.y + bb.height / 2) : null;
      const shown = { display: getComputedStyle(dialog).display, visible: box.width > 0 && box.height > 0, answerable: !!at && dialog.contains(at),
        leaked: [...document.body.children].filter(el => !el.hasAttribute("data-station-host") && el !== dialog && getComputedStyle(el).display !== "none").map(el => el.tagName + "#" + el.id) };
      dialog.close();
      const launcher = document.querySelector(".station-handbook__launcher");
      const lb = launcher.getBoundingClientRect();
      const back = document.elementFromPoint(lb.x + lb.width / 2, lb.y + lb.height / 2);
      return Object.assign(shown, { hiddenAgain: getComputedStyle(dialog).display === "none", launcherBack: !!back && !!back.closest(".station-handbook__launcher") });
    });
    check(browserName, `${tag} a modal the application opens is visible and answerable over Station, leaks nothing else, and Station is back when it closes`,
      !modal.missing && modal.display !== "none" && modal.visible && modal.answerable && modal.leaked.length === 0 && modal.hiddenAgain && modal.launcherBack, modal);
    let hopperHits = await hopperHitFailures(page);
    check(browserName, `${tag} overview hopper artwork routes through stable hit areas`, hopperHits.length === 0, hopperHits);

    /* the hopper's operational controls, in the overview: the body is the
     * tracking toggle, the receiver the pump toggle, each a command through
     * the application and nothing else */
    let ops = await opState(page, "B", 2, "B3");
    check(browserName, `${tag} controls are on offer and B3 starts untracked, pump running, no icon drawn`, ops.control.able.join() === "true,true" && !ops.app.track && !ops.drawn.flow && ops.control.tracking === "false" && ops.control.pump === "false" && ops.drawn.icons === 0, ops);
    const cellHit = await page.evaluate(sel => { const out = {}; for (const kind of ["tracking", "pump"]) { const cell = document.querySelector(`${sel} [data-station-target='${kind}'] .station-hit`); const b = cell.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); out[kind] = !!(hit && hit.closest("[data-station-target]") && hit.closest("[data-station-target]").getAttribute("data-station-target") === kind); } return out; }, hopperSel("B", "B3"));
    check(browserName, `${tag} each control's cell hit-tests to itself`, cellHit.tracking && cellHit.pump, cellHit);
    await clickCentre(page, controlSel("B", "B3", "tracking"));
    ops = await opState(page, "B", 2, "B3");
    check(browserName, `${tag} clicking B3's body tracks it through the application: bridge, legacy clock button and saved session agree, the flow is drawn, the pump is untouched`,
      ops.app.track && ops.session.track && ops.legacyTrack === "true" && ops.drawn.tracking && ops.drawn.flow && !ops.drawn.halo && ops.control.tracking === "true" && !ops.app.pumpOff && !ops.pending, ops);
    check(browserName, `${tag} a control click neither selects the hopper nor opens the layer`, !ops.selected && ops.focus === null, ops);
    let drawn = await flows(page);
    check(browserName, `${tag} every tracked hopper carries one run-down flow and nothing on its head: no halo, nothing else animates, no icon anywhere`,
      drawn.tracked >= 3 && drawn.halos === 0 && drawn.animated === 0 && drawn.flows === drawn.tracked && drawn.icons === 0, drawn);
    await clickCentre(page, controlSel("B", "B3", "tracking"));
    ops = await opState(page, "B", 2, "B3");
    check(browserName, `${tag} clicking it again untracks B3: the flow is gone, nothing stuck`, !ops.app.track && !ops.session.track && ops.legacyTrack === "false" && !ops.drawn.flow && ops.control.tracking === "false" && !ops.pending && !ops.selected, ops);
    const runningCone = ops.drawn.coneFill;
    await clickCentre(page, controlSel("B", "B1", "pump"));
    const hovered = await opState(page, "B", 0, "B1");
    await page.mouse.move(5, 5); await page.waitForTimeout(40);
    ops = await opState(page, "B", 0, "B1");
    check(browserName, `${tag} clicking B1's receiver marks its pump off through the application: bridge and session agree, the amber is gone and the receiver steps back, tracking untouched`,
      ops.app.pumpOff && ops.session.pumpOff && ops.drawn.pumpOff && ops.drawn.receiver === "off" && ops.control.pump === "true" && ops.drawn.coneFill !== runningCone && ops.drawn.receiverOpacity <= 0.5 && ops.app.track && ops.drawn.flow && !ops.pending && !ops.selected && ops.focus === null, ops);
    check(browserName, `${tag} under the pointer a stopped receiver comes part of the way back - the hover cue - and no further`, hovered.hover && hovered.drawn.receiverOpacity > ops.drawn.receiverOpacity && hovered.drawn.receiverOpacity < 1 && hovered.drawn.coneFill !== runningCone, { hovered: hovered.drawn, resting: ops.drawn });
    await clickCentre(page, controlSel("B", "B1", "pump"));
    await page.mouse.move(5, 5); await page.waitForTimeout(40);
    ops = await opState(page, "B", 0, "B1");
    check(browserName, `${tag} clicking the same place again marks the pump running: the amber is back`, !ops.app.pumpOff && !ops.session.pumpOff && !ops.drawn.pumpOff && ops.drawn.receiver === "on" && ops.control.pump === "false" && ops.drawn.coneFill === runningCone && ops.drawn.receiverOpacity === 1, ops);
    check(browserName, `${tag} no hover or pending state remains on the controls`, !ops.hover && !ops.pending, ops);

    /* ---- The Changeover Calculator ----
     * The header's CHANGEOVER readout is the launcher: a click opens the
     * surface in the utility slot, centred under the header and bounded
     * above the Handbook's share; Use sets the deadline through the
     * application; Close returns to the readout. */
    const calcState = () => page.evaluate(() => {
      const r = sel => { const el = document.querySelector(sel); return el ? el.getBoundingClientRect() : null; };
      const panel = document.querySelector(".station-changeover__panel");
      const readout = document.querySelector(".station-job__trigger[data-field='changeover']");
      const p = r(".station-changeover__panel"), header = r(".station-header"), stage = r(".station-machine"), hb = r(".station-handbook__panel");
      const body = document.querySelector(".station-changeover__body");
      const cs = panel ? getComputedStyle(panel) : null;
      return {
        open: !!panel && !panel.hidden && cs.display !== "none", expanded: readout.getAttribute("aria-expanded"), launched: readout.closest(".station-job__item").classList.contains("is-launched"),
        inUtility: !!panel.closest("[data-station-mount='utility']"), inlineEditor: !!document.querySelector(".station-job__item.is-editing"),
        belowHeader: p ? p.y - header.bottom : null, centred: p ? Math.abs((p.x + p.width / 2) - (stage.x + stage.width / 2)) : null,
        width: p ? p.width : null, height: p ? p.height : null, clipped: body.scrollHeight > body.clientHeight + 1,
        handbookOpen: !!hb && hb.width > 0, gap: hb && p ? hb.y - p.bottom : null,
        glass: cs ? [cs.backdropFilter || cs.webkitBackdropFilter, cs.backgroundColor] : null,
        readout: document.querySelectorAll(".station-job__value")[1].textContent,
        app: window.PolynStationStateBridge.getSnapshot().job.changeoverTime,
        legacy: document.getElementById("changeoverTime") ? document.getElementById("changeoverTime").value : null,
        estimate: document.querySelector(".station-changeover__result-time").textContent, ready: document.querySelector(".station-changeover__result").classList.contains("is-ready"),
        running: document.querySelector("[data-role='production-estimate']").textContent, note: document.querySelector(".station-changeover__note").textContent,
        focusInside: panel.contains(document.activeElement), focusOnReadout: document.activeElement === readout,
        stored: localStorage.getItem("resinTimer.changeoverWizard.v0.01"), record: localStorage.getItem("resinTimer.productionEstimate.v0.01")
      };
    });
    let calc = await calcState();
    check(browserName, `${tag} the calculator starts closed and the readout is its launcher`, !calc.open && calc.expanded === "false" && calc.inUtility && !calc.inlineEditor, calc);
    await page.click(".station-job__trigger[data-field='changeover']"); await page.waitForTimeout(450);
    calc = await calcState();
    check(browserName, `${tag} clicking the readout opens the glass surface under the header, centred, no field in the header, focus inside`,
      calc.open && calc.expanded === "true" && calc.launched && !calc.inlineEditor && Math.abs(calc.belowHeader - 12) < 1 && calc.centred < 1 && calc.width <= 820 && calc.height <= 308 && !calc.clipped && calc.focusInside && /blur/.test(calc.glass[0]), calc);
    await page.click(".station-handbook__launcher"); await page.waitForTimeout(450);
    calc = await calcState();
    check(browserName, `${tag} the Handbook opens beside it: both open, a gap between, neither clipped`, calc.open && calc.handbookOpen && calc.gap >= 11 && !calc.clipped, calc);
    await page.click(".station-handbook__panel [data-action='close-handbook']"); await page.waitForTimeout(450);
    // The answers, typed; the estimate follows live.
    const typeAnswer = async (field, value) => { const sel = `.station-changeover__form input[data-field='${field}']`; await page.fill(sel, ""); await page.type(sel, String(value)); };
    await typeAnswer("lineSpeed", 120); await typeAnswer("footagePerRoll", 1500); await typeAnswer("rollsLeft", 18); await typeAnswer("hours", 1); await typeAnswer("minutes", 0);
    await page.click(".station-changeover__form [data-field='numberUp'][data-value='3']");
    await page.click(".station-changeover__form [data-field='bothWinders'][data-value='true']");
    await page.waitForTimeout(60);
    calc = await calcState();
    const expectedClock = (() => { const d = new Date(Date.now() + 85 * 60000); return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); })();
    check(browserName, `${tag} the answers make a live estimate 85 minutes out, saved on the device under the wizard's own key`,
      calc.ready && calc.estimate === expectedClock && calc.stored && JSON.parse(calc.stored).lineSpeed === "120" && JSON.parse(calc.stored).numberUp === 3 && JSON.parse(calc.stored).bothWinders === true, { calc, expectedClock });
    await page.click("[data-action='use-estimate']"); await page.waitForTimeout(150);
    calc = await calcState();
    const hhmm = (() => { const d = new Date(Date.now() + 85 * 60000); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })();
    check(browserName, `${tag} Use sets the deadline through the application: the bridge, the legacy field and the header agree; the running estimate is recorded and shown`,
      (calc.app === hhmm || calc.app === hhmm.replace(/:(\d)(\d)$/, (m, a, b) => `:${a}${Number(b) - 1}`)) && calc.legacy === calc.app && /in 1h 2[45]m$/.test(calc.readout) && /^Est\. \d+ sets · \d+ rolls remaining$/.test(calc.running) && calc.record && /^Changeover set to /.test(calc.note), { calc, hhmm });
    await page.click("[data-action='close-changeover']"); await page.waitForTimeout(450);
    calc = await calcState();
    check(browserName, `${tag} Close returns to the compact readout, with the focus`, !calc.open && calc.expanded === "false" && !calc.launched && calc.focusOnReadout, calc);
    await page.keyboard.press("Enter"); await page.waitForTimeout(450);
    calc = await calcState();
    check(browserName, `${tag} Enter on the readout reopens it, answers kept`, calc.open && calc.ready, calc);
    await page.keyboard.press("Escape"); await page.waitForTimeout(450);
    calc = await calcState();
    check(browserName, `${tag} Escape inside closes it`, !calc.open, calc);

    /* ---- Tracking visuals ----
     * With the deadline 85 minutes out, A1 and C1 (500 lb at 216 lb/hr, 2.3
     * hours) are past their pump-off point; B1 (400 lb at 288 lb/hr, 1.4
     * hours) too; B2 (400 lb at 144 lb/hr) as well. The marks agree with the
     * application's own Timeline rows. */
    const trackingState = () => page.evaluate(() => {
      const hoppers = [...document.querySelectorAll(".station-layer:not(.is-dimmed) .station-hopper")];
      // The application's own Timeline rows (hidden under Station): late is
      // the row's class; a pumped-off row is "done" and never late.
      const rows = Object.fromEntries([...document.querySelectorAll(".resultRow")].map(r => [r.querySelector(".resultHopper").textContent.trim(), r.classList.contains("late") && !r.classList.contains("done")]));
      const obscured = [];
      for (const h of hoppers.filter(h => h.querySelector(".station-hopper__rundown"))) {
        // The flow box's own frame (its x/y/width/height, through the drawing's
        // matrix) - a nested svg's client rect reports its clipped content too.
        const flow = h.querySelector(".station-hopper__rundown");
        const m = flow.parentNode.getScreenCTM();
        const p1 = new DOMPoint(Number(flow.getAttribute("x")), Number(flow.getAttribute("y"))).matrixTransform(m);
        const p2 = new DOMPoint(Number(flow.getAttribute("x")) + Number(flow.getAttribute("width")), Number(flow.getAttribute("y")) + Number(flow.getAttribute("height"))).matrixTransform(m);
        const box = { x: p1.x, y: p1.y, right: p2.x, bottom: p2.y };
        // The readout, the receiver, the ports and the fill valve are never
        // under the flow; the hose is below the vessel, so it cannot be.
        for (const part of ["id", "pct", "resin", "receiver-cone", "port", "fill-valve", "hose-end"]) {
          const el = h.querySelector(`.station-hopper__${part}`); if (!el) continue;
          const b = el.getBoundingClientRect();
          if (b.width && b.height && !(b.right <= box.x || b.x >= box.right || b.bottom <= box.y || b.y >= box.bottom)) obscured.push(`${h.getAttribute("data-hopper")}:${part}`);
        }
      }
      return {
        overdue: hoppers.filter(h => h.classList.contains("is-overdue")).map(h => h.getAttribute("data-hopper")),
        tracked: hoppers.filter(h => h.classList.contains("is-tracking")).map(h => h.getAttribute("data-hopper")),
        agree: hoppers.filter(h => h.classList.contains("is-tracking") && !h.classList.contains("is-pump-off")).every(h => rows[h.getAttribute("data-hopper")] === h.classList.contains("is-overdue")),
        rows, obscured,
        overdueFill: hoppers.filter(h => h.classList.contains("is-overdue")).map(h => getComputedStyle(h.querySelector(".station-hopper__shell")).fill),
        plainFill: hoppers.filter(h => !h.classList.contains("is-overdue") && h.classList.contains("is-tracking")).map(h => getComputedStyle(h.querySelector(".station-hopper__shell")).fill),
        flowStroke: hoppers.filter(h => h.classList.contains("is-tracking")).map(h => getComputedStyle(h.querySelector(".station-hopper__rundown-chevrons")).stroke),
        flowAnimated: hoppers.filter(h => h.classList.contains("is-tracking")).every(h => getComputedStyle(h.querySelector(".station-hopper__rundown-flow")).animationName === "station-rundown-flow"),
        flowMoving: hoppers.filter(h => h.classList.contains("is-tracking")).map(h => getComputedStyle(h.querySelector(".station-hopper__rundown-flow")).transform)
      };
    });
    await page.waitForTimeout(100);
    let tv = await trackingState();
    check(browserName, `${tag} the overdue hoppers are the ones the application's own Timeline marks late; the wash tints them apart from the tracked ones; the flow obscures nothing`,
      tv.overdue.length >= 3 && tv.agree && tv.overdueFill.every(f => f !== tv.plainFill[0]) && tv.obscured.length === 0 && tv.flowAnimated, tv);
    await page.waitForTimeout(400);
    const flowed = await trackingState();
    check(browserName, `${tag} the flow moves on its own (CSS), no script`, flowed.flowMoving.length > 0 && flowed.flowMoving.some((t, i) => t !== tv.flowMoving[i]), { before: tv.flowMoving, after: flowed.flowMoving });
    // Hover over an overdue hopper: the outline lifts in the accent, the wash stays.
    await page.hover(hopperSel("A", "A1") + " .station-hopper__shell", { force: true }); await page.waitForTimeout(40);
    const hoveredOverdue = await page.evaluate(sel => { const h = document.querySelector(sel); const cs = getComputedStyle(h.querySelector(".station-hopper__shell")); return { overdue: h.classList.contains("is-overdue"), fill: cs.fill, stroke: cs.stroke }; }, hopperSel("A", "A1"));
    await page.mouse.move(5, 5);
    const restingOverdue = await page.evaluate(sel => { const h = document.querySelector(sel); const cs = getComputedStyle(h.querySelector(".station-hopper__shell")); return { fill: cs.fill, stroke: cs.stroke }; }, hopperSel("A", "A1"));
    check(browserName, `${tag} hovering an overdue hopper lifts its outline and keeps its wash`, hoveredOverdue.overdue && hoveredOverdue.fill === restingOverdue.fill && hoveredOverdue.stroke !== restingOverdue.stroke, { hoveredOverdue, restingOverdue });
    // Blend Edit turns layer A over and back: the marks are where they were.
    await page.click(".station-handbook__launcher"); await page.waitForTimeout(450);
    await page.click(".station-handbook__panel [data-action='blend-edit']"); await page.waitForTimeout(100);
    await page.click(".station-book__layer-chip[data-layer='A']"); await page.waitForTimeout(250);
    const flipped = await page.evaluate(() => ({ flipped: !!document.querySelector("[data-role='layer'][data-layer='A'].is-flipped"), card: !!document.querySelector("[data-role='layer'][data-layer='A'] .station-blend-card"), cardFlows: document.querySelectorAll(".station-blend-card .station-hopper__rundown").length, clusterHidden: getComputedStyle(document.querySelector("[data-role='layer'][data-layer='A'] .station-hopper-cluster")).display === "none" }));
    await page.click(".station-handbook__panel [data-action='done']"); await page.waitForTimeout(250);
    await page.click(".station-handbook__panel [data-action='close-handbook']"); await page.waitForTimeout(450);
    tv = await trackingState();
    check(browserName, `${tag} Blend Edit turns the layer over with no flow of the card's own, and back with the marks as they were`, flipped.flipped && flipped.card && flipped.cardFlows === 0 && flipped.clusterHidden && tv.overdue.includes("A1") && tv.agree, { flipped, tv });
    // Reduced motion: the flow stands, the marks stay, the calculator opens at once.
    await page.emulateMedia({ reducedMotion: "reduce" }); await page.waitForTimeout(60);
    const reduced = await page.evaluate(() => ({
      flows: document.querySelectorAll(".station-hopper.is-tracking .station-hopper__rundown").length,
      stilled: [...document.querySelectorAll(".station-hopper__rundown-flow")].every(el => getComputedStyle(el).animationName === "none"),
      overdue: document.querySelectorAll(".station-hopper.is-overdue").length
    }));
    await page.click(".station-job__trigger[data-field='changeover']"); await page.waitForTimeout(30);
    const reducedCalc = await page.evaluate(() => { const p = document.querySelector(".station-changeover__panel"); return { open: !p.hidden, animations: p.getAnimations ? p.getAnimations().length : 0 }; });
    await page.click("[data-action='close-changeover']"); await page.waitForTimeout(30);
    await page.emulateMedia({ reducedMotion: "no-preference" }); await page.waitForTimeout(60);
    check(browserName, `${tag} under reduced motion the flow stands still and stays, the marks stay, and the calculator opens without a flight`, reduced.flows >= 3 && reduced.stilled && reduced.overdue >= 3 && reducedCalc.open && reducedCalc.animations === 0, { reduced, reducedCalc });

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

    /* the same controls in the open layer: the drawn hopper toggles, the
     * rows carry nothing operational */
    await dispatchClick(page, ".station-editor__item[data-hopper='B2'] .station-editor__badge");
    let focusedOps = await opState(page, "B", 1, "B2");
    check(browserName, `${tag} the open layer's rows carry no tracking or pump control`, focusedOps.rowOps === 0 && focusedOps.selected, focusedOps);
    await clickCentre(page, controlSel("B", "B2", "pump"));
    await page.mouse.move(5, 5); await page.waitForTimeout(40);
    focusedOps = await opState(page, "B", 1, "B2");
    check(browserName, `${tag} the drawn receiver in the open layer marks B2's pump off through the application, leaves the layer open and the selection alone`,
      focusedOps.app.pumpOff && focusedOps.session.pumpOff && focusedOps.drawn.pumpOff && focusedOps.drawn.receiverOpacity <= 0.5 && (await stateOf(page)).focus === "B" && focusedOps.selected, focusedOps);
    await clickCentre(page, controlSel("B", "B2", "pump"));
    focusedOps = await opState(page, "B", 1, "B2");
    check(browserName, `${tag} and the same place toggles it back`, !focusedOps.app.pumpOff && !focusedOps.drawn.pumpOff && (await stateOf(page)).focus === "B" && focusedOps.selected, focusedOps);
    await clickCentre(page, controlSel("B", "B3", "tracking"));
    focusedOps = await opState(page, "B", 2, "B3");
    check(browserName, `${tag} the drawn body in the open layer tracks B3 and leaves the layer open`, focusedOps.app.track && focusedOps.legacyTrack === "true" && focusedOps.drawn.flow && (await stateOf(page)).focus === "B", focusedOps);
    await clickCentre(page, controlSel("B", "B3", "tracking"));
    focusedOps = await opState(page, "B", 2, "B3");
    check(browserName, `${tag} and again untracks it`, !focusedOps.app.track && !focusedOps.drawn.flow, focusedOps);

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
  await clickCentre(page, controlSel("B", "B2", "tracking"));
  const harnessOps = await page.evaluate(() => ({
    able: document.querySelector("[data-role='hopper'][data-hopper='B2'] [data-station-target='tracking']").getAttribute("data-able"),
    cursor: getComputedStyle(document.querySelector("[data-role='hopper'][data-hopper='B2'] [data-station-target='tracking'] .station-hit")).cursor,
    tracked: document.querySelector("[data-role='hopper'][data-hopper='B2']").classList.contains("is-tracking"),
    rowOps: document.querySelectorAll(".station-editor__op").length,
    note: document.querySelector(".station-editor__note").textContent
  }));
  check(browserName, "harness: the hopper controls are read-only - no offer, a plain cursor, a click changes nothing and says why",
    harnessOps.able === "false" && harnessOps.cursor === "default" && !harnessOps.tracked && harnessOps.rowOps === 0 && /no application is connected/.test(harnessOps.note), harnessOps);
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
