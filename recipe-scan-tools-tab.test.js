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

test("all three scan options are present; only Job Traveler is enabled, the other two are natively disabled (not just unwired)", () => {
  const sectionStart = html.indexOf('<section id="recipeScanTool"');
  const sectionEnd = html.indexOf("</section>", sectionStart);
  const section = html.slice(sectionStart, sectionEnd);

  const jobTraveler = section.match(/<button id="recipeScanJobTravelerBtn"[^>]*>/)[0];
  assert.doesNotMatch(jobTraveler, /disabled/);

  const dosingScreen = section.match(/<button id="recipeScanDosingScreenBtn"[^>]*>/)[0];
  assert.match(dosingScreen, /disabled/);

  const heatSheet = section.match(/<button id="recipeScanHeatSheetBtn"[^>]*>/)[0];
  assert.match(heatSheet, /disabled/);
});

test("each option has an adjacent description, matching the panel's stated purpose", () => {
  const sectionStart = html.indexOf('<section id="recipeScanTool"');
  const sectionEnd = html.indexOf("</section>", sectionStart);
  const section = html.slice(sectionStart, sectionEnd);
  const optionBlocks = section.match(/<div class="recipeScanOption">[\s\S]*?<\/div>/g);
  assert.equal(optionBlocks.length, 3);
  optionBlocks.forEach(block => {
    assert.match(block, /<button[^>]*>[^<]+<\/button>/);
    assert.match(block, /<p class="tiny muted">[^<]+<\/p>/);
  });
});
