(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const serviceApi = root.PolynRecipeScanBridge;
  if (!serviceApi) return;

  function mapping(){ return root.PolynRecipeScanMapping || null; }
  function schema(){ return root.PolynRecipeScanSchema || null; }
  function config(){ return root.POLYN_SUPABASE_CONFIG || null; }

  const CAPTURE_COPY = {
    job_traveler: {
      title: "Scan Job Traveler",
      description: "Take a photo of the job traveler's product blend table, or choose an existing photo."
    },
    dosing_screen: {
      title: "Scan Dosing Screen",
      description: "Take a photo of the dosing controller's material overview screen, or choose an existing photo (screen photo or printout)."
    }
  };

  let pendingSourceType = null;  // "job_traveler" | "dosing_screen"
  let pendingOrientation = null; // "inside" | "outside" | null (null = 1-layer line or dosing_screen - neither needs it)
  let pendingScan = null;        // sanitized recipe-scan result (.recipe), as returned by the Edge Function
  let pendingPayload = null;     // built via PolynRecipeScanMapping's mapping functions, for review + apply
  let scanInFlight = false;      // guards against a second submission while one request is already in flight

  function setStatus(id, text, isError){
    const el = $(id);
    if (!el) return;
    el.textContent = text || "";
    el.classList.toggle("recipeScanReviewWarningText", !!isError);
  }

  function resetCaptureInputs(){
    const input = $("recipeScanCaptureInput");
    if (input) input.value = "";
  }

  function resetPendingScan(){
    pendingSourceType = null;
    pendingOrientation = null;
    pendingScan = null;
    pendingPayload = null;
    scanInFlight = false;
  }

  // --- entry point -----------------------------------------------------

  function startScan(sourceType){
    if (!serviceApi.getWorkspaceId()){
      alert("Connect to an RT Sync workspace before scanning.");
      return;
    }
    resetPendingScan();
    pendingSourceType = sourceType;
    // Dosing Screen never needs the orientation prompt - the controller
    // already prints/labels each row with its physical layer letter, unlike
    // Job Traveler's column order, which is ambiguous without it.
    const lineType = Number(serviceApi.getLineType());
    if (sourceType === "dosing_screen" || lineType === 1) openCaptureDialog();
    else openOrientationDialog();
  }

  // --- orientation dialog ------------------------------------------------

  function openOrientationDialog(){
    const dialog = $("recipeScanOrientationDialog");
    if (!dialog?.showModal) return;
    dialog.addEventListener("close", () => {
      const value = dialog.returnValue;
      if (value === "inside" || value === "outside"){
        pendingOrientation = value;
        openCaptureDialog();
      }
    }, { once: true });
    dialog.showModal();
  }

  // --- capture dialog ------------------------------------------------------

  function openCaptureDialog(){
    setStatus("recipeScanCaptureStatus", "");
    resetCaptureInputs();
    scanInFlight = false;
    const copy = CAPTURE_COPY[pendingSourceType] || CAPTURE_COPY.job_traveler;
    const title = $("recipeScanCaptureTitle");
    const description = $("recipeScanCaptureDescription");
    if (title) title.textContent = copy.title;
    if (description) description.textContent = copy.description;
    $("recipeScanCaptureDialog")?.showModal?.();
  }

  function closeCaptureDialog(){
    $("recipeScanCaptureDialog")?.close?.();
  }

  function captureErrorMessage(code){
    switch (code){
      case "unauthorized": return "Your session has expired. Reload the page and try again.";
      case "workspace_access_denied": return "You don't have access to scan for this workspace.";
      case "unsupported_image_type": return "Please use a JPEG, PNG, or WEBP photo.";
      case "empty_image": return "That photo appears to be empty. Try again.";
      case "image_too_large": return "That photo is too large (10 MB max).";
      case "image_signature_mismatch": return "That file doesn't look like a valid image.";
      case "parse_failed": return "The photo couldn't be read clearly. Try retaking it with better lighting and focus.";
      case "server_misconfigured": return "Recipe scanning isn't configured yet. Contact an administrator.";
      case "invalid_request": return "That request wasn't valid. Try again.";
      default: return "The scan could not be completed. Try again.";
    }
  }

  async function submitFile(file){
    if (!file || scanInFlight) return;
    scanInFlight = true;
    setStatus("recipeScanCaptureStatus", "Scanning…");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imageCheck = schema()?.validateImage?.(bytes, file.type, bytes.byteLength);
      if (imageCheck && !imageCheck.ok){
        setStatus("recipeScanCaptureStatus", captureErrorMessage(imageCheck.error), true);
        scanInFlight = false;
        return;
      }

      const token = await serviceApi.getAccessToken();
      if (!token){
        setStatus("recipeScanCaptureStatus", "Your RT Sync session isn't ready yet. Wait a moment and try again.", true);
        scanInFlight = false;
        return;
      }

      const base = config()?.url;
      if (!base){
        setStatus("recipeScanCaptureStatus", "Recipe scanning is unavailable right now.", true);
        scanInFlight = false;
        return;
      }

      const requestId = (root.crypto && root.crypto.randomUUID) ? root.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const form = new FormData();
      form.append("workspace_id", serviceApi.getWorkspaceId());
      form.append("request_id", requestId);
      form.append("image", file);
      form.append("source_type", pendingSourceType);

      const response = await fetch(`${base}/functions/v1/recipe-scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok || !body?.ok){
        setStatus("recipeScanCaptureStatus", captureErrorMessage(body?.error), true);
        scanInFlight = false;
        return;
      }

      const buildFn = pendingSourceType === "dosing_screen"
        ? mapping()?.buildDosingScreenRecipePayloadFromScan
        : mapping()?.buildRecipePayloadFromScan;
      const built = buildFn?.(body.result.recipe, {
        lineType: Number(serviceApi.getLineType()),
        orientation: pendingOrientation,
        hopperNamingMode: serviceApi.getHopperNamingMode?.()
      });
      if (!built?.ok){
        setStatus("recipeScanCaptureStatus", built?.message || "This scan could not be applied.", true);
        scanInFlight = false;
        return;
      }

      pendingScan = body.result.recipe;
      pendingPayload = built.payload;
      scanInFlight = false;
      closeCaptureDialog();
      openReviewDialog();
    } catch {
      setStatus("recipeScanCaptureStatus", "The scan could not be completed. Check your connection and try again.", true);
      scanInFlight = false;
    }
  }

  // --- review dialog ------------------------------------------------------

  function orderedScanLayers(){
    if (!pendingScan) return [];
    return pendingOrientation === "outside" ? pendingScan.layers.slice().reverse() : pendingScan.layers.slice();
  }

  function hopperValueNode(layer, hopper, hopperIndex){
    const value = document.createElement("span");
    if (!hopper.resin_name){
      value.className = "muted";
      value.textContent = "— (not read)";
    } else if (hopperIndex === 0){
      value.textContent = `${hopper.resin_name} — ${hopper.pct.toFixed(2)}% (auto)`;
    } else if (hopper.percentage_estimated){
      value.className = "recipeScanReviewEstimated";
      value.textContent = `${hopper.resin_name} — not read, defaulted to 0%`;
    } else {
      value.textContent = `${hopper.resin_name} — ${hopper.pct}%`;
    }
    return value;
  }

  // Only layer percentage is ever editable here - it's the one field that
  // structurally blocks Apply entirely when missing (applyRecipePayload
  // requires all layers to sum to 100% before anything is written), unlike
  // a single uncertain hopper, which can be applied as a 0% placeholder and
  // fixed afterward in Recipe Setup. Hopper resin/percentage stay read-only
  // by design - Recipe Setup's own inputs are better suited to that editing,
  // especially on mobile.
  function layerPctNode(layer, layerIndex){
    if (layer.layer_pct_estimated){
      const wrap = document.createElement("span");
      wrap.className = "recipeScanReviewLayerPctInput";
      const label = document.createElement("span");
      label.className = "recipeScanReviewEstimated";
      label.textContent = `Layer ${layer.name} percentage: `;
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.max = "100";
      input.step = "0.01";
      input.setAttribute("aria-label", `Layer ${layer.name} percentage`);
      input.addEventListener("input", () => {
        const value = parseFloat(input.value);
        pendingPayload.layers[layerIndex].layer_pct = Number.isFinite(value) ? value : 0;
      });
      const percentSign = document.createElement("span");
      percentSign.textContent = "%";
      wrap.append(label, input, percentSign);
      return wrap;
    }
    const span = document.createElement("span");
    span.textContent = layer.layer_pct_derived
      ? `Layer ${layer.name}: ${layer.layer_pct}% (calculated)`
      : `Layer ${layer.name}: ${layer.layer_pct}%`;
    return span;
  }

  function renderReview(){
    const content = $("recipeScanReviewContent");
    const warning = $("recipeScanReviewWarning");
    if (!content || !pendingPayload) return;
    content.replaceChildren();

    const messages = [];
    if (serviceApi.hasNonEmptyRecipe?.()) messages.push("This will overwrite your current recipe assignments in Recipe Setup.");
    if (pendingScan?.layer_percentage_total_status && pendingScan.layer_percentage_total_status !== "ok"){
      messages.push("The scanned layer percentages don't total 100% — review carefully before applying.");
    }
    if (warning){
      warning.textContent = messages.join(" ");
      warning.classList.toggle("recipeScanReviewWarningText", messages.length > 0);
    }

    const scanned = orderedScanLayers();
    pendingPayload.layers.forEach((layer, index) => {
      const scannedLayer = scanned[index];
      const card = document.createElement("div");
      card.className = "recipeScanReviewLayer";

      const head = document.createElement("div");
      head.className = "recipeScanReviewLayerHead";
      head.append(layerPctNode(layer, index));
      if (scannedLayer?.component_percentage_total_status && scannedLayer.component_percentage_total_status !== "ok"){
        const flag = document.createElement("span");
        flag.className = "recipeScanReviewEstimated";
        flag.textContent = " — components didn't total 100%";
        head.append(flag);
      }
      card.append(head);

      layer.hoppers.forEach((hopper, hopperIndex) => {
        const row = document.createElement("div");
        row.className = "recipeScanReviewHopper";
        const label = document.createElement("span");
        label.textContent = `H${hopperIndex + 1}`;
        row.append(label, hopperValueNode(layer, hopper, hopperIndex));
        card.append(row);
      });

      content.append(card);
    });
  }

  function openReviewDialog(){
    const dialog = $("recipeScanReviewDialog");
    if (!dialog?.showModal) return;
    setStatus("recipeScanReviewStatus", "");
    renderReview();
    dialog.showModal();
  }

  function closeReviewDialog(){
    $("recipeScanReviewDialog")?.close?.();
  }

  function applyReview(){
    if (!pendingPayload){ closeReviewDialog(); return; }
    const result = serviceApi.applyPayload(pendingPayload);
    if (!result?.ok){
      setStatus("recipeScanReviewStatus", result?.message || "This scan could not be applied.", true);
      return;
    }
    closeReviewDialog();
    resetPendingScan();
  }

  function retakeScan(){
    closeReviewDialog();
    pendingScan = null;
    pendingPayload = null;
    openCaptureDialog();
  }

  function cancelReview(){
    closeReviewDialog();
    resetPendingScan();
  }

  // --- wiring ------------------------------------------------------------

  $("recipeScanJobTravelerBtn")?.addEventListener("click", () => startScan("job_traveler"));
  $("recipeScanDosingScreenBtn")?.addEventListener("click", () => startScan("dosing_screen"));

  $("recipeScanCaptureBtn")?.addEventListener("click", () => $("recipeScanCaptureInput")?.click());
  $("recipeScanCaptureInput")?.addEventListener("change", event => submitFile(event.target.files?.[0]));
  $("recipeScanCaptureCancelBtn")?.addEventListener("click", () => { closeCaptureDialog(); resetPendingScan(); });

  $("recipeScanReviewCancelBtn")?.addEventListener("click", cancelReview);
  $("recipeScanReviewRetakeBtn")?.addEventListener("click", retakeScan);
  $("recipeScanReviewApplyBtn")?.addEventListener("click", applyReview);
})(typeof globalThis !== "undefined" ? globalThis : this);
