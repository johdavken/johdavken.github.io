"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktopStyles = fs.readFileSync("desktop.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function section(id){
  const start = html.indexOf(`<section id="${id}"`);
  assert.notEqual(start, -1, `missing ${id}`);
  return html.slice(start, html.indexOf("</section>", start));
}

test("every retained desktop tool has the same heading, description, divider, and help disclosure", () => {
  for (const id of ["shortFootageTool", "hopperWeightTool", "hopperVolumeWeightTool", "resinLookupTool", "bulkDensityMeasurementTool"]){
    const body = section(id);
    assert.match(body, /<header class="toolPanelHeader">/);
    assert.match(body, /class="toolPanelTitle"/);
    assert.match(body, /<details class="toolInfoGuide">/);
  }
  assert.match(styles, /\.toolPanelHeader\{[\s\S]*border-bottom:1px solid var\(--border\)/);
});

test("desktop content uses one left-aligned, responsive rail and shared calculator field/result patterns", () => {
  assert.match(desktopStyles, /#toolsBlock \.toolsWorkspaceContent\{width:min\(100%,1020px\)[\s\S]*justify-self:start/);
  assert.match(styles, /\.toolInputGrid\{[\s\S]*max-width:760px/);
  assert.match(styles, /\.toolResult\{[\s\S]*max-width:760px[\s\S]*background: var\(--readonly-bg\)/);
  assert.match(styles, /\.bulkDensityMeasurementWorkspace\{display:grid;gap:12px;max-width:760px\}/);
});

test("desktop Scan Recipe requests fall back to Short Footage without removing the touch scanner", () => {
  assert.match(app, /function availableToolTabs\(\)\{[\s\S]*toolsDesktopHidden/);
  assert.match(app, /if \(!availableTabs\.some\(tab=>tab\.dataset\.toolTarget === targetId\)\) targetId = "shortFootageTool";/);
  assert.match(app, /if \(desktop && !\$\("recipeScanTool"\)\?\.hidden\) selectToolPanel\("shortFootageTool"\);/);
  assert.match(html, /data-mobile-tool-target="recipeScanTool"/);
  for (const id of ["recipeScanJobTravelerBtn", "recipeScanDosingScreenBtn", "recipeScanHeatSheetBtn"]){
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("tools info disclosures use the Timeline guide's info glyph, not a text 'i' or ⓘ", () => {
  const timelineGlyph = html
    .slice(html.indexOf('id="timelineInfoGuide"'))
    .match(/<svg viewBox="0 0 24 24" aria-hidden="true">[\s\S]*?<\/svg>/)[0];
  const toolGuides = html.match(/<details class="toolInfoGuide"><summary[^>]*>[\s\S]*?<\/summary>/g);
  assert.equal(toolGuides.length, 5);
  toolGuides.forEach(guide => { assert.ok(guide.includes(timelineGlyph)); });
  const scanGuides = html.match(/<details class="recipeScanInfo">\s*<summary[^>]*>[\s\S]*?<\/summary>/g);
  assert.equal(scanGuides.length, 3);
  scanGuides.forEach(guide => { assert.ok(guide.includes(timelineGlyph)); });
  assert.match(styles, /\.toolInfoGuide > summary svg\{[\s\S]*stroke:currentColor/);
  assert.match(styles, /\.recipeScanInfo > summary svg\{[^}]*stroke:currentColor/);
});

test("the tool guide trigger carries no chip of its own - same bare 28px/20px muted treatment as the Timeline guide", () => {
  const trigger = styles.match(/\.toolInfoGuide > summary\{[^}]*\}/)[0];
  assert.match(trigger, /width:28px/);
  assert.match(trigger, /height:28px/);
  assert.match(trigger, /border:0/);
  assert.match(trigger, /background:transparent/);
  assert.match(trigger, /color:var\(--muted\)/);
  assert.doesNotMatch(trigger, /border:1px/);
  assert.match(styles, /\.toolInfoGuide > summary svg\{[^}]*width:20px/);
  assert.match(
    styles,
    /\.toolInfoGuide > summary:hover,\.toolInfoGuide\[open\] > summary,\s*\.toolInfoGuide > summary:focus-visible\{ color:var\(--title\); background:var\(--field-bg\); \}/
  );
});
