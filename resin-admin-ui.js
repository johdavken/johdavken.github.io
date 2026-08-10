(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const serviceApi = root.PolynResinAdmin;
  if (!serviceApi) return;
  const admin = serviceApi.create({ catalog: root.PolynResinCatalog });
  // Shared with workspace-recovery-ui.js so recovery reuses this same admin
  // client/session instead of creating a second admin Supabase client.
  root.PolynResinAdminInstance = admin;
  let resins = [];
  let selectedResinId = "";

  function setMessage(id, message, type = ""){
    const el = $(id);
    if (!el) return;
    el.textContent = message || "";
    el.className = `tiny${type ? ` ${type}` : ""}`;
  }
  function renderAccess(state){
    const initializing = !state?.ready;
    const adminAccess = !initializing && !!state?.isAdmin;
    $("adminLoginButton").hidden = initializing || adminAccess;
    $("resinDatabaseButton").hidden = !adminAccess;
    $("adminSignOutButton").hidden = !adminAccess;
    if (!adminAccess){
      const panel = $("resinAdminBlock");
      if (panel?.classList.contains("desktop-active") || panel?.open) document.querySelector('[data-workspace-target="resultsBlock"]')?.click();
      panel?.classList.remove("desktop-active");
      if (panel) panel.open = false;
      selectedResinId = "";
      $("adminResinForm").hidden = true;
    }
  }
  function filteredResins(){
    const query = $("adminResinSearch")?.value.trim().toLocaleLowerCase() || "";
    return resins.filter(resin => !query || resin.resin_code.toLocaleLowerCase().includes(query)
      || String(resin.display_description || "").toLocaleLowerCase().includes(query));
  }
  function renderList(){
    const list = $("adminResinList");
    if (!list) return;
    list.replaceChildren();
    filteredResins().forEach(resin => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `adminResinRow${resin.is_active ? "" : " inactive"}${resin.id === selectedResinId ? " selected" : ""}`;
      row.textContent = `${resin.resin_code} — ${resin.display_description || "Unknown description"}${resin.is_active ? "" : " (inactive)"}`;
      row.addEventListener("click", ()=>showForm(resin));
      list.appendChild(row);
    });
    if (!list.children.length) list.textContent = "No matching resin records.";
  }
  function showForm(resin){
    selectedResinId = resin?.id || "";
    renderList();
    $("adminResinForm").hidden = false;
    $("adminResinFormTitle").textContent = resin ? "Edit resin" : "Add resin";
    $("adminResinId").value = resin?.id || "";
    $("adminResinCode").value = resin?.resin_code || "";
    $("adminResinDescription").value = resin?.display_description || "";
    $("adminResinDensity").value = resin?.density_g_cm3 ?? "";
    $("adminResinBulkDensity").value = resin?.bulk_density_lb_ft3 ?? "";
    $("adminResinInformation").value = resin?.information_description || "";
    $("adminResinActive").value = String(resin?.is_active ?? true);
    $("adminResinDelete").hidden = !resin?.id;
    setMessage("adminResinFormMessage", "");
    $("adminResinCode").focus();
  }
  function hideForm(){ selectedResinId = ""; $("adminResinForm").hidden = true; $("adminResinForm").reset(); renderList(); }
  async function loadResins(){
    setMessage("adminResinMessage", "Loading resin database…");
    const result = await admin.listResins();
    if (!result.ok){ setMessage("adminResinMessage", result.message, "bad"); return; }
    resins = result.resins;
    renderList();
    setMessage("adminResinMessage", `${resins.length} resin records loaded.`, "ok");
  }
  function duplicateCode(code, id){
    return resins.some(resin => resin.id !== id && resin.resin_code.toLocaleLowerCase() === code.trim().toLocaleLowerCase());
  }

  admin.subscribe(renderAccess);
  renderAccess(admin.getState());
  $("adminLoginButton")?.addEventListener("click", ()=>{ setMessage("adminLoginMessage", ""); $("adminLoginDialog")?.showModal(); $("adminEmail")?.focus(); });
  document.querySelectorAll("[data-admin-close]").forEach(button=>button.addEventListener("click", ()=>$("adminLoginDialog")?.close()));
  $("adminLoginForm")?.addEventListener("submit", async event=>{
    event.preventDefault();
    const submit = $("adminLoginSubmit"); submit.disabled = true;
    setMessage("adminLoginMessage", "Signing in…");
    const result = await admin.signIn($("adminEmail").value, $("adminPassword").value);
    submit.disabled = false;
    if (!result.ok){ setMessage("adminLoginMessage", result.message, "bad"); return; }
    $("adminLoginDialog").close(); $("adminLoginForm").reset();
  });
  $("resinDatabaseButton")?.addEventListener("click", async ()=>{
    if (!admin.getState().isAdmin) return;
    $("resinAdminBlock").open = true; hideForm(); await loadResins();
  });
  $("adminSignOutButton")?.addEventListener("click", ()=>admin.signOut());
  $("adminResinSearch")?.addEventListener("input", renderList);
  $("addResinButton")?.addEventListener("click", ()=>showForm(null));
  $("adminResinCancel")?.addEventListener("click", hideForm);
  $("adminResinDelete")?.addEventListener("click", async ()=>{
    const id = $("adminResinId").value;
    const resin = resins.find(item => item.id === id);
    if (!id || !resin) return;
    if (!confirm(`Permanently delete ${resin.resin_code}? Use Inactive instead if this catalog record may be needed again. This cannot be undone.`)) return;
    const button = $("adminResinDelete");
    button.disabled = true;
    setMessage("adminResinFormMessage", "Deleting…");
    const result = await admin.deleteResin(id);
    button.disabled = false;
    if (!result.ok){ setMessage("adminResinFormMessage", result.message, "bad"); return; }
    hideForm();
    await loadResins();
    setMessage("adminResinMessage", `${resin.resin_code} deleted.`, "ok");
  });
  $("adminResinForm")?.addEventListener("submit", async event=>{
    event.preventDefault();
    const id = $("adminResinId").value;
    const values = {
      resin_code: $("adminResinCode").value,
      display_description: $("adminResinDescription").value,
      density_g_cm3: $("adminResinDensity").value,
      bulk_density_lb_ft3: $("adminResinBulkDensity").value,
      information_description: $("adminResinInformation").value,
      is_active: $("adminResinActive").value === "true"
    };
    if (duplicateCode(values.resin_code, id)){ setMessage("adminResinFormMessage", "That resin code already exists.", "bad"); return; }
    const save = $("adminResinSave"); save.disabled = true; setMessage("adminResinFormMessage", "Saving…");
    const result = await admin.saveResin(id || null, values);
    save.disabled = false;
    if (!result.ok){ setMessage("adminResinFormMessage", result.message, "bad"); return; }
    selectedResinId = result.resin.id;
    setMessage("adminResinMessage", "Resin saved. The active catalog has been refreshed.", "ok");
    await loadResins();
    showForm(resins.find(resin=>resin.id === selectedResinId) || result.resin);
  });
  admin.initialize();
})(typeof globalThis !== "undefined" ? globalThis : this);
