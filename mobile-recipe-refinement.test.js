"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const app=fs.readFileSync("app.js","utf8");
const styles=fs.readFileSync("styles.css","utf8");
const theme=fs.readFileSync("theme.css","utf8");

test("compact tracking leaves cell highlighting to Edit and marks the notched hopper badge instead, tinted with the theme's own accent",()=>{
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\.tracked:not\(\.selected\)\{[\s\S]*?background:var\(--compact-recipe-row-bg\);[\s\S]*?border-color:var\(--row-border-2\);[\s\S]*?box-shadow:none;/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\.tracked \.splitCellHopperName\{[\s\S]*?min-width:30px;[\s\S]*?border-radius:4px 9px 9px 4px;[\s\S]*?background:color-mix\(in srgb,var\(--focus-border\) 22%,var\(--compact-recipe-row-bg\)\);/);
  assert.match(styles,/\.splitMatrixCell\.tracked \.splitCellHopperName::after\{[\s\S]*?position:absolute;[\s\S]*?right:3px;[\s\S]*?box-shadow:0 0 0 2px color-mix\(in srgb,var\(--focus-border\) 16%,transparent\);/);
  assert.doesNotMatch(styles,/compactRecipeTrackTracer|compact-recipe-trace-angle/);
  assert.doesNotMatch(styles,/\.splitMatrixCell\.tracked:not\(\.selected\)::after/);
  // Regression guard: this badge used to be hardcoded blue (#72b9e8/#397fae/
  // #4d9bd0) on every theme instead of following var(--focus-border) - see
  // recipe-tracking-badge-theme-colors.test.js for the full fix.
  assert.doesNotMatch(styles,/#72b9e8|#4d9bd0/);
});

test("compact Edit selection carries a small top-right EDIT tag in the outline color",()=>{
  assert.match(styles,/#splitsArea\[data-recipe-view="edit"\] \.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\.selected::after\{[\s\S]*?content:"EDIT";[\s\S]*?top:2px;[\s\S]*?right:3px;[\s\S]*?color:var\(--focus-border\);[\s\S]*?font-size:5px;/);
  assert.doesNotMatch(styles,/#splitsArea\[data-recipe-view="summary"\][^{]*\.splitMatrixCell\.selected::after/);
});

test("the active clock is a filled circular badge, tinted with the theme's own accent, while the inactive control stays visible but subdued",()=>{
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitTrackButton\{[\s\S]*?color:var\(--muted\);[\s\S]*?opacity:\.58;/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitTrackButton\.active\{[\s\S]*?border-radius:50%;[\s\S]*?background:var\(--focus-border\);[\s\S]*?color:#f6fbff;/);
  assert.match(styles,/@media \(prefers-reduced-motion:reduce\)\{\s*\.splitsMatrix\.compactMobileRecipe \.splitTrackButton\.active\{ animation:none; \}/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitCellHopperName\.smart\{ color:color-mix\(in srgb,#2f9e62 78%,var\(--text\)\); \}/);
});

test("the whole cell is the tracking target on every surface, gated on Summary view",()=>{
  assert.match(app,/function toggleTracking\(\)\{/);
  // One condition now, shared by every surface: tracking is what Summary
  // view is for, and never applies on Next, while selecting, or mid-
  // rearrange. Mobile reaches it the same way desktop does.
  // isOwnCellInteraction, not a bare closest() - a phone's percentage is
  // wrapped in a <label> whose field is inert, so the tag alone would make
  // the bottom half of every cell dead to tracking.
  assert.match(app,/td\.addEventListener\("click", event=>\{[\s\S]*?if \(!trackingView \|\| bulkMode \|\| hopperRearrangement\?\.active\) return;[\s\S]*?if \(isOwnCellInteraction\(event\.target\)\) return;[\s\S]*?toggleTracking\(\);/);
  // The per-cell clock is gone from every surface - on a phone it was a
  // third of a ~59px cell, and dropping it is most of the room the resin
  // name needed to stop truncating.
  assert.match(styles,/#splitsArea\[data-recipe-view\] \.splitTrackControl,\s*\n#splitsArea\[data-recipe-view\] \.splitClearButton\{ display: none; \}/);
});

test("compact headers retain the layer letter but give the percentage the dominant treatment",()=>{
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitLayerTitle\{[\s\S]*?display:inline-flex;[\s\S]*?font-size:10px;/);
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitLayerPct input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)\{[\s\S]*?font-size:16px;/);
  // The per-layer hopper Total is dropped on mobile entirely (see
  // .splitColumnTotal{display:none} in the same max-width:700px block) -
  // no compactMobileRecipe-scoped sizing/colour for it survives, since
  // nothing would ever read it.
  assert.doesNotMatch(styles,/\.splitsMatrix\.compactMobileRecipe \.splitColumnTotal\{/);
  assert.doesNotMatch(styles,/\.splitsMatrix\.compactMobileRecipe \.splitColumnTotal\.warn\{/);
});

test("light-theme support contrast is scoped per palette, not painted into Dark or Gruvbox globally",()=>{
  assert.match(theme,/@media \(max-width:700px\)\{[\s\S]*?\[data-theme="light"\][\s\S]*?splitTrackButton:not\(\.active\)/);
  assert.match(theme,/@media \(max-width:700px\)\{[\s\S]*?\[data-theme="industrial-slate"\][\s\S]*?splitCopyBtn/);
  assert.match(theme,/@media \(max-width:700px\)\{[\s\S]*?\[data-theme="gruvbox-light"\][\s\S]*?splitCellHopperName/);
});

test("the mobile toolbar has no overflow control left - Scan, Load Next-or-Current and Print all fit as primary slots",()=>{
  // The More control (and its accessible name) is gone along with it -
  // Clear Tracking moved to Timeline's own Reset tracking control, and
  // that was the last thing keeping an overflow menu necessary here.
  assert.doesNotMatch(app,/aria-label="More recipe actions"/);
  assert.doesNotMatch(styles,/mobileRecipeMore/);
  // Primary-row buttons still live in one row, .splitsMobilePrimaryRow.
  assert.match(styles,/\.splitsMobilePrimaryRow button\.secondary,[\s\S]*?\.splitsMobilePrimaryRow \.splitsScanShortcut > summary\{[\s\S]*?height:42px;[\s\S]*?white-space:nowrap;/);
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
