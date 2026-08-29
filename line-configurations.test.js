"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

function fresh(){ delete require.cache[require.resolve("./line-identity.js")]; return require("./line-identity.js"); }
const workspace = (name, extra={}) => ({ id:`ws-${name}`, name, ...extra });
const linked = selectedWorkspace => ({ selectedWorkspaceId:selectedWorkspace.id, selectedWorkspace, connected:true });

test("built-in definitions reproduce every legacy line fact",()=>{
  const identity=fresh();
  const layers=[1,1,1,1,3,3,3,3,3,5,5,3,3,3,5];
  const volume=new Set([1,2,3,4,7,8]);
  const inside=new Set([5,6,7,8]);
  identity.BUILT_IN_LINE_CONFIGURATIONS.forEach((line,index)=>{
    assert.equal(line.lineNumber,index+1);
    assert.equal(line.layerCount,layers[index]);
    assert.equal(line.hopperGeometry,volume.has(index+1)?"volume":"cylindrical");
    assert.equal(line.layerAPosition,index<4?null:(inside.has(index+1)?"inside":"outside"));
    assert.equal(line.hopperNamingMode,index===8?"main-plus-five":"standard");
  });
});

test("structured identity beats aliases, configured names beat legacy parsing",()=>{
  const identity=fresh();
  assert.equal(identity.setConfiguredLineConfigurations([{line_number:17,display_name:"Line Seventeen",aliases:["Extruder 17","Line 9"],layer_count:7,layer_a_position:"inside",hopper_geometry:"volume",hopper_naming_mode:"standard",is_active:true}]).valid,true);
  assert.equal(identity.workspaceLineNumber(workspace("Extruder 17")),17);
  assert.equal(identity.workspaceLineNumber(workspace("Line 9")),17);
  assert.equal(identity.workspaceLineNumber(workspace("Extruder 17",{line_number:9})),9);
  assert.equal(identity.getLineConfigurationForSync(linked(workspace("Line Seventeen"))).layerCount,7);
});

test("configured values override defaults and Line 9 naming remains exact",()=>{
  const identity=fresh();
  identity.setConfiguredLineConfigurations([{line_number:9,display_name:"Line 9",aliases:[],layer_count:5,layer_a_position:"inside",hopper_geometry:"volume",hopper_naming_mode:"main-plus-five",is_active:true}]);
  const state=linked(workspace("Line 9"));
  assert.equal(identity.requiredLayerCountForSync(state),5);
  assert.equal(identity.layerAPosition(9),"inside");
  assert.equal(identity.getSmartHopperGeometryModeForSync(state),"volume");
  assert.equal(identity.hopperNamingMode(state),"main");
});

test("cached definitions survive without a network request",()=>{
  const stored=new Map();
  const storage={getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)};
  let identity=fresh();
  identity.setConfiguredLineConfigurations([{line_number:17,display_name:"Line 17",aliases:[],layer_count:7,layer_a_position:"outside",hopper_geometry:"cylindrical",hopper_naming_mode:"standard",is_active:true}],{storage});
  identity=fresh();
  assert.equal(identity.loadCachedLineConfigurations(storage).source,"cache");
  assert.equal(identity.requiredLayerCount(17),7);
});

test("unknown lines fail safely and invalid duplicates are rejected",()=>{
  const identity=fresh();
  assert.equal(identity.getLineConfiguration(99).layerCount,null);
  assert.equal(identity.validateLineConfigurations([
    {line_number:17,display_name:"Line 17",aliases:["Extruder"],layer_count:7,layer_a_position:"outside",hopper_geometry:"volume",hopper_naming_mode:"standard",is_active:true},
    {line_number:18,display_name:"Line 18",aliases:["extruder"],layer_count:3,layer_a_position:"inside",hopper_geometry:"volume",hopper_naming_mode:"standard",is_active:true}
  ]).valid,false);
  assert.equal(identity.validateLineConfigurations([
    {line_number:17,display_name:"Line 17",aliases:[],layer_count:7,layer_a_position:"outside",hopper_geometry:"volume",hopper_naming_mode:"standard",is_active:true},
    {line_number:17,display_name:"Other",aliases:[],layer_count:3,layer_a_position:"inside",hopper_geometry:"volume",hopper_naming_mode:"standard",is_active:false}
  ]).valid,false);
});

test("inactive definitions resolve structured identity but not names",()=>{
  const identity=fresh();
  identity.setConfiguredLineConfigurations([{line_number:17,display_name:"Line 17",aliases:["Extruder 17"],layer_count:7,layer_a_position:"outside",hopper_geometry:"volume",hopper_naming_mode:"standard",is_active:false}]);
  assert.equal(identity.getLineConfigurationForSync(linked(workspace("Renamed",{line_number:17}))).layerCount,7);
  assert.equal(identity.workspaceLineNumber(workspace("Extruder 17")),null);
  assert.equal(identity.workspaceLineNumber(workspace("Line 17")),17);
});
