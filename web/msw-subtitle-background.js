// Background geometry shares the text anchor, including rotation and animation.
(function(global) {
  'use strict';
  const defaults=Object.freeze({backgroundShape:'none',backgroundColor:'#000000',backgroundOpacity:75,backgroundPaddingX:16,backgroundPaddingY:8,backgroundRadius:12});
  const fields=Object.keys(defaults);
  function valid(style) {
    return fields.every(k=>style[k]===undefined||(k==='backgroundShape'?['none','rect','rounded'].includes(style[k]):
      k==='backgroundColor'?typeof style[k]==='string'&&/^#[0-9a-f]{6}$/i.test(style[k]):
      typeof style[k]==='number'&&Number.isFinite(style[k])&&style[k]>=0&&style[k]<=(k==='backgroundOpacity'?100:240)));
  }
  function normalize(style={}) {
    if(!valid(style))throw Error('字幕背景参数无效');
    return Object.fromEntries(fields.map(k=>[k,style[k]??defaults[k]]));
  }
  const enabled=style=>['rect','rounded'].includes(style.backgroundShape);
  function box(style,size,alignment=style.alignment) {
    const s=normalize(style),horizontal=(alignment-1)%3,vertical=Math.floor((alignment-1)/3);
    const px=size.padding+s.backgroundPaddingX,py=size.padding+s.backgroundPaddingY;
    return {x:-horizontal*size.textWidth/2-px,y:-(2-vertical)*size.textHeight/2-py,
      width:size.textWidth+2*px,height:size.textHeight+2*py};
  }
  function bounds(style,size,alignment=style.alignment) {
    const b=box(style,size,alignment),angle=style.angle*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
    const points=[b.x,b.x+b.width].flatMap(x=>[b.y,b.y+b.height].map(y=>({x:x*c+y*s,y:-x*s+y*c})));
    const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));
    return {x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y};
  }
  const api=Object.freeze({defaults,fields,valid,normalize,enabled,box,bounds});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  global.MSWSubtitleBackground=api;
})(typeof window==='undefined'?globalThis:window);
