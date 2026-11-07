// Immutable edit deltas. Runtime indexes are rebuilt at commit boundaries;
// history owns changed values, never references to mutable live subtitle rows.
(function(global) {
  'use strict';
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const identity = value => object(value) ? typeof value.id === 'string' ? value.id
    : typeof value.cue_id === 'string' && Object.hasOwn(value,'subtitle_track_id')
      ? JSON.stringify([value.role,value.track_id,value.cue_id]) : null : null;
  function equal(a,b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if(Array.isArray(a)) {
      if(!Array.isArray(b)||a.length!==b.length)return false;
      for(let i=0;i<a.length;i++)if(!equal(a[i],b[i]))return false;
      return true;
    }
    if(Array.isArray(b))return false;
    const keys = Object.keys(a), other = Object.keys(b);
    // Live checkpoints may carry unset optional flags. Like the saved JSON
    // and diff(), an absent field and an undefined field are equivalent.
    let missing=keys.length!==other.length;
    for(const key of keys) {
      if(!Object.hasOwn(b,key)){if(a[key]!==undefined)return false;missing=true;}
      else if(!equal(a[key],b[key]))return false;
    }
    if(missing)for(const key of other)if(!Object.hasOwn(a,key)&&b[key]!==undefined)return false;
    return true;
  }
  function diff(before,after) {
    if (before === after) return null;
    if (Array.isArray(before) && Array.isArray(after)) {
      const a = before.map(identity), b = after.map(identity);
      if (a.every(x => x !== null) && b.every(x => x !== null) && new Set(a).size === a.length && new Set(b).size === b.length) {
        const old = new Map(before.map((v,i) => [a[i],v])), next = new Map(after.map((v,i) => [b[i],v])), entries=[];
        for (const id of new Set([...a,...b])) { const patch=diff(old.get(id),next.get(id)); if(patch)entries.push([id,patch]); }
        const order=equal(a,b)?null:[a,b];
        return entries.length || order ? {kind:'rows',entries,order} : null;
      }
      return equal(before,after) ? null : {kind:'value',before:copy(before),after:copy(after)};
    }
    if (object(before) && object(after)) {
      const entries=[];
      for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
        const patch=diff(Object.hasOwn(before,key)?before[key]:undefined,Object.hasOwn(after,key)?after[key]:undefined);if(patch)entries.push([key,patch]);
      }
      return entries.length ? {kind:'object',entries} : null;
    }
    return equal(before,after) ? null : {kind:'value',before:copy(before),after:copy(after)};
  }
  function apply(current,patch,forward=true,{check=true}={}) {
    if (!patch) return current;
    const from=forward?'before':'after', to=forward?'after':'before';
    if (patch.kind==='value') {
      if(check&&!equal(current,patch[from]))throw Error('编辑目标已改变，未提交操作');
      return copy(patch[to]);
    }
    if (patch.kind==='rows') {
      if(!Array.isArray(current))throw Error('编辑列表已改变，未提交操作');
      const order=current.map(identity), rows=new Map(current.map((v,i)=>[order[i],v]));
      if(check&&patch.order&&!equal(order,patch.order[forward?0:1]))throw Error('字幕顺序已改变，未提交操作');
      for(const [id,change] of patch.entries) {
        const value=apply(rows.get(id),change,forward,{check});
        if(value===undefined)rows.delete(id);else rows.set(id,value);
      }
      return (patch.order?.[forward?1:0]||order).map(id=>rows.get(id));
    }
    if(!object(current))throw Error('编辑对象已改变，未提交操作');
    const next={...current};
    for(const [key,change] of patch.entries) {
      const value=apply(Object.hasOwn(current,key)?current[key]:undefined,change,forward,{check});
      if(value===undefined)delete next[key];
      else if(key==='__proto__')Object.defineProperty(next,key,{value,writable:true,enumerable:true,configurable:true});
      else next[key]=value;
    }
    return next;
  }
  function changedCues(patch) {
    const ids=new Set();
    function visit(node,key='') {
      if(!node)return;
      if(key==='segments'&&node.kind==='rows')for(const [id] of node.entries)ids.add(id);
      if(key==='assignments'&&node.kind==='rows')for(const [id] of node.entries)ids.add(JSON.parse(id)[2]);
      if(['main_segment_ids','extension_segment_ids'].includes(key)&&node.kind==='value')
        for(const id of [...(node.before||[]),...(node.after||[])])ids.add(id);
      if(node.kind==='value')for(const value of [node.before,node.after])if(object(value))
        for(const id of [...(value.main_segment_ids||[]),...(value.extension_segment_ids||[])])ids.add(id);
      for(const [name,child] of node.entries||[])visit(child,name);
    }
    visit(patch);return ids;
  }
  function renderChanges(patch) {
    // Metadata/presentation edits may affect every existing row.
    const tracks=patch?.entries?.find(([k])=>k==='subtitle_tracks')?.[1];
    if(tracks?.entries?.some(([k])=>!['assignments','flat_context'].includes(k)))return null;
    const multi=patch?.entries?.find(([k])=>k==='multi_subtitle')?.[1];
    if(multi?.entries?.some(([k])=>!['tracks','bindings','_dirty'].includes(k)))return null;
    const sources=multi?.entries?.find(([k])=>k==='tracks')?.[1];
    if(sources?.order||sources?.entries?.some(([,row])=>row.kind!=='object'||row.entries.some(([k])=>!['segments','_dirty'].includes(k))))return null;
    const ids=changedCues(patch);return ids.size?ids:null;
  }
  const api={equal,diff,apply,changedCues,renderChanges};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.MSWEditTransaction=api;
})(typeof globalThis!=='undefined'?globalThis:this);
