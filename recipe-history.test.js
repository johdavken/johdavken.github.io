"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const { readStyles } = require("./css-source");

const app=fs.readFileSync("app.js","utf8");
const styles=readStyles();

function editor(){
  const start=app.indexOf("    function renderSplitsArea(){");
  const end=app.indexOf("    function renderResinCalculator(){",start);
  assert.ok(start>-1&&end>start,"expected Recipe editor");
  return app.slice(start,end);
}

test("Recipe history keeps Current and Next independent, bounded, and restores a full recipe snapshot",()=>{
  assert.match(app,/const RECIPE_HISTORY_LIMIT = 40;/);
  assert.match(app,/const recipeEditHistory = \{ current:\{undo:\[\],redo:\[\]\}, next:\{undo:\[\],redo:\[\]\} \};/);
  assert.match(app,/function recipeEditHistoryKey\(\)\{ return isNextRecipePage\(\) \? "next" : "current"; \}/);
  assert.match(app,/function snapshotRecipeEdit\(\)\{[\s\S]*?layers:cloneRecipeLayers\(recipeLayers\(\)\),[\s\S]*?lots:\{\.\.\.\(next \? state\.nextRecipeLots : state\.resinLots \|\| \{\}\)\}/);
  assert.match(app,/if \(history\.undo\.length > RECIPE_HISTORY_LIMIT\) history\.undo\.shift\(\);/);
  assert.match(app,/history\.redo\.length = 0;/);
  assert.match(app,/function undoRecipeEdit\(\)\{[\s\S]*?history\.redo\.push\(snapshotRecipeEdit\(\)\);[\s\S]*?applyRecipeEditSnapshot\(previous\);/);
  assert.match(app,/function redoRecipeEdit\(\)\{[\s\S]*?history\.undo\.push\(snapshotRecipeEdit\(\)\);[\s\S]*?applyRecipeEditSnapshot\(next\);/);
});

test("recipe replacement drops only the history for the document being replaced",()=>{
  assert.match(app,/function discardRecipeEditHistory\(page=recipeEditHistoryKey\(\)\)\{[\s\S]*?history\.undo\.length=0;[\s\S]*?history\.redo\.length=0;/);
  assert.match(app,/state\.resinLots=rekeyLotMap\(lotByResin\);\s*discardRecipeEditHistory\("current"\);/);
  assert.match(app,/state\.nextRecipeLots=rekeyLotMap\(lotByResin\);\s*discardRecipeEditHistory\("next"\);/);
});

test("Edit replaces the selected-hopper count with compact, accessible undo and redo icons",()=>{
  const body=editor();
  // .recipeEditHistory is the pill row's first child now - Undo/Redo lead
  // the right-hand group (Rearrange / Undo / Redo / Clear / Empty / Reset
  // once JS prepends Rearrange). They are still icon+label buttons in the
  // markup; the desktop CSS shows the label, the phone icon rail hides it.
  const primaryStart=body.indexOf('<div class="splitsEditRow splitsEditRowPrimary">');
  const secondaryStart=body.indexOf('<div class="splitsEditRow splitsEditRowSecondary">');
  const historyStart=body.indexOf('<div class="recipeEditHistory" role="group" aria-label="Recipe edit history">');
  assert.ok(primaryStart>-1&&secondaryStart>primaryStart&&historyStart>secondaryStart,"expected the fields row, then the pill row, with .recipeEditHistory inside it");
  const row=body.slice(secondaryStart,body.indexOf('</div>\n      `;',secondaryStart));
  assert.match(row,/id="recipeUndo"[\s\S]*?aria-label="Undo recipe change"[\s\S]*?<svg[\s\S]*?<span>Undo<\/span>/);
  assert.match(row,/id="recipeRedo"[\s\S]*?aria-label="Redo recipe change"[\s\S]*?<svg[\s\S]*?<span>Redo<\/span>/);
  assert.ok(row.indexOf('recipeEditHistory')<row.indexOf('id="clearSplitSelection"'),"history leads the pill");
  assert.match(row,/id="splitSelectionStatus" class="srOnly tiny splitsSelectionStatus"/);
  assert.match(body,/undoButton\?\.addEventListener\("click",undoRecipeEdit\);/);
  assert.match(body,/redoButton\?\.addEventListener\("click",redoRecipeEdit\);/);
  assert.match(body,/selectionStatus\.className = `srOnly tiny splitsSelectionStatus/);
});

test("all recipe edit paths create history, while typed fields coalesce until they leave focus",()=>{
  const body=editor();
  assert.match(body,/function copyLayer\([\s\S]*?const historyBefore=snapshotRecipeEdit\(\);[\s\S]*?recordRecipeEdit\(historyBefore\);/);
  assert.match(body,/function emptySelectedCells\(\)\{[\s\S]*?const historyBefore=snapshotRecipeEdit\(\);[\s\S]*?recordRecipeEdit\(historyBefore\);/);
  assert.match(body,/resetAllSplits"\)\.addEventListener\("click",\(\)=>\{[\s\S]*?const historyBefore=snapshotRecipeEdit\(\);[\s\S]*?recordRecipeEdit\(historyBefore\);/);
  assert.match(body,/applyButton\.addEventListener\("click",\(\)=>\{[\s\S]*?const historyBefore=snapshotRecipeEdit\(\);[\s\S]*?recordRecipeEdit\(historyBefore\);/);
  assert.match(body,/resinInput\.addEventListener\("input",\(e\)=>\{\s*beginRecipeEditInput\(\);/);
  assert.match(body,/resinInput\.addEventListener\("blur",finishRecipeEditInput\);/);
  assert.match(body,/pctInput\.addEventListener\("blur",finishRecipeEditInput\);/);
  assert.match(body,/recipeRearrangementHistoryBefore=snapshotRecipeEdit\(\);/);
  assert.match(body,/if \(!cancelled\) recordRecipeEdit\(historyBefore\);/);
});

test("history actions are icon-only affordances, not visual buttons, and visibly stand down when unavailable",()=>{
  const rule=styles.slice(styles.indexOf(".recipeHistoryAction{"),styles.indexOf("}",styles.indexOf(".recipeHistoryAction{"))+1);
  assert.match(rule,/border:0;/);
  assert.match(rule,/background:transparent;/);
  assert.match(rule,/border-radius:50%;/);
  assert.match(styles,/\.recipeHistoryAction:disabled\{ opacity:\.32; \}/);
  assert.match(styles,/\.recipeHistoryAction svg\{[\s\S]*?stroke:currentColor;/);
});
