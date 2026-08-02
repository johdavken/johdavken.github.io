(function (root, factory) {
  const payloads = typeof module === "object" && module.exports
    ? require("./workspace-configuration-payloads.js")
    : root.PolynWorkspaceConfigurationPayloads;
  const api = factory(payloads);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynWorkspaceConfigurations = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (payloads) {
  "use strict";

  const CACHE_VERSION = 1;
  const CACHE_PREFIX = "polyn.workspaceConfigurations.v1::";
  const TYPES = Object.freeze({ RECEIVER_WEIGHT_PROFILE: "receiver_weight_profile", RECIPE: "recipe" });
  const TYPE_VALUES = Object.freeze(Object.values(TYPES));
  const ROW_FIELDS = "id,workspace_id,configuration_type,name,normalized_name,schema_version,payload,favorite,created_by,updated_by,created_at,updated_at";
  const clone = value => JSON.parse(JSON.stringify(value));
  const cacheKey = workspaceId => `${CACHE_PREFIX}${workspaceId}`;
  const isType = type => TYPE_VALUES.includes(type);
  const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
  const normalizedName = value => text(value)?.toLocaleLowerCase() || null;

  function emptyCache(workspaceId){
    return { ok: true, workspaceId, cachedAt: 0, items: { [TYPES.RECEIVER_WEIGHT_PROFILE]: [], [TYPES.RECIPE]: [] } };
  }
  function sortItems(type, items){
    return items.slice().sort((a, b) => {
      if (type === TYPES.RECIPE && a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);
    });
  }
  function normalizeRow(row, workspaceId){
    if (!row || typeof row !== "object" || row.workspace_id !== workspaceId || !isType(row.configuration_type)
        || !text(row.id) || !text(row.name) || !text(row.normalized_name) || row.schema_version !== 1
        || !row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)
        || !text(row.created_by) || !text(row.updated_by) || !text(row.created_at) || !text(row.updated_at)
        || typeof row.favorite !== "boolean" || (row.configuration_type !== TYPES.RECIPE && row.favorite)) return null;
    const validator = row.configuration_type === TYPES.RECIPE
      ? payloads?.validateRecipePayload : payloads?.validateReceiverWeightProfile;
    if (typeof validator !== "function" || !validator(clone(row.payload)).valid) return null;
    return {
      id: text(row.id), workspaceId, type: row.configuration_type, name: text(row.name), normalizedName: text(row.normalized_name),
      schemaVersion: row.schema_version, payload: clone(row.payload), favorite: row.favorite,
      createdBy: text(row.created_by), updatedBy: text(row.updated_by), createdAt: text(row.created_at), updatedAt: text(row.updated_at)
    };
  }
  function validEnvelope(value, workspaceId){
    if (!value || value.version !== CACHE_VERSION || value.workspaceId !== workspaceId || !Number.isFinite(value.cachedAt)
        || !value.items || typeof value.items !== "object") return null;
    const items = {};
    for (const type of TYPE_VALUES) {
      if (!Array.isArray(value.items[type])) return null;
      items[type] = value.items[type].map(item => normalizeRow({
        id: item?.id, workspace_id: workspaceId, configuration_type: item?.type, name: item?.name,
        normalized_name: item?.normalizedName, schema_version: item?.schemaVersion, payload: item?.payload,
        favorite: item?.favorite, created_by: item?.createdBy, updated_by: item?.updatedBy,
        created_at: item?.createdAt, updated_at: item?.updatedAt
      }, workspaceId));
      if (items[type].some(item => !item || item.type !== type)) return null;
      items[type] = sortItems(type, items[type]);
    }
    return { ok: true, workspaceId, cachedAt: value.cachedAt, items };
  }
  function errorResult(error){
    const source = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (source.includes("duplicate_workspace_configuration_name") || error?.code === "23505") return { ok: false, code: "duplicate_name", message: "A configuration with that name already exists." };
    if (source.includes("workspace_access_denied") || error?.code === "42501") return { ok: false, code: "access_denied", message: "You do not have access to this workspace." };
    if (source.includes("authentication") || source.includes("not_authenticated")) return { ok: false, code: "not_authenticated", message: "RT Sync authentication is unavailable." };
    return { ok: false, code: error ? "network_error" : "unavailable", message: error ? "Workspace configurations could not reach Supabase." : "Workspace configurations are unavailable." };
  }

  function create(options = {}){
    const storage = Object.prototype.hasOwnProperty.call(options, "storage") ? options.storage : (typeof localStorage !== "undefined" ? localStorage : null);
    const getTransport = options.getTransport || (() => options.transport || null);
    const memory = new Map();
    const listeners = new Set();
    function read(workspaceId){
      if (!text(workspaceId)) return emptyCache(workspaceId || "");
      if (memory.has(workspaceId)) return memory.get(workspaceId);
      let envelope = null;
      try { envelope = validEnvelope(JSON.parse(storage?.getItem?.(cacheKey(workspaceId)) || "null"), workspaceId); } catch (error) {}
      const result = envelope || emptyCache(workspaceId);
      memory.set(workspaceId, result);
      return result;
    }
    function save(envelope){
      memory.set(envelope.workspaceId, envelope);
      try { storage?.setItem?.(cacheKey(envelope.workspaceId), JSON.stringify({ version: CACHE_VERSION, workspaceId: envelope.workspaceId, cachedAt: envelope.cachedAt, items: envelope.items })); } catch (error) {}
    }
    function notify(envelope, result){
      const snapshot = clone(envelope);
      listeners.forEach(listener => { try { listener(snapshot, result); } catch (error) {} });
    }
    function getCached(workspaceId){ return clone(read(workspaceId)); }
    function listCached(workspaceId, type){
      if (!isType(type)) return { ok: false, code: "invalid_type", message: "Unsupported configuration type." };
      const cache = read(workspaceId);
      return { ok: true, workspaceId, cachedAt: cache.cachedAt, items: clone(cache.items[type]) };
    }
    function transport(){ return getTransport?.() || null; }
    async function refresh(workspaceId){
      if (!text(workspaceId)) return { ok: false, code: "missing_workspace", message: "A workspace is required." };
      const current = read(workspaceId), api = transport();
      if (!api?.list) return { ...errorResult(), cache: clone(current) };
      try {
        const response = await api.list(workspaceId, ROW_FIELDS);
        if (response?.error) return { ...errorResult(response.error), cache: clone(current) };
        if (!Array.isArray(response?.data)) return { ok: false, code: "unknown_error", message: "Supabase returned an invalid configuration list.", cache: clone(current) };
        const items = { [TYPES.RECEIVER_WEIGHT_PROFILE]: [], [TYPES.RECIPE]: [] };
        for (const row of response.data) {
          const item = normalizeRow(row, workspaceId);
          if (!item) return { ok: false, code: "unknown_error", message: "Supabase returned an invalid configuration record.", cache: clone(current) };
          items[item.type].push(item);
        }
        for (const type of TYPE_VALUES) items[type] = sortItems(type, items[type]);
        const next = { ok: true, workspaceId, cachedAt: Date.now(), items };
        save(next); notify(next, { ok: true, operation: "refresh" });
        return clone(next);
      } catch (error) { return { ...errorResult(error), cache: clone(current) }; }
    }
    function validate(type, payload){
      if (!isType(type)) return { ok: false, code: "invalid_type", message: "Unsupported configuration type." };
      const fn = type === TYPES.RECIPE ? payloads?.validateRecipePayload : payloads?.validateReceiverWeightProfile;
      const result = typeof fn === "function" ? fn(clone(payload)) : { valid: false, errors: ["Payload helpers are unavailable."] };
      return result.valid ? { ok: true, payload: clone(payload) } : { ok: false, code: "invalid_payload", message: result.errors?.[0] || "Invalid configuration payload." };
    }
    function id(){
      if (typeof options.uuid === "function") return options.uuid();
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
      return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => ((Math.random() * 16 | 0) & (c === "x" ? 15 : 3) | (c === "x" ? 0 : 8)).toString(16));
    }
    async function mutate(workspaceId, rpc, args){
      if (!text(workspaceId)) return { ok: false, code: "missing_workspace", message: "A workspace is required." };
      if ((Object.prototype.hasOwnProperty.call(args, "p_configuration_id") && !text(args.p_configuration_id))
          || (Object.prototype.hasOwnProperty.call(args, "p_source_configuration_id") && !text(args.p_source_configuration_id))) {
        return { ok: false, code: "not_found", message: "A configuration is required." };
      }
      const api = transport(), current = read(workspaceId);
      if (!api?.rpc) return { ...errorResult(), cache: clone(current) };
      try {
        const response = await api.rpc(rpc, args);
        if (response?.error) return { ...errorResult(response.error), cache: clone(current) };
        const refreshed = await refresh(workspaceId);
        return refreshed.ok ? { ok: true, operation: rpc, cache: refreshed } : { ok: true, operation: rpc, refreshed: false, cache: clone(current) };
      } catch (error) { return { ...errorResult(error), cache: clone(current) }; }
    }
    async function createItem(workspaceId, type, name, payload, options = {}){
      const checked = validate(type, payload); if (!checked.ok) return checked;
      if (!text(workspaceId)) return { ok: false, code: "missing_workspace", message: "A workspace is required." };
      if (!text(name)) return { ok: false, code: "invalid_name", message: "A configuration name is required." };
      if (type !== TYPES.RECIPE && options.favorite) return { ok: false, code: "invalid_type", message: "Only recipes can be favorites." };
      return mutate(workspaceId, "create_workspace_configuration", { p_workspace_id: workspaceId, p_configuration_id: id(), p_configuration_type: type, p_name: name.trim(), p_schema_version: 1, p_payload: checked.payload, p_favorite: !!options.favorite });
    }
    function find(workspaceId, configurationId){ return TYPE_VALUES.flatMap(type => read(workspaceId).items[type]).find(item => item.id === configurationId) || null; }
    async function update(workspaceId, configurationId, payload){
      const item = find(workspaceId, configurationId); if (!item) return { ok: false, code: "not_found", message: "Configuration was not found in the workspace cache." };
      const checked = validate(item.type, payload); if (!checked.ok) return checked;
      return mutate(workspaceId, "update_workspace_configuration", { p_workspace_id: workspaceId, p_configuration_id: configurationId, p_schema_version: 1, p_payload: checked.payload });
    }
    async function rename(workspaceId, configurationId, name){ if (!text(name)) return { ok: false, code: "invalid_name", message: "A configuration name is required." }; return mutate(workspaceId, "rename_workspace_configuration", { p_workspace_id: workspaceId, p_configuration_id: configurationId, p_name: name.trim() }); }
    async function duplicate(workspaceId, configurationId, newName){ if (!text(newName)) return { ok: false, code: "invalid_name", message: "A configuration name is required." }; return mutate(workspaceId, "duplicate_workspace_configuration", { p_workspace_id: workspaceId, p_source_configuration_id: configurationId, p_name: newName.trim() }); }
    async function remove(workspaceId, configurationId){ return mutate(workspaceId, "delete_workspace_configuration", { p_workspace_id: workspaceId, p_configuration_id: configurationId }); }
    async function setFavorite(workspaceId, configurationId, favorite){
      if (typeof favorite !== "boolean") return { ok: false, code: "invalid_payload", message: "Favorite must be true or false." };
      const item = find(workspaceId, configurationId); if (item && item.type !== TYPES.RECIPE && favorite) return { ok: false, code: "invalid_type", message: "Only recipes can be favorites." };
      return mutate(workspaceId, "set_workspace_configuration_favorite", { p_workspace_id: workspaceId, p_configuration_id: configurationId, p_favorite: favorite });
    }
    function clearWorkspaceCache(workspaceId){
      memory.delete(workspaceId); try { storage?.removeItem?.(cacheKey(workspaceId)); } catch (error) {}
      const empty = emptyCache(workspaceId); memory.set(workspaceId, empty); notify(empty, { ok: true, operation: "clear" }); return clone(empty);
    }
    function subscribe(listener){ if (typeof listener !== "function") return () => {}; listeners.add(listener); return () => listeners.delete(listener); }
    return { getCached, listCached, listRecipes: id => listCached(id, TYPES.RECIPE), listReceiverWeightProfiles: id => listCached(id, TYPES.RECEIVER_WEIGHT_PROFILE), refresh, create: createItem, update, rename, duplicate, delete: remove, setFavorite, clearWorkspaceCache, subscribe };
  }
  return { CACHE_VERSION, CACHE_PREFIX, TYPES, ROW_FIELDS, cacheKey, normalizeRow, create };
});
