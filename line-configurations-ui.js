(function(root){
  "use strict";
  const $ = id => document.getElementById(id);
  const api = root.PolynLineConfigurations;
  const identity = root.PolynLineIdentity;
  if (!api || !identity) return;
  let service = null;
  let lines = [];
  let selected = null;
  const choices = { layer_a_position:"", hopper_geometry:"cylindrical", hopper_naming_mode:"standard" };

  function admin(){ return root.PolynResinAdminInstance || null; }
  function setMessage(id, text, type=""){
    const el = $(id); if (!el) return;
    el.textContent = text || ""; el.className = `tiny${type ? ` ${type}` : ""}`;
  }
  function ensureService(){
    const client = admin()?.getClient?.();
    if (!client) return null;
    if (!service) service = api.createAdminService(client);
    return service;
  }
  function labelPosition(value){ return value === "inside" ? "A Inside" : value === "outside" ? "A Outside" : "A N/A"; }
  function labelGeometry(value){ return value === "volume" ? "Volume" : "Cylindrical"; }
  function labelNaming(value){ return value === "main-plus-five" ? "Main + 1–5" : "Standard"; }
  function render(){
    const host = $("lineConfigurationList"); if (!host) return;
    host.replaceChildren();
    lines.forEach(line=>{
      const row = document.createElement("div");
      row.className = `lineConfigurationRow${line.is_active ? "" : " inactive"}`;
      const info = document.createElement("div"); info.className = "lineConfigurationRowInfo";
      const title = document.createElement("strong"); title.textContent = line.display_name;
      const detail = document.createElement("small");
      detail.textContent = `${line.layer_count} layer${line.layer_count === 1 ? "" : "s"} · ${labelPosition(line.layer_a_position)} · ${labelGeometry(line.hopper_geometry)} · ${labelNaming(line.hopper_naming_mode)}${line.is_active ? "" : " · Inactive"}`;
      info.append(title, detail);
      const edit = document.createElement("button"); edit.type="button"; edit.className="secondary lineConfigurationEdit";
      edit.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20ZM13.5 6.5 17 10"/></svg><span>Edit</span>';
      edit.addEventListener("click", ()=>openEditor(line));
      row.append(info,edit); host.append(row);
    });
    if (!lines.length){ const empty=document.createElement("div"); empty.className="muted"; empty.textContent="No line configurations found."; host.append(empty); }
  }
  async function load(){
    const current = ensureService(); if (!current) return;
    setMessage("lineConfigurationMessage","Loading line configurations…");
    const result = await current.list();
    if (!result.ok){ setMessage("lineConfigurationMessage",result.message,"bad"); return; }
    lines = result.lines; render();
    setMessage("lineConfigurationMessage",`${lines.length} line configuration${lines.length === 1 ? "" : "s"} loaded.`,"ok");
  }
  function setChoice(name,value){
    choices[name] = value;
    document.querySelectorAll(`[data-line-choice="${name}"]`).forEach(button=>{
      const on = button.dataset.value === String(value ?? ""); button.classList.toggle("selected",on); button.setAttribute("aria-pressed",String(on));
    });
  }
  function setActive(value){ const button=$("lineConfigurationActive"); button?.classList.toggle("on",!!value); button?.setAttribute("aria-checked",String(!!value)); }
  function isActive(){ return $("lineConfigurationActive")?.getAttribute("aria-checked") === "true"; }
  function openEditor(line){
    selected = line || null;
    $("lineConfigurationId").value = line?.id || "";
    $("lineConfigurationNumber").value = line?.line_number ?? "";
    $("lineConfigurationName").value = line?.display_name || "";
    $("lineConfigurationAliases").value = (line?.aliases || []).join("\n");
    $("lineConfigurationLayers").value = line?.layer_count ?? 3;
    setChoice("layer_a_position",line?.layer_a_position ?? "outside");
    setChoice("hopper_geometry",line?.hopper_geometry || "cylindrical");
    setChoice("hopper_naming_mode",line?.hopper_naming_mode || "standard");
    setActive(line?.is_active ?? true);
    $("lineConfigurationDialogTitle").textContent = line ? `Edit ${line.display_name}` : "Add Line";
    $("lineConfigurationDeactivate").hidden = !line?.id || !line?.is_active;
    setMessage("lineConfigurationFormMessage","");
    $("lineConfigurationDialog")?.showModal(); $("lineConfigurationNumber")?.focus();
  }
  function close(){ const dialog=$("lineConfigurationDialog"); if(dialog?.open) dialog.close(); selected=null; }
  function values(){
    return { line_number:$("lineConfigurationNumber").value, display_name:$("lineConfigurationName").value,
      aliases:$("lineConfigurationAliases").value.split(/[\n,]+/).map(value=>value.trim()).filter(Boolean),
      layer_count:$("lineConfigurationLayers").value, layer_a_position:choices.layer_a_position || null,
      hopper_geometry:choices.hopper_geometry, hopper_naming_mode:choices.hopper_naming_mode,
      is_active:isActive(), metadata:selected?.metadata || {} };
  }
  async function save(nextValues=values()){
    const candidate=identity.normalizedDefinition(nextValues);
    const combined=lines.filter(line=>line.id !== selected?.id).concat(candidate);
    const checked=identity.validateLineConfigurations(combined);
    if(!checked.valid){ setMessage("lineConfigurationFormMessage",checked.message,"bad"); return; }
    const button=$("lineConfigurationSave"); button.disabled=true; setMessage("lineConfigurationFormMessage","Saving…");
    const result=await ensureService().save(selected?.id || null,nextValues); button.disabled=false;
    if(!result.ok){ setMessage("lineConfigurationFormMessage",result.message,"bad"); return; }
    close(); await load(); setMessage("lineConfigurationMessage",`${candidate.displayName} saved. Connected devices will use it after configuration refresh.`,"ok");
  }

  api.initialize();
  function renderAccess(state){
    const access=!!state?.ready && !!state?.isAdmin;
    const button=$("lineConfigurationButton"); if(button) button.hidden=!access;
    if(!access){ const panel=$("lineConfigurationBlock"); if(panel) panel.open=false; close(); lines=[]; render(); }
  }
  admin()?.subscribe(renderAccess);
  renderAccess(admin()?.getState?.());
  $("lineConfigurationButton")?.addEventListener("click",()=>{ if(!admin()?.getState().isAdmin)return; $("lineConfigurationBlock").open=true; load(); });
  $("lineConfigurationRefresh")?.addEventListener("click",load);
  $("lineConfigurationAdd")?.addEventListener("click",()=>openEditor(null));
  $("lineConfigurationClose")?.addEventListener("click",close); $("lineConfigurationCancel")?.addEventListener("click",close);
  $("lineConfigurationActive")?.addEventListener("click",()=>setActive(!isActive()));
  document.querySelectorAll("[data-line-choice]").forEach(button=>button.addEventListener("click",()=>setChoice(button.dataset.lineChoice,button.dataset.value)));
  $("lineConfigurationNumber")?.addEventListener("input",event=>{ if(!selected && (!$("lineConfigurationName").value || /^Line \d+$/.test($("lineConfigurationName").value))) $("lineConfigurationName").value=event.target.value ? `Line ${event.target.value}` : ""; });
  $("lineConfigurationLayers")?.addEventListener("input",event=>{ if(Number(event.target.value)===1) setChoice("layer_a_position",""); else if(choices.layer_a_position==="") setChoice("layer_a_position","outside"); });
  $("lineConfigurationDeactivate")?.addEventListener("click",()=>{ if(!selected || !confirm(`Deactivate ${selected.display_name}? Structured workspace identities will still resolve, but names and aliases will no longer match this line.`)) return; setActive(false); save(values()); });
  $("lineConfigurationForm")?.addEventListener("submit",event=>{ event.preventDefault(); save(); });
})(typeof globalThis !== "undefined" ? globalThis : this);
