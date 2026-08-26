"use strict";

// Gruvbox swaps the app's 1.7px stroked line art for a solid filled glyph
// set - the defining trait of the classic terminal icon themes the existing
// .gruvboxIconDetail construction marks were already borrowed from.
//
// Both glyph sets ship in the markup so the swap stays a pure CSS concern:
// every 32x32 icon carries a <g class="baseGlyph"> (the original strokes)
// and a <g class="gruvboxSolidGlyph"> twin. Gruvbox hides the former and
// paints the latter; every other theme does the exact opposite and is
// completely unaffected.
//
// Both surfaces use the same "V1 Terminal" treatment from the design study:
// the glyph is painted bare, with no tile of its own, keeping whatever accent
// that section already had (--gruv-rail-* on the desktop rail, --tile-accent
// on the mobile home). Neither surface gains a background, so the whole
// change is stroke -> fill.
//
// See previews/gruvbox-icon-set-preview.html for the study these were
// chosen from.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktop = fs.readFileSync("desktop.css", "utf8");

const GRUVBOX_SCOPE = 'body:is([data-theme="gruvbox-dark"],[data-theme="gruvbox-light"])';

function iconSvgs(){
  return [...html.matchAll(/<svg(?![^>]*class="(?:resinToolsLogo|resinToolsSidebarIcon)")[^>]*viewBox="0 0 32 32"[^>]*>([\s\S]*?)<\/svg>/g)]
    .map(match => match[0]);
}

test("every 32x32 app icon ships both glyph sets - the stroked base and its solid gruvbox twin", () => {
  const svgs = iconSvgs().filter(svg => svg.includes("baseGlyph") || svg.includes("gruvboxSolidGlyph"));
  assert.equal(svgs.length, 24,
    "expected 7 workspace tile icons (Help's nav icon is gone, replaced by Changelog) + the mobile RT Sync shortcut + 7 mobile section header icons + 6 mobile tool tiles + 3 Play Store banner icon copies (one per state, now converted to the same 32x32 dual-glyph style)");
  for (const svg of svgs){
    assert.match(svg, /<g class="baseGlyph">/, `missing baseGlyph: ${svg.slice(0, 90)}`);
    assert.match(svg, /<g class="gruvboxSolidGlyph">/, `missing gruvboxSolidGlyph: ${svg.slice(0, 90)}`);
  }
});

test("all four icon families were converted, not just the workspace tiles", () => {
  const family = cls => (html.match(new RegExp(`<svg class="${cls}"[^>]*><g class="baseGlyph">`, "g")) || []).length;
  assert.equal(family("workspaceTileIcon"), 7);
  assert.equal(family("mobileSectionHeaderIcon"), 7);
  // One per Play Store banner state (request / pending / invited) - all
  // three copies converted from the old 24x24 solid-fill triangle to the
  // same 32x32 stroke/solid-twin style as everything else.
  assert.equal(family("helpPlayBannerIcon"), 3);
  const toolTiles = [...html.matchAll(/<button class="mobileToolTile"[\s\S]*?<\/button>/g)];
  assert.equal(toolTiles.length, 6);
  for (const [tile] of toolTiles){
    assert.match(tile, /<g class="gruvboxSolidGlyph">/, "every mobile tool tile carries the solid twin");
  }
});

test("the solid twin is fill-based, hidden by default, and only painted under the two gruvbox themes", () => {
  assert.match(styles, /\.gruvboxSolidGlyph\{display:none;fill:currentColor;stroke:none\}/,
    "solid glyphs must fill, not stroke - the base .workspaceTileIcon rule sets fill:none");
  assert.match(styles, new RegExp(`${escapeRe(GRUVBOX_SCOPE)} \\.gruvboxSolidGlyph\\{display:block\\}`));
  assert.match(styles, new RegExp(`${escapeRe(GRUVBOX_SCOPE)} \\.baseGlyph\\{display:none\\}`));
});

test("no other theme is touched - industrial-slate shares the desktop rail treatment but keeps the stroked art", () => {
  const swapRules = styles.split("\n").filter(line => /\.baseGlyph\{display:none\}|\.gruvboxSolidGlyph\{display:block\}/.test(line));
  assert.ok(swapRules.length >= 2, "expected the two swap rules");
  for (const rule of swapRules){
    assert.doesNotMatch(rule, /industrial-slate/,
      "the glyph swap must not leak into industrial-slate, which only shares the rail chrome");
    assert.doesNotMatch(rule, /data-theme="dark"|data-theme="light"/);
  }
});

test("V1 Terminal on desktop - the rail paints the glyph bare, with no tile of its own", () => {
  const railIconRule = desktop.slice(
    desktop.indexOf(`${GRUVBOX_SCOPE.slice(0, -1)},[data-theme="industrial-slate-dark"],[data-theme="industrial-slate"]) .workspaceNavButton .workspaceTileIcon{`)
  );
  const block = railIconRule.slice(0, railIconRule.indexOf("}") + 1);
  assert.match(block, /color:var\(--gruv-rail-paper\)/,
    "the rail keeps its own per-section --gruv-rail-* colouring");
  assert.doesNotMatch(block, /background:/, "V1 is a bare glyph - the desktop rail must not gain a tile");
});

test("V1 Terminal on mobile too - gruvbox adds no tile of its own behind the glyph", () => {
  // The shipped tile-style rule already zeroes the icon's background for
  // every style, including the "minimal" default. V1 simply leaves that
  // alone, so gruvbox must not reintroduce a background/border for it.
  const zeroing = styles.slice(styles.indexOf(`${GRUVBOX_SCOPE}[data-mobile-tile-style] .workspaceTileIcon{`));
  const block = zeroing.slice(0, zeroing.indexOf("}") + 1);
  assert.match(block, /background:transparent/);
  assert.match(block, /color:var\(--tile-accent\)/);

  const gruvboxIconRules = styles.split("\n")
    .filter(line => line.includes(GRUVBOX_SCOPE) && line.includes(".workspaceTileIcon"));
  for (const rule of gruvboxIconRules){
    assert.doesNotMatch(rule, /\.workspaceNavButton \.workspaceTileIcon\{/,
      "no gruvbox-only paper-tile override should remain - both surfaces paint the glyph bare");
  }
});

test("the base mobile icon rule still reads --tile-accent, so recolouring a section still recolours its glyph", () => {
  // Guards the same contract workspace-nav-theme-colors.test.js relies on.
  assert.match(styles, /\.workspaceTileIcon\{[^}]*color:var\(--tile-accent\)/);
});

test("Hopper Weight and Hopper Volume Weight still share one identical icon, solid set included", () => {
  const tile = target => {
    const start = html.indexOf(`data-mobile-tool-target="${target}"`);
    assert.notEqual(start, -1, `expected the ${target} tile`);
    return html.slice(start, html.indexOf("</button>", start));
  };
  const svgOf = markup => markup.match(/<svg[\s\S]*?<\/svg>/)[0];
  assert.equal(svgOf(tile("hopperVolumeWeightTool")), svgOf(tile("hopperWeightTool")),
    "the two hopper tools deliberately share a silhouette - the solid swap must not split them");
});

test("the stylesheet cache-bust version was bumped, so the swap actually reaches returning browsers", () => {
  const version = html.match(/href="styles\.css\?v=([\d.]+)"/);
  assert.ok(version, "expected a versioned styles.css link");
  assert.notEqual(version[1], "0.60.1", "styles.css changed - its ?v= must move with it");
});

function escapeRe(value){
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
