// Partial per-cue appearance. Position and track animation remain independent.
(function(global) {
  'use strict';
  const numbers={fontSize:[1,512],outline:[0,100],shadow:[0,100],spacing:[-100,100],angle:[-360,360],scaleX:[0,1000],scaleY:[0,1000],charsPerLine:[1,200]};
  const booleans=['bold','italic','underline','strikeOut'];
  const colors=['primaryColor','outlineColor','backColor'];
  const background=typeof module!=='undefined'&&module.exports?require('./msw-subtitle-background.js'):global.MSWSubtitleBackground;
  const fields=Object.freeze(['fontName',...Object.keys(numbers),...booleans,...colors,'borderStyle','wrapMode',...background.fields]);
  function valid(value) {
    return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([k,v])=>{
      if(background.fields.includes(k))return background.valid({[k]:v});
      if(numbers[k])return typeof v==='number'&&Number.isFinite(v)&&v>=numbers[k][0]&&v<=numbers[k][1]&&(k!=='charsPerLine'||Number.isInteger(v));
      if(booleans.includes(k))return typeof v==='boolean';
      if(colors.includes(k))return typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
      if(k==='fontName')return typeof v==='string'&&!!v.trim()&&v.length<=128&&!/[\r\n,\x00]/.test(v);
      if(k==='borderStyle')return v===1||v===3;
      if(k==='wrapMode')return v==='auto'||v==='characters';
      return false;
    });
  }
  function apply(base,cue) {return {...base,...background.normalize(base),...(cue.subtitle_style||{})};}
  function appearance(style) {return Object.fromEntries(fields.filter(k=>style[k]!==undefined).map(k=>[k,style[k]]));}
  const api=Object.freeze({fields,valid,apply,appearance});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.MSWCueStyle=api;
})(typeof window==='undefined'?globalThis:window);
