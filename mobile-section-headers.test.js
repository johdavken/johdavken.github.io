"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function panel(id, nextId){
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `expected ${id}`);
  const end = nextId ? html.indexOf(`id="${nextId}"`, start) : -1;
  return html.slice(start, end === -1 ? undefined : end);
}

test("top-level mobile section headers pair their decorative main-menu SVG with an accessible title", () => {
  const expected = [
    ["lineSetupBlock", "splitsBlock", "Line Setup"],
    ["splitsBlock", "resultsBlock", "Recipe"],
    ["resultsBlock", "lineSyncBlock", "Timeline"],
    ["lineSyncBlock", "toolsBlock", "RT Sync"],
    ["toolsBlock", "changelogBlock", "Tools"],
    ["changelogBlock", "sudoAccessBlock", "Changelog"]
  ];
  for (const [id, nextId, title] of expected){
    const source = panel(id, nextId);
    assert.match(source, /<svg class="mobileSectionHeaderIcon"[^>]*aria-hidden="true"/);
    assert.match(source, new RegExp(`<div class="layerTitle" role="heading" aria-level="1">${title}<\\/div>`));
  }
});

test("mobile top-level headers suppress the obsolete disclosure/grid affordance without becoming Main controls", () => {
  assert.match(styles, /workspacePanel\.mobile-active > summary::after\{ display:none; \}/);
  assert.match(styles, /workspacePanel\.mobile-active > summary \.chev\{ display:none; \}/);
  assert.match(styles, /mobileSectionHeaderIcon\{\s*display:block;[\s\S]*?width:26px;[\s\S]*?height:26px;/);
  assert.doesNotMatch(html, /id="mobileWorkspaceHome"/);
  assert.doesNotMatch(app, /\$\("mobileWorkspaceHome"\)/);
});

test("Tools' nested tool view hides its parent top-level header - Help has no nested view any more, so it keeps its own header inline like every other section", () => {
  assert.match(styles, /body\[data-mobile-tools="panel"\] #toolsBlock > summary\{ display:none; \}/);
  assert.doesNotMatch(styles, /data-mobile-help/);
});
