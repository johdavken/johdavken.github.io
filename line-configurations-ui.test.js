"use strict";
const test=require("node:test"); const assert=require("node:assert/strict"); const fs=require("node:fs");
const html=fs.readFileSync("index.html","utf8"); const css=fs.readFileSync("styles.css","utf8"); const ui=fs.readFileSync("line-configurations-ui.js","utf8");
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
test("compact rows and editor use theme tokens and responsive wrapping",()=>{
  const start=css.indexOf(".lineConfigurationPanel{"); const block=css.slice(start,css.indexOf("@media",start)+500);
  assert.match(block,/var\(--row-bg\)/); assert.match(block,/var\(--focus-border\)/); assert.match(block,/var\(--radius-row\)/);
  assert.doesNotMatch(block,/#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.match(block,/@media \(max-width:760px\)/); assert.match(block,/grid-template-columns:minmax\(0,1fr\) auto/);
});
test("rows present identity first and configuration as quieter secondary text",()=>{
  assert.match(ui,/info\.className = "lineConfigurationRowInfo"/);
  assert.match(ui,/info\.append\(title, detail\)/);
  assert.match(ui,/detail\.textContent = `\$\{line\.layer_count\} layer/);
  assert.match(ui,/className="secondary lineConfigurationEdit"/);
});
