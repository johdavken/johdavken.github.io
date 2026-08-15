"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktopCss = fs.readFileSync("desktop.css", "utf8");

// Exactly two structural shells: desktop (fine pointer, wide) and the
// touch/mobile shell (everything else, any width). There is no third
// "tablet" mode anywhere in app.js - a coarse-pointer device gets the same
// DOM as a phone regardless of size. WIDE_TOUCH_QUERY is CSS-only: it
// widens presentation (spacing, sizing) within that one touch shell, and
// has no JS counterpart to stay in sync with, unlike DESKTOP_QUERY, which
// is duplicated verbatim between the stylesheet and app.js on purpose.
const DESKTOP_QUERY = "(min-width: 901px) and (pointer: fine)";
const WIDE_TOUCH_QUERY = "(min-width: 701px) and (pointer: coarse)";

// A tiny evaluator for the plain min-width/max-width/pointer conjunctions
// used throughout this file, so the acceptance scenarios below check real
// query semantics rather than hoping a substring is present somewhere.
function queryMatches(query, { width, pointer }){
  const minWidth = query.match(/min-width:\s*(\d+)px/);
  const maxWidth = query.match(/max-width:\s*(\d+)px/);
  const pointerCond = query.match(/pointer:\s*(\w+)/);
  if (minWidth && width < Number(minWidth[1])) return false;
  if (maxWidth && width > Number(maxWidth[1])) return false;
  if (pointerCond && pointer !== pointerCond[1]) return false;
  return true;
}

/* -----------------------------------------------------------------------
 *   Layout mode: binary, live, not captured once
 * --------------------------------------------------------------------- */

test("layout classification is exactly two-way: a desktop query requiring a fine pointer, and the compact-recipe width boundary - nothing else", () => {
  const block = app.slice(app.indexOf("const layoutModeQueries"), app.indexOf("function isDesktopLayout"));
  assert.ok(block.includes(`desktop: window.matchMedia("${DESKTOP_QUERY}")`), "the JS desktop query must require a fine pointer, matching the stylesheet's desktop shell");
  assert.match(block, /compactRecipe: window\.matchMedia\("\(max-width: 700px\)"\)/);
  // No third query. A coarse-pointer device of any width must fall through
  // to the same touch shell as a phone, not a JS-recognized "tablet" mode.
  assert.doesNotMatch(block, /tablet/i);
  // Frozen so nothing can swap a query out at runtime and desynchronise the
  // listener registered against it.
  assert.match(block, /Object\.freeze\(/);
});

test("there is no tablet concept anywhere in app.js - no mode enum, no body attribute, no third matchMedia query", () => {
  assert.doesNotMatch(app, /currentLayoutMode/);
  assert.doesNotMatch(app, /dataset\.layoutMode/);
  assert.doesNotMatch(app, /layoutModeQueries\.tablet/);
  assert.doesNotMatch(app, /tablet: window\.matchMedia/);
});

test("desktop requires a fine pointer, never by device, model or user-agent, so an ordinary desktop is unaffected while a wide coarse-pointer device is not swept in", () => {
  const block = app.slice(app.indexOf("const layoutModeQueries"), app.indexOf("function syncWorkspaceForViewport"));
  assert.match(block, /pointer: fine/);
  assert.doesNotMatch(app, /userAgent[^\n]*(Fold|Samsung|SM-F|Tablet|iPad)/i);
  // A touchscreen laptop reports a fine PRIMARY pointer, so `pointer` (not
  // `any-pointer`) is what keeps this off desktop.
  assert.doesNotMatch(styles, /any-pointer/);
});

// The exact scenarios that matter: a rotated/unfolded foldable must stay in
// the touch shell arbitrarily wide, and an ordinary desktop (fine pointer)
// must be completely unaffected at the same widths.
test("390/750/884/1104px coarse -> touch shell (isDesktopLayout false), 1104/1440px fine -> desktop shell (isDesktopLayout true)", () => {
  const cases = [
    [390, "coarse", false],
    [750, "coarse", false],
    [884, "coarse", false],
    [1104, "coarse", false],
    [1104, "fine", true],
    [1440, "fine", true]
  ];
  for (const [width, pointer, expectDesktop] of cases){
    assert.equal(queryMatches(DESKTOP_QUERY, { width, pointer }), expectDesktop, `${width}px ${pointer}: isDesktopLayout() should be ${expectDesktop}`);
  }
});

/* -----------------------------------------------------------------------
 *   One authoritative classification - no independent width-only checks
 * --------------------------------------------------------------------- */

// Every layout branch that used to re-derive "is this desktop" via its own
// fresh window.matchMedia("(min-width: 901px)") call - stale the moment the
// foldable fix needed a pointer condition too, and each one a place CSS and
// JS could disagree - now reads the one shared predicate instead.
test("isDesktopLayout() is the single predicate every structural renderer consults, not a fresh matchMedia call", () => {
  assert.match(app, /function isDesktopLayout\(\)\{\s*\n\s*return layoutModeQueries\.desktop\.matches;/);
  // None left outside the two canonical query definitions.
  const rawCalls = app.match(/window\.matchMedia\("[^"]+"\)/g) || [];
  assert.deepEqual(rawCalls.sort(), [
    `window.matchMedia("${DESKTOP_QUERY}")`,
    `window.matchMedia("(max-width: 700px)")`
  ].sort());
});

test("renderWeightsArea, renderSplitsArea's compact threshold, and applySurfaceStyle all consume the shared predicate", () => {
  const weightsFn = app.slice(app.indexOf("function renderWeightsArea()"), app.indexOf("function renderWeightsArea()") + 300);
  assert.match(weightsFn, /if \(!isDesktopLayout\(\)\)\{/);
  assert.match(app, /const compactMobileRecipe = layoutModeQueries\.compactRecipe\.matches;/);
  const surfaceFn = app.slice(app.indexOf("function applySurfaceStyle("), app.indexOf("function applyMobileTileStyle("));
  assert.match(surfaceFn, /const renderedSurfaceStyle = isDesktopLayout\(\)/);
});

test("the desktop/mobile popover split and the account-utility placement listener read the same shared query object, not a second independent one", () => {
  assert.match(app, /function isDesktopAccountPopover\(name = activeFooterSheetName\)\{\s*\n\s*return name === "account" && isDesktopLayout\(\);/);
  assert.match(app, /function isDesktopNotificationsPopover\(name = activeFooterSheetName\)\{\s*\n\s*return name === "notifications" && isDesktopLayout\(\);/);
  // This used to be its own fresh window.matchMedia("(min-width: 901px)")
  // with its own "change" listener - a second, independently-drifting
  // responsive system next to watchLayoutMode(). It now reuses the exact
  // same MediaQueryList object instead of re-deriving the boundary.
  assert.match(app, /const desktopUtilityMedia = layoutModeQueries\.desktop;/);
  assert.doesNotMatch(app, /desktopUtilityMedia = window\.matchMedia/);
});

/* -----------------------------------------------------------------------
 *   The Receiver Weights resize fix
 * --------------------------------------------------------------------- */

// renderWeightsArea() and renderSplitsArea() build structurally different DOM
// on each side of the desktop/touch boundary. Nothing re-ran them when the
// viewport crossed it, so the markup kept belonging to the previous shell -
// which is why Receiver Weights broke on resize and why only a reload
// restored it.
test("crossing the desktop/touch boundary rebuilds the surfaces whose markup depends on it", () => {
  const fn = app.slice(app.indexOf("function syncLayoutMode("), app.indexOf("function watchLayoutMode()"));
  assert.match(fn, /renderWeightsArea\(\);/);
  assert.match(fn, /renderSplitsArea\(\);/);
  assert.match(fn, /applySurfaceStyle\(state\.surfaceStyle\);/);
  // No dataset attribute is published - nothing in the CSS consumes one, so
  // there is nothing here for a "tablet" selector to ever key off.
  assert.doesNotMatch(fn, /dataset\.layoutMode/);
});

test("re-rendering happens only when the boundary is actually crossed, so ordinary resizes never interrupt typing", () => {
  const fn = app.slice(app.indexOf("function syncLayoutMode("), app.indexOf("function watchLayoutMode()"));
  // Compares what the DOM was last built for against the current binary
  // desktop/touch state, not a three-way mode.
  assert.match(fn, /const changed = desktop !== renderedIsDesktop \|\| compactRecipe !== renderedCompactRecipe;/);
  assert.match(fn, /if \(!changed \|\| !rerender\) return changed;/);
});

test("the initial render is recorded without a redundant rebuild at boot", () => {
  assert.match(app, /syncLayoutMode\(\{ rerender:false \}\);/);
});

test("breakpoint listeners are registered once, with a fallback for older WebViews", () => {
  const fn = app.slice(app.indexOf("function watchLayoutMode()"), app.indexOf("function syncWorkspaceForViewport()"));
  assert.match(fn, /Object\.values\(layoutModeQueries\)\.forEach/);
  assert.match(fn, /query\.addEventListener\("change", onChange\)/);
  assert.match(fn, /query\.addListener\(onChange\)/);
  // Wired exactly once, next to the existing resize handler rather than as a
  // second, competing responsive system.
  assert.equal((app.match(/\n    watchLayoutMode\(\);/g) || []).length, 1);
});

test("the structural rebuild is not driven by a per-pixel resize handler, and no reload is used to recover", () => {
  const fn = app.slice(app.indexOf("function syncLayoutMode("), app.indexOf("function watchLayoutMode()"));
  assert.doesNotMatch(fn, /location\.reload/);
  assert.doesNotMatch(app, /location\.reload\(\)/);
  // syncWorkspaceForViewport stays on resize; the rebuild does not.
  const resizeWiring = app.slice(app.indexOf('window.addEventListener("resize", syncWorkspaceForViewport)'), app.indexOf("setInterval(updateChangeoverCountdown"));
  assert.doesNotMatch(resizeWiring, /renderWeightsArea/);
});

/* -----------------------------------------------------------------------
 *   Wide-touch presentation - CSS-only, no structural shell
 * --------------------------------------------------------------------- */

test("the wide-touch presentation block is pure CSS with no JS counterpart - not a shell, not a mode", () => {
  assert.ok(styles.includes(`@media ${WIDE_TOUCH_QUERY}`), "expected a wide-touch presentation block keyed to this query");
  // No selector anywhere depends on a JS-computed attribute for this.
  assert.doesNotMatch(styles, /\[data-layout-mode/);
  // Floored at 701 so the compact phone Recipe treatment (<=700px) is
  // untouched. Deliberately uncapped above - a rotated foldable keeps this
  // presentation arbitrarily wide, as long as it stays coarse-pointer.
  const block = styles.slice(styles.indexOf(`@media ${WIDE_TOUCH_QUERY}`));
  assert.match(block, /#lineSetupBlock \.setupLineConfiguration\{/);
});

test("Line Setup uses the extra width instead of stretching the phone layout, and Receiver Weights keeps the full width below", () => {
  const block = styles.slice(styles.indexOf(`@media ${WIDE_TOUCH_QUERY}`));
  // Gauges and the read-only Overview side by side...
  assert.match(block, /grid-template-columns:minmax\(0,1\.35fr\) minmax\(0,1fr\);/);
  assert.match(block, /#lineSetupBlock \.setupTopRow\{ grid-column:1 \/ -1; \}/);
  // ...with the phone cap/centering undone rather than fought against.
  assert.match(block, /max-width:none;/);
  // Receiver Weights is never pushed into a narrow side column.
  assert.match(block, /#weightsBlock \.blockBody\{ max-width:none; \}/);
  assert.doesNotMatch(block, /overflow-x:\s*(auto|scroll)/);
});

test("Recipe keeps its matrix and only the resin name grows, tied to the density scale with a readable floor", () => {
  const block = styles.slice(styles.indexOf(`@media ${WIDE_TOUCH_QUERY}`));
  assert.match(block, /\.splitMatrixCell \.resinNameInput\{/);
  assert.match(block, /font-size:clamp\(16px, calc\(var\(--font-base\) \+ 2px\), 20px\);/);
  // The matrix structure, controls and tracking are deliberately untouched.
  assert.doesNotMatch(block, /\.splitsMatrix\b[^{]*\{[^}]*grid-template/);
  assert.doesNotMatch(block, /splitTrack|trackControl|splitPctControl/);
});

test("phone stays untouched, and every existing desktop rule still exists - only gated with the added pointer condition, never rewritten", () => {
  // The compact phone Recipe threshold is untouched by this work.
  assert.match(styles, /\.splitsMatrix\.compactMobileRecipe \.resinNameInput\{/);
  assert.match(app, /compactRecipe: window\.matchMedia\("\(max-width: 700px\)"\)/);
  // Desktop's own breakpoint content (the actual rules inside it) is
  // unchanged - only the query gained "and (pointer: fine)", uniformly,
  // everywhere it appears. A bare (min-width: 901px) with no pointer
  // condition would mean this specific rule still misclassifies a wide,
  // coarse-pointer foldable as desktop.
  const desktopBlocks = styles.match(/@media \(min-width:\s?901px\)[^{]*\{/g) || [];
  assert.ok(desktopBlocks.length >= 5, `expected multiple desktop-shell blocks, found ${desktopBlocks.length}`);
  for (const block of desktopBlocks){
    assert.match(block, /pointer: fine/, `${block} must require a fine pointer or it still treats a wide foldable as desktop`);
  }
  const desktopCssBlocks = desktopCss.match(/@media \(min-width:901px\)[^{]*\{/g) || [];
  assert.ok(desktopCssBlocks.length >= 2, `expected desktop.css's shell blocks, found ${desktopCssBlocks.length}`);
  for (const block of desktopCssBlocks){
    assert.match(block, /pointer: fine/, `${block} must require a fine pointer`);
  }
});

test("every widened touch-shell query is a strict OR-extension of its old narrow-width form - nothing that used to match stops matching", () => {
  // (max-width: 900px) OR (wide AND coarse). The comma is a real OR in CSS
  // media query lists, so every viewport that used to match the plain
  // max-width form still does, unconditionally - this can only ever add
  // the new wide+coarse case (folding it into the SAME touch shell, not a
  // separate one), never remove an existing narrow one.
  const widened = styles.match(/@media \(m[^{]*900px\)(?:, \([^{]*coarse\))?\{/g) || [];
  const stillNarrowOnly = widened.filter(q => !q.includes("coarse"));
  assert.equal(stillNarrowOnly.length, 0, `found a 900px-capped query never widened: ${stillNarrowOnly.join(", ")}`);
});

/* -----------------------------------------------------------------------
 *   Footer colour and silhouette
 * --------------------------------------------------------------------- */

// A steel-blue light-theme dock was tried and reverted: it read far too dark
// against the light page, and being much lighter than the panel tint it
// replaced it also dropped the icons below the 3:1 contrast floor, which had
// needed a compensating colour override. Both are gone - every theme keeps
// the original panel tint, and no theme-scoped dock colour exists at all.
test("the dock keeps one panel-tint background for every theme, with no theme-scoped colour override", () => {
  const dockRuleStart = styles.indexOf(".footerBar{", styles.indexOf(":root{--app-dock-height:64.8px}"));
  const dockRule = styles.slice(dockRuleStart, styles.indexOf("}", dockRuleStart));
  assert.match(dockRule, /background:color-mix\(in srgb,var\(--panelOpen\) 94%,transparent\);/);
  assert.doesNotMatch(styles, /body\[data-theme="[^"]+"\] \.footerBar/);
  assert.doesNotMatch(styles, /\.appDockControl[\s\S]{0,40}color:var\(--fg\)/);
});

test("the dock's bottom corners are square so no page background shows beside them, while the top keeps its raised ends", () => {
  const dockRuleStart = styles.indexOf(".footerBar{", styles.indexOf(":root{--app-dock-height:64.8px}"));
  const dockRule = styles.slice(dockRuleStart, styles.indexOf("}", dockRuleStart));
  assert.match(dockRule, /border-radius:0;/);
  assert.doesNotMatch(dockRule, /border-radius:0 0 \d+px/);
  // The top silhouette is untouched - still the masked raised ends.
  assert.match(styles, /\.footerBar::before\{\s*left:0;\s*-webkit-mask:radial-gradient\(24px 20px at 100% 0/);
  assert.match(styles, /\.footerBar::after\{\s*right:0;\s*-webkit-mask:radial-gradient\(24px 20px at 0 0/);
});
