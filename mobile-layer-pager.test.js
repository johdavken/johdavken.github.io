"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");

// Recipe Setup's mobile layer switcher was a sticky pill tab strip (one
// button per layer). Replaced with a swipe/paged control - prev/next
// arrows, a big current-layer badge, and position dots - because it stays
// a fixed size regardless of layer count instead of getting cramped at 5
// layers. The underlying switch mechanism (showMobileLayer, the
// [data-layer-column] show/hide, the swipe listeners) is unchanged. The
// pager itself is a bare row with no outer frame - just the individually
// styled arrow buttons and badge sitting directly above the layer table,
// not pinned while scrolling.

function fnBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected function ${name}`);
  const next = app.indexOf("\n      }", start);
  return app.slice(start, next === -1 ? undefined : next);
}

test("the old per-layer tab buttons are gone - no splitsMobileLayerButton, no role=tab, no tablist", () => {
  assert.doesNotMatch(app, /splitsMobileLayerButton/);
  assert.doesNotMatch(app, /mobileLayerButtons/);
  assert.doesNotMatch(app, /mobileLayerNav\.setAttribute\("role", "tablist"\)/);
});

test("the nav is a plain group: prev arrow, a current-layer badge+dots, next arrow, in that order", () => {
  const start = app.indexOf('mobileLayerNav.setAttribute("role", "group")');
  assert.notEqual(start, -1);
  const appendCall = app.indexOf("mobileLayerNav.append(", start);
  const appendLine = app.slice(appendCall, app.indexOf(";", appendCall) + 1);
  assert.match(appendLine, /mobileLayerNav\.append\(mobileLayerPrev, mobileLayerCurrent, mobileLayerNext\);/);
  assert.match(app, /mobileLayerPrev\.className = "splitsMobileLayerArrow";/);
  assert.match(app, /mobileLayerPrev\.textContent = "‹";/);
  assert.match(app, /mobileLayerPrev\.setAttribute\("aria-label", "Previous layer"\);/);
  assert.match(app, /mobileLayerNext\.className = "splitsMobileLayerArrow";/);
  assert.match(app, /mobileLayerNext\.textContent = "›";/);
  assert.match(app, /mobileLayerNext\.setAttribute\("aria-label", "Next layer"\);/);
});

test("the current-layer badge announces changes to screen readers, and the dots are decorative (aria-hidden) since the badge already carries the info", () => {
  assert.match(app, /mobileLayerBadge\.setAttribute\("aria-live", "polite"\);/);
  assert.match(app, /mobileLayerDots\.setAttribute\("aria-hidden", "true"\);/);
});

test("one dot is created per layer and tracked in mobileLayerDotEls, keyed by layer name - same map pattern the old tab buttons used", () => {
  assert.match(app, /const mobileLayerDotEls = new Map\(\);/);
  const start = app.indexOf("const mobileLayerDotEls = new Map();");
  const body = app.slice(start, app.indexOf("area.appendChild(mobileLayerNav);", start));
  assert.match(body, /dot\.className = "splitsMobileLayerDot";/);
  assert.match(body, /mobileLayerDotEls\.set\(L\.name, dot\);/);
});

test("showMobileLayer updates the badge text, the active dot, and disables an arrow at each end - same function the tab bar and swipe both called before", () => {
  const body = fnBody("showMobileLayer");
  assert.match(body, /activeMobileLayer = layerName;/);
  assert.match(body, /lastActiveMobileLayer = layerName;/);
  assert.match(body, /mobileLayerBadge\.textContent = activeMobileLayer;/);
  assert.match(body, /dot\.classList\.toggle\("active", name === activeMobileLayer\);/);
  assert.match(body, /mobileLayerPrev\.disabled = index <= 0;/);
  assert.match(body, /mobileLayerNext\.disabled = index === -1 \|\| index >= layerNames\.length - 1;/);
});

test("the arrows step to the adjacent layer and stop at the ends, without wrapping", () => {
  const prevStart = app.indexOf('mobileLayerPrev.addEventListener("click"');
  const prevBody = app.slice(prevStart, app.indexOf("});", prevStart));
  assert.match(prevBody, /if \(index > 0\) showMobileLayer\(layerNames\[index - 1\]\);/);
  const nextStart = app.indexOf('mobileLayerNext.addEventListener("click"');
  const nextBody = app.slice(nextStart, app.indexOf("});", nextStart));
  assert.match(nextBody, /if \(index !== -1 && index < layerNames\.length - 1\) showMobileLayer\(layerNames\[index \+ 1\]\);/);
});

test("swiping still drives the same showMobileLayer, unaffected by the tab-to-pager change", () => {
  assert.match(app, /showMobileLayer\(names\[nextIndex\]\);/);
});

test(".splitsMobileLayerNav is a centered flex row under the mobile breakpoint now, not the old fixed-column tab grid", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  assert.notEqual(mobileStart, -1);
  const ruleStart = styles.indexOf(".splitsMobileLayerNav{", mobileStart);
  assert.notEqual(ruleStart, -1);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.match(rule, /display: flex;/);
  assert.match(rule, /justify-content: center;/);
  assert.doesNotMatch(styles, /grid-template-columns: repeat\(var\(--mobile-layer-count/);
});

test("the pager has no outer frame - no border, background, box-shadow, or sticky positioning; only the individual arrow buttons and badge carry their own pill styling", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const ruleStart = styles.indexOf(".splitsMobileLayerNav{", mobileStart);
  const rule = styles.slice(ruleStart, styles.indexOf("}", ruleStart) + 1);
  assert.doesNotMatch(rule, /border:/);
  assert.doesNotMatch(rule, /background:/);
  assert.doesNotMatch(rule, /box-shadow:/);
  assert.doesNotMatch(rule, /position: sticky;/);
  assert.match(styles, /\.splitsMobileLayerArrow\{[^}]*border: 1px solid var\(--btn-secondary-border\);/);
  assert.match(styles, /\.splitsMobileLayerBadge\{[^}]*background: linear-gradient/);
});

test("the badge and dots exist as their own styled pieces", () => {
  assert.match(styles, /\.splitsMobileLayerBadge\{/);
  assert.match(styles, /\.splitsMobileLayerDots\{ display: flex; gap: 5px; \}/);
  assert.match(styles, /\.splitsMobileLayerDot\.active\{/);
});

// --- Ghosted column-header letter dropped on mobile to offset the pager's added height ---

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

// --- Layer % + Copy: two equal, squared-off chips side by side ---

test("the layer header becomes a grid pairing the percentage chip and the Copy chip side by side, with the (rare) hopper-total warning spanning full width beneath both", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  assert.notEqual(mobileStart, -1);
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const ruleStart = mobileBlock.indexOf(".splitsMatrix th.splitLayerHeader.mobile-layer-active{");
  assert.notEqual(ruleStart, -1);
  const rule = mobileBlock.slice(ruleStart, mobileBlock.indexOf("}", ruleStart) + 1);
  assert.match(rule, /display: grid;/);
  assert.match(rule, /grid-template-columns: 1fr 1fr;/);
  assert.match(rule, /grid-template-areas: "pct copy" "total total";/);
  assert.match(mobileBlock, /\.splitColumnTotal\{ grid-area: total; \}/);
});

test("the grid display is scoped specifically enough to beat .splitsMatrix [data-layer-column].mobile-layer-active (shared with <td> body cells) - otherwise this silently stays display:table-cell", () => {
  const displayRuleStart = styles.indexOf("[data-layer-column].mobile-layer-active{ display: table-cell; }");
  assert.notEqual(displayRuleStart, -1, "expected the shared td/th visibility rule to still exist");
  assert.match(styles, /\.splitsMatrix th\.splitLayerHeader\.mobile-layer-active\{\s*\n\s*display: grid;/);
});

test("a layer with no copy source (e.g. Layer A/B at 3 layers) collapses to a single full-width percentage chip instead of leaving an empty gap where Copy would be", () => {
  assert.match(app, /th\.classList\.toggle\("noCopy", !copyFrom\);/);
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const ruleStart = mobileBlock.indexOf(".splitsMatrix th.splitLayerHeader.noCopy.mobile-layer-active{");
  assert.notEqual(ruleStart, -1);
  const rule = mobileBlock.slice(ruleStart, mobileBlock.indexOf("}", ruleStart) + 1);
  assert.match(rule, /grid-template-columns: 1fr;/);
  assert.match(rule, /grid-template-areas: "pct" "total";/);
});

test("both chips are squared off (var(--control-radius), matching the stepper-style controls elsewhere) rather than fully rounded pills, with matching border/background so they read as one pair", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const pctChipStart = mobileBlock.indexOf("\n  .splitLayerMain{");
  const pctChip = mobileBlock.slice(pctChipStart, mobileBlock.indexOf("}", pctChipStart) + 1);
  assert.match(pctChip, /grid-area: pct;/);
  assert.match(pctChip, /border-radius: var\(--control-radius\);/);
  assert.match(pctChip, /border: 1px solid var\(--btn-secondary-border\);/);
  assert.match(pctChip, /background: var\(--btn-secondary-bg\);/);
  const copyChipStart = mobileBlock.indexOf("\n  .splitCopyBtn{");
  const copyChip = mobileBlock.slice(copyChipStart, mobileBlock.indexOf("}", copyChipStart) + 1);
  assert.match(copyChip, /grid-area: copy;/);
  assert.match(copyChip, /border-radius: var\(--control-radius\);/);
  assert.match(copyChip, /border: 1px solid var\(--btn-secondary-border\);/);
  assert.match(copyChip, /background: var\(--btn-secondary-bg\);/);
});

test("long Copy text truncates with an ellipsis instead of overflowing its half-width chip on a narrow phone", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const copyChipStart = mobileBlock.indexOf("\n  .splitCopyBtn{");
  const copyChip = mobileBlock.slice(copyChipStart, mobileBlock.indexOf("}", copyChipStart) + 1);
  assert.match(copyChip, /white-space: nowrap;/);
  assert.match(copyChip, /overflow: hidden;/);
  assert.match(copyChip, /text-overflow: ellipsis;/);
});

test("the percentage input keeps its existing compact desktop text sizing (no oversized box, no size=3 attribute) - the chip is what changed on mobile, not the input's own font/width", () => {
  assert.doesNotMatch(app, /pctInput\.size = 3;/);
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  assert.doesNotMatch(mobileBlock, /\.splitLayerPct input\{/);
});

test("the chip is genuinely compact - marginally taller than its own text, not inflated by the shared input's touch-target min-height/padding stacking on top of the chip's own padding", () => {
  const mobileStart = styles.indexOf("@media (max-width: 700px){");
  const mobileBlock = styles.slice(mobileStart, styles.indexOf("\n}\n", mobileStart));
  const mainRuleStart = mobileBlock.indexOf("\n  .splitLayerMain{");
  const mainRule = mobileBlock.slice(mainRuleStart, mobileBlock.indexOf("}", mainRuleStart) + 1);
  assert.match(mainRule, /padding: 6px;/);
  const inputRuleStart = mobileBlock.indexOf('.splitLayerPct input:not([type="checkbox"]):not([type="radio"]){');
  assert.notEqual(inputRuleStart, -1);
  const inputRule = mobileBlock.slice(inputRuleStart, mobileBlock.indexOf("}", inputRuleStart) + 1);
  assert.match(inputRule, /min-height: 0;/);
  assert.match(inputRule, /padding: 0;/);
});
