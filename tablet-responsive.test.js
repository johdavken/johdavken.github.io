"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const desktopCss = fs.readFileSync("desktop.css", "utf8");

// The tablet tier is expressed identically in CSS and JS on purpose - if the
// two ever drift, data-layout-mode would claim one thing while the
// stylesheet did another. Every test below reads these two constants.
// No upper width bound: an unfolded/rotated foldable must stay tablet no
// matter how wide it gets, as long as its primary pointer stays coarse.
const TABLET_QUERY = "(min-width: 701px) and (pointer: coarse)";
// A mouse always reports "fine", so requiring it here cannot regress an
// ordinary desktop - it only stops a wide *coarse* pointer being swept into
// the desktop shell, which is the actual >900px foldable bug.
const DESKTOP_QUERY = "(min-width: 901px) and (pointer: fine)";

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

function expectedMode(width, pointer){
  if (queryMatches(DESKTOP_QUERY, { width, pointer })) return "desktop";
  return queryMatches(TABLET_QUERY, { width, pointer }) ? "tablet" : "phone";
}

/* -----------------------------------------------------------------------
 *   Layout mode: live, not captured once
 * --------------------------------------------------------------------- */

test("layout mode is derived from matchMedia lists created once, covering desktop, tablet and the compact-recipe boundary", () => {
  const block = app.slice(app.indexOf("const layoutModeQueries"), app.indexOf("function currentLayoutMode"));
  assert.ok(block.includes(`desktop: window.matchMedia("${DESKTOP_QUERY}")`), "the JS desktop query must require a fine pointer, matching the stylesheet's desktop shell");
  assert.match(block, /compactRecipe: window\.matchMedia\("\(max-width: 700px\)"\)/);
  assert.ok(block.includes(`tablet: window.matchMedia("${TABLET_QUERY}")`), "the JS tablet query must match the stylesheet's tablet tier verbatim, with no upper width bound");
  // Frozen so nothing can swap a query out at runtime and desynchronise the
  // listeners registered against them.
  assert.match(block, /Object\.freeze\(/);
});

test("tablet is decided by pointer capability, never by device, model or user-agent, and has no upper width limit", () => {
  const block = app.slice(app.indexOf("const layoutModeQueries"), app.indexOf("function syncWorkspaceForViewport"));
  assert.match(block, /pointer: coarse/);
  assert.doesNotMatch(block, /max-width: 900px\)\s*and\s*\(pointer: coarse/, "tablet must not be capped at 900px - a rotated foldable has to stay tablet past that width");
  assert.doesNotMatch(app, /userAgent[^\n]*(Fold|Samsung|SM-F|Tablet|iPad)/i);
  // A touchscreen laptop reports a fine PRIMARY pointer, so `pointer` (not
  // `any-pointer`) is what keeps this off desktop.
  assert.doesNotMatch(styles, /any-pointer/);
});

test("desktop wins over tablet, and phone is the fallback - the three modes are mutually exclusive", () => {
  const fn = app.slice(app.indexOf("function currentLayoutMode()"), app.indexOf("// What the DOM was last"));
  assert.match(fn, /if \(layoutModeQueries\.desktop\.matches\) return "desktop";/);
  assert.match(fn, /return layoutModeQueries\.tablet\.matches \? "tablet" : "phone";/);
});

// The exact scenarios called out for this follow-up: a rotated/unfolded
// foldable must stay tablet arbitrarily wide, and an ordinary desktop
// (fine pointer) must be completely unaffected at the same widths.
test("390px coarse -> phone, 750/884/1104px coarse -> tablet, 1104/1440px fine -> desktop", () => {
  const cases = [
    [390, "coarse", "phone"],
    [750, "coarse", "tablet"],
    [884, "coarse", "tablet"],
    [1104, "coarse", "tablet"],
    [1104, "fine", "desktop"],
    [1440, "fine", "desktop"]
  ];
  for (const [width, pointer, expected] of cases){
    assert.equal(expectedMode(width, pointer), expected, `${width}px ${pointer} should resolve to ${expected}`);
  }
});

/* -----------------------------------------------------------------------
 *   One authoritative classification - no independent width-only checks
 * --------------------------------------------------------------------- */

// Every layout branch that used to re-derive "is this desktop" via its own
// fresh window.matchMedia("(min-width: 901px)") call - stale the moment the
// tablet fix needed a pointer condition too, and each one a place CSS and
// JS could disagree - now reads the one shared predicate instead.
test("isDesktopLayout() is the single predicate every structural renderer consults, not a fresh matchMedia call", () => {
  assert.match(app, /function isDesktopLayout\(\)\{\s*\n\s*return layoutModeQueries\.desktop\.matches;/);
  // None left outside the three canonical query definitions and the one
  // explanatory comment that quotes the old pattern as prose.
  const rawCalls = app.match(/window\.matchMedia\("[^"]+"\)/g) || [];
  assert.deepEqual(rawCalls.sort(), [
    `window.matchMedia("${DESKTOP_QUERY}")`,
    `window.matchMedia("(max-width: 700px)")`,
    `window.matchMedia("${TABLET_QUERY}")`
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
// on each side of a breakpoint. Nothing re-ran them when the viewport crossed
// one, so the markup kept belonging to the previous mode - which is why
// Receiver Weights broke on resize and why only a reload restored it.
test("crossing a breakpoint rebuilds the surfaces whose markup depends on it", () => {
  const fn = app.slice(app.indexOf("function syncLayoutMode("), app.indexOf("function watchLayoutMode()"));
  assert.match(fn, /renderWeightsArea\(\);/);
  assert.match(fn, /renderSplitsArea\(\);/);
  assert.match(fn, /applySurfaceStyle\(state\.surfaceStyle\);/);
  assert.match(fn, /document\.body\.dataset\.layoutMode = mode;/);
});

test("re-rendering happens only when a boundary is actually crossed, so ordinary resizes never interrupt typing", () => {
  const fn = app.slice(app.indexOf("function syncLayoutMode("), app.indexOf("function watchLayoutMode()"));
  // Compares the mode the DOM was built for against the current one.
  assert.match(fn, /const changed = mode !== renderedLayoutMode \|\| compactRecipe !== renderedCompactRecipe;/);
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
 *   The tablet stylesheet tier
 * --------------------------------------------------------------------- */

test("the tablet tier exists, sits inside the existing touch shell, and has no upper width bound", () => {
  assert.ok(styles.includes(`@media ${TABLET_QUERY}`), "expected a tablet tier keyed to the shared query");
  // Floored at 701 so the compact phone Recipe treatment (<=700px) is
  // untouched. Deliberately uncapped above - a rotated foldable must stay
  // tablet arbitrarily wide, as long as it stays coarse-pointer.
  const tier = styles.slice(styles.indexOf(`@media ${TABLET_QUERY}`));
  assert.match(tier, /#lineSetupBlock \.setupLineConfiguration\{/);
});

test("Line Setup uses the extra width instead of stretching the phone layout, and Receiver Weights keeps the full width below", () => {
  const tier = styles.slice(styles.indexOf(`@media ${TABLET_QUERY}`));
  // Gauges and the read-only Overview side by side...
  assert.match(tier, /grid-template-columns:minmax\(0,1\.35fr\) minmax\(0,1fr\);/);
  assert.match(tier, /#lineSetupBlock \.setupTopRow\{ grid-column:1 \/ -1; \}/);
  // ...with the phone cap/centering undone rather than fought against.
  assert.match(tier, /max-width:none;/);
  // Receiver Weights is never pushed into a narrow side column.
  assert.match(tier, /#weightsBlock \.blockBody\{ max-width:none; \}/);
  assert.doesNotMatch(tier, /overflow-x:\s*(auto|scroll)/);
});

test("Recipe keeps its matrix and only the resin name grows, tied to the density scale with a readable floor", () => {
  const tier = styles.slice(styles.indexOf(`@media ${TABLET_QUERY}`));
  assert.match(tier, /\.splitMatrixCell \.resinNameInput\{/);
  assert.match(tier, /font-size:clamp\(16px, calc\(var\(--font-base\) \+ 2px\), 20px\);/);
  // The matrix structure, controls and tracking are deliberately untouched.
  assert.doesNotMatch(tier, /\.splitsMatrix\b[^{]*\{[^}]*grid-template/);
  assert.doesNotMatch(tier, /splitTrack|trackControl|splitPctControl/);
});

test("phone stays untouched, and every existing desktop rule still exists - only gated with the added pointer condition, never rewritten", () => {
  // The compact phone Recipe threshold is untouched by this work.
  assert.match(styles, /\.splitsMatrix\.compactMobileRecipe \.resinNameInput\{/);
  assert.match(app, /compactRecipe: window\.matchMedia\("\(max-width: 700px\)"\)/);
  // Desktop's own breakpoint content (the actual rules inside it) is
  // unchanged - only the query gained "and (pointer: fine)", uniformly,
  // everywhere it appears. A bare (min-width: 901px) with no pointer
  // condition would mean this specific rule is still misclassifying a
  // wide, coarse-pointer foldable as desktop.
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
  // the new wide+coarse case, never remove an existing narrow one.
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
