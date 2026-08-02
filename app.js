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
      "recipesBlock",
      "toolsBlock",
      "helpBlock",
      "helpQuickStart",
      "helpSetup",
      "helpHopperPercentages",
      "helpTimeline",
      "helpCloudSync",
      "helpLineConfigurations",
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
      offsets: {},
      layers: [],
      prodResinLb: 0,
      scrapResinLb: 0,
      density: "spacious",
      theme: "light",
      timeFormat: "12",
      surfaceStyle: "layered-flat",
      timelineStyle: "command-rows",
      gauge: 0,
      hopperNamingLine9: "standard", // "standard" | "main"
      showPumpOffTracked: false, // show pump-off items in Timeline
      uiMode: "everyday", // "everyday" | "advanced"
      mobileTimelineOnly: false

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
  const { parseChangeoverDate, formatTime, formatTimelineStart } = window.PolynScheduling;
  const fmtTime = (date, baseDate) => formatTime(date, baseDate, state.timeFormat);
  const { writeJson } = window.PolynStorage;
  let lineSync = null;
  let workspaceConfigurations = null;
  let workspaceConfigurationWorkspaceId = "";
  let workspaceConfigurationRefreshInFlight = false;
  let workspaceConfigurationPending = null;
  let selectedWorkspaceConfigurationId = "";

  function snapshotSharedActiveJob(){
    return activeJob.snapshotActiveJob(state, APP_VERSION);
  }

  function notifyActiveJobMutation(options){
    lineSync?.notifyActiveJobMutation(options);
  }

  function workspaceConfigurationStatus(message){ const el=$("workspaceConfigurationsStatus"); if(el) el.textContent=message; }
  function renderWorkspaceConfigurations(syncState){
    const profiles=$("workspaceProfilesList"), recipes=$("workspaceRecipesList"), refresh=$("workspaceConfigurationsRefresh"), workspaceLabel=$("workspaceConfigurationsWorkspace");
    if(!profiles || !recipes) return;
    const workspaceId=syncState?.selectedWorkspaceId || "";
    if(refresh) refresh.disabled=!workspaceId || workspaceConfigurationRefreshInFlight;
    profiles.replaceChildren(); recipes.replaceChildren();
    if(!workspaceId){ workspaceConfigurationWorkspaceId=""; selectedWorkspaceConfigurationId=""; if(workspaceLabel) workspaceLabel.hidden=true; workspaceConfigurationStatus("Connect to an RT Sync workspace to view shared weight profiles and recipes."); return; }
    workspaceConfigurationWorkspaceId=workspaceId;
    if(workspaceLabel){ workspaceLabel.hidden=false; workspaceLabel.textContent=`Workspace: ${syncState.selectedWorkspace?.name || "Connected workspace"}`; }
    const renderList=(host,items,kind)=>{
      if(!items.length){ const empty=document.createElement("div"); empty.className="muted"; empty.textContent=kind==="recipe"?"No shared recipes saved for this workspace.":"No shared weight profiles saved for this workspace."; host.append(empty); return; }
      items.forEach(item=>{ const row=document.createElement("div"); row.className="workspaceConfigurationRow"; row.tabIndex=0; row.setAttribute("role","group"); row.setAttribute("aria-label",`${item.name} configuration`); const select=()=>{selectedWorkspaceConfigurationId=item.id; renderWorkspaceConfigurations(syncState);}; row.classList.toggle("selected",selectedWorkspaceConfigurationId===item.id); row.addEventListener("click",event=>{if(!event.target.closest("button,summary,details")) select();}); row.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&!event.target.closest("button,summary")){event.preventDefault();select();}}); const info=document.createElement("div"); const title=document.createElement("strong"); if(item.favorite){const star=document.createElement("span");star.className="workspaceConfigurationFavorite";star.setAttribute("aria-label","Favorite recipe");star.textContent="★";title.append(star," ");} title.append(item.name); const meta=document.createElement("small"); const count=kind==="recipe"&&Array.isArray(item.payload?.layers)?item.payload.layers.reduce((n,layer)=>n+(Array.isArray(layer?.hoppers)?layer.hoppers.filter(h=>typeof h?.resin_name==="string"&&h.resin_name.trim()).length:0),0):kind!=="recipe"&&Array.isArray(item.payload?.layers)?item.payload.layers.reduce((n,layer)=>n+(Array.isArray(layer?.receiver_weights_lb)&&layer.receiver_weights_lb.length===6?6:0),0):null; meta.textContent=`${item.payload.line_type} Layer${count===null?"":` · ${count} ${kind==="recipe"?"assigned hoppers":"receiver weights"}`} · Updated ${item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : "unknown"}`; info.append(title,meta); const actions=document.createElement("div"); actions.className="workspaceConfigurationActions"; const action=(label,fn,cls="secondary")=>{const b=document.createElement("button");b.type="button";b.className=cls;b.textContent=label;b.addEventListener("click",event=>{event.stopPropagation();fn();});return b;}; actions.append(action("Load",()=>previewWorkspaceConfiguration(item),"primary"),action("Update",()=>openWorkspaceConfigurationDialog("update",item))); const menu=document.createElement("details"); menu.className="workspaceConfigurationOverflow"; menu.addEventListener("click",event=>event.stopPropagation()); const summary=document.createElement("summary"); summary.setAttribute("aria-label",`More actions for ${item.name}`); summary.textContent="⋯"; const menuActions=document.createElement("div"); menuActions.className="workspaceConfigurationOverflowMenu"; const menuAction=(label,fn,cls="secondary")=>{const button=action(label,()=>{menu.open=false;fn();},cls);menuActions.append(button);}; menuAction("Rename",()=>openWorkspaceConfigurationDialog("rename",item)); menuAction("Duplicate",()=>openWorkspaceConfigurationDialog("duplicate",item)); if(kind==="recipe") menuAction(item.favorite?"Unfavorite":"Favorite",()=>mutateWorkspaceConfiguration("favorite",item,!item.favorite)); menuAction("Delete",()=>{if(confirm(`Delete shared configuration “${item.name}”?`)) mutateWorkspaceConfiguration("delete",item);},"danger"); menu.append(summary,menuActions); actions.append(menu); row.append(info,actions); host.append(row); });
    };
    if(!workspaceConfigurations){ workspaceConfigurationStatus("Shared configurations service is unavailable."); return; }
    renderList(profiles,workspaceConfigurations.listReceiverWeightProfiles(workspaceId).items,"profile");
    renderList(recipes,workspaceConfigurations.listRecipes(workspaceId).items,"recipe");
    workspaceConfigurationStatus("Showing shared configurations for the current RT Sync workspace.");
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
    if(item.type==="recipe"){ const lineType=$("lineType"); if(lineType) lineType.value=String(state.lineType); }
    renderWeightsArea(); renderSplitsArea(); validateAndCompute(); saveSession(); notifyActiveJobMutation({immediate:true,kind:"load-workspace-configuration"});
    workspaceConfigurationStatus(`${item.type==="recipe"?"Recipe":"Receiver Weight Profile"} loaded successfully.`);
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
  function finishWorkspaceConfigurationMutation(result,message){ if(result?.ok){ workspaceConfigurationStatus(message); renderWorkspaceConfigurations(lineSync?.getState?.()||{}); } else workspaceConfigurationStatus(result?.message || "Shared configuration could not be changed."); }
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

    hookToggle(
      "showPumpOffToggle",
      ()=> !!state.showPumpOffTracked,
      (v)=> { state.showPumpOffTracked = !!v; }
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
      if (lineType === 3) return { "C": "A" };
      if (lineType === 5) return {
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
                pumpOff: !!h.pumpOff
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
            pumpOff: false
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
        offsets: state.offsets,
        layers: state.layers,
        prodResinLb: state.prodResinLb,
        scrapResinLb: state.scrapResinLb,
        density: state.density,
        theme: state.theme,
        timeFormat: state.timeFormat,
        surfaceStyle: state.surfaceStyle,
        timelineStyle: state.timelineStyle,
        gauge: state.gauge,
        hopperNamingLine9: state.hopperNamingLine9,
        showPumpOffTracked: !!state.showPumpOffTracked,
        uiMode: state.uiMode,
        mobileTimelineOnly: !!state.mobileTimelineOnly,
        blocksOpen
      };
    }

    function applySharedActiveJob(payload){
      const localPreferences = {
        density: state.density,
        theme: state.theme,
        timeFormat: state.timeFormat,
        surfaceStyle: state.surfaceStyle,
        timelineStyle: state.timelineStyle,
        showPumpOffTracked: state.showPumpOffTracked,
        uiMode: state.uiMode,
        mobileTimelineOnly: state.mobileTimelineOnly,
        blocksOpen: snapshotPayload().blocksOpen
      };
      applyPayload({ ...payload, ...localPreferences }, { rebuildUI: true });
      saveSession();
    }

  
  /* ============================
   * Theme
   * ============================ */
  function applyTheme(t){
      const allowed = new Set(["dark","light","mse","industrial-slate-dark","gruvbox-dark","gruvbox-light","nord","tokyo-night","dracula","solarized-dark","solarized-light","catppuccin-mocha","catppuccin-latte","amber","high-contrast","mono"]);
      const theme = allowed.has(String(t)) ? String(t) : "light";

      document.documentElement.setAttribute("data-theme", theme);
      document.body.setAttribute("data-theme", theme);

      const sel = $("themeSel");
      if (sel) sel.value = theme;

      state.theme = theme;

  }

    function applyDensity(d){
      const allowed = new Set(["spacious","comfort","compact","dense","maximum"]);
      const density = allowed.has(String(d)) ? String(d) : "spacious";
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

    function applySurfaceStyle(value){
      const allowed = new Set(["elevated", "flat", "layered-flat", "accent-frame", "divided", "low-elevation"]);
      const surfaceStyle = allowed.has(String(value)) ? String(value) : "layered-flat";
      state.surfaceStyle = surfaceStyle;
      document.body.setAttribute("data-surface-style", surfaceStyle);
      const sel = $("surfaceStyleSel");
      if (sel) sel.value = surfaceStyle;
    }

    function applyTimelineStyle(value){
      const allowed = new Set(["soft-cards", "event-rail", "data-strips", "priority-lane", "divided-list", "command-rows"]);
      const timelineStyle = allowed.has(String(value)) ? String(value) : "command-rows";
      state.timelineStyle = timelineStyle;
      document.body.setAttribute("data-timeline-style", timelineStyle);
      const sel = $("timelineStyleSel");
      if (sel) sel.value = timelineStyle;
    }

    function applyPayload(payload, {rebuildUI=true} = {}){
      if (!payload || typeof payload !== "object") return;

      state.lineRate = clampNum(payload.lineRate);
      state.gauge = 0;
      state.lineType = [1,3,5].includes(Number(payload.lineType)) ? Number(payload.lineType) : 3;
      state.changeoverTime = payload.changeoverTime || "";
      state.offsets = {};
      state.prodResinLb = clampNum(payload.prodResinLb);
      state.scrapResinLb = clampNum(payload.scrapResinLb);

      applyTheme(payload.theme || "light");
      applyDensity(payload.density || "spacious");
      applyTimeFormat(payload.timeFormat || "12");
      applySurfaceStyle(payload.surfaceStyle || "layered-flat");
      applyTimelineStyle(payload.timelineStyle || "command-rows");
      $("lineRate").value = String(state.lineRate);
      // Custom toggles
      state.hopperNamingLine9 = (payload.hopperNamingLine9 === "main") ? "main" : "standard";
      state.showPumpOffTracked = !!payload.showPumpOffTracked;
      state.uiMode = payload.uiMode === "advanced" ? "advanced" : "everyday";
      state.mobileTimelineOnly = !!payload.mobileTimelineOnly;
      applyMobileTimelineMode(state.mobileTimelineOnly);


      $("lineType").value = String(state.lineType);
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
            pumpOff: !!fh.pumpOff
          };
        });
        return { name, layerPct, hoppers };
      });

      state.offsets = Object.fromEntries(names.map(layerName=>[layerName, 0]));

      const lineRateEl = $("lineRate");
      if (lineRateEl) lineRateEl.value = String(state.lineRate);
      const lineTypeEl = $("lineType");
      if (lineTypeEl) lineTypeEl.value = String(state.lineType);

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
    function hopperPositionLabel(hi){
      if (state.hopperNamingLine9 === "main") return hi === 0 ? "Main" : String(hi);
      return String(hi + 1);
    }

    function renderWeightsArea(){
      const area = $("weightsArea");
      if (!area) return;
      area.innerHTML = "";
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
        <div class="weightsBulkSteps" aria-label="Bulk weight editing steps">
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
      area.appendChild(toolbar);

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
      corner.textContent = "Select row";
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
          td.append(selector, fieldWrap);
          tr.appendChild(td);

          cellRefs.set(key, { td, selector, input, layer: L, hi });

          selector.addEventListener("change", ()=>{
            selector.checked ? selected.add(key) : selected.delete(key);
            updateSelectionUI();
          });
          td.addEventListener("click",(e)=>{
            if (e.target === input || e.target === selector) return;
            selector.checked = !selector.checked;
            selector.dispatchEvent(new Event("change"));
          });
          input.addEventListener("input",(e)=>{
            const accepted = acceptNumericInput(
              e.target,
              { min: 0, label: `${hopperBadgeLabel(L.name, hi)} weight` },
              value => { L.hoppers[hi].weight = value; }
            );
            if (!accepted) return;
            validateAndCompute({ sync: true });
            saveSession();
          });
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      frame.appendChild(table);
      scroll.appendChild(frame);
      area.appendChild(scroll);

      const bulkInput = toolbar.querySelector("#bulkWeight");
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
        const result = validation.validateNumber(
          bulkInput.value,
          { min: 0, label: "Bulk weight" }
        );
        bulkInput.setCustomValidity(result.valid ? "" : result.message);
        bulkInput.setAttribute("aria-invalid", String(!result.valid));
        bulkInput.title = result.valid ? "" : result.message;
        if (!result.valid) return;

        selected.forEach(key=>{
          const ref = cellRefs.get(key);
          if (!ref) return;
          ref.layer.hoppers[ref.hi].weight = result.value;
          ref.input.value = String(result.value);
        });
        validateAndCompute({ sync: true });
        saveSession();
        updateSelectionUI(`Applied ${result.value} lb to ${selected.size} hopper${selected.size === 1 ? "" : "s"}`);
      });

      updateSelectionUI();
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
      let bulkMode = false;

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
      const modeButton = document.createElement("button");
      modeButton.type = "button";
      modeButton.className = "secondary";
      modeButton.textContent = "Bulk edit";
      modeButton.setAttribute("aria-expanded", "false");
      modeBar.appendChild(modeButton);

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
      actionInfo.append(summary, recipeInfo);
      const actionRow = document.createElement("div");
      actionRow.className = "splitsMatrixActions";
      actionRow.append(actionInfo, modeBar);
      area.append(actionRow, toolbar);

      const mobileLayerNav = document.createElement("div");
      mobileLayerNav.className = "splitsMobileLayerNav";
      mobileLayerNav.style.setProperty("--mobile-layer-count", String(state.layers.length));
      mobileLayerNav.setAttribute("role", "tablist");
      mobileLayerNav.setAttribute("aria-label", "Choose layer");
      let activeMobileLayer = state.layers[0]?.name || "";
      const mobileLayerButtons = new Map();
      state.layers.forEach(L=>{
        const button = document.createElement("button");
        button.type = "button";
        button.className = "splitsMobileLayerButton";
        button.textContent = L.name;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-label", `Show Layer ${L.name}`);
        mobileLayerButtons.set(L.name, button);
        mobileLayerNav.appendChild(button);
      });
      area.appendChild(mobileLayerNav);

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
        const pctUnit = document.createElement("span");
        pctUnit.textContent = "%";
        pctWrap.append(pctInput, pctUnit);

        const headerMain = document.createElement("div");
        headerMain.className = "splitLayerMain";
        headerMain.append(title, pctWrap);

        const hopperTotal = document.createElement("div");
        hopperTotal.id = `hopperTotal_${L.name}`;
        hopperTotal.className = "splitColumnTotal";

        th.append(headerMain, hopperTotal);

        const copyFrom = copyRules[L.name];
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

          const clearButton = document.createElement("button");
          clearButton.type = "button";
          clearButton.className = "splitClearButton";
          clearButton.textContent = "×";
          clearButton.setAttribute("aria-label", `Clear ${hopperBadgeLabel(L.name, hi)}`);
          clearButton.title = `Clear ${hopperBadgeLabel(L.name, hi)}`;

          cellHeader.append(trackControl, clearButton);
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
      area.appendChild(scroll);

      function showMobileLayer(layerName){
        activeMobileLayer = layerName;
        table.querySelectorAll("[data-layer-column]").forEach(cell=>{
          cell.classList.toggle("mobile-layer-active", cell.dataset.layerColumn === activeMobileLayer);
        });
        mobileLayerButtons.forEach((button,name)=>{
          const active = name === activeMobileLayer;
          button.classList.toggle("active", active);
          button.setAttribute("aria-selected", String(active));
          button.tabIndex = active ? 0 : -1;
        });
      }
      mobileLayerButtons.forEach((button,name)=>{
        button.addEventListener("click",()=>showMobileLayer(name));
      });
      showMobileLayer(activeMobileLayer);

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
        area.classList.toggle("bulk-editing", bulkMode);
        toolbar.classList.toggle("hide", !bulkMode);
        modeButton.textContent = bulkMode ? "Done bulk editing" : "Bulk edit";
        modeButton.setAttribute("aria-expanded", String(bulkMode));
        table.querySelectorAll(".splitLayerTitle, .splitRowSelect").forEach(button=>{
          button.tabIndex = bulkMode ? 0 : -1;
          button.setAttribute("aria-disabled", String(!bulkMode));
        });
        cellRefs.forEach(ref=>{
          ref.resinInput.disabled = bulkMode;
          ref.pctInput.disabled = bulkMode;
          const trackButton = ref.td.querySelector(".splitTrackButton");
          if (trackButton) trackButton.disabled = bulkMode;
        });
        if (!bulkMode) selected.clear();
        updateSelectionUI();
      }

      modeButton.addEventListener("click",()=>setBulkMode(!bulkMode));

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
      setBulkMode(false);
    }

    function renderResinCalculator(){
      const prod = clampNum(state.prodResinLb);
      const scrap = clampNum(state.scrapResinLb);
      const total = prod + scrap;

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
              Production: <span class="mono">${fmtNum(prod,2)}</span> lb • Scrap: <span class="mono">${fmtNum(scrap,2)}</span> lb •
              Total: <span class="mono">${fmtNum(total,2)}</span> lb
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
          <div class="mono calcValue">${fmtNum(r.lbs,2)} lb</div>
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
        L.hoppers.every(h=>clampNum(h.weight) === 0)
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
        const missingW = tracked.filter(x=>clampNum(x.h.weight) <= 0).length;
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
          const weight = clampNum(h.weight);

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
      updateFooterNext(flat, changeoverDate);
      renderResinCalculator();
      updateCollapsedSummaries();
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
      const pr = $("prodResinLb"); if (pr) pr.value = "0";
      const sr = $("scrapResinLb"); if (sr) sr.value = "0";

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

    function syncModeButtons(){
      const timelineActive = state.mobileTimelineOnly && window.matchMedia("(max-width: 900px)").matches;
      const advanced = state.uiMode === "advanced";
      const everydayBtn = $("everydayModeBtn");
      const advancedBtn = $("advancedModeBtn");
      const timelineBtn = $("mobileTimelineModeBtn");
      if (everydayBtn){ everydayBtn.classList.toggle("active", !timelineActive && !advanced); everydayBtn.setAttribute("aria-pressed", String(!timelineActive && !advanced)); }
      if (advancedBtn){ advancedBtn.classList.toggle("active", !timelineActive && advanced); advancedBtn.setAttribute("aria-pressed", String(!timelineActive && advanced)); }
      if (timelineBtn){ timelineBtn.classList.toggle("active", timelineActive); timelineBtn.setAttribute("aria-pressed", String(timelineActive)); }
    }

    function applyMobileTimelineMode(enabled){
      state.mobileTimelineOnly = !!enabled;
      document.body.setAttribute("data-mobile-timeline-only", String(state.mobileTimelineOnly));
      if (state.mobileTimelineOnly && window.matchMedia("(max-width: 900px)").matches){
        const results = $("resultsBlock");
        if (results) results.open = true;
      }
      syncModeButtons();
    }

    function applyUIMode(mode){
      state.uiMode = mode === "advanced" ? "advanced" : "everyday";
      document.body.setAttribute("data-ui-mode", state.uiMode);
      const advanced = state.uiMode === "advanced";
      syncModeButtons();
      if (!advanced && activeWorkspaceId === "recipesBlock"){
        setWorkspacePanel("resultsBlock", { persist: false });
      }
    }

    function setUIMode(mode){ applyMobileTimelineMode(false); applyUIMode(mode); saveSession(); }

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

    function setWorkspacePanel(id, { persist = true } = {}){
      const target = document.getElementById(id);
      if (!target?.classList.contains("workspacePanel")) return;
      activeWorkspaceId = id;
      document.querySelectorAll(".workspaceContent > .workspacePanel").forEach(panel=>{
        panel.classList.toggle("desktop-active", panel.id === id);
      });
      document.querySelectorAll(".workspaceNavButton").forEach(button=>{
        const active = button.dataset.workspaceTarget === id;
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      if (window.matchMedia("(min-width: 901px)").matches) target.open = true;
      if (persist) saveWorkspacePreference(id);
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
      if (!desktop && state.mobileTimelineOnly){
        const results = $("resultsBlock");
        if (results) results.open = true;
      }
      syncModeButtons();
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

  function updateFooterNext(flat, changeoverDate){
    const msgEl = document.getElementById("footerMsg");
    const subEl = document.getElementById("footerSub");
    const desktopMsgEl = document.getElementById("workspaceNextStatus");
    const desktopSubEl = document.getElementById("workspaceNextDetail");
    if (!msgEl || !subEl) return;

    const setNextStatus = (message, detail)=>{
      msgEl.textContent = message;
      subEl.textContent = detail;
      if (desktopMsgEl) desktopMsgEl.textContent = message;
      if (desktopSubEl) desktopSubEl.textContent = detail;
    };

    if (!flat || flat.length === 0){
      setNextStatus("No tracked hoppers", "Track a resin to see the next action");
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
          `${next.startByText} (${fmtRelFromNow(next.startByDate)}) • Changeover ${fmtTime(changeoverDate)}`
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
    if ($("lineSyncDeleteBtn")) $("lineSyncDeleteBtn").hidden = !owner;
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
    $("lineSyncGenerateCodeBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.generateLinkCode()));
    $("lineSyncRenameBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.renameWorkspace($("lineSyncWorkspaceName")?.value)));
    $("lineSyncRetryBtn")?.addEventListener("click",()=>runLineSyncAction(()=>
      window.matchMedia("(max-width: 900px)").matches && lineSync.getState().selectedWorkspaceId
        ? lineSync.refreshSelected()
        : lineSync.retry()
    ));
    $("lineSyncDisconnectBtn")?.addEventListener("click",()=>runLineSyncAction(()=>lineSync.disconnectLocal()));
    $("lineSyncLeaveBtn")?.addEventListener("click",()=>{
      if (confirm("Leave RT Sync on this browser identity? Local Resin.Tools data will remain.")) runLineSyncAction(()=>lineSync.leaveWorkspace());
    });
    $("lineSyncDeleteBtn")?.addEventListener("click",()=>{
      const name = lineSync.getState().selectedWorkspace?.name || "this line";
      if (confirm(`Permanently delete the shared workspace “${name}” for every linked device?`)) runLineSyncAction(()=>lineSync.deleteWorkspace());
    });
    $("lineSyncNewJobBtn")?.addEventListener("click",()=>{
      if (confirm("Start a new shared job? Hopper weights will be kept; production inputs and tracking will be cleared.")) {
        runLineSyncAction(()=>lineSync.replaceActiveJob(newJobPayload(), "new-job"));
      }
    });
    lineSync.initialize();
  }

    // Wire inputs
    $("lineRate")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Line rate" }, value => { state.lineRate = value; })) return;
      validateAndCompute({ sync: true });
      saveSession();
    });
    $("lineType")?.addEventListener("change",(e)=>{
      const previousType = state.lineType;
      const nextType = [1,3,5].includes(Number(e.target.value)) ? Number(e.target.value) : 3;
      const nextLayerNames = new Set(getLayerNamesForType(nextType));
      const configuredRemovedLayers = state.layers.filter(layer=>!nextLayerNames.has(layer.name)).filter(layer=>
        clampNum(layer.layerPct) > 0 ||
        layer.hoppers.some((hopper,index)=>
          (index === 0 ? Math.abs(clampNum(hopper.pct) - 100) > 0.0001 : clampNum(hopper.pct) > 0) ||
          clampNum(hopper.weight) > 0 || !!hopper.resinName || !!hopper.track || !!hopper.pumpOff
        )
      );
      if (configuredRemovedLayers.length && !confirm(`Changing to ${nextType} ${nextType === 1 ? "layer" : "layers"} will remove configured data for ${configuredRemovedLayers.map(layer=>layer.name).join(", ")}. Continue?`)){
        e.target.value = String(previousType);
        return;
      }
      state.lineType = nextType;
      ensureLayers();
      rebuildUIFromState();
      saveSession();
      notifyActiveJobMutation({ immediate: true, kind: "line-type" });
    });
    $("changeoverTime")?.addEventListener("input",(e)=>{ state.changeoverTime = e.target.value || ""; validateAndCompute({ sync: true }); saveSession(); });

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

    $("timelineStyleSel")?.addEventListener("change",(e)=>{
      applyTimelineStyle(e.target.value);
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

    $("everydayModeBtn")?.addEventListener("click", event=>{
      event.stopPropagation();
      setUIMode("everyday");
    });
    $("advancedModeBtn")?.addEventListener("click", event=>{
      event.stopPropagation();
      setUIMode("advanced");
    });
    $("mobileTimelineModeBtn")?.addEventListener("click", event=>{
      event.stopPropagation();
      applyMobileTimelineMode(true);
      saveSession();
    });
    const toolTabs = Array.from(document.querySelectorAll(".toolsIndexButton"));
    function selectToolPanel(targetId, { focus = false } = {}){
      if (!toolTabs.some(tab=>tab.dataset.toolTarget === targetId)) return;
      toolTabs.forEach(tab=>{
        const selected = tab.dataset.toolTarget === targetId;
        tab.classList.toggle("active", selected);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focus) tab.focus();
      });
      document.querySelectorAll(".toolWorkspacePanel").forEach(panel=>{
        panel.hidden = panel.id !== targetId;
      });
    }
    toolTabs.forEach((tab, index)=>{
      tab.addEventListener("click", ()=>selectToolPanel(tab.dataset.toolTarget));
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
      button.addEventListener("click",()=>setWorkspacePanel(button.dataset.workspaceTarget));
    });
    document.querySelectorAll(".workspaceContent > .workspacePanel > summary").forEach(summary=>{
      summary.addEventListener("click",event=>{
        const timelineLockedOpen = state.mobileTimelineOnly && summary.closest("#resultsBlock") && window.matchMedia("(max-width: 900px)").matches;
        if (window.matchMedia("(min-width: 901px)").matches || timelineLockedOpen) event.preventDefault();
      });
    });
    window.addEventListener("resize", syncWorkspaceForViewport);
    const statusPreferences = $("statusPreferences");
    statusPreferences?.addEventListener("toggle",()=>{
      const summary = statusPreferences.querySelector(":scope > summary");
      if (summary) summary.setAttribute("aria-label", statusPreferences.open ? "Close appearance and preferences" : "Open appearance and preferences");
    });
    document.addEventListener("click",event=>{
      if (statusPreferences?.open && !statusPreferences.contains(event.target)) statusPreferences.open = false;
    });
    document.addEventListener("keydown",event=>{
      if (event.key === "Escape" && statusPreferences?.open){
        statusPreferences.open = false;
        statusPreferences.querySelector(":scope > summary")?.focus();
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
        applyDensity("spacious");
        applyTheme("light");
        applyTimeFormat("12");
        applySurfaceStyle("layered-flat");
        applyTimelineStyle("command-rows");
        rebuildUIFromState();
      }

      activeWorkspaceId = loadWorkspacePreference();
      applyUIMode(state.uiMode);
      applyMobileTimelineMode(state.mobileTimelineOnly);
      syncWorkspaceForViewport();
      hookDetailsPersistence();
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
      applyTheme(state.theme || "light");
      applyTimeFormat(state.timeFormat || "12");
      applySurfaceStyle(state.surfaceStyle || "layered-flat");
      applyTimelineStyle(state.timelineStyle || "command-rows");
      saveSession();
      setupLineSync();
    })();

})();
