"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("./workspace-configurations-service.js");

function storage(initial = {}){ const values = new Map(Object.entries(initial)); return { getItem:k=>values.get(k) || null, setItem:(k,v)=>values.set(k,String(v)), removeItem:k=>values.delete(k), values }; }
function recipePayload(){ return { schema_version: 1, line_type: 1, hopper_naming_mode: "standard", layers: [{ name: "A", layer_pct: 100, hoppers: [{ resin_name: "UNKNOWN-INACTIVE", pct: 80 }, { resin_name: null, pct: 20 }, { resin_name: null, pct: 0 }, { resin_name: null, pct: 0 }, { resin_name: null, pct: 0 }, { resin_name: null, pct: 0 }] }] }; }
function profilePayload(){ return { schema_version: 1, line_type: 1, hopper_naming_mode: "standard", hoppers_per_layer: 6, layers: [{ name: "A", receiver_weights_lb: [1,2,3,4,5,6] }] }; }
function row({ id="r1", workspace="A", type=service.TYPES.RECIPE, name="Alpha", favorite=false, payload=recipePayload() } = {}){ return { id, workspace_id: workspace, configuration_type:type, name, normalized_name:name.toLowerCase(), schema_version:1, payload, favorite, created_by:"u1", updated_by:"u1", created_at:"2026-01-01T00:00:00Z", updated_at:"2026-01-01T00:00:00Z" }; }
function envelope(workspace, items){ return JSON.stringify({ version:1, workspaceId:workspace, cachedAt:10, items }); }
function transport({ data=[], error=null, rpcError=null, calls=[] } = {}){ return { list: async (workspace, fields)=>{ calls.push(["list", workspace, fields]); return { data, error }; }, rpc: async (name,args)=>{ calls.push(["rpc",name,args]); return { data: {}, error: rpcError }; } }; }

test("valid isolated workspace caches load detached and malformed caches are empty", () => {
  const s = storage({ [service.cacheKey("A")]: envelope("A", { receiver_weight_profile: [], recipe: [service.normalizeRow(row(), "A")] }), [service.cacheKey("B")]: "{bad" });
  const catalog = service.create({ storage:s });
  const a = catalog.getCached("A"); a.items.recipe[0].name="changed";
  assert.equal(catalog.listRecipes("A").items[0].name, "Alpha");
  assert.equal(catalog.getCached("B").items.recipe.length, 0);
  assert.equal(catalog.getCached("C").items.recipe.length, 0);
});

test("cache version, workspace mismatch, malformed arrays, unavailable storage, and targeted clearing are safe", () => {
  const s = storage({ [service.cacheKey("A")]: JSON.stringify({ version:2, workspaceId:"A", cachedAt:1, items:{} }), [service.cacheKey("B")]: envelope("A", { recipe:[], receiver_weight_profile:[] }) });
  const catalog = service.create({ storage:s });
  assert.equal(catalog.getCached("A").cachedAt, 0); assert.equal(catalog.getCached("B").cachedAt, 0);
  const noStorage = service.create({ storage:null }); assert.equal(noStorage.getCached("A").ok, true);
  catalog.clearWorkspaceCache("A"); assert.equal(s.getItem(service.cacheKey("A")), null);
});

test("refresh normalizes, groups, sorts favorites first, and notifies only on success", async () => {
  const calls=[], events=[];
  const api = transport({ calls, data:[row({id:"z",name:"Zulu"}), row({id:"a",name:"Beta",favorite:true}), row({id:"p",type:service.TYPES.RECEIVER_WEIGHT_PROFILE,name:"Profile",payload:profilePayload()})] });
  const catalog = service.create({ storage:storage(), transport:api }); catalog.subscribe((snapshot)=>events.push(snapshot));
  const result = await catalog.refresh("A");
  assert.equal(result.ok,true); assert.deepEqual(result.items.recipe.map(x=>x.name),["Beta","Zulu"]); assert.equal(result.items.receiver_weight_profile.length,1); assert.equal(events.length,1); assert.equal(calls[0][2],service.ROW_FIELDS);
  const prior = catalog.getCached("A"); api.list=async()=>({data:[{bad:true}],error:null}); const failed=await catalog.refresh("A");
  assert.equal(failed.ok,false); assert.deepEqual(catalog.getCached("A"),prior); assert.equal(events.length,1);
});

test("failed and unauthorized refreshes preserve cache and workspace-bound results stay isolated", async () => {
  const s=storage(), pending=[]; const api={ list: workspace=>new Promise(resolve=>pending.push([workspace,resolve])) };
  const catalog=service.create({storage:s,transport:api}); const one=catalog.refresh("A"), two=catalog.refresh("B");
  pending.find(x=>x[0]==="B")[1]({data:[row({workspace:"B",id:"b"})],error:null}); await two;
  pending.find(x=>x[0]==="A")[1]({data:[row({workspace:"A",id:"a"})],error:null}); await one;
  assert.equal(catalog.listRecipes("A").items[0].id,"a"); assert.equal(catalog.listRecipes("B").items[0].id,"b");
  api.list=async()=>({data:null,error:{code:"42501",message:"workspace_access_denied"}}); const failed=await catalog.refresh("A"); assert.equal(failed.code,"access_denied"); assert.equal(catalog.listRecipes("A").items[0].id,"a");
});

test("create and update validate detached Phase 1 payloads before RPCs", async () => {
  const calls=[], api=transport({calls,data:[row()]}); const catalog=service.create({storage:storage(),transport:api,uuid:()=>"client-id"});
  const payload=recipePayload(); const created=await catalog.create("A",service.TYPES.RECIPE,"New",payload); assert.equal(created.ok,true); assert.equal(calls.find(x=>x[0]==="rpc")[1],"create_workspace_configuration"); assert.equal(calls.find(x=>x[0]==="rpc")[2].p_configuration_id,"client-id"); assert.equal("normalized_name" in calls.find(x=>x[0]==="rpc")[2],false); assert.equal(payload.layers[0].hoppers[0].resin_name,"UNKNOWN-INACTIVE");
  await catalog.refresh("A"); calls.length=0; const invalid=await catalog.update("A","r1",{...recipePayload(),schema_version:2}); assert.equal(invalid.code,"invalid_payload"); assert.equal(calls.length,0);
  const profile=await catalog.create("A",service.TYPES.RECEIVER_WEIGHT_PROFILE,"P",profilePayload()); assert.equal(profile.ok,true);
});

test("mutation wrappers use Phase 2 RPC signatures, map errors, and reject profile favorites", async () => {
  const calls=[], api=transport({calls,data:[row(),row({id:"p",type:service.TYPES.RECEIVER_WEIGHT_PROFILE,name:"P",payload:profilePayload()})]}); const catalog=service.create({storage:storage(),transport:api}); await catalog.refresh("A");
  await catalog.rename("A","r1","Renamed"); await catalog.duplicate("A","r1","Copy"); await catalog.delete("A","r1"); await catalog.setFavorite("A","r1",true);
  assert.deepEqual(calls.filter(x=>x[0]==="rpc").map(x=>x[1]),["rename_workspace_configuration","duplicate_workspace_configuration","delete_workspace_configuration","set_workspace_configuration_favorite"]);
  assert.equal((await catalog.setFavorite("A","p",true)).code,"invalid_type");
  api.rpc=async()=>({error:{code:"23505",message:"duplicate_workspace_configuration_name"}}); assert.equal((await catalog.rename("A","r1","Copy")).code,"duplicate_name");
});

test("subscriptions are detached, unsubscribe works, and subscriber errors are isolated", async () => {
  const catalog=service.create({storage:storage(),transport:transport({data:[row()]})}); let received=0; catalog.subscribe(()=>{throw new Error("ignore");}); const off=catalog.subscribe(snapshot=>{received++; snapshot.items.recipe[0].name="mutated";}); await catalog.refresh("A"); off(); await catalog.clearWorkspaceCache("A"); assert.equal(received,1); assert.equal(catalog.getCached("A").items.recipe.length,0);
});
