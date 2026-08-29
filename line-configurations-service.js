(function(root, factory){
  const api = factory(root?.PolynLineIdentity);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynLineConfigurations = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(identity){
  "use strict";

  const FIELDS = "id,line_number,display_name,aliases,layer_count,layer_a_position,hopper_geometry,hopper_naming_mode,is_active,metadata,created_at,updated_at";
  let client = null;
  let initialized = false;

  function getPublicClient(options = {}){
    if (options.client) return options.client;
    if (client) return client;
    const config = options.config || globalThis.POLYN_SUPABASE_CONFIG || {};
    const sdk = options.supabaseLibrary || globalThis.supabase;
    if (!config.enabled || !config.url || !config.publishableKey || !sdk?.createClient) return null;
    client = sdk.createClient(config.url, config.publishableKey, { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
    return client;
  }

  function announce(source){
    if (typeof globalThis.dispatchEvent === "function" && typeof globalThis.CustomEvent === "function"){
      globalThis.dispatchEvent(new CustomEvent("polyn:line-configurations", { detail:{ source } }));
    }
  }

  async function refresh(options = {}){
    const publicClient = getPublicClient(options);
    if (!publicClient) return { ok:false, source:"fallback", message:"Line configuration service is unavailable.", lines:identity?.getLineConfigurations?.() || [] };
    try{
      const response = await publicClient.from("line_configurations").select(FIELDS).order("line_number", { ascending:true });
      if (response.error) throw response.error;
      const checked = identity.setConfiguredLineConfigurations(response.data || []);
      if (!checked.valid) return { ok:false, source:"fallback", message:checked.message, lines:identity.getLineConfigurations() };
      announce("network");
      return { ok:true, source:"network", lines:identity.getLineConfigurations() };
    }catch(error){
      return { ok:false, source:"fallback", message:"Using saved line configurations while the service is unavailable.", lines:identity?.getLineConfigurations?.() || [] };
    }
  }

  function initialize(options = {}){
    if (initialized) return;
    initialized = true;
    identity?.loadCachedLineConfigurations?.(options.storage);
    refresh(options);
  }

  function friendlyAdminError(error){
    const source = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (source.includes("admin_access_required") || source.includes("42501")) return "Admin access is required.";
    if (source.includes("line_number") && (source.includes("unique") || source.includes("duplicate"))) return "That line number already exists.";
    if (source.includes("line_configuration_name_conflict")) return "That display name or alias already belongs to another active line.";
    return "Could not save the line configuration. No changes were applied.";
  }

  function createAdminService(adminClient){
    async function list(){
      if (!adminClient) return { ok:false, message:"Admin connection is unavailable.", lines:[] };
      try{
        const response = await adminClient.rpc("admin_list_line_configurations");
        if (response.error) throw response.error;
        return { ok:true, lines:response.data || [] };
      }catch(error){ return { ok:false, message:friendlyAdminError(error), lines:[] }; }
    }
    async function save(id, values){
      const candidate = identity.normalizedDefinition({ ...values, id:id || null });
      const checked = identity.validateLineConfigurations([candidate]);
      if (!checked.valid) return { ok:false, message:checked.message };
      if (!adminClient) return { ok:false, message:"Admin connection is unavailable." };
      try{
        const response = await adminClient.rpc("admin_save_line_configuration", {
          p_id:id || null, p_line_number:candidate.lineNumber, p_display_name:candidate.displayName,
          p_aliases:candidate.aliases, p_layer_count:candidate.layerCount,
          p_layer_a_position:candidate.layerAPosition, p_hopper_geometry:candidate.hopperGeometry,
          p_hopper_naming_mode:candidate.hopperNamingMode, p_is_active:candidate.isActive,
          p_metadata:candidate.metadata
        });
        if (response.error) throw response.error;
        await refresh();
        return { ok:true, line:response.data?.[0] || response.data };
      }catch(error){ return { ok:false, message:friendlyAdminError(error) }; }
    }
    return { list, save };
  }

  return { FIELDS, initialize, refresh, createAdminService, friendlyAdminError };
});
