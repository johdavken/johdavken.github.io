"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("Scan Recipe is a fifth tab in the existing Tools tablist, using the same toolsIndexButton pattern as every other tool", () => {
  assert.match(html, /<button id="recipeScanToolTab" class="toolsIndexButton" type="button" role="tab" aria-selected="false" aria-controls="recipeScanTool" data-tool-target="recipeScanTool" tabindex="-1">Scan Recipe<\/button>/);
  // It must sit after Resin Lookup, inside the same <nav role="tablist">, so
  // the existing generic tab-switching JS (which queries .toolsIndexButton /
  // .toolWorkspacePanel dynamically) picks it up with no JS changes needed.
  const navStart = html.indexOf('<nav class="toolsIndex"');
  const navEnd = html.indexOf("</nav>", navStart);
  const nav = html.slice(navStart, navEnd);
  assert.match(nav, /resinLookupToolTab[\s\S]*recipeScanToolTab/);
});

test("the Scan Recipe panel matches the same toolPanel/toolWorkspacePanel structure as every other tool panel", () => {
  assert.match(html, /<section id="recipeScanTool" class="toolPanel toolWorkspacePanel" role="tabpanel" aria-labelledby="recipeScanToolTab recipeScanTitle" hidden>/);
});

test("the panel is clearly marked experimental, using the existing warning-pill convention rather than new styling", () => {
  const sectionStart = html.indexOf('<section id="recipeScanTool"');
  const sectionEnd = html.indexOf("</section>", sectionStart);
  const section = html.slice(sectionStart, sectionEnd);
  assert.match(section, /<span class="pill badge-warn">Experimental<\/span>/);
  assert.match(styles, /\.pill\.badge-warn\{/, "badge-warn must already exist - this feature reuses it rather than inventing new badge CSS");
});

test("all three scan options are present and enabled", () => {
  const sectionStart = html.indexOf('<section id="recipeScanTool"');
  const sectionEnd = html.indexOf("</section>", sectionStart);
  const section = html.slice(sectionStart, sectionEnd);

  const jobTraveler = section.match(/<button id="recipeScanJobTravelerBtn"[^>]*>/)[0];
  assert.doesNotMatch(jobTraveler, /disabled/);

  const dosingScreen = section.match(/<button id="recipeScanDosingScreenBtn"[^>]*>/)[0];
  assert.doesNotMatch(dosingScreen, /disabled/);

  const heatSheet = section.match(/<button id="recipeScanHeatSheetBtn"[^>]*>/)[0];
  assert.doesNotMatch(heatSheet, /disabled/);
});

test("each option has an adjacent info disclosure with real explanatory content, not just a bare 'see help' pointer", () => {
  const sectionStart = html.indexOf('<section id="recipeScanTool"');
  const sectionEnd = html.indexOf("</section>", sectionStart);
  const section = html.slice(sectionStart, sectionEnd);
  const optionBlocks = section.match(/<div class="recipeScanOption">[\s\S]*?<\/details>\s*<\/div>\s*<\/div>/g);
  assert.equal(optionBlocks.length, 3);
  optionBlocks.forEach(block => {
    assert.match(block, /<button[^>]*>[^<]+<\/button>/);
    assert.match(block, /<details class="recipeScanInfo">/);
    assert.match(block, /<summary aria-label="[^"]+ information" title="[^"]+ information">ⓘ<\/summary>/);
    assert.match(block, /<div class="recipeScanInfoPanel">\s*<p>[^<]+<\/p>/);
  });
});

test("all three options use the native <details>/<summary> disclosure pattern, one aria-labeled icon per option, not a new JS-driven tooltip", () => {
  const summaryPattern = /<summary aria-label="[^"]+ information" title="[^"]+ information">ⓘ<\/summary>/g;
  assert.equal((html.match(summaryPattern) || []).length, 3);
});

test("the info icon reuses Recipe Setup's existing ⓘ disclosure convention (app.js's splitsInfo) rather than inventing a new one", () => {
  const app = fs.readFileSync("app.js", "utf8");
  assert.match(app, /<summary aria-label="Recipe Setup information" title="Recipe Setup information">ⓘ<\/summary>/, "Recipe Setup's own icon, rendered by app.js, is the pattern this reuses");
  assert.match(styles, /\.recipeScanInfo > summary\{[^}]*border-radius:50%/, "must reuse the round-icon-button treatment, not a plain link/button");
});

// --- mobile status-bar scan shortcut -------------------------------------

test("the status-bar scan shortcut sits immediately to the left of the Timeline chip, icon-only (no text label - there's no room for one)", () => {
  const barStart = html.indexOf('<div class="workspaceStatusBar"');
  const barEnd = html.indexOf('<details class="statusPreferences"', barStart);
  const bar = html.slice(barStart, barEnd);
  assert.match(bar, /<details class="statusScanShortcut" id="statusScanShortcut">[\s\S]*?<div id="mobileTimelineToggle"/, "must appear before the Timeline chip in document order");
  const shortcutStart = bar.indexOf('<details class="statusScanShortcut"');
  const shortcutEnd = bar.indexOf("</details>", shortcutStart);
  const shortcut = bar.slice(shortcutStart, shortcutEnd);
  const summaryStart = shortcut.indexOf("<summary");
  const summaryEnd = shortcut.indexOf("</summary>", summaryStart);
  const summary = shortcut.slice(summaryStart, summaryEnd);
  assert.match(summary, /aria-label="Scan a recipe source" title="Scan a recipe source"/);
  assert.doesNotMatch(summary.replace(/<svg[\s\S]*?<\/svg>/, ""), />\s*[A-Za-z]/, "summary must carry only the icon, no visible text");
});

test("the shortcut panel offers all three scan modes, each wired through the same startScan button IDs recipe-scan-ui.js expects", () => {
  const shortcutStart = html.indexOf('<details class="statusScanShortcut"');
  const shortcutEnd = html.indexOf("</details>", shortcutStart);
  const shortcut = html.slice(shortcutStart, shortcutEnd);
  assert.match(shortcut, /<div class="statusScanShortcutPanel">/);
  assert.match(shortcut, /<button id="statusScanJobTravelerBtn" type="button">Scan Job Traveler<\/button>/);
  assert.match(shortcut, /<button id="statusScanDosingScreenBtn" type="button">Scan Dosing Screen<\/button>/);
  assert.match(shortcut, /<button id="statusScanHeatSheetBtn" type="button">Scan Heat Sheet<\/button>/);
});

test("the shortcut is hidden by default and only shown inside the existing mobile status-bar media query, same convention as the Timeline/Recipe chips", () => {
  assert.match(styles, /\.statusScanShortcut\{ display:none;/);
  const mobileStart = styles.indexOf('@media (max-width:900px)');
  const mobileEnd = styles.indexOf("\n}", mobileStart);
  const mobileBlock = styles.slice(mobileStart, mobileEnd);
  assert.match(mobileBlock, /\.statusScanShortcut\{ display:inline-block; \}/);
});
