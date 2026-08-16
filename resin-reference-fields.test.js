"use strict";

// Resin Reference and Resin Database used to show Resin Code, Description,
// Density, Bulk Density, and Material Information. Description and Material
// Information were unneeded on-screen, and the display_description/
// information_description columns themselves have since been dropped from
// the resins table entirely (see the 202608160001 migration) - this file now
// covers the display-only removal; see resin-lookup.test.js/
// resin-catalog-service.test.js/resin-admin.test.js for the underlying data
// model no longer carrying either field at all.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function sectionBody(id){
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `Expected element with id="${id}"`);
  const sectionStart = html.lastIndexOf("<section", start);
  const sectionEnd = html.indexOf("</section>", sectionStart);
  return html.slice(sectionStart, sectionEnd);
}

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const nextFn = app.indexOf("\n  function ", start + 1);
  return app.slice(start, nextFn === -1 ? undefined : nextFn);
}

test("Resin Reference no longer shows Description or Material Information fields", () => {
  const section = sectionBody("resinLookupTool");
  assert.doesNotMatch(section, /id="resinLookupDescription"/);
  assert.doesNotMatch(section, /id="resinLookupInformation"/);
  assert.doesNotMatch(section, />Material information</);
  assert.doesNotMatch(section, /No additional material information is currently available\./);
});

test("Resin Reference keeps exactly Resin Code (search), Density (copy), and Bulk Density (copy)", () => {
  const section = sectionBody("resinLookupTool");
  assert.match(section, /id="resinLookupInput"/, "resin code search field");
  assert.match(section, /id="resinLookupDensity"[\s\S]*?id="copyResinDensity"[^>]*>Copy<\/button>/);
  assert.match(section, /id="resinLookupBulkDensity"[\s\S]*?id="copyResinBulkDensity"[^>]*>Copy<\/button>/);
});

test("Bulk Density's copy button starts disabled and readonly, matching the existing Density copy button", () => {
  const section = sectionBody("resinLookupTool");
  const bulkField = section.slice(section.indexOf('for="resinLookupBulkDensity"'));
  assert.match(bulkField, /id="resinLookupBulkDensity"[\s\S]*?readonly/);
  assert.match(bulkField, /<button id="copyResinBulkDensity" class="resinLookupCopyButton secondary" type="button" disabled>Copy<\/button>/);
});

test("renderResinLookupResult no longer touches the removed description/information elements, and now also drives the bulk-density copy button's enabled state", () => {
  const body = functionBody("renderResinLookupResult");
  assert.doesNotMatch(body, /resinLookupDescription|resinLookupInformation|getResinDetails/);
  assert.match(body, /bulkDensityEl\.value = result\.bulkDensity;/);
  assert.match(body, /const copyBulkButton = \$\("copyResinBulkDensity"\);/);
  assert.match(body, /copyBulkButton\.disabled = result\.bulkDensity === "Unknown";/);
});

test("copyResinLookupBulkDensity mirrors copyResinLookupDensity's copy-to-clipboard behavior, stripping the lb/ft³ unit suffix", () => {
  const body = functionBody("copyResinLookupBulkDensity");
  assert.match(body, /if \(bulkDensityEl\.value === "Unknown"\)\{/);
  assert.match(body, /const numericBulkDensity = bulkDensityEl\.value\.replace\(\/\\s\*lb\\\/ft³\$\/, ""\);/);
  assert.match(body, /const copied = await copyTextToClipboard\(numericBulkDensity\);/);
  assert.match(body, /bulkDensityEl\.classList\.toggle\("copied", copied\);/);
});

test("the bulk-density copy button is wired to copyResinLookupBulkDensity alongside the existing density copy button", () => {
  assert.match(app, /\$\("copyResinDensity"\)\?\.addEventListener\("click", copyResinLookupDensity\);\s*\n\s*\$\("copyResinBulkDensity"\)\?\.addEventListener\("click", copyResinLookupBulkDensity\);/);
});

test("the resin search suggestion dropdown shows only the resin code now - description is no longer stored at all, so there's nothing to show as a disambiguation hint", () => {
  const body = functionBody("updateResinLookup");
  assert.doesNotMatch(body, /display_description/);
  assert.match(body, /code\.textContent = resin\.resin_code;/);
  assert.match(app, /findResinSuggestions\(input\.value, 20, resinCatalogRecords\)/);
});

test("the copied-state visual feedback CSS applies to any readonly resin lookup value, not just density - so it also covers the new bulk density copy button", () => {
  const styles = fs.readFileSync("styles.css", "utf8");
  assert.match(styles, /input\.resinLookupValue\.copied\[readonly\]\{/);
  assert.doesNotMatch(styles, /\.resinLookupInformation textarea/);
});
