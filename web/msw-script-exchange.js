// Plain-text exchange is parsed independently of the editor's current grouping.
(function(global){
  'use strict';
  function createCore(){
    const MAX_TEXT=20*1024*1024,MAX_ROWS=30000;
    const canonical=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
    const timeKey=row=>`${row.start}:${row.end}`;
    function time(value,line){
      const parts=value.replace(',','.').split(':'),seconds=Number(parts.pop()),minutes=Number(parts.pop()),hasHours=parts.length>0,hours=hasHours?Number(parts.pop()):0;
      const result=Math.round(((hours*60+minutes)*60+seconds)*1000);
      if(parts.length||seconds>=60||minutes>=60&&hasHours||!Number.isSafeInteger(result))throw Error(`第 ${line} 行：时间格式无效`);
      return result;
    }
    function parse(input){
      if(typeof input!=='string'||input.length>MAX_TEXT)throw Error('润色稿超过 20 MB');
      const lines=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n'),rows=[],tracks=[],known=new Set();
      let heading=null,current=null,group=0,exportId='';
      const flush=()=>{if(current){current.text=current.lines.join('\n');delete current.lines;rows.push(current);current=null;if(rows.length>MAX_ROWS)throw Error('润色稿超过 30000 条字幕');}};
      const stamp='(\\d+(?::\\d{2}){1,2}[.,]\\d{3})',header=new RegExp('^\\[\\[\\s*'+stamp+'\\s*[~～–—]\\s*'+stamp+'(?:\\s*[|｜]\\s*(.*?))?\\s*\\]\\]$');
      for(let i=0;i<lines.length;i++){
        const line=lines[i],trim=line.trim(),record=/^\[\[MSW-SCRIPT v1 \| ([A-Za-z0-9_.:-]{1,128})\]\]$/.exec(trim);
        if(record){if(exportId||rows.length||current||heading)throw Error(`第 ${i+1} 行：导出记录标记位置无效`);exportId=record[1];continue;}
        const h=header.exec(trim);
        if(h){
          if(heading&&!heading.count)throw Error(`第 ${heading.line} 行：信息行后缺少轨道标签`);
          flush();const start=time(h[1],i+1),end=time(h[2],i+1);if(end<start)throw Error(`第 ${i+1} 行：结束时间早于开始时间`);
          heading={start,end,speakerName:h[3]||'',line:i+1,count:0,group:group++};continue;
        }
        if(/^\[\[\s*\d+:/.test(trim))throw Error(`第 ${i+1} 行：时间格式无效`);
        const label=/^⟦(.*)⟧$/.exec(trim);
        if(label){
          const parts=label[1].split(/\s*[·|｜]\s*/),numberPart=parts.find(p=>/^#\s*\d+$/.test(p));
          const trackName=parts[0]?.trim();if(!trackName||trackName.startsWith('#'))throw Error(`第 ${i+1} 行：缺少轨道名称`);
          const number=numberPart?Number(numberPart.replace(/[#\s]/g,'')):null;
          if(number!==null&&(!Number.isSafeInteger(number)||number<1))throw Error(`第 ${i+1} 行：字幕序号无效`);
          flush();if(heading)heading.count++;
          current={index:rows.length,line:i+1,trackName,number,language:parts.slice(1).filter(p=>p!==numberPart).join(' · '),start:heading?.start??null,end:heading?.end??null,speakerName:heading?.speakerName||'',group:heading?.group??group++,lines:[]};
          if(!known.has(trackName)){known.add(trackName);tracks.push(trackName);}continue;
        }
        if(/^⟦/.test(trim))throw Error(`第 ${i+1} 行：轨道标签不完整`);
        if(current)current.lines.push(line);
        else if(trim)throw Error(`第 ${i+1} 行：正文前缺少轨道标签`);
      }
      if(heading&&!heading.count)throw Error(`第 ${heading.line} 行：信息行后缺少轨道标签`);
      flush();if(!rows.length)throw Error('未找到字幕；请导入包含轨道标签的完整剧本');
      const counts=new Map();for(const row of rows)if(row.number!==null){const key=JSON.stringify([row.trackName,row.number]);counts.set(key,(counts.get(key)||0)+1);}
      for(const row of rows)row.duplicateNumber=row.number!==null&&counts.get(JSON.stringify([row.trackName,row.number]))>1;
      return {rows,tracks,exportId};
    }
    function add(map,key,value){if(!map.has(key))map.set(key,[]);map.get(key).push(value);}
    function indexRows(rows){
      const tracks=new Map(),ids=new Map(),keys=new Map();
      for(const row of rows){
        let index=tracks.get(row.trackId);if(!index){index={rows:[],time:new Map(),number:new Map(),text:new Map()};tracks.set(row.trackId,index);}
        index.rows.push(row);add(index.time,timeKey(row),row);add(index.number,row.number,row);add(index.text,canonical(row.text).slice(0,2000),row);add(ids,row.id,row);keys.set(row.key,row);
      }
      for(const index of tracks.values())index.rows.sort((a,b)=>a.start-b.start||a.number-b.number);
      return {tracks,ids,keys};
    }
    function lower(rows,start){let a=0,b=rows.length;while(a<b){const mid=(a+b)>>>1;if(rows[mid].start<start)a=mid+1;else b=mid;}return a;}
    function similarity(a,b){
      a=canonical(a).slice(0,600);b=canonical(b).slice(0,600);if(a===b)return a?1:0;if(a.length<3||b.length<3)return 0;
      const grams=new Set();for(let i=1;i<a.length;i++)grams.add(a.slice(i-1,i+1));let hits=0;const seen=new Set();for(let i=1;i<b.length;i++){const g=b.slice(i-1,i+1);if(!seen.has(g)){seen.add(g);if(grams.has(g))hits++;}}
      return 2*hits/(grams.size+seen.size);
    }
    function resolve(source,index){
      if(!index)return {target:null,reason:'unmapped',candidates:[]};
      const exact=source.start===null?[]:index.time.get(timeKey(source))||[],numbered=exact.filter(r=>r.number===source.number);
      let target=numbered.length===1?numbered[0]:exact.length===1?exact[0]:null;
      const reason=target?(target.number===source.number?'number-time':'time'):'candidate';
      if(target&&!source.duplicateNumber)return {target,reason,candidates:[target.key]};
      const pool=new Map(exact.slice(0,20).map(r=>[r.key,r]));
      for(let offset=-2;offset<=2;offset++)for(const r of index.number.get((source.number??0)+offset)||[])pool.set(r.key,r);
      if(source.start!==null){const at=lower(index.rows,source.start);for(const r of index.rows.slice(Math.max(0,at-8),at+9))if(Math.abs(r.start-source.start)<=5000)pool.set(r.key,r);}
      for(const r of (index.text.get(canonical(source.text).slice(0,2000))||[]).slice(0,8))pool.set(r.key,r);
      const score=r=>similarity(source.text,r.text)*3+(source.start===null?0:2/(1+Math.abs(r.start-source.start)/200))+(r.number===source.number?0.5:0);
      const candidates=[...pool.values()].map(r=>({key:r.key,score:score(r)})).sort((a,b)=>b.score-a.score).slice(0,6).map(r=>r.key);
      if(source.duplicateNumber)target=null;
      return {target,reason:source.duplicateNumber?'duplicate-number':reason,candidates};
    }
    function defaultMapping(parsed,rows,record){
      const tracks=new Map(rows.map(r=>[r.trackId,r.trackName]));
      return parsed.tracks.map(name=>{
        const saved=[...new Set((record?.rows||[]).filter(r=>canonical(r.trackName)===canonical(name)&&tracks.has(r.trackId)).map(r=>r.trackId))];
        const matches=[...tracks].filter(([,label])=>canonical(label)===canonical(name));
        return [name,saved.length===1?saved[0]:matches.length===1?matches[0][0]:''];
      });
    }
    function plan(parsed,rows,{record=null,mapping=defaultMapping(parsed,rows,record),manual=[]}={}){
      const map=new Map(mapping),decisions=new Map(manual),index=indexRows(rows),baseline=record?indexRows(record.rows):null;
      const entries=parsed.rows.map(source=>{
        const trackId=map.get(source.trackName),chosen=decisions.get(source.index),skip=trackId==='-'||chosen==='';
        const match=resolve(source,index.tracks.get(trackId));let target=match.target,reason=match.reason;
        let base=null;
        if(baseline){
          const saved=resolve(source,baseline.tracks.get(trackId)).target;
          // A missing exported cue must never fall through to a replacement at the same time.
          target=saved?(index.ids.get(saved.id)||[]).find(r=>r.trackId===trackId):null;
          base=saved;reason=saved?'record':'record-review';
        }
        if(decisions.has(source.index)){target=index.keys.get(chosen);reason='manual';if(target?.trackId!==trackId)target=null;}
        if(target&&base?.id!==target.id)base=null;
        return {source,target:skip?null:target||null,base,reason,candidates:match.candidates,skip};
      });
      // A confirmed bound partner is a useful suggestion, never an implicit write.
      const groups=new Map();for(const entry of entries)add(groups,entry.source.group,entry);
      for(const entry of entries)if(!entry.target&&!entry.skip){const group=groups.get(entry.source.group);if(group.length!==2)continue;
        const other=group.find(e=>e!==entry&&e.target),id=other?.target.partnerId;
        const candidates=(index.ids.get(id)||[]).filter(r=>r.trackId===map.get(entry.source.trackName));
        if(candidates.length===1){entry.candidates=[candidates[0].key,...entry.candidates.filter(k=>k!==candidates[0].key)].slice(0,6);entry.reason='partner';}
      }
      const used=new Map();for(const entry of entries)if(entry.target)add(used,entry.target.key,entry);
      const counts={};
      for(const e of entries){
        const target=e.target;
        const current=target?.draftText??target?.text;
        e.status=e.skip?'skipped':!target?(e.candidates.length?'review':'missing'):used.get(target.key).length>1?'duplicate':target.locked?'locked':target.blocked?'blocked':current===e.source.text?'same':e.base&&e.source.text===e.base.text?'preserved':e.base?current!==e.base.text?'conflict':'update':target.draftText!==undefined&&target.draftText!==target.text?'conflict':'update';
        e.checkable=['update','conflict'].includes(e.status);e.checked=e.status==='update';counts[e.status]=(counts[e.status]||0)+1;
      }
      return {entries,counts};
    }
    function validateRecords(records){
      const string=(v,max)=>typeof v==='string'&&[...v].length<=max;
      const id=v=>string(v,160)&&v.length>0&&v.trim()===v;
      const integer=v=>Number.isSafeInteger(v)&&v>=0;
      if(!Array.isArray(records)||records.length>5)throw Error('润色稿导出记录无效');
      const seen=new Set();let size=0;
      for(const record of records){
        if(!record||typeof record!=='object'||typeof record.id!=='string'||!/^[-A-Za-z0-9_.:]{1,128}$/.test(record.id)||seen.has(record.id)||!integer(record.created_at)||!Array.isArray(record.rows)||!record.rows.length||record.rows.length>MAX_ROWS)throw Error('润色稿导出记录无效');
        seen.add(record.id);const cues=new Set();
        for(const row of record.rows){
          if(!row||!id(row.id)||!id(row.trackId)||!string(row.trackName,1000)||!row.trackName||!integer(row.number)||!row.number||!integer(row.start)||!integer(row.end)||row.end<row.start||!string(row.text,MAX_TEXT)||cues.has(row.id))throw Error('润色稿导出记录无效');
          cues.add(row.id);size+=[...row.text].length+[...row.trackName].length+[...row.id].length+[...row.trackId].length;
          if(size>8*1024*1024)throw Error('润色稿导出记录超过容量限制');
        }
      }
      return records;
    }
    return {MAX_TEXT,MAX_ROWS,parse,plan,canonical,defaultMapping,validateRecords};
  }
  const api=createCore();
  api.workerSource=()=>`const core=(${createCore.toString()})();onmessage=event=>{try{const {text,rows,options}=event.data,parsed=core.parse(text);postMessage({parsed,plan:core.plan(parsed,rows,options)});}catch(error){postMessage({error:error.message});}};`;
  global.MSWScriptExchange=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
