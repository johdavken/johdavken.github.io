(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const serviceApi = root.PolynRecipeScanBridge;
  if (!serviceApi) return;

  function mapping(){ return root.PolynRecipeScanMapping || null; }
  function schema(){ return root.PolynRecipeScanSchema || null; }
  function config(){ return root.POLYN_SUPABASE_CONFIG || null; }

  // Native Android only. No Capacitor script is loaded anywhere in this app
  // (see index.html/android-back-button.js) - native already injects a
  // complete window.Capacitor bridge, including Plugins.Camera, on its own.
  // isNativePlatform() (not mere existence of window.Capacitor) is what
  // keeps this off on the ordinary website, where window.Capacitor never
  // exists at all.
  function isNativePlatform(){ return !!root.Capacitor?.isNativePlatform?.(); }
  function nativeCamera(){ return root.Capacitor?.Plugins?.Camera || null; }

  // The Capacitor Camera plugin's own Android source rejects a cancelled
  // capture/picker rather than resolving with no result. Matched
  // defensively against both known phrasings (source-confirmed for gallery
  // cancellation; takePhoto's own wording isn't in the plugin's public
  // source, so this also catches anything mentioning "cancel") rather than
  // a single exact string, and re-verified live per this feature's own
  // test pass - see the Phase 2 report for what was actually observed on
  // device.
  function isCaptureCancelledError(error){
    const message = String(error?.message || error || "");
    return /cancel/i.test(message) || /no picture taken/i.test(message);
  }

  // Converts a Capacitor MediaResult (from takePhoto/chooseFromGallery)
  // into the same File shape the plain <input type="file"> path already
  // hands to submitFile() - one shared function processes every source,
  // never a second copy of the OCR request logic.
  async function mediaResultToFile(result, sourceType){
    const path = result?.webPath || result?.uri;
    if (!path) throw new Error("native_media_missing_path");
    const response = await fetch(path);
    if (!response.ok) throw new Error("native_media_fetch_failed");
    const blob = await response.blob();
    const mimeType = blob.type || "image/jpeg";
    const extension = mimeType === "image/png" ? "png" : "jpg";
    return new File([blob], `${sourceType || "capture"}-${Date.now()}.${extension}`, { type: mimeType });
  }

  // Survives activity recreation while the native Camera activity is in the
  // foreground (Android can kill this app's process under memory pressure
  // while a separate Camera app is on top). Persisted just before handing
  // off to takePhoto(), read back by the appRestoredResult listener below,
  // cleared as soon as either is no longer needed. Deliberately minimal -
  // only what's needed to resume submitFile() with the right source_type,
  // not a general session-restore mechanism.
  const NATIVE_CAPTURE_CONTEXT_KEY = "resinTools.nativeCaptureContext.v1";
  function persistNativeCaptureContext(){
    try {
      sessionStorage.setItem(NATIVE_CAPTURE_CONTEXT_KEY, JSON.stringify({ sourceType: pendingSourceType, orientation: pendingOrientation }));
    } catch { /* best-effort only - worst case, a killed-process capture can't resume */ }
  }
  function readNativeCaptureContext(){
    try {
      const raw = sessionStorage.getItem(NATIVE_CAPTURE_CONTEXT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function clearNativeCaptureContext(){
    try { sessionStorage.removeItem(NATIVE_CAPTURE_CONTEXT_KEY); } catch { /* ignore */ }
  }

  const CAPTURE_COPY = {
    job_traveler: {
      title: "Scan Job Traveler",
      description: "Take a photo of the job traveler's product blend table, or choose an existing photo."
    },
    dosing_screen: {
      title: "Scan Dosing Screen",
      description: "Take a photo of the dosing controller's material overview screen, or choose an existing photo (screen photo or printout)."
    },
    heat_sheet: {
      title: "Scan Heat Sheet",
      description: "Take a photo of the blender/layer settings heat sheet, or choose an existing photo."
    }
  };

  let pendingSourceType = null;  // "job_traveler" | "dosing_screen" | "heat_sheet"
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
    // The file input's photo picker has no camera option on Android (see
    // this feature's diagnosis notes), so native gets an explicit Take
    // Photo/Choose Photo choice instead of the web's single Scan button.
    // Never both at once.
    const native = isNativePlatform();
    const webRow = $("recipeScanCaptureWebRow");
    const nativeRow = $("recipeScanCaptureNativeRow");
    if (webRow) webRow.hidden = native;
    if (nativeRow) nativeRow.hidden = !native;
    $("recipeScanCaptureDialog")?.showModal?.();
  }

  function closeCaptureDialog(){
    $("recipeScanCaptureDialog")?.close?.();
  }

  // Server-reported error codes (image validation, auth, workspace access,
  // OCR parsing, server config). Distinct from the client-only failure
  // modes (unreadable file, unreachable network, malformed response) that
  // submitFile() below handles itself, since the server never sees those
  // requests at all.
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

  // The one shared entry point for the OCR request - the plain web file
  // input, the native Take Photo path, and the native Choose Photo path
  // all call this same function with a File, so there is exactly one
  // upload/parse/apply implementation to maintain. Every failure branch
  // sets a specific, actionable status message (never a single generic
  // "scan failed") and logs the real technical detail to the console -
  // never the reverse.
  async function submitFile(file){
    if (!file || scanInFlight) return;
    scanInFlight = true;
    setStatus("recipeScanCaptureStatus", "Scanning…");

    // 1. Unable to read the image file itself (corrupt file, revoked
    // content:// permission, native webPath fetch that returned something
    // unreadable).
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      console.error("Scan Recipe: could not read the selected image.", error);
      setStatus("recipeScanCaptureStatus", "That photo couldn't be read. Try a different photo.", true);
      scanInFlight = false;
      return;
    }

    // 2. Unsupported/invalid image (wrong type, empty, too large, bad
    // signature) - checked client-side first so a bad file never leaves
    // the device.
    const imageCheck = schema()?.validateImage?.(bytes, file.type, bytes.byteLength);
    if (imageCheck && !imageCheck.ok){
      setStatus("recipeScanCaptureStatus", captureErrorMessage(imageCheck.error), true);
      scanInFlight = false;
      return;
    }

    // 3. Authentication not ready yet (no RT Sync session at all).
    const token = await serviceApi.getAccessToken();
    if (!token){
      console.error("Scan Recipe: no RT Sync access token available.");
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

    // 4. Network unavailable / request never reached the server. A CORS
    // rejection and a true offline failure both surface to JS as the same
    // generic "Failed to fetch" - browsers deliberately don't distinguish
    // them (so a page can't probe cross-origin availability) - so
    // navigator.onLine is the best available signal for which message to
    // show. Either way, the real error is logged, not hidden.
    let response;
    try {
      response = await fetch(`${base}/functions/v1/recipe-scan`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
    } catch (error) {
      console.error("Scan Recipe: the OCR request failed before reaching the server.", error);
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      setStatus(
        "recipeScanCaptureStatus",
        offline ? "You're offline. Reconnect and try again." : "Couldn't reach the scan service. Check your connection and try again.",
        true
      );
      scanInFlight = false;
      return;
    }

    let body = null;
    let bodyParseFailed = false;
    try { body = await response.json(); } catch (error) { bodyParseFailed = true; }

    // 5. Authentication/authorization failure, or the OCR service itself
    // failing (5xx) - distinct from a malformed-but-200 response (6, below).
    if (!response.ok){
      console.error(`Scan Recipe: OCR request failed (HTTP ${response.status}).`, body);
      if (response.status === 401) setStatus("recipeScanCaptureStatus", captureErrorMessage("unauthorized"), true);
      else if (response.status === 403) setStatus("recipeScanCaptureStatus", captureErrorMessage("workspace_access_denied"), true);
      else if (response.status >= 500) setStatus("recipeScanCaptureStatus", "The scan service is temporarily unavailable. Try again shortly.", true);
      else setStatus("recipeScanCaptureStatus", captureErrorMessage(body?.error), true);
      scanInFlight = false;
      return;
    }

    // 6. Invalid/unparseable OCR response - the request succeeded but the
    // body isn't the shape this client understands.
    if (bodyParseFailed || !body?.ok || !body?.result?.recipe){
      console.error("Scan Recipe: the OCR response was not well-formed.", body);
      setStatus("recipeScanCaptureStatus", "The scan service returned an unexpected response. Try again.", true);
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
  }

  // --- native capture (Android) -------------------------------------------

  async function captureFromNativeCamera(){
    const Camera = nativeCamera();
    if (!Camera || scanInFlight) return;
    setStatus("recipeScanCaptureStatus", "");
    persistNativeCaptureContext();
    let result;
    try {
      result = await Camera.takePhoto({});
    } catch (error) {
      clearNativeCaptureContext();
      if (isCaptureCancelledError(error)) return;
      console.error("Scan Recipe: native camera capture failed.", error);
      setStatus("recipeScanCaptureStatus", "The camera couldn't be opened. Try again.", true);
      return;
    }
    clearNativeCaptureContext();
    await submitCapturedMedia(result);
  }

  async function captureFromNativeGallery(){
    const Camera = nativeCamera();
    if (!Camera || scanInFlight) return;
    setStatus("recipeScanCaptureStatus", "");
    let results;
    try {
      results = await Camera.chooseFromGallery({});
    } catch (error) {
      if (isCaptureCancelledError(error)) return;
      console.error("Scan Recipe: native gallery selection failed.", error);
      setStatus("recipeScanCaptureStatus", "That photo couldn't be opened. Try a different photo.", true);
      return;
    }
    const first = results?.results?.[0];
    if (!first) return;
    await submitCapturedMedia(first);
  }

  async function submitCapturedMedia(mediaResult){
    let file;
    try {
      file = await mediaResultToFile(mediaResult, pendingSourceType);
    } catch (error) {
      console.error("Scan Recipe: could not convert the captured photo for upload.", error);
      setStatus("recipeScanCaptureStatus", "That photo couldn't be read. Try again.", true);
      return;
    }
    await submitFile(file);
  }

  // Android can kill this app's process while its native Camera activity is
  // in the foreground. If that happened mid-capture, Capacitor redelivers
  // the result here instead of resolving takePhoto()'s original promise
  // (which no longer exists) - resume with whatever source_type/orientation
  // were persisted right before the camera opened. A restart with nothing
  // persisted (or a result for some other, non-capture plugin call) is not
  // this flow's concern and is left alone.
  function registerNativeAppRestoredResult(){
    const App = root.Capacitor?.Plugins?.App;
    if (!App?.addListener) return;
    App.addListener("appRestoredResult", async (data) => {
      const context = readNativeCaptureContext();
      if (!context || !data?.pluginCallId) return;
      clearNativeCaptureContext();
      if (data.success === false || !data.data) return;
      pendingSourceType = context.sourceType;
      pendingOrientation = context.orientation;
      openCaptureDialog();
      await submitCapturedMedia(data.data);
    });
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

    // Enter advances to the next layer percentage input instead of doing
    // nothing (there's no surrounding <form> to submit) - saves the operator
    // from clicking/scrolling to each of up to 5 fields individually.
    const layerPctInputs = Array.from(content.querySelectorAll(".recipeScanReviewLayerPctInput input"));
    layerPctInputs.forEach((input, index) => {
      input.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const next = layerPctInputs[index + 1];
        if (next) next.focus();
        else input.blur();
      });
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
  $("recipeScanHeatSheetBtn")?.addEventListener("click", () => startScan("heat_sheet"));

  // Mobile status-bar shortcut - same startScan entry point as the Tools
  // panel buttons above, just reachable without navigating to Tools first.
  const statusScanShortcut = $("statusScanShortcut");
  function pickFromShortcut(sourceType){
    if (statusScanShortcut) statusScanShortcut.open = false;
    startScan(sourceType);
  }
  $("statusScanJobTravelerBtn")?.addEventListener("click", () => pickFromShortcut("job_traveler"));
  $("statusScanDosingScreenBtn")?.addEventListener("click", () => pickFromShortcut("dosing_screen"));
  $("statusScanHeatSheetBtn")?.addEventListener("click", () => pickFromShortcut("heat_sheet"));
  document.addEventListener("click", event => {
    if (statusScanShortcut?.open && !statusScanShortcut.contains(event.target)) statusScanShortcut.open = false;
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && statusScanShortcut?.open){
      statusScanShortcut.open = false;
      statusScanShortcut.querySelector(":scope > summary")?.focus();
    }
  });

  $("recipeScanCaptureBtn")?.addEventListener("click", () => $("recipeScanCaptureInput")?.click());
  $("recipeScanCaptureInput")?.addEventListener("change", event => submitFile(event.target.files?.[0]));
  $("recipeScanTakePhotoBtn")?.addEventListener("click", captureFromNativeCamera);
  $("recipeScanChoosePhotoBtn")?.addEventListener("click", captureFromNativeGallery);
  $("recipeScanCaptureCancelBtn")?.addEventListener("click", () => { closeCaptureDialog(); resetPendingScan(); });
  registerNativeAppRestoredResult();

  $("recipeScanReviewCancelBtn")?.addEventListener("click", cancelReview);
  $("recipeScanReviewRetakeBtn")?.addEventListener("click", retakeScan);
  $("recipeScanReviewApplyBtn")?.addEventListener("click", applyReview);

  // Narrow export so other entry points into scanning (currently: Recipe
  // Setup's own Scan Recipe shortcut, app.js) can trigger the exact same
  // flow as the Tools panel/status-bar buttons above, without duplicating
  // startScan's orientation-prompt/dialog logic.
  root.PolynRecipeScanUI = { startScan };
})(typeof globalThis !== "undefined" ? globalThis : this);
