"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");
const { ruleIn, rulesUnder } = require("./css-media");

const app = fs.readFileSync("app.js", "utf8");
const styles = readStyles();

/* The phone-scoped rule for a selector, brace-matched.
 *
 * These lookups used to be styles.indexOf(selector, firstPhoneBlockOffset).
 * That assumed the first max-width:700px block was the only one, and that the
 * next occurrence of the selector after it was the phone override. Neither
 * holds: there are three such blocks, and most of these selectors also have a
 * top-level base rule sitting between the first block and the override - so
 * the assertions were reading the base rule and reporting the mobile layout
 * broken while it was fine. Ask for the rule under a phone media query
 * instead, and let it be found wherever it lives. */
function phoneRule(selector){
  const hit = ruleIn(styles, selector);
  assert.ok(hit, `no max-width:700px rule found for ${selector}`);
  return hit.body;
}

// Recipe Setup's mobile layer switcher went through two shapes before this
// one: originally a sticky pill tab strip, then a swipe/paged control
// (prev/next arrows, a badge, dot indicators) sitting in a row above the
// table. Both cost a full row of vertical space. This round (mockup option
// 05, "vertical edge rail") drops that row entirely: one button per layer,
// stacked in a vertical rail that sits beside the table instead of above
// it, in .splitsMobileLayerLayout (a flex row: the table's scroll
// container on the left, the rail on the right). Direct tap to any layer -
// no prev/next stepping. The underlying switch mechanism (showMobileLayer,
// the [data-layer-column] show/hide, the swipe listeners) is unchanged.

function fnBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected function ${name}`);
  const next = app.indexOf("\n      }", start);
  return app.slice(start, next === -1 ? undefined : next);
}

test("the old pager pieces are gone - no prev/next arrows, no badge, no dots", () => {
  assert.doesNotMatch(app, /splitsMobileLayerArrow/);
  assert.doesNotMatch(app, /splitsMobileLayerBadge/);
  assert.doesNotMatch(app, /splitsMobileLayerDot/);
  assert.doesNotMatch(app, /splitsMobileLayerCurrent/);
  assert.doesNotMatch(app, /mobileLayerPrev/);
  assert.doesNotMatch(app, /mobileLayerNext/);
});

test("one real button per layer, each with the layer's own name as its visible label and tracked in mobileLayerButtonEls keyed by layer name", () => {
  const start = app.indexOf("const mobileLayerButtonEls = new Map();");
  assert.notEqual(start, -1);
  const body = app.slice(start, app.indexOf("const scroll = document.createElement", start));
  assert.match(body, /btn\.className = "splitsMobileLayerRailBtn";/);
  assert.match(body, /btn\.textContent = L\.name;/);
  assert.match(body, /mobileLayerButtonEls\.set\(L\.name, btn\);/);
  assert.match(body, /btn\.addEventListener\("click", \(\)=> showMobileLayer\(L\.name\)\);/);
});

test("the rail is a role=group (not a tablist) with an aria-label, and each button reports its own selected state via aria-pressed rather than a separate live region", () => {
  assert.match(app, /mobileLayerNav\.setAttribute\("role", "group"\);/);
  assert.match(app, /mobileLayerNav\.setAttribute\("aria-label", "Choose layer"\);/);
  assert.match(app, /btn\.setAttribute\("aria-pressed", "false"\);/);
});

test("showMobileLayer updates the active button (class + aria-pressed) for every layer, same function the old pager and swipe both called", () => {
  const body = fnBody("showMobileLayer");
  assert.match(body, /activeMobileLayer = layerName;/);
  assert.match(body, /lastActiveMobileLayer = layerName;/);
  assert.match(body, /mobileLayerButtonEls\.forEach\(\(btn,name\)=>\{/);
  assert.match(body, /const active = name === activeMobileLayer;/);
  assert.match(body, /btn\.classList\.toggle\("active", active\);/);
  assert.match(body, /btn\.setAttribute\("aria-pressed", String\(active\)\);/);
});

test("swiping still drives the same showMobileLayer, unaffected by the pager-to-rail change", () => {
  assert.match(app, /showMobileLayer\(names\[nextIndex\]\);/);
});

test("the compact mobile matrix keeps all layer columns in the table and omits the rail", () => {
  const start = app.indexOf("mobileLayerLayout.className = \"splitsMobileLayerLayout\";");
  assert.notEqual(start, -1);
  const body = app.slice(start, start + 300);
  assert.match(body, /mobileLayerLayout\.append\(scroll\);/);
  assert.match(body, /if \(!compactMobileRecipe\) mobileLayerLayout\.append\(mobileLayerNav\);/);
  assert.match(body, /area\.appendChild\(mobileLayerLayout\);/);
});

test("compact mobile recipe actions follow the matrix while Edit values stay in the inline toolbar", () => {
  assert.match(app, /actionTray\.append\(mobileRearrangeContext\);/);
  assert.match(app, /area\.append\(actionTray\);/);
  assert.doesNotMatch(app, /mobileLayerLayout\.append\(actionTray\);/);
  assert.match(app, /area\.append\(toolbar\);/);
  assert.doesNotMatch(app, /mobileBulkEditSheet/);
  assert.match(app, /toast\.className="mobileRearrangeToast";/);
  assert.match(styles, /#splitsArea > \.splitsBulkBar\{[\s\S]*?position:static;[\s\S]*?order:-1;/);
});

test(".splitsMobileLayerRail is hidden by default (desktop) - same pattern the old .splitsMobileLayerNav used", () => {
  assert.match(styles, /\.splitsMobileLayerRail\{ display: none; \}/);
});

test("on mobile, .splitsMobileLayerLayout is a flex row (table content flexes to fill, rail stays a fixed-width column) - not the old stacked pager-above-table layout", () => {
  const layoutRule = phoneRule(".splitsMobileLayerLayout{");
  assert.match(layoutRule, /display: flex;/);
  const scrollRule = phoneRule(".splitsMobileLayerLayout .splitsMatrixScroll{");
  assert.match(scrollRule, /flex: 1;/);
  const railRule = phoneRule(".splitsMobileLayerRail{");
  assert.match(railRule, /flex-direction: column;/);
  assert.match(railRule, /flex: 0 0 auto;/);
});

test("rail buttons are squared off (var(--control-radius)) matching the layer-header chips, not fully round pills, and the active one is highlighted the same way as those chips (tinted background + focus-colored border)", () => {
  const btnRule = phoneRule(".splitsMobileLayerRailBtn{");
  assert.match(btnRule, /border-radius: var\(--control-radius\);/);
  const activeRule = phoneRule(".splitsMobileLayerRailBtn.active{");
  assert.match(activeRule, /border-color: var\(--focus-border\);/);
  assert.match(activeRule, /background: var\(--btn-primary-a\);/);
});

// --- Ghosted column-header letter dropped on mobile - the rail already shows the active layer ---

test("the big ghosted layer letter is hidden by default under the mobile breakpoint, and the header shrinks to reclaim its space", () => {
  const mobileBlock = rulesUnder(styles);
  assert.match(mobileBlock, /\.splitLayerTitle\{ display: none; \}/);
  const mainRule = phoneRule(".splitLayerMain{");
  assert.match(mainRule, /min-height: 0;/);
  const pctRule = phoneRule(".splitLayerPct{");
  assert.match(pctRule, /margin-top: 0;/);
});

test("bulk edit still needs the letter - it's the tap target for selecting an entire layer's hoppers - so it's restored to full size while bulk-editing is active", () => {
  const mobileBlock = rulesUnder(styles);
  assert.match(mobileBlock, /\.bulk-editing \.splitLayerTitle\{ display: inline-block; \}/);
  assert.match(mobileBlock, /\.bulk-editing \.splitLayerMain\{ min-height: 58px; \}/);
  assert.match(mobileBlock, /\.bulk-editing \.splitLayerPct\{ margin-top: 25px; \}/);
});

// --- Layer % + Copy: mockup option 10, "minimal ghost, no chip borders" ---

test("the layer header is a single full-width percentage row - no Copy column, and the running total row is dropped on mobile entirely", () => {
  const mobileBlock = rulesUnder(styles);
  const rule = phoneRule(".splitsMatrix th.splitLayerHeader.mobile-layer-active{");
  assert.match(rule, /display: grid;/);
  // Was `auto 1fr` / "pct copy", pairing the percentage with a Copy button.
  // Copy between layers is a desktop/tablet utility; on phones it lives in
  // the Edit toolbar, and the header button is hidden outright - so the
  // second column reserved nothing. Removing it was measured inert: every
  // element in the mobile Recipe panel kept its exact box.
  assert.match(rule, /grid-template-columns: 1fr;/);
  assert.match(rule, /grid-template-areas: "pct";/);
  assert.doesNotMatch(rule, /copy/, "the Copy column is a desktop/tablet concern, not a phone one");
  assert.doesNotMatch(rule, /total/);
  // Hopper 1 is auto-derived from Hoppers 2-6 (recomputeAutoH1, app.js), so
  // this readout almost always just repeats "100%" back at the operator -
  // the one time it wouldn't (H2-H6 over-allocated) is already surfaced by
  // the Recipe panel's Ready/N-error status pill and the notification
  // bell's invalidLayers list, both real validation surfaces this element
  // itself never was (app.js's own comment on it: "live working data, not
  // a validation message"). Tablet/desktop keep it (styles.css, the base
  // non-mobile .splitColumnTotal rule) - only mobile drops it, to reclaim
  // the row it used to occupy.
  assert.match(mobileBlock, /\.splitColumnTotal\{ display: none; \}/);
});

test("the phone stylesheet only hides the header Copy button - it never styles it", () => {
  // Copy between layers is desktop/tablet. If phone styling for it comes
  // back, either the button is being shown on phones again (a design change
  // worth noticing) or the rules are dead the way these were.
  const phone = rulesUnder(styles).replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...phone.matchAll(/([^{}]*)\{([^}]*)\}/g)]
    .filter(m => /splitCopyBtn/.test(m[1]))
    .map(m => m[1].replace(/\s+/g, " ").trim() + " {" + m[2].replace(/\s+/g, " ").trim() + "}");
  assert.deepEqual(rules, [".splitsMatrix.compactMobileRecipe .splitCopyBtn {display:none;}"]);
});

test("the grid display is scoped specifically enough to beat .splitsMatrix [data-layer-column].mobile-layer-active (shared with <td> body cells) - otherwise this silently stays display:table-cell", () => {
  const displayRuleStart = styles.indexOf("[data-layer-column].mobile-layer-active{ display: table-cell; }");
  assert.notEqual(displayRuleStart, -1, "expected the shared td/th visibility rule to still exist");
  assert.match(styles, /\.splitsMatrix th\.splitLayerHeader\.mobile-layer-active\{\s*\n\s*display: grid;/);
});

test("tablet and desktop keep the per-layer hopper Total exactly as before - only the mobile block above touches .splitColumnTotal", () => {
  // The base (theme-agnostic) rule, outside any media query, is what
  // tablet/desktop actually render - untouched by the mobile removal.
  assert.match(styles, /^\.splitColumnTotal\{/m);
  const baseStart = styles.search(/^\.splitColumnTotal\{/m);
  const baseRule = styles.slice(baseStart, styles.indexOf("}", baseStart) + 1);
  assert.doesNotMatch(baseRule, /display:\s*none/);
  assert.match(styles, /^\.splitColumnTotal\.warn\{ color: var\(--warn\); \}/m);
  // The three >=701px-scoped .splitColumnTotal rules (touch tablet, wide
  // desktop, short-tablet) are unaffected - none sits inside max-width:700px.
  const mobileBlock = rulesUnder(styles);
  const touchCount = (mobileBlock.match(/#splitsArea \.splitsMatrix \.splitColumnTotal\{/g) || []).length;
  assert.equal(touchCount, 0, "the tablet/desktop-scoped selector must not appear inside the phone block");
});

test("the percentage has no chip background/border - it reads as an inline-edit field via its own focus-colored underline, with a single light divider under the whole row", () => {
  const rowRule = phoneRule(".splitsMatrix th.splitLayerHeader.mobile-layer-active{");
  assert.match(rowRule, /border-bottom: 1px solid var\(--border\);/);
  const mainRule = phoneRule(".splitLayerMain{");
  assert.doesNotMatch(mainRule, /border:/);
  assert.doesNotMatch(mainRule, /background:/);
  const pctRule = phoneRule(".splitLayerPct{");
  assert.match(pctRule, /border-bottom: 2px solid var\(--focus-border\);/);
  // The Copy half of this test went with the button's phone styling.
});

test("the percentage input is deliberately large and bold on mobile (unlike the old chip design, which left the input at its compact desktop size) - no size=3 attribute is used to do this, it's pure CSS", () => {
  assert.doesNotMatch(app, /pctInput\.size = 3;/);
  const mobileBlock = rulesUnder(styles);
  const inputRuleStart = mobileBlock.indexOf('.splitLayerPct input:not([type="checkbox"]):not([type="radio"]){');
  assert.notEqual(inputRuleStart, -1);
  const inputRule = mobileBlock.slice(inputRuleStart, mobileBlock.indexOf("}", inputRuleStart) + 1);
  assert.match(inputRule, /min-height: 0;/);
  assert.match(inputRule, /padding: 0;/);
  assert.match(inputRule, /font-weight: 900;/);
  assert.match(inputRule, /color: var\(--text\);/);
});
