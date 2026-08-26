(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const api = root.PolynDatabaseHealth;
  if (!api) return;
  const panel = $("databaseHealthBlock");
  let health;
  let cpuCursor = null;
  function visible(){ return !!(panel?.open && (panel.classList.contains("desktop-active") || !matchMedia("(min-width: 761px)").matches)); }
  function age(iso){ const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return seconds < 60 ? `${seconds} sec ago` : `${Math.floor(seconds / 60)} min ago`; }
  function render({ result, samples, lastSuccess }){
    const current = result?.ok ? result : lastSuccess;
    if (current){
      const displayedCpu = Number.isFinite(current.cpuPercent) ? current.cpuPercent : samples.at(-1);
      $("databaseHealthCpu").textContent = Number.isFinite(displayedCpu) ? `${displayedCpu.toFixed(1)}%` : "Unavailable";
      $("databaseHealthStatus").textContent = `Resin.Tools UI threshold: ${api.status(displayedCpu)}`;
      $("databaseHealthConnections").textContent = current.connections ?? "Unavailable";
      $("databaseHealthMemory").textContent = Number.isFinite(current.memoryPercent) ? `${current.memoryPercent.toFixed(1)}%` : "Unavailable";
      $("databaseHealthUpdated").textContent = `Updated ${age(current.sampledAt)}`;
    }
    if (!result?.ok) $("databaseHealthUpdated").textContent = `Database metrics unavailable${result?.error ? ` (${result.error})` : ""}${lastSuccess ? `. Last successful update: ${age(lastSuccess.sampledAt)}` : ""}`;
    $("databaseHealthSparkline").textContent = samples.length ? samples.map(value => "▁▂▃▄▅▆▇█"[Math.min(7, Math.floor(value / 12.5))]).join("") : "—";
  }
  async function invoke(){
    const admin = root.PolynResinAdminInstance;
    if (!admin?.getState().isAdmin) return { ok:false };
    try {
      const response = await admin.getClient().functions.invoke("database-health", { body:{ cpuCursor } });
      if (!response.error){
        if (typeof response.data?.cpuCursor === "string") cpuCursor = response.data.cpuCursor;
        return response.data;
      }
      try {
        const body = await response.error.context?.clone?.().json();
        return { ok:false, error:typeof body?.error === "string" ? body.error : "request_failed" };
      } catch { return { ok:false, error:"request_failed" }; }
    } catch { return { ok:false, error:"request_failed" }; }
  }
  health = api.create({ invoke, onUpdate:render, isVisible:visible });
  function sync(){ if (visible()) health.start(); else health.stop(); }
  panel?.addEventListener("toggle", sync);
  new MutationObserver(sync).observe(panel, { attributes:true, attributeFilter:["class", "open"] });
  $("databaseHealthRefresh")?.addEventListener("click", ()=>void health.refresh());
  const admin = root.PolynResinAdminInstance;
  admin?.subscribe(state => {
    $("databaseHealthButton").hidden = !state?.ready || !state?.isAdmin;
    if (!state?.isAdmin) { health.stop(); if (panel) panel.open = false; }
  });
  $("databaseHealthButton")?.addEventListener("click", () => { if (root.PolynResinAdminInstance?.getState().isAdmin) { panel.open = true; sync(); } });

  // Conflict storm alerts: a client tripping the server-side circuit breaker
  // (private.active_job_conflict_guards) is something an admin needs to
  // notice and act on - identify the client, disconnect it - not something
  // they only find by opening Database Health and happening to look. So this
  // polls independently of the CPU/memory/connections readout above: it
  // starts as soon as an admin session exists, stays running whether or not
  // the panel is open, and drives a badge on the nav button itself. It stops
  // the moment admin access is lost, same as the health poller.
  const stormsApi = root.PolynConflictStormAlerts;
  let storms = null;
  function ensureStorms(){
    if (!stormsApi) return null;
    const client = root.PolynResinAdminInstance?.getClient?.();
    if (!client) return null;
    if (!storms) storms = stormsApi.create({ client });
    return storms;
  }
  function stormState(storm){
    return storm.is_active
      ? `Blocked until ${new Date(storm.blocked_until).toLocaleTimeString()}`
      : `Resolved ${age(storm.updated_at)}`;
  }
  function renderStorms(rows){
    const list = $("conflictStormList");
    const badge = $("conflictStormBadge");
    const activeCount = rows.filter(row => row.is_active).length;
    if (badge){
      badge.hidden = activeCount === 0;
      badge.textContent = activeCount ? String(activeCount) : "";
    }
    if (!list) return;
    list.replaceChildren();
    if (!rows.length){
      const empty = document.createElement("div");
      empty.className = "tiny muted";
      empty.textContent = "No conflict storms in the last hour.";
      list.append(empty);
      return;
    }
    rows.forEach(row => {
      const item = document.createElement("div");
      item.className = `conflictStormRow${row.is_active ? " active" : " resolved"}`;
      const main = document.createElement("div");
      main.className = "conflictStormMain";
      const title = document.createElement("strong");
      title.textContent = row.workspace_name || "Unknown workspace";
      const meta = document.createElement("small");
      meta.className = "tiny muted";
      meta.textContent = `${row.device_label || "Unknown device"} · ${row.conflict_count} conflicts · ${stormState(row)}`;
      main.append(title, meta);
      const action = document.createElement("button");
      action.type = "button";
      action.className = "secondary";
      action.textContent = "Open Workspace";
      action.addEventListener("click", () => root.PolynWorkspaceRecoveryUI?.openWorkspace(row.workspace_id));
      item.append(main, action);
      list.append(item);
    });
  }
  let stormsTimer = null;
  async function refreshStorms(){
    const service = ensureStorms();
    if (!service) return;
    const result = await service.list();
    if (result.ok) renderStorms(result.storms);
  }
  function syncStorms(){
    const isAdmin = !!root.PolynResinAdminInstance?.getState().isAdmin;
    if (isAdmin && !stormsTimer){
      void refreshStorms();
      stormsTimer = setInterval(refreshStorms, api.REFRESH_MS);
    } else if (!isAdmin && stormsTimer){
      clearInterval(stormsTimer);
      stormsTimer = null;
      renderStorms([]);
    }
  }
  admin?.subscribe(syncStorms);
  syncStorms();
})(typeof globalThis !== "undefined" ? globalThis : this);
