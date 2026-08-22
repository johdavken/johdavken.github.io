(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynBetaAccess = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Android beta access requests. The Help guide shows the Google Play
  // internal-testing link only once the administrator has confirmed the
  // requester is on the Play Console tester list.
  //
  // That link is a convenience, not a secret: Play refuses the install to
  // any account that is not on the tester list, so nothing here is load
  // bearing for keeping the build private.
  //
  // Reads go through RLS - the caller's own row, or every row for an admin -
  // matching how workspace configurations are read. Every write goes through
  // a security-definer RPC, so status, invited_at and the owning identity
  // can never be set from the client.

  const STATUS_NONE = "none";
  const STATUS_PENDING = "pending";
  const STATUS_INVITED = "invited";
  const CACHE_KEY = "resinTools.betaAccess.v1";
  const FIELDS = "id,email,display_name,status,created_at,invited_at";

  function friendlyError(error){
    const source = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (source.includes("admin_access_required")) return "Admin access is required.";
    if (source.includes("authentication_required") || source.includes("not_authenticated")){
      return "Resin.Tools is still connecting. Try again in a moment.";
    }
    if (source.includes("invalid_beta_application")) return "Enter your name and a valid email address.";
    if (source.includes("beta_applicant_not_found")) return "That request no longer exists.";
    if (source.includes("duplicate") || source.includes("23505")) return "That email is already on the list.";
    return "The request could not be sent. Try again.";
  }

  // Deliberately permissive, and deliberately not an RFC 5322 attempt: this
  // only catches obvious typos before a round trip. The database applies the
  // same shape as a constraint, and a wrong-but-plausible address is caught
  // by the invitation never arriving, not by a stricter pattern.
  function isPlausibleEmail(value){
    const email = String(value ?? "").trim();
    if (email.length < 6 || email.length > 254) return false;
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  }

  function normalizeEmail(value){ return String(value ?? "").trim().toLowerCase(); }
  function normalizeName(value){ return String(value ?? "").trim().replace(/\s+/g, " "); }

  function mapRow(row){
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      createdAt: row.created_at,
      invitedAt: row.invited_at
    };
  }

  // Last known answer for this browser, so an approved operator's link is on
  // screen at first paint instead of after a round trip. Purely a paint
  // optimization: every read below overwrites it, and it can only ever be as
  // generous as what the server last said. Losing it costs one refresh.
  function readCache(store){
    try{
      const raw = store?.getItem(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (![STATUS_NONE, STATUS_PENDING, STATUS_INVITED].includes(parsed.status)) return null;
      return parsed;
    }catch(error){ return null; }
  }

  function writeCache(store, application){
    try{
      if (!application){ store?.removeItem(CACHE_KEY); return; }
      store?.setItem(CACHE_KEY, JSON.stringify({
        status: application.status,
        email: application.email,
        displayName: application.displayName
      }));
    }catch(error){ /* a cache miss next load is the whole cost */ }
  }

  function create(options = {}){
    // `transport` is the narrow anonymous-client accessor from cloud-sync
    // (selectOwn/rpc); `adminClient` is resin-admin's separate signed-in
    // client. They are different Supabase sessions on purpose - see
    // getBetaAccessTransport in cloud-sync.js.
    const getTransport = options.getTransport || (() => options.transport || null);
    const getAdminClient = options.getAdminClient || (() => options.adminClient || null);
    const store = options.storage === undefined
      ? (typeof localStorage === "undefined" ? null : localStorage)
      : options.storage;

    function cached(){ return readCache(store); }

    async function getMyApplication(){
      const transport = getTransport();
      if (!transport) return { ok: false, message: "Resin.Tools is still connecting.", application: null };
      try{
        const response = await transport.selectOwn(FIELDS);
        if (response.error) throw response.error;
        const application = mapRow(response.data);
        writeCache(store, application);
        return { ok: true, application };
      }catch(error){
        return { ok: false, message: friendlyError(error), application: null };
      }
    }

    async function submit(email, displayName){
      const transport = getTransport();
      if (!transport) return { ok: false, message: "Resin.Tools is still connecting. Try again in a moment." };
      const cleanEmail = normalizeEmail(email);
      const cleanName = normalizeName(displayName);
      if (!cleanName || !isPlausibleEmail(cleanEmail)){
        return { ok: false, message: "Enter your name and a valid email address." };
      }
      try{
        const response = await transport.rpc("submit_beta_application", {
          p_email: cleanEmail,
          p_display_name: cleanName
        });
        if (response.error) throw response.error;
        const status = response.data || STATUS_PENDING;
        writeCache(store, { status, email: cleanEmail, displayName: cleanName });
        return { ok: true, status };
      }catch(error){
        return { ok: false, message: friendlyError(error) };
      }
    }

    async function withdraw(){
      const transport = getTransport();
      if (!transport) return { ok: false, message: "Resin.Tools is still connecting." };
      try{
        const response = await transport.rpc("delete_beta_application", { p_applicant_id: null });
        if (response.error) throw response.error;
        writeCache(store, null);
        return { ok: true };
      }catch(error){
        return { ok: false, message: friendlyError(error) };
      }
    }

    // Admin surface. The same RLS select the operator uses returns every row
    // here instead of one, because is_resin_admin() widens the policy -
    // there is no separate listing RPC to keep in step with the table.
    async function listApplicants(){
      const client = getAdminClient();
      if (!client) return { ok: false, message: "Admin sign-in is required.", applicants: [] };
      try{
        const response = await client
          .from("beta_applicants")
          .select(FIELDS)
          .order("created_at", { ascending: false });
        if (response.error) throw response.error;
        return { ok: true, applicants: (response.data || []).map(mapRow) };
      }catch(error){
        return { ok: false, message: friendlyError(error), applicants: [] };
      }
    }

    async function setInvited(applicantId, invited){
      const client = getAdminClient();
      if (!client) return { ok: false, message: "Admin sign-in is required." };
      if (!applicantId) return { ok: false, message: "That request no longer exists." };
      try{
        const response = await client.rpc("admin_set_beta_applicant_invited", {
          p_applicant_id: applicantId,
          p_invited: !!invited
        });
        if (response.error) throw response.error;
        return { ok: true };
      }catch(error){
        return { ok: false, message: friendlyError(error) };
      }
    }

    async function removeApplicant(applicantId){
      const client = getAdminClient();
      if (!client) return { ok: false, message: "Admin sign-in is required." };
      if (!applicantId) return { ok: false, message: "That request no longer exists." };
      try{
        const response = await client.rpc("delete_beta_application", { p_applicant_id: applicantId });
        if (response.error) throw response.error;
        return { ok: true };
      }catch(error){
        return { ok: false, message: friendlyError(error) };
      }
    }

    return {
      cached,
      getMyApplication,
      submit,
      withdraw,
      listApplicants,
      setInvited,
      removeApplicant
    };
  }

  return {
    STATUS_NONE,
    STATUS_PENDING,
    STATUS_INVITED,
    CACHE_KEY,
    friendlyError,
    isPlausibleEmail,
    normalizeEmail,
    normalizeName,
    create
  };
});
