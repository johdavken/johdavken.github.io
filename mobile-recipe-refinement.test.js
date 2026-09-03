"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const app=fs.readFileSync("app.js","utf8");
const styles=fs.readFileSync("styles.css","utf8");
const theme=fs.readFileSync("theme.css","utf8");

test("compact tracking is a plain theme-appropriate cell wash with a highlighted hopper badge",()=>{
  // Tracked cells read as a --ok wash over their own row fill. No dot, no
  // left bar - the hopper name stays its ordinary badge shape, just
  // recolored.
  assert.match(styles,/\.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\.tracked:not\(\.selected\)\{[\s\S]*?background:var\(--compact-recipe-row-bg\);[\s\S]*?border-color:var\(--row-border-2\);[\s\S]*?box-shadow:none;/);
  // A tracked cell selected in Edit keeps its ordinary surface under the selection outline.
  assert.match(styles,/\.bulk-editing \.splitsMatrix\.compactMobileRecipe \.splitMatrixCell\.tracked\.selected\{[\s\S]*?background:var\(--compact-recipe-row-bg\);/);
  assert.doesNotMatch(styles,/compactRecipeTrackTracer|compact-recipe-trace-angle/);
  assert.doesNotMatch(styles,/\.splitMatrixCell\.tracked:not\(\.selected\)::after/);
  // The tracked hopper-name badge itself highlights - no clock, no corner mark, no dot.
  assert.doesNotMatch(styles,/splitHopperTrackingClock/);
  assert.match(styles,/#splitsArea\[data-recipe-view="summary"\] \.splitsMatrix tbody \.splitMatrixCell\.tracked \.splitCellHopperName\{[\s\S]*?background:color-mix\(in srgb,var\(--ok\)/);
  assert.doesNotMatch(styles,/\.splitMatrixCell\.tracked::before/);
  assert.doesNotMatch(theme,/\.splitMatrixCell\.tracked \.splitCellHopperName\{/);
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

test("Industrial Slate retunes its near-black Changeover/Output values and workflow tile titles to slate blue across the whole touch shell, phone and tablet",()=>{
  // The retune lives in the same "(width <= 900px), pointer:coarse" range
  // styles.css uses to render this mobile-style home screen - NOT the
  // phone-only max-width:700px block - so tablets (701-900px) get it too.
  const anchor = theme.indexOf('[data-theme="industrial-slate"] .mobileProductionControls .gaugeTimeValue');
  assert.notEqual(anchor, -1);
  const start = theme.lastIndexOf('@media ', anchor);
  const mediaLine = theme.slice(start, theme.indexOf('{', start));
  assert.match(mediaLine, /@media \(width <= 900px\), \(min-width: 901px\) and \(pointer: coarse\)/);
  const block = theme.slice(start, theme.indexOf("\n}\n", start));
  // Changeover time / Output values (.mobileProductionControls
  // .gaugeTimeValue/.mobileLineRateReadout, styles.css color:var(--text))
  assert.match(block, /:where\(html, body\)\[data-theme="industrial-slate"\] \.mobileProductionControls \.gaugeTimeValue,\s*\n\s*:where\(html, body\)\[data-theme="industrial-slate"\] \.mobileProductionControls \.mobileLineRateReadout\{color:#4f6d8b\}/);
  // Un-selected workflow tile titles (Recipe/Timeline/Resin Totals/...) -
  // targets .workspaceNavButton span specifically, not the button, because
  // styles.css's .workspaceNavButton span{color:var(--text)} (inside the
  // shared max-width:900px/pointer:coarse block) is a later, equal-
  // specificity rule that wins over the button's own color:inherit - a
  // button-level override alone would never reach the visible text. Shares
  // one selector list with .helpPlayBanner strong (Request beta access), the
  // one row in this list that isn't a .workspaceNavButton.
  assert.match(block, /:where\(html, body\)\[data-theme="industrial-slate"\] \.workspaceNavButton:not\(\.active\) span,\s*\n\s*:where\(html, body\)\[data-theme="industrial-slate"\] \.helpPlayBanner strong\{color:#607d9b\}/);
  // Never touches the selected tile's own color:var(--title) treatment.
  assert.doesNotMatch(block, /industrial-slate"\] \.workspaceNavButton\.active/);
  // The phone-only compact-recipe retunes stay capped at max-width:700px -
  // the home-screen readouts are no longer in that block.
  const phoneStart = theme.lastIndexOf('@media (max-width:700px){', theme.indexOf('[data-theme="industrial-slate"] #splitsBlock'));
  assert.notEqual(phoneStart, -1);
  const phoneBlock = theme.slice(phoneStart, theme.indexOf("\n}\n", phoneStart));
  assert.doesNotMatch(phoneBlock, /\.mobileProductionControls \.gaugeTimeValue/);
  // And it's touch-only - desktop's own #lineSetupBlock .gaugeTimeValue
  // (styles.css, color:var(--text)) and the desktop sidebar rail are
  // untouched by this file entirely.
  assert.doesNotMatch(theme, /#lineSetupBlock \.gaugeTimeValue/);
});

test("the mobile toolbar has no overflow control left - Scan and Load fold into the tab-row icon cluster, no bar below the matrix",()=>{
  // The More control (and its accessible name) is gone - Clear Tracking
  // moved to Timeline's own Reset tracking control, and that was the last
  // thing keeping an overflow menu necessary here.
  assert.doesNotMatch(app,/aria-label="More recipe actions"/);
  assert.doesNotMatch(styles,/mobileRecipeMore/);
  // No lower action bar any more - Scan / Load are icon buttons in
  // #recipeHeaderActions beside the icon tabs.
  assert.doesNotMatch(styles,/splitsMobilePrimaryRow/);
  assert.doesNotMatch(app,/mobilePrimaryRow/);
  assert.match(styles,/#splitsBlock \.recipeHeaderActions > \.mobileScanIconAction > summary,\s*\n\s*#splitsBlock \.recipeHeaderActions > \.recipeHeaderMobileAction\{/);
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
