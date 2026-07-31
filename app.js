/* =======================================================================
 * ResinIQ / ResinTimer — app.js
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
  const APP_VERSION = "0.16";

    const LS_SESSION_KEY = "resinTimer.session.v0.09";
    const LS_CONFIGS_KEY  = "resinTimer.configs.v0.09";
    const LS_WORKSPACE_KEY = "resinTimer.workspace.v0.16";

    const DETAILS_IDS = [
      "lineSetupBlock",
      "weightsBlock",
      "offsetsBlock",
      "splitsBlock",
      "resultsBlock",
      "resinCalcBlock",
      "recipesBlock",
      "toolsBlock"
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
      density: "comfort",
      theme: "light",
      gauge: 0,
      hopperNamingLine9: "standard", // "standard" | "main"
      showPumpOffTracked: false, // show pump-off items in Run-Down Timeline
      uiMode: "everyday" // "everyday" | "advanced"

    };

  
  /* ============================
   * DOM helpers
   * ============================ */
  const $ = (id) => document.getElementById(id);
  const validation = window.ResinIQValidation;
  const calculators = window.ResinIQCalculators;
  const resinLookup = window.ResinIQLookup;
  const { parseChangeoverDate, formatTime: fmtTime } = window.ResinIQScheduling;
  const { writeJson } = window.ResinIQStorage;
  const COMMON_RESIN_NAMES = Object.freeze([
    "MS0100", "MS0101", "MS0120", "MS0200", "MS0400", "MS0440", "MS0700", "MS0700B",
    "MS1100", "MS1200", "MS1201", "MS1202", "MS1230", "MS1255", "MS3003", "MS5000", "MS5004", "MS5006",
    "MS5009", "MS6000", "MS6600",
    "A0100", "A0110", "A0300", "A0301",  "A0401", "A0450", "A0502", "A0503", "A0600", "A0601", "A0700",
    "A0711", "A0735", "A1901", "A2000", "A1010"
  ]);

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
    const starts = COMMON_RESIN_NAMES.filter(name=>name.startsWith(query));
    const contains = COMMON_RESIN_NAMES.filter(name=>!name.startsWith(query) && name.includes(query));
    const matches = [...starts, ...contains];
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
      }
      validateAndCompute();
    };

    el.addEventListener("click",(e)=>{ e.preventDefault(); flip(); });
    el.addEventListener("keydown",(e)=>{
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); }
    });

    // initial
    syncToggleUI(id, getOn());
  }

  function hookCustomToggles(){
    hookToggle(
      "hopperNamingToggle",
      ()=> state.hopperNamingLine9 === "main",
      (v)=> { state.hopperNamingLine9 = v ? "main" : "standard"; }
    );

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
      return `<div class="${cls}"><div style="font-weight:950;margin-bottom:6px">${title}</div><ul>${items}</ul></div>`;
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

      const nextOffsets = {};
      names.forEach(n => nextOffsets[n] = clampNum(state.offsets?.[n] ?? 0));
      state.offsets = nextOffsets;
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
        gauge: state.gauge,
        hopperNamingLine9: state.hopperNamingLine9,
        showPumpOffTracked: !!state.showPumpOffTracked,
        uiMode: state.uiMode,
        blocksOpen
      };
    }

  
  /* ============================
   * Theme
   * ============================ */
  function applyTheme(t){
      const allowed = new Set(["dark","light","mse","gruvbox-dark","gruvbox-light","nord","tokyo-night","dracula","solarized-dark","solarized-light","catppuccin-mocha","catppuccin-latte","amber","high-contrast","mono"]);
      const theme = allowed.has(String(t)) ? String(t) : "light";

      document.documentElement.setAttribute("data-theme", theme);
      document.body.setAttribute("data-theme", theme);

      const sel = $("themeSel");
      if (sel) sel.value = theme;

      state.theme = theme;

      // Logo per theme
      const logo = $("headerLogo");
      if (logo){
        // Keep your dedicated Gruvbox header images; map the rest to light/dark
        const lightish = new Set(["light","mse","gruvbox-light","solarized-light","catppuccin-latte","mono"]);
        let src = lightish.has(theme) ? "images/resiniqhead-l.png" : "images/resiniqhead.png";

        if (theme === "gruvbox-light") src = "images/resiniqhead-gbl.png";
        if (theme === "gruvbox-dark")  src = "images/resiniqhead-gbd.png";

        logo.src = src;
      }
  }

    function applyDensity(d){
      const allowed = new Set(["comfort","compact","dense"]);
      const density = allowed.has(String(d)) ? String(d) : "comfort";
      document.body.setAttribute("data-density", density);
      const sel = $("densitySel");
      if (sel) sel.value = density;
      state.density = density;
    }

    function applyPayload(payload, {rebuildUI=true} = {}){
      if (!payload || typeof payload !== "object") return;

      state.lineRate = clampNum(payload.lineRate);
      if ("gauge" in payload) state.gauge = clampNum(payload.gauge);
      state.lineType = [1,3,5].includes(Number(payload.lineType)) ? Number(payload.lineType) : 3;
      state.changeoverTime = payload.changeoverTime || "";
      state.offsets = payload.offsets || {};
      state.prodResinLb = clampNum(payload.prodResinLb);
      state.scrapResinLb = clampNum(payload.scrapResinLb);

      applyTheme(payload.theme || "light");
      applyDensity(payload.density || "comfort");
      $("lineRate").value = String(state.lineRate);
      const g = $("gauge");
      if (g) g.value = String(state.gauge);

      // Custom toggles
      state.hopperNamingLine9 = (payload.hopperNamingLine9 === "main") ? "main" : "standard";
      state.showPumpOffTracked = !!payload.showPumpOffTracked;
      state.uiMode = payload.uiMode === "advanced" ? "advanced" : "everyday";


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

      const nextOffsets = {};
      names.forEach(n => nextOffsets[n] = clampNum(state.offsets?.[n] ?? 0));
      state.offsets = nextOffsets;

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
      }

      showImportUI(false);
      const ij = $("importJson"); if (ij) ij.value = "";
      recipeStatus(`Imported config: "${name}"`, "ok");
    }

    function renderOffsetInputs(){
      const wrap = $("offsetInputs");
      if (!wrap) return;
      wrap.innerHTML = "";
      state.layers.forEach(L=>{
        const id = `offset_${L.name}`;
        const box = document.createElement("div");
        box.innerHTML = `
          <label for="${id}">Layer ${L.name} offset</label>
          <input id="${id}" type="text" inputmode="numeric" placeholder="0" value="${clampNum(state.offsets[L.name] ?? 0)}" />
        `;
        wrap.appendChild(box);
        box.querySelector("input").addEventListener("input",(e)=>{
          const accepted = acceptNumericInput(
            e.target,
            { min: 0, label: `Layer ${L.name} offset` },
            value => { state.offsets[L.name] = value; }
          );
          if (!accepted) return;
          validateAndCompute();
          saveSession();
          updateLayerMetaDisplays();
        });
      });
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
        <label class="weightsBulkField" for="bulkWeight">
          <span>Weight to apply</span>
          <span class="weightsInputWithUnit">
            <input id="bulkWeight" type="text" inputmode="decimal" placeholder="0" />
            <span>lb</span>
          </span>
        </label>
        <div class="weightsBulkActions">
          <button id="applyBulkWeight" type="button" disabled>Apply to selected</button>
          <button id="selectAllWeights" type="button" class="secondary">Select all</button>
          <button id="clearWeightSelection" type="button" class="secondary">Clear selection</button>
        </div>
        <div id="weightSelectionStatus" class="tiny weightsSelectionStatus" role="status" aria-live="polite">No hoppers selected</div>
      `;
      area.appendChild(toolbar);

      const scroll = document.createElement("div");
      scroll.className = "weightsMatrixScroll";
      const table = document.createElement("table");
      table.className = "weightsMatrix";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      const corner = document.createElement("th");
      corner.scope = "col";
      corner.textContent = "Hopper";
      headerRow.appendChild(corner);
      state.layers.forEach(L=>{
        const th = document.createElement("th");
        th.scope = "col";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "weightsSelectHeader";
        button.textContent = `Layer ${L.name}`;
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
            validateAndCompute();
            saveSession();
          });
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
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
        validateAndCompute();
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
      area.appendChild(modeBar);

      const toolbar = document.createElement("div");
      toolbar.className = "splitsBulkBar hide";
      toolbar.innerHTML = `
        <label class="splitsBulkField" for="bulkResinName">
          <span>Resin name</span>
          <input id="bulkResinName" type="text" placeholder="Leave blank to keep names" />
        </label>
        <label class="splitsBulkField" for="bulkResinPct">
          <span>Percentage</span>
          <span class="splitsBulkPctInput">
            <input id="bulkResinPct" type="text" inputmode="decimal" placeholder="Leave blank to keep %" />
            <span>%</span>
          </span>
        </label>
        <div class="splitsBulkActions">
          <button id="applyBulkSplit" type="button" disabled>Apply to selected</button>
          <button id="selectAllSplits" type="button" class="secondary">Select all</button>
          <button id="clearSplitSelection" type="button" class="secondary">Clear selection</button>
          <button id="resetAllSplits" type="button" class="danger">Reset all</button>
        </div>
        <div id="splitSelectionStatus" class="tiny splitsSelectionStatus" role="status" aria-live="polite">No hoppers selected</div>
      `;
      area.appendChild(toolbar);

      const summary = document.createElement("div");
      summary.className = "splitsMatrixSummary";
      summary.setAttribute("role", "status");
      summary.setAttribute("aria-live", "polite");
      area.appendChild(summary);

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
      const table = document.createElement("table");
      table.className = "splitsMatrix";

      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");
      const corner = document.createElement("th");
      corner.scope = "col";
      corner.textContent = "Hopper";
      headerRow.appendChild(corner);

      state.layers.forEach(L=>{
        const th = document.createElement("th");
        th.scope = "col";
        th.className = "splitLayerHeader";
        th.dataset.layerColumn = L.name;

        const title = document.createElement("button");
        title.type = "button";
        title.className = "splitLayerTitle";
        title.textContent = `Layer ${L.name}`;
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

        const meta = document.createElement("div");
        meta.id = `layerMeta_${L.name}`;
        meta.className = "splitLayerMeta";
        const thick = document.createElement("span");
        thick.id = `layerThickText_${L.name}`;
        thick.className = "mono";
        const hasThickness = clampNum(state.gauge) > 0;
        const initialOffset = clampNum(state.offsets?.[L.name] ?? 0);
        const hasOffset = initialOffset !== 0;
        thick.textContent = hasThickness
          ? `${fmtTrim(clampNum(state.gauge) * (clampNum(L.layerPct) / 100), 3)} mil`
          : "";
        thick.hidden = !hasThickness;
        const separator = document.createElement("span");
        separator.id = `layerMetaSep_${L.name}`;
        separator.textContent = " · ";
        separator.hidden = !(hasThickness && hasOffset);
        const offset = document.createElement("span");
        offset.id = `layerOffText_${L.name}`;
        offset.className = "mono";
        offset.textContent = hasOffset ? `${fmtNum(initialOffset, 0)} min` : "";
        offset.hidden = !hasOffset;
        meta.hidden = !(hasThickness || hasOffset);
        meta.append(thick, separator, offset);

        const hopperTotal = document.createElement("div");
        hopperTotal.id = `hopperTotal_${L.name}`;
        hopperTotal.className = "splitColumnTotal";

        th.append(title, pctWrap, meta, hopperTotal);

        const copyFrom = copyRules[L.name];
        if (copyFrom){
          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.className = "copyBtn splitCopyBtn";
          copyButton.textContent = `Copy ${copyFrom} → ${L.name}`;
          copyButton.addEventListener("click",()=>{
            copyLayer(copyFrom, L.name);
            renderSplitsArea();
            validateAndCompute();
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
          validateAndCompute();
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
          const isInactive = !normName(hopper.resinName) && clampNum(hopper.pct) === 0 && !hopper.track;
          const td = document.createElement("td");
          td.className = `splitMatrixCell${isInactive ? " inactive" : ""}`;
          td.dataset.layerColumn = L.name;

          const addButton = document.createElement("button");
          addButton.type = "button";
          addButton.className = "splitAddResin";
          addButton.textContent = "+ Add resin";
          addButton.setAttribute("aria-label", `Add resin to ${hopperBadgeLabel(L.name, hi)}`);

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
          resinInput.placeholder = "Resin name";
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
          pctInput.placeholder = "0";
          pctInput.value = String(clampNum(hopper.pct));
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

          controls.append(pctWrap, trackControl);
          editor.append(cellTop, controls);
          td.append(addButton, editor);
          tr.appendChild(td);

          function refreshCellState(){
            const inactive = !normName(hopper.resinName) && clampNum(hopper.pct) === 0 && !hopper.track;
            td.classList.toggle("inactive", inactive);
            trackButton.classList.toggle("active", !!hopper.track);
            trackButton.setAttribute("aria-pressed", String(!!hopper.track));
            trackButton.title = hopper.track
              ? `Remove ${hopperBadgeLabel(L.name, hi)} from timeline`
              : `Track ${hopperBadgeLabel(L.name, hi)} in timeline`;
            if (!inactive) td.classList.remove("editing");
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

          addButton.addEventListener("click",()=>{
            td.classList.add("editing");
            resinInput.focus();
          });

          selector.addEventListener("change",()=>{
            selector.checked ? selected.add(key) : selected.delete(key);
            updateSelectionUI();
          });

          resinInput.addEventListener("input",(e)=>{
            hopper.resinName = normName(e.target.value);
            refreshCellState();
            validateAndCompute();
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
            const h1Input = table.querySelector(`#p_${L.name}_0`);
            if (h1Input) h1Input.value = String(clampNum(L.hoppers[0].pct));
            updateSplitTotals();
            validateAndCompute();
            saveSession();
          });

          trackButton.addEventListener("click",()=>{
            hopper.track = !hopper.track;
            refreshCellState();
            validateAndCompute();
            saveSession();
          });
          refreshCellState();
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
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
        validateAndCompute();
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

        updateSplitTotals();
        validateAndCompute();
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
            <div style="font-weight:950;margin-bottom:6px">Resin totals</div>
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
          <div class="mono" style="font-weight:950">${fmtNum(r.lbs,2)} lb</div>
        `;
        row.querySelector("[data-resin-name]").textContent = r.displayName;
        out.appendChild(row);
      });
    }

    function updateLayerMetaDisplays(){
      const g = clampNum(state.gauge);
      state.layers.forEach(L=>{
        const pct = clampNum(L.layerPct);

        const pctEl = document.getElementById(`layerPctText_${L.name}`);
        if (pctEl) pctEl.textContent = `${fmtNum(pct,2)}%`;

        const thickEl = document.getElementById(`layerThickText_${L.name}`);
        const hasThickness = g > 0;
        if (thickEl){
          thickEl.textContent = hasThickness ? `${fmtTrim(g*(pct/100),3)} mil` : "";
          thickEl.hidden = !hasThickness;
        }

        const off = clampNum(state.offsets?.[L.name] ?? 0);
        const offEl = document.getElementById(`layerOffText_${L.name}`);
        const hasOffset = off !== 0;
        if (offEl){
          offEl.textContent = hasOffset ? `${fmtNum(off,0)} min` : "";
          offEl.hidden = !hasOffset;
        }

        const separator = document.getElementById(`layerMetaSep_${L.name}`);
        if (separator) separator.hidden = !(hasThickness && hasOffset);
        const meta = document.getElementById(`layerMeta_${L.name}`);
        if (meta) meta.hidden = !(hasThickness || hasOffset);
      });
    }

  
  /* ============================
   * Validation + compute + render
   * ============================ */
  function updateCollapsedSummaries(){
    const setupStatus = $("setupSummaryStatus");
      if (setupStatus){
        const setupParts = [];
        if (state.lineRate > 0){
          setupParts.push(`${state.lineRate.toLocaleString([], { maximumFractionDigits: 2 })} lb/hr`);
        }
        const changeoverDate = parseChangeoverDate(state.changeoverTime);
        if (changeoverDate) setupParts.push(`Changeover ${fmtTime(changeoverDate)}`);
        setupStatus.textContent = setupParts.length ? setupParts.join(" · ") : "Not set";
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
        workspaceStatus.textContent = hasOutput && hasChangeover
          ? "Ready"
          : (hasOutput || hasChangeover ? "In progress" : "Needs setup");
        workspaceStatus.closest(".workspaceNavButton")?.setAttribute(
          "data-status",
          hasOutput && hasChangeover ? "ok" : (hasOutput || hasChangeover ? "info" : "neutral")
        );
      }
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
          : "None tracked";
        workspaceStatus.closest(".workspaceNavButton")?.setAttribute(
          "data-status",
          trackedCount ? "info" : "neutral"
        );
      }
    }
  }

  function validateAndCompute(){
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
        const offsetMin = clampNum(state.offsets?.[L.name] ?? 0);

        L.hoppers.forEach((h, hi)=>{
          if (!h.track) return;

          const hopperRate = layerRate * (clampNum(h.pct)/div);
          const weight = clampNum(h.weight);

          let minutesToEmpty = null;
          let totalMinutes = null;
          let startByDate = null;

          let timeText="—", startByText="—", totalRundownText="—";

          if (hopperRate > 0 && weight > 0){
            minutesToEmpty = (weight / hopperRate) * 60;
            totalMinutes = minutesToEmpty + offsetMin;

            timeText = hoursToHHMM(minutesToEmpty/60);
            totalRundownText = minutesToHHMM(totalMinutes);

            if (changeoverDate){
              startByDate = new Date(changeoverDate.getTime() - totalMinutes*60*1000);
              startByText = fmtTime(startByDate, changeoverDate);
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
        row.className = "resultRow" + (h.pumpOff ? " done" : "");
        row.innerHTML = `
          <div>
            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span class="pill mono">Layer ${h.layer}</span>
              <span class="pill mono">${h.hopperLabel}</span>
              <span data-resin-chip></span>
              ${weightChip}
              ${splitWarn}
            </div>

            <div class="meta">
              Rate: <span class="mono">${fmtNum(h.rate,2)}</span> lb/hr • Offset: <span class="mono">${fmtNum(h.offsetMin,0)}</span> min<br/>
              Time to empty: <span class="mono">${h.timeText}</span> • Total: <span class="mono">${h.totalRundownText}</span>
            </div>
          </div>

          <div style="text-align:right; white-space:nowrap; min-width: 120px;">
            <div class="muted" style="font-size:var(--font-small)">${changeoverDate ? "Start by" : "Soonest"}</div>
            <div style="font-weight:950" class="mono">${changeoverDate ? h.startByText : h.timeText}</div>

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
          validateAndCompute();
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
      syncToggleUI("hopperNamingToggle", false);
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

    function applyUIMode(mode){
      state.uiMode = mode === "advanced" ? "advanced" : "everyday";
      document.body.setAttribute("data-ui-mode", state.uiMode);
      const advanced = state.uiMode === "advanced";
      const everydayBtn = $("everydayModeBtn");
      const advancedBtn = $("advancedModeBtn");
      if (everydayBtn){ everydayBtn.classList.toggle("active", !advanced); everydayBtn.setAttribute("aria-pressed", String(!advanced)); }
      if (advancedBtn){ advancedBtn.classList.toggle("active", advanced); advancedBtn.setAttribute("aria-pressed", String(advanced)); }
      if (!advanced && ["resinCalcBlock", "recipesBlock", "toolsBlock"].includes(activeWorkspaceId)){
        setWorkspacePanel("resultsBlock", { persist: false });
      }
    }

    function setUIMode(mode){ applyUIMode(mode); saveSession(); }

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
    }

    function rebuildUIFromState(payloadMaybe){
      ensureLayers();
      renderOffsetInputs();
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
        `${next.timeText} • Total ${next.totalRundownText}`
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
    informationEl.value = resinLookup.getDescriptionInformation(resin?.description);
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
    input.value = resin.code;
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
    const exact = resinLookup.findExactResin(input.value);
    renderResinLookupResult(exact);
    resinLookupMatches = resinLookup.findResinSuggestions(input.value);
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
      code.textContent = resin.code;
      const description = document.createElement("span");
      description.className = "resinLookupOptionDescription";
      description.textContent = resin.description || "Unknown description";
      option.append(code, description);
      option.addEventListener("pointerdown", event=>event.preventDefault());
      option.addEventListener("click", ()=>selectResinLookupMatch(resin));
      suggestions.appendChild(option);
    });

    suggestions.hidden = false;
    input.setAttribute("aria-expanded", "true");
    positionResinLookupSuggestions();
  }

    // Wire inputs
    $("lineRate")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Line rate" }, value => { state.lineRate = value; })) return;
      validateAndCompute();
      saveSession();
    });
    $("gauge").addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Gauge" }, value => { state.gauge = value; })) return;
      updateLayerMetaDisplays();
      validateAndCompute();
      saveSession();
    });
    $("lineType")?.addEventListener("change",(e)=>{
      state.lineType = [1,3,5].includes(Number(e.target.value)) ? Number(e.target.value) : 3;
      ensureLayers();
      rebuildUIFromState();
      saveSession();
    });
    $("changeoverTime")?.addEventListener("input",(e)=>{ state.changeoverTime = e.target.value || ""; validateAndCompute(); saveSession(); });

    $("densitySel")?.addEventListener("change",(e)=>{
      applyDensity(e.target.value);
      saveSession();
    });

    $("themeSel")?.addEventListener("change",(e)=>{
      applyTheme(e.target.value);
      saveSession();
    });

    $("prodResinLb")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Production resin" }, value => { state.prodResinLb = value; })) return;
      renderResinCalculator();
      saveSession();
    });
    $("scrapResinLb")?.addEventListener("input",(e)=>{
      if (!acceptNumericInput(e.target, { min: 0, label: "Scrap resin" }, value => { state.scrapResinLb = value; })) return;
      renderResinCalculator();
      saveSession();
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

    $("everydayModeBtn")?.addEventListener("click", ()=>setUIMode("everyday"));
    $("advancedModeBtn")?.addEventListener("click", ()=>setUIMode("advanced"));
    $("resetTrackingBtn")?.addEventListener("click", resetTracking);
    document.querySelectorAll(".workspaceNavButton").forEach(button=>{
      button.addEventListener("click",()=>setWorkspacePanel(button.dataset.workspaceTarget));
    });
    document.querySelectorAll(".workspaceContent > .workspacePanel > summary").forEach(summary=>{
      summary.addEventListener("click",event=>{
        if (window.matchMedia("(min-width: 901px)").matches) event.preventDefault();
      });
    });
    window.addEventListener("resize", syncWorkspaceForViewport);

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
        applyTheme("light");
        rebuildUIFromState();
      }

      activeWorkspaceId = loadWorkspacePreference();
      applyUIMode(state.uiMode);
      syncWorkspaceForViewport();
      hookDetailsPersistence();
      hookCustomToggles();
      // Sync toggle UI after restore
      syncToggleUI("hopperNamingToggle", state.hopperNamingLine9 === "main");
      syncToggleUI("showPumpOffToggle", !!state.showPumpOffTracked);

      refreshConfigDropdown();

      const selVal = $("savedConfigs")?.value;
      if (selVal && selVal !== "— none saved —"){
        const cn = $("configName");
        if (cn) cn.value = selVal;
      }

      // Ensure theme/logo applied even after restore
      applyTheme(state.theme || "light");
      saveSession();
    })();

})();
