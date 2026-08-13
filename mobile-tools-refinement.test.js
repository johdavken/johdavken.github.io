"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

test("Resin Reference is the consistent user-facing Tools label without renaming its internal target", () => {
  assert.match(html, /data-mobile-tool-target="resinLookupTool"[\s\S]*?<span>Resin Reference<\/span><small>Codes, density and material information<\/small>/);
  assert.match(html, /id="resinLookupToolTab"[\s\S]*?>Resin Reference<\/button>/);
  assert.match(html, /id="resinLookupTitle" class="layerTitle">Resin Reference<\/div>/);
  assert.match(html, /resinLookupTool/);
});

test("mobile tool panels use one accessible Back to Tools header with the active tool as a heading", () => {
  const headerStart = html.indexOf('<div class="mobileToolHeader">');
  const header = html.slice(headerStart, html.indexOf("</div>", headerStart) + 6);
  assert.match(header, /id="mobileToolsBack"[^>]*aria-label="Back to Tools"/);
  assert.match(header, /<span>Tools<\/span>/);
  assert.match(header, /<h1 id="mobileToolHeaderLabel">Short Footage<\/h1>/);
  assert.match(styles, /body\[data-mobile-tools="panel"\] #toolsBlock > summary\{ display:none; \}/);
  assert.match(styles, /min-width:44px;/);
});

test("Production Summary has compact, shared recipe-percentage material presentation", () => {
  assert.match(styles, /\.productionSummaryStatus\{/);
  assert.match(styles, /\.productionSummaryMaterialRow\{min-height:38px/);
  assert.match(app, /productionSummaryMaterialRow/);
  assert.match(app, /Calculated from the current recipe percentages\./);
});
