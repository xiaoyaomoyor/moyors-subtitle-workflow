// Shared, identity-preserving grouped text representation.
(function(global){
  'use strict';
  const marker = row => `⟦${row.trackName}_${row.number}⟧`;
  function pack(rows, text = row => row.text) { return rows.map(row => marker(row) + '\n' + text(row)).join('\n\n'); }
  function unpack(rows, text) {
    text = text.replace(/\r\n?/g, '\n');
    const values = []; let offset = 0;
    for (let i=0;i<rows.length;i++) {
      const prefix = marker(rows[i]) + '\n';
      if (!text.startsWith(prefix, offset)) throw Error('请保留字幕分隔行；增删字幕请使用切分或合并');
      const start = offset + prefix.length;
      const end = i+1<rows.length ? text.indexOf('\n\n'+marker(rows[i+1])+'\n',start) : text.length;
      if (end<0) throw Error('请保留字幕分隔行；增删字幕请使用切分或合并');
      const value=text.slice(start,end);
      if (/^⟦[^\n]+⟧$/m.test(value)) throw Error('请勿在正文中添加字幕分隔行');
      values.push(value); offset=end+2;
    }
    return values;
  }
  function formatTime(ms) {
    const total=Math.max(0,Math.round(ms)),seconds=Math.floor(total/1000),minutes=Math.floor(seconds/60);
    return (minutes>=60?`${String(Math.floor(minutes/60)).padStart(2,'0')}:`:'')+`${String(minutes%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}.${String(total%1000).padStart(3,'0')}`;
  }
  // Pair only explicit partners with identical timing/speaker metadata. Otherwise
  // each cue keeps its own header, so offsets and speaker differences stay visible.
  function scriptEntries(rows) {
    const sorted=[...rows].sort((a,b)=>a.start-b.start||a.order-b.order||a.number-b.number||a.key.localeCompare(b.key));
    const byId=new Map(rows.map(r=>[r.id,r])),seen=new Set(),entries=[];
    for(const row of sorted){
      if(seen.has(row.key))continue;
      const partner=byId.get(row.partnerId);
      const pair=partner&&!seen.has(partner.key)&&partner.partnerId===row.id&&partner.start===row.start&&partner.end===row.end&&partner.speakerId===row.speakerId;
      const members=pair?[row,partner].sort((a,b)=>Number(a.scriptSecondary)-Number(b.scriptSecondary)||a.order-b.order):[row];
      members.forEach(r=>seen.add(r.key));
      // Header labels are single-line even when a user-defined speaker name isn't.
      const label=value=>String(value??'').replace(/[\r\n|\[\]]/g,' ');
      entries.push({rows:members,header:`[[${formatTime(row.start)}~${formatTime(row.end)} | ${label(row.speakerName)} | ${members.map(r=>`${label(r.trackName)} | #${r.number}`).join(' / ')}]]`});
    }
    return entries;
  }
  const scriptError='请保留剧本信息行和正文外层引号；增删字幕请使用切分或合并';
  // Escaping only structural characters preserves real line breaks, whitespace,
  // empty cues and literal backslashes without ambiguous bilingual boundaries.
  function quoteScript(value,secondary) {
    const open=secondary?'"':'“',close=secondary?'"':'”';
    return open+String(value).replace(/[\\“”"]/g,char=>char==='\\'||char===open||char===close?'\\'+char:char)+close;
  }
  function packScript(rows,text=row=>row.text) {
    return scriptEntries(rows).map(entry=>entry.header+'\n'+entry.rows.map((row,i)=>quoteScript(text(row),i===1)).join('\n')).join('\n');
  }
  function parseScript(rows,text) {
    text=text.replace(/\r\n?/g,'\n');
    const values=new Map(),ranges=[];let offset=0;
    for(const entry of scriptEntries(rows)){
      const headerStart=offset,prefix=entry.header+'\n';
      if(!text.startsWith(prefix,offset))throw Error(scriptError);
      offset+=prefix.length;
      for(let i=0;i<entry.rows.length;i++){
        const row=entry.rows[i],open=i===1?'"':'“',close=i===1?'"':'”',start=offset;
        if(text[offset++]!==open)throw Error(scriptError);
        let value='',closed=false;
        while(offset<text.length){
          const char=text[offset++];
          if(char==='\\'){
            const next=text[offset];
            if(next==='\\'||next===open||next===close){value+=next;offset++;}
            else value+=char;
          }else if(char===close){closed=true;break;}else value+=char;
        }
        if(!closed)throw Error(scriptError);
        values.set(row.key,value);ranges.push({key:row.key,start:i===0?headerStart:start,end:offset});
        if(offset<text.length&&text[offset++]!=='\n')throw Error(scriptError);
      }
    }
    if(offset!==text.length)throw Error(scriptError);
    return {values:rows.map(row=>values.get(row.key)),ranges};
  }
  function unpackScript(rows,text){return parseScript(rows,text).values;}
  function scriptKeyAt(rows,text,offset){return parseScript(rows,text).ranges.find(r=>r.start<=offset&&offset<=r.end)?.key;}
  const api={pack,unpack,formatTime,scriptEntries,packScript,unpackScript,scriptKeyAt,scriptError};
  global.MSWFindTextTools=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
