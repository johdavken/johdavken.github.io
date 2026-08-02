(function(root,factory){const api=factory();if(typeof module==="object"&&module.exports)module.exports=api;if(root)root.PolynHopperRearrangement=api;})(typeof globalThis!=="undefined"?globalThis:this,function(){"use strict";
  const clone=v=>JSON.parse(JSON.stringify(v));
  const assignment=h=>({resinName:typeof h?.resinName==="string"?h.resinName:"",pct:Number.isFinite(h?.pct)?h.pct:0});
  const snapshot=layers=>layers.map(layer=>({name:layer.name,hoppers:layer.hoppers.map(assignment)}));
  const apply=(layers,shot)=>{for(const layer of layers){const saved=shot.find(x=>x.name===layer.name);if(saved) saved.hoppers.forEach((h,i)=>{layer.hoppers[i].resinName=h.resinName;layer.hoppers[i].pct=h.pct;});}};
  const recompute=layer=>{layer.hoppers[0].pct=Math.max(0,Math.min(100,100-layer.hoppers.slice(1).reduce((n,h)=>n+Number(h.pct||0),0)));};
  const valid=layer=>layer.hoppers.slice(1).every(h=>Number.isFinite(h.pct)&&h.pct>=0&&h.pct<=100)&&layer.hoppers.slice(1).reduce((n,h)=>n+h.pct,0)<=100.0001;
  function move(layers,source,target){if(!source||!target||source.layer===target.layer&&source.index===target.index)return {ok:false,reason:"no_change"};const before=snapshot(layers), working=clone(before);const a=working.find(x=>x.name===source.layer)?.hoppers[source.index],b=working.find(x=>x.name===target.layer)?.hoppers[target.index];if(!a||!b||(!a.resinName&&!a.pct))return {ok:false,reason:"empty_source"};const occupied=!!(b.resinName||b.pct);working.find(x=>x.name===target.layer).hoppers[target.index]=a;working.find(x=>x.name===source.layer).hoppers[source.index]=occupied?b:{resinName:"",pct:0};working.forEach(recompute);if(!working.every(valid))return {ok:false,reason:"invalid"};apply(layers,working);return {ok:true,before};}
  return {snapshot,apply,move,assignment};
});
