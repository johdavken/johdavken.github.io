(function(root){
  "use strict";
  const $ = id => document.getElementById(id);
  const admin = root.PolynResinAdminInstance;
  const measurement = root.PolynBulkDensityMeasurement;
  if (!admin || !measurement) return;

  let resins = [];
  let selectedResin = null;
  let currentMeasurement = null;
  let authorized = false;
  let searchMatches = [];

  function setStatus(message, type = ""){
    const status = $("bulkDensityStatus");
    if (!status) return;
    status.textContent = message || "";
    status.className = `tiny${type ? ` ${type}` : ""}`;
  }

  function formatBulkDensity(value){
    return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)} lb/ft³` : "Not set";
  }

  function closeSuggestions(){
    const input = $("bulkDensityResinSearch");
    const list = $("bulkDensityResinSuggestions");
    if (list) list.hidden = true;
    input?.setAttribute("aria-expanded", "false");
  }

  function renderSelectedResin(){
    const card = $("bulkDensitySelectedResin");
    if (!card) return;
    card.hidden = !selectedResin;
    if (!selectedResin) return;
    $("bulkDensitySelectedCode").textContent = selectedResin.resin_code;
    $("bulkDensitySelectedDescription").textContent = selectedResin.display_description || "No description";
    $("bulkDensityCurrentValue").textContent = formatBulkDensity(selectedResin.bulk_density_lb_ft3);
  }

  function clearSelectedResin(){
    selectedResin = null;
    renderSelectedResin();
    updateMeasurement();
  }

  function selectResin(resin){
    if (!resin?.id || resin.is_active !== true) return;
    selectedResin = { ...resin };
    $("bulkDensityResinSearch").value = resin.resin_code;
    $("bulkDensityPolymerDensity").value = resin.density_g_cm3 ?? "";
    renderSelectedResin();
    closeSuggestions();
    updateMeasurement();
  }

  function renderSuggestions(){
    const input = $("bulkDensityResinSearch");
    const list = $("bulkDensityResinSuggestions");
    if (!input || !list) return;
    const query = input.value.trim().toLocaleLowerCase();
    searchMatches = resins.filter(resin => !query
      || resin.resin_code.toLocaleLowerCase().includes(query)
      || String(resin.display_description || "").toLocaleLowerCase().includes(query)).slice(0, 30);
    list.replaceChildren();
    searchMatches.forEach(resin => {
      const option = document.createElement("button");
      option.type = "button";
      option.role = "option";
      option.className = "bulkDensityResinOption";
      option.innerHTML = `<strong></strong><span></span>`;
      option.querySelector("strong").textContent = resin.resin_code;
      option.querySelector("span").textContent = resin.display_description || "No description";
      option.addEventListener("click", () => selectResin(resin));
      list.appendChild(option);
    });
    list.hidden = !searchMatches.length;
    input.setAttribute("aria-expanded", String(searchMatches.length > 0));
  }

  function updateMeasurement(){
    const weightInput = $("bulkDensityResinWeight");
    const polymerInput = $("bulkDensityPolymerDensity");
    const primary = $("bulkDensityResultLbFt3");
    const secondary = $("bulkDensityResultGCm3");
    const packing = $("bulkDensityPackingFactor");
    const warnings = $("bulkDensityWarnings");
    const save = $("bulkDensitySaveButton");
    const hint = $("bulkDensitySaveHint");
    if (!weightInput || !polymerInput || !primary || !secondary || !packing || !warnings || !save || !hint) return;

    weightInput.setCustomValidity("");
    polymerInput.setCustomValidity("");
    weightInput.setAttribute("aria-invalid", "false");
    polymerInput.setAttribute("aria-invalid", "false");
    currentMeasurement = measurement.calculate({
      resinWeightLb:weightInput.value,
      polymerDensityGCm3:polymerInput.value
    });

    if (!currentMeasurement.valid){
      primary.textContent = "—";
      secondary.textContent = "— g/cm³";
      packing.textContent = "—";
      const message = currentMeasurement.errors[0] || "Enter a valid measurement.";
      const hasInput = !!(weightInput.value.trim() || polymerInput.value.trim());
      warnings.textContent = hasInput ? message : "";
      if (hasInput && /resin weight/i.test(message)){
        weightInput.setCustomValidity(message);
        weightInput.setAttribute("aria-invalid", "true");
      }else if (hasInput){
        polymerInput.setCustomValidity(message);
        polymerInput.setAttribute("aria-invalid", "true");
      }
    }else{
      primary.textContent = currentMeasurement.bulkDensityLbFt3.toFixed(1);
      secondary.textContent = `${currentMeasurement.bulkDensityGCm3.toFixed(3)} g/cm³`;
      packing.textContent = currentMeasurement.packingFactor === null ? "Not available" : currentMeasurement.packingFactor.toFixed(3);
      warnings.textContent = currentMeasurement.warnings.join(" ");
    }

    const savable = authorized && !!selectedResin?.id && selectedResin.is_active === true
      && currentMeasurement.valid && currentMeasurement.databaseAllowed;
    save.disabled = !savable;
    if (!authorized) hint.textContent = "Administrator access is required.";
    else if (!selectedResin) hint.textContent = "Select an active resin to enable saving.";
    else if (!currentMeasurement.valid) hint.textContent = "Enter a valid net resin weight.";
    else if (!currentMeasurement.databaseAllowed) hint.textContent = "This result is outside the database’s allowed range.";
    else hint.textContent = `Ready to update ${selectedResin.resin_code}.`;
  }

  async function loadResins({ preserveSelection = true } = {}){
    if (!admin.getState().isAdmin) return;
    setStatus("Loading active resin records…");
    const selectedId = preserveSelection ? selectedResin?.id : "";
    const result = await admin.listResins();
    if (!result.ok){ setStatus(result.message, "bad"); return; }
    resins = result.resins.filter(resin => resin.is_active === true);
    if (selectedId){
      const refreshed = resins.find(resin => resin.id === selectedId);
      if (refreshed) selectResin(refreshed);
      else clearSelectedResin();
    }
    setStatus(`${resins.length} active resin records available.`);
  }

  function openSaveConfirmation(){
    if (!authorized || !selectedResin || !currentMeasurement?.valid || !currentMeasurement.databaseAllowed) return;
    const oldValue = formatBulkDensity(selectedResin.bulk_density_lb_ft3);
    const newValue = formatBulkDensity(currentMeasurement.bulkDensityLbFt3);
    $("bulkDensitySaveConfirmation").textContent = `Update ${selectedResin.resin_code} bulk density from ${oldValue} to ${newValue}?`;
    $("bulkDensitySaveDialogStatus").textContent = "";
    $("bulkDensitySaveDialog")?.showModal();
  }

  async function confirmSave(){
    const dialog = $("bulkDensitySaveDialog");
    const button = $("bulkDensityConfirmSave");
    if (!selectedResin || !currentMeasurement?.valid || !authorized) return;
    button.disabled = true;
    $("bulkDensitySaveDialogStatus").textContent = "Saving measured bulk density…";
    const resinId = selectedResin.id;
    const resinCode = selectedResin.resin_code;
    const result = await admin.updateBulkDensity(resinId, selectedResin.updated_at, currentMeasurement.bulkDensityLbFt3);
    button.disabled = false;
    if (!result.ok){
      dialog?.close("error");
      if (["record_changed", "inactive_resin", "missing_resin"].includes(result.code)) await loadResins();
      setStatus(result.message, "bad");
      return;
    }
    dialog?.close("saved");
    await loadResins();
    setStatus(`${resinCode} bulk density saved as ${Number(result.resin.bulk_density_lb_ft3).toFixed(1)} lb/ft³.${result.catalogRefreshed ? "" : " Catalog refresh will retry when online."}`, "ok");
  }

  function resetTool(){
    selectedResin = null;
    resins = [];
    searchMatches = [];
    $("bulkDensityResinSearch").value = "";
    $("bulkDensityPolymerDensity").value = "";
    $("bulkDensityResinWeight").value = "";
    renderSelectedResin();
    closeSuggestions();
    updateMeasurement();
    setStatus("");
  }

  function renderAccess(state){
    const initializing = !state?.ready;
    authorized = !initializing && !!state?.isAdmin;
    const destination = $("bulkDensityMeasurementButton");
    if (destination) destination.hidden = initializing || !authorized;
    if (!authorized){
      const panel = $("bulkDensityMeasurementBlock");
      if (panel?.classList.contains("desktop-active") || panel?.classList.contains("mobile-active")){
        document.querySelector('[data-workspace-target="resultsBlock"]')?.click();
      }
      panel?.classList.remove("desktop-active", "mobile-active");
      if (panel) panel.open = false;
      resetTool();
    }else updateMeasurement();
  }

  admin.subscribe(renderAccess);
  renderAccess(admin.getState());
  $("bulkDensityMeasurementButton")?.addEventListener("click", () => {
    if (!admin.getState().isAdmin) return;
    $("bulkDensityMeasurementBlock").open = true;
    void loadResins();
  });
  $("bulkDensityResinSearch")?.addEventListener("focus", renderSuggestions);
  $("bulkDensityResinSearch")?.addEventListener("input", event => {
    if (selectedResin && event.target.value.trim().toLocaleLowerCase() !== selectedResin.resin_code.toLocaleLowerCase()) clearSelectedResin();
    renderSuggestions();
  });
  $("bulkDensityResinSearch")?.addEventListener("keydown", event => {
    if (event.key === "Escape") closeSuggestions();
    if (event.key === "Enter" && searchMatches.length){
      event.preventDefault();
      selectResin(searchMatches[0]);
    }
  });
  document.addEventListener("pointerdown", event => {
    if (!event.target.closest?.(".bulkDensityResinSearch, .bulkDensityResinSuggestions")) closeSuggestions();
  });
  $("bulkDensityPolymerDensity")?.addEventListener("input", updateMeasurement);
  $("bulkDensityResinWeight")?.addEventListener("input", updateMeasurement);
  $("bulkDensitySaveButton")?.addEventListener("click", openSaveConfirmation);
  $("bulkDensityConfirmSave")?.addEventListener("click", () => void confirmSave());
})(typeof globalThis !== "undefined" ? globalThis : this);
