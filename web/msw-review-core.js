// Review notes belong to the project timeline, independently of subtitle edits.
(function(global) {
  'use strict';
  const SCHEMA='msw.review.v1', LIMIT=10000;
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const text=(v,n)=>typeof v==='string'&&v.length<=n;
  const id=v=>text(v,160)&&!!v.trim();
  const time=v=>Number.isSafeInteger(v)&&v>=0;
  function validate(value) {
    if(value===undefined)return;
    const fail=()=>{throw Error('复核标记格式无效');};
    if(!object(value)||value.schema!==SCHEMA||!Array.isArray(value.items)||value.items.length>LIMIT)fail();
    const ids=new Set();
    for(const item of value.items) {
      if(!object(item)||!id(item.id)||ids.has(item.id)||!time(item.start_ms)
        ||item.end_ms!==undefined&&(!time(item.end_ms)||item.end_ms<=item.start_ms)
        ||!text(item.name,120)||!text(item.note,2000)||typeof item.color!=='string'||!/^#[\da-f]{6}$/i.test(item.color)
        ||!['pending','resolved'].includes(item.status)
        ||item.track_id!==undefined&&!id(item.track_id)
        ||item.cue_ids!==undefined&&(!Array.isArray(item.cue_ids)||item.cue_ids.length>10000
          ||!item.cue_ids.every(id)||new Set(item.cue_ids).size!==item.cue_ids.length))fail();
      ids.add(item.id);
    }
    return value;
  }
  const empty=()=>({schema:SCHEMA,items:[]});
  const sorted=value=>[...(value?.items||[])].sort((a,b)=>a.start_ms-b.start_ms||a.id.localeCompare(b.id));
  function format(ms) {
    return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`;
  }
  function parse(value) {
    if(!/^(?:\d+:)?\d{1,2}:\d{2}(?:\.\d{1,3})?$/.test(value.trim()))throw Error('时间格式应为 时:分:秒.毫秒');
    const parts=value.trim().split(':').map(Number),seconds=parts.pop(),minutes=parts.pop(),hours=parts.pop()||0;
    const result=Math.round((hours*3600+minutes*60+seconds)*1000);
    if(minutes>=60||seconds>=60||!time(result))throw Error('时间格式应为 时:分:秒.毫秒');
    return result;
  }
  const api={SCHEMA,LIMIT,validate,empty,sorted,format,parse};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.MSWReview=api;
})(typeof window!=='undefined'?window:globalThis);
