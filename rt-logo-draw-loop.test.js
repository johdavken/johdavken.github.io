"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const styles = fs.readFileSync("styles.css", "utf8");

// Option 9 from the animated-logo mockup round, chosen for real: the RT
// mark's 5 layer diamonds continuously re-trace their outline, fill solid,
// hold, fade, and restart, staggered so exactly one is always mid-draw.
// Applies to both places the mark appears (.resinToolsLogo on mobile,
// .resinToolsSidebarIcon on desktop) via the same shared selector the
// existing color rules already use.

function ruleFor(selector){
  const start = styles.indexOf(selector);
  assert.notEqual(start, -1, `expected a rule for ${selector}`);
  return styles.slice(start, styles.indexOf("}", start) + 1);
}

test("each layer's stroke color still matches its original fill color (color is now used for currentColor inside the keyframes)", () => {
  const expectations = {
    rtLayerRed: "var(--bad)", rtLayerOrange: "var(--orange)", rtLayerYellow: "var(--warn)",
    rtLayerGreen: "var(--ok)", rtLayerBlue: "var(--focus-border)"
  };
  for (const [layer, token] of Object.entries(expectations)){
    const rule = ruleFor(`:is(.resinToolsLogo,.resinToolsSidebarIcon) .${layer}{color:`);
    assert.match(rule, new RegExp(`color:${token.replace(/[()]/g, "\\$&")};stroke:${token.replace(/[()]/g, "\\$&")}`));
  }
});

test("stroke-dasharray matches the diamond path's real perimeter (measured via getTotalLength in a live browser: ~136.06), rounded up slightly so the traced outline closes with no gap", () => {
  const start = styles.indexOf(":is(.resinToolsLogo,.resinToolsSidebarIcon) .rtLayerRed,");
  assert.notEqual(start, -1);
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /stroke-dasharray:137;/);
  assert.match(rule, /stroke-dashoffset:137;/);
  assert.match(rule, /animation:rtLogoDrawLoop 3s ease-in-out infinite;/);
});

test("each of the 5 layers has its own staggered animation-delay, so exactly one is mid-draw at any moment instead of all 5 cycling in lockstep", () => {
  const delays = {
    rtLayerRed: "0s", rtLayerOrange: ".25s", rtLayerYellow: ".5s", rtLayerGreen: ".75s", rtLayerBlue: "1s"
  };
  const seen = new Set();
  for (const [layer, delay] of Object.entries(delays)){
    const rule = ruleFor(`:is(.resinToolsLogo,.resinToolsSidebarIcon) .${layer}{animation-delay:`);
    assert.match(rule, new RegExp(`animation-delay:${delay}`));
    seen.add(delay);
  }
  assert.equal(seen.size, 5, "no two layers share the same delay");
});

test("the keyframes draw the outline in, fill solid, hold, then fade out and reset - a full loop with no dead/static hold at the very end", () => {
  const start = styles.indexOf("@keyframes rtLogoDrawLoop{");
  assert.notEqual(start, -1);
  const rule = styles.slice(start, styles.indexOf("\n}", start) + 2);
  assert.match(rule, /0%\{ stroke-dashoffset:137; fill:transparent; opacity:1; \}/);
  assert.match(rule, /28%\{ stroke-dashoffset:0; fill:transparent; \}/, "outline finishes drawing before fill starts");
  assert.match(rule, /40%\{ stroke-dashoffset:0; fill:currentColor; \}/);
  assert.match(rule, /70%\{ stroke-dashoffset:0; fill:currentColor; opacity:1; \}/, "holds fully filled and opaque for a stretch");
  assert.match(rule, /88%\{ stroke-dashoffset:0; fill:currentColor; opacity:0; \}/);
  assert.match(rule, /100%\{ stroke-dashoffset:137; fill:transparent; opacity:0; \}/, "resets back to the 0% state so the loop is seamless");
});

test("applies to both places the mark appears - the mobile header logo and the desktop sidebar icon - via the same shared :is() selector already used for colors", () => {
  const start = styles.indexOf(":is(.resinToolsLogo,.resinToolsSidebarIcon) .rtLayerRed,");
  const rule = styles.slice(start, styles.indexOf("}", start) + 1);
  assert.match(rule, /:is\(\.resinToolsLogo,\.resinToolsSidebarIcon\) \.rtLayerRed,/);
  assert.match(rule, /:is\(\.resinToolsLogo,\.resinToolsSidebarIcon\) \.rtLayerBlue\{/);
});
