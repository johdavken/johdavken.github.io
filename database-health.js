(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynDatabaseHealth = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const REFRESH_MS = 60_000;
  const BANDS = [{ max: 60, label: "Normal" }, { max: 85, label: "Elevated" }, { max: Infinity, label: "High" }];
  function status(cpuPercent){ return !Number.isFinite(cpuPercent) ? "Unavailable" : BANDS.find(band => cpuPercent < band.max).label; }
  function create({ invoke, onUpdate, isVisible, interval = setInterval, clear = clearInterval } = {}){
    let timer = null, samples = [], lastSuccess = null;
    async function refresh(){
      if (!isVisible?.()) return stop();
      const result = await invoke();
      if (result?.ok){
        lastSuccess = result;
        if (Number.isFinite(result.cpuPercent)) samples = [...samples, result.cpuPercent].slice(-30);
      }
      onUpdate?.({ result, samples: [...samples], lastSuccess });
    }
    function start(){ if (!timer && isVisible?.()) { void refresh(); timer = interval(refresh, REFRESH_MS); } }
    function stop(){ if (timer) clear(timer); timer = null; }
    return { start, stop, refresh, getState:()=>({ samples:[...samples], lastSuccess }), status };
  }
  return { REFRESH_MS, BANDS, status, create };
});
