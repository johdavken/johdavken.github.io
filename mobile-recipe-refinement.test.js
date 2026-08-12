"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const app=fs.readFileSync("app.js","utf8");
const styles=fs.readFileSync("styles.css","utf8");

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

test("mobile toolbar uses Recipes and an icon-only More control with an accessible name",()=>{
  assert.match(app,/savedRecipesButton\.textContent="Recipes";/);
  assert.match(app,/<summary aria-label="More recipe actions"><svg[^>]*>[\s\S]*?<\/svg><\/summary>/);
  assert.doesNotMatch(app,/<\/svg><span>More<\/span><\/summary>/);
  // Primary-row buttons live in .splitsMobilePrimaryRow now (the old fixed
  // 4-column .splitsBulkModeBar grid was replaced by a two-tier layout -
  // see recipe-mobile-toolbar.test.js), same compact/nowrap treatment.
  assert.match(styles,/\.splitsMobilePrimaryRow button\.secondary,[\s\S]*?\.splitsMobilePrimaryRow \.splitsScanShortcut > summary\{[\s\S]*?height:42px;[\s\S]*?white-space:nowrap;/);
  assert.match(styles,/\.mobileRecipeMore > summary\{[\s\S]*?height:42px;/);
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
