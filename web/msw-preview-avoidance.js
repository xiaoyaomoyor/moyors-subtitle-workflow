// Temporary player layout. Never write these offsets into a project or ASS export.
(function(global) {
  'use strict';
  const overlap=(a,b)=>a.x<b.x+b.width&&b.x<a.x+a.width;
  const concurrent=(a,b)=>a.spans.some(s=>b.spans.some(t=>s[0]<t[1]&&t[0]<s[1]));
  function plan(rows, obstacle, padding=8) {
    const offsets=new Map();
    if(!obstacle)return {offsets,overflow:false};
    const groups=new Map();
    for(const r of rows) {
      if(!(r.width>0&&r.height>0))continue;
      const id=r.groupId||r.key;
      let g=groups.get(id);
      if(!g){g={id,x:r.x,y:r.y,right:r.x+r.width,bottom:r.y+r.height,rows:[],spans:[]};groups.set(id,g);}
      g.x=Math.min(g.x,r.x);g.y=Math.min(g.y,r.y);g.right=Math.max(g.right,r.x+r.width);g.bottom=Math.max(g.bottom,r.y+r.height);
      g.rows.push(r);g.spans.push([r.start??0,r.end??Infinity]);
    }
    const placed=[];
    for(const g of [...groups.values()].sort((a,b)=>b.bottom-a.bottom||b.y-a.y)) {
      g.width=g.right-g.x;g.height=g.bottom-g.y;
      let shift=overlap(g,obstacle)&&g.bottom>obstacle.y&&g.y<obstacle.y+obstacle.height?g.bottom-obstacle.y+padding:0;
      // Move only neighbours newly hit by a shifted lower group. Existing
      // intentional overlaps and groups at unrelated times keep their layout.
      for(const lower of placed) {
        if(lower.shift<=0||g.bottom>lower.y+.01||!overlap(g,lower)||!concurrent(g,lower))continue;
        if(g.bottom-shift>lower.y-lower.shift)shift=Math.max(shift,g.bottom-lower.y+lower.shift);
      }
      if(shift>0&&g.y-shift<0)return {offsets:new Map(),overflow:true};
      g.shift=shift;placed.push(g);
      for(const r of g.rows)offsets.set(r.key,shift?-shift:0);
    }
    return {offsets,overflow:false};
  }
  function shiftText(text,dy,dx=0) {
    if(!dy&&!dx)return text;
    // Only generated positioning tags in override blocks are changed. Subtitle
    // text, animation timings and the source stay intact.
    return text.replace(/\{[^}]*\}/g,block=>block.replace(/\\(pos|move|org|i?clip)\(([^)]*)\)/g,(tag,name,args)=>{
      const values=args.split(',').map(Number);
      if(values.some(n=>!Number.isFinite(n)))return tag;
      if(['pos','org'].includes(name)&&values.length===2){values[0]+=dx;values[1]+=dy;}
      else if(name==='move'&&(values.length===4||values.length===6)){values[0]+=dx;values[1]+=dy;values[2]+=dx;values[3]+=dy;}
      else if(/clip$/.test(name)&&values.length===4){values[0]+=dx;values[1]+=dy;values[2]+=dx;values[3]+=dy;}
      else return tag;
      return '\\'+name+'('+values.map(n=>Math.round(n*1000)/1000).join(',')+')';
    }));
  }
  const api={plan,shiftText};
  if(typeof module==='object'&&module.exports)module.exports=api;
  global.MSWPreviewAvoidanceCore=api;
})(typeof window==='object'?window:globalThis);
