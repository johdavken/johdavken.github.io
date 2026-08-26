(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynConflictStormAlerts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function friendlyError(error){
    const source = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (source.includes("admin_access_required")) return "Admin access is required.";
    if (source.includes("authentication_required") || source.includes("not_authenticated")) return "Admin sign-in is required.";
    return "Conflict storm data could not be loaded.";
  }

  function create(options = {}){
    const client = options.client || null;

    async function list(){
      if (!client) return { ok: false, message: "Admin connection is unavailable.", storms: [] };
      try{
        const response = await client.rpc("admin_list_conflict_storms");
        if (response.error) throw response.error;
        return { ok: true, storms: response.data || [] };
      }catch(error){ return { ok: false, message: friendlyError(error), storms: [] }; }
    }

    return { list };
  }

  return { friendlyError, create };
});
