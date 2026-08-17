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
      $("databaseHealthCpu").textContent = Number.isFinite(current.cpuPercent) ? `${current.cpuPercent.toFixed(1)}%` : "Unavailable";
      $("databaseHealthStatus").textContent = `Resin.Tools UI threshold: ${api.status(current.cpuPercent)}`;
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
})(typeof globalThis !== "undefined" ? globalThis : this);
