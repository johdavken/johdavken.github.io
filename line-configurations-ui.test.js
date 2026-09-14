"use strict";
const test=require("node:test"); const assert=require("node:assert/strict"); const fs=require("node:fs");
const { readStyles } = require("./css-source");
const html=fs.readFileSync("index.html","utf8"); const css=readStyles(); const ui=fs.readFileSync("line-configurations-ui.js","utf8");
test("Line Configuration is an admin-gated Sudo destination and workspace panel",()=>{
  assert.match(html,/id="lineConfigurationButton"[^>]*class="footerAdminDestination sudoAccessAction"[^>]*data-admin-only="true"[^>]*data-workspace-target="lineConfigurationBlock"[^>]*hidden/);
  assert.match(html,/<details class="block card workspacePanel adminResinPanel" id="lineConfigurationBlock">/);
  assert.match(ui,/button\.hidden=!access/); assert.match(ui,/PolynResinAdminInstance/);
});
test("the editor reuses the admin dialog, button hierarchy, toggle, and compact selectable controls",()=>{
  assert.match(html,/id="lineConfigurationDialog" class="adminDialog lineConfigurationDialog"/);
  assert.match(html,/id="lineConfigurationForm" class="adminForm"/);
  assert.match(html,/id="lineConfigurationSave"[^>]*data-button-variant="primary"/);
  assert.match(html,/id="lineConfigurationCancel" class="secondary"/);
  assert.match(html,/id="lineConfigurationDeactivate" class="danger"/);
  assert.match(html,/id="lineConfigurationActive"[^>]*class="toggle"[^>]*role="switch"/);
  assert.doesNotMatch(html.slice(html.indexOf('id="lineConfigurationDialog"'),html.indexOf('</dialog>',html.indexOf('id="lineConfigurationDialog"'))),/<select/);
});
test("the list and rows reuse the Resin Database management surface classes",()=>{
  // Same bordered list container and row skin as Resin Database / Workspace
  // Management, so the three Sudo Access tools read as one design system
  // instead of a third card treatment.
  assert.match(html,/id="lineConfigurationList" class="lineConfigurationList adminResinList"/);
  assert.match(ui,/row\.className = `lineConfigurationRow adminResinRow\$\{line\.is_active \? "" : " inactive"\}`/);
  assert.match(css,/\.adminResinList\{[^}]*border: 1px solid var\(--border\)[^}]*\}/);
  assert.match(css,/\.adminResinRow\{[^}]*background: var\(--row-bg\)[^}]*border-radius: var\(--radius-row\)[^}]*\}/);
});
test("the panel flows from the intro copy without stretched dead space, and rows still use theme tokens and responsive wrapping",()=>{
  const start=css.indexOf(".lineConfigurationPanel{"); const block=css.slice(start,css.indexOf("@media",start)+500);
  // align-content:start stops the blockBody grid from sharing spare vertical
  // space between the intro, toolbar, and list tracks.
  assert.match(block,/\.lineConfigurationPanel\{display:grid;gap:12px;align-content:start\}/);
  assert.doesNotMatch(block,/#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(block,/@media \(max-width:760px\)/); assert.match(block,/grid-template-columns:minmax\(0,1fr\) auto/);
});
test("rows present identity first and configuration as quieter secondary text",()=>{
  assert.match(ui,/info\.className = "lineConfigurationRowInfo"/);
  assert.match(ui,/info\.append\(title, detail\)/);
  assert.match(ui,/detail\.textContent = `\$\{line\.layer_count\} layer/);
  assert.match(ui,/className="secondary lineConfigurationEdit"/);
});
test("hoppers per layer: one number a layer in the Line layout fieldset, following the Layers field, read into the save and shown on a row only when a layer is not six",()=>{
  const dialog=html.slice(html.indexOf('id="lineConfigurationDialog"'),html.indexOf('</dialog>',html.indexOf('id="lineConfigurationDialog"')));
  assert.match(dialog,/<legend>Line layout<\/legend>[\s\S]*id="lineConfigurationHopperCounts" class="lineConfigurationHopperCounts" role="group" aria-label="Hoppers per layer"/);
  assert.match(ui,/renderHopperCounts\(line\?\.layer_count \?\? 3, line\?\.hopper_counts\)/);
  assert.match(ui,/renderHopperCounts\(event\.target\.value, hopperCountValues\(\)\)/);
  assert.match(ui,/hopper_counts:hopperCountValues\(\)/);
  assert.match(ui,/input\.max = String\(identity\.MAX_HOPPERS_PER_LAYER\)/);
  assert.match(ui,/\$\{labelHoppers\(line\.hopper_counts\)\}/);
  assert.match(css,/\.lineConfigurationHopperCounts\{display:flex;flex-wrap:wrap;gap:6px\}/);
});
