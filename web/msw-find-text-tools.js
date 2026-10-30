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
  const api={pack,unpack};
  global.MSWFindTextTools=api;
  if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
