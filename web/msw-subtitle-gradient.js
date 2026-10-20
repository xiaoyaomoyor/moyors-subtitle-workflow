// ASS-native per-grapheme fill colors, never CSS-only glyph gradients.
(function(global){
  'use strict';
  const defaults=Object.freeze({gradientMode:'none',gradientStart:'#ffffff',gradientEnd:'#b79cff'});
  const fields=Object.keys(defaults);
  function valid(style){return fields.every(k=>style[k]===undefined||(k==='gradientMode'?['none','characters'].includes(style[k]):typeof style[k]==='string'&&/^#[0-9a-f]{6}$/i.test(style[k])));}
  function normalize(style={}){if(!valid(style))throw Error('字幕渐变参数无效');return Object.fromEntries(fields.map(k=>[k,style[k]??defaults[k]]));}
  const enabled=style=>style.gradientMode==='characters';
  function color(style,index,count){
    const s=normalize(style),p=count>1?Math.max(0,Math.min(1,index/(count-1))):0;
    return '#'+[1,3,5].map(i=>Math.round(parseInt(s.gradientStart.slice(i,i+2),16)*(1-p)+parseInt(s.gradientEnd.slice(i,i+2),16)*p).toString(16).padStart(2,'0')).join('');
  }
  const api={defaults,fields,valid,normalize,enabled,color};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWSubtitleGradient=api;
})(typeof window==='undefined'?globalThis:window);
