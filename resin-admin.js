(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynResinAdmin = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const AUTH_STORAGE_KEY = "polyn.resinAdmin.auth.v1";
  const RESIN_FIELDS = "id,resin_code,display_description,density_g_cm3,bulk_density_lb_ft3,information_description,is_active,updated_at";

  function nullableText(value){
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
  }

  function validateResin(values){
    const resin_code = nullableText(values?.resin_code);
    const display_description = nullableText(values?.display_description);
    const information_description = nullableText(values?.information_description);
    const densityText = String(values?.density_g_cm3 ?? "").trim();
    const density_g_cm3 = densityText === "" ? null : Number(densityText);
    const bulkDensityText = String(values?.bulk_density_lb_ft3 ?? "").trim();
    const bulk_density_lb_ft3 = bulkDensityText === "" ? null : Number(bulkDensityText);
    if (!resin_code) return { valid: false, message: "Resin code is required." };
    if (density_g_cm3 !== null && (!Number.isFinite(density_g_cm3) || density_g_cm3 < 0.001 || density_g_cm3 > 10)) {
      return { valid: false, message: "Density must be blank or between 0.001 and 10 g/cm³." };
    }
    if (bulk_density_lb_ft3 !== null && (!Number.isFinite(bulk_density_lb_ft3) || bulk_density_lb_ft3 < 1 || bulk_density_lb_ft3 > 100)) {
      return { valid: false, message: "Bulk density must be blank or between 1 and 100 lb/ft³." };
    }
    return { valid: true, value: { resin_code, display_description, density_g_cm3, bulk_density_lb_ft3, information_description, is_active: !!values?.is_active } };
  }

  function validateBulkDensity(value){
    const number = Number(value);
    if (!Number.isFinite(number) || number < 1 || number > 100){
      return { valid:false, message:"Bulk density must be between 1 and 100 lb/ft³." };
    }
    return { valid:true, value:number };
  }

  function create(options = {}){
    const config = options.config || globalThis.POLYN_SUPABASE_CONFIG || {};
    const sdk = options.supabaseLibrary || globalThis.supabase;
    const catalog = options.catalog || globalThis.PolynResinCatalog;
    const listeners = new Set();
    let client = options.client || null;
    let state = { ready: false, signedIn: false, isAdmin: false, email: "", userId: "" };
    function emit(){ listeners.forEach(listener=>{ try{ listener({ ...state }); }catch(error){} }); }
    function getClient(){
      if (client) return client;
      if (!config.enabled || !config.url || !config.publishableKey || !sdk?.createClient) return null;
      client = sdk.createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY }
      });
      return client;
    }
    async function verify(user){
      if (!user) return false;
      const response = await getClient().from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
      if (response.error) throw response.error;
      return !!response.data?.user_id;
    }
    async function initialize(){
      const adminClient = getClient();
      state = { ready: true, signedIn: false, isAdmin: false, email: "", userId: "" };
      if (!adminClient){ emit(); return { ...state }; }
      try{
        const session = await adminClient.auth.getSession();
        const user = session.data?.session?.user;
        if (user && await verify(user)) state = { ready: true, signedIn: true, isAdmin: true, email: user.email || "", userId: user.id };
        else if (user) await adminClient.auth.signOut();
      }catch(error){}
      emit();
      return { ...state };
    }
    async function signIn(email, password){
      const adminClient = getClient();
      if (!adminClient) return { ok: false, message: "Admin sign-in is unavailable." };
      try{
        const response = await adminClient.auth.signInWithPassword({ email: String(email || "").trim(), password: String(password || "") });
        if (response.error) throw response.error;
        const user = response.data?.user;
        if (!user || !(await verify(user))){
          await adminClient.auth.signOut();
          state = { ready: true, signedIn: false, isAdmin: false, email: "", userId: "" };
          emit();
          return { ok: false, message: "This account does not have Resin Database access." };
        }
        state = { ready: true, signedIn: true, isAdmin: true, email: user.email || "", userId: user.id };
        emit();
        return { ok: true };
      }catch(error){ return { ok: false, message: "Could not sign in. Check the email and password." }; }
    }
    async function signOut(){
      try{ await getClient()?.auth.signOut(); }catch(error){}
      state = { ready: true, signedIn: false, isAdmin: false, email: "", userId: "" };
      emit();
    }
    async function listResins(){
      if (!state.isAdmin) return { ok: false, message: "Admin access is required.", resins: [] };
      try{
        const response = await getClient().from("resins").select(RESIN_FIELDS).order("resin_code", { ascending: true });
        if (response.error) throw response.error;
        return { ok: true, resins: response.data || [] };
      }catch(error){ return { ok: false, message: "Could not load the resin database.", resins: [] }; }
    }
    async function saveResin(id, values){
      if (!state.isAdmin) return { ok: false, message: "Admin access is required." };
      const checked = validateResin(values);
      if (!checked.valid) return { ok: false, message: checked.message };
      try{
        const query = id
          ? getClient().from("resins").update(checked.value).eq("id", id)
          : getClient().from("resins").insert(checked.value);
        const response = await query.select(RESIN_FIELDS).single();
        if (response.error) throw response.error;
        await catalog?.refreshResins?.();
        return { ok: true, resin: response.data };
      }catch(error){
        const duplicate = error?.code === "23505" || /duplicate|unique/i.test(error?.message || "");
        return { ok: false, message: duplicate ? "That resin code already exists." : "Could not save the resin. No changes were applied." };
      }
    }
    async function updateBulkDensity(id, expectedUpdatedAt, value){
      if (!state.isAdmin) return { ok:false, code:"unauthorized", message:"Admin access is required." };
      if (!id) return { ok:false, code:"missing_resin", message:"Choose an active Resin Database record." };
      const checked = validateBulkDensity(value);
      if (!checked.valid) return { ok:false, code:"invalid_bulk_density", message:checked.message };
      try{
        let mutation = getClient()
          .from("resins")
          .update({ bulk_density_lb_ft3:checked.value })
          .eq("id", id)
          .eq("is_active", true);
        if (expectedUpdatedAt) mutation = mutation.eq("updated_at", expectedUpdatedAt);
        const response = await mutation.select(RESIN_FIELDS).maybeSingle();
        if (response.error) throw response.error;
        if (!response.data){
          const current = await getClient().from("resins").select(RESIN_FIELDS).eq("id", id).maybeSingle();
          if (current.error) throw current.error;
          if (!current.data) return { ok:false, code:"missing_resin", message:"That resin no longer exists." };
          if (!current.data.is_active) return { ok:false, code:"inactive_resin", message:"That resin is no longer active." };
          return { ok:false, code:"record_changed", message:"That resin changed after it was selected. Review the current value and measure again." };
        }
        catalog?.acceptConfirmedResin?.(response.data);
        const refresh = await catalog?.refreshResins?.();
        return { ok:true, resin:response.data, catalogRefreshed:refresh?.loaded !== false };
      }catch(error){
        if (error?.code === "42501" || /permission|policy|authorized/i.test(error?.message || "")){
          return { ok:false, code:"unauthorized", message:"Admin access is required to update bulk density." };
        }
        if (error?.code === "23514" || /constraint|range/i.test(error?.message || "")){
          return { ok:false, code:"invalid_bulk_density", message:"The measured bulk density is outside the Resin Database constraint." };
        }
        return { ok:false, code:"network_error", message:"Could not update bulk density. No database change was confirmed." };
      }
    }
    async function deleteResin(id){
      if (!state.isAdmin) return { ok: false, message: "Admin access is required." };
      if (!id) return { ok: false, message: "Choose a resin to delete." };
      try{
        const response = await getClient().from("resins").delete().eq("id", id);
        if (response.error) throw response.error;
        await catalog?.refreshResins?.();
        return { ok: true };
      }catch(error){ return { ok: false, message: "Could not delete the resin. No changes were applied." }; }
    }
    function subscribe(listener){ listeners.add(listener); return ()=>listeners.delete(listener); }
    return { initialize, signIn, signOut, listResins, saveResin, updateBulkDensity, deleteResin, subscribe, getState: ()=>({ ...state }), getClient };
  }
  return { AUTH_STORAGE_KEY, RESIN_FIELDS, validateResin, validateBulkDensity, create };
});
