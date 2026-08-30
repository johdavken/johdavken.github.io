"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const app=fs.readFileSync("app.js","utf8");
const styles=fs.readFileSync("styles.css","utf8");

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
  // .recipeEditHistory sits between the values/Apply row and the pill row
  // now (a sibling of both, not nested inside the pill row) - Undo/Redo
  // moved out of the pill so they read as plain icon buttons, not a
  // filled segment.
  const historyStart=body.indexOf('<div class="recipeEditHistory" role="group" aria-label="Recipe edit history">');
  const primaryStart=body.indexOf('<div class="splitsEditRow splitsEditRowPrimary">');
  const secondaryStart=body.indexOf('<div class="splitsEditRow splitsEditRowSecondary">');
  assert.ok(primaryStart>-1&&historyStart>primaryStart&&secondaryStart>historyStart,"expected values/Apply, then .recipeEditHistory, then the pill row, in that order");
  const history=body.slice(historyStart,secondaryStart);
  assert.match(history,/id="recipeUndo"[\s\S]*?aria-label="Undo recipe change"[\s\S]*?<svg/);
  assert.match(history,/id="recipeRedo"[\s\S]*?aria-label="Redo recipe change"[\s\S]*?<svg/);
  const row=body.slice(secondaryStart,body.indexOf('</div>\n      `;',secondaryStart));
  assert.doesNotMatch(row,/recipeEditHistory/);
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
