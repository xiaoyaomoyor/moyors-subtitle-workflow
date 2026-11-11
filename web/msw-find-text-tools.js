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
  const scriptFields=['time','speaker','track','language','number'];
  const scriptError='整段粘贴需要保留完整信息行及字幕顺序；请使用“复制完整剧本”，或只粘贴到一条正文内';
  const scriptProtected='信息行和字幕边界只读，可选中复制；请在正文内编辑';
  const scriptLabel=value=>String(value??'').replace(/[\r\n\[\]⟦⟧]/g,' ');
  // This is a projection of cue identities, not a syntax the user must maintain.
  // Ranges distinguish literal body text from metadata even with all labels hidden.
  function scriptDocument(rows,text=row=>row.text,fields={}) {
    const visible=key=>fields[key]!==false,ranges=[];let value='';
    for(const entry of scriptEntries(rows))for(let i=0;i<entry.rows.length;i++){
      const row=entry.rows[i],from=value.length;
      let prefix=ranges.length?'\n':'';
      const heading=[visible('time')?`${formatTime(row.start)}~${formatTime(row.end)}`:'',visible('speaker')?scriptLabel(row.speakerName):''].filter(Boolean);
      if(i===0&&heading.length)prefix+=`[[${heading.join(' | ')}]]\n`;
      const label=[visible('track')?scriptLabel(row.trackName):'',visible('language')?scriptLabel(row.languageName||row.language):'',visible('number')?'#'+row.number:''].filter(Boolean);
      if(label.length)prefix+=`⟦${label.join(' · ')}⟧\n`;
      const body=String(text(row));value+=prefix+body;
      ranges.push({key:row.key,from,start:from+prefix.length,end:value.length,prefix,text:body});
    }
    return {text:value,ranges};
  }
  function packScript(rows,text=row=>row.text,fields={}){return scriptDocument(rows,text,fields).text;}
  function scriptRange(doc,start,end=start){return doc.ranges.find(r=>start>=r.start&&end<=r.end);}
  function scriptEdit(doc,next,selection){
    if(doc.text===next)return null;
    let start=0,end=doc.text.length,nextEnd=next.length;
    while(start<end&&start<nextEnd&&start<(selection?.[0]??Infinity)&&doc.text[start]===next[start])start++;
    while(end>Math.max(start,selection?.[1]??0)&&nextEnd>start&&doc.text[end-1]===next[nextEnd-1]){end--;nextEnd--;}
    const range=scriptRange(doc,start,end);if(!range)throw Error(scriptProtected);
    return {key:range.key,text:range.text.slice(0,start-range.start)+next.slice(start,nextEnd)+range.text.slice(end-range.start)};
  }
  // External round-trips require all identity labels. Reject ambiguous delimiters
  // atomically; ordinary single-cue paste is always literal and needs no parser.
  function unpackScript(rows,text) {
    text=text.replace(/\r\n?/g,'\n');const doc=scriptDocument(rows),values=new Map();let offset=0;
    for(let i=0;i<doc.ranges.length;i++){
      const range=doc.ranges[i];if(!text.startsWith(range.prefix,offset))throw Error(scriptError);
      const start=offset+range.prefix.length,next=doc.ranges[i+1];
      const end=next?text.indexOf(next.prefix,start):text.length;
      if(end<0||next&&text.indexOf(next.prefix,end+1)>=0)throw Error(scriptError);
      const value=text.slice(start,end);
      if(/^(?:\[\[.*\]\]|⟦.*⟧)$/m.test(value))throw Error(scriptError);
      values.set(range.key,value);offset=end;
    }
    if(offset!==text.length)throw Error(scriptError);
    return rows.map(row=>values.get(row.key));
  }
  const api={pack,unpack,formatTime,scriptEntries,scriptFields,scriptDocument,scriptRange,scriptEdit,packScript,unpackScript,scriptError,scriptProtected};
  global.MSWFindTextTools=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
