(function (root) {
  "use strict";

  // RT Cloud UI - the RT CLOUD block inside the RT Notes Backup dialog, plus
  // its three sub-dialogs (recovery code, restore, delete confirm). Self-
  // booting like the other *-ui.js modules. Everything here is inert unless
  // the mobile RT Notes section (PolynNotesUI) and the RT Cloud service
  // (PolynRtCloud) are both present.

  const $ = (id) => document.getElementById(id);

  const NotesUI = root.PolynNotesUI;
  const RtCloud = root.PolynRtCloud;
  const Crypto = root.PolynRtCloudCrypto;
  const NotesStore = root.PolynNotesStore;
  const section = $("notesCloud");
  if (!NotesUI || !RtCloud || !Crypto || !NotesStore || !section) return;

  const store = NotesUI.getStore && NotesUI.getStore();
  if (!store) return;

  let service;
  try {
    service = RtCloud.create({
      store,
      crypto: Crypto,
      notesStore: NotesStore,
      config: root.POLYN_SUPABASE_CONFIG || {},
      webcrypto: root.crypto || null,
      // RT Sync identifiers are DIAGNOSTIC ONLY - never authoritative for
      // recovery, never required. Best-effort; absent on plain web / before
      // an RT Sync session exists.
      getDiagnostics: () => {
        try {
          const d = root.PolynRtSyncBridge && root.PolynRtSyncBridge.getRecoveryDescriptor();
          if (d && d.ready) return { deviceId: d.deviceId || "", rtUserId: d.userId || "" };
        } catch (error) {
          /* diagnostics are optional */
        }
        return {};
      }
    });
  } catch (error) {
    return;
  }

  /* --------------------------------------------------------------------
   *   Elements
   * ------------------------------------------------------------------ */

  const badge = $("notesCloudStatusBadge");
  const statusLine = $("notesCloudStatusLine");
  const offActions = section.querySelector('.notesCloudActions[data-when="off"]');
  const onActions = section.querySelector('.notesCloudActions[data-when="on"]');
  const danger = $("notesCloudDanger");

  const enableBtn = $("notesCloudEnableBtn");
  const backupNowBtn = $("notesCloudBackupNowBtn");
  const viewCodeBtn = $("notesCloudViewCodeBtn");
  const restoreBtn = $("notesCloudRestoreBtn");
  const turnOffBtn = $("notesCloudTurnOffBtn");
  const deleteBtn = $("notesCloudDeleteBtn");

  const codeDialog = $("notesCloudCodeDialog");
  const codeWarn = $("notesCloudCodeWarn");
  const codeValue = $("notesCloudCodeValue");
  const codeCopyBtn = $("notesCloudCodeCopyBtn");
  const ackRow = $("notesCloudAckRow");
  const ackCheck = $("notesCloudAckCheck");
  const codeStatus = $("notesCloudCodeStatus");
  const codeDoneBtn = $("notesCloudCodeDoneBtn");

  const restoreDialog = $("notesCloudRestoreDialog");
  const restoreInput = $("notesCloudRestoreInput");
  const restoreError = $("notesCloudRestoreError");
  const restoreSummary = $("notesCloudRestoreSummary");
  const restoreKeepRow = $("notesCloudRestoreKeepRow");
  const restoreKeepCheck = $("notesCloudRestoreKeepCheck");
  const restoreLookupActions = $("notesCloudRestoreLookupActions");
  const restoreApplyActions = $("notesCloudRestoreApplyActions");
  const restoreFindBtn = $("notesCloudRestoreFindBtn");
  const restoreCancelBtn = $("notesCloudRestoreCancelBtn");
  const restoreBackBtn = $("notesCloudRestoreBackBtn");
  const restoreImportBtn = $("notesCloudRestoreImportBtn");
  const restoreReplaceBtn = $("notesCloudRestoreReplaceBtn");

  const deleteDialog = $("notesCloudDeleteDialog");
  const deleteConfirmInput = $("notesCloudDeleteConfirmInput");
  const deleteError = $("notesCloudDeleteError");
  const deleteCancelBtn = $("notesCloudDeleteCancelBtn");
  const deleteConfirmBtn = $("notesCloudDeleteConfirmBtn");

  let pendingRestore = null; // result object from service.restore()
  let busy = false;

  /* --------------------------------------------------------------------
   *   Rendering
   * ------------------------------------------------------------------ */

  function relTime(ts) {
    const n = Number(ts && new Date(ts).getTime ? new Date(ts).getTime() : ts);
    if (!Number.isFinite(n) || n <= 0) return "";
    const min = Math.round((Date.now() - n) / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hr = Math.round(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const days = Math.round(hr / 24);
    if (days < 7) return `${days} d ago`;
    try {
      return new Date(n).toLocaleDateString();
    } catch (error) {
      return "";
    }
  }

  function setStatusLine(text) {
    if (!statusLine) return;
    statusLine.textContent = text || "";
    statusLine.hidden = !text;
  }

  const DEVICE_HINT_OFF =
    "RT Notes are stored on this device only. They don’t sync with RT Sync or show up on other devices.";
  const DEVICE_HINT_ON =
    "RT Notes stay private to this device. An encrypted recovery backup is stored in RT Cloud.";

  function render(status) {
    const s = status || service.getStatus();
    section.dataset.rtCloudState = s.enabled ? "on" : s.configured ? "off-configured" : "off";
    if (offActions) offActions.hidden = s.enabled;
    if (onActions) onActions.hidden = !s.enabled;
    if (danger) danger.hidden = !(s.enabled || s.configured);

    let badgeText = "Off";
    let line = "";
    if (!s.enabled && !s.configured) {
      badgeText = "Off";
    } else if (!s.enabled && s.configured) {
      badgeText = "Off";
      line = "Automatic backup is off. The existing cloud backup can still be restored.";
    } else {
      switch (s.state) {
        case RtCloud.STATE.UPLOADING:
          badgeText = "Backing up…";
          break;
        case RtCloud.STATE.SCHEDULED:
          badgeText = "Backed up";
          line = "Recent changes will back up shortly.";
          break;
        case RtCloud.STATE.PENDING:
          badgeText = "Backup pending";
          line = "Offline. RT Cloud will back up when you reconnect. Your notes are saved on this device.";
          break;
        case RtCloud.STATE.FAILED:
          badgeText = "Backup failed";
          line = "The last backup didn’t go through. RT Cloud will try again. Your notes are saved on this device.";
          break;
        default:
          badgeText = "Backed up";
          line = s.lastBackupAt ? `Last backup: ${relTime(s.lastBackupAt)}` : "Backed up.";
      }
    }
    if (badge) badge.textContent = badgeText;
    setStatusLine(line);

    if (NotesUI.setDeviceHint) {
      NotesUI.setDeviceHint(s.enabled ? DEVICE_HINT_ON : DEVICE_HINT_OFF);
    }
  }

  /* --------------------------------------------------------------------
   *   Recovery code dialog (first-time + view)
   * ------------------------------------------------------------------ */

  function openCodeDialog(code, firstTime) {
    if (!codeDialog || !codeDialog.showModal) return;
    if (codeValue) codeValue.textContent = code || "";
    if (codeStatus) codeStatus.textContent = "";
    if (ackCheck) ackCheck.checked = false;
    if (ackRow) ackRow.hidden = !firstTime;
    if (codeDoneBtn) codeDoneBtn.disabled = !!firstTime;
    if (codeWarn) {
      codeWarn.textContent = firstTime
        ? "Save this recovery code somewhere safe. You will need it to restore RT Notes if this app is uninstalled or its data is cleared. It is the only way back in and is not stored anywhere you can look up later."
        : "This is the recovery code for this device’s RT Cloud backup. Anyone with it can restore your notes, so keep it private.";
    }
    try {
      codeDialog.showModal();
    } catch (error) {
      /* already open */
    }
  }

  function copyRecoveryCode() {
    const text = codeValue ? codeValue.textContent : "";
    if (!text) return;
    const done = () => {
      if (codeStatus) codeStatus.textContent = "Copied to clipboard.";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        if (codeStatus) codeStatus.textContent = "Couldn’t copy - select and copy it by hand.";
      });
    } else if (codeStatus) {
      codeStatus.textContent = "Select the code above and copy it by hand.";
    }
  }

  /* --------------------------------------------------------------------
   *   Enable
   * ------------------------------------------------------------------ */

  async function onEnable() {
    if (busy) return;
    busy = true;
    if (enableBtn) {
      enableBtn.disabled = true;
      enableBtn.textContent = "Enabling…";
    }
    let res;
    try {
      res = await service.enable();
    } catch (error) {
      res = { ok: false, error: "unexpected" };
    }
    if (enableBtn) {
      enableBtn.disabled = false;
      enableBtn.textContent = "Enable RT Cloud";
    }
    busy = false;
    if (res && res.ok) {
      render();
      openCodeDialog(res.code, true);
    } else {
      setStatusLine(enableErrorText(res && res.error));
    }
  }

  function enableErrorText(code) {
    if (code === "network" || code === "no_fetch")
      return "Couldn’t reach RT Cloud. Check your connection and try again. Nothing was enabled.";
    if (code === "encrypt_failed" || code === "no_crypto")
      return "This device can’t create the encrypted backup. RT Cloud was not enabled.";
    return "RT Cloud couldn’t be enabled right now. Your notes are unaffected.";
  }

  /* --------------------------------------------------------------------
   *   Restore
   * ------------------------------------------------------------------ */

  function resetRestoreDialog() {
    pendingRestore = null;
    if (restoreInput) restoreInput.value = "";
    if (restoreError) restoreError.textContent = "";
    if (restoreSummary) {
      restoreSummary.hidden = true;
      restoreSummary.textContent = "";
    }
    if (restoreKeepRow) restoreKeepRow.hidden = true;
    if (restoreKeepCheck) restoreKeepCheck.checked = true;
    if (restoreLookupActions) restoreLookupActions.hidden = false;
    if (restoreApplyActions) restoreApplyActions.hidden = true;
  }

  function openRestoreDialog() {
    if (!restoreDialog || !restoreDialog.showModal) return;
    resetRestoreDialog();
    try {
      restoreDialog.showModal();
    } catch (error) {
      /* already open */
    }
  }

  function restoreErrorText(code) {
    switch (code) {
      case "bad_code":
        return "That doesn’t look like an RT Cloud Recovery Code. Check the characters and try again.";
      case "not_found":
        return "No RT Cloud backup was found for that recovery code.";
      case "decrypt_failed":
        return "That recovery code couldn’t open this backup.";
      case "invalid_payload":
        return "The backup couldn’t be read. Your notes on this device are unchanged.";
      case "rate_limited":
        return "Too many attempts. Wait a few minutes and try again.";
      default:
        return "Couldn’t reach RT Cloud. Check your connection and try again.";
    }
  }

  async function onFindBackup() {
    if (busy) return;
    busy = true;
    if (restoreFindBtn) restoreFindBtn.disabled = true;
    if (restoreError) restoreError.textContent = "";
    let res;
    try {
      res = await service.restore(restoreInput ? restoreInput.value : "");
    } catch (error) {
      res = { ok: false, error: "unexpected" };
    }
    if (restoreFindBtn) restoreFindBtn.disabled = false;
    busy = false;

    if (!res || !res.ok) {
      if (restoreError) restoreError.textContent = restoreErrorText(res && res.error);
      return;
    }

    pendingRestore = res;
    const existing = await store.getAll().then((n) => n.length).catch(() => 0);
    const when = res.summary.lastBackupAt ? relTime(res.summary.lastBackupAt) : "unknown";
    if (restoreSummary) {
      restoreSummary.textContent = `RT Cloud backup found - ${res.summary.noteCount} note${
        res.summary.noteCount === 1 ? "" : "s"
      }, ${res.summary.folderCount} folder${
        res.summary.folderCount === 1 ? "" : "s"
      }. Last backed up ${when}.`;
      restoreSummary.hidden = false;
    }
    if (restoreLookupActions) restoreLookupActions.hidden = true;
    if (restoreApplyActions) restoreApplyActions.hidden = false;
    if (restoreKeepRow) restoreKeepRow.hidden = false;

    // Empty local notebook: a single, safe "Restore" instead of Replace/Import.
    if (existing === 0) {
      if (restoreImportBtn) restoreImportBtn.hidden = true;
      if (restoreReplaceBtn) restoreReplaceBtn.textContent = "Restore RT Notes";
    } else {
      if (restoreImportBtn) restoreImportBtn.hidden = false;
      if (restoreReplaceBtn) restoreReplaceBtn.textContent = "Replace local RT Notes";
    }
  }

  async function applyRestore(mode) {
    if (busy || !pendingRestore) return;
    busy = true;
    [restoreImportBtn, restoreReplaceBtn, restoreBackBtn].forEach((b) => b && (b.disabled = true));
    let result;
    try {
      result =
        mode === "replace"
          ? await pendingRestore.applyReplace()
          : await pendingRestore.applyImport();
    } catch (error) {
      result = { ok: false };
    }
    const keep = restoreKeepCheck ? restoreKeepCheck.checked : true;
    if (result && result.ok !== false && keep && pendingRestore.adoption) {
      try {
        await service.adoptRecoveryCode(pendingRestore.adoption);
      } catch (error) {
        /* adoption is best-effort; the restore itself already succeeded */
      }
    }
    [restoreImportBtn, restoreReplaceBtn, restoreBackBtn].forEach((b) => b && (b.disabled = false));
    busy = false;

    if (result && result.ok === false) {
      if (restoreError) restoreError.textContent = "The restore didn’t complete. Your notes on this device are unchanged.";
      return;
    }
    try {
      restoreDialog.close();
    } catch (error) {
      /* already closed */
    }
    if (NotesUI.refresh) NotesUI.refresh();
    render();
  }

  /* --------------------------------------------------------------------
   *   Turn off / delete
   * ------------------------------------------------------------------ */

  async function onTurnOff() {
    if (busy) return;
    busy = true;
    try {
      await service.disable();
    } catch (error) {
      /* disable never rejects meaningfully */
    }
    busy = false;
    if (danger) danger.open = false;
    render();
  }

  function openDeleteDialog() {
    if (!deleteDialog || !deleteDialog.showModal) return;
    if (deleteConfirmInput) deleteConfirmInput.value = "";
    if (deleteError) deleteError.textContent = "";
    if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
    try {
      deleteDialog.showModal();
    } catch (error) {
      /* already open */
    }
  }

  async function onConfirmDelete() {
    if (busy) return;
    busy = true;
    if (deleteConfirmBtn) deleteConfirmBtn.disabled = true;
    let res;
    try {
      res = await service.deleteCloudBackup();
    } catch (error) {
      res = { ok: false };
    }
    busy = false;
    if (res && res.ok) {
      try {
        deleteDialog.close();
      } catch (error) {
        /* already closed */
      }
      if (danger) danger.open = false;
      render();
    } else if (deleteError) {
      deleteError.textContent = "Couldn’t delete the cloud backup. Try again.";
      if (deleteConfirmBtn) deleteConfirmBtn.disabled = false;
    }
  }

  /* --------------------------------------------------------------------
   *   Wiring
   * ------------------------------------------------------------------ */

  if (enableBtn) enableBtn.addEventListener("click", onEnable);
  if (backupNowBtn)
    backupNowBtn.addEventListener("click", () => {
      if (busy) return;
      Promise.resolve(service.backupNow()).then(render).catch(() => {});
      render();
    });
  if (viewCodeBtn)
    viewCodeBtn.addEventListener("click", () => {
      const code = service.getRecoveryCode();
      if (code) openCodeDialog(code, false);
    });
  if (codeCopyBtn) codeCopyBtn.addEventListener("click", copyRecoveryCode);
  if (ackCheck)
    ackCheck.addEventListener("change", () => {
      if (codeDoneBtn) codeDoneBtn.disabled = !ackCheck.checked;
    });
  if (codeDoneBtn)
    codeDoneBtn.addEventListener("click", () => {
      try {
        codeDialog.close();
      } catch (error) {
        /* already closed */
      }
    });

  if (restoreBtn) restoreBtn.addEventListener("click", openRestoreDialog);
  if (restoreFindBtn) restoreFindBtn.addEventListener("click", onFindBackup);
  if (restoreCancelBtn)
    restoreCancelBtn.addEventListener("click", () => {
      try {
        restoreDialog.close();
      } catch (error) {
        /* already closed */
      }
    });
  if (restoreBackBtn) restoreBackBtn.addEventListener("click", resetRestoreDialog);
  if (restoreImportBtn) restoreImportBtn.addEventListener("click", () => applyRestore("import"));
  if (restoreReplaceBtn) restoreReplaceBtn.addEventListener("click", () => applyRestore("replace"));

  if (turnOffBtn) turnOffBtn.addEventListener("click", onTurnOff);
  if (deleteBtn) deleteBtn.addEventListener("click", openDeleteDialog);
  if (deleteCancelBtn)
    deleteCancelBtn.addEventListener("click", () => {
      try {
        deleteDialog.close();
      } catch (error) {
        /* already closed */
      }
    });
  if (deleteConfirmInput)
    deleteConfirmInput.addEventListener("input", () => {
      if (deleteConfirmBtn) {
        deleteConfirmBtn.disabled = deleteConfirmInput.value.trim().toUpperCase() !== "DELETE";
      }
    });
  if (deleteConfirmBtn) deleteConfirmBtn.addEventListener("click", onConfirmDelete);

  // A committed local Notes change -> schedule an encrypted cloud backup.
  NotesUI.onChange(() => service.noteChanged());

  // Best-effort final flush when the app is backgrounded or closed. Never
  // blocks teardown or the local save.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") service.flush();
  });
  window.addEventListener("pagehide", () => service.flush());

  service.onStatus(render);
  Promise.resolve(service.start()).then(render).catch(() => render());
})(typeof globalThis !== "undefined" ? globalThis : this);
