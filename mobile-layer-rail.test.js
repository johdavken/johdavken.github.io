"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

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

test("compact mobile recipe actions sit immediately after the matrix while bulk values open in a dedicated sheet", () => {
  // The two-tier primary/secondary rows (built earlier, see the toolbar
  // tests) replace modeBar here - modeBar itself is desktop-only now.
  assert.match(app, /actionTray\.append\(mobilePrimaryRow, mobileSecondaryRow, mobileBulkContext, mobileRearrangeContext\);/);
  assert.match(app, /area\.append\(actionTray\);/);
  assert.doesNotMatch(app, /mobileLayerLayout\.append\(actionTray\);/);
  assert.match(app, /mobileBulkEditSheet\.querySelector\("\.mobileBulkEditBody"\)\.appendChild\(toolbar\);/);
  assert.match(app, /mobileBulkEditSheet\.showModal\(\);/);
  assert.match(app, /mobileSavedRecipesSheet\?\.showModal\(\);/);
  assert.match(app, /toast\.className="mobileRearrangeToast";/);
  assert.match(styles, /\.mobileBulkEditSheet \.splitsBulkBar/);
});

test(".splitsMobileLayerRail is hidden by default (desktop) - same pattern the old .splitsMobileLayerNav used", () => {
  assert.match(styles, /\.splitsMobileLayerRail\{ display: none; \}/);
});

test("on mobile, .splitsMobileLayerLayout is a flex row (table content flexes to fill, rail stays a fixed-width column) - not the old stacked pager-above-table layout", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  assert.notEqual(mobileStart, -1);
  const layoutStart = styles.indexOf(".splitsMobileLayerLayout{", mobileStart);
  assert.notEqual(layoutStart, -1);
  const layoutRule = styles.slice(layoutStart, styles.indexOf("}", layoutStart) + 1);
  assert.match(layoutRule, /display: flex;/);
  const scrollRuleStart = styles.indexOf(".splitsMobileLayerLayout .splitsMatrixScroll{", mobileStart);
  assert.notEqual(scrollRuleStart, -1);
  const scrollRule = styles.slice(scrollRuleStart, styles.indexOf("}", scrollRuleStart) + 1);
  assert.match(scrollRule, /flex: 1;/);
  const railRuleStart = styles.indexOf(".splitsMobileLayerRail{", mobileStart);
  assert.notEqual(railRuleStart, -1);
  const railRule = styles.slice(railRuleStart, styles.indexOf("}", railRuleStart) + 1);
  assert.match(railRule, /flex-direction: column;/);
  assert.match(railRule, /flex: 0 0 auto;/);
});

test("rail buttons are squared off (var(--control-radius)) matching the layer-header chips, not fully round pills, and the active one is highlighted the same way as those chips (tinted background + focus-colored border)", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const btnRuleStart = styles.indexOf(".splitsMobileLayerRailBtn{", mobileStart);
  assert.notEqual(btnRuleStart, -1);
  const btnRule = styles.slice(btnRuleStart, styles.indexOf("}", btnRuleStart) + 1);
  assert.match(btnRule, /border-radius: var\(--control-radius\);/);
  const activeRuleStart = styles.indexOf(".splitsMobileLayerRailBtn.active{", mobileStart);
  assert.notEqual(activeRuleStart, -1);
  const activeRule = styles.slice(activeRuleStart, styles.indexOf("}", activeRuleStart) + 1);
  assert.match(activeRule, /border-color: var\(--focus-border\);/);
  assert.match(activeRule, /background: var\(--btn-primary-a\);/);
});

// --- Ghosted column-header letter dropped on mobile - the rail already shows the active layer ---

test("the big ghosted layer letter is hidden by default under the mobile breakpoint, and the header shrinks to reclaim its space", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  assert.notEqual(mobileStart, -1);
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  assert.match(mobileBlock, /\.splitLayerTitle\{ display: none; \}/);
  const mainRuleStart = mobileBlock.indexOf("\n  .splitLayerMain{");
  assert.notEqual(mainRuleStart, -1);
  const mainRule = mobileBlock.slice(mainRuleStart, mobileBlock.indexOf("}", mainRuleStart) + 1);
  assert.match(mainRule, /min-height: 0;/);
  const pctRuleStart = mobileBlock.indexOf("\n  .splitLayerPct{");
  assert.notEqual(pctRuleStart, -1);
  const pctRule = mobileBlock.slice(pctRuleStart, mobileBlock.indexOf("}", pctRuleStart) + 1);
  assert.match(pctRule, /margin-top: 0;/);
});

test("bulk edit still needs the letter - it's the tap target for selecting an entire layer's hoppers - so it's restored to full size while bulk-editing is active", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  assert.match(mobileBlock, /\.bulk-editing \.splitLayerTitle\{ display: inline-block; \}/);
  assert.match(mobileBlock, /\.bulk-editing \.splitLayerMain\{ min-height: 58px; \}/);
  assert.match(mobileBlock, /\.bulk-editing \.splitLayerPct\{ margin-top: 25px; \}/);
});

// --- Layer % + Copy: mockup option 10, "minimal ghost, no chip borders" ---

test("the layer header becomes a grid pairing the percentage and Copy side by side, with the always-present running total spanning full width beneath both", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  assert.notEqual(mobileStart, -1);
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const ruleStart = mobileBlock.indexOf(".splitsMatrix th.splitLayerHeader.mobile-layer-active{");
  assert.notEqual(ruleStart, -1);
  const rule = mobileBlock.slice(ruleStart, mobileBlock.indexOf("}", ruleStart) + 1);
  assert.match(rule, /display: grid;/);
  assert.match(rule, /grid-template-columns: auto 1fr;/);
  assert.match(rule, /grid-template-areas: "pct copy" "total total";/);
  // The running total is live working data (a compact "Total 100%"), not a
  // validation message - it always renders, so it gets a permanent grid
  // area rather than the old hidden-when-valid row. The verbose explanation
  // of an off total still lives only in the notification bell.
  assert.match(mobileBlock, /\.splitColumnTotal\{ grid-area: total; margin-top: 0; \}/);
});

test("the grid display is scoped specifically enough to beat .splitsMatrix [data-layer-column].mobile-layer-active (shared with <td> body cells) - otherwise this silently stays display:table-cell", () => {
  const displayRuleStart = styles.indexOf("[data-layer-column].mobile-layer-active{ display: table-cell; }");
  assert.notEqual(displayRuleStart, -1, "expected the shared td/th visibility rule to still exist");
  assert.match(styles, /\.splitsMatrix th\.splitLayerHeader\.mobile-layer-active\{\s*\n\s*display: grid;/);
});

test("a layer with no copy source (e.g. Layer B at 3 layers) collapses to a single full-width percentage row instead of leaving an empty gap where Copy would be", () => {
  assert.match(app, /th\.classList\.toggle\("noCopy", !copyFrom\);/);
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const ruleStart = mobileBlock.indexOf(".splitsMatrix th.splitLayerHeader.noCopy.mobile-layer-active{");
  assert.notEqual(ruleStart, -1);
  const rule = mobileBlock.slice(ruleStart, mobileBlock.indexOf("}", ruleStart) + 1);
  assert.match(rule, /grid-template-columns: 1fr;/);
  assert.match(rule, /grid-template-areas: "pct" "total";/);
});

test("neither the percentage nor Copy has a chip background/border any more - the percentage reads as an inline-edit field via its own focus-colored underline, Copy is plain link-style text, and a single light divider sits under the whole row instead", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const rowRuleStart = mobileBlock.indexOf(".splitsMatrix th.splitLayerHeader.mobile-layer-active{");
  const rowRule = mobileBlock.slice(rowRuleStart, mobileBlock.indexOf("}", rowRuleStart) + 1);
  assert.match(rowRule, /border-bottom: 1px solid var\(--border\);/);
  const mainRuleStart = mobileBlock.indexOf("\n  .splitLayerMain{");
  const mainRule = mobileBlock.slice(mainRuleStart, mobileBlock.indexOf("}", mainRuleStart) + 1);
  assert.doesNotMatch(mainRule, /border:/);
  assert.doesNotMatch(mainRule, /background:/);
  const pctRuleStart = mobileBlock.indexOf("\n  .splitLayerPct{");
  const pctRule = mobileBlock.slice(pctRuleStart, mobileBlock.indexOf("}", pctRuleStart) + 1);
  assert.match(pctRule, /border-bottom: 2px solid var\(--focus-border\);/);
  const copyChipStart = mobileBlock.indexOf("\n  .splitCopyBtn{");
  const copyChip = mobileBlock.slice(copyChipStart, mobileBlock.indexOf("}", copyChipStart) + 1);
  assert.match(copyChip, /grid-area: copy;/);
  assert.match(copyChip, /border: none;/);
  assert.match(copyChip, /background: none;/);
  assert.match(copyChip, /justify-self: end;/);
});

test("Copy gets a subtle trailing arrow via ::after (decorative only - not part of the button's accessible text) to read as a tappable link", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const afterRuleStart = mobileBlock.indexOf(".splitCopyBtn::after{");
  assert.notEqual(afterRuleStart, -1);
  const afterRule = mobileBlock.slice(afterRuleStart, mobileBlock.indexOf("}", afterRuleStart) + 1);
  assert.match(afterRule, /content: " ›";/);
});

test("long Copy text still truncates with an ellipsis instead of overflowing on a narrow phone, even without a chip box constraining its width", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const copyChipStart = mobileBlock.indexOf("\n  .splitCopyBtn{");
  const copyChip = mobileBlock.slice(copyChipStart, mobileBlock.indexOf("}", copyChipStart) + 1);
  assert.match(copyChip, /white-space: nowrap;/);
  assert.match(copyChip, /overflow: hidden;/);
  assert.match(copyChip, /text-overflow: ellipsis;/);
});

test("the percentage input is deliberately large and bold on mobile (unlike the old chip design, which left the input at its compact desktop size) - no size=3 attribute is used to do this, it's pure CSS", () => {
  assert.doesNotMatch(app, /pctInput\.size = 3;/);
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const inputRuleStart = mobileBlock.indexOf('.splitLayerPct input:not([type="checkbox"]):not([type="radio"]){');
  assert.notEqual(inputRuleStart, -1);
  const inputRule = mobileBlock.slice(inputRuleStart, mobileBlock.indexOf("}", inputRuleStart) + 1);
  assert.match(inputRule, /min-height: 0;/);
  assert.match(inputRule, /padding: 0;/);
  assert.match(inputRule, /font-weight: 900;/);
  assert.match(inputRule, /color: var\(--text\);/);
});
