"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = readStyles();
const windingTension = require("./winding-tension.js");

// New "Winding Tension" tool: the same Tools workflow as the existing
// calculators - a mobile tile, a desktop tab, a tabpanel with the shared
// header/grid/help treatment - with every number, the band table and both
// display roundings living in winding-tension.js, so app.js only moves
// values between the fields and the result surface.

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const nextFn = app.indexOf("\n  function ", start + 1);
  const nextLet = app.indexOf("\n  let ", start + 1);
  const candidates = [nextFn, nextLet].filter(index => index !== -1);
  const end = candidates.length ? Math.min(...candidates) : app.length;
  return app.slice(start, end);
}

function sectionBody(id){
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `Expected element with id="${id}"`);
  const sectionStart = html.lastIndexOf("<section", start);
  return html.slice(sectionStart, html.indexOf("</section>", sectionStart));
}

test("the calculation module is loaded as its own script, before app.js, under a cache tag", () => {
  assert.match(html, /<script src="winding-tension\.js\?v=[0-9.]+" defer><\/script>/);
  assert.ok(html.indexOf('src="winding-tension.js') < html.indexOf('src="app.js'),
    "app.js reads window.PolynWindingTension at start-up, so the module must load first");
  assert.match(app, /const windingTension = window\.PolynWindingTension;/);
});

test("Tools lists Winding Tension beside Short Footage on the touch home, with its own dual-glyph icon", () => {
  const tileStart = html.indexOf('data-mobile-tool-target="windingTensionTool"');
  assert.notEqual(tileStart, -1, "expected a Winding Tension mobile tool tile");
  const tile = html.slice(html.lastIndexOf("<button", tileStart), html.indexOf("</button>", tileStart));
  assert.match(tile, /<span>Winding Tension<\/span>/);
  assert.match(tile, /<small>Starting tension from gauge and roll width<\/small>/);
  assert.match(tile, /<g class="baseGlyph">/);
  assert.match(tile, /<g class="gruvboxSolidGlyph">/);
  assert.ok(html.indexOf('data-mobile-tool-target="shortFootageTool"') < tileStart
    && tileStart < html.indexOf('data-mobile-tool-target="hopperWeightTool"'),
    "Winding Tension sits between Short Footage and Hopper Weight");
});

test("a Winding Tension tab exists in the tools nav, immediately after Short Footage", () => {
  const navStart = html.indexOf('<nav class="toolsIndex"');
  const nav = html.slice(navStart, html.indexOf("</nav>", navStart));
  assert.match(nav, /id="shortFootageToolTab"[^]*id="windingTensionToolTab"[^]*id="hopperWeightToolTab"/);
  assert.match(nav, /id="windingTensionToolTab"[^>]*aria-controls="windingTensionTool"[^>]*data-tool-target="windingTensionTool"/);
  // Not desktop-excluded: Scan Recipe is the only tab carrying that marker.
  const tab = nav.slice(nav.indexOf('id="windingTensionToolTab"'));
  assert.doesNotMatch(tab.slice(0, tab.indexOf("</button>")), /toolsDesktopHidden/);
});

test("the panel uses the shared tool treatment: header, description, help disclosure, input grid", () => {
  const section = sectionBody("windingTensionTool");
  assert.match(section, /class="toolPanel toolWorkspacePanel"/);
  assert.match(section, /role="tabpanel" aria-labelledby="windingTensionToolTab windingTensionTitle"/);
  assert.match(section, /<header class="toolPanelHeader">/);
  assert.match(section, /<h2 id="windingTensionTitle" class="toolPanelTitle">Winding Tension<\/h2>/);
  assert.match(section, /<details class="toolInfoGuide">/);
  assert.match(section, /class="toolInputGrid toolInputGridThree mt10"/);
});

test("the three inputs are film thickness, roll width and ups, in that order, with mobile numeric keypads", () => {
  const section = sectionBody("windingTensionTool");
  const thickness = section.indexOf('id="windingFilmThickness"');
  const width = section.indexOf('id="windingRollWidth"');
  const ups = section.indexOf('id="windingUps"');
  assert.ok(thickness !== -1 && width !== -1 && ups !== -1);
  assert.ok(thickness < width && width < ups, "order must be thickness, width, ups");

  assert.match(section, /<label for="windingFilmThickness">Film thickness \(mil\)<\/label>/);
  assert.match(section, /<label for="windingRollWidth">Roll width \(in\)<\/label>/);
  assert.match(section, /<label for="windingUps">Number of ups<\/label>/);
  assert.match(section, /<input id="windingFilmThickness" type="text" inputmode="decimal"/);
  assert.match(section, /<input id="windingRollWidth" type="text" inputmode="decimal"/);
  assert.match(section, /<input id="windingUps" type="text" inputmode="numeric" value="1" \/>/);
  assert.match(section, /<div class="toolFieldHint">Width of one roll\.<\/div>/);
  assert.match(section, /<div class="toolFieldHint">Default 1<\/div>/);
});

test("the result surface reads target first, PLI beneath it, then min/target/max, then wind type and taper", () => {
  const section = sectionBody("windingTensionTool");
  const order = [
    'id="windingTensionTarget"',
    'id="windingTensionPli"',
    'id="windingTensionMin"',
    'id="windingTensionRangeTarget"',
    'id="windingTensionMax"',
    'id="windingTensionWind"',
    'id="windingTensionTaper"',
    'id="windingTensionNotice"'
  ].map(id => {
    const at = section.indexOf(id);
    assert.notEqual(at, -1, `missing ${id}`);
    return at;
  });
  for (let i = 1; i < order.length; i += 1){
    assert.ok(order[i - 1] < order[i], "result fields must appear in the specified reading order");
  }
  assert.match(section, /<div id="windingTensionResult" class="windingTensionResult mt10" aria-live="polite" hidden>/);
  assert.match(section, /<span>lbs<\/span>/);
});

test("the operator notice ships in the markup and is the module's own wording", () => {
  const section = sectionBody("windingTensionTool");
  const notice = section.slice(section.indexOf('id="windingTensionNotice"'));
  const text = notice.slice(notice.indexOf(">") + 1, notice.indexOf("</p>"));
  assert.equal(text, windingTension.NOTICE);
  assert.match(functionBody("updateWindingTensionCalculator"),
    /\$\("windingTensionNotice"\)\.textContent = windingTension\.NOTICE;/,
    "rendering must read the notice from the module rather than retyping it");
});

test("updateWindingTensionCalculator delegates to winding-tension.js instead of duplicating the band table", () => {
  const body = functionBody("updateWindingTensionCalculator");
  assert.match(body, /windingTension\.calculate\(\{/);
  assert.match(body, /filmThicknessMil: thicknessInput\.value/);
  assert.match(body, /rollWidthIn: widthInput\.value/);
  assert.match(body, /windingTension\.formatTension\(result\.target\)/);
  assert.match(body, /windingTension\.formatPli\(result\.pli\)/);
  // No PLI arithmetic, band edges or taper strings in app.js.
  assert.doesNotMatch(app, /0\.15[\s\S]{0,40}0\.20[\s\S]{0,40}Surface Wind Only/);
  assert.doesNotMatch(app, /30 – 50%/);
});

test("an empty or invalid entry hides the result instead of leaving a stale recommendation on screen", () => {
  const body = functionBody("updateWindingTensionCalculator");
  assert.match(body, /const withoutResult = message=>\{\s*resultEl\.hidden = true;/);
  assert.match(body, /if \(thicknessInput\.value\.trim\(\) === "" \|\| widthInput\.value\.trim\(\) === ""\)\{[^]*?withoutResult\("Enter film thickness and roll width\."\)/);
  assert.match(body, /if \(!result\.valid\)\{[^]*?withoutResult\(result\.errors\[0\]\)/);
  assert.match(body, /resultEl\.hidden = false;/);
});

test("each rejected field is marked invalid with its own message", () => {
  const body = functionBody("updateWindingTensionCalculator");
  assert.match(body, /\[thicknessInput, \/film thickness\/i\]/);
  assert.match(body, /\[widthInput, \/roll width\/i\]/);
  assert.match(body, /\[upsInput, \/ups\/i\]/);
  assert.match(body, /input\.setCustomValidity\(message\);/);
  assert.match(body, /input\.setAttribute\("aria-invalid", "true"\);/);
});

test("a blank ups field is treated as one up, not as an invalid entry", () => {
  assert.match(functionBody("updateWindingTensionCalculator"),
    /ups: upsInput\.value\.trim\(\) === "" \? 1 : upsInput\.value/);
});

test("Clear empties the entries, restores one up, and hides the result", () => {
  const body = functionBody("clearWindingTensionCalculator");
  assert.match(body, /thicknessInput\.value = "";/);
  assert.match(body, /widthInput\.value = "";/);
  assert.match(body, /upsInput\.value = "1";/);
  assert.match(body, /updateWindingTensionCalculator\(\);/,
    "re-running the calculator is what hides the result and restores the instruction");
  assert.match(html, /<button id="windingTensionClear" type="button" class="secondary">Clear<\/button>/);
});

test("input and Clear listeners are wired for all three fields", () => {
  assert.match(app, /\[\s*"windingFilmThickness",\s*"windingRollWidth",\s*"windingUps"\s*\]\.forEach\(id=>\$\(id\)\?\.addEventListener\("input", updateWindingTensionCalculator\)\);/);
  assert.match(app, /\$\("windingTensionClear"\)\?\.addEventListener\("click", clearWindingTensionCalculator\);/);
});

test("the result surface is revealed by clearing [hidden], never by a state class an ancestor carries", () => {
  // styles.css states [hidden]{display:none!important} once, globally - a
  // reveal that only flips an ancestor class would silently no-op.
  const rule = styles.slice(styles.indexOf(".windingTensionResult{"));
  assert.match(rule.slice(0, rule.indexOf("}") + 1), /display:grid;/);
  assert.doesNotMatch(styles, /\S+ \.windingTensionResult\{[^}]*display:(?!none)/);
});

test("the Clear button meets a glove-friendly target size on the touch shell", () => {
  assert.match(styles, /#toolsBlock \.toolActionRow button\{ min-height:44px; min-width:96px; \}/);
});

test("the tools nav, tab order and every other tool panel are untouched", () => {
  const navStart = html.indexOf('<nav class="toolsIndex"');
  const nav = html.slice(navStart, html.indexOf("</nav>", navStart));
  for (const id of ["shortFootageToolTab", "hopperWeightToolTab", "hopperVolumeWeightToolTab",
                    "resinLookupToolTab", "recipeScanToolTab", "bulkDensityMeasurementToolTab"]){
    assert.match(nav, new RegExp(`id="${id}"`));
  }
  assert.match(nav, /id="recipeScanToolTab" class="toolsIndexButton toolsDesktopHidden"/);
  assert.match(html, /<span class="toolsIndexDropdownLabel">Short Footage<\/span>/);
  assert.match(html, /<h1 id="mobileToolHeaderLabel">Short Footage<\/h1>/);
  assert.match(sectionBody("shortFootageTool"), /<strong id="shortFootageResult" class="mono">—<\/strong>/);
});
