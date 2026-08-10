/* =======================================================================
 * Resin.Tools / ResinTimer — app.js
 * Organization pass:
 * - Wrap in one module scope (IIFE) to avoid globals
 * - Add section headers for easier navigation
 * - No functional changes intended
 * ======================================================================= */
(() => {
  "use strict";

  
  /* ============================
   * Versioning + storage keys
   * ============================ */
  const APP_VERSION = "0.17";

    const LS_SESSION_KEY = "resinTimer.session.v0.09";
    const LS_CONFIGS_KEY  = "resinTimer.configs.v0.09";
    const LS_WORKSPACE_KEY = "resinTimer.workspace.v0.16";

    const DETAILS_IDS = [
      "lineSetupBlock",
      "lineSyncBlock",
      "weightsBlock",
      "splitsBlock",
      "resultsBlock",
      "toolsBlock",
      "helpBlock",
      "helpQuickStart",
      "helpSetup",
      "helpHopperPercentages",
      "helpTimeline",
      "helpCloudSync",
      "helpTools"
    ];

    const HOPPERS_PER_LAYER = 6;

  
  /* ============================
   * App state
   * ============================ */
  const state = {
      lineRate: 0,
      lineType: 3,
      changeoverTime: "",
      changeoverSetAt: null, // epoch ms the changeover field was last edited; used to flag a stale/forgotten deadline
      offsets: {},
      layers: [],
      prodResinLb: 0,
      scrapResinLb: 0,
      density: "comfort",
      theme: "mse",
      timeFormat: "12",
      surfaceStyle: "divided",
      mobileTileStyle: "minimal",
      mobileBackgroundStyle: "layer-glow",
      mobileTimelineAlarm: false,
      gauge: 0,
      hopperNamingLine9: "standard", // "standard" | "main"
      showPumpOffTracked: false, // show pump-off items in Timeline
      mobileTimelineOnly: false,
      mobileRecipeOnly: false,
      smartHoppersEnabled: false, // local display preference
      // Physical dimension shared by every receiver hopper in this workspace.
      // Per-hopper circumference remains in legacy payloads only so older
      // sessions/profiles can be migrated without losing their values.
      hopperCircumference: 0

    };

  
  /* ============================
   * DOM helpers
   * ============================ */
  const $ = (id) => document.getElementById(id);
  const validation = window.PolynValidation;
  const calculators = window.PolynCalculators;
  const resinCatalog = window.PolynResinCatalog;
  const resinLookup = window.PolynLookup;
  const activeJob = window.PolynActiveJob;
  const { parseChangeoverDate, formatTime, formatTimelineStart, isChangeoverStale } = window.PolynScheduling;
  const fmtTime = (date, baseDate) => formatTime(date, baseDate, state.timeFormat);
  const { writeJson } = window.PolynStorage;
  let lineSync = null;
  let workspaceConfigurations = null;
  let workspaceConfigurationWorkspaceId = "";
  let workspaceConfigurationRefreshInFlight = false;
  let workspaceConfigurationPending = null;
  let selectedWorkspaceConfigurationId = "";
  let hopperRearrangement = null;
  const pumpOffAlertTimers = new Map();
  let pumpOffAudioContext = null;
  // Recipe Setup's three expandable panels (Bulk edit, Rearrange Hoppers,
  // Saved Recipes) are mutually exclusive - opening one closes the other
  // two. hopperRearrangement above already persists across re-renders and
  // carries real session data (baseline/undo/tapSource); these two are
  // plain open/closed flags, but need the same module-level persistence so
  // a render triggered by exiting rearrange (see the click handlers below)
  // can correctly seed the panel operators actually meant to open next,
  // instead of resetting every panel to closed.
  let splitsBulkModeActive = false;
  let splitsSavedRecipesOpen = false;
  // Persists across renderSplitsArea() re-renders (e.g. after a rearrange
  // move) so the mobile layer view stays where the operator left it instead
  // of jumping back to Layer A on every redraw.
  let lastActiveMobileLayer = "";
  // Recipe Setup's own Scan Recipe shortcut - a small popup, not one of the
  // three mutually-exclusive panels above. Rebuilt fresh on every
  // renderSplitsArea() call like everything else in that panel, so the
  // outside-click/Escape handlers below are registered once, at module
  // scope, and always check whichever instance this variable currently
  // points to rather than being re-registered (and stacking) every render.
  let splitsScanShortcut = null;
  document.addEventListener("click", event=>{
    if (splitsScanShortcut?.open && !splitsScanShortcut.contains(event.target)) splitsScanShortcut.open = false;
  });
  document.addEventListener("keydown", event=>{
    if (event.key === "Escape" && splitsScanShortcut?.open){
      splitsScanShortcut.open = false;
      splitsScanShortcut.querySelector(":scope > summary")?.focus();
    }
  });

  function snapshotSharedActiveJob(){
    return activeJob.snapshotActiveJob(state, APP_VERSION);
  }

  function notifyActiveJobMutation(options){
    lineSync?.notifyActiveJobMutation(options);
  }

  // "workspaceConfigurationsStatus" (plural) was the old, now-removed
  // standalone Line Configurations panel's own status line. That panel is
  // gone from index.html, but this generic status setter is still the sole
  // feedback path for save/update/rename/duplicate/delete/favorite/load
  // results from *both* remaining surfaces - Recipe Setup's Saved Recipes
  // panel and Line Setup's Receiver Weight Profiles panel - so it writes to
  // both of their status lines rather than one nonexistent element. A given
  // action only ever really concerns one of the two, but showing the same
  // confirmation/error in both is harmless and far better than the silent
  // no-op this was reaching before.
  function workspaceConfigurationStatus(message){
    [$("splitsSavedRecipesStatus"), $("setupWeightProfilesStatus")].forEach(el=>{ if(el){ el.textContent=message||""; el.hidden=!message; } });
  }
  // Shared by both surfaces that list shared configurations: Line
  // Configurations' own Receiver Weight Profiles/Recipes sections, and
  // Recipe Setup's Saved Recipes panel (recipes only - see renderSplitsSavedRecipes).
  // Both read from the same workspaceConfigurations service/cache, so a
  // selection or mutation made from either surface is reflected in both -
  // select() below re-renders through renderWorkspaceConfigurations, which
  // always refreshes Recipe Setup's copy too.
  function renderConfigurationList(host,items,kind,syncState,{ showRowActions = true } = {}){
    host.replaceChildren();
    if(!items.length){ const empty=document.createElement("div"); empty.className="muted"; empty.textContent=kind==="recipe"?"No shared recipes saved for this workspace.":"No shared weight profiles saved for this workspace."; host.append(empty); return; }
    items.forEach(item=>{ const row=document.createElement("div"); row.className="workspaceConfigurationRow"; row.tabIndex=0; row.setAttribute("role","group"); row.setAttribute("aria-label",`${item.name} configuration`); const select=()=>{selectedWorkspaceConfigurationId=item.id; renderWorkspaceConfigurations(syncState);}; const selected=selectedWorkspaceConfigurationId===item.id; row.classList.toggle("selected",selected); row.addEventListener("click",event=>{if(!event.target.closest("button,summary,details")) select();}); row.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&!event.target.closest("button,summary")){event.preventDefault();select();}}); const info=document.createElement("div"); info.className="workspaceConfigurationInfo"; info.addEventListener("click",event=>{event.stopPropagation();select();}); const title=document.createElement("strong"); if(item.favorite){const star=document.createElement("span");star.className="workspaceConfigurationFavorite";star.setAttribute("aria-label","Favorite recipe");star.textContent="★";title.append(star," ");} title.append(item.name); const meta=document.createElement("small"); const count=kind==="recipe"&&Array.isArray(item.payload?.layers)?item.payload.layers.reduce((n,layer)=>n+(Array.isArray(layer?.hoppers)?layer.hoppers.filter(h=>typeof h?.resin_name==="string"&&h.resin_name.trim()).length:0),0):kind!=="recipe"&&Array.isArray(item.payload?.layers)?item.payload.layers.reduce((n,layer)=>n+(Array.isArray(layer?.receiver_weights_lb)&&layer.receiver_weights_lb.length===6?6:0),0):null; meta.textContent=`${item.payload.line_type} Layer${count===null?"":` · ${count} ${kind==="recipe"?"assigned hoppers":"receiver weights"}`} · Updated ${item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "unknown"}`; info.append(title,meta); row.append(info); if(selected&&showRowActions){const actions=document.createElement("div"); actions.className="workspaceConfigurationActions"; const action=(label,fn,cls="secondary")=>{const b=document.createElement("button");b.type="button";b.className=cls;b.textContent=label;b.addEventListener("click",event=>{event.stopPropagation();fn();});return b;}; actions.append(action("Load",()=>previewWorkspaceConfiguration(item),"primary"),action("Update",()=>openWorkspaceConfigurationDialog("update",item))); const menu=document.createElement("details"); menu.className="workspaceConfigurationOverflow"; menu.addEventListener("click",event=>event.stopPropagation()); const summary=document.createElement("summary"); summary.setAttribute("aria-label",`More actions for ${item.name}`); summary.textContent="⋯"; const menuActions=document.createElement("div"); menuActions.className="workspaceConfigurationOverflowMenu"; const menuAction=(label,fn,cls="secondary")=>{const button=action(label,()=>{menu.open=false;fn();},cls);menuActions.append(button);}; menuAction("Rename",()=>openWorkspaceConfigurationDialog("rename",item)); menuAction("Duplicate",()=>openWorkspaceConfigurationDialog("duplicate",item)); if(kind==="recipe") menuAction(item.favorite?"Unfavorite":"Favorite",()=>mutateWorkspaceConfiguration("favorite",item,!item.favorite)); menuAction("Delete",()=>{if(confirm(`Delete shared configuration “${item.name}”?`)) mutateWorkspaceConfiguration("delete",item);},"danger"); menu.append(summary,menuActions); actions.append(menu); row.append(actions);} host.append(row); });
  }
  // Recipe Setup's own copy of the shared recipe list - an independent
  // surface reading the same service/cache, not the only one (Setup has its
  // own Receiver Weight Profiles list the same way). Only recipes, not
  // receiver weight profiles - Recipe Setup doesn't concern itself with
  // equipment weights. Rebuilt fresh by renderSplitsArea() on every render, so this
  // always re-populates it with current data rather than leaving it blank
  // until some unrelated RT Sync event happens to fire next.
  // The panel's own Load/Update/(rename, duplicate, favorite, delete) act
  // on whichever recipe is currently selected (selectedWorkspaceConfigurationId,
  // the same selection the list rows themselves set on click) rather than
  // each row carrying its own action buttons - a consolidated bar instead
  // of one per row. Wired fresh on every call since the buttons are static
  // elements built once by renderSplitsArea() but this function runs far
  // more often (any selection change, cache update, etc.) without a full
  // rebuild - .onclick assignment (not addEventListener) so re-wiring never
  // stacks duplicate handlers across repeated calls.
  function wireSplitsSavedRecipesActions(items){
    const loadBtn=$("splitsLoadRecipe"), updateBtn=$("splitsUpdateRecipe"), overflow=$("splitsRecipeOverflow");
    const overflowSummary=overflow?.querySelector("summary");
    const renameBtn=$("splitsRenameRecipe"), duplicateBtn=$("splitsDuplicateRecipe"), favoriteBtn=$("splitsFavoriteRecipe"), deleteBtn=$("splitsDeleteRecipe");
    const selectedItem = items.find(item=>item.id===selectedWorkspaceConfigurationId) || null;
    if(loadBtn) loadBtn.disabled = !selectedItem;
    if(updateBtn) updateBtn.disabled = !selectedItem;
    // <details>/<summary> has no native disabled state - stays visible
    // (matching Load/Update, which are visible-but-disabled rather than
    // hidden) and a click-time guard blocks it from opening instead.
    if(overflow){
      overflow.classList.toggle("overflow-disabled", !selectedItem);
      if(!selectedItem) overflow.open = false;
    }
    if(overflowSummary) overflowSummary.onclick = event=>{ if(!selectedItem) event.preventDefault(); };
    if(favoriteBtn) favoriteBtn.textContent = selectedItem?.favorite ? "Unfavorite" : "Favorite";
    if(loadBtn) loadBtn.onclick = ()=>{ if(selectedItem) previewWorkspaceConfiguration(selectedItem); };
    if(updateBtn) updateBtn.onclick = ()=>{ if(selectedItem) openWorkspaceConfigurationDialog("update",selectedItem); };
    if(renameBtn) renameBtn.onclick = ()=>{ if(overflow) overflow.open=false; if(selectedItem) openWorkspaceConfigurationDialog("rename",selectedItem); };
    if(duplicateBtn) duplicateBtn.onclick = ()=>{ if(overflow) overflow.open=false; if(selectedItem) openWorkspaceConfigurationDialog("duplicate",selectedItem); };
    if(favoriteBtn) favoriteBtn.onclick = ()=>{ if(overflow) overflow.open=false; if(selectedItem) mutateWorkspaceConfiguration("favorite",selectedItem,!selectedItem.favorite); };
    if(deleteBtn) deleteBtn.onclick = ()=>{ if(overflow) overflow.open=false; if(selectedItem && confirm(`Delete shared configuration “${selectedItem.name}”?`)) mutateWorkspaceConfiguration("delete",selectedItem); };
  }
  function renderSplitsSavedRecipes(syncState){
    const host=$("splitsSavedRecipesList");
    if(!host) return;
    const status=$("splitsSavedRecipesStatus");
    const setStatus=message=>{ if(status){ status.textContent=message||""; status.hidden=!message; } };
    const workspaceId=syncState?.selectedWorkspaceId || "";
    if(!workspaceId){ host.replaceChildren(); setStatus("Connect to an RT Sync workspace to view shared recipes."); wireSplitsSavedRecipesActions([]); return; }
    if(!workspaceConfigurations){ host.replaceChildren(); setStatus("Shared configurations service is unavailable."); wireSplitsSavedRecipesActions([]); return; }
    setStatus("");
    const items=workspaceConfigurations.listRecipes(workspaceId).items;
    wireSplitsSavedRecipesActions(items);
    renderConfigurationList(host,items,"recipe",syncState,{ showRowActions:false });
  }
  // Setup panel's own copy of the shared receiver weight profile list (Line
  // Configurations keeps the original). Same consolidated action-bar
  // pattern as Recipe Setup's Saved Recipes, minus the favorite toggle -
  // only recipes support favoriting. Unlike Saved Recipes' buttons, these
  // live in static index.html markup (not rebuilt per render), but still
  // need re-wiring on every call since which item they act on changes
  // with the selection - .onclick assignment keeps that idempotent.
  function wireSetupWeightProfileActions(items){
    const loadBtn=$("setupLoadWeightProfile"), updateBtn=$("setupUpdateWeightProfile"), overflow=$("setupWeightProfileOverflow");
    const overflowSummary=overflow?.querySelector("summary");
    const renameBtn=$("setupRenameWeightProfile"), duplicateBtn=$("setupDuplicateWeightProfile"), deleteBtn=$("setupDeleteWeightProfile");
    const selectedItem = items.find(item=>item.id===selectedWorkspaceConfigurationId) || null;
    if(loadBtn) loadBtn.disabled = !selectedItem;
    if(updateBtn) updateBtn.disabled = !selectedItem;
    if(overflow){
      overflow.classList.toggle("overflow-disabled", !selectedItem);
      if(!selectedItem) overflow.open = false;
    }
    if(overflowSummary) overflowSummary.onclick = event=>{ if(!selectedItem) event.preventDefault(); };
    if(loadBtn) loadBtn.onclick = ()=>{ if(selectedItem) previewWorkspaceConfiguration(selectedItem); };
    if(updateBtn) updateBtn.onclick = ()=>{ if(selectedItem) openWorkspaceConfigurationDialog("update",selectedItem); };
    if(renameBtn) renameBtn.onclick = ()=>{ if(overflow) overflow.open=false; if(selectedItem) openWorkspaceConfigurationDialog("rename",selectedItem); };
    if(duplicateBtn) duplicateBtn.onclick = ()=>{ if(overflow) overflow.open=false; if(selectedItem) openWorkspaceConfigurationDialog("duplicate",selectedItem); };
    if(deleteBtn) deleteBtn.onclick = ()=>{ if(overflow) overflow.open=false; if(selectedItem && confirm(`Delete shared configuration “${selectedItem.name}”?`)) mutateWorkspaceConfiguration("delete",selectedItem); };
  }
  function renderSetupWeightProfiles(syncState){
    const host=$("setupWeightProfilesList");
    if(!host) return;
    const status=$("setupWeightProfilesStatus");
    const setStatus=message=>{ if(status){ status.textContent=message||""; status.hidden=!message; } };
    const workspaceId=syncState?.selectedWorkspaceId || "";
    if(!workspaceId){ host.replaceChildren(); setStatus("Connect to an RT Sync workspace to view shared weight profiles."); wireSetupWeightProfileActions([]); return; }
    if(!workspaceConfigurations){ host.replaceChildren(); setStatus("Shared configurations service is unavailable."); wireSetupWeightProfileActions([]); return; }
    setStatus("");
    const items=workspaceConfigurations.listReceiverWeightProfiles(workspaceId).items;
    wireSetupWeightProfileActions(items);
    renderConfigurationList(host,items,"profile",syncState,{ showRowActions:false });
  }
  function renderWorkspaceConfigurations(syncState){
    renderSplitsSavedRecipes(syncState);
    renderSetupWeightProfiles(syncState);
    // workspaceConfigurationWorkspaceId is load-bearing for every save/
    // update/rename/duplicate/delete/favorite action from *both* remaining
    // surfaces (Recipe Setup's Saved Recipes panel, Line Setup's Receiver
    // Weight Profiles panel) - it must be kept in sync unconditionally,
    // before the old Line Configurations panel's now-permanently-missing
    // elements (workspaceProfilesList/workspaceRecipesList, removed from
    // index.html) can short-circuit the rest of this function.
    const workspaceId=syncState?.selectedWorkspaceId || "";
    if(!workspaceId){ workspaceConfigurationWorkspaceId=""; selectedWorkspaceConfigurationId=""; }
    else workspaceConfigurationWorkspaceId=workspaceId;
    const profiles=$("workspaceProfilesList"), recipes=$("workspaceRecipesList"), refresh=$("workspaceConfigurationsRefresh"), workspaceLabel=$("workspaceConfigurationsWorkspace");
    if(!profiles || !recipes) return;
    if(refresh) refresh.disabled=!workspaceId || workspaceConfigurationRefreshInFlight;
    if(!workspaceId){ if(workspaceLabel) workspaceLabel.hidden=true; workspaceConfigurationStatus("Connect to an RT Sync workspace to view shared weight profiles and recipes."); profiles.replaceChildren(); recipes.replaceChildren(); return; }
    if(workspaceLabel){ workspaceLabel.hidden=false; workspaceLabel.textContent=`${syncState.selectedWorkspace?.name || "Connected workspace"} · RT Sync workspace`; }
    if(!workspaceConfigurations){ workspaceConfigurationStatus("Shared configurations service is unavailable."); profiles.replaceChildren(); recipes.replaceChildren(); return; }
    renderConfigurationList(profiles,workspaceConfigurations.listReceiverWeightProfiles(workspaceId).items,"profile",syncState);
    renderConfigurationList(recipes,workspaceConfigurations.listRecipes(workspaceId).items,"recipe",syncState);
    workspaceConfigurationStatus("");
  }
  async function refreshWorkspaceConfigurations(){
    const workspaceId=lineSync?.getState?.().selectedWorkspaceId || "";
    if(!workspaceId || !workspaceConfigurations || workspaceConfigurationRefreshInFlight) return;
    workspaceConfigurationRefreshInFlight=true; workspaceConfigurationStatus("Refreshing shared configurations…"); renderWorkspaceConfigurations(lineSync.getState());
    const result=await workspaceConfigurations.refresh(workspaceId);
    workspaceConfigurationRefreshInFlight=false;
    if(workspaceId !== lineSync?.getState?.().selectedWorkspaceId) return;
    renderWorkspaceConfigurations(lineSync.getState());
    if(!result.ok) workspaceConfigurationStatus(result.cache?.cachedAt ? "Refresh failed; showing cached shared configurations." : "Shared configurations are unavailable right now.");
  }
  function previewWorkspaceConfiguration(item){
    const dialog=$("workspaceConfigurationLoadDialog"), details=$("workspaceConfigurationLoadDetails"), confirm=$("workspaceConfigurationConfirmLoad"); if(!dialog?.showModal) return;
    const recipe=item.type==="recipe";
    const lineChange=recipe && Number(item.payload.line_type)!==Number(state.lineType)?` This recipe changes the line type from ${state.lineType} to ${item.payload.line_type}.`:"";
    details.textContent=recipe ? `${item.name}. This will change line type, hopper naming mode, layer percentages, hopper resin assignments, and hopper blend percentages.${lineChange} It will not change receiver hopper weights, tracking selections, pump-off state, offsets, timeline/runtime state, workspace, RT Sync identity, or appearance preferences.` : `${item.name}. This will change receiver hopper weights only. It will not change line type, layer percentages, resin assignments, hopper blend percentages, tracking, pump-off state, timeline/runtime state, workspace, or RT Sync state.`;
    confirm.textContent=recipe?"Load Recipe":"Load Weights";
    dialog.addEventListener("close",()=>{ if(dialog.returnValue==="load") applyWorkspaceConfiguration(item); },{once:true}); dialog.showModal();
  }
  function applyWorkspaceConfiguration(item){
    const helper=item.type==="recipe"?window.PolynWorkspaceConfigurationPayloads?.applyRecipePayload:window.PolynWorkspaceConfigurationPayloads?.applyReceiverWeightProfile;
    const result=helper?.(state,item.payload); if(!result?.ok){ workspaceConfigurationStatus(result?.errors?.[0] || "This shared configuration could not be loaded."); return; }
    if(item.type==="recipe") syncLineTypeUI();
    renderWeightsArea(); renderSplitsArea(); validateAndCompute(); saveSession(); notifyActiveJobMutation({immediate:true,kind:"load-workspace-configuration"});
    workspaceConfigurationStatus(`${item.type==="recipe"?"Recipe":"Receiver Weight Profile"} loaded successfully.`);
  }
  function hasNonEmptyRecipe(){
    return state.layers.some(layer=>layer.hoppers.some(hopper=>hopper.resinName && hopper.resinName.trim()));
  }
  // Applies an already-built recipe payload (see recipe-scan-mapping.js,
  // which the scan UI runs once when a scan arrives and again live as the
  // operator edits the review screen's layer-percentage fields) through the
  // same guarded apply/render/save/notify pathway as loading a shared cloud
  // recipe. Deliberately payload-in, not scan-in - this function doesn't
  // know or care where the payload came from, so review-screen edits are
  // submitted as-is rather than being silently recomputed from the raw scan.
  function applyScannedRecipePayload(payload){
    const result = window.PolynWorkspaceConfigurationPayloads?.applyRecipePayload(state, payload);
    if (!result?.ok) return { ok:false, message: result?.errors?.[0] || "This scan could not be applied." };
    renderWeightsArea(); renderSplitsArea(); validateAndCompute(); saveSession();
    notifyActiveJobMutation({immediate:true,kind:"apply-recipe-scan"});
    return { ok:true };
  }
  function openWorkspaceConfigurationDialog(mode,item=null){
    const dialog=$("workspaceConfigurationSaveDialog"), title=$("workspaceConfigurationSaveTitle"), detail=$("workspaceConfigurationSaveDetails"), name=$("workspaceConfigurationName"), confirm=$("workspaceConfigurationSaveConfirm"); if(!dialog?.showModal) return;
    const type=item?.type || (mode==="save-profile" ? "receiver_weight_profile" : "recipe");
    workspaceConfigurationPending={mode,item,type};
    title.textContent=mode==="rename"?"Rename shared configuration":mode==="duplicate"?"Duplicate shared configuration":mode==="update"?"Update shared configuration":type==="recipe"?"Save Current Recipe":"Save Current Weights";
    detail.textContent=type==="recipe"?"This will save line type, layer percentages, resin assignments, and hopper percentages. It will not save receiver weights, tracking, pump-off, timeline, or runtime state.":"This will save receiver hopper weights. It will not save recipe assignments, percentages, or runtime state.";
    name.value=item?.name || ""; confirm.textContent=mode==="rename"?"Rename":mode==="duplicate"?"Duplicate":mode==="update"?"Update":"Save";
    dialog.addEventListener("close",()=>{if(dialog.returnValue==="save") void submitWorkspaceConfigurationDialog();},{once:true}); dialog.showModal(); name.focus();
  }
  async function submitWorkspaceConfigurationDialog(){
    const pending=workspaceConfigurationPending, name=$("workspaceConfigurationName")?.value?.trim() || ""; if(!pending || !name) return;
    if(pending.mode==="rename") return mutateWorkspaceConfiguration("rename",pending.item,name);
    if(pending.mode==="duplicate") return mutateWorkspaceConfiguration("duplicate",pending.item,name);
    if(pending.mode==="update") return mutateWorkspaceConfiguration("update",pending.item);
    const payload=pending.type==="recipe"?window.PolynWorkspaceConfigurationPayloads?.createRecipePayload(state):window.PolynWorkspaceConfigurationPayloads?.createReceiverWeightProfile(state);
    const result=await workspaceConfigurations?.create(workspaceConfigurationWorkspaceId,pending.type,name,payload);
    if(result?.code==="duplicate_name") return resolveWorkspaceConfigurationDuplicate(pending.type,name,payload);
    finishWorkspaceConfigurationMutation(result,"Configuration saved successfully.");
  }
  function resolveWorkspaceConfigurationDuplicate(type,name,payload){
    const dialog=$("workspaceConfigurationDuplicateDialog"); if(!dialog?.showModal) return; dialog.addEventListener("close",async()=>{if(dialog.returnValue==="choose") openWorkspaceConfigurationDialog(type==="recipe"?"save-recipe":"save-profile"); if(dialog.returnValue==="update"){const list=type==="recipe"?workspaceConfigurations.listRecipes(workspaceConfigurationWorkspaceId).items:workspaceConfigurations.listReceiverWeightProfiles(workspaceConfigurationWorkspaceId).items; const existing=list.find(item=>item.normalizedName===name.toLocaleLowerCase().replace(/\s+/g," ")); if(existing) finishWorkspaceConfigurationMutation(await workspaceConfigurations.update(workspaceConfigurationWorkspaceId,existing.id,payload),"Configuration updated successfully.");}},{once:true}); dialog.showModal();
  }
  async function mutateWorkspaceConfiguration(action,item,value){
    const service=workspaceConfigurations; if(!service) return;
    const result=action==="update"?await service.update(workspaceConfigurationWorkspaceId,item.id,item.type==="recipe"?window.PolynWorkspaceConfigurationPayloads.createRecipePayload(state):window.PolynWorkspaceConfigurationPayloads.createReceiverWeightProfile(state)):action==="rename"?await service.rename(workspaceConfigurationWorkspaceId,item.id,value):action==="duplicate"?await service.duplicate(workspaceConfigurationWorkspaceId,item.id,value):action==="delete"?await service.delete(workspaceConfigurationWorkspaceId,item.id):await service.setFavorite(workspaceConfigurationWorkspaceId,item.id,value);
    finishWorkspaceConfigurationMutation(result,action==="delete"?"Configuration deleted.":action==="favorite"?"Recipe favorite updated.":action==="rename"?"Configuration renamed.":action==="duplicate"?"Configuration duplicated.":"Configuration updated successfully.");
  }
  // Render before setting the success message, not after: renderWorkspaceConfigurations
  // re-derives each panel's own "" (no problem) status as part of its normal
  // render, which would otherwise immediately overwrite "Configuration saved
  // successfully." with nothing the instant it appeared.
  function finishWorkspaceConfigurationMutation(result,message){ if(result?.ok){ renderWorkspaceConfigurations(lineSync?.getState?.()||{}); workspaceConfigurationStatus(message); } else workspaceConfigurationStatus(result?.message || "Shared configuration could not be changed."); }
  let resinCatalogRecords = resinCatalog?.getResins?.() || [];
  let commonResinNames = resinCatalogRecords.map(resin=>resin.resin_code);
  resinCatalog?.subscribe?.(resins=>{
    if (resins.length === resinCatalogRecords.length
        && resins.every((resin,index)=>resin.updated_at === resinCatalogRecords[index]?.updated_at
          && resin.resin_code === resinCatalogRecords[index]?.resin_code)) return;
    resinCatalogRecords = resins;
    commonResinNames = resinCatalogRecords.map(resin=>resin.resin_code);
  });

  let resinAutocompletePopup = null;
  let resinAutocompleteInput = null;
  let resinAutocompleteOptions = [];
  let resinAutocompleteIndex = -1;
  let resinAutocompletePointerActive = false;

  function hideResinAutocomplete(){
    if (resinAutocompleteInput){
      resinAutocompleteInput.setAttribute("aria-expanded", "false");
      resinAutocompleteInput.removeAttribute("aria-activedescendant");
    }
    if (resinAutocompletePopup) resinAutocompletePopup.hidden = true;
    resinAutocompleteInput = null;
    resinAutocompleteOptions = [];
    resinAutocompleteIndex = -1;
  }

  function ensureResinAutocompletePopup(){
    if (resinAutocompletePopup) return resinAutocompletePopup;
    const popup = document.createElement("div");
    popup.id = "resinAutocomplete";
    popup.className = "resinAutocomplete";
    popup.setAttribute("role", "listbox");
    popup.hidden = true;
    document.body.appendChild(popup);
    resinAutocompletePopup = popup;
    popup.addEventListener("pointerdown", ()=>{
      resinAutocompletePointerActive = true;
    });
    window.addEventListener("pointerup", ()=>{
      setTimeout(()=>{ resinAutocompletePointerActive = false; }, 150);
    });
    window.addEventListener("pointercancel", ()=>{
      resinAutocompletePointerActive = false;
    });
    window.addEventListener("resize", hideResinAutocomplete);
    window.addEventListener("scroll", event=>{
      if (event.target instanceof Node && resinAutocompletePopup?.contains(event.target)) return;
      hideResinAutocomplete();
    }, true);
    return popup;
  }

  function showResinAutocomplete(input){
    const popup = ensureResinAutocompletePopup();
    const query = input.value.trim().toUpperCase();
    const exact = commonResinNames.filter(name=>name.toUpperCase() === query);
    const starts = commonResinNames.filter(name=>{
      const normalized = name.toUpperCase();
      return normalized !== query && normalized.startsWith(query);
    });
    const contains = commonResinNames.filter(name=>{
      const normalized = name.toUpperCase();
      return !normalized.startsWith(query) && normalized.includes(query);
    });
    const matches = [...exact, ...starts, ...contains];
    if (!matches.length){
      hideResinAutocomplete();
      return;
    }

    popup.replaceChildren();
    resinAutocompleteInput = input;
    resinAutocompleteOptions = matches.map((name,index)=>{
      const option = document.createElement("button");
      option.id = `resinAutocompleteOption${index}`;
      option.type = "button";
      option.className = "resinAutocompleteOption";
      option.setAttribute("role", "option");
      option.textContent = name;
      option.addEventListener("pointerdown", event=>event.preventDefault());
      option.addEventListener("click",()=>{
        input.value = name;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        hideResinAutocomplete();
        input.focus();
      });
      popup.appendChild(option);
      return option;
    });
    resinAutocompleteIndex = -1;

    const rect = input.getBoundingClientRect();
    const width = Math.max(rect.width, 150);
    popup.style.left = `${Math.min(rect.left, window.innerWidth - width - 8)}px`;
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.width = `${width}px`;
    popup.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function setActiveResinOption(index){
    if (!resinAutocompleteOptions.length) return;
    resinAutocompleteIndex = (index + resinAutocompleteOptions.length) % resinAutocompleteOptions.length;
    resinAutocompleteOptions.forEach((option,optionIndex)=>{
      const active = optionIndex === resinAutocompleteIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    const active = resinAutocompleteOptions[resinAutocompleteIndex];
    resinAutocompleteInput?.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  }

  function attachResinAutocomplete(input){
    if (!input || input.dataset.resinAutocomplete === "true") return;
    input.dataset.resinAutocomplete = "true";
    input.autocomplete = "off";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", "resinAutocomplete");
    input.setAttribute("aria-expanded", "false");
    input.addEventListener("focus",()=>showResinAutocomplete(input));
    input.addEventListener("input",()=>showResinAutocomplete(input));
    input.addEventListener("blur",()=>setTimeout(()=>{
      if (!resinAutocompletePointerActive && document.activeElement !== resinAutocompletePopup){
        hideResinAutocomplete();
      }
    }, 100));
    input.addEventListener("keydown",event=>{
      if (event.key === "Escape"){
        hideResinAutocomplete();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
      if (!resinAutocompletePopup || resinAutocompletePopup.hidden){
        if (event.key === "Enter") return;
        showResinAutocomplete(input);
      }
      if (!resinAutocompleteOptions.length) return;
      if (event.key === "Enter"){
        if (resinAutocompleteIndex < 0) return;
        event.preventDefault();
        resinAutocompleteOptions[resinAutocompleteIndex].click();
        return;
      }
      event.preventDefault();
      setActiveResinOption(resinAutocompleteIndex + (event.key === "ArrowDown" ? 1 : -1));
    });
  }

  function showStorageWarning(message){
    const host = $("statusBox") || document.body;
    if (document.getElementById("storageWarning")) return;
    const warning = document.createElement("div");
    warning.id = "storageWarning";
    warning.className = "status bad";
    warning.setAttribute("role", "alert");
    warning.textContent = message;
    host.appendChild(warning);
  }

  function acceptNumericInput(el, options, onValid){
    const result = validation.validateNumber(el.value, options);
    el.setCustomValidity(result.valid ? "" : result.message);
    el.setAttribute("aria-invalid", String(!result.valid));
    el.title = result.valid ? "" : result.message;
    if (!result.valid) return false;
    onValid(result.value);
    return true;
  }

  /* ============================
   * Custom toggles
   * ============================ */

  function hopperBadgeLabel(layerName, hi){
    // Only affects Line 9 naming toggle. Keeps other lines unchanged unless enabled.
    if (state.hopperNamingLine9 === "main"){
      // AM, A1..A5 (and likewise BM, B1..B5, etc.)
      return (hi === 0) ? `${layerName}M` : `${layerName}${hi}`;
    }
    return `${layerName}${hi+1}`;
  }

  function syncToggleUI(id, on){
    const el = $(id);
    if (!el) return;
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-checked", String(!!on));
  }

  function syncHopperNamingUI(){
    const group = $("hopperNamingToggle");
    if (!group) return;
    const current = state.hopperNamingLine9 === "main" ? "main" : "standard";
    group.querySelectorAll("[data-hopper-naming]").forEach(button=>{
      const selected = button.dataset.hopperNaming === current;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function hookHopperNamingChoice(){
    const group = $("hopperNamingToggle");
    if (!group || group._wired) return;
    group._wired = true;
    const choose = value=>{
      const next = value === "main" ? "main" : "standard";
      if (state.hopperNamingLine9 === next) return;
      state.hopperNamingLine9 = next;
      syncHopperNamingUI();
      saveSession();
      rebuildUIFromState();
      notifyActiveJobMutation({ immediate: true, kind: "hopper-naming" });
    };
    group.addEventListener("click",event=>{
      const button = event.target.closest("[data-hopper-naming]");
      if (button) choose(button.dataset.hopperNaming);
    });
    group.addEventListener("keydown",event=>{
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const value = state.hopperNamingLine9 === "main" ? "standard" : "main";
      choose(value);
      group.querySelector(`[data-hopper-naming="${value}"]`)?.focus();
    });
    syncHopperNamingUI();
  }

  const LINE_TYPES = [1, 3, 5];

  function syncLineTypeUI(){
    const group = $("lineTypeToggle");
    if (!group) return;
    const current = LINE_TYPES.includes(Number(state.lineType)) ? Number(state.lineType) : 3;
    group.querySelectorAll("[data-line-type]").forEach(button=>{
      const selected = Number(button.dataset.lineType) === current;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function hookLineTypeChoice(){
    const group = $("lineTypeToggle");
    if (!group || group._wired) return;
    group._wired = true;
    const choose = value=>{
      const nextType = LINE_TYPES.includes(Number(value)) ? Number(value) : 3;
      if (nextType === state.lineType) return;
      const nextLayerNames = new Set(getLayerNamesForType(nextType));
      const configuredRemovedLayers = state.layers.filter(layer=>!nextLayerNames.has(layer.name)).filter(layer=>
        clampNum(layer.layerPct) > 0 ||
        layer.hoppers.some((hopper,index)=>
          (index === 0 ? Math.abs(clampNum(hopper.pct) - 100) > 0.0001 : clampNum(hopper.pct) > 0) ||
          clampNum(hopper.weight) > 0 || !!hopper.resinName || !!hopper.track || !!hopper.pumpOff ||
          clampNum(hopper.usableHeight) > 0 || clampNum(hopper.circumference) > 0
        )
      );
      if (configuredRemovedLayers.length && !confirm(`Changing to ${nextType} ${nextType === 1 ? "layer" : "layers"} will remove configured data for ${configuredRemovedLayers.map(layer=>layer.name).join(", ")}. Continue?`)){
        return;
      }
      state.lineType = nextType;
      ensureLayers();
      syncLineTypeUI();
      rebuildUIFromState();
      saveSession();
      notifyActiveJobMutation({ immediate: true, kind: "line-type" });
    };
    group.addEventListener("click",event=>{
      const button = event.target.closest("[data-line-type]");
      if (button) choose(button.dataset.lineType);
    });
    group.addEventListener("keydown",event=>{
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const idx = LINE_TYPES.indexOf(LINE_TYPES.includes(Number(state.lineType)) ? Number(state.lineType) : 3);
      const nextIdx = event.key === "ArrowLeft" ? Math.max(0, idx - 1) : Math.min(LINE_TYPES.length - 1, idx + 1);
      choose(LINE_TYPES[nextIdx]);
      group.querySelector(`[data-line-type="${LINE_TYPES[nextIdx]}"]`)?.focus();
    });
    syncLineTypeUI();
  }

  function hookToggle(id, getOn, setOn){
    const el = $(id);
    if (!el || el._wired) return;
    el._wired = true;

    const flip = ()=>{
      setOn(!getOn());
      syncToggleUI(id, getOn());
      saveSession();
      // Rebuild only when labels change; validate for filtering changes
      if (id === "hopperNamingToggle"){
        rebuildUIFromState();
        notifyActiveJobMutation({ immediate: true, kind: "hopper-naming" });
      }else{
        validateAndCompute({ sync: false });
      }
    };

    el.addEventListener("click",(e)=>{ e.preventDefault(); flip(); });
    el.addEventListener("keydown",(e)=>{
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
    });

    // initial
    syncToggleUI(id, getOn());
  }

  function hookCustomToggles(){
    hookHopperNamingChoice();
    hookLineTypeChoice();

    hookToggle(
      "showPumpOffToggle",
      ()=> !!state.showPumpOffTracked,
      (v)=> { state.showPumpOffTracked = !!v; }
    );

    hookToggle(
      "mobileTimelineToggle",
      ()=> !!state.mobileTimelineOnly,
      (v)=> applyMobileTimelineMode(!!v)
    );

    hookToggle(
      "mobileRecipeToggle",
      ()=> !!state.mobileRecipeOnly,
      (v)=> applyMobileRecipeMode(!!v)
    );
  }


    function clampNum(x){
      if (x === null || x === undefined) return 0;
      const s = String(x).trim();
      if (s === "") return 0;
      const cleaned = s.replace(/,/g, "");
      const n = Number(cleaned);
      return Number.isFinite(n) ? n : 0;
    }
    function normName(s){ return String(s || "").trim().replace(/\\s+/g, " "); }
    function keyName(s){ return normName(s).toUpperCase(); }
    function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
    function fmtNum(n, d=2){ return Number.isFinite(n) ? n.toFixed(d) : "—"; }
    // Production Summary pounds are entered and tracked without decimals -
    // truncate (not round-to-nearest) so e.g. 534.6 reads as 534, matching
    // the whole-pound units the operator already works in.
    function fmtLb(n){ return Number.isFinite(n) ? String(Math.floor(n)) : "—"; }
    function fmtTrim(n, d=3){
      if (!Number.isFinite(n)) return "—";
      return n.toFixed(d).replace(/\.0+$/,"").replace(/(\.\d*?)0+$/,"$1");
    }


    function hoursToHHMM(h){
      if (!Number.isFinite(h) || h < 0) return "—";
      const total = Math.floor(h*60 + 0.5);
      const hh = Math.floor(total/60);
      const mm = total % 60;
      return `${hh}h ${String(mm).padStart(2,"0")}m`;
    }
    function minutesToHHMM(mins){
      if (!Number.isFinite(mins) || mins < 0) return "—";
      const total = Math.floor(mins + 0.5);
      const hh = Math.floor(total/60);
      const mm = total % 60;
      return `${hh}h ${String(mm).padStart(2,"0")}m`;
    }

    function recomputeAutoH1(layer){
      // Sum hoppers 2-6; H1 = 100 - sum
      let sumOthers = 0;
      for (let i = 1; i < HOPPERS_PER_LAYER; i++){
        sumOthers += clampNum(layer.hoppers[i].pct);
      }
      let h1 = 100 - sumOthers;
      if (h1 < 0) h1 = 0;
      if (h1 > 100) h1 = 100;
      layer.hoppers[0].pct = h1;
    }

    function setStatus(html){
      const el = $("statusBox");
      if (el) el.innerHTML = html || "";
    }
    function statusMessage(messages){
      if (!messages.length) return "";
      const hasBad = messages.some(m=>m.type==="bad");
      const hasWarn = messages.some(m=>m.type==="warn");
      const cls = hasBad ? "status bad" : (hasWarn ? "status" : "status ok");
      const title = hasBad ? "Fix before trusting results:" : (hasWarn ? "Heads up:" : "Looks good:");
      const items = messages.map(m=>`<li>${m.text}</li>`).join("");
      return `<div class="${cls}"><div class="statusTitle">${title}</div><ul>${items}</ul></div>`;
    }

    function getLayerNamesForType(lineType){
      if (lineType === 1) return ["A"];
      if (lineType === 5) return ["A","B","C","D","E"];
      return ["A","B","C"];
    }
    function getLayerCopyRules(lineType){
      if (lineType === 3) return { "A": "C", "C": "A" };
      if (lineType === 5) return {
        "A": "E",
        "B": "D",
        "C": "B",
        "D": "B",
        "E": "A"
      };
      return {};
    }

    function ensureLayers(){
      const names = getLayerNamesForType(state.lineType);
      const prevByName = {};
      (state.layers || []).forEach(L => { if (L?.name) prevByName[L.name] = L; });

      state.layers = names.map(name => {
        const p = prevByName[name];
        if (p){
          return {
            name,
            layerPct: clampNum(p.layerPct),
            hoppers: Array.from({length:HOPPERS_PER_LAYER}, (_,i)=>{
              const h = p.hoppers?.[i] || {};
              return {
                pct: clampNum(h.pct),
                weight: clampNum(h.weight),
                resinName: normName(h.resinName || ""),
                track: !!h.track,
                pumpOff: !!h.pumpOff,
                usableHeight: clampNum(h.usableHeight),
                circumference: clampNum(h.circumference)
              };
            })
          };
        }
        return {
          name,
          layerPct: 0,
          hoppers: Array.from({length:HOPPERS_PER_LAYER}, (_,i)=>({
            pct: i === 0 ? 100 : 0,
            weight: 0,
            resinName: "",
            track: false,
            pumpOff: false,
            usableHeight: 0,
            circumference: 0
          }))
        };
      });

      state.layers.forEach(recomputeAutoH1);

      state.offsets = Object.fromEntries(names.map(name=>[name, 0]));
    }

    function snapshotPayload(){
      const blocksOpen = {};
      DETAILS_IDS.forEach(id=>{
        const el = document.getElementById(id);
        if (el && typeof el.open === "boolean") blocksOpen[id] = !!el.open;
      });

      return {
        version: APP_VERSION,
        lineRate: state.lineRate,
        lineType: state.lineType,
        changeoverTime: state.changeoverTime,
        changeoverSetAt: state.changeoverSetAt,
        offsets: state.offsets,
        layers: state.layers,
        prodResinLb: state.prodResinLb,
        scrapResinLb: state.scrapResinLb,
        density: state.density,
        theme: state.theme,
        timeFormat: state.timeFormat,
        surfaceStyle: state.surfaceStyle,
        mobileTileStyle: state.mobileTileStyle,
        mobileBackgroundStyle: state.mobileBackgroundStyle,
        mobileTimelineAlarm: !!state.mobileTimelineAlarm,
        gauge: state.gauge,
        hopperNamingLine9: state.hopperNamingLine9,
        showPumpOffTracked: !!state.showPumpOffTracked,
        mobileTimelineOnly: !!state.mobileTimelineOnly,
        mobileRecipeOnly: !!state.mobileRecipeOnly,
        smartHoppersEnabled: !!state.smartHoppersEnabled,
        hopperCircumference: state.hopperCircumference,
        blocksOpen
      };
    }

    function applySharedActiveJob(payload){
      const localPreferences = {
        density: state.density,
        theme: state.theme,
        timeFormat: state.timeFormat,
        surfaceStyle: state.surfaceStyle,
        mobileTileStyle: state.mobileTileStyle,
        mobileBackgroundStyle: state.mobileBackgroundStyle,
        mobileTimelineAlarm: state.mobileTimelineAlarm,
        showPumpOffTracked: state.showPumpOffTracked,
        mobileTimelineOnly: state.mobileTimelineOnly,
        mobileRecipeOnly: state.mobileRecipeOnly,
        smartHoppersEnabled: state.smartHoppersEnabled,
        blocksOpen: snapshotPayload().blocksOpen
      };
      applyPayload({ ...payload, ...localPreferences }, { rebuildUI: true });
      saveSession();
    }

  
  /* ============================
   * Theme
   * ============================ */
  function applyTheme(t){
      const allowed = new Set(["dark","light","mse","industrial-slate-dark","gruvbox-dark","gruvbox-light","nord","tokyo-night","dracula","solarized-dark","solarized-light","catppuccin-mocha","catppuccin-latte","rose-pine","rose-pine-dawn","everforest","everforest-light","one-dark","high-contrast","mono"]);
      const theme = allowed.has(String(t)) ? String(t) : "mse";

      document.documentElement.setAttribute("data-theme", theme);
      document.body.setAttribute("data-theme", theme);

      const sel = $("themeSel");
      if (sel) sel.value = theme;

      state.theme = theme;

  }

    function applyDensity(d){
      const allowed = new Set(["spacious","comfort","compact","dense","maximum"]);
      const density = allowed.has(String(d)) ? String(d) : "comfort";
      document.body.setAttribute("data-density", density);
      const sel = $("densitySel");
      if (sel) sel.value = density;
      state.density = density;
    }

    function applyTimeFormat(value){
      const timeFormat = String(value) === "24" ? "24" : "12";
      state.timeFormat = timeFormat;
      const sel = $("timeFormatSel");
      if (sel) sel.value = timeFormat;
    }

    // Divided Workspace is the default on desktop; mobile defaults to Layered Flat instead.
    function defaultSurfaceStyle(){
      return window.matchMedia("(max-width: 900px)").matches ? "layered-flat" : "divided";
    }

    function applySurfaceStyle(value){
      const allowed = new Set(["elevated", "flat", "layered-flat", "accent-frame", "divided", "low-elevation"]);
      const surfaceStyle = allowed.has(String(value)) ? String(value) : defaultSurfaceStyle();
      state.surfaceStyle = surfaceStyle;
      document.body.setAttribute("data-surface-style", surfaceStyle);
      const sel = $("surfaceStyleSel");
      if (sel) sel.value = surfaceStyle;
    }

    function applyMobileTileStyle(value){
      const allowed = new Set(["accent", "solid", "outline", "glass", "minimal", "layered"]);
      const style = allowed.has(String(value)) ? String(value) : "minimal";
      state.mobileTileStyle = style;
      document.body.dataset.mobileTileStyle = style;
      document.querySelectorAll("[data-mobile-tile-style]").forEach(button=>{
        button.setAttribute("aria-checked", String(button.dataset.mobileTileStyle === style));
      });
    }

    function applyMobileBackgroundStyle(value){
      const allowed = new Set(["layer-glow", "industrial-grid", "paper-grain", "dot-matrix", "blueprint", "contour-lines", "prism-fade", "pinstripe"]);
      const style = allowed.has(String(value)) ? String(value) : "layer-glow";
      state.mobileBackgroundStyle = style;
      document.body.dataset.mobileBackgroundStyle = style;
      document.querySelectorAll("[data-mobile-background-style]").forEach(button=>{
        button.setAttribute("aria-checked", String(button.dataset.mobileBackgroundStyle === style));
      });
    }

    function applyMobileTimelineAlarm(enabled){
      state.mobileTimelineAlarm = !!enabled;
      const toggle = $("mobileTimelineAlarmToggle");
      if (toggle) toggle.checked = state.mobileTimelineAlarm;
      const status = $("mobileTimelineAlarmStatus");
      if (status){
        const notificationState = "Notification" in window ? Notification.permission : "unsupported";
        status.textContent = state.mobileTimelineAlarm
          ? (notificationState === "granted" ? "Sound, vibration, and notifications enabled." : "Sound and vibration enabled while Resin.Tools is open.")
          : "Sound and vibration while Resin.Tools is open.";
      }
      if (!state.mobileTimelineAlarm){
        pumpOffAlertTimers.forEach(timer=>clearTimeout(timer));
        pumpOffAlertTimers.clear();
        navigator.vibrate?.(0);
      }
    }

    function playPumpOffAlarm(){
      try{
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        pumpOffAudioContext ||= new AudioContextClass();
        const start = pumpOffAudioContext.currentTime;
        [0,.34,.68].forEach(offset=>{
          const oscillator = pumpOffAudioContext.createOscillator();
          const gain = pumpOffAudioContext.createGain();
          oscillator.frequency.value = 880;
          gain.gain.setValueAtTime(.0001,start+offset);
          gain.gain.exponentialRampToValueAtTime(.22,start+offset+.02);
          gain.gain.exponentialRampToValueAtTime(.0001,start+offset+.24);
          oscillator.connect(gain).connect(pumpOffAudioContext.destination);
          oscillator.start(start+offset);
          oscillator.stop(start+offset+.25);
        });
      }catch(_error){}
    }

    async function showPumpOffNotification(item){
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      const title = `Pump off ${item.hopperLabel}`;
      const options = { body:item.resinName ? `${item.resinName} is due now.` : "Hopper pump-off is due now.", tag:`pump-off-${item.layer}-${item.hopperLabel}`, vibrate:[500,200,500] };
      try{
        const registration = await navigator.serviceWorker?.getRegistration();
        if (registration) await registration.showNotification(title,options);
        else new Notification(title,options);
      }catch(_error){}
    }

    function firePumpOffAlert(item){
      if (!state.mobileTimelineAlarm || item._ref.h.pumpOff) return;
      navigator.vibrate?.([500,200,500,200,800]);
      playPumpOffAlarm();
      showPumpOffNotification(item);
      document.querySelector(".pumpOffAlarmBanner")?.remove();
      const banner = document.createElement("div");
      banner.className = "pumpOffAlarmBanner";
      banner.setAttribute("role","alert");
      banner.innerHTML = `<strong>Pump off ${item.hopperLabel}</strong><span>${item.resinName || "Tracked hopper"} is due now.</span><button type="button">Dismiss</button>`;
      banner.querySelector("button").addEventListener("click",()=>{ navigator.vibrate?.(0); banner.remove(); });
      document.body.appendChild(banner);
    }

    function schedulePumpOffAlerts(flat,changeoverDate){
      pumpOffAlertTimers.forEach(timer=>clearTimeout(timer));
      pumpOffAlertTimers.clear();
      if (!state.mobileTimelineAlarm || !changeoverDate) return;
      const now = Date.now();
      flat.filter(item=>item.startByDate && !item.pumpOff).forEach(item=>{
        const due = item.startByDate.getTime();
        if (due <= now) return;
        const key = `${item.layer}:${item.hopperLabel}:${due}`;
        const arm = ()=>{
          const remaining = due-Date.now();
          if (remaining > 1000){
            pumpOffAlertTimers.set(key,setTimeout(arm,Math.min(remaining,2147483647)));
            return;
          }
          pumpOffAlertTimers.delete(key);
          firePumpOffAlert(item);
        };
        pumpOffAlertTimers.set(key,setTimeout(arm,Math.min(due-now,2147483647)));
      });
    }

    function applyPayload(payload, {rebuildUI=true} = {}){
      if (!payload || typeof payload !== "object") return;

      state.lineRate = clampNum(payload.lineRate);
      state.gauge = 0;
      state.lineType = [1,3,5].includes(Number(payload.lineType)) ? Number(payload.lineType) : 3;
      state.changeoverTime = payload.changeoverTime || "";
      state.changeoverSetAt = state.changeoverTime
        ? (Number.isFinite(payload.changeoverSetAt) ? payload.changeoverSetAt : Date.now())
        : null;
      state.offsets = {};
      state.prodResinLb = clampNum(payload.prodResinLb);
      state.scrapResinLb = clampNum(payload.scrapResinLb);

      applyTheme(payload.theme || "mse");
      applyDensity(payload.density || "comfort");
      applyTimeFormat(payload.timeFormat || "12");
      applySurfaceStyle(payload.surfaceStyle || defaultSurfaceStyle());
      applyMobileTileStyle(payload.mobileTileStyle || "minimal");
      applyMobileBackgroundStyle(payload.mobileBackgroundStyle || "layer-glow");
      applyMobileTimelineAlarm(!!payload.mobileTimelineAlarm);
      $("lineRate").value = String(state.lineRate);
      // Custom toggles
      state.hopperNamingLine9 = (payload.hopperNamingLine9 === "main") ? "main" : "standard";
      state.showPumpOffTracked = !!payload.showPumpOffTracked;
      state.mobileTimelineOnly = !!payload.mobileTimelineOnly;
      applyMobileTimelineMode(state.mobileTimelineOnly);
      state.mobileRecipeOnly = !!payload.mobileRecipeOnly;
      applyMobileRecipeMode(state.mobileRecipeOnly);
      state.smartHoppersEnabled = !!payload.smartHoppersEnabled;


      syncLineTypeUI();
      $("changeoverTime").value = state.changeoverTime;


      const names = getLayerNamesForType(state.lineType);
      const oldLayers = Array.isArray(payload.layers) ? payload.layers : [];
      state.layers = names.map(name => {
        const found = oldLayers.find(x => x?.name === name) || {};
        const layerPct = clampNum(found.layerPct);
        const hoppers = Array.from({length:HOPPERS_PER_LAYER}, (_,i)=>{
          const fh = found?.hoppers?.[i] || {};
          return {
            pct: clampNum(fh.pct),
            weight: clampNum(fh.weight),
            resinName: normName(fh.resinName || ""),
            track: !!fh.track,
            pumpOff: !!fh.pumpOff,
            usableHeight: clampNum(fh.usableHeight),
            circumference: clampNum(fh.circumference)
          };
        });
        return { name, layerPct, hoppers };
      });

      // Smart Hoppers originally persisted circumference on each hopper.
      // Promote an older payload's first available value to the one shared
      // workspace setting; a supplied top-level value always wins.
      const legacyCircumference = oldLayers.flatMap(layer=>layer?.hoppers || [])
        .map(hopper=>clampNum(hopper?.circumference)).find(value=>value > 0);
      state.hopperCircumference = payload.hopperCircumference === undefined
        ? (legacyCircumference || 0)
        : clampNum(payload.hopperCircumference);

      state.offsets = Object.fromEntries(names.map(layerName=>[layerName, 0]));

      const lineRateEl = $("lineRate");
      if (lineRateEl) lineRateEl.value = String(state.lineRate);
      syncLineTypeUI();

      const coEl = $("changeoverTime");
      if (coEl) coEl.value = state.changeoverTime;

      if (rebuildUI) rebuildUIFromState(payload);
      else validateAndCompute();
    }

  
  /* ============================
   * Persistence (session + configs)
   * ============================ */
  function saveSession(){
      const result = writeJson(localStorage, LS_SESSION_KEY, snapshotPayload());
      if (!result.ok){
        showStorageWarning("Autosave failed. Changes may be lost when this page closes.");
        return false;
      }
      return true;
    }
    function loadSession(){
      try{
        const raw = localStorage.getItem(LS_SESSION_KEY);
        if (!raw) return false;
        applyPayload(JSON.parse(raw), {rebuildUI:true});
        return true;
      }catch(e){ return false; }
    }
    function clearSession(){
      try{ localStorage.removeItem(LS_SESSION_KEY); }catch(e){}
    }

    // Recipes
    function readConfigs(){
      try{
        const raw = localStorage.getItem(LS_CONFIGS_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return (obj && typeof obj === "object") ? obj : {};
      }catch(e){ return {}; }
    }
    function writeConfigs(obj){
      return writeJson(localStorage, LS_CONFIGS_KEY, obj).ok;
    }
    function recipeStatus(msg, type="ok"){
      const el = $("recipeStatus");
      if (!el) return;
      const cls = type==="bad" ? "status bad" : (type==="warn" ? "status" : "status ok");
      const status = document.createElement("div");
      status.className = cls;
      const message = document.createElement("div");
      message.style.fontWeight = "950";
      message.textContent = msg;
      status.appendChild(message);
      el.replaceChildren(status);
      setTimeout(()=>{ el.replaceChildren(); }, 4500);
    }
    function refreshConfigDropdown(selectName){
      const configs = readConfigs();
      const sel = $("savedConfigs");
      if (!sel) return;

      const names = Object.keys(configs).sort((a,b)=>a.localeCompare(b));
      sel.innerHTML = "";
      if (names.length === 0){
        const o = document.createElement("option");
        o.value = "";
        o.textContent = "— none saved —";
        sel.appendChild(o);
        return;
      }
      names.forEach(n=>{
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        sel.appendChild(o);
      });
      if (selectName && names.includes(selectName)) sel.value = selectName;
    }

    function normalizeConfigName(name){ return String(name || "").trim().replace(/\\s+/g, " "); }

    function saveNamedConfig(){
      const name = normalizeConfigName($("configName")?.value);
      if (!name){ recipeStatus("Please enter a config name first.", "warn"); return; }
      const configs = readConfigs();
      configs[name] = snapshotPayload();
      if (!writeConfigs(configs)){
        recipeStatus(`Could not save "${name}". Browser storage is unavailable or full.`, "bad");
        return;
      }
      refreshConfigDropdown(name);
      recipeStatus(`Saved config: "${name}"`, "ok");
      lineSync?.notifySavedSetupUpsert(name, configs[name]);
    }
    function loadSelectedConfig(){
      const sel = $("savedConfigs")?.value;
      if (!sel){ recipeStatus("No config selected.", "warn"); return; }
      const configs = readConfigs();
      const payload = configs[sel];
      if (!payload){ recipeStatus("Selected config not found.", "bad"); return; }
      applyPayload(payload, {rebuildUI:true});
      const cn = $("configName"); if (cn) cn.value = sel;
      recipeStatus(`Loaded config: "${sel}"`, "ok");
      saveSession();
      notifyActiveJobMutation({ immediate: true, kind: "load-saved-setup" });
    }
    function renameSelectedConfig(){
      const oldName = $("savedConfigs")?.value;
      if (!oldName){ recipeStatus("No config selected to rename.", "warn"); return; }
      const newName = normalizeConfigName($("configName")?.value);
      if (!newName){ recipeStatus("Enter the new name in the Config name field.", "warn"); return; }
      const configs = readConfigs();
      if (!configs[oldName]){ recipeStatus("Selected config not found.", "bad"); return; }
      if (oldName !== newName && configs[newName]){
        recipeStatus("A config with that name already exists.", "warn");
        return;
      }
      configs[newName] = configs[oldName];
      delete configs[oldName];
      if (!writeConfigs(configs)){
        recipeStatus(`Could not rename "${oldName}". Browser storage is unavailable or full.`, "bad");
        return;
      }
      refreshConfigDropdown(newName);
      recipeStatus(`Renamed "${oldName}" → "${newName}"`, "ok");
      lineSync?.notifySavedSetupRename(oldName, newName);
    }
    function deleteSelectedConfig(){
      const name = $("savedConfigs")?.value;
      if (!name){ recipeStatus("No config selected to delete.", "warn"); return; }
      if (!confirm(`Delete config "${name}"?`)) return;
      const configs = readConfigs();
      delete configs[name];
      if (!writeConfigs(configs)){
        recipeStatus(`Could not delete "${name}". Browser storage is unavailable or full.`, "bad");
        return;
      }
      refreshConfigDropdown();
      recipeStatus(`Deleted "${name}"`, "ok");
      lineSync?.notifySavedSetupDelete(name);
    }

    async function copyTextToClipboard(text){
      try{ await navigator.clipboard.writeText(text); return true; }
      catch(e){
        try{
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          return true;
        }catch(e2){ return false; }
      }
    }

    async function exportSelectedConfig(){
      const name = $("savedConfigs")?.value || normalizeConfigName($("configName")?.value);
      if (!name){ recipeStatus("Select a config (or type a name) to export.", "warn"); return; }
      const configs = readConfigs();
      const payload = configs[name] || snapshotPayload();
      const wrapper = { name, exportedAt: new Date().toISOString(), version: APP_VERSION, payload };
      const ok = await copyTextToClipboard(JSON.stringify(wrapper, null, 2));
      recipeStatus(ok ? `Copied JSON for "${name}" to clipboard.` : "Could not copy to clipboard.", ok ? "ok" : "warn");
    }

    function showImportUI(show){
      const area = $("importArea");
      if (!area) return;
      area.classList.toggle("hide", !show);
      if (show) $("importJson")?.focus();
    }
    function doImport(){
      const raw = $("importJson")?.value?.trim() || "";
      if (!raw){ recipeStatus("Paste JSON first.", "warn"); return; }
      let obj;
      try{ obj = JSON.parse(raw); }
      catch(e){ recipeStatus("Invalid JSON.", "bad"); return; }

      let name = normalizeConfigName(obj?.name);
      let payload = obj?.payload && typeof obj.payload === "object" ? obj.payload : obj;

      const payloadResult = validation.validateConfigPayload(payload);
      if (!payloadResult.valid){
        const details = payloadResult.errors.slice(0, 3).join(" ");
        const more = payloadResult.errors.length > 3
          ? ` (${payloadResult.errors.length - 3} more issue(s))`
          : "";
        recipeStatus(`Malformed configuration: ${details}${more}`, "bad");
        return;
      }

      if (!name) name = normalizeConfigName(prompt("Name for this imported config:", "Imported config") || "");
      if (!name){ recipeStatus("Import canceled (no name).", "warn"); return; }

      const configs = readConfigs();
      configs[name] = payload;
      if (!writeConfigs(configs)){
        recipeStatus(`Could not import "${name}". Browser storage is unavailable or full.`, "bad");
        return;
      }
      refreshConfigDropdown(name);
      const cn = $("configName"); if (cn) cn.value = name;

      const loadNow = confirm(`Imported "${name}". Load it now? (This will overwrite current inputs)`);
      if (loadNow){
        applyPayload(payload, {rebuildUI:true});
        saveSession();
        notifyActiveJobMutation({ immediate: true, kind: "load-imported-setup" });
      }

      showImportUI(false);
      const ij = $("importJson"); if (ij) ij.value = "";
      recipeStatus(`Imported config: "${name}"`, "ok");
      lineSync?.notifySavedSetupUpsert(name, payload);
    }

    function weightId(layerName, hi){ return `w_${layerName}_${hi}`; }
    function computedWeightId(layerName, hi){ return `cw_${layerName}_${hi}`; }
    function smartBadgeId(layerName, hi){ return `sm_${layerName}_${hi}`; }
    function hopperPositionLabel(hi){
      if (state.hopperNamingLine9 === "main") return hi === 0 ? "Main" : String(hi);
      return String(hi + 1);
    }

    function setWorkspaceHopperCircumference(value){
      state.hopperCircumference = clampNum(value);
      // Keep legacy per-hopper fields aligned for profiles/session payloads
      // created by older versions. Smart Hopper calculation reads only the
      // shared workspace value.
      state.layers.forEach(layer=>layer.hoppers.forEach(hopper=>{ hopper.circumference = state.hopperCircumference; }));
    }

    function renderMobileWeightsArea(area){
      const selected = new Set();
      const cellRefs = new Map();
      let bulkMode = false;
      let visualMode = true;

      const controls = document.createElement("div");
      controls.className = "mobileWeightsControls";

      const controlRail = document.createElement("div");
      controlRail.className = "mobileWeightsControlRail";

      const smartControl = document.createElement("div");
      smartControl.className = "mobileWeightsSmartControl";
      const smartCopy = document.createElement("div");
      smartCopy.innerHTML = "<strong>Smart</strong><small>computed weight</small>";
      const smartToggle = document.createElement("div");
      smartToggle.id = "smartHoppersToggle";
      smartToggle.className = "toggle";
      smartToggle.setAttribute("role", "switch");
      smartToggle.setAttribute("tabindex", "0");
      smartToggle.setAttribute("aria-label", "Enable Smart Hoppers");
      smartToggle.title = "Smart Hoppers: compute weight from shared circumference, hopper height, and resin density when known";
      smartToggle.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M7 4h14l3 5v13l-4 3H8l-4-3V9z"/><path d="M8 16h12v6H8z"/></svg>';
      smartControl.append(smartCopy, smartToggle);
      controlRail.appendChild(smartControl);

      if (state.smartHoppersEnabled){
        const circumferenceLabel = document.createElement("label");
        circumferenceLabel.className = "mobileSharedCircumference";
        circumferenceLabel.innerHTML = "<span>Ø</span><small>in</small>";
        const circumferenceInput = document.createElement("input");
        circumferenceInput.id = "mobileSharedCircumference";
        circumferenceInput.type = "text";
        circumferenceInput.inputMode = "decimal";
        circumferenceInput.placeholder = "0";
        circumferenceInput.value = String(clampNum(state.hopperCircumference));
        circumferenceInput.setAttribute("aria-label", "Shared hopper circumference in inches, applied to every hopper");
        circumferenceLabel.appendChild(circumferenceInput);
        controlRail.appendChild(circumferenceLabel);
        circumferenceInput.addEventListener("input", event=>{
          const accepted = acceptNumericInput(
            event.target,
            { min: 0, label: "Shared hopper circumference" },
            value=>setWorkspaceHopperCircumference(value)
          );
          if (!accepted) return;
          validateAndCompute({ sync: true });
          saveSession();
        });
      }

      const bulkToggleRow = document.createElement("div");
      bulkToggleRow.className = "mobileWeightsBulkToggleRow";
      bulkToggleRow.innerHTML = "<div><strong>Bulk</strong><small>select cells</small></div>";
      const bulkToggle = document.createElement("div");
      bulkToggle.id = "mobileWeightsBulkToggle";
      bulkToggle.className = "toggle";
      bulkToggle.setAttribute("role", "switch");
      bulkToggle.setAttribute("tabindex", "0");
      bulkToggle.setAttribute("aria-label", "Enable bulk receiver hopper entry");
      bulkToggle.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1"/><rect x="16" y="4" width="8" height="8" rx="1"/><rect x="4" y="16" width="8" height="8" rx="1"/><path d="M17 20l2 2 5-6"/></svg>';
      bulkToggleRow.appendChild(bulkToggle);
      controlRail.appendChild(bulkToggleRow);
      controls.appendChild(controlRail);

      const viewToggle = document.createElement("div");
      viewToggle.className = "mobileWeightsViewToggle";
      viewToggle.innerHTML = '<span>View</span><button type="button" data-weight-view="visual" class="active">Visual</button><button type="button" data-weight-view="edit">Edit</button>';
      controls.appendChild(viewToggle);
      area.appendChild(controls);

      if (state.smartHoppersEnabled){
        const legend = document.createElement("div");
        legend.className = "mobileWeightsSmartLegend";
        legend.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 10v6M12 7.2h.01"/></svg><div><strong>Smart Hopper guide</strong><small><b>W</b> is manual weight; <b>H</b> is usable height. When recipe resin and measured bulk density are available, calculated weight drives run-down timing.</small></div>';
        area.appendChild(legend);
      }

      const matrix = document.createElement("div");
      matrix.className = "mobileWeightsMatrix";
      matrix.style.setProperty("--mobile-weight-layer-count", String(state.layers.length));
      state.layers.forEach(L=>{
        const column = document.createElement("section");
        column.className = "mobileWeightsLayer";
        for (let hi=0; hi<HOPPERS_PER_LAYER; hi++){
          const key = `${L.name}:${hi}`;
          const hopper = L.hoppers[hi];
          const cell = document.createElement("div");
          cell.className = "mobileWeightCell";
          const label = document.createElement("span");
          label.className = "mobileWeightCellLabel";
          label.textContent = `${L.name}${hopperPositionLabel(hi)}`;
          cell.appendChild(label);

          const selector = document.createElement("input");
          selector.type = "checkbox";
          selector.className = "mobileWeightCellSelector";
          selector.setAttribute("aria-label", `Select ${hopperBadgeLabel(L.name, hi)} for bulk entry`);
          cell.appendChild(selector);

          const valueFields = document.createElement("div");
          valueFields.className = "mobileWeightValueFields";
          const visualReadout = document.createElement("div");
          visualReadout.className = "mobileWeightVisualReadout";
          visualReadout.innerHTML = `
            <svg viewBox="0 0 28 42" aria-hidden="true"><path d="M6 3h16l2 6v27l-4 3H8l-4-3V9z"/><path class="mobileHopperFill" d="M8 22h12v13H8z"/></svg>
            <span class="mobileWeightVisualValues"><b>${clampNum(hopper.weight)}<small>lb manual</small></b><b>${clampNum(hopper.usableHeight)}<small>in height</small></b></span>`;
          const makeValueField = (shortLabel, value, ariaLabel, onValue)=>{
            const wrap = document.createElement("label");
            wrap.className = "mobileWeightValueField";
            const caption = document.createElement("span");
            caption.textContent = shortLabel;
            const input = document.createElement("input");
            input.type = "text";
            input.inputMode = "decimal";
            input.placeholder = "0";
            input.value = String(clampNum(value));
            input.setAttribute("aria-label", ariaLabel);
            wrap.append(caption, input);
            input.addEventListener("input", event=>{
              const accepted = acceptNumericInput(event.target, { min: 0, label: ariaLabel }, onValue);
              if (!accepted) return;
              validateAndCompute({ sync: true });
              saveSession();
            });
            valueFields.appendChild(wrap);
            return input;
          };
          const weightInput = makeValueField("W", hopper.weight, `${hopperBadgeLabel(L.name, hi)} manual weight in pounds`, value=>{ hopper.weight = value; visualReadout.querySelectorAll("b")[0].firstChild.nodeValue = value; });
          let heightInput = null;
          if (state.smartHoppersEnabled){
            heightInput = makeValueField("H", hopper.usableHeight, `${hopperBadgeLabel(L.name, hi)} usable height in inches`, value=>{ hopper.usableHeight = value; visualReadout.querySelectorAll("b")[1].firstChild.nodeValue = value; });
          }
          cell.appendChild(valueFields);
          cell.appendChild(visualReadout);
          if (state.smartHoppersEnabled){
            const computedWeight = document.createElement("div");
            computedWeight.id = computedWeightId(L.name, hi);
            computedWeight.className = "mobileWeightsComputedWeight";
            computedWeight.hidden = true;
            cell.appendChild(computedWeight);
          }
          column.appendChild(cell);
          cellRefs.set(key, { cell, selector, weightInput, heightInput, hopper });

          selector.addEventListener("change", ()=>{
            selector.checked ? selected.add(key) : selected.delete(key);
            updateSelectionUI();
          });
          cell.addEventListener("click", event=>{
            if (!bulkMode || event.target.closest("input")) return;
            selector.checked = !selector.checked;
            selector.dispatchEvent(new Event("change"));
          });
        }
        matrix.appendChild(column);
      });
      area.appendChild(matrix);

      const bulkBar = document.createElement("div");
      bulkBar.id = "mobileWeightsBulkBar";
      bulkBar.className = "mobileWeightsBulkBar";
      bulkBar.hidden = true;
      bulkBar.innerHTML = `
        <label><span>Weight</span><input id="mobileBulkWeight" type="text" inputmode="decimal" placeholder="No change" /></label>
        ${state.smartHoppersEnabled ? '<label><span>Height</span><input id="mobileBulkHeight" type="text" inputmode="decimal" placeholder="No change" /></label>' : ""}
        <div class="mobileWeightsBulkActions"><small id="mobileWeightSelectionStatus" role="status">No hoppers selected</small><button id="applyMobileBulkWeights" type="button" disabled>Apply</button></div>
        <div class="mobileWeightsBulkTextActions"><button id="selectAllMobileWeights" type="button">Select all</button><button id="clearMobileWeightSelection" type="button">Clear</button></div>
      `;
      area.appendChild(bulkBar);

      const applyButton = bulkBar.querySelector("#applyMobileBulkWeights");
      const selectionStatus = bulkBar.querySelector("#mobileWeightSelectionStatus");
      const bulkWeight = bulkBar.querySelector("#mobileBulkWeight");
      const bulkHeight = bulkBar.querySelector("#mobileBulkHeight");

      function updateSelectionUI(message){
        cellRefs.forEach((ref,key)=>{
          const isSelected = selected.has(key);
          ref.selector.checked = isSelected;
          ref.cell.classList.toggle("selected", isSelected);
        });
        applyButton.disabled = selected.size === 0;
        selectionStatus.textContent = message || (selected.size ? `${selected.size} selected` : "No hoppers selected");
      }

      function setMobileWeightBulkMode(enabled){
        bulkMode = !!enabled;
        area.dataset.mobileBulkMode = String(bulkMode);
        bulkToggle.classList.toggle("on", bulkMode);
        bulkToggle.setAttribute("aria-checked", String(bulkMode));
        bulkBar.hidden = !bulkMode;
        if (!bulkMode){
          selected.clear();
          updateSelectionUI();
        }
      }

      function setMobileWeightView(mode){
        visualMode = mode === "visual";
        area.dataset.mobileWeightView = visualMode ? "visual" : "edit";
        viewToggle.querySelectorAll("button").forEach(button=>button.classList.toggle("active", button.dataset.weightView === (visualMode ? "visual" : "edit")));
      }

      const flipBulkMode = ()=>setMobileWeightBulkMode(!bulkMode);
      bulkToggle.addEventListener("click", flipBulkMode);
      viewToggle.addEventListener("click", event=>{
        const button = event.target.closest("button[data-weight-view]");
        if (button) setMobileWeightView(button.dataset.weightView);
      });
      bulkToggle.addEventListener("keydown", event=>{
        if (event.key === "Enter" || event.key === " "){
          event.preventDefault();
          flipBulkMode();
        }
      });
      bulkBar.querySelector("#selectAllMobileWeights").addEventListener("click", ()=>{
        cellRefs.forEach((_,key)=>selected.add(key));
        updateSelectionUI();
      });
      bulkBar.querySelector("#clearMobileWeightSelection").addEventListener("click", ()=>{
        selected.clear();
        updateSelectionUI();
      });
      applyButton.addEventListener("click", ()=>{
        const readOptional = (input, label)=>{
          if (!input || !input.value.trim()) return { valid:true, value:null };
          const result = validation.validateNumber(input.value, { min:0, label });
          input.setCustomValidity(result.valid ? "" : result.message);
          input.setAttribute("aria-invalid", String(!result.valid));
          input.title = result.valid ? "" : result.message;
          return result;
        };
        const weightResult = readOptional(bulkWeight, "Bulk weight");
        const heightResult = readOptional(bulkHeight, "Bulk height");
        if (!weightResult.valid || !heightResult.valid) return;
        if (weightResult.value === null && heightResult.value === null){
          selectionStatus.textContent = "Enter a weight or height to apply";
          return;
        }
        selected.forEach(key=>{
          const ref = cellRefs.get(key);
          if (!ref) return;
          if (weightResult.value !== null){
            ref.hopper.weight = weightResult.value;
            ref.weightInput.value = String(weightResult.value);
          }
          if (heightResult.value !== null && ref.heightInput){
            ref.hopper.usableHeight = heightResult.value;
            ref.heightInput.value = String(heightResult.value);
          }
        });
        validateAndCompute({ sync:true });
        saveSession();
        updateSelectionUI("Bulk values applied");
      });

      setMobileWeightBulkMode(false);
      setMobileWeightView("visual");
      hookToggle(
        "smartHoppersToggle",
        ()=> !!state.smartHoppersEnabled,
        value=>{ state.smartHoppersEnabled = !!value; renderWeightsArea(); }
      );
      refreshSmartHopperState();
    }

    function renderWeightsArea(){
      const area = $("weightsArea");
      if (!area) return;
      area.innerHTML = "";
      if (window.matchMedia("(max-width: 900px)").matches){
        renderMobileWeightsArea(area);
        return;
      }
      const selected = new Set();
      const cellRefs = new Map();
      const columnSelectors = new Map();
      const rowSelectors = new Map();

      function toggleSelection(keys){
        const select = keys.some(key=>!selected.has(key));
        keys.forEach(key=> select ? selected.add(key) : selected.delete(key));
        updateSelectionUI();
      }

      const toolbar = document.createElement("div");
      toolbar.className = "weightsBulkBar";
      toolbar.innerHTML = `
        <div class="weightsBulkSteps" aria-label="Bulk hopper editing steps">
          <span><b>1</b> Select hoppers</span>
          <span><b>2</b> Enter weight</span>
          <span><b>3</b> Apply</span>
        </div>
        <label class="weightsBulkField" for="bulkWeight">
          <span>Receiver weight</span>
          <span class="weightsInputWithUnit">
            <input id="bulkWeight" type="text" inputmode="decimal" placeholder="No change" />
            <span>lb</span>
          </span>
        </label>
        ${state.smartHoppersEnabled ? '<label class="weightsBulkField" for="bulkHeight"><span>Usable height</span><span class="weightsInputWithUnit"><input id="bulkHeight" type="text" inputmode="decimal" placeholder="No change" /><span>in</span></span></label>' : ""}
        <div class="weightsBulkApply">
          <div id="weightSelectionStatus" class="tiny weightsSelectionStatus" role="status" aria-live="polite">No hoppers selected</div>
          <button id="applyBulkWeight" type="button" disabled>Apply to selected</button>
        </div>
        <div class="weightsBulkActions">
          <button id="selectAllWeights" type="button" class="bulkTextAction">Select all</button>
          <button id="clearWeightSelection" type="button" class="bulkTextAction">Clear selection</button>
        </div>
        <div class="weightsBulkNote tiny">Individual weights can still be edited directly in the table.</div>
      `;

      let smartWorkspaceControl = null;
      if (state.smartHoppersEnabled){
        smartWorkspaceControl = document.createElement("div");
        smartWorkspaceControl.className = "desktopSmartHopperInfo";
        smartWorkspaceControl.innerHTML = `
          <div><strong>Smart Hoppers</strong><small>Calculated weight uses each hopper's usable height, this workspace circumference, its recipe resin, and that resin's measured bulk density.</small></div>
          <label>Shared circumference (in)<input id="desktopSharedCircumference" type="text" inputmode="decimal" placeholder="0" value="${clampNum(state.hopperCircumference)}" /></label>
        `;
        const circumferenceInput = smartWorkspaceControl.querySelector("input");
        circumferenceInput.addEventListener("input", event=>{
          const accepted = acceptNumericInput(event.target, { min: 0, label: "Shared hopper circumference" }, setWorkspaceHopperCircumference);
          if (!accepted) return;
          validateAndCompute({ sync: true });
          saveSession();
        });
      }

      const scroll = document.createElement("div");
      scroll.className = "weightsMatrixScroll";
      const frame = document.createElement("div");
      frame.className = "weightsMatrixFrame";
      const table = document.createElement("table");
      table.className = "weightsMatrix";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      const corner = document.createElement("th");
      corner.scope = "col";
      corner.className = "weightsRowCorner";
      const smartWrap = document.createElement("div");
      smartWrap.className = "weightsSmartToggleWrap";
      const smartLabel = document.createElement("span");
      smartLabel.className = "weightsSmartToggleLabel";
      smartLabel.textContent = "Smart";
      const smartToggle = document.createElement("div");
      smartToggle.id = "smartHoppersToggle";
      smartToggle.className = "toggle";
      smartToggle.setAttribute("role", "switch");
      smartToggle.setAttribute("tabindex", "0");
      smartToggle.title = "Smart Hoppers: compute weight from hopper geometry and resin density when known";
      smartWrap.append(smartLabel, smartToggle);
      corner.appendChild(smartWrap);
      headerRow.appendChild(corner);
      state.layers.forEach(L=>{
        const th = document.createElement("th");
        th.scope = "col";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "weightsSelectHeader";
        button.textContent = L.name;
        button.setAttribute("aria-label", `Select or clear all Layer ${L.name} hoppers`);
        button.title = `Select or clear all Layer ${L.name} hoppers`;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", ()=>toggleSelection(
          Array.from({length:HOPPERS_PER_LAYER}, (_,hi)=>`${L.name}:${hi}`)
        ));
        columnSelectors.set(L.name, button);
        th.appendChild(button);
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (let hi=0; hi<HOPPERS_PER_LAYER; hi++){
        const tr = document.createElement("tr");
        const rowHeader = document.createElement("th");
        rowHeader.scope = "row";
        const rowButton = document.createElement("button");
        rowButton.type = "button";
        rowButton.className = "weightsSelectHeader mono";
        rowButton.textContent = hopperPositionLabel(hi);
        rowButton.title = `Select or clear hopper ${hopperPositionLabel(hi)} across all layers`;
        rowButton.setAttribute("aria-label", `Select hopper ${hopperPositionLabel(hi)} across all layers`);
        rowButton.setAttribute("aria-pressed", "false");
        rowButton.addEventListener("click", ()=>toggleSelection(
          state.layers.map(L=>`${L.name}:${hi}`)
        ));
        rowSelectors.set(hi, rowButton);
        rowHeader.appendChild(rowButton);
        tr.appendChild(rowHeader);

        state.layers.forEach(L=>{
          const key = `${L.name}:${hi}`;
          const id = weightId(L.name, hi);
          const td = document.createElement("td");
          td.className = "weightsMatrixCell";
          const cellRow = document.createElement("div");
          cellRow.className = "weightsCellRow";

          const selector = document.createElement("input");
          selector.type = "checkbox";
          selector.className = "weightsCellSelector";
          selector.setAttribute("aria-label", `Select ${hopperBadgeLabel(L.name, hi)}`);

          const fieldWrap = document.createElement("span");
          fieldWrap.className = "weightsInputWithUnit";
          const input = document.createElement("input");
          input.id = id;
          input.type = "text";
          input.inputMode = "decimal";
          input.placeholder = "0";
          input.value = String(clampNum(L.hoppers[hi].weight));
          input.setAttribute("aria-label", `${hopperBadgeLabel(L.name, hi)} weight in pounds`);
          const unit = document.createElement("span");
          unit.textContent = "lb";
          fieldWrap.append(input, unit);
          cellRow.append(selector, fieldWrap);

          const visualReadout = document.createElement("div");
          visualReadout.className = "desktopWeightVisualReadout";
          visualReadout.innerHTML = `
            <span class="desktopWeightVisualId">${L.name}${hopperPositionLabel(hi)}</span>
            <svg viewBox="0 0 40 62" aria-hidden="true"><path d="M9 4h22l4 8v40l-6 5H11l-6-5V12z"/><path class="desktopHopperFill" d="M11 32h18v18H11z"/></svg>
            <span class="desktopWeightVisualValues"><label><input class="desktopVisualWeight" type="text" inputmode="decimal" value="${clampNum(L.hoppers[hi].weight)}" aria-label="${hopperBadgeLabel(L.name, hi)} manual weight in pounds"/><small>lb manual</small></label>${state.smartHoppersEnabled ? `<label><input class="desktopVisualHeight" type="text" inputmode="decimal" value="${clampNum(L.hoppers[hi].usableHeight)}" aria-label="${hopperBadgeLabel(L.name, hi)} usable height in inches"/><small>in height</small></label>` : ""}</span>`;
          const visualWeightInput = visualReadout.querySelector(".desktopVisualWeight");
          const visualHeightInput = visualReadout.querySelector(".desktopVisualHeight");

          let geometryPopover = null;
          let computedWeight = null;
          if (state.smartHoppersEnabled){
            geometryPopover = document.createElement("details");
            geometryPopover.className = "hopperGeometryPopover";
            geometryPopover.setAttribute("name", "hopperGeometry");
            const trigger = document.createElement("summary");
            trigger.className = "hopperGeometryTrigger";
            const geometryLabel = `Set ${hopperBadgeLabel(L.name, hi)} usable height`;
            trigger.setAttribute("aria-label", geometryLabel);
            trigger.title = geometryLabel;
            trigger.textContent = "🔧";
            const panel = document.createElement("div");
            panel.className = "hopperGeometryPanel";

            const heightLabel = document.createElement("label");
            const heightCaption = document.createElement("span");
            heightCaption.textContent = "Usable height (in)";
            const heightInput = document.createElement("input");
            heightInput.id = `gh_${L.name}_${hi}`;
            heightInput.type = "text";
            heightInput.inputMode = "decimal";
            heightInput.placeholder = "0";
            heightInput.value = String(clampNum(L.hoppers[hi].usableHeight));
            heightInput.setAttribute("aria-label", `${hopperBadgeLabel(L.name, hi)} usable height in inches`);
            heightLabel.append(heightCaption, heightInput);

            // Circumference is a workspace-wide physical setting above the
            // matrix. The wrench deliberately contains only this hopper's
            // unique usable-height value.
            panel.append(heightLabel);
            geometryPopover.append(trigger, panel);
            cellRow.appendChild(geometryPopover);

            // position:fixed, placed via JS on open - the matrix scrolls
            // inside an overflow:hidden frame, so a plain absolute panel
            // gets clipped for any hopper near the table's bottom/right
            // edge. Fixed positioning escapes that entirely; clamped to
            // the viewport so it never runs off-screen either.
            geometryPopover.addEventListener("toggle", ()=>{
              if (!geometryPopover.open) return;
              const rect = trigger.getBoundingClientRect();
              const panelWidth = panel.offsetWidth || 190;
              let left = rect.right - panelWidth;
              left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
              let top = rect.bottom + 6;
              const panelHeight = panel.offsetHeight || 120;
              if (top + panelHeight > window.innerHeight - 8){
                top = rect.top - panelHeight - 6;
              }
              panel.style.left = `${left}px`;
              panel.style.top = `${Math.max(8, top)}px`;
            });

            heightInput.addEventListener("input",(e)=>{
              const accepted = acceptNumericInput(
                e.target,
                { min: 0, label: `${hopperBadgeLabel(L.name, hi)} usable height` },
                value => { L.hoppers[hi].usableHeight = value; if (visualHeightInput) visualHeightInput.value = value; }
              );
              if (!accepted) return;
              validateAndCompute({ sync: true });
              saveSession();
            });
            // The smaller, non-interactive computed-weight readout - only
            // shown when this hopper's geometry + its assigned resin's known
            // density make a computed weight possible. Kept in sync by
            // refreshSmartHopperState() (called from
            // validateAndCompute, and once here for the initial render)
            // rather than a full re-render, so typing in this popover never
            // closes itself. Appended after .weightsCellRow below (not here)
            // so it visually sits underneath the weight field, not above it.
            computedWeight = document.createElement("div");
            computedWeight.id = computedWeightId(L.name, hi);
            computedWeight.className = "weightsComputedWeight";
            computedWeight.hidden = true;
          }

          td.appendChild(cellRow);
          td.appendChild(visualReadout);
          if (computedWeight) td.appendChild(computedWeight);
          tr.appendChild(td);

          cellRefs.set(key, { td, selector, input, visualWeightInput, visualHeightInput, layer: L, hi });

          selector.addEventListener("change", ()=>{
            selector.checked ? selected.add(key) : selected.delete(key);
            updateSelectionUI();
          });
          td.addEventListener("click",(e)=>{
            if (e.target === input || e.target === selector || e.target.closest(".hopperGeometryPopover") || e.target.closest(".desktopWeightVisualReadout input")) return;
            selector.checked = !selector.checked;
            selector.dispatchEvent(new Event("change"));
          });
          input.addEventListener("input",(e)=>{
            const accepted = acceptNumericInput(
              e.target,
              { min: 0, label: `${hopperBadgeLabel(L.name, hi)} weight` },
              value => { L.hoppers[hi].weight = value; visualWeightInput.value = value; }
            );
            if (!accepted) return;
            validateAndCompute({ sync: true });
            saveSession();
          });
          visualWeightInput.addEventListener("input", event=>{
            const accepted = acceptNumericInput(event.target, { min:0, label:`${hopperBadgeLabel(L.name, hi)} weight` }, value=>{ L.hoppers[hi].weight = value; input.value = value; });
            if (!accepted) return;
            validateAndCompute({ sync:true }); saveSession();
          });
          visualHeightInput?.addEventListener("input", event=>{
            const accepted = acceptNumericInput(event.target, { min:0, label:`${hopperBadgeLabel(L.name, hi)} usable height` }, value=>{ L.hoppers[hi].usableHeight = value; });
            if (!accepted) return;
            validateAndCompute({ sync:true }); saveSession();
          });
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      frame.appendChild(table);
      scroll.appendChild(frame);
      area.appendChild(scroll);
      area.appendChild(toolbar);
      if (smartWorkspaceControl) area.appendChild(smartWorkspaceControl);

      const bulkInput = toolbar.querySelector("#bulkWeight");
      const bulkHeightInput = toolbar.querySelector("#bulkHeight");
      const applyButton = toolbar.querySelector("#applyBulkWeight");
      const status = toolbar.querySelector("#weightSelectionStatus");
      bulkInput.addEventListener("input", ()=>{
        bulkInput.setCustomValidity("");
        bulkInput.setAttribute("aria-invalid", "false");
        bulkInput.title = "";
      });

      function updateSelectionUI(message){
        cellRefs.forEach((ref,key)=>{
          const isSelected = selected.has(key);
          ref.selector.checked = isSelected;
          ref.td.classList.toggle("selected", isSelected);
        });
        columnSelectors.forEach((button, layerName)=>{
          const keys = Array.from({length:HOPPERS_PER_LAYER}, (_,hi)=>`${layerName}:${hi}`);
          const count = keys.filter(key=>selected.has(key)).length;
          button.classList.toggle("selected", count === keys.length);
          button.classList.toggle("partiallySelected", count > 0 && count < keys.length);
          button.setAttribute("aria-pressed", count === keys.length ? "true" : (count ? "mixed" : "false"));
        });
        rowSelectors.forEach((button, hi)=>{
          const keys = state.layers.map(L=>`${L.name}:${hi}`);
          const count = keys.filter(key=>selected.has(key)).length;
          button.classList.toggle("selected", count === keys.length);
          button.classList.toggle("partiallySelected", count > 0 && count < keys.length);
          button.setAttribute("aria-pressed", count === keys.length ? "true" : (count ? "mixed" : "false"));
        });
        applyButton.disabled = selected.size === 0;
        applyButton.textContent = selected.size
          ? `Apply to ${selected.size} hopper${selected.size === 1 ? "" : "s"}`
          : "Apply to selected";
        status.textContent = message || (
          selected.size === 0
            ? "No hoppers selected"
            : `${selected.size} hopper${selected.size === 1 ? "" : "s"} selected`
        );
      }

      toolbar.querySelector("#selectAllWeights").addEventListener("click", ()=>{
        cellRefs.forEach((_,key)=>selected.add(key));
        updateSelectionUI();
      });
      toolbar.querySelector("#clearWeightSelection").addEventListener("click", ()=>{
        selected.clear();
        updateSelectionUI();
      });
      applyButton.addEventListener("click", ()=>{
        const optionalValue = (field, label)=>{
          if (!field || !field.value.trim()) return { valid:true, value:null };
          const result = validation.validateNumber(field.value, { min:0, label });
          field.setCustomValidity(result.valid ? "" : result.message);
          field.setAttribute("aria-invalid", String(!result.valid));
          field.title = result.valid ? "" : result.message;
          return result;
        };
        const result = optionalValue(bulkInput, "Bulk weight");
        const heightResult = optionalValue(bulkHeightInput, "Bulk height");
        if (!result.valid || !heightResult.valid) return;
        if (result.value === null && heightResult.value === null){ status.textContent = "Enter a weight or height to apply"; return; }

        selected.forEach(key=>{
          const ref = cellRefs.get(key);
          if (!ref) return;
          if (result.value !== null){ ref.layer.hoppers[ref.hi].weight = result.value; ref.input.value = String(result.value); ref.visualWeightInput.value = String(result.value); }
          if (heightResult.value !== null){ ref.layer.hoppers[ref.hi].usableHeight = heightResult.value; if (ref.visualHeightInput) ref.visualHeightInput.value = String(heightResult.value); }
        });
        validateAndCompute({ sync: true });
        saveSession();
        updateSelectionUI("Bulk values applied");
      });

      updateSelectionUI();
      area.dataset.desktopWeightView = "visual";

      hookToggle(
        "smartHoppersToggle",
        ()=> !!state.smartHoppersEnabled,
        (v)=>{ state.smartHoppersEnabled = !!v; renderWeightsArea(); }
      );

      refreshSmartHopperState();
    }

    // The single source of truth for whether a hopper's weight is
    // Smart-Hoppers-computable, and what that value is. Used both for
    // display (refreshSmartHopperState below) and for the run-down formula
    // itself (effectiveHopperWeight, used from validateAndCompute) - so
    // there's exactly one place that decides "is this hopper smart" and
    // one formula, never two implementations that could drift apart.
    // Returns null (not a fallback value) when any of the three conditions
    // aren't met, so callers can't accidentally treat "not computable" as 0.
    // Requires the resin's own measured bulk_density_lb_ft3 - deliberately
    // does not estimate bulk density from polymer density and a packing
    // factor, since packing factor varies too much per resin to guess at
    // safely. A hopper without a measured bulk density on its resin simply
    // isn't computable; the operator's own entered weight is used instead.
    function smartHopperComputation(hopper){
      if (!state.smartHoppersEnabled) return null;
      const heightVal = clampNum(hopper.usableHeight);
      const circVal = clampNum(state.hopperCircumference);
      if (!(heightVal > 0 && circVal > 0 && hopper.resinName)) return null;
      const resin = resinLookup?.findExactResin?.(hopper.resinName, resinCatalogRecords);
      const bulkDensity = resin?.bulk_density_lb_ft3;
      if (!bulkDensity) return null;
      const value = calculators.calculateHopperWeight(circVal, heightVal, bulkDensity);
      if (!Number.isFinite(value) || value <= 0) return null;
      return { value, resin, bulkDensity };
    }

    // The weight the run-down formula (and anything else that needs "how
    // much resin is actually in this hopper") should use: the Smart
    // Hoppers computed value when available, otherwise the operator's own
    // entered weight - never both, never neither silently.
    function effectiveHopperWeight(hopper){
      return smartHopperComputation(hopper)?.value ?? clampNum(hopper.weight);
    }

    // Recomputes, for every hopper, whether a Smart Hoppers weight is
    // currently computable, and updates every UI surface that reflects it
    // in place - never a re-render, so this is safe to call from
    // validateAndCompute() on every keystroke (including while a wrench
    // popover is open) without ever closing anything. That depends on
    // state.layers[].hoppers[] fields (usableHeight, circumference,
    // resinName) that can change from several places - the wrench popover
    // in Receiver Hopper Weights, and Recipe Setup's own resin input - so
    // this is called centrally from validateAndCompute rather than wired
    // individually into every one of those call sites. Surfaces updated:
    // the computed-weight readout under the weight field (Receiver Hopper
    // Weights), and the small "SMART" badge next to the tracking clock
    // (Recipe Setup).
    function refreshSmartHopperState(){
      state.layers.forEach(L=>{
        L.hoppers.forEach((hopper, hi)=>{
          const smart = smartHopperComputation(hopper);

          const computedEl = document.getElementById(computedWeightId(L.name, hi));
          if (computedEl){
            if (smart){
              computedEl.hidden = false;
              computedEl.textContent = computedEl.classList.contains("mobileWeightsComputedWeight")
                ? `✓ ${fmtNum(smart.value, 1)} lb`
                : `✓ Calculated: ${fmtNum(smart.value, 1)} lb`;
              computedEl.title = `Computed from ${hopperBadgeLabel(L.name, hi)}'s geometry and ${smart.resin.resin_code}'s bulk density (${smart.bulkDensity} lb/ft³). Used for the run-down formula instead of the entered weight above.`;
            } else {
              computedEl.hidden = true;
              computedEl.textContent = "";
              computedEl.removeAttribute("title");
            }
          }

          const badgeEl = document.getElementById(smartBadgeId(L.name, hi));
          if (badgeEl) badgeEl.hidden = !smart;
        });
      });
    }

    function printRecipeSheet(){
      const existing = document.getElementById("recipePrintSheet");
      if (existing) existing.remove();

      const sheet = document.createElement("div");
      sheet.id = "recipePrintSheet";

      const header = document.createElement("div");
      header.className = "printSheetHeader";
      const title = document.createElement("h1");
      title.textContent = "Recipe Setup";
      const meta = document.createElement("div");
      meta.className = "printSheetMeta";
      const workspaceName = lineSync?.getState?.().selectedWorkspace?.name || "Local";
      const lineTypeLabel = `${state.lineType} layer${state.lineType === 1 ? "" : "s"}`;
      const namingLabel = state.hopperNamingLine9 === "main" ? "Main + 1–5" : "1–6";
      meta.textContent = `${workspaceName} · ${lineTypeLabel} · Hopper naming: ${namingLabel} · Printed ${new Date().toLocaleString()}`;
      header.append(title, meta);
      sheet.append(header);

      // A single overview table - layers as rows, hoppers as columns - to
      // read like the printouts operators already get off the dosing
      // controller itself (material overview: one row per layer, one
      // column per hopper, resin code and value stacked in each cell).
      // Column headers are naming-mode-generic (not per-layer, unlike
      // hopperBadgeLabel) since H1's label is otherwise identical across
      // every layer in "standard" mode and the row already carries the
      // layer letter.
      const hopperColumnLabels = state.hopperNamingLine9 === "main"
        ? ["Main", "1", "2", "3", "4", "5"]
        : ["H1", "H2", "H3", "H4", "H5", "H6"];

      const table = document.createElement("table");
      table.className = "printSheetTable";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      headRow.appendChild(document.createElement("th"));
      hopperColumnLabels.forEach(text=>{
        const th = document.createElement("th");
        th.textContent = text;
        headRow.appendChild(th);
      });
      const layerPctHead = document.createElement("th");
      layerPctHead.textContent = "Layer %";
      headRow.appendChild(layerPctHead);
      thead.appendChild(headRow);

      const tbody = document.createElement("tbody");
      state.layers.forEach(L=>{
        const row = document.createElement("tr");
        const layerLabel = document.createElement("th");
        layerLabel.className = "printSheetLayerLabel";
        layerLabel.scope = "row";
        layerLabel.textContent = L.name;
        row.appendChild(layerLabel);
        L.hoppers.forEach(h=>{
          const cell = document.createElement("td");
          const resinName = normName(h.resinName);
          const nameLine = document.createElement("div");
          nameLine.className = "printSheetResin";
          nameLine.textContent = resinName || "NOT USED";
          const pctLine = document.createElement("div");
          pctLine.className = "printSheetPct";
          pctLine.textContent = `${fmtNum(clampNum(h.pct), 2)}%`;
          cell.append(nameLine, pctLine);
          row.appendChild(cell);
        });
        const layerPctCell = document.createElement("td");
        layerPctCell.className = "printSheetLayerPct";
        layerPctCell.textContent = `${fmtNum(clampNum(L.layerPct), 2)}%`;
        row.appendChild(layerPctCell);
        tbody.appendChild(row);
      });
      table.append(thead, tbody);
      sheet.append(table);

      document.body.appendChild(sheet);
      window.print();
    }

    function renderSplitsArea(){
      const area = $("splitsArea");
      if (!area) return;
      area.innerHTML = "";
      const copyRules = getLayerCopyRules(state.lineType);
      const selected = new Set();
      const cellRefs = new Map();
      const columnSelectors = new Map();
      const rowSelectors = new Map();
      let bulkMode = splitsBulkModeActive;

      function toggleSelection(keys){
        const select = keys.some(key=>!selected.has(key));
        keys.forEach(key=>select ? selected.add(key) : selected.delete(key));
        updateSelectionUI();
      }

      function copyLayer(fromName, toName){
        const from = state.layers.find(L=>L.name===fromName);
        const to = state.layers.find(L=>L.name===toName);
        if (!from || !to) return;
        for (let i=0;i<HOPPERS_PER_LAYER;i++){
          to.hoppers[i].pct = clampNum(from.hoppers[i].pct);
          to.hoppers[i].resinName = normName(from.hoppers[i].resinName);
        }
      }

      const modeBar = document.createElement("div");
      modeBar.className = "splitsBulkModeBar";
      // Recipe Setup's own entry point into the shared-recipe list
      // (see renderSplitsSavedRecipes) - Load is the action operators reach
      // for most from here, so it leads the row rather than sitting after
      // the editing tools.
      const savedRecipesButton = document.createElement("button");
      savedRecipesButton.type = "button";
      savedRecipesButton.className = "secondary";
      savedRecipesButton.textContent = "Saved Recipes";
      savedRecipesButton.setAttribute("aria-expanded", "false");
      modeBar.appendChild(savedRecipesButton);
      const modeButton = document.createElement("button");
      modeButton.type = "button";
      modeButton.className = "secondary";
      modeButton.textContent = "Bulk edit";
      modeButton.setAttribute("aria-expanded", "false");
      modeBar.appendChild(modeButton);
      const rearrangeButton=document.createElement("button"); rearrangeButton.type="button"; rearrangeButton.className="secondary"; rearrangeButton.textContent=hopperRearrangement?.active?"Done Rearranging":"Rearrange"; rearrangeButton.setAttribute("aria-expanded", String(!!hopperRearrangement?.active)); rearrangeButton.disabled=!state.layers.some(L=>L.hoppers.some(h=>normName(h.resinName)||clampNum(h.pct)>0)); modeBar.appendChild(rearrangeButton);
      rearrangeButton.addEventListener("click",()=>{
        if(hopperRearrangement?.active){
          hopperRearrangement=null;
          renderSplitsArea();
          validateAndCompute();
          saveSession();
          notifyActiveJobMutation({immediate:true,kind:"rearrange-hoppers"});
          return;
        }
        splitsBulkModeActive = false;
        splitsSavedRecipesOpen = false;
        hopperRearrangement={active:true,baseline:window.PolynHopperRearrangement.snapshot(state.layers),undo:[],tapSource:null};
        renderSplitsArea();
      });

      // Native HTML5 drag-and-drop (used below, on each cell) never fires
      // from a touch gesture, so rearrange mode also supports
      // tap-to-select-source, then tap-a-destination, reusing the same
      // PolynHopperRearrangement.move() call and undo/failure handling as
      // the drag path. This exists because a successful tap move re-renders
      // (clearing everything fresh) but a failed one deliberately doesn't -
      // mirroring how a failed drop leaves the table alone and only updates
      // the summary text - so the previously-selected cell's highlight has
      // to be cleared by hand instead.
      function clearTapSourceHighlight(){
        table.querySelectorAll(".rearrangeSource").forEach(el=>el.classList.remove("rearrangeSource"));
      }

      // Same three-option popup as the mobile status bar's scan shortcut,
      // not one of the mutually-exclusive expandable panels above - a
      // click here goes straight into the existing scan flow
      // (recipe-scan-ui.js's startScan, exposed via window.PolynRecipeScanUI)
      // rather than dropping a panel of its own.
      const scanRecipeButton = document.createElement("details");
      scanRecipeButton.className = "splitsScanShortcut rearrangeDesktopOnly";
      scanRecipeButton.innerHTML = `
        <summary aria-label="Scan a recipe source" title="Scan a recipe source">Scan Recipe</summary>
        <div class="statusScanShortcutPanel">
          <button type="button" data-scan-source="job_traveler">Scan Job Traveler</button>
          <button type="button" data-scan-source="dosing_screen">Scan Dosing Screen</button>
          <button type="button" data-scan-source="heat_sheet">Scan Heat Sheet</button>
        </div>
      `;
      scanRecipeButton.querySelectorAll("[data-scan-source]").forEach(button=>{
        button.addEventListener("click", ()=>{
          scanRecipeButton.open = false;
          window.PolynRecipeScanUI?.startScan(button.dataset.scanSource);
        });
      });
      modeBar.appendChild(scanRecipeButton);
      splitsScanShortcut = scanRecipeButton;

      const printButton=document.createElement("button"); printButton.type="button"; printButton.className="secondary rearrangeDesktopOnly"; printButton.textContent="Print Recipe"; printButton.disabled=!state.layers.some(L=>L.hoppers.some(h=>normName(h.resinName)||clampNum(h.pct)>0)); modeBar.appendChild(printButton);
      printButton.addEventListener("click", printRecipeSheet);

      const toolbar = document.createElement("div");
      toolbar.className = "splitsBulkBar hide";
      toolbar.innerHTML = `
        <div class="splitsBulkSteps" aria-label="Bulk editing steps">
          <span><b>1</b> Select hoppers</span>
          <span><b>2</b> Enter changes</span>
          <span><b>3</b> Apply</span>
        </div>
        <label class="splitsBulkField" for="bulkResinName">
          <span>Resin name</span>
          <input id="bulkResinName" type="text" placeholder="No change" />
        </label>
        <label class="splitsBulkField" for="bulkResinPct">
          <span>Percentage</span>
          <span class="splitsBulkPctInput">
            <input id="bulkResinPct" type="text" inputmode="decimal" placeholder="No change" />
            <span>%</span>
          </span>
        </label>
        <div class="splitsBulkApply">
          <div id="splitSelectionStatus" class="tiny splitsSelectionStatus" role="status" aria-live="polite">No hoppers selected</div>
          <button id="applyBulkSplit" type="button" disabled>Apply to selected</button>
        </div>
        <div class="splitsBulkActions">
          <button id="selectAllSplits" type="button" class="bulkTextAction">Select all</button>
          <button id="clearSplitSelection" type="button" class="bulkTextAction">Clear selection</button>
          <button id="resetAllSplits" type="button" class="danger">Reset all</button>
        </div>
        <div class="splitsBulkNote tiny">Blank fields leave existing values unchanged.</div>
      `;

      // Recipe Setup's own copy of the shared recipe list
      // (see renderSplitsSavedRecipes) - same service/cache, same
      // Load/Update/Rename/Duplicate/Favorite/Delete actions, just a
      // closer-to-the-work entry point.
      const savedRecipesPanel = document.createElement("div");
      savedRecipesPanel.className = "splitsSavedRecipesPanel hide";
      savedRecipesPanel.innerHTML = `
        <div class="workspaceConfigurationSectionTitle">
          <div>
            <strong>Saved Recipes</strong>
            <small>Shared recipe assignments for this RT Sync workspace.</small>
          </div>
          <div class="splitsSavedRecipesActions">
            <button id="splitsSaveRecipe" class="secondary" type="button">Save Current Recipe</button>
            <button id="splitsLoadRecipe" class="primary" type="button" disabled>Load</button>
            <button id="splitsUpdateRecipe" class="secondary" type="button" disabled>Update</button>
            <details class="workspaceConfigurationOverflow overflow-disabled" id="splitsRecipeOverflow">
              <summary aria-label="More actions for the selected recipe">⋯</summary>
              <div class="workspaceConfigurationOverflowMenu">
                <button id="splitsRenameRecipe" type="button" class="secondary">Rename</button>
                <button id="splitsDuplicateRecipe" type="button" class="secondary">Duplicate</button>
                <button id="splitsFavoriteRecipe" type="button" class="secondary">Favorite</button>
                <button id="splitsDeleteRecipe" type="button" class="danger">Delete</button>
              </div>
            </details>
          </div>
        </div>
        <div id="splitsSavedRecipesStatus" class="muted" role="status" hidden></div>
        <div id="splitsSavedRecipesList" class="workspaceConfigurationList"></div>
      `;
      savedRecipesPanel.querySelector("#splitsSaveRecipe").addEventListener("click", ()=>openWorkspaceConfigurationDialog("save-recipe"));
      function setSavedRecipesOpen(open){
        savedRecipesPanel.classList.toggle("hide", !open);
        savedRecipesButton.textContent = open ? "Hide Saved Recipes" : "Saved Recipes";
        savedRecipesButton.setAttribute("aria-expanded", String(open));
        splitsSavedRecipesOpen = !!open;
      }
      savedRecipesButton.addEventListener("click", ()=>{
        const turningOn = savedRecipesPanel.classList.contains("hide");
        if (turningOn && hopperRearrangement?.active){
          hopperRearrangement = null;
          splitsSavedRecipesOpen = true;
          splitsBulkModeActive = false;
          renderSplitsArea();
          validateAndCompute();
          saveSession();
          notifyActiveJobMutation({immediate:true,kind:"rearrange-hoppers"});
          return;
        }
        if (turningOn) setBulkMode(false);
        setSavedRecipesOpen(turningOn);
      });

      const summary = document.createElement("div");
      summary.className = "splitsMatrixSummary";
      summary.setAttribute("role", "status");
      summary.setAttribute("aria-live", "polite");
      const recipeInfo = document.createElement("details");
      recipeInfo.className = "splitsInfo";
      recipeInfo.innerHTML = `
        <summary aria-label="Recipe Setup information" title="Recipe Setup information">ⓘ</summary>
        <div class="splitsInfoPanel">
          <p>Resin names are optional. If B and D, or A and E layers are the same, you can copy from one to the other.</p>
          <p><strong>Colored clock</strong> = tracked in the Timeline.</p>
        </div>
      `;
      const actionInfo = document.createElement("div");
      actionInfo.className = "splitsMatrixActionInfo";
      actionInfo.append(summary);
      // Lives at the right end of the button row, not next to the summary
      // text - modeBar is display:flex, so appending it last here puts it
      // after Print Recipe regardless of which of the three buttons are
      // present/disabled.
      modeBar.appendChild(recipeInfo);
      const actionRow = document.createElement("div");
      actionRow.className = "splitsMatrixActions";
      actionRow.append(actionInfo, modeBar);
      area.append(actionRow, toolbar, savedRecipesPanel);

      if(hopperRearrangement?.active){
        const bar=document.createElement("div");
        bar.className="rearrangeModeBar";
        bar.innerHTML='<div class="rearrangeModeMessage"><strong>Rearrange mode</strong><span>Drag, or tap a hopper then tap another, to move assignments. Hopper 1 is recalculated after each move.</span></div>';
        const actions=document.createElement("div");
        actions.className="rearrangeModeActions";
        const undo=document.createElement("button");
        undo.type="button"; undo.className="secondary"; undo.textContent="Undo Last Move"; undo.disabled=!hopperRearrangement.undo.length;
        const cancel=document.createElement("button");
        cancel.type="button"; cancel.className="secondary"; cancel.textContent="Cancel";
        undo.addEventListener("click",()=>{const shot=hopperRearrangement.undo.pop();if(shot)window.PolynHopperRearrangement.apply(state.layers,shot);hopperRearrangement.tapSource=null;renderSplitsArea();validateAndCompute();});
        cancel.addEventListener("click",()=>{window.PolynHopperRearrangement.apply(state.layers,hopperRearrangement.baseline);hopperRearrangement=null;renderSplitsArea();validateAndCompute();});
        actions.append(undo,cancel);
        bar.append(actions);
        area.append(bar);
      }

      // A vertical rail of per-layer buttons, sitting to the right of the
      // table (see .splitsMobileLayerLayout below) rather than a pager row
      // above it - direct tap to any layer, no prev/next stepping needed.
      const mobileLayerNav = document.createElement("div");
      mobileLayerNav.className = "splitsMobileLayerRail";
      mobileLayerNav.setAttribute("role", "group");
      mobileLayerNav.setAttribute("aria-label", "Choose layer");
      const layerNames = state.layers.map(L=>L.name);
      let activeMobileLayer = layerNames.includes(lastActiveMobileLayer) ? lastActiveMobileLayer : (layerNames[0] || "");

      const mobileLayerButtonEls = new Map();
      state.layers.forEach(L=>{
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "splitsMobileLayerRailBtn";
        btn.textContent = L.name;
        btn.setAttribute("aria-pressed", "false");
        btn.addEventListener("click", ()=> showMobileLayer(L.name));
        mobileLayerButtonEls.set(L.name, btn);
        mobileLayerNav.appendChild(btn);
      });

      const scroll = document.createElement("div");
      scroll.className = "splitsMatrixScroll";
      const frame = document.createElement("div");
      frame.className = "splitsMatrixFrame";
      const table = document.createElement("table");
      table.className = "splitsMatrix";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      const corner = document.createElement("th");
      corner.scope = "col";
      corner.className = "splitRowCorner";
      corner.textContent = "Select row";
      headerRow.appendChild(corner);

      state.layers.forEach(L=>{
        const th = document.createElement("th");
        th.scope = "col";
        th.className = "splitLayerHeader";
        th.dataset.layerColumn = L.name;

        const title = document.createElement("button");
        title.type = "button";
        title.className = "splitLayerTitle";
        title.textContent = L.name;
        title.title = `Select or clear all Layer ${L.name} hoppers`;
        title.setAttribute("aria-pressed", "false");
        title.addEventListener("click",()=>{
          if (!bulkMode) return;
          toggleSelection(Array.from({length:HOPPERS_PER_LAYER}, (_,hi)=>`${L.name}:${hi}`));
        });
        columnSelectors.set(L.name, title);

        const pctWrap = document.createElement("label");
        pctWrap.className = "splitLayerPct";
        const pctInput = document.createElement("input");
        pctInput.id = `lp_${L.name}`;
        pctInput.type = "text";
        pctInput.inputMode = "decimal";
        pctInput.placeholder = "0";
        pctInput.value = String(clampNum(L.layerPct));
        pctInput.setAttribute("aria-label", `Layer ${L.name} percentage`);
        if(hopperRearrangement?.active) pctInput.disabled=true;
        const pctUnit = document.createElement("span");
        pctUnit.textContent = "%";
        pctWrap.append(pctInput, pctUnit);

        const headerMain = document.createElement("div");
        headerMain.className = "splitLayerMain";
        headerMain.append(title, pctWrap);

        th.append(headerMain);

        const copyFrom = copyRules[L.name];
        th.classList.toggle("noCopy", !copyFrom);
        if (copyFrom){
          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.className = "copyBtn splitCopyBtn";
          copyButton.textContent = `Copy ${copyFrom} → ${L.name}`;
          copyButton.addEventListener("click",()=>{
            copyLayer(copyFrom, L.name);
            renderSplitsArea();
            validateAndCompute({ sync: true });
            saveSession();
          });
          th.appendChild(copyButton);
        }

        const hopperTotal = document.createElement("div");
        hopperTotal.id = `hopperTotal_${L.name}`;
        hopperTotal.className = "splitColumnTotal";
        th.appendChild(hopperTotal);

        pctInput.addEventListener("input",(e)=>{
          const accepted = acceptNumericInput(
            e.target,
            { min: 0, max: 100, label: `Layer ${L.name} percentage` },
            value => { L.layerPct = value; }
          );
          if (!accepted) return;
          updateSplitTotals();
          updateLayerMetaDisplays();
          validateAndCompute({ sync: true });
          saveSession();
        });

        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (let hi=0; hi<HOPPERS_PER_LAYER; hi++){
        const tr = document.createElement("tr");
        const rowHeader = document.createElement("th");
        rowHeader.scope = "row";
        rowHeader.className = "splitRowHeader mono";
        const rowSelect = document.createElement("button");
        rowSelect.type = "button";
        rowSelect.className = "splitRowSelect mono";
        rowSelect.textContent = hopperPositionLabel(hi);
        rowSelect.title = `Select or clear hopper ${hopperPositionLabel(hi)} across all layers`;
        rowSelect.setAttribute("aria-label", `Select hopper ${hopperPositionLabel(hi)} across all layers`);
        rowSelect.setAttribute("aria-pressed", "false");
        rowSelect.addEventListener("click",()=>{
          if (!bulkMode) return;
          toggleSelection(state.layers.map(L=>`${L.name}:${hi}`));
        });
        rowSelectors.set(hi, rowSelect);
        rowHeader.appendChild(rowSelect);
        tr.appendChild(rowHeader);

        state.layers.forEach(L=>{
          const hopper = L.hoppers[hi];
          const key = `${L.name}:${hi}`;
          const td = document.createElement("td");
          td.className = "splitMatrixCell";
          td.dataset.layerColumn = L.name;
          if(hopperRearrangement?.active){td.draggable=true;td.classList.add("rearrangeTarget");td.setAttribute("aria-label",`Rearrange ${hopperBadgeLabel(L.name,hi)}`);td.addEventListener("dragstart",event=>{if(!normName(hopper.resinName)&&!clampNum(hopper.pct)){event.preventDefault();return;}hopperRearrangement.tapSource=null;clearTapSourceHighlight();hopperRearrangement.drag={layer:L.name,index:hi};td.classList.add("rearrangeSource");event.dataTransfer.effectAllowed="move";});td.addEventListener("dragend",()=>{hopperRearrangement.drag=null;td.classList.remove("rearrangeSource");});td.addEventListener("dragover",event=>{if(hopperRearrangement.drag){event.preventDefault();td.classList.add("rearrangeOver");}});td.addEventListener("dragleave",()=>td.classList.remove("rearrangeOver"));td.addEventListener("drop",event=>{event.preventDefault();td.classList.remove("rearrangeOver");const result=window.PolynHopperRearrangement.move(state.layers,hopperRearrangement.drag,{layer:L.name,index:hi});if(result.ok){hopperRearrangement.undo.push(result.before);renderSplitsArea();validateAndCompute();}else summary.textContent=result.reason==="invalid"?"Move rejected: hopper percentages would be invalid.":"No rearrangement made.";});td.addEventListener("click",()=>{const current=hopperRearrangement.tapSource;if(current&&current.layer===L.name&&current.index===hi){hopperRearrangement.tapSource=null;td.classList.remove("rearrangeSource");return;}if(!current){if(!normName(hopper.resinName)&&!clampNum(hopper.pct))return;hopperRearrangement.tapSource={layer:L.name,index:hi};td.classList.add("rearrangeSource");return;}const result=window.PolynHopperRearrangement.move(state.layers,current,{layer:L.name,index:hi});hopperRearrangement.tapSource=null;if(result.ok){hopperRearrangement.undo.push(result.before);renderSplitsArea();validateAndCompute();}else{clearTapSourceHighlight();summary.textContent=result.reason==="invalid"?"Move rejected: hopper percentages would be invalid.":"No rearrangement made.";}});}

          const cellHeader = document.createElement("div");
          cellHeader.className = "splitCellHeader";
          const hopperName = document.createElement("span");
          hopperName.className = "splitCellHopperName mono";
          hopperName.textContent = hopperBadgeLabel(L.name, hi);
          cellHeader.append(hopperName);

          const editor = document.createElement("div");
          editor.className = "splitCellEditor";

          const cellTop = document.createElement("div");
          cellTop.className = "splitCellTop";
          const selector = document.createElement("input");
          selector.type = "checkbox";
          selector.className = "splitCellSelector";
          selector.setAttribute("aria-label", `Select ${hopperBadgeLabel(L.name, hi)} for bulk edit`);

          const resinInput = document.createElement("input");
          resinInput.id = `r_${L.name}_${hi}`;
          resinInput.className = "resinNameInput";
          resinInput.type = "text";
          resinInput.value = hopper.resinName || "";
          resinInput.setAttribute("aria-label", `${hopperBadgeLabel(L.name, hi)} resin name`);
          attachResinAutocomplete(resinInput);
          cellTop.append(selector, resinInput);

          const controls = document.createElement("div");
          controls.className = "splitCellControls";
          const pctWrap = document.createElement("label");
          pctWrap.className = "splitPctControl";
          const pctInput = document.createElement("input");
          pctInput.id = `p_${L.name}_${hi}`;
          pctInput.className = "splitInput";
          pctInput.type = "text";
          pctInput.inputMode = "decimal";
          pctInput.placeholder = "—";
          pctInput.value = clampNum(hopper.pct) === 0 && !normName(hopper.resinName)
            ? ""
            : String(clampNum(hopper.pct));
          pctInput.setAttribute("aria-label", `${hopperBadgeLabel(L.name, hi)} percentage`);
          const pctUnit = document.createElement("span");
          pctUnit.textContent = "%";
          pctWrap.append(pctInput, pctUnit);

          if (hi === 0){
            pctInput.readOnly = true;
            pctInput.title = "Auto (100% minus other hoppers)";
          }

          const trackControl = document.createElement("div");
          trackControl.className = "splitTrackControl";
          const trackButton = document.createElement("button");
          trackButton.id = `t_${L.name}_${hi}`;
          trackButton.type = "button";
          trackButton.className = "splitTrackButton";
          trackButton.setAttribute("aria-label", `Track ${hopperBadgeLabel(L.name, hi)} in timeline`);

          const clockIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          clockIcon.setAttribute("viewBox", "0 0 24 24");
          clockIcon.setAttribute("aria-hidden", "true");
          const clockFace = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          clockFace.setAttribute("cx", "12");
          clockFace.setAttribute("cy", "12");
          clockFace.setAttribute("r", "8.5");
          const clockHands = document.createElementNS("http://www.w3.org/2000/svg", "path");
          clockHands.setAttribute("d", "M12 7.5v5l3.5 2");
          clockIcon.append(clockFace, clockHands);
          trackButton.appendChild(clockIcon);
          trackControl.appendChild(trackButton);

          // Smart Hoppers indicator: shows when this hopper's weight is
          // currently being computed from geometry + its resin's known
          // density (see refreshSmartHopperState) rather than only
          // discoverable back in Receiver Hopper Weights. Always present in
          // the DOM (unlike the wrench, which only exists when Smart
          // Hoppers is on) - simplest to just keep it hidden by default and
          // let the same central refresh function control visibility.
          const smartBadge = document.createElement("span");
          smartBadge.id = smartBadgeId(L.name, hi);
          smartBadge.className = "splitSmartBadge";
          smartBadge.textContent = "SMART";
          smartBadge.hidden = true;
          smartBadge.title = `${hopperBadgeLabel(L.name, hi)}'s weight is computed from Smart Hopper geometry and its resin's density`;

          const clearButton = document.createElement("button");
          clearButton.type = "button";
          clearButton.className = "splitClearButton";
          clearButton.textContent = "×";
          clearButton.setAttribute("aria-label", `Clear ${hopperBadgeLabel(L.name, hi)}`);
          clearButton.title = `Clear ${hopperBadgeLabel(L.name, hi)}`;
          if(hopperRearrangement?.active){selector.disabled=true;resinInput.disabled=true;pctInput.disabled=true;trackButton.disabled=true;clearButton.disabled=true;}

          cellHeader.append(trackControl, smartBadge, clearButton);
          controls.appendChild(pctWrap);
          editor.append(cellTop, controls);
          td.append(cellHeader, editor);
          tr.appendChild(td);

          function refreshCellState(){
            const hasResin = !!normName(hopper.resinName);
            const hasPercentage = clampNum(hopper.pct) > 0;
            const complete = hasResin && hasPercentage;
            const empty = !hasResin && !hasPercentage && !hopper.track;
            const clearable = hasResin || (hi > 0 && hasPercentage) || !!hopper.track;
            td.classList.toggle("has-resin", hasResin);
            td.classList.toggle("has-percentage", hasPercentage);
            td.classList.toggle("tracked", !!hopper.track);
            td.classList.toggle("complete", complete);
            td.classList.toggle("empty", empty);
            clearButton.hidden = !clearable;
            trackButton.classList.toggle("active", !!hopper.track);
            trackButton.setAttribute("aria-pressed", String(!!hopper.track));
            trackButton.title = hopper.track
              ? `Remove ${hopperBadgeLabel(L.name, hi)} from timeline`
              : `Track ${hopperBadgeLabel(L.name, hi)} in timeline`;
          }

          cellRefs.set(key, {
            td,
            selector,
            resinInput,
            pctInput,
            layer: L,
            hopper,
            hi,
            refreshCellState
          });

          selector.addEventListener("change",()=>{
            selector.checked ? selected.add(key) : selected.delete(key);
            updateSelectionUI();
          });

          resinInput.addEventListener("input",(e)=>{
            hopper.resinName = normName(e.target.value);
            refreshCellState();
            validateAndCompute({ sync: true });
            saveSession();
          });

          pctInput.addEventListener("input",(e)=>{
            if (hi === 0) return;
            const candidate = validation.validatePercentage(
              e.target.value,
              `${hopperBadgeLabel(L.name, hi)} percentage`
            );
            if (!candidate.valid){
              e.target.setCustomValidity(candidate.message);
              e.target.setAttribute("aria-invalid", "true");
              e.target.title = candidate.message;
              return;
            }

            const otherPercentages = L.hoppers.slice(1).map((item,index)=>
              index === hi - 1 ? candidate.value : item.pct
            );
            const totalResult = validation.validateHopperPercentages(otherPercentages);
            e.target.setCustomValidity(totalResult.valid ? "" : totalResult.message);
            e.target.setAttribute("aria-invalid", String(!totalResult.valid));
            e.target.title = totalResult.valid ? "" : totalResult.message;
            if (!totalResult.valid) return;

            hopper.pct = candidate.value;
            recomputeAutoH1(L);
            refreshCellState();
            cellRefs.get(`${L.name}:0`)?.refreshCellState();
            const h1Input = table.querySelector(`#p_${L.name}_0`);
            if (h1Input) h1Input.value = String(clampNum(L.hoppers[0].pct));
            updateSplitTotals();
            validateAndCompute({ sync: true });
            saveSession();
          });

          trackButton.addEventListener("click",()=>{
            hopper.track = !hopper.track;
            refreshCellState();
            validateAndCompute({ sync: true, immediate: true, kind: "tracking" });
            saveSession();
          });
          clearButton.addEventListener("click",()=>{
            hopper.resinName = "";
            if (hi > 0) hopper.pct = 0;
            hopper.track = false;
            resinInput.value = "";
            if (hi > 0){
              pctInput.value = "";
              recomputeAutoH1(L);
              const h1Ref = cellRefs.get(`${L.name}:0`);
              if (h1Ref){
                h1Ref.pctInput.value = String(clampNum(L.hoppers[0].pct));
                h1Ref.refreshCellState();
              }
            }else{
              pctInput.value = String(clampNum(hopper.pct));
            }
            refreshCellState();
            updateSplitTotals();
            validateAndCompute({ sync: true, immediate: true, kind: "recipe-clear" });
            saveSession();
          });
          refreshCellState();
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      frame.appendChild(table);
      scroll.appendChild(frame);
      const mobileLayerLayout = document.createElement("div");
      mobileLayerLayout.className = "splitsMobileLayerLayout";
      mobileLayerLayout.append(scroll, mobileLayerNav);
      area.appendChild(mobileLayerLayout);

      function showMobileLayer(layerName){
        activeMobileLayer = layerName;
        lastActiveMobileLayer = layerName;
        table.querySelectorAll("[data-layer-column]").forEach(cell=>{
          cell.classList.toggle("mobile-layer-active", cell.dataset.layerColumn === activeMobileLayer);
        });
        mobileLayerButtonEls.forEach((btn,name)=>{
          const active = name === activeMobileLayer;
          btn.classList.toggle("active", active);
          btn.setAttribute("aria-pressed", String(active));
        });
      }
      showMobileLayer(activeMobileLayer);

      // Swipe left/right between layers - same showMobileLayer the tab bar
      // already uses, just a second way to reach it. Evaluated once on
      // touchend (total displacement) rather than tracked live on
      // touchmove, so this stays a passive listener and never fights the
      // page's normal vertical scroll. Bounded at the ends (no wrap), and
      // ignored when the gesture starts inside a field so selecting/
      // dragging text in a hopper input isn't mistaken for a swipe.
      let touchStartX = null;
      let touchStartY = null;
      scroll.addEventListener("touchstart", event=>{
        const touch = event.touches[0];
        if (!touch || event.target.closest("input, select, textarea")){ touchStartX = null; return; }
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      }, { passive: true });
      scroll.addEventListener("touchend", event=>{
        if (touchStartX === null) return;
        const touch = event.changedTouches[0];
        const dx = touch ? touch.clientX - touchStartX : 0;
        const dy = touch ? touch.clientY - touchStartY : 0;
        touchStartX = null;
        if (!touch || Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
        const names = state.layers.map(L=>L.name);
        const index = names.indexOf(activeMobileLayer);
        if (index === -1) return;
        const nextIndex = dx < 0 ? index + 1 : index - 1;
        if (nextIndex < 0 || nextIndex >= names.length) return;
        showMobileLayer(names[nextIndex]);
      }, { passive: true });

      const bulkNameInput = toolbar.querySelector("#bulkResinName");
      const bulkPctInput = toolbar.querySelector("#bulkResinPct");
      const applyButton = toolbar.querySelector("#applyBulkSplit");
      const selectionStatus = toolbar.querySelector("#splitSelectionStatus");
      attachResinAutocomplete(bulkNameInput);

      function hasBulkValue(){
        return bulkNameInput.value.trim() !== "" || bulkPctInput.value.trim() !== "";
      }

      function updateSelectionUI(message, type=""){
        cellRefs.forEach((ref,key)=>{
          const isSelected = selected.has(key);
          ref.selector.checked = isSelected;
          ref.td.classList.toggle("selected", isSelected);
        });
        columnSelectors.forEach((button, layerName)=>{
          const keys = Array.from({length:HOPPERS_PER_LAYER}, (_,hi)=>`${layerName}:${hi}`);
          const count = keys.filter(key=>selected.has(key)).length;
          button.classList.toggle("selected", count === keys.length);
          button.classList.toggle("partiallySelected", count > 0 && count < keys.length);
          button.setAttribute("aria-pressed", count === keys.length ? "true" : (count ? "mixed" : "false"));
        });
        rowSelectors.forEach((button, hi)=>{
          const keys = state.layers.map(L=>`${L.name}:${hi}`);
          const count = keys.filter(key=>selected.has(key)).length;
          button.classList.toggle("selected", count === keys.length);
          button.classList.toggle("partiallySelected", count > 0 && count < keys.length);
          button.setAttribute("aria-pressed", count === keys.length ? "true" : (count ? "mixed" : "false"));
        });
        applyButton.disabled = selected.size === 0 || !hasBulkValue();
        applyButton.textContent = selected.size
          ? `Apply to ${selected.size} hopper${selected.size === 1 ? "" : "s"}`
          : "Apply to selected";
        selectionStatus.className = `tiny splitsSelectionStatus${type ? ` ${type}` : ""}`;
        selectionStatus.textContent = message || (
          selected.size === 0
            ? "No hoppers selected"
            : `${selected.size} hopper${selected.size === 1 ? "" : "s"} selected`
        );
      }

      function setBulkMode(enabled){
        bulkMode = !!enabled;
        splitsBulkModeActive = bulkMode;
        area.classList.toggle("bulk-editing", bulkMode);
        toolbar.classList.toggle("hide", !bulkMode);
        modeButton.textContent = bulkMode ? "Done bulk editing" : "Bulk edit";
        modeButton.setAttribute("aria-expanded", String(bulkMode));
        table.querySelectorAll(".splitLayerTitle, .splitRowSelect").forEach(button=>{
          button.tabIndex = bulkMode ? 0 : -1;
          button.setAttribute("aria-disabled", String(!bulkMode));
        });
        cellRefs.forEach(ref=>{
          // Called once unconditionally at the end of every render (see
          // below) to (re)wire newly-created cells to the resolved bulkMode
          // for this render - reading hopperRearrangement fresh here (not
          // just trusting bulkMode) still matters even though the two are
          // mutually exclusive by construction, so a rearrange-disabled
          // input is never accidentally re-enabled.
          const rearranging = !!hopperRearrangement?.active;
          ref.resinInput.disabled = bulkMode || rearranging;
          ref.pctInput.disabled = bulkMode || rearranging;
          const trackButton = ref.td.querySelector(".splitTrackButton");
          if (trackButton) trackButton.disabled = bulkMode || rearranging;
        });
        if (!bulkMode) selected.clear();
        updateSelectionUI();
      }

      modeButton.addEventListener("click",()=>{
        const turningOn = !bulkMode;
        if (turningOn && hopperRearrangement?.active){
          hopperRearrangement = null;
          splitsBulkModeActive = true;
          splitsSavedRecipesOpen = false;
          renderSplitsArea();
          validateAndCompute();
          saveSession();
          notifyActiveJobMutation({immediate:true,kind:"rearrange-hoppers"});
          return;
        }
        if (turningOn) setSavedRecipesOpen(false);
        setBulkMode(turningOn);
      });

      [bulkNameInput, bulkPctInput].forEach(input=>{
        input.addEventListener("input",()=>{
          input.setCustomValidity("");
          input.setAttribute("aria-invalid", "false");
          input.title = "";
          updateSelectionUI();
        });
      });

      toolbar.querySelector("#selectAllSplits").addEventListener("click",()=>{
        cellRefs.forEach((_,key)=>selected.add(key));
        updateSelectionUI();
      });
      toolbar.querySelector("#clearSplitSelection").addEventListener("click",()=>{
        selected.clear();
        updateSelectionUI();
      });
      toolbar.querySelector("#resetAllSplits").addEventListener("click",()=>{
        const ok = confirm("Reset every hopper resin, percentage, and Track setting?");
        if (!ok) return;

        state.layers.forEach(L=>{
          L.hoppers.forEach(hopper=>{
            hopper.resinName = "";
            hopper.pct = 0;
            hopper.track = false;
            hopper.pumpOff = false;
          });
        });
        selected.clear();
        bulkNameInput.value = "";
        bulkPctInput.value = "";
        renderSplitsArea();
        validateAndCompute({ sync: true });
        saveSession();
      });

      applyButton.addEventListener("click",()=>{
        const applyName = bulkNameInput.value.trim() !== "";
        const applyPct = bulkPctInput.value.trim() !== "";
        const resinName = normName(bulkNameInput.value);
        let percentage = null;

        if (applyPct){
          const result = validation.validatePercentage(bulkPctInput.value, "Bulk percentage");
          bulkPctInput.setCustomValidity(result.valid ? "" : result.message);
          bulkPctInput.setAttribute("aria-invalid", String(!result.valid));
          bulkPctInput.title = result.valid ? "" : result.message;
          if (!result.valid) return;
          percentage = result.value;
        }

        if (applyPct){
          for (const L of state.layers){
            const projected = L.hoppers.slice(1).map((hopper,index)=>{
              const key = `${L.name}:${index + 1}`;
              return selected.has(key) ? percentage : hopper.pct;
            });
            const result = validation.validateHopperPercentages(projected);
            if (!result.valid){
              updateSelectionUI(`Cannot apply: Layer ${L.name} hoppers 2–6 would total ${fmtNum(result.total,2)}%.`, "warn");
              return;
            }
          }
        }

        let percentageCount = 0;
        selected.forEach(key=>{
          const ref = cellRefs.get(key);
          if (!ref) return;
          if (applyName){
            ref.hopper.resinName = resinName;
            ref.resinInput.value = resinName;
          }
          if (applyPct && ref.hi > 0){
            ref.hopper.pct = percentage;
            ref.pctInput.value = String(percentage);
            percentageCount++;
          }
          ref.refreshCellState();
        });

        if (applyPct){
          state.layers.forEach(L=>{
            recomputeAutoH1(L);
            const h1Input = table.querySelector(`#p_${L.name}_0`);
            if (h1Input) h1Input.value = String(clampNum(L.hoppers[0].pct));
          });
        }

        cellRefs.forEach(ref=>ref.refreshCellState());

        updateSplitTotals();
        validateAndCompute({ sync: true });
        saveSession();

        const changes = [];
        if (applyName) changes.push(`resin “${resinName}”`);
        if (applyPct) changes.push(`${fmtTrim(percentage,3)}% to ${percentageCount} editable hopper${percentageCount === 1 ? "" : "s"}`);
        updateSelectionUI(`Applied ${changes.join(" and ")}.`, "ok");
      });

      function updateSplitTotals(){
        const layerTotal = sum(state.layers.map(L=>clampNum(L.layerPct)));
        const layerOkay = Math.abs(layerTotal - 100) <= 0.0001;
        summary.className = `splitsMatrixSummary ${layerOkay ? "ok" : "warn"}`;
        summary.textContent = `Layer total: ${fmtNum(layerTotal,2)}% ${layerOkay ? "✓" : "— expected 100%"}`;
        summary.hidden = layerOkay;

        state.layers.forEach(L=>{
          const hopperTotal = sum(L.hoppers.map(h=>clampNum(h.pct)));
          const okay = Math.abs(hopperTotal - 100) <= 0.0001;
          const el = table.querySelector(`#hopperTotal_${L.name}`);
          if (!el) return;
          el.hidden = okay;
          el.className = `splitColumnTotal ${okay ? "ok" : "warn"}`;
          el.textContent = okay ? "" : `Hoppers total: ${fmtNum(hopperTotal,2)}% — expected 100%`;
        });
      }

      updateSplitTotals();
      // Reapply (not force-close) the resolved state to this render's
      // freshly-created elements - both default to closed, but a render
      // triggered by switching panels (see the click handlers above) seeds
      // one of them open via splitsBulkModeActive/splitsSavedRecipesOpen.
      setBulkMode(bulkMode);
      setSavedRecipesOpen(splitsSavedRecipesOpen);
      renderSplitsSavedRecipes(lineSync?.getState?.());
    }

    function renderResinCalculator(){
      const prod = clampNum(state.prodResinLb);
      const scrap = clampNum(state.scrapResinLb);
      const total = prod + scrap;

      // Keep the inputs themselves in sync with state (session restore, a
      // shared job apply, Reset all) - never touch whichever one the
      // operator currently has focused, so this doesn't fight live typing.
      const prodInput = $("prodResinLb");
      if (prodInput && document.activeElement !== prodInput) prodInput.value = prod ? String(prod) : "";
      const scrapInput = $("scrapResinLb");
      if (scrapInput && document.activeElement !== scrapInput) scrapInput.value = scrap ? String(scrap) : "";

      const div = 100;
      const totals = new Map();

      state.layers.forEach((L)=>{
        const layerFrac = clampNum(L.layerPct) / div;
        L.hoppers.forEach((h)=>{
          const name = normName(h.resinName);
          if (!name) return;
          const hopperFrac = clampNum(h.pct) / div;
          if (hopperFrac <= 0) return;
          const lbs = total * layerFrac * hopperFrac;
          if (!Number.isFinite(lbs) || lbs <= 0) return;

          const k = keyName(name);
          if (!totals.has(k)) totals.set(k, { displayName: name, lbs: 0 });
          totals.get(k).lbs += lbs;
        });
      });

      const sumEl = $("resinCalcSummary");
      if (sumEl){
        sumEl.innerHTML = `
          <div class="status ok">
            <div class="statusTitle">Resin totals</div>
            <div class="muted">
              Production: <span class="mono">${fmtLb(prod)}</span> lb • Scrap: <span class="mono">${fmtLb(scrap)}</span> lb •
              Total: <span class="mono">${fmtLb(total)}</span> lb
            </div>
          </div>
        `;
      }

      const out = $("resinCalcResults");
      if (!out) return;
      out.innerHTML = "";
      if (total <= 0){
        out.innerHTML = `<div class="muted"></div>`;
        return;
      }
      if (totals.size === 0){
        out.innerHTML = `<div class="muted">Add resin names + splits to see totals here.</div>`;
        return;
      }
      const rows = Array.from(totals.values()).sort((a,b)=>b.lbs - a.lbs);
      rows.forEach(r=>{
        const row = document.createElement("div");
        row.className = "calcRow";
        row.innerHTML = `
          <div class="calcLeft">
            <div class="calcName mono" data-resin-name></div>
            <div class="calcMeta">Allocated from splits</div>
          </div>
          <div class="mono calcValue">${fmtLb(r.lbs)} lb</div>
        `;
        row.querySelector("[data-resin-name]").textContent = r.displayName;
        out.appendChild(row);
      });
    }

    function updateLayerMetaDisplays(){
      state.layers.forEach(L=>{
        const pct = clampNum(L.layerPct);

        const pctEl = document.getElementById(`layerPctText_${L.name}`);
        if (pctEl) pctEl.textContent = `${fmtNum(pct,2)}%`;
      });
    }

  
  /* ============================
   * Validation + compute + render
   * ============================ */
  function updateCollapsedSummaries(){
    const hopperWeightValues = state.layers.flatMap(layer=>layer.hoppers.map(hopper=>clampNum(hopper.weight)));
    const configuredWeightCount = hopperWeightValues.filter(weight=>weight > 0).length;
    const hopperWeightsUnset = hopperWeightValues.length > 0 && configuredWeightCount === 0;
    const hopperWeightsComplete = hopperWeightValues.length > 0 && configuredWeightCount === hopperWeightValues.length;
    const setupParts = [];
    if (state.lineRate > 0){
      setupParts.push(`${state.lineRate.toLocaleString([], { maximumFractionDigits: 2 })} lb/hr`);
    }
    const changeoverDate = parseChangeoverDate(state.changeoverTime);
    if (changeoverDate) setupParts.push(`Changeover ${fmtTime(changeoverDate)}`);
    const setupStatus = $("setupSummaryStatus");
    if (setupStatus) setupStatus.textContent = setupParts.length ? setupParts.join(" · ") : "Not set";
    const outputStatus = $("workspaceOutputStatus");
    if (outputStatus){
      outputStatus.textContent = state.lineRate > 0
        ? `${state.lineRate.toLocaleString([], { maximumFractionDigits: 2 })} lb/hr`
        : "Not set";
    }
    const changeoverStatus = $("workspaceChangeoverStatus");
    if (changeoverStatus){
      changeoverStatus.textContent = changeoverDate ? fmtTime(changeoverDate) : "Not set";
    }
    updateChangeoverCountdown();
    const workspaceStatus = $("workspaceSetupStatus");
    if (workspaceStatus){
      const hasOutput = state.lineRate > 0;
      const hasChangeover = !!changeoverDate;
      workspaceStatus.textContent = !hopperWeightsComplete
        ? "Needs hopper weights"
        : (hasOutput && hasChangeover
          ? "Ready"
          : (hasOutput || hasChangeover ? "In progress" : "Needs setup"));
      workspaceStatus.closest(".workspaceNavButton")?.setAttribute(
        "data-status",
        !hopperWeightsComplete
          ? "warn"
          : (hasOutput && hasChangeover ? "ok" : (hasOutput || hasChangeover ? "info" : "neutral"))
      );
    }

    const splitsStatus = $("splitsSummaryStatus");
    if (splitsStatus){
      const layerTotal = sum(state.layers.map(L=>clampNum(L.layerPct)));
      const badLayers = state.layers.filter(L=>{
        const hopperTotal = sum(L.hoppers.map(h=>clampNum(h.pct)));
        return Math.abs(hopperTotal - 100) > 0.0001;
      });
      const layerTotalBad = Math.abs(layerTotal - 100) > 0.0001;
      const errorCount = badLayers.length + (layerTotalBad ? 1 : 0);
      const ready = errorCount === 0 && state.layers.length > 0;
      splitsStatus.classList.toggle("badge-ok", ready);
      splitsStatus.classList.toggle("badge-warn", !ready);
      splitsStatus.textContent = ready
        ? "Ready ✓"
        : `${errorCount} percentage ${errorCount === 1 ? "error" : "errors"}`;
      const workspaceStatus = $("workspaceSplitsStatus");
      if (workspaceStatus){
        workspaceStatus.textContent = ready ? "Ready" : splitsStatus.textContent;
        workspaceStatus.hidden = false;
        workspaceStatus.closest(".workspaceNavButton")?.setAttribute("data-status", ready ? "ok" : "warn");
      }
    }

    const timelineStatus = $("timelineSummaryStatus");
      if (timelineStatus){
        const trackedCount = sum(state.layers.map(L=>L.hoppers.filter(h=>h.track).length));
        timelineStatus.textContent = `${trackedCount} ${trackedCount === 1 ? "resin" : "resins"} tracked`;
        const trackedStatus = $("workspaceTrackedStatus");
        if (trackedStatus) trackedStatus.textContent = String(trackedCount);
        const workspaceStatus = $("workspaceTimelineStatus");
      if (workspaceStatus){
        workspaceStatus.textContent = trackedCount
          ? `${trackedCount} tracked`
          : "No hoppers tracked";
        workspaceStatus.closest(".workspaceNavButton")?.setAttribute(
          "data-status",
          trackedCount ? "info" : "neutral"
        );
      }
    }
  }

  function validateAndCompute({ sync = false, immediate = false, kind = "edit" } = {}){
      const msgs = [];
      const div = 100;

      if (state.lineRate <= 0) msgs.push({type:"warn", text:"Line rate is 0 — rates/times will be 0."});

      const layerFracs = state.layers.map(L => clampNum(L.layerPct)/div);
      const layerSum = sum(layerFracs);
      if (state.layers.length && Math.abs(layerSum - 1) > 0.0001){
        msgs.push({type:"warn", text:`Layer split sums to ${fmtNum(layerSum*100,2)}% (expected 100%).`});
      }

      const allWeightsUnset = state.layers.length > 0 && state.layers.every(L=>
        L.hoppers.every(h=>effectiveHopperWeight(h) === 0)
      );
      if (allWeightsUnset){
        msgs.push({
          type:"warn",
          text:"Receiver hopper weights have not been set. Enter them for accurate run-down timing."
        });
      }

      const tracked = [];
      state.layers.forEach(L=>L.hoppers.forEach((h,hi)=>{ if (h.track) tracked.push({L,h,hi}); }));
      if (tracked.length === 0){
        msgs.push({type:"warn", text:"No hoppers are tracked. Turn on Track for the hopper(s) you want in Results."});
      } else {
        const missingW = tracked.filter(x=>effectiveHopperWeight(x.h) <= 0).length;
        if (missingW > 0 && !allWeightsUnset){
          msgs.push({type:"warn", text:`${missingW} tracked hopper(s) are missing weight. Open “Hopper weights” to enter them.`});
        }
      }

      setStatus(statusMessage(msgs));

      const changeoverDate = parseChangeoverDate(state.changeoverTime);
      const flat = [];

      state.layers.forEach((L)=>{
        const layerRate = state.lineRate * (clampNum(L.layerPct)/div);
        const offsetMin = 0;

        L.hoppers.forEach((h, hi)=>{
          if (!h.track) return;

          const hopperRate = layerRate * (clampNum(h.pct)/div);
          const weight = effectiveHopperWeight(h);

          let minutesToEmpty = null;
          let totalMinutes = null;
          let startByDate = null;

          let timeText="—", startByText="—", totalRundownText="—", isLate=false;

          if (hopperRate > 0 && weight > 0){
            minutesToEmpty = (weight / hopperRate) * 60;
            totalMinutes = minutesToEmpty + offsetMin;

            timeText = hoursToHHMM(minutesToEmpty/60);
            totalRundownText = minutesToHHMM(totalMinutes);

            if (changeoverDate){
              startByDate = new Date(changeoverDate.getTime() - totalMinutes*60*1000);
              const startStatus = formatTimelineStart(startByDate, changeoverDate, new Date(), state.timeFormat);
              startByText = startStatus.text;
              isLate = startStatus.late;
            }
          } else if (hopperRate <= 0 && clampNum(h.pct) > 0){
            timeText = "Not feeding";
            startByText = "Not feeding";
          } else {
            timeText = "Missing data";
          }

          flat.push({
            layer: L.name,
            hopperLabel: hopperBadgeLabel(L.name, hi),
                    resinName: normName(h.resinName),
            weight,
            rate: hopperRate,
            timeText,
            startByText,
            isLate,
            totalRundownText,
            minutesToEmpty,
            totalMinutes,
            startByDate,
            offsetMin,
            pumpOff: !!h.pumpOff,
            _ref: { h }
          });
        });
      });

      renderResultsFlat(flat, changeoverDate);
      schedulePumpOffAlerts(flat, changeoverDate);
      updateFooterNext(flat, changeoverDate);
      renderResinCalculator();
      updateCollapsedSummaries();
      refreshSmartHopperState();
      saveSession();
      if (sync) notifyActiveJobMutation({ immediate, kind });
    }

    function renderResultsFlat(flat, changeoverDate){
      const area = $("resultsArea");
      if (!area) return;
      area.innerHTML = "";

      const viewFlat = state.showPumpOffTracked ? flat : flat.filter(x=>!x.pumpOff);

      if (viewFlat.length === 0){
        area.innerHTML = `<div class="muted">No visible tracked hoppers. (Pump-off hoppers are hidden.) Toggle “Show pump-off hoppers” to view them.</div>`;
        return;
      }

      viewFlat.sort((a,b)=>{
        if (changeoverDate){
          const ta = a.startByDate ? a.startByDate.getTime() : Infinity;
          const tb = b.startByDate ? b.startByDate.getTime() : Infinity;
          if (ta !== tb) return ta - tb;
        } else {
          const ta = (typeof a.minutesToEmpty === "number" && isFinite(a.minutesToEmpty)) ? a.minutesToEmpty : Infinity;
          const tb = (typeof b.minutesToEmpty === "number" && isFinite(b.minutesToEmpty)) ? b.minutesToEmpty : Infinity;
          if (ta !== tb) return ta - tb;
        }
        if (a.layer !== b.layer) return a.layer.localeCompare(b.layer);
        return a.hopperLabel.localeCompare(b.hopperLabel);
      });

      viewFlat.forEach((h)=>{
        const weightChip = h.weight > 0 ? `<span class="muted mono">${fmtNum(h.weight,2)} lb</span>` : `<span class="pill badge-warn">Missing weight</span>`;
        const splitWarn = (h.rate <= 0 && h.weight > 0) ? `<span class="pill badge-warn">Split?</span>` : "";

        const row = document.createElement("div");
        row.className = "resultRow" + (h.pumpOff ? " done" : "") + (h.isLate && !h.pumpOff ? " late" : "");
        row.innerHTML = `
          <div class="resultMain">
            <div class="resultIdentity">
              <span class="pill mono resultHopper">${h.hopperLabel}</span>
              <span data-resin-chip></span>
              ${weightChip}
              ${splitWarn}
            </div>

            <div class="meta">
              Rate: <span class="mono">${fmtNum(h.rate,2)}</span> lb/hr<br/>
              Time to empty: <span class="mono">${h.timeText}</span>
            </div>
          </div>

          <div class="resultTiming">
            <div class="muted resultTimingLabel">${changeoverDate ? "Start by" : "Soonest"}</div>
            <div class="mono resultTimingValue">${changeoverDate ? h.startByText : h.timeText}</div>

            <label class="checkWrap" title="Check when the hopper pump is turned off">
              <input type="checkbox" ${h.pumpOff ? "checked" : ""}>
              Pump off
            </label>
          </div>
        `;

        const resinChip = row.querySelector("[data-resin-chip]");
        resinChip.className = h.resinName ? "pill mono" : "pill badge-warn";
        resinChip.textContent = h.resinName || "No resin name";

        row.querySelector('input[type="checkbox"]').addEventListener("change",(e)=>{
          h._ref.h.pumpOff = !!e.target.checked;
          saveSession();
          validateAndCompute({ sync: true, immediate: true, kind: "pump-off" });
        });

        area.appendChild(row);
      });
    }
    function resetTracking(){
      const hasTracked = state.layers.some(L =>
      L.hoppers.some(h => h.track || h.pumpOff)
      );

      if (!hasTracked) return;

      const ok = confirm("Untrack all hoppers and clear their Pump off status?");
      if (!ok) return;

      state.layers.forEach(L => {
        L.hoppers.forEach(h => {
          h.track = false;
          h.pumpOff = false;
        });
      });

      rebuildUIFromState();
      saveSession();
      notifyActiveJobMutation({ immediate: true, kind: "reset-tracking" });
    }
    function resetAll(){
      const ok = confirm("Reset all fields?\\n\\nPress OK to reset.\\nPress Cancel to keep current values.");
      if (!ok) return;

      const clearSaved = confirm("Also clear saved session (autosave) data on this device?");
      if (clearSaved) clearSession();

      state.lineRate = 0;
      state.changeoverTime = "";
      state.changeoverSetAt = null;
      state.gauge = 0;
      state.hopperNamingLine9 = "standard";
      state.showPumpOffTracked = false;
      syncHopperNamingUI();
      syncToggleUI("showPumpOffToggle", false);
      state.prodResinLb = 0;
      state.scrapResinLb = 0;

      ensureLayers();
      state.layers.forEach(L=>{
        L.layerPct = 0;
        state.offsets[L.name] = 0;
        L.hoppers.forEach((h,i)=>{
          h.pct = (i === 0) ? 100 : 0;
          h.weight = 0;
          h.resinName = "";
          h.track = false;
          h.pumpOff = false;
        });
      });
      state.layers.forEach(recomputeAutoH1);

      const lr = $("lineRate"); if (lr) lr.value = "0";
      const co = $("changeoverTime"); if (co) co.value = "";
      // prodResinLb/scrapResinLb are synced from state by renderResinCalculator()
      // itself now (called via rebuildUIFromState below), same path session
      // restore and shared-job-apply already go through - no separate write needed.

      rebuildUIFromState();
      saveSession();
      notifyActiveJobMutation({ immediate: true, kind: "reset-all" });
    }



    // Focus: select all numeric fields, not resin names
    function selectAllSoon(el){
      if (!el) return;
      if (el.tagName === "SELECT") return;
      if (el.type === "checkbox" || el.type === "radio") return;
      if (el.readOnly || el.disabled) return;
      setTimeout(()=>{
        try{
          el.focus({preventScroll:true});
          if (typeof el.select === "function") el.select();
          if (typeof el.setSelectionRange === "function"){
            const v = el.value ?? "";
            el.setSelectionRange(0, String(v).length);
          }
        }catch(e){}
      }, 0);
    }
    document.addEventListener("focusin",(e)=>{
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA"){
        if (el.classList.contains("resinNameInput")) return;
        selectAllSoon(el);
      }
    });

    function applyMobileTimelineMode(enabled){
      state.mobileTimelineOnly = !!enabled;
      // The two "isolate this panel" modes are mutually exclusive - both
      // active at once would hide each other's panel and leave nothing shown.
      if (state.mobileTimelineOnly && state.mobileRecipeOnly){
        state.mobileRecipeOnly = false;
        document.body.setAttribute("data-mobile-recipe-only", "false");
        syncToggleUI("mobileRecipeToggle", false);
      }
      document.body.setAttribute("data-mobile-timeline-only", String(state.mobileTimelineOnly));
      if (state.mobileTimelineOnly && window.matchMedia("(max-width: 900px)").matches){
        const results = $("resultsBlock");
        if (results) results.open = true;
      }
      syncToggleUI("mobileTimelineToggle", state.mobileTimelineOnly);
    }

    function applyMobileRecipeMode(enabled){
      state.mobileRecipeOnly = !!enabled;
      if (state.mobileRecipeOnly && state.mobileTimelineOnly){
        state.mobileTimelineOnly = false;
        document.body.setAttribute("data-mobile-timeline-only", "false");
        syncToggleUI("mobileTimelineToggle", false);
      }
      document.body.setAttribute("data-mobile-recipe-only", String(state.mobileRecipeOnly));
      if (state.mobileRecipeOnly && window.matchMedia("(max-width: 900px)").matches){
        const splits = $("splitsBlock");
        if (splits) splits.open = true;
      }
      syncToggleUI("mobileRecipeToggle", state.mobileRecipeOnly);
    }

    let activeWorkspaceId = "resultsBlock";

    function saveWorkspacePreference(id){
      try{
        localStorage.setItem(LS_WORKSPACE_KEY, id);
      }catch(e){
        showStorageWarning("Workspace preference could not be saved on this device.");
      }
    }

    function loadWorkspacePreference(){
      try{
        const saved = localStorage.getItem(LS_WORKSPACE_KEY);
        return DETAILS_IDS.includes(saved) && document.getElementById(saved)?.classList.contains("workspacePanel")
          ? saved
          : "resultsBlock";
      }catch(e){
        return "resultsBlock";
      }
    }

    function setWorkspacePanel(id, { persist = true, reveal = false } = {}){
      const target = document.getElementById(id);
      if (!target?.classList.contains("workspacePanel")) return;
      activeWorkspaceId = id;
      document.querySelectorAll(".workspaceContent > .workspacePanel").forEach(panel=>{
        panel.classList.toggle("desktop-active", panel.id === id);
        panel.classList.toggle("mobile-active", panel.id === id);
      });
      document.querySelectorAll(".workspaceNavButton").forEach(button=>{
        const active = button.dataset.workspaceTarget === id;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      if (window.matchMedia("(min-width: 901px)").matches) target.open = true;
      if (window.matchMedia("(max-width: 900px)").matches){
        const preferences = $("statusPreferences");
        if (preferences) preferences.open = false;
        document.body.dataset.mobileWorkspace = "panel";
        if (id === "toolsBlock") document.body.dataset.mobileTools = "home";
        if (id === "helpBlock") document.body.dataset.mobileHelp = "home";
        target.querySelector(":scope > summary")?.setAttribute("aria-label", "Back to all sections");
        target.querySelector(":scope > summary")?.setAttribute("title", "Back to all sections");
        if (!target.open) target.open = true;
      }
      if (persist) saveWorkspacePreference(id);
      if (reveal && window.matchMedia("(max-width: 900px)").matches){
        requestAnimationFrame(()=>target.scrollIntoView({ behavior:"smooth", block:"start" }));
      }
    }

    function showMobileWorkspaceHome(){
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      document.body.dataset.mobileWorkspace = "home";
      setMobileQuickActionsOpen(false);
      const preferences = $("statusPreferences");
      if (preferences) preferences.open = false;
      document.querySelectorAll(".workspaceNavButton").forEach(button=>{
        button.classList.remove("active");
        button.removeAttribute("aria-current");
      });
    }

    function showMobileAppearancePanel(){
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      document.body.dataset.mobileWorkspace = "appearance";
      setMobileQuickActionsOpen(false);
      const preferences = $("statusPreferences");
      if (preferences) preferences.open = true;
      requestAnimationFrame(()=>$("mobileAppearanceBack")?.focus());
    }

    function setMobileQuickActionsOpen(open){
      const quickActions = $("mobileQuickActions");
      const toggle = $("mobileQuickActionsToggle");
      const menu = $("mobileQuickActionsMenu");
      if (!quickActions || !toggle || !menu) return;
      const expanded = !!open;
      quickActions.dataset.open = String(expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.setAttribute("aria-label", expanded ? "Close quick actions" : "Open quick actions");
      menu.setAttribute("aria-hidden", String(!expanded));
      menu.inert = !expanded;
    }

    function syncWorkspaceForViewport(){
      const desktop = window.matchMedia("(min-width: 901px)").matches;
      const headerSvg = document.querySelector(".site-header svg");
      if (headerSvg){
        headerSvg.setAttribute("viewBox", desktop ? "0 125 1280 105" : "0 0 1280 240");
      }
      if (desktop){
        setWorkspacePanel(activeWorkspaceId);
      }
      if (!desktop){
        if (!document.body.dataset.mobileWorkspace) showMobileWorkspaceHome();
      }
      if (!desktop && state.mobileTimelineOnly){
        const results = $("resultsBlock");
        if (results) results.open = true;
      }
      if (!desktop && state.mobileRecipeOnly){
        const splits = $("splitsBlock");
        if (splits) splits.open = true;
      }
      syncToggleUI("mobileTimelineToggle", state.mobileTimelineOnly);
      syncToggleUI("mobileRecipeToggle", state.mobileRecipeOnly);
    }

    function rebuildUIFromState(payloadMaybe){
      ensureLayers();
      syncHopperNamingUI();
      renderWeightsArea();
      renderSplitsArea();
      renderResinCalculator();
      updateLayerMetaDisplays();

      if (payloadMaybe && typeof payloadMaybe === "object"){
        const o = payloadMaybe.blocksOpen;
        if (o && typeof o === "object"){
          Object.entries(o).forEach(([id, isOpen])=>{
            const el = document.getElementById(id);
            if (el && typeof isOpen === "boolean") el.open = isOpen;
          });
        }
      }

      validateAndCompute();
    }

    function hookDetailsPersistence(){
      DETAILS_IDS.forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.addEventListener("toggle", saveSession);
      });
    }

    // On mobile, the top-level cards stack vertically with no shared height
    // budget - leaving several open at once means a lot of scrolling to get
    // back to any one of them. Opening one now closes whichever other one
    // was open, so only one card is ever expanded at a time. Desktop is
    // unaffected: it already shows a single panel via setWorkspacePanel's
    // own .desktop-active mechanism, not by closing <details> elements.
    function hookMobileAccordion(){
      const panels = Array.from(document.querySelectorAll(".workspaceContent > .workspacePanel"));
      panels.forEach(panel=>{
        panel.addEventListener("toggle", ()=>{
          if (!panel.open) return;
          if (!window.matchMedia("(max-width: 900px)").matches) return;
          // Restoring an open <details> from saved session state can emit a
          // toggle during startup. The tile home is authoritative until an
          // explicit tile click changes the mobile workspace to "panel".
          if (document.body.dataset.mobileWorkspace !== "panel") return;
          panels.forEach(other=>{ if (other !== panel && other.open) other.open = false; });
          setWorkspacePanel(panel.id, { reveal: false });
        });
      });
    }
  function fmtRelFromNow(dateObj){
    if (!dateObj) return "—";
    const ms = dateObj.getTime() - Date.now();
    const mins = Math.round(ms / 60000);

    if (mins <= 0) return "now";
    if (mins < 60) return `in ${mins}m`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `in ${h}h ${String(m).padStart(2,"0")}m`;
  }

  function fmtAgo(setAtMs){
    if (!Number.isFinite(setAtMs)) return "";
    const mins = Math.max(0, Math.round((Date.now() - setAtMs) / 60000));
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  }

  function updateChangeoverCountdown(){
    const el = $("workspaceChangeoverCountdownStatus");
    if (!el) return;
    const changeoverDate = parseChangeoverDate(state.changeoverTime);
    const stale = !!changeoverDate && isChangeoverStale(state.changeoverSetAt);
    el.classList.toggle("stale", stale);
    if (!changeoverDate){
      el.title = "";
      el.textContent = "Not set";
      return;
    }
    el.textContent = stale ? "Needs update" : fmtRelFromNow(changeoverDate);
    el.title = stale ? `Changeover time was last set ${fmtAgo(state.changeoverSetAt)} — confirm or update it.` : "";
  }

  function updateFooterNext(flat, changeoverDate){
    const msgEl = document.getElementById("footerMsg");
    const subEl = document.getElementById("footerSub");
    const desktopMsgEl = document.getElementById("workspaceNextStatus");
    const desktopSubEl = document.getElementById("workspaceNextDetail");
    if (!msgEl || !subEl) return;

    const setNextStatus = (message, detail, { stale=false } = {})=>{
      msgEl.textContent = message;
      subEl.textContent = detail;
      if (desktopMsgEl) desktopMsgEl.textContent = message;
      if (desktopSubEl) desktopSubEl.textContent = detail;
      msgEl.classList.toggle("stale", stale);
      if (desktopMsgEl) desktopMsgEl.classList.toggle("stale", stale);
    };

    if (!flat || flat.length === 0){
      setNextStatus("No tracked hoppers", "Track a resin to see the next action");
      return;
    }

    const changeoverStale = !!changeoverDate && isChangeoverStale(state.changeoverSetAt);
    if (changeoverStale){
      setNextStatus(
        "Changeover time may be outdated",
        `Last set ${fmtAgo(state.changeoverSetAt)} — update it to see accurate pump-off timing`,
        { stale: true }
      );
      return;
    }

    // Prefer “pump off by” (startByDate) when changeover is set; otherwise soonest empty.
    let next = null;

    if (changeoverDate){
      const candidates = flat
        .filter(x => x.startByDate && Number.isFinite(x.totalMinutes) && !x.pumpOff);
      candidates.sort((a,b)=>a.startByDate.getTime()-b.startByDate.getTime());
      next = candidates[0] || null;

      if (next){
        setNextStatus(
          `Next pump off: ${next.hopperLabel}${next.resinName ? ` • ${next.resinName}` : ""}`,
          `${next.startByText} • Changeover ${fmtTime(changeoverDate)}`
        );
        return;
      }
    }

    // Fallback: soonest empty (if no changeover or no valid start-by)
    const candidates2 = flat
      .filter(x => Number.isFinite(x.minutesToEmpty) && x.minutesToEmpty >= 0 && !x.pumpOff)
      .sort((a,b)=>a.minutesToEmpty-b.minutesToEmpty);

    next = candidates2[0] || null;

    if (next){
      setNextStatus(
        `Soonest empty: ${next.hopperLabel}${next.resinName ? ` • ${next.resinName}` : ""}`,
        next.timeText
      );
    } else {
      setNextStatus(
        "No upcoming hoppers",
        "All tracked hoppers are checked off or missing data"
      );
    }
  }

  function updateShortFootageCalculator(){
    const actualInput = $("shortActualWeight");
    const targetInput = $("shortTargetFootage");
    const lastGoodInput = $("shortLastGoodWeight");
    const resultEl = $("shortFootageResult");
    const messageEl = $("shortFootageMessage");
    if (!actualInput || !targetInput || !lastGoodInput || !resultEl || !messageEl) return;

    const inputs = [
      [actualInput, "Actual weight"],
      [targetInput, "Target footage"],
      [lastGoodInput, "Last good weight"]
    ];
    let invalidMessage = "";
    const values = inputs.map(([input,label])=>{
      const result = validation.validateNumber(input.value, { min: 0, label });
      input.setCustomValidity(result.valid ? "" : result.message);
      input.setAttribute("aria-invalid", String(!result.valid));
      input.title = result.valid ? "" : result.message;
      if (!result.valid && !invalidMessage) invalidMessage = result.message;
      return result.valid ? result.value : null;
    });

    if (invalidMessage){
      resultEl.textContent = "—";
      messageEl.textContent = invalidMessage;
      return;
    }
    if (inputs.some(([input])=>input.value.trim() === "")){
      resultEl.textContent = "—";
      messageEl.textContent = "Enter all three values.";
      return;
    }
    if (values[2] === 0){
      const message = "Last good weight must be greater than 0.";
      lastGoodInput.setCustomValidity(message);
      lastGoodInput.setAttribute("aria-invalid", "true");
      lastGoodInput.title = message;
      resultEl.textContent = "—";
      messageEl.textContent = message;
      return;
    }

    const shortFootage = (values[0] * values[1]) / values[2];
    resultEl.textContent = `${shortFootage.toLocaleString([], { maximumFractionDigits: 2 })} ft`;
    messageEl.textContent = "Calculated from the entered weights and target footage.";
  }

  function updateHopperWeightCalculator(){
    const circumferenceInput = $("hopperCircumference");
    const heightInput = $("hopperUsableHeight");
    const bulkInput = $("hopperBulkDensity");
    const polymerInput = $("hopperPolymerDensity");
    const packingInput = $("hopperPackingFactor");
    const resultEl = $("hopperWeightResult");
    const messageEl = $("hopperWeightMessage");
    if (
      !circumferenceInput || !heightInput || !bulkInput || !polymerInput ||
      !packingInput || !resultEl || !messageEl
    ) return;

    const clearValidity = input=>{
      input.setCustomValidity("");
      input.setAttribute("aria-invalid", "false");
      input.title = "";
    };
    [circumferenceInput, heightInput, bulkInput, polymerInput, packingInput].forEach(clearValidity);

    const requiredInputs = [
      [circumferenceInput, "Hopper circumference"],
      [heightInput, "Hopper usable height"]
    ];
    let invalidMessage = "";
    const dimensions = requiredInputs.map(([input,label])=>{
      const result = validation.validateNumber(input.value, { min: 0, label });
      if (!result.valid){
        input.setCustomValidity(result.message);
        input.setAttribute("aria-invalid", "true");
        input.title = result.message;
        if (!invalidMessage) invalidMessage = result.message;
      }
      return result.valid ? result.value : null;
    });

    if (invalidMessage){
      resultEl.textContent = "—";
      messageEl.textContent = invalidMessage;
      return;
    }
    if (requiredInputs.some(([input])=>input.value.trim() === "")){
      resultEl.textContent = "—";
      messageEl.textContent = "Enter hopper circumference and usable height.";
      return;
    }
    const zeroDimensionIndex = dimensions.findIndex(value=>value === 0);
    if (zeroDimensionIndex >= 0){
      const [input,label] = requiredInputs[zeroDimensionIndex];
      const message = `${label} must be greater than 0.`;
      input.setCustomValidity(message);
      input.setAttribute("aria-invalid", "true");
      input.title = message;
      resultEl.textContent = "—";
      messageEl.textContent = message;
      return;
    }

    const useDirectBulkDensity = bulkInput.value.trim() !== "";
    let bulkDensity;
    let densityMessage;
    if (useDirectBulkDensity){
      const result = validation.validateNumber(bulkInput.value, { min: 0, label: "Resin bulk density" });
      if (!result.valid || result.value === 0){
        const message = result.valid ? "Resin bulk density must be greater than 0." : result.message;
        bulkInput.setCustomValidity(message);
        bulkInput.setAttribute("aria-invalid", "true");
        bulkInput.title = message;
        resultEl.textContent = "—";
        messageEl.textContent = message;
        return;
      }
      bulkDensity = result.value;
      densityMessage = `Using entered bulk density: ${bulkDensity.toLocaleString([], { maximumFractionDigits: 2 })} lb/ft³.`;
    } else {
      if (polymerInput.value.trim() === ""){
        resultEl.textContent = "—";
        messageEl.textContent = "Enter resin bulk density or polymer density.";
        return;
      }
      const polymerResult = validation.validateNumber(
        polymerInput.value,
        { min: 0, label: "Polymer density" }
      );
      const packingResult = validation.validateNumber(
        packingInput.value,
        { min: 0.58, max: 0.68, label: "Packing factor" }
      );
      for (const [input,result] of [[polymerInput,polymerResult], [packingInput,packingResult]]){
        if (!result.valid){
          input.setCustomValidity(result.message);
          input.setAttribute("aria-invalid", "true");
          input.title = result.message;
          resultEl.textContent = "—";
          messageEl.textContent = result.message;
          return;
        }
      }
      if (polymerResult.value === 0){
        const message = "Polymer density must be greater than 0.";
        polymerInput.setCustomValidity(message);
        polymerInput.setAttribute("aria-invalid", "true");
        polymerInput.title = message;
        resultEl.textContent = "—";
        messageEl.textContent = message;
        return;
      }
      bulkDensity = calculators.estimateBulkDensity(polymerResult.value, packingResult.value);
      densityMessage = `Estimated bulk density: ${bulkDensity.toLocaleString([], { maximumFractionDigits: 2 })} lb/ft³.`;
    }

    const hopperWeight = calculators.calculateHopperWeight(dimensions[0], dimensions[1], bulkDensity);
    resultEl.textContent = `${Math.round(hopperWeight).toLocaleString()} lb`;
    messageEl.textContent = densityMessage;
  }

  let resinLookupMatches = [];
  let resinLookupActiveIndex = -1;

  function hideResinLookupSuggestions(){
    const input = $("resinLookupInput");
    const suggestions = $("resinLookupSuggestions");
    if (suggestions) suggestions.hidden = true;
    if (input){
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    resinLookupMatches = [];
    resinLookupActiveIndex = -1;
  }

  function positionResinLookupSuggestions(){
    const input = $("resinLookupInput");
    const suggestions = $("resinLookupSuggestions");
    if (!input || !suggestions || suggestions.hidden) return;

    const rect = input.getBoundingClientRect();
    const edgeGap = 8;
    const popupGap = 4;
    const width = Math.min(rect.width, window.innerWidth - edgeGap * 2);
    const left = Math.max(edgeGap, Math.min(rect.left, window.innerWidth - width - edgeGap));
    const spaceBelow = window.innerHeight - rect.bottom - popupGap - edgeGap;
    const spaceAbove = rect.top - popupGap - edgeGap;
    const openBelow = spaceBelow >= 160 || spaceBelow >= spaceAbove;
    const availableHeight = Math.max(96, Math.min(240, openBelow ? spaceBelow : spaceAbove));

    suggestions.style.left = `${left}px`;
    suggestions.style.width = `${width}px`;
    suggestions.style.maxHeight = `${availableHeight}px`;
    if (openBelow){
      suggestions.style.top = `${rect.bottom + popupGap}px`;
      suggestions.style.bottom = "auto";
    } else {
      suggestions.style.top = "auto";
      suggestions.style.bottom = `${window.innerHeight - rect.top + popupGap}px`;
    }
  }

  function renderResinLookupResult(resin){
    const descriptionEl = $("resinLookupDescription");
    const densityEl = $("resinLookupDensity");
    const informationEl = $("resinLookupInformation");
    if (!descriptionEl || !densityEl || !informationEl || !resinLookup) return;
    const result = resinLookup.formatResinResult(resin);
    descriptionEl.value = result.description;
    densityEl.value = result.density;
    const details = resinLookup.getResinDetails(resin);
    informationEl.value = details.typicalUses
      ? `${details.information}\n\nTypical uses:\n${details.typicalUses}`
      : details.information;
    densityEl.classList.remove("copied");
    const copyButton = $("copyResinDensity");
    if (copyButton) copyButton.disabled = result.density === "Unknown";
    const copyStatus = $("resinLookupCopyStatus");
    if (copyStatus) copyStatus.textContent = "";
  }

  async function copyResinLookupDensity(){
    const densityEl = $("resinLookupDensity");
    const copyStatus = $("resinLookupCopyStatus");
    if (!densityEl || !copyStatus) return;
    if (densityEl.value === "Unknown"){
      copyStatus.textContent = "No density is available to copy.";
      return;
    }

    const numericDensity = densityEl.value.replace(/\s*g\/cm³$/, "");
    const copied = await copyTextToClipboard(numericDensity);
    copyStatus.textContent = copied
      ? `Copied ${numericDensity} to the clipboard.`
      : "Could not copy the density to the clipboard.";
    densityEl.classList.toggle("copied", copied);
    if (copied) setTimeout(()=>densityEl.classList.remove("copied"), 1200);
  }

  function selectResinLookupMatch(resin){
    const input = $("resinLookupInput");
    if (!input) return;
    input.value = resin.resin_code;
    renderResinLookupResult(resin);
    hideResinLookupSuggestions();
    input.focus();
  }

  function setActiveResinLookupMatch(index){
    const input = $("resinLookupInput");
    const suggestions = $("resinLookupSuggestions");
    if (!input || !suggestions || !resinLookupMatches.length) return;
    resinLookupActiveIndex = (index + resinLookupMatches.length) % resinLookupMatches.length;
    [...suggestions.children].forEach((option, optionIndex)=>{
      const active = optionIndex === resinLookupActiveIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    const activeOption = suggestions.children[resinLookupActiveIndex];
    input.setAttribute("aria-activedescendant", activeOption.id);
    activeOption.scrollIntoView({ block: "nearest" });
  }

  function updateResinLookup(){
    const input = $("resinLookupInput");
    const suggestions = $("resinLookupSuggestions");
    if (!input || !suggestions || !resinLookup) return;

    if (suggestions.parentElement !== document.body) document.body.appendChild(suggestions);
    const exact = resinLookup.findExactResin(input.value, resinCatalogRecords);
    renderResinLookupResult(exact);
    resinLookupMatches = resinLookup.findResinSuggestions(input.value, 20, resinCatalogRecords);
    resinLookupActiveIndex = -1;
    suggestions.replaceChildren();

    if (!input.value.trim() || !resinLookupMatches.length){
      hideResinLookupSuggestions();
      return;
    }

    resinLookupMatches.forEach((resin, index)=>{
      const option = document.createElement("button");
      option.id = `resinLookupOption${index}`;
      option.type = "button";
      option.className = "resinLookupOption";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");

      const code = document.createElement("span");
      code.className = "resinLookupOptionCode";
      code.textContent = resin.resin_code;
      const description = document.createElement("span");
      description.className = "resinLookupOptionDescription";
      description.textContent = resin.display_description || "Unknown description";
      option.append(code, description);
      option.addEventListener("pointerdown", event=>event.preventDefault());
      option.addEventListener("click", ()=>selectResinLookupMatch(resin));
      suggestions.appendChild(option);
    });

    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
    positionResinLookupSuggestions();
  }

  function lineSyncErrorMessage(error){
    const raw = String(error?.message || error || "RT Sync request failed.");
    const known = {
      transfer_ownership_before_leaving: "Transfer ownership to another linked device before leaving RT Sync.",
      revision_conflict: "The shared line changed on another device. Retry to load the current version.",
      owner_access_required: "Only the line owner can do that.",
      workspace_access_denied: "This device no longer has access to that line.",
      invalid_saved_setup_input: "That saved setting could not be synchronized.",
      active_job_must_be_an_object: "The current job is not valid for synchronization."
    };
    const key = Object.keys(known).find(item=>raw.includes(item));
    return key ? known[key] : raw;
  }

  async function runLineSyncAction(action){
    try{ await action(); }
    catch(error){
      const message = lineSyncErrorMessage(error);
      const target = $("lineSyncMessage");
      if (target) target.textContent = message;
      showStorageWarning(`RT Sync: ${message}`);
    }
  }

  const ACTIVE_JOB_PENDING_LABELS = {
    edit: "Production changes",
    "apply-recipe-scan": "Recipe scan applied",
    "hopper-naming": "Hopper naming changed",
    "line-type": "Line type changed",
    "load-imported-setup": "Imported setup loaded",
    "load-saved-setup": "Saved setup loaded",
    "load-workspace-configuration": "Shared recipe/weights loaded",
    "pump-off": "Pump-off state changed",
    "rearrange-hoppers": "Hoppers rearranged",
    "recipe-clear": "Recipe cleared",
    "reset-all": "Everything reset",
    "reset-tracking": "Tracking reset",
    tracking: "Tracking changed"
  };
  const SETUP_ACTION_LABELS = { create: "Saved setup created", update: "Saved setup updated", rename: "Saved setup renamed", delete: "Saved setup deleted" };

  function renderPendingList(items){
    const host = $("lineSyncPendingList");
    if (!host) return;
    host.replaceChildren();
    host.hidden = !items?.length;
    if (!items?.length) return;
    items.forEach(item=>{
      const li = document.createElement("li");
      const line = item.type === "active-job"
        ? (ACTIVE_JOB_PENDING_LABELS[item.kind] || item.kind)
        : `${SETUP_ACTION_LABELS[item.action] || item.action}${item.name ? ` “${item.name}”` : ""}`;
      const where = item.workspaceName || "an unknown line (you may have left it)";
      const when = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
      const text = document.createElement("span");
      text.textContent = `${line} — ${where}${when ? ` · ${when}` : ""}`;
      const discard = document.createElement("button");
      discard.type = "button";
      discard.className = "danger lineSyncPendingDiscardBtn";
      discard.textContent = "Discard";
      discard.setAttribute("aria-label", `Discard unsynced change: ${line} — ${where}`);
      discard.addEventListener("click", ()=>{
        if (!confirm(`Permanently discard this unsynced change?\n\n${line} — ${where}\n\nThis cannot be undone - the change will not be applied anywhere.`)) return;
        lineSync?.discardPendingItem(item);
      });
      li.append(text, discard);
      host.append(li);
    });
  }

  function renderLineSync(syncState){
    const top = $("lineSyncTopStatus");
    const summary = $("lineSyncSummaryStatus");
    const status = syncState.status || "Local only";
    const stateName = status.toLowerCase().replace(/\s+/g, "-");
    if (top){ top.textContent = syncState.pendingCount ? `${status} (${syncState.pendingCount})` : status; top.dataset.state = stateName; }
    const mobileStatus = $("lineSyncMobileStatus");
    const mobileStatusHost = $("cloudSyncFooterStatus");
    if (mobileStatus) mobileStatus.textContent = syncState.pendingCount ? `${status} (${syncState.pendingCount})` : status;
    if (mobileStatusHost) mobileStatusHost.dataset.state = stateName;
    if (summary){ summary.textContent = status; summary.className = `pill ${status === "Synced" ? "badge-ok" : status === "Error" ? "badge-bad" : ""}`; }
    if ($("lineSyncMessage")) $("lineSyncMessage").textContent = syncState.message || "Local data remains available.";
    if ($("lineSyncLastSync")) $("lineSyncLastSync").textContent = syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleString() : "Never";
    if ($("lineSyncPendingCount")) $("lineSyncPendingCount").textContent = String(syncState.pendingCount || 0);
    renderPendingList(syncState.pendingSummary);
    const navStatus = $("workspaceCloudSyncStatus");
    if (navStatus){
      navStatus.textContent = syncState.pendingCount ? `${status} · ${syncState.pendingCount} pending` : status;
      const navButton = navStatus.closest(".workspaceNavButton");
      const navState = status === "Synced" ? "ok" : ["Pending", "Offline", "Conflict"].includes(status) ? "warn" : status === "Error" ? "bad" : "neutral";
      navButton?.setAttribute("data-status", navState);
    }

    const selector = $("lineSyncWorkspaceSelect");
    if (selector){
      const previous = selector.value;
      selector.replaceChildren();
      if (!syncState.workspaces.length){
        const option = new Option("No linked lines", "");
        selector.add(option);
      }else{
        syncState.workspaces.forEach(workspace=>selector.add(new Option(workspace.name, workspace.id)));
      }
      selector.value = syncState.selectedWorkspaceId || (syncState.workspaces.some(item=>item.id === previous) ? previous : "");
    }
    const nameInput = $("lineSyncWorkspaceName");
    if (nameInput && document.activeElement !== nameInput) nameInput.value = syncState.selectedWorkspace?.name || "";
    const labelInput = $("lineSyncDeviceLabel");
    if (labelInput && document.activeElement !== labelInput) labelInput.value = syncState.deviceLabel || "";
    const code = $("lineSyncGeneratedCode");
    if (code){
      code.textContent = syncState.generatedCode || "";
      code.title = syncState.generatedCodeExpiresAt ? `Expires ${new Date(syncState.generatedCodeExpiresAt).toLocaleTimeString()}` : "";
    }

    const selected = syncState.selectedWorkspace;
    const role = selected?.membership?.role || "";
    const owner = role === "owner";
    const connected = !!syncState.connected;
    ["lineSyncRenameBtn", "lineSyncGenerateCodeBtn", "lineSyncNewJobBtn", "lineSyncDisconnectBtn"].forEach(id=>{
      if ($(id)) $(id).disabled = !selected || !connected;
    });
    if ($("lineSyncLeaveBtn")) $("lineSyncLeaveBtn").disabled = !selected || !syncState.available || owner;
    if ($("lineSyncRetryDesktopLabel")) $("lineSyncRetryDesktopLabel").textContent = selected && !connected ? "Reconnect" : "Connect / retry";
    const joinPanel = document.querySelector(".lineSyncJoin");
    if (joinPanel) joinPanel.classList.toggle("mobileJoinVisible", !selected);
    const syncPanel = document.querySelector(".lineSyncPanel");
    if (syncPanel){
      syncPanel.classList.toggle("mobileHasLine", !!selected);
      syncPanel.classList.toggle("mobileHasWorkspaces", syncState.workspaces.length > 0);
    }

    const memberSection = $("lineSyncMembersSection");
    const memberHost = $("lineSyncMembers");
    if (memberSection) memberSection.hidden = !owner || !syncState.members.length;
    if (memberHost){
      memberHost.replaceChildren();
      syncState.members.forEach(member=>{
        const row = document.createElement("div");
        row.className = "lineSyncMember";
        const details = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = member.device_label || "Linked device";
        const meta = document.createElement("div");
        meta.className = "tiny";
        meta.textContent = member.user_id === syncState.userId ? `${member.role} · this browser identity` : member.role;
        details.append(label, meta);
        const seen = document.createElement("span");
        seen.className = "tiny";
        seen.textContent = member.last_seen_at ? `Seen ${new Date(member.last_seen_at).toLocaleString()}` : "";
        const actions = document.createElement("div");
        actions.className = "lineSyncMemberActions";
        if (owner && member.user_id !== syncState.userId){
          const transfer = document.createElement("button");
          transfer.type = "button"; transfer.className = "secondary"; transfer.textContent = "Make owner";
          transfer.addEventListener("click",()=>{
            if (confirm(`Transfer line ownership to ${member.device_label}?`)) runLineSyncAction(()=>lineSync.transferOwnership(member.user_id));
          });
          const remove = document.createElement("button");
          remove.type = "button"; remove.className = "danger"; remove.textContent = "Remove device";
          remove.addEventListener("click",()=>{
            if (confirm(`Remove ${member.device_label} from this line?`)) runLineSyncAction(()=>lineSync.removeMember(member.user_id));
          });
          actions.append(transfer, remove);
        }
        row.append(details, seen, actions);
        memberHost.appendChild(row);
      });
    }
    const workspaceChanged = workspaceConfigurationWorkspaceId !== (syncState.selectedWorkspaceId || "");
    renderWorkspaceConfigurations(syncState);
    if (workspaceChanged && syncState.selectedWorkspaceId) void refreshWorkspaceConfigurations();
  }

  function resolveLineSyncConflict(conflict){
    const dialog = $("lineSyncConflictDialog");
    if (!dialog?.showModal) return Promise.resolve("remote");
    const detail = $("lineSyncConflictDetails");
    if (detail) detail.textContent = `This device started from revision ${conflict.localRevision}; the shared line is now revision ${conflict.remoteRevision}.`;
    return new Promise(resolve=>{
      const finish = ()=>resolve(dialog.returnValue === "local" || dialog.returnValue === "remote" ? dialog.returnValue : "cancel");
      dialog.addEventListener("close", finish, { once: true });
      dialog.showModal();
    });
  }

  function replaceSavedConfigsFromSync(configs){
    if (!writeConfigs(configs)) showStorageWarning("Synced Line Settings could not be saved locally.");
    refreshConfigDropdown();
  }

  function newJobPayload(){
    const payload = snapshotSharedActiveJob();
    payload.lineRate = 0;
    payload.gauge = 0;
    payload.changeoverTime = "";
    payload.changeoverSetAt = null;
    payload.prodResinLb = 0;
    payload.scrapResinLb = 0;
    payload.layers.forEach(layer=>{
      layer.layerPct = 0;
      layer.hoppers.forEach((hopper,index)=>{
        hopper.pct = index === 0 ? 100 : 0;
        hopper.resinName = "";
        hopper.track = false;
        hopper.pumpOff = false;
      });
    });
    return payload;
  }

  function setupLineSync(){
    if (!window.PolynCloudSync || !window.PolynSyncStorage) return;
    lineSync = window.PolynCloudSync.create({
      config: window.POLYN_SUPABASE_CONFIG || {},
      syncStorage: window.PolynSyncStorage,
      storage: localStorage,
      supabaseLibrary: window.supabase,
      adapter: {
        getActiveJob: snapshotSharedActiveJob,
        validateActiveJob: validation.validateActiveJobPayload,
        applyRemoteActiveJob: applySharedActiveJob,
        applyLocalReplacement: applySharedActiveJob,
        getSavedConfigs: readConfigs,
        replaceSavedConfigs: replaceSavedConfigsFromSync,
        resolveActiveConflict: resolveLineSyncConflict,
        onStateChange: renderLineSync,
        onStorageError: showStorageWarning
      }
    });
    if (window.PolynWorkspaceConfigurations){
      workspaceConfigurations = window.PolynWorkspaceConfigurations.create({
        storage: localStorage,
        getTransport: ()=>lineSync?.getWorkspaceConfigurationTransport?.()
      });
      workspaceConfigurations.subscribe(snapshot=>{
        if (snapshot.workspaceId === lineSync?.getState?.().selectedWorkspaceId) renderWorkspaceConfigurations(lineSync.getState());
      });
      $("workspaceConfigurationsRefresh")?.addEventListener("click",()=>void refreshWorkspaceConfigurations());
      $("workspaceSaveProfile")?.addEventListener("click",()=>openWorkspaceConfigurationDialog("save-profile"));
      $("workspaceSaveRecipe")?.addEventListener("click",()=>openWorkspaceConfigurationDialog("save-recipe"));
      $("setupSaveWeightProfile")?.addEventListener("click",()=>openWorkspaceConfigurationDialog("save-profile"));
    }

    $("lineSyncWorkspaceSelect")?.addEventListener("change",event=>{
      if (event.target.value) runLineSyncAction(()=>lineSync.selectWorkspace(event.target.value));
    });
    $("lineSyncDeviceLabel")?.addEventListener("change",event=>runLineSyncAction(()=>lineSync.updateDeviceLabel(event.target.value)));
    $("lineSyncCreateBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.createWorkspace(
      $("lineSyncWorkspaceName")?.value, $("lineSyncDeviceLabel")?.value
    )));
    $("lineSyncJoinBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.joinWorkspace(
      $("lineSyncJoinCode")?.value, $("lineSyncDeviceLabel")?.value
    )));
    // Link codes are case-insensitive (joinWorkspace uppercases before the
    // RPC call), but mobile keyboards default to lowercase entry despite
    // autocapitalize="characters" - some keyboards ignore it or the operator
    // switches off autocorrect. Force the displayed value to uppercase as
    // they type so what's on screen always matches the printed/shared code.
    $("lineSyncJoinCode")?.addEventListener("input",event=>{
      const upper = event.target.value.toUpperCase();
      if (event.target.value !== upper) event.target.value = upper;
    });
    $("lineSyncGenerateCodeBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.generateLinkCode()));
    $("lineSyncRenameBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.renameWorkspace($("lineSyncWorkspaceName")?.value)));
    $("lineSyncRetryBtn")?.addEventListener("click",()=>runLineSyncAction(()=>
      // refreshSelected() clears the locally-disconnected flag before
      // reconciling, which retry() deliberately doesn't (retry() also runs
      // automatically on tab visibility change, where silently reconnecting
      // a line the operator explicitly disconnected would be wrong). This
      // button is an explicit "reconnect" action on both desktop and
      // mobile, so it must always use refreshSelected() when a line is
      // selected - previously only mobile did, leaving desktop with no
      // working way back into a disconnected line.
      lineSync.getState().selectedWorkspaceId
        ? lineSync.refreshSelected()
        : lineSync.retry()
    ));
    // Same reconnect/refresh action as lineSyncRetryBtn above, reachable
    // from the mobile footer without opening the RT Sync panel - tapping it
    // reconciles the selected line (flushing any unsynced change) or
    // retries the connection if nothing is selected yet.
    $("cloudSyncFooterStatus")?.addEventListener("click",()=>runLineSyncAction(()=>
      lineSync.getState().selectedWorkspaceId
        ? lineSync.refreshSelected()
        : lineSync.retry()
    ));
    $("lineSyncDisconnectBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.disconnectLocal()));
    $("lineSyncLeaveBtn")?.addEventListener("click",()=>{
      if (confirm("Leave RT Sync on this browser identity? Local Resin.Tools data will remain.")) runLineSyncAction(()=>lineSync.leaveWorkspace());
    });
    $("lineSyncNewJobBtn")?.addEventListener("click",()=>{
      if (confirm("Start a new shared job? Hopper weights will be kept; production inputs and tracking will be cleared.")) {
        runLineSyncAction(()=>lineSync.replaceActiveJob(newJobPayload(), "new-job"));
      }
    });
    lineSync.initialize();

    // Narrow bridge consumed only by workspace-recovery-ui.js: a read-only
    // descriptor of this browser's current RT Sync identity, and a way to
    // reconnect through established RT Sync APIs after admin-assisted
    // recovery. No tokens, sessions, or outbox internals are exposed.
    window.PolynRtSyncBridge = {
      getRecoveryDescriptor: () => lineSync?.getRecoveryDescriptor?.()
        || { ready: false, userId: "", deviceId: "", deviceLabel: "" },
      reconnectAfterRecovery: async (workspaceId) => {
        if (!lineSync || !workspaceId) return;
        await lineSync.loadWorkspaces();
        await lineSync.selectWorkspace(workspaceId);
        await refreshWorkspaceConfigurations();
      }
    };

    // Narrow bridge consumed only by recipe-scan-ui.js: enough to call the
    // recipe-scan Edge Function (workspace id, a fresh access token) and to
    // apply a validated result through the existing guarded recipe-apply
    // pathway. Scanning requires an active RT Sync workspace connection by
    // design - there is no local-only path.
    window.PolynRecipeScanBridge = {
      getWorkspaceId: () => lineSync?.getState?.().selectedWorkspaceId || "",
      getAccessToken: () => lineSync?.getAccessToken?.() || Promise.resolve(null),
      getLineType: () => state.lineType,
      getHopperNamingMode: () => state.hopperNamingLine9==="main" ? "main" : "standard",
      hasNonEmptyRecipe,
      applyPayload: applyScannedRecipePayload
    };
  }

    // Wire inputs
    $("lineRate")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Line rate" }, value => { state.lineRate = value; })) return;
      validateAndCompute({ sync: true });
      saveSession();
    });
    $("changeoverTime")?.addEventListener("input",(e)=>{
      state.changeoverTime = e.target.value || "";
      state.changeoverSetAt = state.changeoverTime ? Date.now() : null;
      validateAndCompute({ sync: true });
      saveSession();
    });

    $("densitySel")?.addEventListener("change",(e)=>{
      applyDensity(e.target.value);
      saveSession();
    });

    $("themeSel")?.addEventListener("change",(e)=>{
      applyTheme(e.target.value);
      saveSession();
    });

    $("timeFormatSel")?.addEventListener("change",(e)=>{
      applyTimeFormat(e.target.value);
      validateAndCompute({ sync: false });
      saveSession();
    });

    $("surfaceStyleSel")?.addEventListener("change",(e)=>{
      applySurfaceStyle(e.target.value);
      saveSession();
    });
    document.querySelectorAll("[data-mobile-tile-style]").forEach(button=>{
      button.addEventListener("click",()=>{
        applyMobileTileStyle(button.dataset.mobileTileStyle);
        saveSession();
      });
    });
    document.querySelectorAll("[data-mobile-background-style]").forEach(button=>{
      button.addEventListener("click",()=>{
        applyMobileBackgroundStyle(button.dataset.mobileBackgroundStyle);
        saveSession();
      });
    });
    $("mobileTimelineAlarmToggle")?.addEventListener("change",async event=>{
      const enabled = !!event.target.checked;
      if (enabled){
        try{
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass){
            pumpOffAudioContext ||= new AudioContextClass();
            await pumpOffAudioContext.resume();
          }
          navigator.vibrate?.(1);
          if ("serviceWorker" in navigator) await navigator.serviceWorker.register("service-worker.js");
          if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
        }catch(_error){}
      }
      applyMobileTimelineAlarm(enabled);
      validateAndCompute({ sync:false });
      saveSession();
    });

    $("prodResinLb")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Production resin" }, value => { state.prodResinLb = value; })) return;
      renderResinCalculator();
      saveSession();
      notifyActiveJobMutation();
    });
    $("scrapResinLb")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Scrap resin" }, value => { state.scrapResinLb = value; })) return;
      renderResinCalculator();
      saveSession();
      notifyActiveJobMutation();
    });
    ["shortActualWeight", "shortTargetFootage", "shortLastGoodWeight"].forEach(id=>{
      $(id)?.addEventListener("input", updateShortFootageCalculator);
    });
    [
      "hopperCircumference",
      "hopperUsableHeight",
      "hopperBulkDensity",
      "hopperPolymerDensity",
      "hopperPackingFactor"
    ].forEach(id=>$(id)?.addEventListener("input", updateHopperWeightCalculator));
    $("resinLookupInput")?.addEventListener("input", updateResinLookup);
    $("resinLookupInput")?.addEventListener("keydown", event=>{
      if (event.key === "ArrowDown" && resinLookupMatches.length){
        event.preventDefault();
        setActiveResinLookupMatch(resinLookupActiveIndex + 1);
      } else if (event.key === "ArrowUp" && resinLookupMatches.length){
        event.preventDefault();
        setActiveResinLookupMatch(resinLookupActiveIndex - 1);
      } else if (event.key === "Enter" && resinLookupActiveIndex >= 0){
        event.preventDefault();
        selectResinLookupMatch(resinLookupMatches[resinLookupActiveIndex]);
      } else if (event.key === "Escape"){
        hideResinLookupSuggestions();
      }
    });
    $("resinLookupInput")?.addEventListener("focus", updateResinLookup);
    $("copyResinDensity")?.addEventListener("click", copyResinLookupDensity);
    document.addEventListener("pointerdown", event=>{
      if (!event.target.closest?.(".resinLookupSearch, .resinLookupSuggestions")) hideResinLookupSuggestions();
    });
    window.addEventListener("resize", hideResinLookupSuggestions);
    window.addEventListener("scroll", event=>{
      const suggestions = $("resinLookupSuggestions");
      if (event.target instanceof Node && suggestions?.contains(event.target)) return;
      hideResinLookupSuggestions();
    }, true);

    const toolTabs = Array.from(document.querySelectorAll(".toolsIndexButton"));
    // Mobile collapses the tab list into a <details> dropdown (desktop keeps
    // the original always-visible list - see styles.css). The summary's
    // label mirrors whichever tab is active regardless of how selection
    // changed (click or arrow-key), but the dropdown itself only closes on
    // an actual click selection, not on arrow-key movement - otherwise
    // arrowing through options while it's open would slam it shut after the
    // very first press, before the operator could see the other choices.
    const toolsIndexDropdown = document.querySelector(".toolsIndexDropdown");
    const toolsIndexDropdownLabel = document.querySelector(".toolsIndexDropdownLabel");
    const mobileToolHeaderLabel = $("mobileToolHeaderLabel");
    function selectToolPanel(targetId, { focus = false } = {}){
      if (!toolTabs.some(tab=>tab.dataset.toolTarget === targetId)) return;
      toolTabs.forEach(tab=>{
        const selected = tab.dataset.toolTarget === targetId;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected){
          if (toolsIndexDropdownLabel) toolsIndexDropdownLabel.textContent = tab.textContent;
          if (mobileToolHeaderLabel) mobileToolHeaderLabel.textContent = tab.textContent;
          if (focus) tab.focus();
        }
      });
      document.querySelectorAll(".toolWorkspacePanel").forEach(panel=>{
        panel.hidden = panel.id !== targetId;
      });
      if (window.matchMedia("(max-width: 900px)").matches) document.body.dataset.mobileTools = "panel";
    }
    document.querySelectorAll(".mobileToolTile").forEach(tile=>{
      tile.addEventListener("click",()=>selectToolPanel(tile.dataset.mobileToolTarget));
    });
    $("mobileToolsBack")?.addEventListener("click",()=>{ document.body.dataset.mobileTools = "home"; });
    $("mobileQuickActionsToggle")?.addEventListener("click",event=>{
      event.stopPropagation();
      setMobileQuickActionsOpen($("mobileQuickActions")?.dataset.open !== "true");
    });
    $("mobileQuickActionsMenu")?.addEventListener("click",event=>event.stopPropagation());
    $("quickScanDosingScreenBtn")?.addEventListener("click",()=>{
      setMobileQuickActionsOpen(false);
      window.PolynRecipeScanUI?.startScan("dosing_screen");
    });
    $("quickProductionSummaryBtn")?.addEventListener("click",()=>{
      setMobileQuickActionsOpen(false);
      setWorkspacePanel("toolsBlock", { reveal: true });
      selectToolPanel("productionSummaryTool");
    });
    document.addEventListener("click",event=>{
      const quickActions = $("mobileQuickActions");
      if (quickActions?.dataset.open === "true" && !quickActions.contains(event.target)) setMobileQuickActionsOpen(false);
    });
    document.addEventListener("keydown",event=>{
      if (event.key !== "Escape" || $("mobileQuickActions")?.dataset.open !== "true") return;
      setMobileQuickActionsOpen(false);
      $("mobileQuickActionsToggle")?.focus();
    });
    document.querySelectorAll(".mobileHelpTile").forEach(tile=>{
      tile.addEventListener("click",()=>{
        const topic = document.getElementById(tile.dataset.mobileHelpTarget);
        if (!topic) return;
        document.querySelectorAll("#helpBlock .helpTopic").forEach(item=>item.classList.toggle("mobile-help-active", item === topic));
        topic.open = true;
        document.body.dataset.mobileHelp = "panel";
      });
    });
    $("mobileHelpBack")?.addEventListener("click",()=>{ document.body.dataset.mobileHelp = "home"; });
    toolTabs.forEach((tab, index)=>{
      tab.addEventListener("click", ()=>{
        selectToolPanel(tab.dataset.toolTarget);
        if (toolsIndexDropdown) toolsIndexDropdown.open = false;
      });
      tab.addEventListener("keydown", event=>{
        if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        let nextIndex = index;
        if (["ArrowDown", "ArrowRight"].includes(event.key)) nextIndex = (index + 1) % toolTabs.length;
        if (["ArrowUp", "ArrowLeft"].includes(event.key)) nextIndex = (index - 1 + toolTabs.length) % toolTabs.length;
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = toolTabs.length - 1;
        selectToolPanel(toolTabs[nextIndex].dataset.toolTarget, { focus: true });
      });
    });
    $("resetTrackingBtn")?.addEventListener("click", resetTracking);
    document.querySelectorAll(".workspaceNavButton").forEach(button=>{
      button.addEventListener("click",()=>setWorkspacePanel(button.dataset.workspaceTarget, { reveal: true }));
    });
    $("mobileAppearanceTile")?.addEventListener("click",event=>{
      if (!window.matchMedia("(max-width: 900px)").matches) return;
      event.stopPropagation();
      showMobileAppearancePanel();
    });
    $("mobileWorkspaceHome")?.addEventListener("click", showMobileWorkspaceHome);
    $("mobileAppearanceBack")?.addEventListener("click",()=>{
      showMobileWorkspaceHome();
      $("mobileAppearanceTile")?.focus();
    });
    document.querySelectorAll(".workspaceContent > .workspacePanel > summary").forEach(summary=>{
      summary.addEventListener("click",event=>{
        const timelineLockedOpen = state.mobileTimelineOnly && summary.closest("#resultsBlock") && window.matchMedia("(max-width: 900px)").matches;
        const mobilePanel = summary.closest(".workspacePanel");
        if (mobilePanel && window.matchMedia("(max-width: 900px)").matches && document.body.dataset.mobileWorkspace === "panel"){
          event.preventDefault();
          showMobileWorkspaceHome();
          return;
        }
        if (window.matchMedia("(min-width: 901px)").matches || timelineLockedOpen) event.preventDefault();
      });
    });
    window.addEventListener("resize", syncWorkspaceForViewport);
    setInterval(updateChangeoverCountdown, 30000);
    const statusPreferences = $("statusPreferences");
    statusPreferences?.addEventListener("toggle",()=>{
      const summary = statusPreferences.querySelector(":scope > summary");
      if (summary) summary.setAttribute("aria-label", statusPreferences.open ? "Close appearance and preferences" : "Open appearance and preferences");
    });
    document.addEventListener("click",event=>{
      if (statusPreferences?.open && !statusPreferences.contains(event.target)){
        if (window.matchMedia("(max-width: 900px)").matches && document.body.dataset.mobileWorkspace === "appearance") showMobileWorkspaceHome();
        else statusPreferences.open = false;
      }
      if (toolsIndexDropdown?.open && !toolsIndexDropdown.contains(event.target)) toolsIndexDropdown.open = false;
      document.querySelectorAll(".hopperGeometryPopover[open]").forEach(popover=>{
        if (!popover.contains(event.target)) popover.open = false;
      });
    });
    document.addEventListener("keydown",event=>{
      if (event.key === "Escape" && statusPreferences?.open){
        if (window.matchMedia("(max-width: 900px)").matches && document.body.dataset.mobileWorkspace === "appearance"){
          showMobileWorkspaceHome();
          $("mobileAppearanceTile")?.focus();
        }else{
          statusPreferences.open = false;
          statusPreferences.querySelector(":scope > summary")?.focus();
        }
      }
      if (event.key === "Escape" && toolsIndexDropdown?.open){
        toolsIndexDropdown.open = false;
        toolsIndexDropdown.querySelector(":scope > summary")?.focus();
      }
      if (event.key === "Escape"){
        document.querySelectorAll(".hopperGeometryPopover[open]").forEach(popover=>{
          popover.open = false;
          popover.querySelector(":scope > summary")?.focus();
        });
      }
    });

    // Recipe buttons
    $("saveConfigBtn")?.addEventListener("click", saveNamedConfig);
    $("loadConfigBtn")?.addEventListener("click", loadSelectedConfig);
    $("renameConfigBtn")?.addEventListener("click", renameSelectedConfig);
    $("deleteConfigBtn")?.addEventListener("click", deleteSelectedConfig);
    $("exportConfigBtn")?.addEventListener("click", exportSelectedConfig);
    $("importConfigBtn")?.addEventListener("click", ()=>showImportUI(true));
    $("cancelImportBtn")?.addEventListener("click", ()=>{ showImportUI(false); const ij=$("importJson"); if (ij) ij.value=""; });
    $("doImportBtn")?.addEventListener("click", doImport);

    // Init
    (function init(){

      ensureLayers();

      const restored = loadSession();
      if (!restored){
        applyDensity("comfort");
        applyTheme("mse");
        applyTimeFormat("12");
        applySurfaceStyle(defaultSurfaceStyle());
        rebuildUIFromState();
      }

      activeWorkspaceId = loadWorkspacePreference();
      // A phone always starts at the tile home. Desktop keeps restoring the
      // most recently used workspace through activeWorkspaceId.
      if (window.matchMedia("(max-width: 900px)").matches) showMobileWorkspaceHome();
      applyMobileTimelineMode(state.mobileTimelineOnly);
      syncWorkspaceForViewport();
      hookDetailsPersistence();
      hookMobileAccordion();
      hookCustomToggles();
      // Sync toggle UI after restore
      syncHopperNamingUI();
      syncToggleUI("showPumpOffToggle", !!state.showPumpOffTracked);

      refreshConfigDropdown();

      const selVal = $("savedConfigs")?.value;
      if (selVal && selVal !== "— none saved —"){
        const cn = $("configName");
        if (cn) cn.value = selVal;
      }

      // Ensure theme/logo applied even after restore
      applyTheme(state.theme || "mse");
      applyTimeFormat(state.timeFormat || "12");
      applySurfaceStyle(state.surfaceStyle || defaultSurfaceStyle());
      applyMobileTileStyle(state.mobileTileStyle || "minimal");
      applyMobileBackgroundStyle(state.mobileBackgroundStyle || "layer-glow");
      applyMobileTimelineAlarm(!!state.mobileTimelineAlarm);
      saveSession();
      setupLineSync();
    })();

})();
