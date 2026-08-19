"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const app=fs.readFileSync("app.js","utf8");
const styles=fs.readFileSync("styles.css","utf8");
const theme=fs.readFileSync("theme.css","utf8");

test("compact tracked cells have an animation-independent blue tint and two-pixel inset outline",()=>{
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\.tracked:not\(\.selected\)\{[\s\S]*?background:color-mix\(in srgb,#72b9e8 18%,var\(--compact-recipe-row-bg\)\);[\s\S]*?box-shadow:inset 0 0 0 2px #4d9bd0;/);
  assert.doesNotMatch(styles,/compactRecipeTrackTracer|compact-recipe-trace-angle/);
  assert.doesNotMatch(styles,/\.splitMatrixCell\.tracked:not\(\.selected\)::after/);
});

test("the active clock is a filled blue circular badge while the inactive control stays visible but subdued",()=>{
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitTrackButton\{[\s\S]*?color:var\(--muted\);[\s\S]*?opacity:\.58;/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitTrackButton\.active\{[\s\S]*?border-radius:50%;[\s\S]*?background:#397fae;[\s\S]*?color:#f6fbff;/);
  assert.match(styles,/@media \(prefers-reduced-motion:reduce\)\{\s*\.splitsMatrix\.compactMobileRecipe \.splitTrackButton\.active\{ animation:none; \}/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitCellHopperName\.smart\{ color:color-mix\(in srgb,#2f9e62 78%,var\(--text\)\); \}/);
});

test("the whole cell is the tracking target on every surface, gated on Summary view",()=>{
  assert.match(app,/function toggleTracking\(\)\{/);
  // One condition now, shared by every surface: tracking is what Summary
  // view is for, and never applies on Next, while selecting, or mid-
  // rearrange. Mobile reaches it the same way desktop does.
  assert.match(app,/td\.addEventListener\("click", event=>\{[\s\S]*?if \(!trackingView \|\| bulkMode \|\| hopperRearrangement\?\.active\) return;[\s\S]*?event\.target\.closest\("input,button,label,a,select,textarea"\)[\s\S]*?toggleTracking\(\);/);
  // The per-cell clock is gone from every surface - on a phone it was a
  // third of a ~59px cell, and dropping it is most of the room the resin
  // name needed to stop truncating.
  assert.match(styles,/#splitsArea\[data-recipe-view\] \.splitTrackControl,\s*\n#splitsArea\[data-recipe-view\] \.splitClearButton\{ display: none; \}/);
});

test("compact headers retain the layer letter but give the percentage the dominant treatment",()=>{
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitLayerTitle\{[\s\S]*?display:inline-flex;[\s\S]*?font-size:10px;/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitLayerPct input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\{[\s\S]*?font-size:16px;/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitColumnTotal\{[\s\S]*?font-size:8px;/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitColumnTotal\.warn\{ color:var\(--warn\); font-weight:900;/);
});

test("light-theme support contrast is scoped per palette, not painted into Dark or Gruvbox globally",()=>{
  assert.match(theme,/@media \(max-width:700px\)\{[\s\S]*?\[data-theme="light"\][\s\S]*?splitTrackButton:not\(\.active\)/);
  assert.match(theme,/@media \(max-width:700px\)\{[\s\S]*?\[data-theme="industrial-slate"\][\s\S]*?splitCopyBtn/);
  assert.match(theme,/@media \(max-width:700px\)\{[\s\S]*?\[data-theme="gruvbox-light"\][\s\S]*?splitCellHopperName/);
});

test("mobile toolbar uses Recipes and a clearly labeled More control with an accessible name",()=>{
  assert.match(app,/savedRecipesButton\.textContent="Recipes";/);
  assert.match(app,/<summary aria-label="More recipe actions"><svg[^>]*>[\s\S]*?<\/svg><span>More<\/span><\/summary>/);
  // Primary-row buttons live in .splitsMobilePrimaryRow, including More, so
  // the extra actions affordance does not consume a dedicated second row.
  assert.match(styles,/\.splitsMobilePrimaryRow button\.secondary,[\s\S]*?\.splitsMobilePrimaryRow \.splitsScanShortcut > summary\{[\s\S]*?height:42px;[\s\S]*?white-space:nowrap;/);
  assert.match(styles,/\.mobileRecipeMore > summary\{[\s\S]*?height:42px;/);
  assert.match(styles,/\.splitsMobilePrimaryRow \.mobileRecipeMore\{flex:1 1 0\}/);
});

test("layer controls describe matching rather than copying without changing the copyLayer operation",()=>{
  assert.match(app,/copyButton\.textContent = `Match \$\{copyFrom\}`;/);
  assert.match(app,/copyButton\.title = `Make Layer \$\{L\.name\} match Layer \$\{copyFrom\}`;/);
  assert.match(styles,/content:"Match " attr\(data-mobile-copy-source\)/);
  assert.match(app,/copyLayer\(copyFrom, L\.name\);/);
});

test("top-level mobile headers no longer act as the redundant Main-menu return control",()=>{
  assert.doesNotMatch(app,/target\.querySelector\(":scope > summary"\)\?\.setAttribute\("aria-label", "Main menu"\);/);
  assert.doesNotMatch(app,/target\.querySelector\(":scope > summary"\)\?\.setAttribute\("title", "Main menu"\);/);
  assert.match(styles,/workspacePanel\.mobile-active > summary::after\{ display:none; \}/);
});
