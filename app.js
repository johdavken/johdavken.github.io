  const APP_VERSION = "0.15";

  const LS_SESSION_KEY = "resinTimer.session.v0.09";
  const LS_CONFIGS_KEY  = "resinTimer.configs.v0.09";

  const DETAILS_IDS = [
    "lineSetupBlock",
    "weightsBlock",
    "offsetsBlock",
    "splitsBlock",
    "resultsBlock",
    "resinCalcBlock",
    "recipesBlock",
    "infoBlock",
    "formulasBlock",
    "changelogBlock",
    "notesBlock"
  ];

  const HOPPERS_PER_LAYER = 6;

  const state = {
    lineRate: 0,
    lineType: 3,
    changeoverTime: "",
    offsets: {},
    layers: [],
    prodResinLb: 0,
    scrapResinLb: 0,
    density: "comfort",
    theme: "dark",
    gauge: 0,
    hopperNamingLine9: "standard" // "standard" | "main"
  };

  const $ = (id) => document.getElementById(id);

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

  function parseChangeoverDate(hhmm){
  if (!hhmm) return null;

  const s = String(hhmm).trim();

  // Accept "H:MM", "HH:MM", and optional seconds "HH:MM:SS"
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;

  const hh = Number(m[1]), mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);

  // If the time is already in the past (give a small grace), assume it's tomorrow
  if (d.getTime() < now.getTime() - 60*1000) d.setDate(d.getDate() + 1);

  return d;
}
  function fmtTime(dateObj, baseDateObj){
    if (!dateObj) return "—";
    const t = dateObj.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
    if (!baseDateObj) return t;
    const sameDay =
      dateObj.getFullYear()===baseDateObj.getFullYear() &&
      dateObj.getMonth()===baseDateObj.getMonth() &&
      dateObj.getDate()===baseDateObj.getDate();
    return sameDay ? t : `${t} (+1d)`;
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
    if (lineType === 5) return { "D": "B", "E": "A" };
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
      blocksOpen
    };
  }

  function applyTheme(t){
    const allowed = new Set(["dark","light","gruvbox-dark","gruvbox-light","nord","tokyo-night","dracula","solarized-dark","solarized-light","catppuccin-mocha","catppuccin-latte","amber","high-contrast","mono"]);
    const theme = allowed.has(String(t)) ? String(t) : "dark";

    document.body.setAttribute("data-theme", theme);

    const sel = $("themeSel");
    if (sel) sel.value = theme;

    state.theme = theme;

    // Logo per theme
    const logo = $("headerLogo");
    if (logo){
      // Keep your dedicated Gruvbox header images; map the rest to light/dark
      const lightish = new Set(["light","gruvbox-light","solarized-light","catppuccin-latte","mono"]);
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

  function applyHopperNaming(v){
    const val = (v === "main") ? "main" : "standard";
    state.hopperNamingLine9 = val;

    const t = $("hopperNamingToggle");
    if (t){
      const on = (val === "main");
      t.classList.toggle("on", on);
      t.setAttribute("aria-checked", String(on));
    }
  }

  function hopperLabel(layerName, hopperIndex0){
    const L = String(layerName || "");
    const i = Number(hopperIndex0) || 0;
    if (state.hopperNamingLine9 === "main"){
      // Main + 1–5: AM, A1..A5 (also works for BM, C M, etc.)
      return (i === 0) ? `${L}M` : `${L}${i}`;
    }
    // Standard: 1–6 => A1..A6
    return `${L}${i+1}`;
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

    applyTheme(payload.theme || "dark");
    applyDensity(payload.density || "comfort");
    $("lineRate").value = String(state.lineRate);
    const g = $("gauge");
    if (g) g.value = String(state.gauge);

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

  function saveSession(){
    try{ localStorage.setItem(LS_SESSION_KEY, JSON.stringify(snapshotPayload())); }catch(e){}
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
    try{ localStorage.setItem(LS_CONFIGS_KEY, JSON.stringify(obj)); }catch(e){}
  }
  function recipeStatus(msg, type="ok"){
    const el = $("recipeStatus");
    if (!el) return;
    const cls = type==="bad" ? "status bad" : (type==="warn" ? "status" : "status ok");
    el.innerHTML = `<div class="${cls}"><div style="font-weight:950">${msg}</div></div>`;
    setTimeout(()=>{ el.innerHTML = ""; }, 4500);
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

  function normalizeConfigName(name){ return (name || "").trim().replace(/\\s+/g, " "); }

  function saveNamedConfig(){
    const name = normalizeConfigName($("configName")?.value);
    if (!name){ recipeStatus("Please enter a config name first.", "warn"); return; }
    const configs = readConfigs();
    configs[name] = snapshotPayload();
    writeConfigs(configs);
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
    writeConfigs(configs);
    refreshConfigDropdown(newName);
    recipeStatus(`Renamed "${oldName}" → "${newName}"`, "ok");
  }
  function deleteSelectedConfig(){
    const name = $("savedConfigs")?.value;
    if (!name){ recipeStatus("No config selected to delete.", "warn"); return; }
    if (!confirm(`Delete config "${name}"?`)) return;
    const configs = readConfigs();
    delete configs[name];
    writeConfigs(configs);
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

    if (!name) name = normalizeConfigName(prompt("Name for this imported config:", "Imported config") || "");
    if (!name){ recipeStatus("Import canceled (no name).", "warn"); return; }

    const configs = readConfigs();
    configs[name] = payload;
    writeConfigs(configs);
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
        state.offsets[L.name] = clampNum(e.target.value);
        validateAndCompute();
        saveSession();
        updateLayerMetaDisplays();
      });
    });
  }

  function weightId(layerName, hi){ return `w_${layerName}_${hi}`; }
  function renderWeightsArea(){
    const area = $("weightsArea");
    if (!area) return;
    area.innerHTML = "";
    state.layers.forEach(L=>{
      const box = document.createElement("div");
      box.className = "weightsLayer";
      box.innerHTML = `
        <div class="weightsTitle">
          <strong>Layer ${L.name}</strong>
          <span class="pill">Weights</span>
        </div>
        <div id="wg_${L.name}" style="display:grid; gap: var(--gap);"></div>
      `;
      area.appendChild(box);

      const grid = box.querySelector(`#wg_${L.name}`);
      for (let hi=0; hi<HOPPERS_PER_LAYER; hi++){
        const id = weightId(L.name, hi);
        const row = document.createElement("div");
        row.className = "weightsRow";
        row.innerHTML = `
          <div class="mono" style="font-weight:950;">${hopperLabel(L.name, hi)}</div>
          <input id="${id}" type="text" inputmode="decimal" placeholder="0" value="${clampNum(L.hoppers[hi].weight)}" />
        `;
        grid.appendChild(row);

        row.querySelector("input").addEventListener("input",(e)=>{
          L.hoppers[hi].weight = clampNum(e.target.value);
          validateAndCompute();
          saveSession();
        });
      }
    });
  }

  function renderSplitsArea(){
    const area = $("splitsArea");
    if (!area) return;
    area.innerHTML = "";

    const div = 100;
    const copyRules = getLayerCopyRules(state.lineType);

    function copyLayer(fromName, toName){
      const from = state.layers.find(L=>L.name===fromName);
      const to = state.layers.find(L=>L.name===toName);
      if (!from || !to) return;
      for (let i=0;i<HOPPERS_PER_LAYER;i++){
        to.hoppers[i].pct = clampNum(from.hoppers[i].pct);
        to.hoppers[i].resinName = normName(from.hoppers[i].resinName);
        to.hoppers[i].track = !!from.hoppers[i].track;
      }
      to.layerPct = clampNum(from.layerPct);
    }

    state.layers.forEach((L)=>{
      const det = document.createElement("details");
      det.className = "block";
      det.open = false;

      const layerPctText = `${fmtNum(L.layerPct,2)}%`;
      const off = clampNum(state.offsets?.[L.name] ?? 0);

      const copyFrom = copyRules[L.name];
      const copyBtnHTML = copyFrom
        ? `<button type="button" class="copyBtn" data-copyfrom="${copyFrom}" data-copyto="${L.name}">Copy ${copyFrom} → ${L.name}</button>`
        : "";

      det.innerHTML = `
        <summary>
          <div class="sumLeft">
            <div class="chev"></div>
            <div style="min-width:0">
              <div class="layerPctInline">
                <div class="layerTitle">Layer ${L.name}</div>
                <input
                  id="lp_${L.name}"
                  type="text"
                  inputmode="decimal"
                  placeholder="0"
                  value="${clampNum(L.layerPct)}"
                  aria-label="Layer ${L.name} percent"
                />
              </div>
              <div class="layerMeta"> Thickness: <span class="mono" id="layerThickText_${L.name}">${(clampNum(state.gauge)>0)?`${fmtTrim(clampNum(state.gauge)*(clampNum(L.layerPct)/100),3)} mil`:"—"}</span> • Offset: <span class="mono" id="layerOffText_${L.name}">${fmtNum(off,0)} min</span></div>
            </div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            ${copyBtnHTML}
            <span class="pill hide">Splits</span>
          </div>
        </summary>
        <div class="blockBody">
          <div class="hopperList" id="list_${L.name}"></div>
        </div>
      `;
      area.appendChild(det);

      const lpEl = det.querySelector(`#lp_${L.name}`);
      if (lpEl){
        ["click","mousedown","keydown"].forEach(evt =>
          lpEl.addEventListener(evt, (e)=> e.stopPropagation())
        );
        lpEl.addEventListener("input",(e)=>{
          L.layerPct = clampNum(e.target.value);
          validateAndCompute();
          saveSession();
          updateLayerMetaDisplays();
        });
      }

      const copyBtn = det.querySelector(".copyBtn");
      if (copyBtn){
        copyBtn.addEventListener("click",(e)=>{
          e.preventDefault(); e.stopPropagation();
          const from = copyBtn.getAttribute("data-copyfrom");
          const to = copyBtn.getAttribute("data-copyto");
          const ok = confirm(`Copy layer % + splits + resin names + track toggles from Layer ${from} → Layer ${to}?`);
          if (!ok) return;
          copyLayer(from, to);
          renderSplitsArea();
          validateAndCompute();
          saveSession();
        });
        copyBtn.addEventListener("keydown",(e)=>e.stopPropagation());
      }

      const list = det.querySelector(`#list_${L.name}`);

      for (let hi=0; hi<HOPPERS_PER_LAYER; hi++){
        const resinFieldId = `r_${L.name}_${hi}`;
        const pctFieldId = `p_${L.name}_${hi}`;
        const toggleId = `t_${L.name}_${hi}`;

        const row = document.createElement("div");
        row.className = "hopperRow";
        row.innerHTML = `
          <div class="hopperBadge mono">${hopperLabel(L.name, hi)}</div>
          <input id="${resinFieldId}" class="resinNameInput" type="text" placeholder="Resin name" value="${(L.hoppers[hi].resinName || "").replace(/"/g,'&quot;')}" />
          <input id="${pctFieldId}" class="splitInput" type="text" inputmode="decimal" placeholder="0" value="${clampNum(L.hoppers[hi].pct)}" />
          <div class="trackWrap">
            <span class="trackLabel">Track</span>
            <div id="${toggleId}" class="toggle ${L.hoppers[hi].track ? "on":""}" role="switch" aria-checked="${L.hoppers[hi].track ? "true":"false"}" tabindex="0"></div>
          </div>
        `;
        list.appendChild(row);

        const resinEl = row.querySelector(`#${resinFieldId}`);
        const pctEl = row.querySelector(`#${pctFieldId}`);
        if (hi === 0){
          pctEl.readOnly = true;
          pctEl.title = "Auto (100% minus other hoppers)";
          pctEl.style.opacity = "0.85";
        }

        const togEl = row.querySelector(`#${toggleId}`);

        resinEl.addEventListener("input",(e)=>{
          L.hoppers[hi].resinName = normName(e.target.value);
          renderResinCalculator();
          saveSession();
        });

        pctEl.addEventListener("input",(e)=>{
          if (hi === 0) return;
          L.hoppers[hi].pct = clampNum(e.target.value);

          recomputeAutoH1(L);

          const h1Id = `p_${L.name}_0`;
          const h1El = det.querySelector(`#${h1Id}`);
          if (h1El) h1El.value = String(clampNum(L.hoppers[0].pct));

          validateAndCompute();
          saveSession();
        });

        function toggleTrack(){
          L.hoppers[hi].track = !L.hoppers[hi].track;
          togEl.classList.toggle("on", L.hoppers[hi].track);
          togEl.setAttribute("aria-checked", L.hoppers[hi].track ? "true" : "false");
          validateAndCompute();
          saveSession();
        }
        togEl.addEventListener("click",(e)=>{ e.preventDefault(); toggleTrack(); });
        togEl.addEventListener("keydown",(e)=>{
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTrack(); }
        });
      }
    });
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
          <div class="calcName mono">${r.displayName}</div>
          <div class="calcMeta">Allocated from splits</div>
        </div>
        <div class="mono" style="font-weight:950">${fmtNum(r.lbs,2)} lb</div>
      `;
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
      if (thickEl) thickEl.textContent = (g>0) ? `${fmtTrim(g*(pct/100),3)} mil` : "—";

      const off = clampNum(state.offsets?.[L.name] ?? 0);
      const offEl = document.getElementById(`layerOffText_${L.name}`);
      if (offEl) offEl.textContent = `${fmtNum(off,0)} min`;
    });
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

    const tracked = [];
    state.layers.forEach(L=>L.hoppers.forEach((h,hi)=>{ if (h.track) tracked.push({L,h,hi}); }));
    if (tracked.length === 0){
      msgs.push({type:"warn", text:"No hoppers are tracked. Turn on Track for the hopper(s) you want in Results."});
    } else {
      const missingW = tracked.filter(x=>clampNum(x.h.weight) <= 0).length;
      if (missingW > 0){
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
          hopperLabel: `${hopperLabel(L.name, hi)}`,
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
    saveSession();
  }

  function renderResultsFlat(flat, changeoverDate){
    const area = $("resultsArea");
    if (!area) return;
    area.innerHTML = "";

    if (flat.length === 0){
      area.innerHTML = `<div class="muted">No tracked hoppers yet. Turn on Track in “Hopper Percentages”.</div>`;
      return;
    }

    flat.sort((a,b)=>{
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

    flat.forEach((h)=>{
      const resinChip = h.resinName ? `<span class="pill mono">${h.resinName}</span>` : `<span class="pill badge-warn">No resin name</span>`;
      const weightChip = h.weight > 0 ? `<span class="muted mono">${fmtNum(h.weight,2)} lb</span>` : `<span class="pill badge-warn">Missing weight</span>`;
      const splitWarn = (h.rate <= 0 && h.weight > 0) ? `<span class="pill badge-warn">Split?</span>` : "";

      const row = document.createElement("div");
      row.className = "resultRow" + (h.pumpOff ? " done" : "");
      row.innerHTML = `
        <div>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span class="pill mono">Layer ${h.layer}</span>
            <span class="pill mono">${h.hopperLabel}</span>
            ${resinChip}
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

      row.querySelector('input[type="checkbox"]').addEventListener("change",(e)=>{
        h._ref.h.pumpOff = !!e.target.checked;
        saveSession();
        validateAndCompute();
      });

      area.appendChild(row);
    });
  }

  function resetAll(){
    const ok = confirm("Reset all fields?\\n\\nPress OK to reset.\\nPress Cancel to keep current values.");
    if (!ok) return;

    const clearSaved = confirm("Also clear saved session (autosave) data on this device?");
    if (clearSaved) clearSession();

    state.lineRate = 0;
    state.changeoverTime = "";
    state.gauge = 0;
    state.prodResinLb = 0;
    state.scrapResinLb = 0;
    state.hopperNamingLine9 = "standard";

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
  if (!msgEl || !subEl) return;

  if (!flat || flat.length === 0){
    msgEl.textContent = "No tracked hoppers";
    subEl.textContent = `ResinIQ • v${APP_VERSION}`;
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
      msgEl.textContent = `Next pump off: ${next.hopperLabel}${next.resinName ? ` • ${next.resinName}` : ""}`;
      subEl.textContent = `${next.startByText} (${fmtRelFromNow(next.startByDate)}) • Changeover ${fmtTime(changeoverDate)}`;
      return;
    }
  }

  // Fallback: soonest empty (if no changeover or no valid start-by)
  const candidates2 = flat
    .filter(x => Number.isFinite(x.minutesToEmpty) && x.minutesToEmpty >= 0 && !x.pumpOff)
    .sort((a,b)=>a.minutesToEmpty-b.minutesToEmpty);

  next = candidates2[0] || null;

  if (next){
    msgEl.textContent = `Soonest empty: ${next.hopperLabel}${next.resinName ? ` • ${next.resinName}` : ""}`;
    subEl.textContent = `${next.timeText} • Total ${next.totalRundownText}`;
  } else {
    msgEl.textContent = "No upcoming hoppers (all checked off or missing data)";
    subEl.textContent = `ResinIQ • v${APP_VERSION}`;
  }
}

  // Wire inputs
  $("lineRate")?.addEventListener("input",(e)=>{ state.lineRate = clampNum(e.target.value); validateAndCompute(); saveSession(); });
  $("gauge").addEventListener("input",(e)=>{ state.gauge = clampNum(e.target.value); updateLayerMetaDisplays(); validateAndCompute(); saveSession(); });
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


  // Line 9 hopper naming (AM/A1..A5 vs A1..A6)
  (function wireHopperNamingToggle(){
    const t = $("hopperNamingToggle");
    if (!t) return;

    function flip(){
      const next = (state.hopperNamingLine9 === "main") ? "standard" : "main";
      applyHopperNaming(next);
      // Re-render labels everywhere they appear
      renderWeightsArea();
      renderSplitsArea();
      validateAndCompute();
      saveSession();
    }

    t.addEventListener("click",(e)=>{ e.preventDefault(); flip(); });
    t.addEventListener("keydown",(e)=>{
      if (e.key === "Enter" || e.key === " "){
        e.preventDefault();
        flip();
      }
    });

    // Ensure visual state matches loaded state
    applyHopperNaming(state.hopperNamingLine9);
  })();

  $("prodResinLb")?.addEventListener("input",(e)=>{ state.prodResinLb = clampNum(e.target.value); renderResinCalculator(); saveSession(); });
  $("scrapResinLb")?.addEventListener("input",(e)=>{ state.scrapResinLb = clampNum(e.target.value); renderResinCalculator(); saveSession(); });

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
      applyTheme("dark");
      rebuildUIFromState();
    }

    hookDetailsPersistence();
    refreshConfigDropdown();

    const selVal = $("savedConfigs")?.value;
    if (selVal && selVal !== "— none saved —"){
      const cn = $("configName");
      if (cn) cn.value = selVal;
    }

    // Ensure theme/logo applied even after restore
    applyTheme(state.theme || "dark");
    saveSession();
  })();

