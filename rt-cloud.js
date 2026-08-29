(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynRtCloud = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  // RT Cloud - optional, private, encrypted disaster-recovery backup for RT
  // Notes. This module is the state machine and network layer. It is
  // dependency-injected (see create(deps)) so it runs unchanged in the
  // browser and under node:test.
  //
  // Invariants this module must never break:
  //
  //   * IndexedDB stays authoritative. Nothing here writes a note except an
  //     explicit user-confirmed restore (Replace / Import).
  //   * A cloud failure of any kind (encrypt, network, Edge Function,
  //     decrypt, bad payload, wrong code) leaves local Notes exactly as they
  //     were. The local autosave is never delayed or blocked waiting on a
  //     cloud call.
  //   * The raw Recovery Code never leaves the device. Only the one-way
  //     lookup hash and AES-GCM ciphertext are uploaded.
  //   * No Supabase Realtime subscription is ever created (RT Cloud is a
  //     backup, not sync).
  //   * RT Sync Device ID / anonymous RT User ID are sent as diagnostic
  //     metadata only - never required, never authoritative for recovery.

  const META_KEY = "rtCloud.v1";
  const ENDPOINT = "/functions/v1/rt-cloud";

  // Cloud debounce: several local edits close together collapse into one
  // snapshot upload. Deliberately much longer than the ~600 ms Notes
  // autosave.
  const DEBOUNCE_MS = 8000;
  // Backoff for a failed upload while RT Cloud stays dirty. Never spams.
  const RETRY_STEPS_MS = [30000, 60000, 120000, 300000];

  const STATE = {
    OFF: "off",
    IDLE: "idle", // enabled, clean, backed up
    SCHEDULED: "scheduled", // a change is pending the debounce
    UPLOADING: "uploading",
    PENDING: "pending", // dirty, waiting to retry (usually offline)
    FAILED: "failed" // dirty, last attempt failed
  };

  function isOffline() {
    return typeof navigator !== "undefined" && navigator.onLine === false;
  }

  function makeRequestId(cryptoObj) {
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") return cryptoObj.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function create(deps) {
    const d = deps || {};
    const store = d.store;
    const crypto = d.crypto || (root && root.PolynRtCloudCrypto);
    const notesStoreApi = d.notesStore || (root && root.PolynNotesStore);
    const config = d.config || (root && root.POLYN_SUPABASE_CONFIG) || {};
    const fetchImpl =
      d.fetchImpl || (typeof fetch === "function" ? fetch.bind(root || undefined) : null);
    const now = typeof d.now === "function" ? d.now : () => Date.now();
    const setTimer = d.setTimeout || (typeof setTimeout === "function" ? setTimeout : null);
    const clearTimer = d.clearTimeout || (typeof clearTimeout === "function" ? clearTimeout : null);
    const getDiagnostics = typeof d.getDiagnostics === "function" ? d.getDiagnostics : () => ({});
    const payloadVersion = d.payloadVersion || (notesStoreApi && notesStoreApi.EXPORT_VERSION) || 2;
    const webcrypto = d.webcrypto || (root && root.crypto) || null;

    if (!store || !crypto) {
      throw new Error("PolynRtCloud.create needs a notes store and PolynRtCloudCrypto.");
    }

    let meta = null; // persisted config, or null when never enabled
    let state = STATE.OFF;
    let debounceHandle = 0;
    let retryHandle = 0;
    let retryIndex = 0;
    let inFlight = false;
    let rebackupQueued = false;
    let started = false;
    const listeners = new Set();

    function emit() {
      const snapshot = getStatus();
      listeners.forEach((fn) => {
        try {
          fn(snapshot);
        } catch (error) {
          /* a listener must never break the state machine */
        }
      });
    }

    function setState(next) {
      if (state === next) return;
      state = next;
      emit();
    }

    function onStatus(fn) {
      if (typeof fn === "function") listeners.add(fn);
      return () => listeners.delete(fn);
    }

    function getStatus() {
      return {
        enabled: !!(meta && meta.enabled),
        configured: !!(meta && meta.recoveryCode),
        state,
        dirty: !!(meta && meta.dirty),
        lastBackupAt: meta ? meta.lastBackupAt || null : null,
        lastRevision: meta ? meta.lastRevision || 0 : 0
      };
    }

    // The display-form Recovery Code, for the explicit "View recovery code"
    // action only. Never logged, never auto-copied by this module.
    function getRecoveryCode() {
      return meta && meta.recoveryCode ? meta.recoveryCode : null;
    }

    function persistMeta() {
      return store.setMeta(META_KEY, meta).catch(() => {});
    }

    async function start() {
      if (started) return getStatus();
      started = true;
      try {
        const stored = await store.getMeta(META_KEY);
        if (stored && typeof stored === "object") meta = stored;
      } catch (error) {
        meta = null;
      }
      if (meta && meta.enabled) {
        setState(meta.dirty ? STATE.PENDING : STATE.IDLE);
        if (meta.dirty) scheduleBackup(0);
      } else {
        setState(STATE.OFF);
      }
      if (typeof root !== "undefined" && root && typeof root.addEventListener === "function") {
        root.addEventListener("online", () => {
          if (meta && meta.enabled && meta.dirty && !inFlight) scheduleBackup(0);
        });
      }
      return getStatus();
    }

    function clearDebounce() {
      if (debounceHandle && clearTimer) clearTimer(debounceHandle);
      debounceHandle = 0;
    }

    function clearRetry() {
      if (retryHandle && clearTimer) clearTimer(retryHandle);
      retryHandle = 0;
    }

    function scheduleBackup(delayMs) {
      if (!meta || !meta.enabled || !setTimer) return;
      clearDebounce();
      const delay = typeof delayMs === "number" ? delayMs : DEBOUNCE_MS;
      if (state !== STATE.UPLOADING) setState(STATE.SCHEDULED);
      debounceHandle = setTimer(() => {
        debounceHandle = 0;
        // Returned so a test clock can await it; the browser's setTimeout
        // ignores the return value.
        return runBackup({ manual: false });
      }, delay);
    }

    // Called by the UI after a committed local Notes change (create, edit
    // commit, delete, pin/unpin, move, folder create/rename/delete). No-op
    // when RT Cloud is off. Marks dirty and (re)arms the debounce.
    function noteChanged() {
      if (!meta || !meta.enabled) return;
      if (!meta.dirty) {
        meta.dirty = true;
        persistMeta();
      }
      scheduleBackup();
    }

    async function buildEncryptedSnapshot(secret, kdfSalt) {
      const snapshot = await store.exportNotes(); // the existing export envelope, verbatim
      const key = await crypto.deriveKey(secret, kdfSalt);
      const enc = await crypto.encryptSnapshot(key, snapshot);
      return { snapshot, enc };
    }

    function endpointUrl() {
      const base = (config && config.url) || "";
      return `${base}${ENDPOINT}`;
    }

    async function post(bodyObj) {
      if (!fetchImpl) return { ok: false, error: "no_fetch" };
      let res;
      try {
        res = await fetchImpl(endpointUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // The publishable key only routes the request through the
            // Supabase gateway. It is already public; it is NOT auth for RT
            // Cloud - the derived lookup hash in the body is.
            apikey: (config && config.publishableKey) || ""
          },
          body: JSON.stringify(bodyObj)
        });
      } catch (error) {
        return { ok: false, error: "network", offline: isOffline() };
      }
      let json = null;
      try {
        json = await res.json();
      } catch (error) {
        json = null;
      }
      if (!res.ok) {
        return { ok: false, error: (json && json.error) || `http_${res.status}`, status: res.status };
      }
      return json && typeof json === "object" ? json : { ok: false, error: "bad_response" };
    }

    function diagnosticFields() {
      let diag = {};
      try {
        diag = getDiagnostics() || {};
      } catch (error) {
        diag = {};
      }
      const out = {};
      if (typeof diag.deviceId === "string" && diag.deviceId) out.source_device_id = diag.deviceId.slice(0, 128);
      if (typeof diag.rtUserId === "string" && diag.rtUserId) out.source_rt_user_id = diag.rtUserId;
      return out;
    }

    // First-time setup. Returns { ok, code, alreadyExisted } on success.
    // `enabled` is only persisted AFTER the first upload succeeds.
    async function enable() {
      if (meta && meta.enabled) {
        return { ok: true, code: meta.recoveryCode, alreadyExisted: false, already: true };
      }
      let generated;
      try {
        generated = crypto.generateRecoveryCode();
      } catch (error) {
        return { ok: false, error: "no_crypto" };
      }
      const kdfSalt = crypto.generateKdfSalt();
      let lookupHash;
      let enc;
      try {
        lookupHash = await crypto.deriveLookupHash(generated.secret);
        const built = await buildEncryptedSnapshot(generated.secret, kdfSalt);
        enc = built.enc;
      } catch (error) {
        return { ok: false, error: "encrypt_failed" };
      }
      const resp = await post(
        Object.assign(
          {
            action: "enable",
            lookup_hash: lookupHash,
            kdf_salt: kdfSalt,
            iv: enc.iv,
            encrypted_payload: enc.ciphertext,
            encryption_version: enc.encryptionVersion,
            payload_version: payloadVersion,
            request_id: makeRequestId(webcrypto)
          },
          diagnosticFields()
        )
      );
      if (!resp.ok) {
        return { ok: false, error: resp.error || "upload_failed" };
      }
      meta = {
        enabled: true,
        recoveryCode: generated.code,
        kdfSalt,
        lookupHash,
        lastRevision: resp.revision || 1,
        lastBackupAt: now(),
        dirty: false,
        createdAt: now()
      };
      await persistMeta();
      retryIndex = 0;
      setState(STATE.IDLE);
      return { ok: true, code: generated.code, alreadyExisted: !!resp.already_exists };
    }

    // Snapshot -> encrypt -> upload -> update local status. Never throws,
    // never touches note content. { manual:true } skips the debounce and is
    // used by "Back up now" and the pagehide/visibility flush.
    async function runBackup(options) {
      const manual = !!(options && options.manual);
      if (!meta || !meta.enabled) return { ok: false, error: "disabled" };
      if (inFlight) {
        rebackupQueued = true;
        return { ok: false, error: "in_flight" };
      }
      clearDebounce();
      clearRetry();
      inFlight = true;
      setState(STATE.UPLOADING);

      let enc;
      try {
        const secret = crypto.normalizeRecoveryCode(meta.recoveryCode);
        if (!secret) throw new Error("bad_local_code");
        const built = await buildEncryptedSnapshot(secret, meta.kdfSalt);
        enc = built.enc;
      } catch (error) {
        inFlight = false;
        meta.dirty = true;
        await persistMeta();
        setState(STATE.FAILED);
        return { ok: false, error: "encrypt_failed" };
      }

      let resp = await post(
        Object.assign(
          {
            action: "backup",
            lookup_hash: meta.lookupHash,
            kdf_salt: meta.kdfSalt,
            iv: enc.iv,
            encrypted_payload: enc.ciphertext,
            encryption_version: enc.encryptionVersion,
            payload_version: payloadVersion,
            request_id: makeRequestId(webcrypto)
          },
          diagnosticFields()
        )
      );

      // The cloud row was deleted elsewhere while this device stayed
      // enabled. Re-create it under the same Recovery Code so this device
      // keeps working.
      if (!resp.ok && resp.error === "not_found") {
        resp = await post(
          Object.assign(
            {
              action: "enable",
              lookup_hash: meta.lookupHash,
              kdf_salt: meta.kdfSalt,
              iv: enc.iv,
              encrypted_payload: enc.ciphertext,
              encryption_version: enc.encryptionVersion,
              payload_version: payloadVersion,
              request_id: makeRequestId(webcrypto)
            },
            diagnosticFields()
          )
        );
      }

      inFlight = false;

      if (resp.ok) {
        meta.dirty = false;
        meta.lastRevision = resp.revision || meta.lastRevision + 1;
        meta.lastBackupAt = now();
        await persistMeta();
        retryIndex = 0;
        setState(STATE.IDLE);
        if (rebackupQueued) {
          rebackupQueued = false;
          scheduleBackup();
        }
        return { ok: true, revision: meta.lastRevision };
      }

      // Failure: keep dirty, back off, retry later. Local notes are fine.
      // A network-layer throw ("network") or a real offline signal is a
      // "pending, will retry" state, not a hard failure.
      meta.dirty = true;
      await persistMeta();
      const offline = resp.offline || resp.error === "network" || isOffline();
      setState(offline ? STATE.PENDING : STATE.FAILED);
      if (setTimer && !manual) {
        const wait = RETRY_STEPS_MS[Math.min(retryIndex, RETRY_STEPS_MS.length - 1)];
        retryIndex += 1;
        clearRetry();
        retryHandle = setTimer(() => {
          retryHandle = 0;
          return runBackup({ manual: false });
        }, wait);
      } else if (setTimer && manual) {
        // A manual attempt that failed still arms one background retry.
        scheduleBackup(RETRY_STEPS_MS[0]);
      }
      return { ok: false, error: resp.error || "upload_failed", offline };
    }

    function backupNow() {
      return runBackup({ manual: true });
    }

    // Best-effort final flush on app backgrounding / pagehide. Fire and
    // forget - it must never delay teardown or the local save.
    function flush() {
      if (meta && meta.enabled && meta.dirty && !inFlight) {
        Promise.resolve(runBackup({ manual: true })).catch(() => {});
      }
    }

    /* ----------------------------------------------------------------
     *   Restore
     * -------------------------------------------------------------- */

    // Fetch + decrypt + validate WITHOUT touching local data. Returns a
    // result object whose applyReplace() / applyImport() the UI calls only
    // after the user confirms.
    async function restore(codeInput) {
      const secret = crypto.normalizeRecoveryCode(codeInput);
      if (!secret) return { ok: false, error: "bad_code" };

      let lookupHash;
      try {
        lookupHash = await crypto.deriveLookupHash(secret);
      } catch (error) {
        return { ok: false, error: "bad_code" };
      }

      const resp = await post({ action: "restore", lookup_hash: lookupHash });
      if (!resp.ok) return { ok: false, error: resp.error || "lookup_failed" };
      if (!resp.exists) return { ok: false, error: "not_found" };

      let plaintext;
      try {
        const key = await crypto.deriveKey(secret, resp.kdf_salt);
        plaintext = await crypto.decryptSnapshot(key, resp.iv, resp.encrypted_payload);
      } catch (error) {
        return { ok: false, error: "decrypt_failed" };
      }

      const parsed = notesStoreApi.parseImport(plaintext);
      if (!parsed.ok) return { ok: false, error: "invalid_payload" };

      const summary = {
        noteCount: parsed.notes.length,
        folderCount: parsed.folders.length,
        lastBackupAt: resp.last_backup_at || null,
        revision: resp.revision || 0
      };
      const adoption = {
        secret,
        code: crypto.formatRecoveryCode(secret),
        kdfSalt: resp.kdf_salt,
        lookupHash,
        revision: resp.revision || 0
      };

      return {
        ok: true,
        summary,
        adoption,
        // Replace the whole local notebook with the snapshot, transactionally.
        applyReplace: () => store.replaceAllFromExport(plaintext),
        // Merge into the existing notebook using the store's own import path.
        applyImport: () => store.importNotes(plaintext)
      };
    }

    // After a confirmed restore, keep RT Cloud enabled on THIS install using
    // the restored code, so future edits back up to the same cloud row. This
    // is the reinstall path - a brand-new Device ID / RT User ID adopts an
    // existing backup with the Recovery Code alone.
    async function adoptRecoveryCode(adoption) {
      if (!adoption || !adoption.secret || !adoption.kdfSalt || !adoption.lookupHash) {
        return { ok: false, error: "invalid_adoption" };
      }
      meta = {
        enabled: true,
        recoveryCode: adoption.code || crypto.formatRecoveryCode(adoption.secret),
        kdfSalt: adoption.kdfSalt,
        lookupHash: adoption.lookupHash,
        lastRevision: adoption.revision || 0,
        lastBackupAt: now(),
        dirty: false,
        createdAt: now()
      };
      await persistMeta();
      retryIndex = 0;
      setState(STATE.IDLE);
      return { ok: true };
    }

    /* ----------------------------------------------------------------
     *   Disable
     * -------------------------------------------------------------- */

    // "Turn off backups": stop automatic uploads. The cloud backup is left
    // intact and recoverable; the local Recovery Code is kept so it can
    // still be viewed and RT Cloud re-enabled without a new code.
    async function disable() {
      clearDebounce();
      clearRetry();
      rebackupQueued = false;
      if (meta) {
        meta.enabled = false;
        await persistMeta();
      }
      setState(STATE.OFF);
      return { ok: true };
    }

    // "Delete cloud backup": permanently remove the encrypted blob from RT
    // Cloud, then clear all local RT Cloud state. Requires a strong
    // confirmation in the UI. Local Notes are untouched.
    async function deleteCloudBackup() {
      if (!meta || !meta.lookupHash) {
        await store.deleteMeta(META_KEY).catch(() => {});
        meta = null;
        setState(STATE.OFF);
        return { ok: true };
      }
      const resp = await post({
        action: "delete",
        lookup_hash: meta.lookupHash,
        request_id: makeRequestId(webcrypto)
      });
      if (!resp.ok) return { ok: false, error: resp.error || "delete_failed" };
      clearDebounce();
      clearRetry();
      await store.deleteMeta(META_KEY).catch(() => {});
      meta = null;
      retryIndex = 0;
      setState(STATE.OFF);
      return { ok: true };
    }

    return {
      STATE,
      start,
      onStatus,
      getStatus,
      getRecoveryCode,
      noteChanged,
      backupNow,
      flush,
      enable,
      restore,
      adoptRecoveryCode,
      disable,
      deleteCloudBackup,
      // test-only introspection
      _peekMeta: () => (meta ? Object.assign({}, meta) : null)
    };
  }

  return { create, STATE };
});
