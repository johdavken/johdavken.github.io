"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

// Root cause of "I can't save" (both Saved Recipes and Receiver Weight
// Profiles): the old standalone Line Configurations panel - which used to
// own #workspaceProfilesList/#workspaceRecipesList/#workspaceConfigurationsStatus
// - was removed from index.html at some point, but renderWorkspaceConfigurations()
// still had `if(!profiles || !recipes) return;` guarding the ONLY place
// workspaceConfigurationWorkspaceId ever got assigned. Since those elements
// no longer exist, the guard fired on every single call, forever, leaving
// workspaceConfigurationWorkspaceId permanently "" - so every create/update/
// rename/duplicate/delete/favorite call failed instantly client-side with
// missing_workspace, before ever reaching the network. Confirmed live
// against the real Supabase backend: zero create_workspace_configuration
// requests were ever sent, even with fully valid recipe/profile data.
//
// A second, independent bug compounded this into total silence:
// workspaceConfigurationStatus() targeted #workspaceConfigurationsStatus
// (also part of the removed panel), so even the failure message never
// reached the operator - the save just appeared to do nothing.

function functionBody(name){
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name}`);
  const next = app.indexOf("\n  function ", start + 1);
  return app.slice(start, next === -1 ? undefined : next);
}

test("the old Line Configurations panel really is gone from index.html - confirms this isn't a hypothetical, the elements renderWorkspaceConfigurations used to depend on are actually missing", () => {
  for (const id of ["workspaceProfilesList", "workspaceRecipesList", "workspaceConfigurationsStatus", "workspaceConfigurationsRefresh", "workspaceConfigurationsWorkspace"]){
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `expected #${id} to be absent from index.html`);
  }
});

test("workspaceConfigurationWorkspaceId is assigned unconditionally from syncState, before the removed panel's element-existence guard - not trapped behind it", () => {
  const body = functionBody("renderWorkspaceConfigurations");
  const assignIndex = body.indexOf("workspaceConfigurationWorkspaceId=workspaceId;");
  const guardIndex = body.indexOf('if(!profiles || !recipes) return;');
  assert.notEqual(assignIndex, -1, "expected the success-path assignment");
  assert.notEqual(guardIndex, -1, "expected the (now dead, but harmless) panel-existence guard to still exist for when those elements are present");
  assert.ok(assignIndex < guardIndex, "the workspaceId assignment must run before the guard that returns early when the old panel's elements are missing");
  // The empty-workspace branch must also run before the guard, for the same reason.
  const emptyBranchIndex = body.indexOf('workspaceConfigurationWorkspaceId="";');
  assert.ok(emptyBranchIndex !== -1 && emptyBranchIndex < guardIndex);
});

test("workspaceConfigurationStatus writes to the two real, still-existing per-panel status elements, not the removed panel's status line", () => {
  const start = app.indexOf("function workspaceConfigurationStatus(message){");
  const body = app.slice(start, app.indexOf("\n  }", start) + 4);
  assert.doesNotMatch(body, /workspaceConfigurationsStatus/, "must not reference the removed panel's status element");
  assert.match(body, /\$\("splitsSavedRecipesStatus"\)/, "Recipe Setup's Saved Recipes panel status line");
  assert.match(body, /\$\("setupWeightProfilesStatus"\)/, "Line Setup's Receiver Weight Profiles panel status line");
  // setupWeightProfilesStatus is static index.html markup; splitsSavedRecipesStatus
  // is built dynamically by app.js as part of Recipe Setup's Saved Recipes panel.
  assert.match(html, /id="setupWeightProfilesStatus"/);
  assert.match(app, /id="splitsSavedRecipesStatus"/);
});

test("finishWorkspaceConfigurationMutation renders the refreshed list before setting the success message, not after - otherwise the re-render's own status reset would immediately overwrite 'Configuration saved successfully.' with nothing", () => {
  const body = functionBody("finishWorkspaceConfigurationMutation");
  const renderIndex = body.indexOf("renderWorkspaceConfigurations(lineSync?.getState?.()||{});");
  const statusIndex = body.indexOf("workspaceConfigurationStatus(message);");
  assert.notEqual(renderIndex, -1);
  assert.notEqual(statusIndex, -1);
  assert.ok(renderIndex < statusIndex, "render must come before the success status is set");
});
