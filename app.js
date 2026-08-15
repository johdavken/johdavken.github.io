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
      "productionSummaryBlock",
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
      // The planned recipe for the upcoming changeover, held as an ordinary
      // recipe payload (see next-recipe.js) or null when nothing is planned.
      // Deliberately not a second `layers` array: a recipe payload carries no
      // tracking, pump-off, receiver weight or hopper dimensions, so the
      // planned recipe cannot accumulate operational state of its own.
      nextRecipe: null,
      // Resin code -> scanned lot number, for whichever recipe the code
      // belongs to. Job/scan-specific, not a recipe-definition field: it is
      // never read by createRecipePayload/applyRecipePayload, so it can never
      // be saved into a reusable Saved Recipe and never rides along inside
      // state.nextRecipe's own payload. Set only when a recipe scan or Saved
      // Recipe is applied (see applyRecipeToActivePage) - a fresh apply fully
      // replaces it, exactly as it fully replaces the recipe itself.
      resinLots: {},
      // Same idea, for the Next page. Kept as its own sibling field rather
      // than inside state.nextRecipe, because commitNextRecipeWorking()
      // rebuilds state.nextRecipe from scratch via createRecipePayload on
      // every save - anything stored inside that payload would not survive
      // the operator's next keystroke.
      nextRecipeLots: {},
      prodResinLb: 0,
      scrapResinLb: 0,
      density: "comfort",
      theme: "industrial-slate",
      timeFormat: "12",
      surfaceStyle: "divided",
      mobileTileStyle: "minimal",
      mobileBackgroundStyle: "theme-native",
      mobileTimelineAlarm: false,
      gauge: 0,
      // Legacy compatibility only. Current labels are derived from the
      // selected RT Sync workspace and never from this stored preference.
      hopperNamingLine9: "standard",
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
  let lineSyncActionInFlight = false;
  let lineSyncBusyAction = "";
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
  let splitsSavedRecipesSearch = "";
  let mobileWeightProfilesOpen = false;
  let mobileWeightProfilesSearch = "";
  // Persists across renderSplitsArea() re-renders (e.g. after a rearrange
  // move) so the mobile layer view stays where the operator left it instead
  // of jumping back to Layer A on every redraw.
  let lastActiveMobileLayer = "";
  // For handleAndroidBack (below): lets it ask "is bulk edit active" and
  // exit it without duplicating each render closure's own logic. exit*
  // are rebound whenever their owning render function runs, so they
  // always call the current closure's real setBulkMode/finishRearrangement.
  let weightsBulkModeActive = false;
  let exitWeightsBulkModeFn = null;
  let exitSplitsBulkModeFn = null;
  let exitRearrangeModeFn = null;
  // Timeline clock ticker (see refreshTimelinePresentation): the last flat/
  // changeoverDate validateAndCompute actually computed from real data.
  // Ticks re-render from these on a timer without recomputing weights/rates
  // or touching state - only the time-derived fields (startByText, isLate,
  // the footer's "in X min") can go stale between data changes.
  let lastTimelineFlat = null;
  let lastTimelineChangeoverDate = null;
  let timelineTickerStarted = false;
  // RT Sync's own connected/disconnected toggle (disconnectLocal) leaves
  // selectedWorkspaceId untouched, so renderLineSync's workspace-change check
  // alone misses it - tracked separately to still trigger a native alarm
  // resync when a workspace disconnects without switching.
  let lastLineSyncConnectedState = null;
  // Which native Timeline alarm notification ids are currently scheduled,
  // so a resync can cancel exactly the ones that no longer apply (untracked,
  // pumped off, removed) instead of cancelling-and-rescheduling everything.
  let scheduledTimelineNotificationIds = new Set();
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
    [$("splitsSavedRecipesStatus"), $("setupWeightProfilesStatus"), $("mobileWeightProfilesStatus")].forEach(el=>{ if(el){ el.textContent=message||""; el.hidden=!message; } });
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
  function renderMobileSavedRecipeRows(items,syncState){
    const sheet=$("mobileSavedRecipesSheet"), host=$("mobileSavedRecipesList"), search=$("mobileSavedRecipesSearch");
    if(!sheet || !host) return;
    sheet.setAttribute("aria-busy",String(!!workspaceConfigurationRefreshInFlight));
    const query=(search?.value ?? splitsSavedRecipesSearch).trim().toLocaleLowerCase();
    splitsSavedRecipesSearch=query;
    const filtered=items
      .filter(item=>!query || item.name.toLocaleLowerCase().includes(query))
      .sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite) || new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
    host.replaceChildren();
    if(!filtered.length){
      const empty=document.createElement("div");
      empty.className="mobileSavedRecipesEmpty";
      empty.textContent=query?"No recipes match this search.":"No saved recipes in this workspace yet.";
      host.appendChild(empty);
      return;
    }
    filtered.forEach(item=>{
      const assigned=Array.isArray(item.payload?.layers)
        ? item.payload.layers.reduce((count,layer)=>count+(Array.isArray(layer?.hoppers)?layer.hoppers.filter(hopper=>typeof hopper?.resin_name==="string"&&hopper.resin_name.trim()).length:0),0)
        : 0;
      const row=document.createElement("article");
      row.className="mobileSavedRecipeRow";
      row.classList.toggle("selected",selectedWorkspaceConfigurationId===item.id);
      row.setAttribute("aria-busy","false");

      const choose=document.createElement("button");
      choose.type="button";
      choose.className="mobileSavedRecipeChoose";
      choose.setAttribute("aria-pressed",String(selectedWorkspaceConfigurationId===item.id));
      choose.innerHTML=`<span class="mobileSavedRecipeName">${item.favorite?'<span class="mobileSavedRecipeFavorite" aria-label="Favorite">★</span> ':""}</span><span class="mobileSavedRecipeMeta"></span>`;
      choose.querySelector(".mobileSavedRecipeName").append(document.createTextNode(item.name));
      choose.querySelector(".mobileSavedRecipeMeta").textContent=`${item.payload?.line_type || "?"} layers · ${assigned} assigned · ${item.updatedAt?new Date(item.updatedAt).toLocaleDateString():"date unknown"}`;
      choose.addEventListener("click",()=>{
        selectedWorkspaceConfigurationId=item.id;
        renderWorkspaceConfigurations(syncState);
      });

      const load=document.createElement("button");
      load.type="button";
      load.className="mobileSavedRecipeLoad";
      load.textContent="Load";
      load.setAttribute("aria-label",`Load ${item.name}`);
      load.addEventListener("click",()=>{
        selectedWorkspaceConfigurationId=item.id;
        row.classList.add("loading");
        row.setAttribute("aria-busy","true");
        const dialog=$("mobileSavedRecipesSheet");
        if(dialog?.open) dialog.close("load");
        splitsSavedRecipesOpen=false;
        previewWorkspaceConfiguration(item);
      });

      const overflow=document.createElement("details");
      overflow.className="mobileSavedRecipeOverflow";
      const overflowSummary=document.createElement("summary");
      overflowSummary.setAttribute("aria-label",`More actions for ${item.name}`);
      overflowSummary.textContent="⋯";
      const menu=document.createElement("div");
      menu.className="mobileSavedRecipeMenu";
      const menuAction=(label,handler,className="")=>{
        const button=document.createElement("button");
        button.type="button";
        button.textContent=label;
        if(className) button.className=className;
        button.addEventListener("click",async()=>{
          overflow.open=false;
          row.classList.add("loading");
          row.setAttribute("aria-busy","true");
          await handler();
        });
        menu.appendChild(button);
      };
      menuAction("Update",()=>openWorkspaceConfigurationDialog("update",item));
      menuAction(item.favorite?"Unfavorite":"Favorite",()=>mutateWorkspaceConfiguration("favorite",item,!item.favorite));
      menuAction("Rename",()=>openWorkspaceConfigurationDialog("rename",item));
      menuAction("Duplicate",()=>openWorkspaceConfigurationDialog("duplicate",item));
      menuAction("Delete",()=>{if(confirm(`Delete shared configuration “${item.name}”?`)) return mutateWorkspaceConfiguration("delete",item);},"danger");
      overflow.append(overflowSummary,menu);
      row.append(choose,load,overflow);
      host.appendChild(row);
    });
  }
  function renderMobileWeightProfileRows(items,syncState){
    const sheet=$("mobileWeightProfilesSheet"), host=$("mobileWeightProfilesList"), search=$("mobileWeightProfilesSearch");
    if(!sheet || !host) return;
    sheet.setAttribute("aria-busy",String(!!workspaceConfigurationRefreshInFlight));
    const query=(search?.value ?? mobileWeightProfilesSearch).trim().toLocaleLowerCase();
    mobileWeightProfilesSearch=query;
    const filtered=items.filter(item=>!query || item.name.toLocaleLowerCase().includes(query))
      .sort((a,b)=>new Date(b.updatedAt||0)-new Date(a.updatedAt||0));
    host.replaceChildren();
    if(!filtered.length){
      const empty=document.createElement("div");
      empty.className="mobileSavedRecipesEmpty";
      empty.textContent=query?"No profiles match this search.":"No receiver weight profiles in this workspace yet.";
      host.appendChild(empty);
      return;
    }
    filtered.forEach(item=>{
      const count=Array.isArray(item.payload?.layers)
        ? item.payload.layers.reduce((total,layer)=>total+(Array.isArray(layer?.receiver_weights_lb)?layer.receiver_weights_lb.length:0),0)
        : 0;
      const row=document.createElement("article");
      row.className="mobileSavedRecipeRow";
      row.classList.toggle("selected",selectedWorkspaceConfigurationId===item.id);
      const choose=document.createElement("button");
      choose.type="button";
      choose.className="mobileSavedRecipeChoose";
      choose.setAttribute("aria-pressed",String(selectedWorkspaceConfigurationId===item.id));
      choose.innerHTML='<span class="mobileSavedRecipeName"></span><span class="mobileSavedRecipeMeta"></span>';
      choose.querySelector(".mobileSavedRecipeName").textContent=item.name;
      choose.querySelector(".mobileSavedRecipeMeta").textContent=`${item.payload?.line_type || "?"} layers · ${count} receiver weights · ${item.updatedAt?new Date(item.updatedAt).toLocaleDateString():"date unknown"}`;
      choose.addEventListener("click",()=>{ selectedWorkspaceConfigurationId=item.id; renderWorkspaceConfigurations(syncState); });
      const load=document.createElement("button");
      load.type="button";
      load.className="mobileSavedRecipeLoad";
      load.textContent="Load";
      load.setAttribute("aria-label",`Load ${item.name}`);
      load.addEventListener("click",()=>{
        selectedWorkspaceConfigurationId=item.id;
        sheet.close("load");
        mobileWeightProfilesOpen=false;
        previewWorkspaceConfiguration(item);
      });
      const overflow=document.createElement("details");
      overflow.className="mobileSavedRecipeOverflow";
      const overflowSummary=document.createElement("summary");
      overflowSummary.setAttribute("aria-label",`More actions for ${item.name}`);
      overflowSummary.textContent="⋯";
      const menu=document.createElement("div");
      menu.className="mobileSavedRecipeMenu";
      const action=(label,handler,className="")=>{
        const button=document.createElement("button");
        button.type="button";
        button.textContent=label;
        if(className) button.className=className;
        button.addEventListener("click",async()=>{ overflow.open=false; await handler(); });
        menu.appendChild(button);
      };
      action("Update",()=>openWorkspaceConfigurationDialog("update",item));
      action("Rename",()=>openWorkspaceConfigurationDialog("rename",item));
      action("Duplicate",()=>openWorkspaceConfigurationDialog("duplicate",item));
      action("Delete",()=>{ if(confirm(`Delete shared configuration “${item.name}”?`)) return mutateWorkspaceConfiguration("delete",item); },"danger");
      overflow.append(overflowSummary,menu);
      row.append(choose,load,overflow);
      host.appendChild(row);
    });
  }
  function ensureMobileWeightProfilesSheet(trigger){
    let sheet=$("mobileWeightProfilesSheet");
    if(sheet) return sheet;
    sheet=document.createElement("dialog");
    sheet.id="mobileWeightProfilesSheet";
    sheet.className="mobileSavedRecipesSheet mobileWeightProfilesSheet";
    sheet.setAttribute("aria-labelledby","mobileWeightProfilesTitle");
    sheet.tabIndex=-1;
    sheet.innerHTML=`
      <button type="button" class="mobileSavedRecipesGrabber" aria-label="Close receiver weight profiles"></button>
      <header class="mobileSavedRecipesHeader"><div><strong id="mobileWeightProfilesTitle">Receiver weight profiles</strong><small>Shared with this RT Sync workspace</small></div></header>
      <div class="mobileSavedRecipesTools"><label><span class="srOnly">Search receiver weight profiles</span><input id="mobileWeightProfilesSearch" type="search" placeholder="Search profiles" autocomplete="off" /></label><button id="mobileWeightProfilesSave" type="button">Save current weights</button></div>
      <div id="mobileWeightProfilesStatus" class="mobileSavedRecipesStatus" role="status" hidden></div>
      <div id="mobileWeightProfilesList" class="mobileSavedRecipesList"></div>`;
    document.body.appendChild(sheet);
    sheet.querySelector("#mobileWeightProfilesSearch").value=mobileWeightProfilesSearch;
    sheet.querySelector("#mobileWeightProfilesSearch").addEventListener("input",event=>{
      mobileWeightProfilesSearch=event.target.value;
      renderSetupWeightProfiles(lineSync?.getState?.()||{});
    });
    sheet.querySelector("#mobileWeightProfilesSave").addEventListener("click",()=>{
      sheet.close("save");
      mobileWeightProfilesOpen=false;
      openWorkspaceConfigurationDialog("save-profile");
    });
    const close=()=>sheet.close("close");
    sheet.querySelector(".mobileSavedRecipesGrabber").addEventListener("click",close);
    sheet.addEventListener("click",event=>{
      if(event.target!==sheet) return;
      const rect=sheet.getBoundingClientRect();
      if(event.clientY<rect.top || event.clientX<rect.left || event.clientX>rect.right) close();
    });
    sheet.addEventListener("close",()=>{
      mobileWeightProfilesOpen=false;
      trigger?.setAttribute("aria-expanded","false");
      if(sheet.returnValue!=="save" && sheet.returnValue!=="load" && trigger?.isConnected) trigger.focus();
    });
    return sheet;
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
    const mobileStatus=$("mobileSavedRecipesStatus");
    const setStatus=message=>{ [status,mobileStatus].forEach(element=>{if(element){element.textContent=message||"";element.hidden=!message;}}); };
    const workspaceId=syncState?.selectedWorkspaceId || "";
    if(!workspaceId){ host.replaceChildren(); setStatus("Connect to an RT Sync workspace to view shared recipes."); wireSplitsSavedRecipesActions([]); renderMobileSavedRecipeRows([],syncState); return; }
    if(!workspaceConfigurations){ host.replaceChildren(); setStatus("Shared configurations service is unavailable."); wireSplitsSavedRecipesActions([]); renderMobileSavedRecipeRows([],syncState); return; }
    setStatus("");
    const items=workspaceConfigurations.listRecipes(workspaceId).items;
    wireSplitsSavedRecipesActions(items);
    renderConfigurationList(host,items,"recipe",syncState,{ showRowActions:false });
    renderMobileSavedRecipeRows(items,syncState);
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
    const status=$("setupWeightProfilesStatus"), mobileStatus=$("mobileWeightProfilesStatus");
    const setStatus=message=>{ [status,mobileStatus].forEach(element=>{ if(element){ element.textContent=message||""; element.hidden=!message; } }); };
    const workspaceId=syncState?.selectedWorkspaceId || "";
    if(!workspaceId){ host.replaceChildren(); setStatus("Connect to an RT Sync workspace to view shared weight profiles."); wireSetupWeightProfileActions([]); renderMobileWeightProfileRows([],syncState); return; }
    if(!workspaceConfigurations){ host.replaceChildren(); setStatus("Shared configurations service is unavailable."); wireSetupWeightProfileActions([]); renderMobileWeightProfileRows([],syncState); return; }
    setStatus("");
    const items=workspaceConfigurations.listReceiverWeightProfiles(workspaceId).items;
    wireSetupWeightProfileActions(items);
    renderConfigurationList(host,items,"profile",syncState,{ showRowActions:false });
    renderMobileWeightProfileRows(items,syncState);
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
    // The destination is never implied - a recipe loads into the page being
    // viewed, so the dialog names it before anything is replaced.
    const intoNext=recipe && isNextRecipePage();
    const nextLineNote=intoNext && Number(item.payload.line_type)!==Number(state.lineType)
      ? ` The planned recipe follows this line's ${state.lineType}-layer structure, so any layer beyond that is not carried over.`
      : "";
    details.textContent=recipe
      ? (intoNext
        ? `${item.name}. This will replace the planned Next Recipe — layer percentages, hopper resin assignments, and hopper blend percentages.${nextLineNote} The current recipe being run is not changed, and neither are receiver hopper weights, tracking, pump-off state, or timeline state.`
        : `${item.name}. This will change line type, hopper naming mode, layer percentages, hopper resin assignments, and hopper blend percentages.${lineChange} It will not change receiver hopper weights, tracking selections, pump-off state, offsets, timeline/runtime state, workspace, RT Sync identity, or appearance preferences.`)
      : `${item.name}. This will change receiver hopper weights only. It will not change line type, layer percentages, resin assignments, hopper blend percentages, tracking, pump-off state, timeline/runtime state, workspace, or RT Sync state.`;
    confirm.textContent=recipe?(intoNext?"Load into Next":"Load Recipe"):"Load Weights";
    dialog.addEventListener("close",()=>{ if(dialog.returnValue==="load") applyWorkspaceConfiguration(item); },{once:true}); dialog.showModal();
  }
  function applyWorkspaceConfiguration(item){
    if(item.type==="recipe"){
      const result=applyRecipeToActivePage(item.payload,{kind:"load-workspace-configuration"});
      workspaceConfigurationStatus(result.ok ? `Recipe loaded into ${recipePageLabel()}.` : (result.message || "This shared configuration could not be loaded."));
      return;
    }
    const result=window.PolynWorkspaceConfigurationPayloads?.applyReceiverWeightProfile(state,item.payload);
    if(!result?.ok){ workspaceConfigurationStatus(result?.errors?.[0] || "This shared configuration could not be loaded."); return; }
    renderWeightsArea(); renderSplitsArea(); validateAndCompute(); saveSession(); notifyActiveJobMutation({immediate:true,kind:"load-workspace-configuration"});
    workspaceConfigurationStatus("Receiver Weight Profile loaded successfully.");
  }

  /* One destination-aware entry point for every recipe-definition apply -
   * Saved Recipes and Scan Recipe both land here, so "it goes to the page you
   * are looking at" is implemented once rather than per action.
   *
   * Current keeps the established behaviour exactly: applyRecipePayload, then
   * render / validate / save / notify. Next writes the plan instead, and
   * deliberately does not validate or notify - a plan is not the running job,
   * and publishing it would mean an active-job write for something the line is
   * not running.
   *
   * lotByResin (optional) is a resin-code -> scanned lot number map - present
   * only when a Heat Sheet scan produced one, absent (undefined) for Saved
   * Recipes and every other source type. It is re-keyed and stored as a full
   * replacement, on the same page the recipe itself lands on, matching the
   * recipe: whatever is now on this page is what its lot map describes. */
  function applyRecipeToActivePage(payload,{kind,lotByResin}={}){
    if(!isNextRecipePage()){
      // applyRecipePayload writes state.lineType straight from the payload,
      // which would silently override the layer count this line is locked to
      // (see applyLayerCountLock). A scanned sheet is the likeliest source of
      // a wrong one - handwriting, a sheet from the wrong line - and the
      // resulting disagreement is not harmless: renderLineSync would keep
      // trying to enforce the line's real layer count against a recipe that
      // keeps asserting a different one. Refuse the load instead, and say
      // why; the operator's current recipe is left exactly as it was.
      const required=derivedRequiredLayerCount();
      if(required!==null && Number(payload?.line_type)!==required){
        return { ok:false, message:`This recipe is set up for ${payload?.line_type} layers, but this line runs ${required}. Nothing was changed.` };
      }
      const result=window.PolynWorkspaceConfigurationPayloads?.applyRecipePayload(state,payload);
      if(!result?.ok) return { ok:false, message:result?.errors?.[0] };
      state.resinLots=rekeyLotMap(lotByResin);
      syncLineTypeUI();
      renderWeightsArea(); renderSplitsArea(); validateAndCompute(); saveSession();
      notifyActiveJobMutation({immediate:true,kind:kind||"apply-recipe"});
      return { ok:true };
    }
    const stored=window.PolynNextRecipe?.normalize(payload);
    if(!stored) return { ok:false, message:"That recipe could not be read." };
    state.nextRecipe=stored;
    state.nextRecipeLots=rekeyLotMap(lotByResin);
    // Rebuild the working copy from the plan we just stored rather than the
    // one on screen, or the grid would keep showing the recipe it replaced.
    nextRecipeWorking=null;
    ensureNextRecipeWorking();
    renderSplitsArea();
    saveSession();
    return { ok:true };
  }

  function recipePageLabel(){ return isNextRecipePage() ? "Next Recipe" : "Current Recipe"; }
  // "Would applying a scan overwrite something?" - asked of whichever page the
  // scan is about to land on, not always the live recipe.
  function hasNonEmptyRecipe(){
    if(isNextRecipePage()) return !!window.PolynNextRecipe?.isMeaningful(state.nextRecipe);
    return state.layers.some(layer=>layer.hoppers.some(hopper=>hopper.resinName && hopper.resinName.trim()));
  }
  // Applies an already-built recipe payload (see recipe-scan-mapping.js,
  // which the scan UI runs once when a scan arrives and again live as the
  // operator edits the review screen's layer-percentage fields) through the
  // same guarded apply/render/save/notify pathway as loading a shared cloud
  // recipe. Deliberately payload-in, not scan-in - this function doesn't
  // know or care where the payload came from, so review-screen edits are
  // submitted as-is rather than being silently recomputed from the raw scan.
  function applyScannedRecipePayload(payload, lotByResin){
    // Destination-neutral until here: the parser and review screen never know
    // which page they are feeding, only that the operator confirmed it.
    const result = applyRecipeToActivePage(payload, { kind:"apply-recipe-scan", lotByResin });
    return result.ok ? { ok:true } : { ok:false, message: result.message || "This scan could not be applied." };
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
    validateAndCompute({ sync:false });
    if ($("resinLookupInput")?.value.trim()) updateResinLookup();
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

  /* ============================
   * Attention center facts
   * ============================
   * Facts only. Every value below is written by the code that already
   * computes it for the application's own validation and status rendering -
   * validateAndCompute, updateCollapsedSummaries, effectiveHopperWeight and
   * cloud-sync's own status machine. PolynAttentionCenter normalizes them
   * into notification entries; nothing here re-derives a rule, so the bell
   * can never disagree with the contextual validation beside the field. */
  const attentionFacts = {
    setup: { lineRateSet: true, hopperWeightsUnset: false, missingTrackedWeightCount: 0 },
    recipe: { layerTotalPct: 100, layerTotalValid: true, invalidLayers: [] },
    // The planned recipe. `planned` is PolynNextRecipe.isMeaningful - a plan
    // nobody has started raises nothing, so this stays silent for operators
    // who never use the Next page.
    nextRecipe: { planned: false, layerTotalPct: 100, layerTotalValid: true, invalidLayers: [] },
    timeline: { trackedCount: 0 },
    sync: { enabled: false, connected: false, status: "Local only", pendingCount: 0, message: "", oldestPendingAt: "" },
    storage: []
  };
  // Installed by setupAttentionCenter() during init - the notification UI
  // needs setWorkspacePanel and the footer-sheet machinery, which live in
  // the init scope, so the renderer is registered rather than the whole of
  // that scope being hoisted out (or exposed globally) to reach it.
  let renderAttentionCenter = null;
  // Also installed by init. The planned recipe's live value is the working
  // copy inside the Recipe editor's scope, which only becomes
  // state.nextRecipe on save - reading the durable payload from here would
  // leave the bell one keystroke behind the operator.
  let readNextRecipeFacts = null;
  function publishAttention(){ renderAttentionCenter?.(attentionFacts); }

  // A local-storage write failure is a transient event, not live state, so
  // the attention center ages it out (see PolynAttentionCenter's TTL) rather
  // than pinning it forever. Recorded before showStorageWarning's
  // already-shown guard so a second distinct failure still reaches the bell.
  function recordAttentionStorageError(message){
    const detail = String(message || "").trim();
    if (!detail) return;
    attentionFacts.storage = attentionFacts.storage
      .filter(item=>item.message !== detail)
      .concat({ message: detail, at: Date.now() })
      .slice(-5);
    publishAttention();
  }

  function showStorageWarning(message){
    recordAttentionStorageError(message);
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
    return window.PolynLineIdentity?.hopperBadgeLabel(layerName, hi, lineSync?.getState?.()) || `${layerName}${hi + 1}`;
  }

  function syncToggleUI(id, on){
    const el = $(id);
    if (!el) return;
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-checked", String(!!on));
    document.querySelectorAll(`[data-toggle-state-for="${id}"]`).forEach(status=>{
      status.textContent = on ? "Enabled" : "Disabled";
      status.dataset.state = on ? "on" : "off";
    });
  }

  let renderedHopperNamingMode = "";

  function derivedHopperNamingMode(syncState = lineSync?.getState?.()){
    return window.PolynLineIdentity?.hopperNamingMode(syncState) || "standard";
  }

  function syncDerivedHopperNaming(syncState, { rerender = true } = {}){
    const next = derivedHopperNamingMode(syncState);
    const changed = renderedHopperNamingMode !== next;
    renderedHopperNamingMode = next;
    document.body.dataset.hopperNaming = next;
    if (changed && rerender && state.layers.length && $("weightsArea") && $("splitsArea")){
      renderWeightsArea();
      renderSplitsArea();
      updateLayerMetaDisplays();
      validateAndCompute({ sync:false });
    }
    return changed;
  }

  const LINE_TYPES = [1, 3, 5];

  // null while the operator may choose freely; the required layer count while
  // linked to a recognized RT Sync line. The authoritative guard against
  // manual selection - hidden/disabled tiles are the visual and assistive
  // layer over it, not the rule.
  let lockedLayerCount = null;

  function syncLineTypeUI(){
    // Every layer-count transition and every RT Sync lock pass routes through
    // here, so the Overview stays current without a second set of hooks.
    renderLineOverview();
    const group = $("lineTypeToggle");
    if (!group) return;
    const locked = lockedLayerCount !== null;
    const current = LINE_TYPES.includes(Number(state.lineType)) ? Number(state.lineType) : 3;
    group.querySelectorAll("[data-line-type]").forEach(button=>{
      const selected = Number(button.dataset.lineType) === current;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
      button.disabled = locked;
      button.tabIndex = selected && !locked ? 0 : -1;
    });
  }

  // The single layer-count transition. Both the manual tiles and the
  // automatic RT Sync enforcement go through here, so recalculation,
  // rendering, recipe/percentage handling and the active-job mutation stay
  // identical either way. Returns whether the layer count actually changed.
  function applyLineTypeChange(value, { confirmDataLoss = true } = {}){
    const nextType = LINE_TYPES.includes(Number(value)) ? Number(value) : 3;
    if (nextType === state.lineType) return false;
    const nextLayerNames = new Set(getLayerNamesForType(nextType));
    const configuredRemovedLayers = state.layers.filter(layer=>!nextLayerNames.has(layer.name)).filter(layer=>
      clampNum(layer.layerPct) > 0 ||
      layer.hoppers.some((hopper,index)=>
        (index === 0 ? Math.abs(clampNum(hopper.pct) - 100) > 0.0001 : clampNum(hopper.pct) > 0) ||
        clampNum(hopper.weight) > 0 || !!hopper.resinName || !!hopper.track || !!hopper.pumpOff ||
        clampNum(hopper.usableHeight) > 0 || clampNum(hopper.circumference) > 0
      )
    );
    if (confirmDataLoss && configuredRemovedLayers.length && !confirm(`Changing to ${nextType} ${nextType === 1 ? "layer" : "layers"} will remove configured data for ${configuredRemovedLayers.map(layer=>layer.name).join(", ")}. Continue?`)){
      return false;
    }
    state.lineType = nextType;
    ensureLayers();
    syncLineTypeUI();
    rebuildUIFromState();
    saveSession();
    notifyActiveJobMutation({ immediate: true, kind: "line-type" });
    return true;
  }

  function hookLineTypeChoice(){
    const group = $("lineTypeToggle");
    if (!group || group._wired) return;
    group._wired = true;
    const choose = value=>{
      if (lockedLayerCount !== null) return;
      applyLineTypeChange(value);
    };
    group.addEventListener("click",event=>{
      const button = event.target.closest("[data-line-type]");
      if (button) choose(button.dataset.lineType);
    });
    group.addEventListener("keydown",event=>{
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      if (lockedLayerCount !== null) return;
      event.preventDefault();
      const idx = LINE_TYPES.indexOf(LINE_TYPES.includes(Number(state.lineType)) ? Number(state.lineType) : 3);
      const nextIdx = event.key === "ArrowLeft" ? Math.max(0, idx - 1) : Math.min(LINE_TYPES.length - 1, idx + 1);
      choose(LINE_TYPES[nextIdx]);
      group.querySelector(`[data-line-type="${LINE_TYPES[nextIdx]}"]`)?.focus();
    });
    syncLineTypeUI();
  }

  /* ============================
   * Derived layer count (RT Sync line identity)
   * ============================
   * Mirrors syncDerivedHopperNaming: the workspace identity decides, the
   * operator does not, and the same PolynLineIdentity module answers both
   * questions. Enforcement runs off the sync state only - never on a render
   * or Timeline tick - and is a no-op whenever the layer count already
   * matches, so no repeat mutation is ever published. */

  function derivedRequiredLayerCount(syncState = lineSync?.getState?.()){
    const required = window.PolynLineIdentity?.requiredLayerCountForSync(syncState);
    return required === undefined ? null : required;
  }

  function derivedLineConfiguration(syncState = lineSync?.getState?.()){
    return window.PolynLineIdentity?.getLineConfigurationForSync(syncState) || null;
  }

  /* ============================
   * Line Setup - Overview
   * ============================
   * A read-only restatement of what the connected line already dictates, so
   * the operator can confirm at a glance which end Layer A is on rather than
   * being asked during a scan. Reads the same PolynLineIdentity configuration
   * the scanners do; the layer count shown is the app's live one, so a manual
   * selection on an unmapped line still reads correctly. */

  function positionLabel(position){
    return position === "outside" ? "Outside" : position === "inside" ? "Inside" : "";
  }

  function renderLineOverview(syncState = lineSync?.getState?.()){
    const lineValue = $("lineOverviewLine");
    if (!lineValue) return;
    const configuration = derivedLineConfiguration(syncState);
    const layerCount = LINE_TYPES.includes(Number(state.lineType)) ? Number(state.lineType) : 3;

    lineValue.textContent = configuration ? String(configuration.lineNumber) : "—";
    lineValue.classList.toggle("lineOverviewUnknown", !configuration);
    const layersValue = $("lineOverviewLayers");
    if (layersValue) layersValue.textContent = String(layerCount);

    // The configuration's own layer count can disagree with the live one only
    // on an unmapped line, where the operator still picks manually. Trust the
    // live count for what to display, and only claim an orientation when the
    // line the rules came from actually has that many layers.
    const orderRows = configuration && configuration.layerCount === layerCount
      ? configuration.layerOrder
      : null;

    const order = $("lineOverviewOrder");
    const rows = $("lineOverviewOrderRows");
    const note = $("lineOverviewNote");
    if (order) order.hidden = !orderRows;
    if (rows){
      rows.replaceChildren();
      (orderRows || []).forEach(row => {
        const term = document.createElement("dt");
        term.textContent = row.layer;
        const detail = document.createElement("dd");
        detail.textContent = positionLabel(row.position);
        rows.append(term, detail);
      });
    }
    if (note){
      // A single-layer line has no inside/outside to report - saying so is
      // clearer than an empty section. An unresolved multilayer line says
      // nothing at all rather than implying an orientation it doesn't know.
      const single = layerCount === 1;
      note.hidden = !single;
      note.textContent = single ? "Single layer" : "";
    }
  }

  let unmappedWorkspaceNotice = "";

  // Hides the manual layer selector while a line dictates the configuration.
  // Nothing is shown in its place: Overview already reports the connected
  // line and its layer count, so a readout here would only repeat them.
  function applyLayerCountLock(syncState){
    const identity = window.PolynLineIdentity;
    const required = derivedRequiredLayerCount(syncState);
    lockedLayerCount = required;

    const group = $("lineTypeToggle");
    if (group) group.hidden = required !== null;
    // The heading goes with the control it labels - a stray "Layers" caption
    // over nothing is worse than no caption. Both come back the moment the
    // lock clears, which is the only state where manual selection applies.
    const layerCountGroup = $("setupLayerCountGroup");
    if (layerCountGroup) layerCountGroup.hidden = required !== null;
    syncLineTypeUI();

    // Development diagnostic only, once per workspace: a linked workspace we
    // cannot map is not an operator error, it just keeps manual selection.
    const workspace = identity?.linkedWorkspace(syncState) || null;
    if (workspace && required === null){
      if (unmappedWorkspaceNotice !== workspace.id){
        unmappedWorkspaceNotice = workspace.id;
        console.info(`RT Sync: workspace "${workspace.name || workspace.id}" is not a recognized Line 1-15; manual layer selection stays available.`);
      }
    }else if (!workspace){
      unmappedWorkspaceNotice = "";
    }
    return required;
  }

  let layerEnforcementScheduled = false;

  // Deferred out of the RT Sync render pass on purpose: applying a layer
  // change re-renders the whole workspace and emits an active-job mutation,
  // which would otherwise re-enter renderLineSync mid-render.
  function scheduleLayerCountEnforcement(){
    if (layerEnforcementScheduled) return;
    layerEnforcementScheduled = true;
    setTimeout(()=>{
      layerEnforcementScheduled = false;
      enforceDerivedLayerCount();
    }, 0);
  }

  function enforceDerivedLayerCount(){
    const syncState = lineSync?.getState?.();
    const required = derivedRequiredLayerCount(syncState);
    if (required === null || Number(state.lineType) === required) return false;
    // While a remote payload is being applied, notifyActiveJobMutation
    // deliberately suppresses outgoing writes, so normalizing here would
    // change this device without ever telling the others. applyRemoteActive
    // always emits again once it settles, and that pass re-schedules this.
    if (syncState?.isApplyingRemote) return false;
    return applyLineTypeChange(required, { confirmDataLoss:false });
  }

  // Called from renderLineSync. Only schedules work when the linked line and
  // the current layer count actually disagree, so ordinary refreshes,
  // reconnects and pending-count updates cost nothing.
  function syncDerivedLayerCount(syncState){
    const required = applyLayerCountLock(syncState);
    if (required === null || Number(state.lineType) === required) return false;
    scheduleLayerCountEnforcement();
    return true;
  }

  function hookToggle(id, getOn, setOn){
    const el = $(id);
    if (!el || el._wired) return;
    el._wired = true;

    const flip = ()=>{
      setOn(!getOn());
      syncToggleUI(id, getOn());
      saveSession();
      validateAndCompute({ sync: false });
    };

    el.addEventListener("click",(e)=>{ e.preventDefault(); flip(); });
    el.addEventListener("keydown",(e)=>{
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
    });

    // initial
    syncToggleUI(id, getOn());
  }

  function hookCustomToggles(){
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
    // Re-keys a resin-code -> lot map through keyName(), the exact function
    // Resin Totals buckets its own totals by, so a lot stored
    // here is guaranteed findable later regardless of how the code was
    // spaced/capitalized when it was scanned or restored. Used both when a
    // scan/Saved Recipe apply sets a fresh map, and defensively when
    // restoring one from a session or RT Sync payload.
    function rekeyLotMap(raw){
      const out = {};
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
      Object.keys(raw).forEach(code=>{
        const key = keyName(code);
        const value = raw[code];
        if (key && typeof value === "string" && value.trim()) out[key] = value.trim();
      });
      return out;
    }
    function sum(arr){ return arr.reduce((a,b)=>a+b,0); }
    function fmtNum(n, d=2){ return Number.isFinite(n) ? n.toFixed(d) : "—"; }
    // Resin Totals pounds are entered and tracked without decimals -
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
      // One place to serialize the plan, so every existing saveSession() call
      // in the recipe edit handlers persists it without being touched.
      commitNextRecipeWorking();
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
        nextRecipe: state.nextRecipe,
        resinLots: state.resinLots,
        nextRecipeLots: state.nextRecipeLots,
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
      const saved = String(t || "");
      const migrations = new Map([
        ["light", "industrial-slate"],
        ["mse", "industrial-slate"],
        ["industrial-slate", "industrial-slate"],
        ["dark", "industrial-slate-dark"],
        ["industrial-slate-dark", "industrial-slate-dark"],
        ["gruvbox-dark", "gruvbox-dark"]
      ]);
      // Removed themes have a deterministic Industrial Slate fallback. This
      // also safely migrates old locally stored and imported preferences
      // (including the legacy "light"/"mse" values) without leaving a theme
      // value that the simplified selector cannot display.
      const theme = migrations.get(saved) || "industrial-slate";

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
      syncChangeoverTimeDisplay();
    }

    function defaultSurfaceStyle(){
      return "layered-flat";
    }

    function applySurfaceStyle(value){
      const allowed = new Set(["elevated", "flat", "layered-flat", "accent-frame", "divided", "low-elevation"]);
      const storedSurfaceStyle = allowed.has(String(value)) ? String(value) : defaultSurfaceStyle();
      // Desktop surface selection was retired in favor of Layered Flat. Keep
      // the stored value solely so the existing mobile presentation does not
      // change as a side effect of this desktop-only decision.
      const renderedSurfaceStyle = isDesktopLayout()
        ? "layered-flat"
        : storedSurfaceStyle;
      state.surfaceStyle = storedSurfaceStyle;
      document.body.setAttribute("data-surface-style", renderedSurfaceStyle);
    }

    function applyMobileTileStyle(value){
      const style = "minimal";
      state.mobileTileStyle = style;
      document.body.dataset.mobileTileStyle = style;
      document.querySelectorAll("[data-mobile-tile-style]").forEach(button=>{
        button.setAttribute("aria-checked", String(button.dataset.mobileTileStyle === style));
      });
    }

    function applyMobileBackgroundStyle(value){
      const style = "theme-native";
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

    // --- native (Android) Timeline alarms ---------------------------------
    //
    // The web alarm above (setTimeout + Web Audio + navigator.vibrate) only
    // fires while this page's JS is actually running - Android suspends a
    // backgrounded/screen-off WebView's timers, so it silently never fires
    // there. This is the native replacement: real OS-scheduled notifications
    // via AlarmManager, which keep working regardless of whether the app or
    // screen is active. No Capacitor script is loaded anywhere in this app
    // (see android-back-button.js) - native already injects
    // Plugins.LocalNotifications on its own, same as Plugins.App/Camera.
    function nativeLocalNotifications(){ return window.Capacitor?.Plugins?.LocalNotifications || null; }

    // A stable 1..2147483647 int (Android notification ids are 32-bit) from
    // workspace+layer+hopper identity only - deliberately NOT from anything
    // that changes on every edit (changeover time, weight, resin). The same
    // hopper always maps to the same id, so re-scheduling it just replaces
    // the existing notification (Android's own behavior for re-scheduling a
    // known id) instead of ever duplicating one.
    function stableNotificationId(seed){
      let hash = 2166136261;
      for (let i = 0; i < seed.length; i++){
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return ((hash >>> 0) % 2147483647) + 1;
    }

    const TIMELINE_ALARM_CHANNEL_ID = "timeline-alarms";

    // Resyncs native alarms to exactly what the web timers above just
    // computed - reuses the same flat/changeoverDate schedulePumpOffAlerts
    // was just given, rather than a second pass over state. Called from
    // every validateAndCompute, which is already the single place every
    // trigger this needs to react to (data edits, track/untrack, pump-off,
    // deadline changes, RT Sync apply, the alarm toggle itself) already
    // flows through - see the call site above. A no-op on web/desktop:
    // nativeLocalNotifications() is null there.
    async function syncNativeTimelineAlarms(flat, changeoverDate){
      const LocalNotifications = nativeLocalNotifications();
      if (!LocalNotifications) return;

      const workspaceId = lineSync?.getState?.().selectedWorkspaceId || "local";
      const desired = new Map();
      if (state.mobileTimelineAlarm && changeoverDate){
        (flat || []).forEach(item=>{
          if (!item.startByDate || item.pumpOff) return;
          const due = item.startByDate.getTime();
          if (due <= Date.now()) return; // matches schedulePumpOffAlerts: never (re)notify for something already due/late
          const id = stableNotificationId(`${workspaceId}:${item.layer}:${item.hopperLabel}`);
          desired.set(id, {
            id,
            title: `Pump off ${item.hopperLabel}`,
            body: item.resinName ? `${item.resinName} is due now.` : "Hopper pump-off is due now.",
            channelId: TIMELINE_ALARM_CHANNEL_ID,
            schedule: { at: new Date(due), allowWhileIdle: true },
            extra: { openTimeline: true }
          });
        });
      }

      const toCancel = [...scheduledTimelineNotificationIds].filter(id=>!desired.has(id));
      try{
        if (toCancel.length) await LocalNotifications.cancel({ notifications: toCancel.map(id=>({ id })) });
        if (desired.size) await LocalNotifications.schedule({ notifications: [...desired.values()] });
      }catch(error){
        console.error("Timeline alarms: failed to sync native notifications.", error);
      }
      scheduledTimelineNotificationIds = new Set(desired.keys());
    }

    // Called once at init (native only, see setup below): creates the
    // Android notification channel and wires a tap on a Timeline alarm to
    // open Timeline, reusing the existing setWorkspacePanel navigation
    // rather than a new API. Requesting notification permission is
    // deliberately NOT done here - only when the operator actually turns
    // the alarm toggle on, at $("mobileTimelineAlarmToggle")'s own change
    // handler.
    async function registerNativeTimelineAlarmSupport(){
      const LocalNotifications = nativeLocalNotifications();
      if (!LocalNotifications) return;
      try{
        await LocalNotifications.createChannel({
          id: TIMELINE_ALARM_CHANNEL_ID,
          name: "Timeline Alarms",
          description: "Pump-off reminders from Resin Tools' Timeline",
          importance: 4,
          visibility: 1
        });
      }catch(error){
        console.error("Timeline alarms: failed to create the notification channel.", error);
      }
      LocalNotifications.addListener?.("localNotificationActionPerformed", (action)=>{
        if (action?.notification?.extra?.openTimeline) setWorkspacePanel("resultsBlock", { reveal: true });
      });
    }

    // Called only from the alarm toggle's own change handler (operator just
    // turned it on) - never at launch or from session/payload restore.
    async function requestNativeTimelineAlarmPermission(){
      const LocalNotifications = nativeLocalNotifications();
      const status = $("mobileTimelineAlarmStatus");
      if (!LocalNotifications) return;
      try{
        let permission = await LocalNotifications.checkPermissions();
        if (permission.display !== "granted") permission = await LocalNotifications.requestPermissions();
        if (permission.display === "granted"){
          if (status) status.textContent = "Sound, vibration, and notifications enabled - alarms will fire even while the app is closed or the screen is off.";
          validateAndCompute({ sync: false });
        } else if (status) {
          status.textContent = "Notifications are turned off for Resin Tools, so alarms won't fire while the app is closed or the screen is off - sound and vibration still work while it's open. Turn this off and on to ask again, or enable notifications for Resin Tools in Android Settings.";
        }
      }catch(error){
        console.error("Timeline alarms: failed to request notification permission.", error);
      }
    }

    function syncChangeoverTimeDisplay(){
      const display=$("changeoverTimeDisplay");
      if(!display) return;
      const value=state.changeoverTime || "";
      if(!/^\d{2}:\d{2}$/.test(value)){ display.textContent="Set time"; return; }
      const [hours,minutes]=value.split(":").map(Number);
      if(state.timeFormat === "24"){
        display.textContent=`${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}`;
        return;
      }
      const suffix=hours>=12 ? "PM" : "AM";
      display.textContent=`${hours % 12 || 12}:${String(minutes).padStart(2,"0")} ${suffix}`;
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
      // Sessions written before the planned recipe existed simply have no
      // nextRecipe field, and anything that fails recipe validation is
      // discarded rather than half-restored - either way this lands on null,
      // which is the same as "nothing planned". No migration step needed.
      state.nextRecipe = window.PolynNextRecipe?.normalize(payload.nextRecipe) ?? null;
      // Same reasoning as nextRecipe just above: a session/payload written
      // before this field existed simply has none, and rekeyLotMap already
      // discards anything malformed - both land on {}, meaning "no scanned
      // lots", with no migration step needed.
      state.resinLots = rekeyLotMap(payload.resinLots);
      state.nextRecipeLots = rekeyLotMap(payload.nextRecipeLots);
      // Drop the in-memory working copy so the grid rebuilds from the plan we
      // just took on. Without this, a plan arriving from another device would
      // be silently overwritten by this device's stale working array the next
      // time anything triggered a save.
      nextRecipeWorking = null;
      // A plan arriving from another device has to announce itself. The marker
      // is otherwise only refreshed when this device commits or switches pages,
      // so a receiving device would show no sign a plan had appeared until the
      // operator happened to touch Recipe.
      syncPlannedRecipeIndicator();
      state.prodResinLb = clampNum(payload.prodResinLb);
      state.scrapResinLb = clampNum(payload.scrapResinLb);

      applyTheme(payload.theme || "industrial-slate");
      applyDensity(payload.density || "comfort");
      applyTimeFormat(payload.timeFormat || "12");
      applySurfaceStyle(payload.surfaceStyle || defaultSurfaceStyle());
        applyMobileTileStyle("minimal");
        applyMobileBackgroundStyle("theme-native");
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
      syncChangeoverTimeDisplay();


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
      syncChangeoverTimeDisplay();

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
    function mobileSummaryWeightId(layerName, hi){ return `msw_${layerName}_${hi}`; }
    function desktopSummaryWeightId(layerName, hi){ return `dsw_${layerName}_${hi}`; }
    function mobileSummaryHeightId(layerName, hi){ return `msh_${layerName}_${hi}`; }
    function desktopSummaryHeightId(layerName, hi){ return `dsh_${layerName}_${hi}`; }
    function smartBadgeId(layerName, hi){ return `sm_${layerName}_${hi}`; }
    function hopperNameId(layerName, hi){ return `hn_${layerName}_${hi}`; }
    function hopperPositionLabel(hi){
      return window.PolynLineIdentity?.hopperPositionLabel(hi, lineSync?.getState?.()) || String(hi + 1);
    }

    function setWorkspaceHopperCircumference(value){
      state.hopperCircumference = clampNum(value);
      // Keep legacy per-hopper fields aligned for profiles/session payloads
      // created by older versions. Smart Hopper calculation reads only the
      // shared workspace value.
      state.layers.forEach(layer=>layer.hoppers.forEach(hopper=>{ hopper.circumference = state.hopperCircumference; }));
    }

    function renderMobileWeightsArea(area){
      const previousProfilesSheet=$("mobileWeightProfilesSheet");
      if(previousProfilesSheet){
        if(previousProfilesSheet.open) previousProfilesSheet.close("rerender");
        previousProfilesSheet.remove();
      }
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
      smartCopy.innerHTML = '<strong>Smart Hoppers</strong><small>Calculate capacity · <span class="smartHopperState" data-toggle-state-for="smartHoppersToggle" aria-live="polite">Disabled</span></small>';
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
        circumferenceLabel.innerHTML = "<span>Circumference</span><small>in</small>";
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

      controls.appendChild(controlRail);

      const viewToggle = document.createElement("div");
      viewToggle.className = "mobileWeightsViewToggle";
      viewToggle.innerHTML = '<span>View</span><button type="button" data-weight-view="visual" class="active">Summary</button><button type="button" data-weight-view="edit">Edit</button>';
      controls.appendChild(viewToggle);
      area.appendChild(controls);

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
          cell.setAttribute("role", "gridcell");
          cell.setAttribute("aria-selected", "false");
          cell.tabIndex = -1;
          const label = document.createElement("span");
          label.className = "mobileWeightCellLabel";
          label.textContent = hopperBadgeLabel(L.name, hi);
          cell.appendChild(label);

          const valueFields = document.createElement("div");
          valueFields.className = "mobileWeightValueFields";
          const visualReadout = document.createElement("div");
          visualReadout.className = "mobileWeightVisualReadout";
          visualReadout.innerHTML = `
            <span class="mobileWeightVisualValues"><b id="${mobileSummaryWeightId(L.name, hi)}" class="mobileWeightSummaryWeight"><span>${clampNum(hopper.weight)}</span><small>lb</small></b><b id="${mobileSummaryHeightId(L.name, hi)}"><span>${clampNum(hopper.usableHeight)}</span><small>in</small></b></span>`;
          const summaryWeight = visualReadout.querySelector(".mobileWeightSummaryWeight");
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
          const weightInput = makeValueField("W", hopper.weight, `${hopperBadgeLabel(L.name, hi)} manual weight in pounds`, value=>{
            hopper.weight = value;
            summaryWeight.querySelector("span").textContent = value;
            summaryWeight.classList.remove("smart");
            summaryWeight.removeAttribute("title");
          });
          let heightInput = null;
          if (state.smartHoppersEnabled){
            // Summary height is kept live by refreshSmartHopperState (called
            // from validateAndCompute right after this), reading the same
            // canonical hopper.usableHeight this sets - not a second,
            // positionally-addressed update here.
            heightInput = makeValueField("H", hopper.usableHeight, `${hopperBadgeLabel(L.name, hi)} usable height in inches`, value=>{ hopper.usableHeight = value; });
          }
          cell.appendChild(valueFields);
          cell.appendChild(visualReadout);
          column.appendChild(cell);
          cellRefs.set(key, { cell, weightInput, heightInput, hopper, hopperLabel: hopperBadgeLabel(L.name, hi) });

          const toggleCellSelection = ()=>{
            selected.has(key) ? selected.delete(key) : selected.add(key);
            updateSelectionUI();
          };
          cell.addEventListener("click", event=>{
            if (!bulkMode || event.target.closest("input")) return;
            toggleCellSelection();
          });
          cell.addEventListener("keydown", event=>{
            if (!bulkMode || !["Enter", " "].includes(event.key)) return;
            event.preventDefault();
            toggleCellSelection();
          });
        }
        matrix.appendChild(column);
      });
      area.appendChild(matrix);

      // Actions live after the full matrix, alongside their resulting bulk
      // controls. This keeps calculation/presentation controls above the
      // grid and prevents a top-of-panel action from opening inputs far away.
      const actionToolbar = document.createElement("div");
      actionToolbar.className = "mobileWeightsActionToolbar mobileMatrixActionBar";
      const profilesAction = document.createElement("button");
      profilesAction.type = "button";
      profilesAction.id = "mobileWeightProfilesButton";
      profilesAction.className = "mobileWeightsProfilesAction";
      profilesAction.setAttribute("aria-expanded", "false");
      profilesAction.setAttribute("aria-label", "Open receiver weight profiles");
      profilesAction.innerHTML = '<span>Profiles</span><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M7 4h14l3 5v14l-4 3H8l-4-3V9z"/><path d="M9 12h10M9 16h10M9 20h6"/></svg>';
      const bulkToggleRow = document.createElement("button");
      bulkToggleRow.type = "button";
      bulkToggleRow.id = "mobileWeightsBulkToggle";
      bulkToggleRow.className = "mobileWeightsBulkToggleRow";
      bulkToggleRow.setAttribute("aria-pressed", "false");
      bulkToggleRow.setAttribute("aria-label", "Start receiver hopper bulk edit");
      bulkToggleRow.innerHTML = '<span>Bulk edit</span><svg viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1"/><rect x="16" y="4" width="8" height="8" rx="1"/><rect x="4" y="16" width="8" height="8" rx="1"/><path d="M17 20l2 2 5-6"/></svg>';
      actionToolbar.append(profilesAction, bulkToggleRow);
      area.appendChild(actionToolbar);

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
          ref.cell.classList.toggle("selected", isSelected);
          ref.cell.setAttribute("aria-selected",String(isSelected));
          ref.cell.setAttribute("aria-label",`${isSelected ? "Selected " : ""}${ref.hopperLabel} receiver hopper`);
        });
        const optionalInputs = [bulkWeight, bulkHeight].filter(Boolean);
        const hasValue = optionalInputs.some(input=>input.value.trim() !== "");
        const valuesAreValid = optionalInputs.every(input=>!input.value.trim() || validation.validateNumber(input.value, { min:0 }).valid);
        applyButton.disabled = selected.size === 0 || !hasValue || !valuesAreValid;
        selectionStatus.textContent = message || (selected.size ? `${selected.size} selected` : "No hoppers selected");
        bulkToggleRow.querySelector("span").textContent = bulkMode ? "Done" : "Bulk edit";
        bulkToggleRow.setAttribute("aria-label", bulkMode ? "Done editing receiver hopper bulk selection" : "Start receiver hopper bulk edit");
      }

      function setMobileWeightBulkMode(enabled){
        bulkMode = !!enabled;
        weightsBulkModeActive = bulkMode;
        area.dataset.mobileBulkMode = String(bulkMode);
        bulkToggleRow.classList.toggle("on", bulkMode);
        bulkToggleRow.setAttribute("aria-pressed", String(bulkMode));
        actionToolbar.classList.toggle("bulkActive", bulkMode);
        bulkBar.hidden = !bulkMode;
        cellRefs.forEach(ref=>{ ref.cell.tabIndex=bulkMode ? 0 : -1; });
        if (!bulkMode){
          selected.clear();
          updateSelectionUI();
        }
      }
      exitWeightsBulkModeFn = () => setMobileWeightBulkMode(false);

      function setMobileWeightView(mode){
        visualMode = mode === "visual";
        area.dataset.mobileWeightView = visualMode ? "visual" : "edit";
        viewToggle.querySelectorAll("button").forEach(button=>button.classList.toggle("active", button.dataset.weightView === (visualMode ? "visual" : "edit")));
      }

      const flipBulkMode = ()=>setMobileWeightBulkMode(!bulkMode);
      bulkToggleRow.addEventListener("click", flipBulkMode);
      viewToggle.addEventListener("click", event=>{
        const button = event.target.closest("button[data-weight-view]");
        if (button) setMobileWeightView(button.dataset.weightView);
      });
      bulkBar.querySelector("#selectAllMobileWeights").addEventListener("click", ()=>{
        cellRefs.forEach((_,key)=>selected.add(key));
        updateSelectionUI();
      });
      bulkBar.querySelector("#clearMobileWeightSelection").addEventListener("click", ()=>{
        selected.clear();
        updateSelectionUI();
      });
      [bulkWeight, bulkHeight].filter(Boolean).forEach(input=>input.addEventListener("input", ()=>updateSelectionUI()));
      const profilesSheet=ensureMobileWeightProfilesSheet(profilesAction);
      profilesAction.addEventListener("click",()=>{
        const opening=!profilesSheet.open;
        if(opening){
          document.querySelectorAll(".mobileSavedRecipesSheet[open]").forEach(sheet=>{ if(sheet!==profilesSheet) sheet.close("replace"); });
          profilesSheet.showModal();
          mobileWeightProfilesOpen=true;
          profilesAction.setAttribute("aria-expanded","true");
          renderSetupWeightProfiles(lineSync?.getState?.()||{});
          profilesSheet.focus({preventScroll:true});
        }else{
          profilesSheet.close("close");
        }
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

    function placeSetupWeightProfiles(){
      const weightsBlock = $("weightsBlock");
      const profilesBlock = $("setupWeightProfilesBlock");
      const setupSection = weightsBlock?.closest(".setupSection");
      if (!weightsBlock || !profilesBlock || !setupSection) return;
      if (!isDesktopLayout()){
        return;
      }
      if (profilesBlock.parentElement !== setupSection) weightsBlock.after(profilesBlock);
    }

    function renderWeightsArea(){
      const area = $("weightsArea");
      if (!area) return;
      area.innerHTML = "";
      if (!isDesktopLayout()){
        renderMobileWeightsArea(area);
        placeSetupWeightProfiles();
        return;
      }
      const previousProfilesSheet = $("mobileWeightProfilesSheet");
      if (previousProfilesSheet){
        if (previousProfilesSheet.open) previousProfilesSheet.close("rerender");
        previousProfilesSheet.remove();
      }
      placeSetupWeightProfiles();
      const selected = new Set();
      const cellRefs = new Map();
      const columnSelectors = new Map();
      const rowSelectors = new Map();
      let desktopBulkMode = false;
      let desktopWeightView = "summary";

      function toggleSelection(keys){
        const select = keys.some(key=>!selected.has(key));
        keys.forEach(key=> select ? selected.add(key) : selected.delete(key));
        updateSelectionUI();
      }

      const toolbar = document.createElement("div");
      toolbar.className = "weightsBulkBar desktopWeightsBulkContext";
      toolbar.hidden = true;
      toolbar.innerHTML = `
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
          <button id="doneBulkWeights" type="button" class="bulkTextAction">Done</button>
        </div>
      `;

      const desktopControls = document.createElement("div");
      desktopControls.className = "desktopWeightsControls";
      desktopControls.innerHTML = `
        <div class="desktopWeightsSmartControl"><div><strong>Smart Hoppers</strong><small>Resin-specific calculated capacity</small></div><span class="desktopSmartHopperState" data-toggle-state-for="smartHoppersToggle" aria-live="polite">Disabled</span><div id="smartHoppersToggle" class="toggle" role="switch" tabindex="0" title="Smart Hoppers: compute weight from hopper geometry and resin density when known"></div></div>
        <label class="desktopSharedCircumference"><span>Circumference</span><span class="weightsInputWithUnit"><input id="desktopSharedCircumference" type="text" inputmode="decimal" placeholder="0" value="${clampNum(state.hopperCircumference)}" /><span>in</span></span></label>
        <div class="desktopWeightsViewToggle" role="group" aria-label="Receiver hopper weight view"><span>View</span><button class="active" type="button" data-weight-view="summary">Summary</button><button type="button" data-weight-view="edit">Edit</button></div>
      `;
      const circumferenceInput = desktopControls.querySelector("#desktopSharedCircumference");
      circumferenceInput.addEventListener("input", event=>{
        const accepted = acceptNumericInput(event.target, { min: 0, label: "Shared hopper circumference" }, setWorkspaceHopperCircumference);
        if (!accepted) return;
        validateAndCompute({ sync: true });
        saveSession();
      });

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
      corner.textContent = "Hopper";
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
        button.addEventListener("click", ()=>{
          if (!desktopBulkMode) return;
          toggleSelection(Array.from({length:HOPPERS_PER_LAYER}, (_,hi)=>`${L.name}:${hi}`));
        });
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
        rowButton.addEventListener("click", ()=>{
          if (!desktopBulkMode) return;
          toggleSelection(state.layers.map(L=>`${L.name}:${hi}`));
        });
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
          const initialSmartWeight = smartHopperComputation(L.hoppers[hi]);
          const initialSummaryWeight = initialSmartWeight ? Math.round(initialSmartWeight.value) : clampNum(L.hoppers[hi].weight);
          visualReadout.innerHTML = `
            <span class="desktopWeightVisualId">${hopperBadgeLabel(L.name, hi)}</span>
            <span class="desktopWeightVisualValues">
              <span class="desktopWeightSummaryValues">
                <b id="${desktopSummaryWeightId(L.name, hi)}" class="desktopWeightSummaryWeight${initialSmartWeight ? " smart" : ""}" aria-label="${hopperBadgeLabel(L.name, hi)} ${initialSmartWeight ? "Smart-calculated" : "manual"} weight, ${initialSummaryWeight} pounds"><span>${initialSummaryWeight}</span><small>lb</small></b>
                <b id="${desktopSummaryHeightId(L.name, hi)}"><span>${clampNum(L.hoppers[hi].usableHeight)}</span><small>in</small></b>
              </span>
              <span class="desktopWeightEditFields">
                <label><input class="desktopVisualWeight" type="text" inputmode="decimal" value="${clampNum(L.hoppers[hi].weight)}" aria-label="${hopperBadgeLabel(L.name, hi)} manual weight in pounds"/><small>Weight (lb)</small></label>
                ${state.smartHoppersEnabled ? `<label><input class="desktopVisualHeight" type="text" inputmode="decimal" value="${clampNum(L.hoppers[hi].usableHeight)}" aria-label="${hopperBadgeLabel(L.name, hi)} usable height in inches"/><small>Height (in)</small></label>` : ""}
              </span>
            </span>`;
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
            if (!desktopBulkMode || e.target === input || e.target === selector || e.target.closest(".hopperGeometryPopover") || e.target.closest(".desktopWeightVisualReadout input")) return;
            selector.checked = !selector.checked;
            selector.dispatchEvent(new Event("change"));
          });
          td.addEventListener("keydown", event=>{
            if (!desktopBulkMode || !["Enter", " "].includes(event.key) || event.target.closest("input")) return;
            event.preventDefault();
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
            // Summary height is kept live by refreshSmartHopperState (called
            // from validateAndCompute right after this), reading the same
            // canonical hopper.usableHeight this sets - not a second,
            // positionally-addressed update here.
            const accepted = acceptNumericInput(event.target, { min:0, label:`${hopperBadgeLabel(L.name, hi)} usable height` }, value=>{
              L.hoppers[hi].usableHeight = value;
            });
            if (!accepted) return;
            validateAndCompute({ sync:true }); saveSession();
          });
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      frame.appendChild(table);
      scroll.appendChild(frame);
      const actionToolbar = document.createElement("div");
      actionToolbar.className = "desktopWeightsActionToolbar mobileMatrixActionBar";
      const profilesAction = document.createElement("button");
      profilesAction.type = "button";
      profilesAction.id = "desktopWeightProfilesButton";
      profilesAction.setAttribute("aria-expanded", "false");
      profilesAction.setAttribute("aria-label", "Open receiver weight profiles");
      profilesAction.innerHTML = '<span>Profiles</span><svg viewBox="0 0 28 28" aria-hidden="true"><path d="M7 4h14l3 5v14l-4 3H8l-4-3V9z"/><path d="M9 12h10M9 16h10M9 20h6"/></svg>';
      const bulkModeButton = document.createElement("button");
      bulkModeButton.type = "button";
      bulkModeButton.id = "desktopWeightsBulkToggle";
      bulkModeButton.setAttribute("aria-pressed", "false");
      bulkModeButton.innerHTML = '<span>Bulk edit</span><svg viewBox="0 0 28 28" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1"/><rect x="16" y="4" width="8" height="8" rx="1"/><rect x="4" y="16" width="8" height="8" rx="1"/><path d="M17 20l2 2 5-6"/></svg>';
      actionToolbar.append(profilesAction, bulkModeButton);

      area.appendChild(desktopControls);
      area.appendChild(scroll);
      area.appendChild(actionToolbar);
      area.appendChild(toolbar);

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
          ref.td.setAttribute("aria-selected", String(isSelected));
          ref.td.tabIndex = desktopBulkMode ? 0 : -1;
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
        const bulkInputs = [bulkInput, bulkHeightInput].filter(Boolean);
        const hasBulkValue = bulkInputs.some(field=>field.value.trim() !== "");
        const validBulkValues = bulkInputs.every(field=>!field.value.trim() || validation.validateNumber(field.value, { min:0 }).valid);
        applyButton.disabled = selected.size === 0 || !hasBulkValue || !validBulkValues;
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
      function setDesktopBulkMode(enabled){
        desktopBulkMode = !!enabled;
        weightsBulkModeActive = desktopBulkMode;
        area.dataset.desktopBulkMode = String(desktopBulkMode);
        toolbar.hidden = !desktopBulkMode;
        actionToolbar.classList.toggle("bulkActive", desktopBulkMode);
        bulkModeButton.classList.toggle("active", desktopBulkMode);
        bulkModeButton.setAttribute("aria-pressed", String(desktopBulkMode));
        bulkModeButton.querySelector("span").textContent = desktopBulkMode ? "Done" : "Bulk edit";
        if (!desktopBulkMode) selected.clear();
        updateSelectionUI();
      }
      exitWeightsBulkModeFn = () => setDesktopBulkMode(false);
      function setDesktopWeightView(mode){
        desktopWeightView = mode === "edit" ? "edit" : "summary";
        area.dataset.desktopWeightView = desktopWeightView;
        desktopControls.querySelectorAll("[data-weight-view]").forEach(button=>{
          const active = button.dataset.weightView === desktopWeightView;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
      }
      bulkModeButton.addEventListener("click", ()=>setDesktopBulkMode(!desktopBulkMode));
      toolbar.querySelector("#doneBulkWeights").addEventListener("click", ()=>setDesktopBulkMode(false));
      desktopControls.querySelector(".desktopWeightsViewToggle").addEventListener("click", event=>{
        const button = event.target.closest("button[data-weight-view]");
        if (button) setDesktopWeightView(button.dataset.weightView);
      });
      [bulkInput, bulkHeightInput].filter(Boolean).forEach(field=>field.addEventListener("input", ()=>updateSelectionUI()));
      const profilesSheet = ensureMobileWeightProfilesSheet(profilesAction);
      profilesAction.addEventListener("click", ()=>{
        const opening = !profilesSheet.open;
        if (opening){
          document.querySelectorAll(".mobileSavedRecipesSheet[open]").forEach(sheet=>{ if (sheet !== profilesSheet) sheet.close("replace"); });
          profilesSheet.showModal();
          mobileWeightProfilesOpen = true;
          profilesAction.setAttribute("aria-expanded", "true");
          renderSetupWeightProfiles(lineSync?.getState?.() || {});
          profilesSheet.focus({ preventScroll:true });
        } else profilesSheet.close("close");
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
      setDesktopWeightView("summary");

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

          const mobileSummaryWeight=document.getElementById(mobileSummaryWeightId(L.name, hi));
          if(mobileSummaryWeight){
            const value=smart ? Math.round(smart.value) : clampNum(hopper.weight);
            mobileSummaryWeight.querySelector("span").textContent=String(value);
            mobileSummaryWeight.classList.toggle("smart",!!smart);
            if(smart){
              mobileSummaryWeight.setAttribute("aria-label",`${hopperBadgeLabel(L.name, hi)} Smart-calculated weight, ${value} pounds`);
              mobileSummaryWeight.title=`Smart-calculated from ${hopperBadgeLabel(L.name, hi)} geometry and ${smart.resin.resin_code} bulk density.`;
            }else{
              mobileSummaryWeight.setAttribute("aria-label",`${hopperBadgeLabel(L.name, hi)} manual weight, ${value} pounds`);
              mobileSummaryWeight.removeAttribute("title");
            }
          }

          const desktopSummaryWeight=document.getElementById(desktopSummaryWeightId(L.name, hi));
          if(desktopSummaryWeight){
            const value=smart ? Math.round(smart.value) : clampNum(hopper.weight);
            desktopSummaryWeight.querySelector("span").textContent=String(value);
            desktopSummaryWeight.classList.toggle("smart",!!smart);
            desktopSummaryWeight.setAttribute("aria-label",`${hopperBadgeLabel(L.name, hi)} ${smart ? "Smart-calculated" : "manual"} weight, ${value} pounds`);
            if(smart) desktopSummaryWeight.title=`Smart-calculated from ${hopperBadgeLabel(L.name, hi)} geometry and ${smart.resin.resin_code} bulk density.`;
            else desktopSummaryWeight.removeAttribute("title");
          }

          // Usable height has one canonical value (hopper.usableHeight) and
          // no Smart/manual distinction of its own - unlike weight above,
          // it is never computed, only entered. Same targeted-by-id refresh
          // as the weight spans above, so every write path (individual edit,
          // wrench popover, bulk apply) converges on this one place instead
          // of each maintaining its own positional DOM update.
          const mobileSummaryHeight=document.getElementById(mobileSummaryHeightId(L.name, hi));
          if(mobileSummaryHeight) mobileSummaryHeight.querySelector("span").textContent=String(clampNum(hopper.usableHeight));
          const desktopSummaryHeight=document.getElementById(desktopSummaryHeightId(L.name, hi));
          if(desktopSummaryHeight) desktopSummaryHeight.querySelector("span").textContent=String(clampNum(hopper.usableHeight));

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
          const hopperNameEl = document.getElementById(hopperNameId(L.name, hi));
          if (hopperNameEl) hopperNameEl.classList.toggle("smart", !!smart);
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
      // Names the page it came from, so a sheet carried to the line is never
      // mistaken for the recipe that is actually running.
      title.textContent = recipePageLabel();
      const meta = document.createElement("div");
      meta.className = "printSheetMeta";
      const workspaceName = lineSync?.getState?.().selectedWorkspace?.name || "Local";
      const lineTypeLabel = `${state.lineType} layer${state.lineType === 1 ? "" : "s"}`;
      const namingLabel = derivedHopperNamingMode() === "main" ? "Main + 1–5" : "1–6";
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
      const hopperColumnLabels = derivedHopperNamingMode() === "main"
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
      recipeLayers().forEach(L=>{
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

    /* ============================
     * Recipe pages: Current and Next
     * ============================
     * Two pages of one Recipe workspace. Current is state.layers, the
     * operational recipe that drives the Timeline. Next is a plan for the
     * upcoming changeover, held durably as a recipe payload in
     * state.nextRecipe (see next-recipe.js) and edited through a working
     * layers-shaped array, because Bulk Edit and Rearrange mutate layer
     * objects in place and need the same shape the grid already renders.
     *
     * The grid, Bulk Edit and Rearrange all iterate recipeLayers() instead of
     * state.layers, and their handlers close over the layer/hopper objects
     * they were given - so they operate on whichever page is showing without
     * any of them knowing that two pages exist. Everything operational
     * (Timeline, readiness, run-down, production) keeps reading state.layers
     * directly and is unaffected by the selected page. */

    let activeRecipePage = "current";           // "current" | "next"; not persisted - Recipe always opens on Current
    let nextRecipeWorking = null;               // layers-shaped working copy of state.nextRecipe

    function isNextRecipePage(){ return activeRecipePage === "next"; }

    // The plan follows the line's own layer structure rather than carrying a
    // structure of its own: layer count is a property of the line, and a plan
    // whose shape disagreed with the line could never be promoted cleanly.
    function ensureNextRecipeWorking(){
      const names = getLayerNamesForType(state.lineType);
      const stored = window.PolynNextRecipe?.normalize(state.nextRecipe) || null;
      const byName = new Map((stored?.layers || []).map(layer=>[layer.name, layer]));
      const previous = new Map((nextRecipeWorking || []).map(layer=>[layer.name, layer]));

      nextRecipeWorking = names.map(name=>{
        const source = previous.get(name) || null;
        const savedLayer = byName.get(name);
        const hoppers = Array.from({length:HOPPERS_PER_LAYER}, (_, index)=>{
          if (source) return source.hoppers[index];
          const savedHopper = savedLayer?.hoppers?.[index];
          return {
            pct: clampNum(savedHopper?.pct),
            resinName: normName(savedHopper?.resin_name || ""),
            // A plan holds no operational or physical state. These exist only
            // because the grid and the rearrangement module expect the shape;
            // they are never read for the plan and never written back.
            weight: 0, track: false, pumpOff: false, usableHeight: 0, circumference: 0
          };
        });
        return source || { name, layerPct: clampNum(savedLayer?.layer_pct), hoppers };
      });
      // H1 is derived, exactly as ensureLayers() does for the live recipe. A
      // layer the operator never touched would otherwise sit at 0 instead of
      // the automatic remainder, and the plan could never satisfy the H1
      // parity rule that gates promotion.
      nextRecipeWorking.forEach(recomputeAutoH1);
      return nextRecipeWorking;
    }

    // Serializes the working plan back to the durable payload. Called from
    // snapshotPayload so every existing saveSession() in the edit handlers
    // persists the plan without any of them being changed.
    function commitNextRecipeWorking(){
      if (!nextRecipeWorking) return;
      const payload = window.PolynNextRecipe?.fromCurrent({
        lineType: state.lineType,
        hopperNamingLine9: state.hopperNamingLine9,
        layers: nextRecipeWorking
      });
      state.nextRecipe = window.PolynNextRecipe?.normalize(payload) || null;
      // The plan is committed on every save, which is also the moment the
      // "a recipe is planned" marker can start or stop being true.
      syncPlannedRecipeIndicator();
    }

    function hasPlannedRecipe(){
      return !!window.PolynNextRecipe?.isMeaningful(state.nextRecipe);
    }

    function syncPlannedRecipeIndicator(){
      const dot = $("recipePageTabNextDot");
      if (!dot) return;
      const planned = hasPlannedRecipe();
      dot.hidden = !planned;
      $("recipePageTabNext")?.setAttribute("aria-label", planned ? "Next — a recipe is planned" : "Next");
    }

    /** The layers the Recipe editor should read and write right now. */
    function recipeLayers(){
      return isNextRecipePage() ? ensureNextRecipeWorking() : state.layers;
    }

    /* The plan's own percentage totals, for the notification bell only (see
     * readNextRecipeFacts). The same two rules the current recipe is measured
     * by, applied to the plan - not a second set of validation rules.
     *
     * Reads the working copy when the operator has one open so the bell keeps
     * up with live editing, and the durable payload otherwise (a plan restored
     * from a session or arriving over RT Sync is reported without the Next
     * page ever having been visited). */
    readNextRecipeFacts = function(){
      const layers = nextRecipeWorking
        || (window.PolynNextRecipe?.normalize(state.nextRecipe)?.layers || []).map(layer=>({
          name: layer.name,
          layerPct: layer.layer_pct,
          hoppers: layer.hoppers.map(hopper=>({ pct: hopper.pct, resinName: hopper.resin_name || "" }))
        }));
      const payload = layers.length
        ? window.PolynNextRecipe?.fromCurrent({
          lineType: state.lineType,
          hopperNamingLine9: state.hopperNamingLine9,
          layers
        })
        : null;
      if (!window.PolynNextRecipe?.isMeaningful(payload)){
        return { planned: false, layerTotalPct: 100, layerTotalValid: true, invalidLayers: [] };
      }
      const layerTotal = sum(layers.map(L=>clampNum(L.layerPct)));
      return {
        planned: true,
        layerTotalPct: layerTotal,
        layerTotalValid: Math.abs(layerTotal - 100) <= 0.0001,
        invalidLayers: layers
          .map(L=>({ name: L.name, totalPct: sum(L.hoppers.map(h=>clampNum(h.pct))) }))
          .filter(L=>Math.abs(L.totalPct - 100) > 0.0001)
      };
    };

    /* ---- Load Next Recipe -------------------------------------------------
     * Promotion is applyRecipePayload - the identical call Saved Recipes
     * makes - so the plan becomes the live recipe under semantics that already
     * exist and are already tested: layer percentages, resin assignments and
     * hopper percentages are replaced; receiver weights, tracking, pump-off
     * and Smart Hopper dimensions carry forward from the hopper already in
     * that position; H1 is recalculated. Nothing else on the line is touched.
     *
     * The plan is deliberately kept afterward. The operator may want to check
     * what was applied against the printed sheet, and silently destroying
     * carefully prepared data on success would be the wrong default. */

    function renderLoadNextRecipeSummary(host, summary){
      host.replaceChildren();
      if (!summary) return;
      if (summary.unchanged){
        const same = document.createElement("p");
        same.className = "muted";
        same.textContent = "The planned recipe matches the current one — loading it changes nothing.";
        host.append(same);
        return;
      }
      summary.layerChanges.forEach(change=>{
        const row = document.createElement("div");
        row.className = "loadNextSummaryRow";
        const name = document.createElement("strong");
        name.textContent = `Layer ${change.name}`;
        const value = document.createElement("span");
        value.textContent = change.from === null || change.from === undefined
          ? `${fmtNum(change.to, 2)}%`
          : `${fmtNum(change.from, 2)}% → ${fmtNum(change.to, 2)}%`;
        row.append(name, value);
        host.append(row);
      });
      const counts = [];
      if (summary.resinChanges) counts.push(`${summary.resinChanges} resin change${summary.resinChanges === 1 ? "" : "s"}`);
      if (summary.percentageChanges) counts.push(`${summary.percentageChanges} percentage change${summary.percentageChanges === 1 ? "" : "s"}`);
      if (counts.length){
        const totals = document.createElement("p");
        totals.className = "muted tiny";
        totals.textContent = counts.join(" · ");
        host.append(totals);
      }
    }

    function openLoadNextRecipeDialog(){
      const dialog = $("loadNextRecipeDialog");
      if (!dialog?.showModal) return;
      if (!window.PolynNextRecipe?.isPromotable(state.nextRecipe)) return;
      const summary = window.PolynNextRecipe.summarizeChange(
        window.PolynNextRecipe.fromCurrent(state),
        state.nextRecipe
      );
      renderLoadNextRecipeSummary($("loadNextRecipeSummary"), summary);
      dialog.addEventListener("close",()=>{
        if (dialog.returnValue === "load") loadNextRecipeIntoCurrent();
      }, { once:true });
      dialog.showModal();
    }

    function loadNextRecipeIntoCurrent(){
      const plan = window.PolynNextRecipe?.normalize(state.nextRecipe);
      if (!plan) return { ok:false };
      const result = window.PolynWorkspaceConfigurationPayloads?.applyRecipePayload(state, plan);
      if (!result?.ok) return { ok:false, message: result?.errors?.[0] };
      // Scanned lots travel with the plan they belong to, same as the recipe
      // fields themselves. state.nextRecipeLots is untouched by this (nothing
      // here reads or clears it), so it stays right alongside the Next plan
      // that produced it - only Current's copy is replaced.
      state.resinLots = { ...(state.nextRecipeLots || {}) };
      // state.nextRecipe is untouched by applyRecipePayload - the plan stays.
      syncLineTypeUI();
      renderWeightsArea(); renderSplitsArea(); validateAndCompute(); saveSession();
      notifyActiveJobMutation({ immediate:true, kind:"load-next-recipe" });
      return { ok:true };
    }

    function syncRecipePageUI(){
      document.body.dataset.recipePage = activeRecipePage;
      document.querySelectorAll(".recipePageTab").forEach(tab=>{
        const selected = tab.dataset.recipePage === activeRecipePage;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
        // Roving tabindex: the strip is one stop, arrows move within it.
        tab.tabIndex = selected ? 0 : -1;
      });
      const panel = $("splitsArea");
      if (panel) panel.setAttribute("aria-labelledby", isNextRecipePage() ? "recipePageTabNext" : "recipePageTabCurrent");
      syncPlannedRecipeIndicator();
    }

    function setRecipePage(page){
      const next = page === "next" ? "next" : "current";
      if (next === activeRecipePage) return;
      // Leaving Next: fold the working plan back into durable state before the
      // grid stops pointing at it.
      if (isNextRecipePage()) commitNextRecipeWorking();
      activeRecipePage = next;
      syncRecipePageUI();
      renderSplitsArea();
      // Readiness and the Timeline always describe the operational recipe, so
      // this deliberately does not re-run validation against the plan.
      saveSession();
    }

    function hookRecipePageTabs(){
      const tabs = [...document.querySelectorAll(".recipePageTab")];
      if (!tabs.length) return;
      tabs.forEach((tab, index)=>{
        tab.addEventListener("click",()=>setRecipePage(tab.dataset.recipePage));
        tab.addEventListener("keydown",event=>{
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          event.preventDefault();
          const target = tabs[(index + step + tabs.length) % tabs.length];
          setRecipePage(target.dataset.recipePage);
          target.focus();
        });
      });
      syncRecipePageUI();
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
      const compactMobileRecipe = layoutModeQueries.compactRecipe.matches;
      $("mobileSavedRecipesSheet")?.remove();
      $("mobileBulkEditSheet")?.remove();

      function toggleSelection(keys){
        const select = keys.some(key=>!selected.has(key));
        keys.forEach(key=>select ? selected.add(key) : selected.delete(key));
        updateSelectionUI();
      }

      function copyLayer(fromName, toName){
        const from = recipeLayers().find(L=>L.name===fromName);
        const to = recipeLayers().find(L=>L.name===toName);
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
      // Saved recipes / Bulk edit / Rearrange are appended below - into the
      // new desktop-only .recipeUtilityTabs strip on desktop, into
      // mobilePrimaryRow on mobile - never into modeBar itself any more.
      // modeBar now holds only the four immediate actions (Scan/Print/Load
      // Next/Info), which is why its aria-expanded-based disclosure pattern
      // stays intact below unchanged - only these three's presentation is
      // becoming tab-like.
      const savedRecipesButton = document.createElement("button");
      savedRecipesButton.type = "button";
      savedRecipesButton.className = "secondary";
      savedRecipesButton.textContent = "Saved Recipes";
      savedRecipesButton.setAttribute("aria-expanded", "false");
      const modeButton = document.createElement("button");
      modeButton.type = "button";
      modeButton.className = "secondary";
      modeButton.textContent = "Bulk edit";
      modeButton.setAttribute("aria-expanded", "false");
      const rearrangeButton=document.createElement("button"); rearrangeButton.type="button"; rearrangeButton.className="secondary"; rearrangeButton.textContent=hopperRearrangement?.active?"Done Rearranging":"Rearrange"; rearrangeButton.disabled=!recipeLayers().some(L=>L.hoppers.some(h=>normName(h.resinName)||clampNum(h.pct)>0));
      if (compactMobileRecipe){
        rearrangeButton.setAttribute("aria-expanded", String(!!hopperRearrangement?.active));
      }else{
        // Desktop-only: presented as a tab, not a disclosure button - see
        // the .recipeUtilityTab assembly below for savedRecipesButton and
        // modeButton's matching treatment (theirs also needs setSavedRecipesOpen/
        // setBulkMode's re-applied state, so it happens there instead of here).
        rearrangeButton.classList.remove("secondary");
        rearrangeButton.classList.add("recipeUtilityTab");
        rearrangeButton.classList.toggle("active", !!hopperRearrangement?.active);
        rearrangeButton.setAttribute("role", "tab");
        rearrangeButton.setAttribute("aria-selected", String(!!hopperRearrangement?.active));
      }
      function finishRearrangement(cancelled=false){
        if(!hopperRearrangement?.active) return;
        if(cancelled) window.PolynHopperRearrangement.apply(recipeLayers(),hopperRearrangement.baseline);
        hopperRearrangement=null;
        renderSplitsArea();
        validateAndCompute();
        saveSession();
        if(!cancelled) notifyActiveJobMutation({immediate:true,kind:"rearrange-hoppers"});
      }
      exitRearrangeModeFn = () => finishRearrangement(true);
      function undoRearrangement(){
        const shot=hopperRearrangement?.undo?.pop();
        if(shot) window.PolynHopperRearrangement.apply(recipeLayers(),shot);
        if(hopperRearrangement){
          hopperRearrangement.tapSource=null;
          hopperRearrangement.undoVisibleUntil=0;
        }
        renderSplitsArea();
        validateAndCompute();
      }
      rearrangeButton.addEventListener("click",()=>{
        if(hopperRearrangement?.active){
          finishRearrangement(false);
          return;
        }
        splitsBulkModeActive = false;
        splitsSavedRecipesOpen = false;
        hopperRearrangement={active:true,baseline:window.PolynHopperRearrangement.snapshot(recipeLayers()),undo:[],tapSource:null};
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
      // Scan Recipe is the action a recipe workflow revolves around, so it
      // gets .recipeUtilityTab's primary sibling treatment here: the same
      // gradient button.primary uses everywhere else, plus an icon (see
      // .splitsBulkModeBar .splitsScanShortcut > summary in styles.css).
      // The icon carries over unchanged into .splitsMobilePrimaryRow's own
      // scaled-down version on Next's mobile row - it's the same <summary>
      // content either way, only the surrounding CSS differs.
      const scanRecipeButton = document.createElement("details");
      // recipeScanHideDesktop hides Scan Recipe specifically on real desktop
      // widths (Scan Recipe is a mobile-capture workflow - see
      // recipe-scan-native-capture.test.js); rearrangeDesktopOnly still
      // covers the narrower 701-900px band where this row renders but the
      // rest of the desktop action row is already hidden. Both are stripped
      // together below when Next's mobile view promotes this same element
      // into a primary mobile action.
      scanRecipeButton.className = "splitsScanShortcut rearrangeDesktopOnly recipeScanHideDesktop";
      scanRecipeButton.innerHTML = `
        <summary aria-label="Scan a recipe source" title="Scan a recipe source"><svg class="recipeActionIcon" viewBox="0 0 32 32" aria-hidden="true"><path d="M8 4H6a2 2 0 0 0-2 2v2"/><path d="M24 4h2a2 2 0 0 1 2 2v2"/><path d="M8 28H6a2 2 0 0 1-2-2v-2"/><path d="M24 28h2a2 2 0 0 0 2-2v-2"/><path d="M5 16h22"/></svg>Scan Recipe</summary>
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

      // Tertiary: quieter than Load Next Recipe below, text+icon only
      // until hovered (see .splitsBulkModeBar button.recipeActionTertiary).
      // Appended after the Load Next Recipe block below, so the desktop
      // action row reads Scan (primary) -> Load Next (secondary) -> Print
      // (tertiary), left to right in descending priority.
      const printButton=document.createElement("button"); printButton.type="button"; printButton.className="secondary rearrangeDesktopOnly recipeActionTertiary"; printButton.innerHTML=`<svg class="recipeActionIcon" viewBox="0 0 32 32" aria-hidden="true"><path d="M9 12V5h14v7"/><rect x="6" y="12" width="20" height="10" rx="1.5"/><path d="M9 20h14v7H9z"/></svg>Print Recipe`; printButton.disabled=!recipeLayers().some(L=>L.hoppers.some(h=>normName(h.resinName)||clampNum(h.pct)>0));
      printButton.addEventListener("click", printRecipeSheet);

      // The deliberate bridge from planned to running. Current-page only: on
      // the Next page you are looking at the plan, so there is nothing to
      // promote into. Disabled - rather than hidden - while the plan is
      // incomplete, so the button explains itself instead of disappearing.
      // Declared outside the block (rather than only existing on Current) so
      // the mobile primary-row assembly below can reference it either way.
      let loadNextButton = null;
      if (!isNextRecipePage()){
        loadNextButton = document.createElement("button");
        loadNextButton.type = "button";
        loadNextButton.id = "loadNextRecipeBtn";
        loadNextButton.className = "secondary";
        // Secondary: the app's ordinary secondary-button look, one step
        // down from Scan Recipe's primary gradient, one step up from Print
        // Recipe's tertiary ghost treatment (see .splitsBulkModeBar
        // button.secondary in styles.css).
        loadNextButton.innerHTML = `<svg class="recipeActionIcon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 5v16"/><path d="M10 15l6 6 6-6"/><path d="M6 26h20"/></svg>Load Next Recipe`;
        // Visible mobile label is shorter (icon dropped along with it,
        // since .textContent replaces the whole icon+label innerHTML); the
        // accessible name stays the full "Load Next Recipe" regardless of
        // which text is on screen.
        loadNextButton.setAttribute("aria-label", "Load Next Recipe");
        const planned = hasPlannedRecipe();
        const promotable = !!window.PolynNextRecipe?.isPromotable(state.nextRecipe);
        loadNextButton.hidden = !planned;
        loadNextButton.disabled = !promotable;
        loadNextButton.title = promotable
          ? "Replace the current recipe with the planned Next Recipe"
          : "The planned recipe isn't complete yet — its percentages need to total 100%";
        loadNextButton.addEventListener("click", openLoadNextRecipeDialog);
        modeBar.appendChild(loadNextButton);
      }
      // Print Recipe is appended last (after Load Next Recipe, which may or
      // may not exist depending on Current/Next), so the desktop row always
      // reads Scan -> Load Next -> Print, left to right in descending
      // priority - Load Next simply drops out of the row on the Next page.
      modeBar.appendChild(printButton);

      // On Next, Scan Recipe is promoted to a primary mobile action (see the
      // two-tier assembly below) with its own 3-source popup, so the same 3
      // sources here would just be a redundant second way to reach it -
      // pruned rather than duplicated.
      const mobileMoreButton=document.createElement("details");
      mobileMoreButton.className="mobileRecipeMore";
      mobileMoreButton.innerHTML=`
        <summary aria-label="More recipe actions"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></summary>
        <div class="mobileRecipeMoreMenu">
          ${isNextRecipePage() ? "" : `
          <button type="button" data-mobile-recipe-scan="job_traveler">Scan job traveler</button>
          <button type="button" data-mobile-recipe-scan="dosing_screen">Scan dosing screen</button>
          <button type="button" data-mobile-recipe-scan="heat_sheet">Scan heat sheet</button>`}
          <button type="button" data-mobile-recipe-print>Print recipe</button>
        </div>`;
      mobileMoreButton.querySelectorAll("[data-mobile-recipe-scan]").forEach(button=>button.addEventListener("click",()=>{
        mobileMoreButton.open=false;
        window.PolynRecipeScanUI?.startScan(button.dataset.mobileRecipeScan);
      }));
      const mobilePrintButton=mobileMoreButton.querySelector("[data-mobile-recipe-print]");
      mobilePrintButton.disabled=printButton.disabled;
      mobilePrintButton.addEventListener("click",()=>{mobileMoreButton.open=false;printRecipeSheet();});
      modeBar.appendChild(mobileMoreButton);

      const toolbar = document.createElement("div");
      toolbar.id = "splitsBulkBar";
      toolbar.className = "splitsBulkBar hide";
      toolbar.innerHTML = `
        <div class="splitsBulkSteps" aria-label="Bulk editing steps">
          <span><b>1</b> Select hoppers</span>
          <span><b>2</b> Enter changes</span>
          <span><b>3</b> Apply</span>
        </div>
        <div class="splitsBulkField">
          <div class="mobileBulkFieldHeading">
            <label for="bulkResinName">Resin name</label>
            <label class="mobileBulkChange"><input id="mobileBulkChangeResin" type="checkbox" /><span>No change</span></label>
          </div>
          <input id="bulkResinName" type="text" placeholder="No change" />
        </div>
        <div class="splitsBulkField">
          <div class="mobileBulkFieldHeading">
            <label for="bulkResinPct">Percentage</label>
            <label class="mobileBulkChange"><input id="mobileBulkChangePct" type="checkbox" /><span>No change</span></label>
          </div>
          <span class="splitsBulkPctInput">
            <input id="bulkResinPct" type="text" inputmode="decimal" placeholder="No change" />
            <span>%</span>
          </span>
        </div>
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

      const mobileBulkContext = document.createElement("div");
      mobileBulkContext.className = "mobileBulkContext";
      mobileBulkContext.hidden = true;
      mobileBulkContext.innerHTML = `
        <button type="button" class="mobileBulkCancel">Cancel</button>
        <strong class="mobileBulkCount" role="status" aria-live="polite">0 selected</strong>
        <button type="button" class="mobileBulkEditSelected" disabled>Edit selected</button>
      `;
      const mobileRearrangeContext=document.createElement("div");
      mobileRearrangeContext.className="mobileRearrangeContext";
      mobileRearrangeContext.hidden=true;
      mobileRearrangeContext.innerHTML=`
        <button type="button" class="mobileRearrangeCancel">Cancel</button>
        <strong class="mobileRearrangePrompt" role="status" aria-live="polite">Tap a hopper to move</strong>
        <button type="button" class="mobileRearrangeDone">Done</button>`;
      function updateMobileRearrangePrompt(message=""){
        const source=hopperRearrangement?.tapSource;
        mobileRearrangeContext.querySelector(".mobileRearrangePrompt").textContent=message||(
          source ? `Move ${hopperBadgeLabel(source.layer,source.index)} where?` : "Tap a hopper to move"
        );
      }

      // Recipe Setup's own copy of the shared recipe list
      // (see renderSplitsSavedRecipes) - same service/cache, same
      // Load/Update/Rename/Duplicate/Favorite/Delete actions, just a
      // closer-to-the-work entry point.
      const savedRecipesPanel = document.createElement("div");
      savedRecipesPanel.id = "splitsSavedRecipesPanel";
      savedRecipesPanel.className = "splitsSavedRecipesPanel hide";
      savedRecipesPanel.innerHTML = `
        <div class="workspaceConfigurationSectionTitle">
          <div>
            <strong>Saved Recipes</strong>
            <small>Shared recipes for this RT Sync workspace.</small>
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
      let mobileSavedRecipesSheet=null;
      let mobileBulkEditSheet=null;
      if(compactMobileRecipe){
        mobileSavedRecipesSheet=document.createElement("dialog");
        mobileSavedRecipesSheet.id="mobileSavedRecipesSheet";
        mobileSavedRecipesSheet.className="mobileSavedRecipesSheet";
        mobileSavedRecipesSheet.setAttribute("aria-labelledby","mobileSavedRecipesTitle");
        mobileSavedRecipesSheet.tabIndex=-1;
        mobileSavedRecipesSheet.innerHTML=`
          <button type="button" class="mobileSavedRecipesGrabber" aria-label="Close recipes"></button>
          <header class="mobileSavedRecipesHeader">
            <div><strong id="mobileSavedRecipesTitle">Recipes</strong><small>Shared with this RT Sync workspace</small></div>
          </header>
          <div class="mobileSavedRecipesTools">
            <label><span class="srOnly">Search saved recipes</span><input id="mobileSavedRecipesSearch" type="search" placeholder="Search recipes" autocomplete="off" /></label>
            <button id="mobileSavedRecipesNew" type="button">New recipe</button>
          </div>
          <div id="mobileSavedRecipesStatus" class="mobileSavedRecipesStatus" role="status" hidden></div>
          <div id="mobileSavedRecipesList" class="mobileSavedRecipesList"></div>`;
        document.body.appendChild(mobileSavedRecipesSheet);
        mobileSavedRecipesSheet.querySelector("#mobileSavedRecipesSearch").value=splitsSavedRecipesSearch;
        mobileSavedRecipesSheet.querySelector(".mobileSavedRecipesGrabber").addEventListener("click",()=>mobileSavedRecipesSheet.close("close"));
        mobileSavedRecipesSheet.addEventListener("click",event=>{
          if(event.target!==mobileSavedRecipesSheet) return;
          const rect=mobileSavedRecipesSheet.getBoundingClientRect();
          if(event.clientY<rect.top || event.clientX<rect.left || event.clientX>rect.right) mobileSavedRecipesSheet.close("close");
        });
        mobileSavedRecipesSheet.querySelector("#mobileSavedRecipesNew").addEventListener("click",()=>{
          splitsSavedRecipesOpen=false;
          mobileSavedRecipesSheet.close("new");
          openWorkspaceConfigurationDialog("save-recipe");
        });
        mobileSavedRecipesSheet.querySelector("#mobileSavedRecipesSearch").addEventListener("input",event=>{
          splitsSavedRecipesSearch=event.target.value;
          renderSplitsSavedRecipes(lineSync?.getState?.()||{});
        });
        mobileSavedRecipesSheet.addEventListener("close",()=>{
          splitsSavedRecipesOpen=false;
          savedRecipesButton.setAttribute("aria-expanded","false");
          if(mobileSavedRecipesSheet.returnValue!=="new"&&mobileSavedRecipesSheet.returnValue!=="load"&&savedRecipesButton.isConnected) savedRecipesButton.focus();
        });

        mobileBulkEditSheet=document.createElement("dialog");
        mobileBulkEditSheet.id="mobileBulkEditSheet";
        mobileBulkEditSheet.className="mobileBulkEditSheet mobileSavedRecipesSheet";
        mobileBulkEditSheet.setAttribute("aria-labelledby","mobileBulkEditTitle");
        mobileBulkEditSheet.innerHTML=`
          <div class="mobileSavedRecipesGrabber" aria-hidden="true"></div>
          <header class="mobileSavedRecipesHeader">
            <div><strong id="mobileBulkEditTitle">Edit selected hoppers</strong><small id="mobileBulkEditSubtitle">Choose what should change</small></div>
            <button type="button" class="mobileBulkEditClose mobileSavedRecipesClose" aria-label="Close bulk editor">×</button>
          </header>
          <div class="mobileBulkEditBody"></div>`;
        mobileBulkEditSheet.querySelector(".mobileBulkEditBody").appendChild(toolbar);
        document.body.appendChild(mobileBulkEditSheet);
        mobileBulkEditSheet.querySelector(".mobileBulkEditClose").addEventListener("click",()=>mobileBulkEditSheet.close("close"));
        mobileBulkEditSheet.addEventListener("close",()=>{
          if(bulkMode&&mobileBulkContext.isConnected) mobileBulkContext.querySelector(".mobileBulkEditSelected")?.focus();
        });
      }
      function setSavedRecipesOpen(open){
        if(compactMobileRecipe){
          savedRecipesPanel.classList.add("hide");
          savedRecipesButton.textContent="Recipes";
          savedRecipesButton.setAttribute("aria-expanded",String(open));
          splitsSavedRecipesOpen=!!open;
          if(open&&!mobileSavedRecipesSheet?.open){
            document.querySelectorAll(".mobileSavedRecipesSheet[open]").forEach(sheet=>{ if(sheet!==mobileSavedRecipesSheet) sheet.close("replace"); });
            mobileSavedRecipesSheet?.showModal();
            mobileSavedRecipesSheet?.focus({preventScroll:true});
          }else if(!open&&mobileSavedRecipesSheet?.open){
            mobileSavedRecipesSheet.close("close");
          }
          return;
        }
        savedRecipesPanel.classList.toggle("hide", !open);
        savedRecipesButton.textContent = open ? "Close recipes" : "Saved recipes";
        savedRecipesButton.setAttribute("aria-selected", String(open));
        savedRecipesButton.classList.toggle("active", open);
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

      const recipeInfo = document.createElement("details");
      recipeInfo.className = "splitsInfo";
      recipeInfo.innerHTML = `
        <summary aria-label="Recipe Setup information" title="Recipe Setup information"><svg class="recipeActionIcon" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11"/><path d="M16 14v8"/><circle cx="16" cy="10.5" r="1" fill="currentColor" stroke="none"/></svg></summary>
        <div class="splitsInfoPanel">
          <p>Resin names are optional. If B and D, or A and E layers are the same, you can copy from one to the other.</p>
          <p><strong>Colored clock</strong> = tracked in the Timeline.</p>
        </div>
      `;
      // Lives at the far right of the action row, separated from Scan/Load
      // Next/Print by margin-left:auto (see .splitsBulkModeBar > .splitsInfo
      // in styles.css) rather than ending the row as a fourth equal action -
      // appending it last here just keeps it after them in DOM/tab order,
      // which is what the auto-margin needs to push it rightward correctly.
      modeBar.appendChild(recipeInfo);

      // Two intentional mobile tiers, built by moving the same real buttons
      // (not rebuilding them) out of modeBar - their click handlers stay
      // exactly as wired above. This replaces the old single fixed 4-column
      // grid, which had no room for Current's extra Load Next button and
      // silently clipped it. Primary keeps the handful of actions worth a
      // direct tap; everything else already has a home in mobileMoreButton's
      // menu, which is where Recipe Setup information also moves to here -
      // it has no separate icon of its own on mobile any more.
      let mobilePrimaryRow = null;
      let mobileSecondaryRow = null;
      let recipeUtilityTabs = null;
      if (compactMobileRecipe){
        mobilePrimaryRow = document.createElement("div");
        mobilePrimaryRow.className = "splitsMobilePrimaryRow";
        mobilePrimaryRow.append(savedRecipesButton, modeButton, rearrangeButton);
        if (!isNextRecipePage()){
          if (loadNextButton){
            loadNextButton.textContent = "Load Next";
            mobilePrimaryRow.append(loadNextButton);
          }
        }else{
          // Scan Recipe is hidden in the desktop action row
          // (.rearrangeDesktopOnly/.recipeScanHideDesktop) everywhere else;
          // here specifically it becomes a real primary mobile action.
          scanRecipeButton.classList.remove("rearrangeDesktopOnly", "recipeScanHideDesktop");
          mobilePrimaryRow.append(scanRecipeButton);
        }

        mobileSecondaryRow = document.createElement("div");
        mobileSecondaryRow.className = "splitsMobileSecondaryRow";
        // Recipe Setup information is Current-only - it already is on
        // desktop (body[data-recipe-page="next"] .splitsInfo{display:none}),
        // since it describes tracking/Timeline behaviour that has no meaning
        // on the plan. Offering a menu entry that opens a hidden panel on
        // Next would be a dead control, so it is omitted there instead.
        if (!isNextRecipePage()){
          const infoMenuButton = document.createElement("button");
          infoMenuButton.type = "button";
          infoMenuButton.textContent = "Recipe info";
          infoMenuButton.addEventListener("click", ()=>{
            mobileMoreButton.open = false;
            recipeInfo.open = true;
          });
          mobileMoreButton.querySelector(".mobileRecipeMoreMenu").appendChild(infoMenuButton);
          mobileSecondaryRow.append(mobileMoreButton, recipeInfo);
        }else{
          mobileSecondaryRow.append(mobileMoreButton);
        }
      }else{
        // Desktop only: Saved recipes / Bulk edit / Rearrange become a
        // second, visually subordinate tab strip beneath the grid, echoing
        // .recipePageTabs above it. Exactly one of their three panels is
        // ever open - that mutual exclusion already lives in each button's
        // own click handler above (savedRecipesButton clears bulk/rearrange,
        // rearrangeButton clears bulk/saved-recipes, modeButton clears
        // saved-recipes) and in each one's own "click again to close"
        // toggle - nothing about when panels open/close changes here, only
        // how the choice between them looks.
        recipeUtilityTabs = document.createElement("div");
        recipeUtilityTabs.className = "recipeUtilityTabs";
        recipeUtilityTabs.setAttribute("role", "tablist");
        recipeUtilityTabs.setAttribute("aria-label", "Recipe utilities");
        savedRecipesButton.classList.remove("secondary");
        savedRecipesButton.classList.add("recipeUtilityTab");
        savedRecipesButton.setAttribute("role", "tab");
        savedRecipesButton.setAttribute("aria-controls", savedRecipesPanel.id);
        modeButton.classList.remove("secondary");
        modeButton.classList.add("recipeUtilityTab");
        modeButton.setAttribute("role", "tab");
        modeButton.setAttribute("aria-controls", toolbar.id);
        recipeUtilityTabs.append(savedRecipesButton, modeButton, rearrangeButton);
      }

      // Percentage problems are not printed here. They are conditions of the
      // recipe, not of this render, so they belong in the notification bell
      // (see attentionFacts.recipe / attentionFacts.nextRecipe) where they
      // resolve on their own - an inline message that appears and disappears
      // moves the whole working surface underneath the operator's hands.
      if (!compactMobileRecipe){
        area.append(recipeUtilityTabs);
        area.append(toolbar);
      }
      area.append(savedRecipesPanel);
      // Scan Recipe / Print Recipe / Load Next Recipe / Info: immediate
      // actions, not panel-opening tabs, so they get their own compact row
      // below the utility tabs/panel instead of living inside
      // .recipeUtilityTabs. modeBar keeps its original flat divided-segment
      // look (.splitsBulkModeBar) - it now just holds four items instead of
      // seven. order:2 (see styles.css) keeps it last regardless of the
      // rearrange bar below being appended after it in the DOM.
      if (!compactMobileRecipe){
        area.append(modeBar);
      }

      if(hopperRearrangement?.active&&!compactMobileRecipe){
        const bar=document.createElement("div");
        bar.className="rearrangeModeBar";
        bar.innerHTML='<div class="rearrangeModeMessage"><strong>Rearrange mode</strong><span>Drag, or tap a hopper then tap another, to move assignments. Hopper 1 is recalculated after each move.</span></div>';
        const actions=document.createElement("div");
        actions.className="rearrangeModeActions";
        const undo=document.createElement("button");
        undo.type="button"; undo.className="secondary"; undo.textContent="Undo Last Move"; undo.disabled=!hopperRearrangement.undo.length;
        const cancel=document.createElement("button");
        cancel.type="button"; cancel.className="secondary"; cancel.textContent="Cancel";
        undo.addEventListener("click",undoRearrangement);
        cancel.addEventListener("click",()=>finishRearrangement(true));
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
      const layerNames = recipeLayers().map(L=>L.name);
      let activeMobileLayer = layerNames.includes(lastActiveMobileLayer) ? lastActiveMobileLayer : (layerNames[0] || "");

      const mobileLayerButtonEls = new Map();
      recipeLayers().forEach(L=>{
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
      table.classList.toggle("compactMobileRecipe", compactMobileRecipe);

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      const corner = document.createElement("th");
      corner.scope = "col";
      corner.className = "splitRowCorner";
      corner.textContent = "Select row";
      headerRow.appendChild(corner);

      recipeLayers().forEach(L=>{
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
          copyButton.textContent = `Match ${copyFrom}`;
          copyButton.setAttribute("aria-label", `Make Layer ${L.name} match Layer ${copyFrom}`);
          copyButton.dataset.mobileCopySource = copyFrom;
          copyButton.title = `Make Layer ${L.name} match Layer ${copyFrom}`;
          copyButton.addEventListener("click",()=>{
            copyLayer(copyFrom, L.name);
            renderSplitsArea();
            validateAndCompute({ sync: true });
            saveSession();
          });
          th.appendChild(copyButton);
        }

        // Always-present running total for this layer's hoppers - live
        // working data, not a validation message. It never appears/
        // disappears (that was the old layout-shift bug); only its colour
        // changes on Current when the total is off. The verbose "why" -
        // which layer, expected 100%, Current vs Next - lives in the
        // notification bell (see attentionFacts.recipe/nextRecipe), not here.
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
          updateLayerMetaDisplays();
          updateHopperTotals();
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
          toggleSelection(recipeLayers().map(L=>`${L.name}:${hi}`));
        });
        rowSelectors.set(hi, rowSelect);
        rowHeader.appendChild(rowSelect);
        tr.appendChild(rowHeader);

        recipeLayers().forEach(L=>{
          const hopper = L.hoppers[hi];
          const key = `${L.name}:${hi}`;
          const td = document.createElement("td");
          td.className = "splitMatrixCell";
          td.dataset.layerColumn = L.name;
          if(hopperRearrangement?.active){
            const destination={layer:L.name,index:hi};
            const label=hopperBadgeLabel(L.name,hi);
            const hasAssignment=()=>!!normName(hopper.resinName)||clampNum(hopper.pct)>0;
            function completeMove(source,result){
              hopperRearrangement.tapSource=null;
              if(!result.ok){
                clearTapSourceHighlight();
                const message=result.reason==="invalid"?"Move rejected: percentages would be invalid.":"No move made.";
                summary.textContent=message;
                updateMobileRearrangePrompt(message);
                return;
              }
              hopperRearrangement.undo.push(result.before);
              hopperRearrangement.lastMoveLabel=`Moved ${hopperBadgeLabel(source.layer,source.index)} → ${label}`;
              hopperRearrangement.undoVisibleUntil=Date.now()+5000;
              renderSplitsArea();
              validateAndCompute();
            }
            function activateCell(){
              const current=hopperRearrangement.tapSource;
              if(current&&current.layer===L.name&&current.index===hi){
                hopperRearrangement.tapSource=null;
                td.classList.remove("rearrangeSource");
                td.setAttribute("aria-pressed","false");
                updateMobileRearrangePrompt();
                return;
              }
              if(!current){
                if(!hasAssignment()) return;
                clearTapSourceHighlight();
                hopperRearrangement.tapSource=destination;
                td.classList.add("rearrangeSource");
                td.setAttribute("aria-pressed","true");
                updateMobileRearrangePrompt();
                return;
              }
              completeMove(current,window.PolynHopperRearrangement.move(recipeLayers(),current,destination));
            }
            td.draggable=!compactMobileRecipe;
            td.tabIndex=0;
            td.classList.add("rearrangeTarget");
            td.setAttribute("role","button");
            td.setAttribute("aria-label",`${label}: select as rearrange source or destination`);
            td.setAttribute("aria-pressed","false");
            td.addEventListener("dragstart",event=>{
              if(!hasAssignment()){event.preventDefault();return;}
              hopperRearrangement.tapSource=null;
              clearTapSourceHighlight();
              hopperRearrangement.drag=destination;
              td.classList.add("rearrangeSource");
              td.setAttribute("aria-pressed","true");
              event.dataTransfer.effectAllowed="move";
            });
            td.addEventListener("dragend",()=>{
              hopperRearrangement.drag=null;
              td.classList.remove("rearrangeSource");
              td.setAttribute("aria-pressed","false");
            });
            td.addEventListener("dragover",event=>{if(hopperRearrangement.drag){event.preventDefault();td.classList.add("rearrangeOver");}});
            td.addEventListener("dragleave",()=>td.classList.remove("rearrangeOver"));
            td.addEventListener("drop",event=>{
              event.preventDefault();
              td.classList.remove("rearrangeOver");
              const source=hopperRearrangement.drag;
              if(source) completeMove(source,window.PolynHopperRearrangement.move(recipeLayers(),source,destination));
            });
            td.addEventListener("click",event=>{
              if(event.target.closest("button,a")) return;
              activateCell();
            });
            td.addEventListener("keydown",event=>{
              if(event.key!=="Enter"&&event.key!==" ") return;
              event.preventDefault();
              activateCell();
            });
          }

          const cellHeader = document.createElement("div");
          cellHeader.className = "splitCellHeader";
          const hopperName = document.createElement("span");
          hopperName.id = hopperNameId(L.name, hi);
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

          // On phone-width Recipe Setup, Smart describes the resin-derived
          // value, so it belongs immediately after the resin name. Desktop
          // keeps the compact control-strip placement above the editor.
          if (!isDesktopLayout()) {
            cellTop.appendChild(smartBadge);
            cellHeader.append(trackControl, clearButton);
          }else{
            cellHeader.append(trackControl, smartBadge, clearButton);
          }
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
          td.addEventListener("click",event=>{
            if(!compactMobileRecipe||!bulkMode||event.target.closest("input,button,label,a,select,textarea")) return;
            selected.has(key) ? selected.delete(key) : selected.add(key);
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
            updateHopperTotals();
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
            updateHopperTotals();
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
      mobileLayerLayout.append(scroll);
      if (!compactMobileRecipe) mobileLayerLayout.append(mobileLayerNav);
      area.appendChild(mobileLayerLayout);
      if (compactMobileRecipe){
        // Keep recipe actions immediately after the matrix, but outside its
        // visual frame. The dense grid stays a single relationship-focused
        // surface while modes expand directly below it.
        const actionTray = document.createElement("div");
        actionTray.className = "mobileRecipeActionTray mobileMatrixActionBar";
        actionTray.append(mobilePrimaryRow, mobileSecondaryRow, mobileBulkContext, mobileRearrangeContext);
        area.append(actionTray);
        if(hopperRearrangement?.active&&hopperRearrangement.undo?.length&&hopperRearrangement.undoVisibleUntil>Date.now()){
          const toast=document.createElement("div");
          toast.className="mobileRearrangeToast";
          toast.setAttribute("role","status");
          toast.innerHTML=`<span>${hopperRearrangement.lastMoveLabel||"Hopper moved"}</span><button type="button">Undo</button>`;
          toast.querySelector("button").addEventListener("click",undoRearrangement);
          area.appendChild(toast);
          setTimeout(()=>toast.remove(),Math.max(0,hopperRearrangement.undoVisibleUntil-Date.now()));
        }
      }

      function showMobileLayer(layerName){
        activeMobileLayer = layerName;
        lastActiveMobileLayer = layerName;
        table.querySelectorAll("[data-layer-column]").forEach(cell=>{
          cell.classList.toggle("mobile-layer-active", compactMobileRecipe || cell.dataset.layerColumn === activeMobileLayer);
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
        const names = recipeLayers().map(L=>L.name);
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
      const mobileChangeResin = toolbar.querySelector("#mobileBulkChangeResin");
      const mobileChangePct = toolbar.querySelector("#mobileBulkChangePct");
      const mobileBulkCount = mobileBulkContext.querySelector(".mobileBulkCount");
      const mobileBulkEditSelected = mobileBulkContext.querySelector(".mobileBulkEditSelected");
      attachResinAutocomplete(bulkNameInput);

      function hasBulkValue(){
        if(compactMobileRecipe){
          return (mobileChangeResin.checked && bulkNameInput.value.trim() !== "")
            || (mobileChangePct.checked && bulkPctInput.value.trim() !== "");
        }
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
          const keys = recipeLayers().map(L=>`${L.name}:${hi}`);
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
        if(compactMobileRecipe){
          const selectedLabel=`${selected.size} selected`;
          mobileBulkCount.textContent=selectedLabel;
          mobileBulkEditSelected.disabled=selected.size===0;
          if(mobileBulkEditSheet){
            mobileBulkEditSheet.querySelector("#mobileBulkEditSubtitle").textContent=`${selectedLabel} · Choose what should change`;
          }
        }
      }

      function setBulkMode(enabled){
        bulkMode = !!enabled;
        splitsBulkModeActive = bulkMode;
        area.classList.toggle("bulk-editing", bulkMode);
        toolbar.classList.toggle("hide", !bulkMode);
        modeButton.textContent = bulkMode ? "Done bulk editing" : "Bulk edit";
        if(compactMobileRecipe){
          modeButton.setAttribute("aria-expanded", String(bulkMode));
          modeBar.hidden=bulkMode||!!hopperRearrangement?.active;
          mobileBulkContext.hidden=!bulkMode;
          mobileRearrangeContext.hidden=!hopperRearrangement?.active;
          updateMobileRearrangePrompt();
          if(!bulkMode&&mobileBulkEditSheet?.open) mobileBulkEditSheet.close("cancel");
        }else{
          modeButton.setAttribute("aria-selected", String(bulkMode));
          modeButton.classList.toggle("active", bulkMode);
        }
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
      exitSplitsBulkModeFn = () => setBulkMode(false);

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

      mobileBulkContext.querySelector(".mobileBulkCancel").addEventListener("click",()=>setBulkMode(false));
      mobileBulkEditSelected.addEventListener("click",()=>{
        if(!bulkMode||selected.size===0||!mobileBulkEditSheet) return;
        mobileBulkEditSheet.showModal();
        requestAnimationFrame(()=>mobileChangeResin.focus());
      });
      mobileRearrangeContext.querySelector(".mobileRearrangeCancel").addEventListener("click",()=>finishRearrangement(true));
      mobileRearrangeContext.querySelector(".mobileRearrangeDone").addEventListener("click",()=>finishRearrangement(false));

      if(compactMobileRecipe){
        [
          [mobileChangeResin,bulkNameInput],
          [mobileChangePct,bulkPctInput]
        ].forEach(([toggle,input])=>{
          input.disabled=!toggle.checked;
          toggle.addEventListener("change",()=>{
            input.disabled=!toggle.checked;
            if(!toggle.checked){
              input.value="";
              input.setCustomValidity("");
              input.setAttribute("aria-invalid","false");
            }else{
              requestAnimationFrame(()=>input.focus());
            }
            toggle.nextElementSibling.textContent=toggle.checked?"Change":"No change";
            updateSelectionUI();
          });
        });
      }

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

        recipeLayers().forEach(L=>{
          L.hoppers.forEach(hopper=>{
            hopper.resinName = "";
            hopper.pct = 0;
            hopper.track = false;
            hopper.pumpOff = false;
          });
        });
        // Wipes every resin assignment on this page, so any scanned lots for
        // it are equally stale - cleared on the same page Reset all just
        // cleared, never the other one.
        if (isNextRecipePage()) state.nextRecipeLots = {}; else state.resinLots = {};
        selected.clear();
        bulkNameInput.value = "";
        bulkPctInput.value = "";
        renderSplitsArea();
        validateAndCompute({ sync: true });
        saveSession();
      });

      applyButton.addEventListener("click",()=>{
        const applyName = bulkNameInput.value.trim() !== "" && (!compactMobileRecipe || mobileChangeResin.checked);
        const applyPct = bulkPctInput.value.trim() !== "" && (!compactMobileRecipe || mobileChangePct.checked);
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
          for (const L of recipeLayers()){
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
          recipeLayers().forEach(L=>{
            recomputeAutoH1(L);
            const h1Input = table.querySelector(`#p_${L.name}_0`);
            if (h1Input) h1Input.value = String(clampNum(L.hoppers[0].pct));
          });
        }

        cellRefs.forEach(ref=>ref.refreshCellState());

        updateHopperTotals();
        validateAndCompute({ sync: true });
        saveSession();

        const changes = [];
        if (applyName) changes.push(`resin “${resinName}”`);
        if (applyPct) changes.push(`${fmtTrim(percentage,3)}% to ${percentageCount} editable hopper${percentageCount === 1 ? "" : "s"}`);
        updateSelectionUI(`Applied ${changes.join(" and ")}.`, "ok");
        if(compactMobileRecipe){
          mobileBulkEditSheet?.close("applied");
          setBulkMode(false);
        }
      });

      // Compact, always-rendered per-layer feedback ("Total 100%"), never
      // hidden - only its colour changes when Current is off. This is the
      // same 0.0001 tolerance and comparison attentionFacts.recipe already
      // uses; it is not a second validation rule, just a second place the
      // same result is shown. An incomplete Next total is never coloured as
      // a fault - a half-finished plan is expected, not an error, matching
      // the notification bell's own tone for it (see nextRecipeEntries).
      function updateHopperTotals(){
        const planning = isNextRecipePage();
        recipeLayers().forEach(L=>{
          const hopperTotal = sum(L.hoppers.map(h=>clampNum(h.pct)));
          const okay = Math.abs(hopperTotal - 100) <= 0.0001;
          const el = table.querySelector(`#hopperTotal_${L.name}`);
          if (!el) return;
          el.classList.toggle("warn", !okay && !planning);
          el.textContent = `Total ${fmtTrim(hopperTotal, 2)}%`;
        });
      }
      updateHopperTotals();

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
          <div class="productionSummaryStatus">
            <strong>Resin totals</strong>
            <span>Production <b class="mono">${fmtLb(prod)}</b> lb <i>·</i> Scrap <b class="mono">${fmtLb(scrap)}</b> lb <i>·</i> Total <b class="mono">${fmtLb(total)}</b> lb</span>
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
        out.innerHTML = `<div class="muted">Add resin names and recipe percentages to see totals here.</div>`;
        return;
      }
      const rows = Array.from(totals.values()).sort((a,b)=>b.lbs - a.lbs);
      out.innerHTML = `<div class="productionSummaryMaterialsIntro"><strong>By material</strong><span>Calculated from the current recipe percentages.</span></div>`;
      rows.forEach(r=>{
        const row = document.createElement("div");
        row.className = "calcRow productionSummaryMaterialRow";
        // Current only - Resin Totals always describes the job
        // actually running, never the plan. Absent entirely (no placeholder
        // element) unless this resin actually has a scanned lot: invisible
        // to anyone who never scanned a heat sheet.
        const lot = state.resinLots?.[keyName(r.displayName)] || "";
        row.innerHTML = `
          <div class="calcLeft">
            <div class="calcName mono" data-resin-name></div>
          </div>
          ${lot ? `<div class="calcLot mono" data-resin-lot></div>` : ""}
          <div class="mono calcValue">${fmtLb(r.lbs)} lb</div>
        `;
        row.querySelector("[data-resin-name]").textContent = r.displayName;
        if (lot) row.querySelector("[data-resin-lot]").textContent = lot;
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
      const badLayers = state.layers
        .map(L=>({ name: L.name, totalPct: sum(L.hoppers.map(h=>clampNum(h.pct))) }))
        .filter(L=>Math.abs(L.totalPct - 100) > 0.0001);
      const layerTotalBad = Math.abs(layerTotal - 100) > 0.0001;
      const errorCount = badLayers.length + (layerTotalBad ? 1 : 0);
      const ready = errorCount === 0 && state.layers.length > 0;
      // Same badLayers the Recipe pill already uses - the attention center
      // reads this result, it does not recompute the rule. The totals travel
      // with the names because the bell is now the only place they are
      // printed; the grid no longer carries an inline copy.
      attentionFacts.recipe.invalidLayers = badLayers;
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
    }
  }

  function validateAndCompute({ sync = false, immediate = false, kind = "edit" } = {}){
      const msgs = [];
      const div = 100;

      if (state.lineRate <= 0) msgs.push({type:"warn", text:"Line rate is 0 — rates/times will be 0."});
      attentionFacts.setup.lineRateSet = state.lineRate > 0;

      const layerFracs = state.layers.map(L => clampNum(L.layerPct)/div);
      const layerSum = sum(layerFracs);
      const layerTotalValid = !state.layers.length || Math.abs(layerSum - 1) <= 0.0001;
      if (!layerTotalValid){
        msgs.push({type:"warn", text:`Layer split sums to ${fmtNum(layerSum*100,2)}% (expected 100%).`});
      }
      attentionFacts.recipe.layerTotalValid = layerTotalValid;
      attentionFacts.recipe.layerTotalPct = layerSum * 100;
      // Planning facts only. They are read here so every existing edit path
      // republishes them, but they are deliberately kept out of msgs, out of
      // the Recipe pill and out of readiness: an unfinished plan never makes
      // the running job unready.
      attentionFacts.nextRecipe = readNextRecipeFacts?.()
        || { planned: false, layerTotalPct: 100, layerTotalValid: true, invalidLayers: [] };

      const allWeightsUnset = state.layers.length > 0 && state.layers.every(L=>
        L.hoppers.every(h=>effectiveHopperWeight(h) === 0)
      );
      if (allWeightsUnset){
        msgs.push({
          type:"warn",
          text:"Receiver hopper weights have not been set. Enter them for accurate run-down timing."
        });
      }

      attentionFacts.setup.hopperWeightsUnset = allWeightsUnset;

      const tracked = [];
      state.layers.forEach(L=>L.hoppers.forEach((h,hi)=>{ if (h.track) tracked.push({L,h,hi}); }));
      attentionFacts.timeline.trackedCount = tracked.length;
      attentionFacts.setup.missingTrackedWeightCount = 0;
      if (tracked.length === 0){
        msgs.push({type:"warn", text:"No hoppers are tracked. Turn on Track for the hopper(s) you want in Results."});
      } else {
        const missingW = tracked.filter(x=>effectiveHopperWeight(x.h) <= 0).length;
        attentionFacts.setup.missingTrackedWeightCount = allWeightsUnset ? 0 : missingW;
        if (missingW > 0 && !allWeightsUnset){
          msgs.push({type:"warn", text:`${missingW} tracked hopper(s) are missing weight. Open “Hopper weights” to enter them.`});
        }
      }

      // Mobile keeps the in-panel heads-up list; desktop hides #statusBox and
      // reads the same conditions through the notification bell instead.
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
      syncNativeTimelineAlarms(flat, changeoverDate);
      updateFooterNext(flat, changeoverDate);
      renderResinCalculator();
      updateCollapsedSummaries();
      publishAttention();
      refreshSmartHopperState();
      lastTimelineFlat = flat;
      lastTimelineChangeoverDate = changeoverDate;
      saveSession();
      if (sync) notifyActiveJobMutation({ immediate, kind });
    }

    // The Timeline clock ticker's only job: make startByText/isLate (and the
    // footer's "in X min"/"pump-off due" wording) advance with real wall-
    // clock time between data changes, without doing anything else
    // validateAndCompute does. Deliberately reuses renderResultsFlat/
    // updateFooterNext - the exact same render path a real data change
    // already goes through - rather than a second presentation path, and
    // deliberately does NOT call saveSession, schedulePumpOffAlerts,
    // syncNativeTimelineAlarms, or notifyActiveJobMutation: the underlying
    // schedule hasn't changed, only how "now" compares to it, so nothing
    // needs rewriting, persisting, or re-broadcasting on a tick.
    function refreshTimelinePresentation(){
      if (!lastTimelineFlat) return;
      const now = new Date();
      const refreshed = lastTimelineFlat.map(item=>{
        if (!item.startByDate) return item;
        const startStatus = formatTimelineStart(item.startByDate, lastTimelineChangeoverDate, now, state.timeFormat);
        return { ...item, startByText: startStatus.text, isLate: startStatus.late };
      });
      renderResultsFlat(refreshed, lastTimelineChangeoverDate);
      updateFooterNext(refreshed, lastTimelineChangeoverDate);
    }

    // Started once at app init (see setup below) - guarded so re-entering/
    // leaving Timeline repeatedly can never stack up duplicate intervals.
    // A plain setInterval is deliberately not cleared while backgrounded:
    // Android/browsers already throttle or fully suspend timers on a
    // stopped Activity/hidden tab on their own, and the appStateChange/
    // visibilitychange listeners below force one immediate, correct
    // refresh the moment the app is actually visible again - the interval
    // resuming on its own cadence after that is enough, nothing needs
    // manual pause/resume bookkeeping.
    function startTimelineTicker(){
      if (timelineTickerStarted) return;
      timelineTickerStarted = true;
      setInterval(refreshTimelinePresentation, 20000);
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
        const hasRate = h.rate > 0 && h.weight > 0;
        const notFeeding = h.rate <= 0 && h.weight > 0;
        const weightChip = h.weight > 0
          ? `<span class="mono resultWeight">${fmtNum(h.weight,1)} lb</span>`
          : `<span class="resultStatusChip badge-warn">Missing weight</span>`;
        const splitWarn = (h.rate <= 0 && h.weight > 0) ? `<span class="resultStatusChip badge-warn">Split?</span>` : "";
        const runSummary = hasRate
          ? `<span><b class="mono">${fmtNum(h.rate,1)} lb/hr</b></span><span><b>Empty in ${h.timeText}</b></span>`
          : `<span class="resultNotFeeding">${notFeeding ? "Not feeding" : "Awaiting data"}</span>`;
        const hasStart = !!(changeoverDate && h.startByDate);
        const timingLabel = hasStart ? "Start" : "Start unavailable";
        const timingValue = hasStart ? h.startByText : "";

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
          </div>

          <div class="resultRun">${runSummary}</div>

          <div class="resultTiming">
            <span class="resultStart"><span class="muted resultTimingLabel">${timingLabel}</span>${timingValue ? `<span class="mono resultTimingValue">${timingValue}</span>` : ""}</span>

            <label class="checkWrap" title="Check when the hopper pump is turned off">
              <input type="checkbox" ${h.pumpOff ? "checked" : ""}>
              Pump off
            </label>
          </div>
        `;

        const resinChip = row.querySelector("[data-resin-chip]");
        resinChip.className = h.resinName ? "pill mono resultResin" : "resultStatusChip badge-warn";
        resinChip.textContent = h.resinName || "No resin";

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
      syncToggleUI("showPumpOffToggle", false);
      state.prodResinLb = 0;
      state.scrapResinLb = 0;
      // Scoped to Current, same as everything else this function resets -
      // Next and its own lot map are untouched, exactly like state.nextRecipe
      // already is.
      state.resinLots = {};

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
      syncChangeoverTimeDisplay();
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
      if (state.mobileTimelineOnly && !isDesktopLayout()){
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
      if (state.mobileRecipeOnly && !isDesktopLayout()){
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
      if (isDesktopLayout()){
        target.open = true;
        if (id === "lineSetupBlock") $("weightsBlock")?.setAttribute("open", "");
      }
      if (!isDesktopLayout()){
        closeFooterMenus();
        document.body.dataset.mobileWorkspace = "panel";
        $("appFooterMain")?.removeAttribute("aria-current");
        if (id === "toolsBlock") document.body.dataset.mobileTools = "home";
        if (!target.open) target.open = true;
      }
      if (persist) saveWorkspacePreference(id);
      if (reveal && !isDesktopLayout()){
        requestAnimationFrame(()=>target.scrollIntoView({ behavior:"smooth", block:"start" }));
      }
    }

    function showMobileWorkspaceHome(){
      if (isDesktopLayout()) return;
      document.body.dataset.mobileWorkspace = "home";
      closeFooterMenus();
      $("appFooterMain")?.setAttribute("aria-current", "page");
      document.querySelectorAll(".workspaceNavButton").forEach(button=>{
        button.classList.remove("active");
        button.removeAttribute("aria-current");
      });
    }

    // Android hardware/gesture Back. The only entry point android-back-
    // button.js calls - everything it needs to decide "was this handled"
    // lives here, reading this module's own real state and calling its own
    // real close/exit functions, never guessing from arbitrary DOM
    // structure. Order matches the requested priority: topmost
    // dialog/sheet, then Bulk Edit, then Rearrange, then Tool->Tools,
    // section->Main. Returns false only when there is truly nothing for
    // Back to do here (caller then minimizes the app). Help has no nested
    // panel state of its own any more - like every other section, an open
    // topic is just an in-place <details>, so Back from Help always goes
    // straight to Main via the section->Main branch below.
    //
    // Deliberately NOT covered here: the small contextual <details>
    // popovers (the Smart Hoppers wrench, Tools index dropdown, Workspace
    // Configuration overflow menu, etc). Each manages its own outside-
    // tap/Escape dismissal independently and there's no shared registry of
    // "currently open small popovers" to hook into without inventing one -
    // that's more than this pass's "smallest possible API" scope. A tap
    // elsewhere already dismisses them, so this is a minor gap, not a
    // trap.
    function handleAndroidBack(){
      const dialog = document.querySelector("dialog[open]");
      if (dialog){ dialog.close(); return true; }

      if (activeFooterSheetName){ window.PolynFooterSheetUI.close(); return true; }

      if (weightsBulkModeActive){ exitWeightsBulkModeFn?.(); return true; }
      if (splitsBulkModeActive){ exitSplitsBulkModeFn?.(); return true; }

      if (hopperRearrangement?.active){ exitRearrangeModeFn?.(); return true; }

      if (!isDesktopLayout() && document.body.dataset.mobileWorkspace === "panel"){
        if (activeWorkspaceId === "toolsBlock" && document.body.dataset.mobileTools === "panel"){
          $("mobileToolsBack")?.click();
          return true;
        }
        showMobileWorkspaceHome();
        return true;
      }

      return false;
    }
    window.handleAndroidBack = handleAndroidBack;

    let activeFooterSheetName = "";
    let activeFooterSheetTrigger = null;

    function footerSheetPairs(){
      return {
        display: [$("appFooterDisplay"), $("displaySheet")],
        account: [$("appFooterAccount"), $("footerAccountMenu")],
        // Two real triggers share this one sheet - the desktop bell
        // (nonmodal popover, see isDesktopNotificationsPopover) and the
        // mobile footer bell (modal sheet, same as Display/Account there).
        // Each trigger's own click handler passes itself as the requested
        // trigger (see openDisplaySheet for the established pattern), so
        // only one needs to be the registered default here.
        notifications: [$("desktopNotificationsToggle"), $("footerNotificationsMenu")]
      };
    }

    function footerSheetFocusable(sheet){
      return Array.from(sheet?.querySelectorAll('button:not([disabled]):not([hidden]),select:not([disabled]),input:not([disabled]),[href],[tabindex]:not([tabindex="-1"])') || [])
        .filter(element=>!element.closest("[hidden]") && element.getClientRects().length > 0);
    }

    function isDesktopAccountPopover(name = activeFooterSheetName){
      return name === "account" && isDesktopLayout();
    }

    function isDesktopNotificationsPopover(name = activeFooterSheetName){
      return name === "notifications" && isDesktopLayout();
    }

    // Status-bar popovers: anchored to their trigger, nonmodal, no backdrop,
    // workspace left interactive. Both Account and Notifications qualify.
    function isDesktopPopover(name = activeFooterSheetName){
      return isDesktopAccountPopover(name) || isDesktopNotificationsPopover(name);
    }

    function desktopPopoverWidth(sheet){
      return sheet?.id === "footerNotificationsMenu" ? 380 : 290;
    }

    function positionDesktopPopover(trigger = activeFooterSheetTrigger, sheet = footerSheetPairs()[activeFooterSheetName]?.[1]){
      if (!trigger || !sheet?.open || !isDesktopPopover()) return;
      const triggerRect = trigger.getBoundingClientRect();
      const viewportMargin = 14;
      const gap = 8;
      const width = Math.min(desktopPopoverWidth(sheet), window.innerWidth - (viewportMargin * 2));
      const height = sheet.getBoundingClientRect().height;
      const left = Math.max(viewportMargin, Math.min(triggerRect.right - width, window.innerWidth - width - viewportMargin));
      const below = triggerRect.bottom + gap;
      const top = below + height <= window.innerHeight - viewportMargin
        ? below
        : Math.max(viewportMargin, triggerRect.top - height - gap);
      sheet.style.left = `${Math.round(left)}px`;
      sheet.style.top = `${Math.round(top)}px`;
      sheet.style.right = "auto";
      sheet.style.bottom = "auto";
    }

    function closeFooterSheets({ returnFocus = true } = {}){
      const focusTarget = activeFooterSheetTrigger;
      focusTarget?.setAttribute("aria-expanded", "false");
      activeFooterSheetName = "";
      activeFooterSheetTrigger = null;
      Object.values(footerSheetPairs()).forEach(([toggle, sheet])=>{
        toggle?.setAttribute("aria-expanded", "false");
        if (sheet?.open) sheet.close();
        if (sheet?.dataset.presentation === "popover"){
          delete sheet.dataset.presentation;
          sheet.style.removeProperty("left");
          sheet.style.removeProperty("top");
          sheet.style.removeProperty("right");
          sheet.style.removeProperty("bottom");
        }
      });
      const backdrop = $("footerSheetBackdrop");
      if (backdrop) backdrop.hidden = true;
      const main = document.querySelector("body > main");
      if (main) main.inert = false;
      if (returnFocus && focusTarget) requestAnimationFrame(()=>focusTarget.focus());
    }

    function setFooterSheetOpen(name, open, requestedTrigger){
      const pairs = footerSheetPairs();
      const pair = pairs[name];
      if (!pair) { closeFooterSheets(); return; }
      const [defaultTrigger, sheet] = pair;
      const trigger = requestedTrigger || defaultTrigger;
      const alreadyOpen = activeFooterSheetName === name && !!sheet?.open;
      if (!open || alreadyOpen){ closeFooterSheets(); return; }

      closeFooterSheets({ returnFocus:false });
      activeFooterSheetName = name;
      activeFooterSheetTrigger = trigger;
      Object.entries(pairs).forEach(([key, pairValue])=>{
        const [toggle] = pairValue;
        toggle?.setAttribute("aria-expanded", String(key === name));
      });
      trigger?.setAttribute("aria-expanded", "true");
      const nonmodalPopover = isDesktopAccountPopover(name) || isDesktopNotificationsPopover(name);
      if (sheet){
        sheet.setAttribute("aria-modal", String(!nonmodalPopover));
        if (nonmodalPopover) sheet.dataset.presentation = "popover";
        else delete sheet.dataset.presentation;
      }
      // show(), rather than showModal(), keeps the persistent footer operable
      // so the active control can toggle its sheet and sibling controls can
      // replace it. Focus trapping and the backdrop are managed below.
      if (sheet?.show) sheet.show();
      else if (sheet) sheet.open = true;
      const backdrop = $("footerSheetBackdrop");
      if (backdrop) backdrop.hidden = nonmodalPopover;
      const main = document.querySelector("body > main");
      if (main) main.inert = !nonmodalPopover;
      requestAnimationFrame(()=>{
        if (nonmodalPopover) positionDesktopPopover(trigger, sheet);
        const first = footerSheetFocusable(sheet)[0];
        (first || sheet)?.focus();
      });
    }

    function closeFooterMenus(options){
      closeFooterSheets(options);
    }

    function openDisplaySheet(event){
      event?.stopPropagation?.();
      const trigger = event?.currentTarget || $("appFooterDisplay");
      setFooterSheetOpen("display", true, trigger);
    }

    window.PolynFooterSheetUI = { close:()=>closeFooterSheets({ returnFocus:false }) };

    /* ============================
     * Responsive layout mode
     *
     * renderWeightsArea() and renderSplitsArea() do not merely restyle at a
     * breakpoint - they build structurally different DOM on each side of it
     * (renderMobileWeightsArea vs the desktop matrix; compactMobileRecipe
     * vs the full recipe grid). Nothing re-ran them when the viewport
     * crossed a boundary, so after a resize the markup still belonged to
     * the previous mode. That is the whole reason Receiver Weights broke on
     * repeated resizes and why reloading "fixed" it: the reload simply
     * re-ran the renderers under the new breakpoint. On a foldable there is
     * no reload, so the stale layout was permanent.
     *
     * These matchMedia lists are the single source of truth, created once
     * and listened to once (no duplicate listeners can accumulate, and no
     * per-pixel resize handler is involved). Re-rendering happens only when
     * a mode boundary is actually crossed, so ordinary resizes - and typing
     * - are never interrupted.
     * ============================ */
    const layoutModeQueries = Object.freeze({
      // Kept identical to the width breakpoints the stylesheet already
      // uses, so CSS and JS can never disagree about which mode is active.
      // "and (pointer: fine)" is what actually fixes the >900px foldable
      // case: width alone used to be sufficient for desktop, which is
      // exactly why an unfolded/rotated Fold - wide, but touch, and so
      // reporting a coarse primary pointer - was misclassified as desktop.
      // A mouse always reports "fine", so an ordinary desktop is completely
      // unaffected by this condition.
      desktop: window.matchMedia("(min-width: 901px) and (pointer: fine)"),
      compactRecipe: window.matchMedia("(max-width: 700px)"),
      // Tablet/large-touch: >700px with a coarse primary pointer, and
      // deliberately no upper width bound - an unfolded foldable rotated to
      // its wider orientation must stay tablet rather than falling through
      // to desktop just because it crossed 900px. A laptop touchscreen
      // still reports "fine" for its primary pointer, so this cannot
      // misfire on desktop either. The string is kept identical to the
      // stylesheet's tablet tier so CSS and JS cannot drift apart.
      tablet: window.matchMedia("(min-width: 701px) and (pointer: coarse)")
    });

    function currentLayoutMode(){
      if (layoutModeQueries.desktop.matches) return "desktop";
      return layoutModeQueries.tablet.matches ? "tablet" : "phone";
    }

    // Single source of truth for the desktop/touch-shell split that most of
    // the app's layout branches only ever needed as a binary choice (which
    // is also exactly what the stylesheet's own desktop-shell media query
    // now tests). Every one of those branches used to re-derive the
    // boundary itself via its own fresh call to the width-only desktop
    // media query, with no pointer condition - stale as of the tablet fix,
    // and each one a place CSS and JS could silently disagree about
    // whether a wide, coarse-pointer foldable was "desktop". They now all
    // read this one function instead, which reads the one query object
    // every other mode decision in the app already reads.
    function isDesktopLayout(){
      return layoutModeQueries.desktop.matches;
    }

    // What the DOM was last *built* for, as opposed to what the viewport
    // currently is. Only a difference between the two forces a re-render.
    let renderedLayoutMode = null;
    let renderedCompactRecipe = null;

    function syncLayoutMode({ rerender = true } = {}){
      const mode = currentLayoutMode();
      const compactRecipe = layoutModeQueries.compactRecipe.matches;
      // Exposed for CSS so tablet rules can key off one attribute rather
      // than repeating the pointer test, and so the mode is inspectable.
      document.body.dataset.layoutMode = mode;
      const changed = mode !== renderedLayoutMode || compactRecipe !== renderedCompactRecipe;
      renderedLayoutMode = mode;
      renderedCompactRecipe = compactRecipe;
      if (!changed || !rerender) return changed;
      // Rebuild exactly the surfaces whose markup depends on the boundary
      // that just moved. Both renderers read live state, so this restores
      // the correct structure without touching any stored values.
      applySurfaceStyle(state.surfaceStyle);
      renderWeightsArea();
      renderSplitsArea();
      validateAndCompute();
      return changed;
    }

    function watchLayoutMode(){
      const onChange = ()=> syncLayoutMode();
      Object.values(layoutModeQueries).forEach(query=>{
        // addEventListener is the modern form; addListener is the fallback
        // for older WebViews. Registered once per query, at wire-up time.
        if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
        else if (typeof query.addListener === "function") query.addListener(onChange);
      });
    }

    function syncWorkspaceForViewport(){
      const desktop = layoutModeQueries.desktop.matches;
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
      syncDerivedHopperNaming(lineSync?.getState?.(), { rerender:false });
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
          if (isDesktopLayout()) return;
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
    const tileEl = document.getElementById("workspaceTimelineStatus");

    const setNextStatus = (message, detail, { stale=false, tile=message, tileState="info" } = {})=>{
      if (msgEl) msgEl.textContent = message;
      if (subEl) subEl.textContent = detail;
      if (desktopMsgEl) desktopMsgEl.textContent = message;
      if (desktopSubEl) desktopSubEl.textContent = detail;
      if (tileEl){
        tileEl.textContent = tile;
        tileEl.closest(".workspaceNavButton")?.setAttribute("data-status", tileState);
      }
      if (msgEl) msgEl.classList.toggle("stale", stale);
      if (desktopMsgEl) desktopMsgEl.classList.toggle("stale", stale);
    };

    if (!flat || flat.length === 0){
      setNextStatus("No tracked hoppers", "Track a resin to see the next action", { tileState:"neutral" });
      return;
    }

    const changeoverStale = !!changeoverDate && isChangeoverStale(state.changeoverSetAt);
    if (changeoverStale){
      setNextStatus(
        "Changeover time may be outdated",
        `Last set ${fmtAgo(state.changeoverSetAt)} — update it to see accurate pump-off timing`,
        { stale: true, tile:"Update changeover time", tileState:"warn" }
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
        const minutesUntil = Math.ceil((next.startByDate.getTime() - Date.now()) / 60000);
        const tile = minutesUntil <= 0
          ? `${next.hopperLabel} pump-off due`
          : (minutesUntil < 60
            ? `Next: ${next.hopperLabel} in ${minutesUntil} min`
            : `Next: ${next.hopperLabel} at ${fmtTime(next.startByDate)}`);
        setNextStatus(
          `Next pump off: ${next.hopperLabel}${next.resinName ? ` • ${next.resinName}` : ""}`,
          `${next.startByText} • Changeover ${fmtTime(changeoverDate)}`,
          { tile, tileState:minutesUntil <= 0 ? "warn" : "info" }
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
      const minutes = Math.max(0, Math.ceil(next.minutesToEmpty));
      setNextStatus(
        `Soonest empty: ${next.hopperLabel}${next.resinName ? ` • ${next.resinName}` : ""}`,
        next.timeText,
        { tile:minutes < 60 ? `Next: ${next.hopperLabel} in ${minutes} min` : `Next: ${next.hopperLabel} in ${Math.ceil(minutes / 60)} hr` }
      );
    } else {
      setNextStatus(
        "No upcoming hoppers",
        "All tracked hoppers are checked off or missing data",
        { tile:"Tracked data unavailable", tileState:"warn" }
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
    const bulkDensityEl = $("resinLookupBulkDensity");
    const informationEl = $("resinLookupInformation");
    if (!descriptionEl || !densityEl || !bulkDensityEl || !informationEl || !resinLookup) return;
    const result = resinLookup.formatResinResult(resin);
    descriptionEl.value = result.description;
    densityEl.value = result.density;
    bulkDensityEl.value = result.bulkDensity;
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

  function updateLineSyncJoinAvailability(syncState = lineSync?.getState?.() || {}){
    const join = $("lineSyncJoinBtn");
    const code = $("lineSyncJoinCode")?.value || "";
    if (join) join.disabled = lineSyncActionInFlight || !syncState.available || !/^[A-Z0-9]{4}$/.test(code.trim());
  }

  function setLineSyncActionBusy(busy, action = ""){
    lineSyncActionInFlight = busy;
    lineSyncBusyAction = busy ? action : "";
    const panel = document.querySelector(".lineSyncPanel");
    panel?.classList.toggle("syncActionBusy", busy);
    panel?.setAttribute("aria-busy", String(busy));
    const refreshLabel = $("lineSyncRetryMobileLabel");
    if (refreshLabel) refreshLabel.textContent = busy && action === "refresh" ? "Refreshing…" : "Refresh now";
    const join = $("lineSyncJoinBtn");
    if (join) join.textContent = busy && action === "join" ? "Joining…" : "Join RT Sync";
    const refresh = $("lineSyncRetryBtn");
    if (refresh) refresh.disabled = busy;
    updateLineSyncJoinAvailability();
  }

  function formatLineSyncTimestamp(value){
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    const sameDate = date.toDateString() === today.toDateString();
    const time = date.toLocaleTimeString([], state.timeFormat === "24"
      ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { hour: "numeric", minute: "2-digit", hour12: true });
    return sameDate ? time : `${date.toLocaleDateString([], { month:"short", day:"numeric" })}, ${time}`;
  }

  function renderMobileLineSyncStatus(syncState, override = null){
    const host = $("mobileLineSyncStatus");
    if (!host) return;
    const status = override?.status || syncState.status || "Local only";
    const connected = !!syncState.connected;
    const pending = Number(syncState.pendingCount || 0);
    const message = override?.message || syncState.message || "";
    const lastSync = formatLineSyncTimestamp(syncState.lastSyncAt);
    let state = "local-only";
    let title = "Not connected";
    let detail = "This device is using local data only.";
    let eventNote = "";
    let last = lastSync ? `Last connected sync: ${lastSync}` : "No sync history";
    let pendingText = pending ? "Local changes are not syncing" : "No pending local changes";

    if (status === "Error"){
      state = "error";
      title = "Error";
      detail = message || "RT Sync needs attention.";
      pendingText = pending ? `${pending} pending change${pending === 1 ? "" : "s"}` : "No pending changes";
    } else if (connected && status === "Synced" && !pending){
      state = "synced";
      title = "Synced";
      detail = "Saved line settings are synced";
      last = lastSync ? `Last sync ${lastSync}` : "No sync recorded yet";
      pendingText = "No pending changes";
    } else if (connected && status === "Syncing"){
      state = "connecting";
      title = "Refreshing";
      detail = message || "Checking saved line settings…";
      last = lastSync ? `Last sync ${lastSync}` : "No sync recorded yet";
      pendingText = pending ? `${pending} pending change${pending === 1 ? "" : "s"}` : "No pending changes";
    } else if (connected && status === "Pending"){
      state = "pending";
      title = "Pending changes";
      detail = message || "Local changes are waiting to sync.";
      last = lastSync ? `Last sync ${lastSync}` : "No sync recorded yet";
      pendingText = `${pending || 1} pending change${pending === 1 ? "" : "s"}`;
    } else if (connected && status === "Offline"){
      state = "offline";
      title = "Offline";
      detail = message || "RT Sync will resume when this device reconnects.";
      last = lastSync ? `Last sync ${lastSync}` : "No sync recorded yet";
      pendingText = pending ? `${pending} pending change${pending === 1 ? "" : "s"}` : "No pending changes";
    } else if (connected && status === "Conflict"){
      state = "conflict";
      title = "Sync conflict";
      detail = message || "Shared changes need attention.";
      last = lastSync ? `Last sync ${lastSync}` : "No sync recorded yet";
      pendingText = pending ? `${pending} pending change${pending === 1 ? "" : "s"}` : "No pending changes";
    } else if (/left RT Sync/i.test(message)){
      eventNote = "Local Resin.Tools data was preserved.";
    }

    host.dataset.state = state;
    $("mobileLineSyncState").textContent = title;
    $("mobileLineSyncDetail").textContent = detail;
    const event = $("mobileLineSyncEvent");
    if (event){ event.hidden = !eventNote; event.textContent = eventNote; }
    $("mobileLineSyncLastSync").textContent = last;
    $("mobileLineSyncPending").textContent = pendingText;
  }

  async function runLineSyncAction(action, actionName = ""){
    if (lineSyncActionInFlight) return;
    setLineSyncActionBusy(true, actionName);
    try{ await action(); }
    catch(error){
      const message = lineSyncErrorMessage(error);
      const target = $("lineSyncMessage");
      if (target) target.textContent = message;
      renderMobileLineSyncStatus(lineSync?.getState?.() || {}, { status:"Error", message });
      showStorageWarning(`RT Sync: ${message}`);
    } finally {
      setLineSyncActionBusy(false);
    }
  }

  const ACTIVE_JOB_PENDING_LABELS = {
    edit: "Production changes",
    "apply-recipe-scan": "Recipe scan applied",
    "load-next-recipe": "Next Recipe loaded",
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
    renderMobileLineSyncStatus(syncState);
    renderPendingList(syncState.pendingSummary);
    // cloud-sync already decides what condition it is in; the attention
    // center only reads that decision. oldestPendingAt lets it separate an
    // ordinary brief "Pending" upload from one that has visibly stalled.
    attentionFacts.sync = {
      enabled: !!syncState.enabled,
      connected: !!syncState.connected,
      status,
      pendingCount: syncState.pendingCount || 0,
      message: syncState.message || "",
      oldestPendingAt: (syncState.pendingSummary || [])
        .map(item=>item.createdAt)
        .filter(Boolean)
        .sort()[0] || ""
    };
    publishAttention();
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
    syncDerivedHopperNaming(syncState);
    // Same workspace identity, same lifecycle: connection established,
    // startup from persisted membership, workspace switch, restored session,
    // or metadata that only arrives after the first render all reach this.
    syncDerivedLayerCount(syncState);
    const role = selected?.membership?.role || "";
    const owner = role === "owner";
    const connected = !!syncState.connected;
    ["lineSyncRenameBtn", "lineSyncGenerateCodeBtn", "lineSyncNewJobBtn", "lineSyncDisconnectBtn"].forEach(id=>{
      if ($(id)) $(id).disabled = lineSyncActionInFlight || !selected || !connected;
    });
    if ($("lineSyncLeaveBtn")) $("lineSyncLeaveBtn").disabled = lineSyncActionInFlight || !selected || !syncState.available || owner;
    if ($("lineSyncRetryBtn")) $("lineSyncRetryBtn").disabled = lineSyncActionInFlight;
    if ($("lineSyncRetryDesktopLabel")) $("lineSyncRetryDesktopLabel").textContent = selected && !connected ? "Reconnect" : "Connect / retry";
    const joinPanel = document.querySelector(".lineSyncJoin");
    if (joinPanel) joinPanel.classList.toggle("mobileJoinVisible", !selected);
    const syncPanel = document.querySelector(".lineSyncPanel");
    if (syncPanel){
      syncPanel.classList.toggle("mobileHasLine", !!selected);
      syncPanel.classList.toggle("mobileHasWorkspaces", syncState.workspaces.length > 0);
      syncPanel.classList.toggle("mobileConnected", connected);
    }
    updateLineSyncJoinAvailability(syncState);

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

    // Native Timeline alarms are seeded by workspace id (see
    // syncNativeTimelineAlarms), so a workspace switch, leave, or a bare
    // disconnect (which leaves selectedWorkspaceId unchanged and only flips
    // `connected`) must all resync pending notifications - otherwise a
    // previous workspace's alarms could keep firing after leaving it.
    const connectedChanged = lastLineSyncConnectedState !== null && lastLineSyncConnectedState !== connected;
    lastLineSyncConnectedState = connected;
    if ((workspaceChanged || connectedChanged) && lastTimelineFlat){
      syncNativeTimelineAlarms(lastTimelineFlat, lastTimelineChangeoverDate);
    }
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
    // Cleared alongside the recipe it described. payload.nextRecipe (and so
    // nextRecipeLots) is deliberately left as-is here, same established
    // choice - an operator may have prepped Next for this very job before
    // starting it.
    payload.resinLots = {};
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
    ), "join"));
    // Link codes are case-insensitive (joinWorkspace uppercases before the
    // RPC call), but mobile keyboards default to lowercase entry despite
    // autocapitalize="characters" - some keyboards ignore it or the operator
    // switches off autocorrect. Force the displayed value to uppercase as
    // they type so what's on screen always matches the printed/shared code.
    $("lineSyncJoinCode")?.addEventListener("input",event=>{
      const upper = event.target.value.toUpperCase();
      if (event.target.value !== upper) event.target.value = upper;
      updateLineSyncJoinAvailability();
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
    , "refresh"));
    // Same reconnect/refresh action as lineSyncRetryBtn above, reachable
    // from the mobile footer without opening the RT Sync panel - tapping it
    // reconciles the selected line (flushing any unsynced change) or
    // retries the connection if nothing is selected yet.
    $("cloudSyncFooterStatus")?.addEventListener("click",()=>runLineSyncAction(()=>
      lineSync.getState().selectedWorkspaceId
        ? lineSync.refreshSelected()
        : lineSync.retry()
    , "refresh"));
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
      getHopperNamingMode: () => derivedHopperNamingMode(),
      // Physical facts about the connected line - currently the layer
      // orientation the Job Traveler and Heat Sheet scanners need. Same
      // resolver the Line Setup Overview renders from, so there is no second
      // copy of the layer-order rules anywhere in the scan path.
      getLineConfiguration: () => derivedLineConfiguration(),
      // Which recipe page the review screen is about to write to. The scan
      // itself stays destination-neutral; only the confirmation names a target.
      getRecipePageLabel: () => recipePageLabel(),
      hasNonEmptyRecipe,
      applyPayload: applyScannedRecipePayload
    };
  }

    // Wire inputs
    document.querySelectorAll(".gaugeTile").forEach(tile=>{
      tile.addEventListener("click",event=>{
        if(event.target.matches("input")) return;
        tile.querySelector("input")?.focus();
      });
    });
    $("lineRate")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Line rate" }, value => { state.lineRate = value; })) return;
      validateAndCompute({ sync: true });
      saveSession();
    });
    $("changeoverTime")?.addEventListener("input",(e)=>{
      state.changeoverTime = e.target.value || "";
      state.changeoverSetAt = state.changeoverTime ? Date.now() : null;
      syncChangeoverTimeDisplay();
      validateAndCompute({ sync: true });
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
      // Notification permission is requested here, and only here - the
      // operator's own explicit action of turning this on - never
      // automatically at app launch. A denial doesn't undo the toggle: the
      // in-app sound/vibration/banner alarm above still works while Resin
      // Tools is open, only background notifications need this permission.
      if (enabled) await requestNativeTimelineAlarmPermission();
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
      if (!isDesktopLayout()) document.body.dataset.mobileTools = "panel";
    }
    document.querySelectorAll(".mobileToolTile").forEach(tile=>{
      tile.addEventListener("click",()=>selectToolPanel(tile.dataset.mobileToolTarget));
    });
    $("mobileToolsBack")?.addEventListener("click",()=>{ document.body.dataset.mobileTools = "home"; });
    $("appFooterMain")?.addEventListener("click",showMobileWorkspaceHome);
    $("appFooterDisplay")?.addEventListener("click",openDisplaySheet);
    const desktopUtilityMedia = layoutModeQueries.desktop;
    const placeAccountUtility = ()=>{
      const accountHost = document.querySelector(".footerAccountHost");
      const accountMenu = $("footerAccountMenu");
      const overlayRoot = $("appOverlayRoot");
      const desktopCluster = $("desktopUtilityCluster");
      const footer = document.querySelector(".footerBar");
      const syncControl = $("cloudSyncFooterStatus");
      if (!accountHost || !desktopCluster || !footer) return;
      if (desktopUtilityMedia.matches){
        if (accountHost.parentElement !== desktopCluster) desktopCluster.append(accountHost);
        if (accountMenu && overlayRoot && accountMenu.parentElement !== overlayRoot) overlayRoot.append(accountMenu);
      }else if (accountHost.parentElement !== footer){
        footer.insertBefore(accountHost, syncControl || null);
        if (accountMenu && accountMenu.parentElement !== accountHost) accountHost.append(accountMenu);
      }else if (accountMenu && accountMenu.parentElement !== accountHost){
        accountHost.append(accountMenu);
      }
    };
    placeAccountUtility();
    desktopUtilityMedia.addEventListener?.("change",()=>{
      closeFooterSheets({ returnFocus:false });
      placeAccountUtility();
      applySurfaceStyle(state.surfaceStyle);
    });
    $("desktopDisplayToggle")?.addEventListener("click",openDisplaySheet);

    /* ------------------------------------------------------------------
     *   Desktop notification center
     * ------------------------------------------------------------------
     * Presentation and navigation only. Every entry rendered here comes from
     * PolynAttentionCenter.derive(attentionFacts), which is a pure function
     * of state the application already validated - so an item disappears the
     * moment its condition clears, re-rendering can never duplicate one, and
     * closing the popover never dismisses anything unresolved. */
    function setupAttentionCenter(){
      const toggle = $("desktopNotificationsToggle");
      const badge = $("desktopNotificationsBadge");
      // The mobile footer bell - same dialog/list/data source as the
      // desktop toggle above (see the shared "notifications" footer sheet),
      // just a second real trigger element that needs its own
      // severity/badge/label kept in sync.
      const mobileToggle = $("appFooterNotifications");
      const mobileBadge = $("mobileNotificationsBadge");
      const announcer = $("desktopNotificationsAnnouncer");
      const list = $("desktopNotificationsList");
      const summaryLine = $("desktopNotificationsSummary");
      const attention = window.PolynAttentionCenter;
      if (!toggle || !list || !attention) return;

      let knownIds = null;
      let announcedKey = "";
      let emphasisTimer = 0;

      // Resolved inside the frame after setWorkspacePanel, because which
      // controls are actually rendered and visible depends on the panel that
      // was just revealed. A control that is hidden, zero-sized or disabled
      // is skipped rather than silently swallowing the focus.
      function focusSoon(resolve){
        requestAnimationFrame(()=>{
          const element = typeof resolve === "function" ? resolve() : resolve;
          if (!usableControl(element)) return;
          try{ element.focus(); }catch(error){ /* control went away */ }
        });
      }
      function usableControl(element){
        return !!element && !element.disabled && element.getClientRects().length > 0;
      }
      // Prefer the control the operator actually has to correct: the field
      // contextual validation already flagged with aria-invalid, then the
      // control that owns this particular condition, then the first usable
      // field in the section. The bell reuses the existing aria-invalid
      // marker rather than keeping its own idea of which field is wrong.
      function responsibleControl(hostId, preferred){
        const host = $(hostId);
        if (!host) return null;
        const find = selector => Array.from(host.querySelectorAll(selector)).find(usableControl) || null;
        return find('[aria-invalid="true"]')
          || (preferred ? find(preferred) : null)
          || find("input:not([type=checkbox]):not([type=radio]), select");
      }

      const ATTENTION_ACTIONS = {
        "review-setup": ()=>{
          setWorkspacePanel("lineSetupBlock", { reveal:true });
          focusSoon(()=>$("lineRate"));
        },
        // On desktop the weight fields are only rendered in the matrix's Edit
        // view, so when they are hidden the responsible control is the Edit
        // toggle that reveals them.
        "open-weights": ()=>{
          setWorkspacePanel("lineSetupBlock", { reveal:true });
          focusSoon(()=>responsibleControl("weightsArea", '[data-weight-view="edit"]'));
        },
        "open-recipe": ()=>{
          setWorkspacePanel("splitsBlock", { reveal:true });
          setRecipePage("current");
          focusSoon(()=>responsibleControl("splitsArea", 'input[id^="lp_"], input.splitInput'));
        },
        // Reuses the tab strip's own page switch, so arriving from the bell
        // leaves the editor in exactly the state clicking "Next" would.
        "open-next-recipe": ()=>{
          setWorkspacePanel("splitsBlock", { reveal:true });
          setRecipePage("next");
          focusSoon(()=>responsibleControl("splitsArea", 'input[id^="lp_"], input.splitInput'));
        },
        // Reuses the existing Reconnect control rather than adding a second
        // retry path, so RT Sync keeps exactly one recovery implementation.
        "retry-sync": ()=>{
          setWorkspacePanel("lineSyncBlock", { reveal:true });
          const retry = $("lineSyncRetryBtn");
          if (retry && !retry.disabled) retry.click();
          focusSoon(()=>retry);
        }
      };

      function severityIcon(severity){
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("class", "desktopNotificationIcon");
        // Distinct outlines, not just distinct colors: a triangle for
        // attention, an octagon for a blocking error.
        const outline = severity === "error"
          ? "M8.6 3h6.8L21 8.6v6.8L15.4 21H8.6L3 15.4V8.6L8.6 3Z"
          : "M12 3.6 21.2 20H2.8L12 3.6Z";
        [outline, "M12 9v4.6", "M12 16.6v.01"].forEach(d=>{
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute("d", d);
          svg.appendChild(path);
        });
        return svg;
      }

      function renderList(summary){
        list.replaceChildren();
        if (!summary.count){
          const empty = document.createElement("p");
          empty.className = "desktopNotificationsEmpty";
          empty.textContent = "Nothing needs attention right now.";
          list.append(empty);
          return;
        }
        summary.items.forEach(item=>{
          const row = document.createElement("div");
          row.className = "desktopNotificationItem";
          row.dataset.severity = item.severity;
          row.setAttribute("role", "listitem");

          const body = document.createElement("div");
          body.className = "desktopNotificationBody";

          const head = document.createElement("div");
          head.className = "desktopNotificationHeadRow";
          const title = document.createElement("strong");
          title.textContent = item.title;
          const tag = document.createElement("span");
          tag.className = "desktopNotificationSeverityTag";
          tag.textContent = item.severityLabel;
          head.append(title, tag);
          body.append(head);

          if (item.message){
            const message = document.createElement("p");
            message.className = "desktopNotificationMessage";
            message.textContent = item.message;
            body.append(message);
          }

          const foot = document.createElement("div");
          foot.className = "desktopNotificationFoot";
          const section = document.createElement("span");
          section.className = "desktopNotificationSection";
          section.textContent = item.section;
          foot.append(section);
          const handler = item.action ? ATTENTION_ACTIONS[item.action.id] : null;
          if (handler){
            const action = document.createElement("button");
            action.type = "button";
            action.className = "desktopNotificationAction";
            action.textContent = item.action.label;
            action.addEventListener("click",()=>{
              closeFooterSheets({ returnFocus:false });
              handler();
            });
            foot.append(action);
          }
          body.append(foot);

          row.append(severityIcon(item.severity), body);
          list.append(row);
        });
      }

      function summaryText(summary){
        if (!summary.count) return "Nothing needs attention";
        const parts = [];
        if (summary.errorCount) parts.push(`${summary.errorCount} blocking`);
        if (summary.warningCount) parts.push(`${summary.warningCount} needing attention`);
        return parts.join(" · ");
      }

      renderAttentionCenter = facts=>{
        const summary = attention.derive(facts);
        const ids = summary.items.map(item=>item.id);
        const label = attention.badgeLabel(summary);

        toggle.dataset.severity = summary.severity;
        toggle.setAttribute("aria-label", label);
        toggle.title = summary.count ? label : "Notifications";
        if (badge){
          badge.hidden = summary.count === 0;
          badge.textContent = summary.count ? String(summary.count) : "";
          badge.dataset.severity = summary.severity;
        }
        // Mobile footer bell mirrors the desktop toggle exactly - same
        // severity/label/badge, driven by the same summary, so the two
        // never drift into showing different counts.
        if (mobileToggle){
          mobileToggle.dataset.severity = summary.severity;
          mobileToggle.setAttribute("aria-label", label);
        }
        if (mobileBadge){
          mobileBadge.hidden = summary.count === 0;
          mobileBadge.textContent = summary.count ? String(summary.count) : "";
          mobileBadge.dataset.severity = summary.severity;
        }
        if (summaryLine) summaryLine.textContent = summaryText(summary);
        renderList(summary);

        // A genuinely new condition gets one short emphasis, never a
        // continuous pulse - and only for an id that was not already present,
        // so re-renders, clock ticks and sync refreshes stay silent. The
        // first render is the operator arriving at conditions that already
        // existed, so it never emphasizes.
        const introduced = knownIds !== null && ids.some(id=>!knownIds.has(id));
        knownIds = new Set(ids);
        if (introduced){
          clearTimeout(emphasisTimer);
          toggle.dataset.attentionNew = "true";
          emphasisTimer = setTimeout(()=>{ delete toggle.dataset.attentionNew; }, 1400);
          if (mobileToggle){
            mobileToggle.dataset.attentionNew = "true";
            setTimeout(()=>{ delete mobileToggle.dataset.attentionNew; }, 1400);
          }
        }
        // Announce only when the set of conditions changes, so a polite live
        // region never repeats itself on every render.
        const key = ids.join("|");
        if (announcer && key !== announcedKey){
          announcedKey = key;
          announcer.textContent = label;
        }
      };

      toggle.addEventListener("click",event=>{
        event.stopPropagation();
        setFooterSheetOpen("notifications", true, event.currentTarget);
      });
      mobileToggle?.addEventListener("click",event=>{
        event.stopPropagation();
        setFooterSheetOpen("notifications", true, event.currentTarget);
      });

      publishAttention();
    }
    setupAttentionCenter();

    $("appFooterAccount")?.addEventListener("click",event=>{
      event.stopPropagation();
      const login = $("adminLoginButton");
      if (login && !login.hidden){
        closeFooterSheets({ returnFocus:false });
        login.click();
        return;
      }
      setFooterSheetOpen("account", true, event.currentTarget);
    });
    $("footerSheetBackdrop")?.addEventListener("click",()=>closeFooterSheets());
    document.addEventListener("pointerdown",event=>{
      if (!isDesktopPopover()) return;
      const [trigger, sheet] = footerSheetPairs()[activeFooterSheetName] || [];
      const anchor = activeFooterSheetTrigger || trigger;
      if (sheet?.contains(event.target) || anchor?.contains(event.target)) return;
      // pointerdown lands before focus moves, so returning focus here would
      // yank it back out of whatever the operator just clicked. Keyboard
      // dismissal (Escape, below) still restores focus to the trigger.
      closeFooterSheets({ returnFocus:false });
    });
    window.addEventListener("resize",()=>{
      if (isDesktopPopover()) positionDesktopPopover();
    });
    $("adminSignOutButton")?.addEventListener("click",()=>closeFooterSheets({ returnFocus:false }));
    document.querySelectorAll(".footerAdminDestination").forEach(button=>{
      button.addEventListener("click",()=>{
        if (button.dataset.adminOnly === "true" && (button.hidden || button.disabled)) return;
        closeFooterMenus();
        setWorkspacePanel(button.dataset.workspaceTarget, { reveal:true });
      });
    });
    document.addEventListener("keydown",event=>{
      if (!activeFooterSheetName) return;
      if (event.key === "Escape"){
        event.preventDefault();
        closeFooterSheets();
        return;
      }
      if (event.key === "Tab"){
        if (isDesktopPopover()) return;
        const sheet = footerSheetPairs()[activeFooterSheetName]?.[1];
        const focusable = footerSheetFocusable(sheet);
        if (!focusable.length){ event.preventDefault(); sheet?.focus(); return; }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first){ event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last){ event.preventDefault(); first.focus(); }
      }
    });
    // In-body "see also" links (e.g. Quick Start pointing at RT Sync) just
    // open the target <details> - same on every viewport now that mobile
    // shows the identical accordion list as desktop. The accordion's own
    // "toggle" listener below (helpTopics.forEach) reacts to this the same
    // way it reacts to a direct tap: closes sibling topics and scrolls the
    // opened one into view.
    document.querySelectorAll("#helpBlock .helpTopicBody a.helpTopicLink[href^=\"#help\"]").forEach(link=>{
      link.addEventListener("click",()=>{
        const targetId = link.getAttribute("href").slice(1);
        const topic = document.getElementById(targetId);
        if (!topic) return;
        topic.open = true;
      });
    });

    /* ============================
     * Help: one open section at a time
     * ============================
     * The guide is a list of native <details>, and several long ones open at
     * once turned Help into one enormous page. Opening a section now closes
     * the others, and the open section's own summary is pinned to the top of
     * the Help scroller by CSS, so it doubles as "you are here" and "close
     * this". Nested subtopics inside a section are deliberately left alone:
     * they are ordinary <details> and any number may stay open.
     *
     * Mobile shows the identical accordion list as desktop (no separate
     * tile/panel navigation any more), so this same one-open-at-a-time
     * behavior applies on every viewport. The scrollBy alignment below is a
     * no-op on mobile - #helpBlock > .blockBody only becomes its own
     * overflow:auto scrollport at >=901px (desktop.css); at <=900px the
     * page itself scrolls, and native <details> already reveals the opened
     * content in place without needing that. */
    const helpTopics = [...document.querySelectorAll("#helpBlock .helpTopics > .helpTopic")];
    const helpScroller = document.querySelector("#helpBlock > .blockBody");

    // Aligns a topic's header to the top of the Help scroller. Used both when
    // opening (the section starts at the top, under the pinned header) and
    // when closing (the row you just collapsed stays under the pointer instead
    // of leaving you stranded far down a now-empty page).
    function alignHelpTopic(topic, { smooth = true } = {}){
      if (!helpScroller || !topic.querySelector("summary")?.offsetParent) return;
      // Target the scroller's *content* edge, not its border box: a sticky
      // top:0 pins to the content edge, so aligning to the border box would
      // leave the header 14px adrift from its card the instant it sticks.
      const padding = parseFloat(getComputedStyle(helpScroller).paddingTop) || 0;
      const offset = topic.getBoundingClientRect().top - helpScroller.getBoundingClientRect().top - padding;
      if (Math.abs(offset) < 2) return;
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      helpScroller.scrollBy({ top: offset, behavior: smooth && !reduceMotion ? "smooth" : "auto" });
    }

    // Closing a sibling fires that sibling's own toggle. Without this guard it
    // would scroll to the section being closed, fighting the scroll to the one
    // just opened - the two animations cancel and the panel lands nowhere.
    let helpSwitching = false;

    helpTopics.forEach(topic=>{
      // `toggle` covers every route into the open state - pointer, keyboard,
      // and the in-body help links above - without wrapping <summary> in a
      // custom control, so native disclosure semantics stay intact.
      topic.addEventListener("toggle",()=>{
        if (helpSwitching) return;
        if (!topic.open){
          alignHelpTopic(topic);
          return;
        }
        helpSwitching = true;
        helpTopics.forEach(other=>{ if (other !== topic) other.open = false; });
        helpSwitching = false;
        alignHelpTopic(topic);
      });
    });
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
    document.querySelectorAll(".workspaceContent > .workspacePanel > summary").forEach(summary=>{
      summary.addEventListener("click",event=>{
        const timelineLockedOpen = state.mobileTimelineOnly && summary.closest("#resultsBlock") && !isDesktopLayout();
        const mobilePanel = summary.closest(".workspacePanel");
        if (mobilePanel && !isDesktopLayout() && document.body.dataset.mobileWorkspace === "panel"){
          event.preventDefault();
          return;
        }
        if (isDesktopLayout() || timelineLockedOpen) event.preventDefault();
      });
    });
    window.addEventListener("resize", syncWorkspaceForViewport);
    // Structural re-render is driven by the breakpoint lists themselves, not
    // by this resize handler - see syncLayoutMode. Wiring it here keeps all
    // responsive handling in one place instead of adding a second system.
    watchLayoutMode();
    setInterval(updateChangeoverCountdown, 30000);
    document.addEventListener("click",event=>{
      if (toolsIndexDropdown?.open && !toolsIndexDropdown.contains(event.target)) toolsIndexDropdown.open = false;
      document.querySelectorAll(".hopperGeometryPopover[open]").forEach(popover=>{
        if (!popover.contains(event.target)) popover.open = false;
      });
    });
    document.addEventListener("keydown",event=>{
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
        applyTheme("industrial-slate");
        applyTimeFormat("12");
        applySurfaceStyle(defaultSurfaceStyle());
        rebuildUIFromState();
      }

      activeWorkspaceId = loadWorkspacePreference();
      // A phone always starts at the tile home. Desktop keeps restoring the
      // most recently used workspace through activeWorkspaceId.
      if (!isDesktopLayout()) showMobileWorkspaceHome();
      applyMobileTimelineMode(state.mobileTimelineOnly);
      // Record the mode the initial render already produced, and publish it
      // for CSS. rerender:false because the DOM was just built correctly by
      // the boot path - only later boundary crossings need a rebuild.
      syncLayoutMode({ rerender:false });
      syncWorkspaceForViewport();
      hookDetailsPersistence();
      hookMobileAccordion();
      hookCustomToggles();
      hookRecipePageTabs();
      // Sync toggle UI after restore
      syncToggleUI("showPumpOffToggle", !!state.showPumpOffTracked);

      refreshConfigDropdown();

      const selVal = $("savedConfigs")?.value;
      if (selVal && selVal !== "— none saved —"){
        const cn = $("configName");
        if (cn) cn.value = selVal;
      }

      // Ensure theme/logo applied even after restore
      applyTheme(state.theme || "industrial-slate");
      applyTimeFormat(state.timeFormat || "12");
      applySurfaceStyle(state.surfaceStyle || defaultSurfaceStyle());
      applyMobileTileStyle("minimal");
      applyMobileBackgroundStyle("theme-native");
      applyMobileTimelineAlarm(!!state.mobileTimelineAlarm);
      saveSession();
      setupLineSync();

      // Timeline clock: makes card status/relative time advance with real
      // time between data changes (see refreshTimelinePresentation's own
      // comment for why this doesn't just call validateAndCompute). Started
      // once here, not per Timeline visit, so navigating in and out of
      // Timeline can never stack up duplicate intervals.
      startTimelineTicker();
      registerNativeTimelineAlarmSupport();

      // Foreground/resume: force one immediate, correct refresh rather than
      // waiting for the next tick, and reconcile native alarms (covers a
      // notification firing, a schedule changing while backgrounded, or a
      // completely fresh device that never got today's schedule at all).
      window.Capacitor?.Plugins?.App?.addListener?.("appStateChange", ({ isActive })=>{
        if (!isActive) return;
        refreshTimelinePresentation();
        if (lastTimelineFlat) syncNativeTimelineAlarms(lastTimelineFlat, lastTimelineChangeoverDate);
      });
      // Ordinary browser tabs get suspended/throttled the same way, without
      // Capacitor's own appStateChange event - this keeps the website
      // correct after returning to a backgrounded tab too.
      document.addEventListener("visibilitychange", ()=>{
        if (!document.hidden) refreshTimelinePresentation();
      });
    })();

})();
