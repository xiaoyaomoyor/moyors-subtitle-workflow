// Shared animation contract. Time is always relative to the original cue.
(function(global){
  'use strict';
  const schema='msw.subtitle-animation.v1';
  const definitions={
    fade:{enabled:false,unit:'percent',in:10,out:10},
    typewriter:{enabled:false,unit:'percent',start:0,end:40},
    blink:{enabled:false,unit:'percent',start:0,end:100,period:600,opacity:0},
    transform:{enabled:false,unit:'percent',start:0,end:25,fromX:0,fromY:0,toX:0,toY:0,fromScale:85,toScale:100,fromRotation:0,toRotation:0,fromOpacity:100,toOpacity:100,easing:'smooth'},
    curves:{enabled:false,unit:'percent',channels:{}}
  };
  const channels={x:{label:'横向位移 (px)',min:-4096,max:4096,initial:0},y:{label:'纵向位移 (px)',min:-4096,max:4096,initial:0},
    scale:{label:'缩放 (%)',min:1,max:1000,initial:100},rotation:{label:'旋转 (°)',min:-360,max:360,initial:0},opacity:{label:'不透明度 (%)',min:0,max:100,initial:100}};
  const names=Object.keys(definitions),clone=v=>JSON.parse(JSON.stringify(v));
  const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const timings=name=>name==='curves'?[]:name==='fade'?['in','out']:['start','end'];
  function validChannels(raw,unit){
    return object(raw)&&Object.entries(raw).every(([key,points])=>{
      const c=channels[key];return c&&Array.isArray(points)&&points.length>0&&points.length<=32&&points.every((p,i)=>
        object(p)&&Object.keys(p).length===3&&['time','value','easing'].every(k=>Object.hasOwn(p,k))&&
        typeof p.time==='number'&&Number.isFinite(p.time)&&p.time>=0&&p.time<=(unit==='percent'?100:60000)&&
        (!i||p.time>points[i-1].time)&&typeof p.value==='number'&&Number.isFinite(p.value)&&p.value>=c.min&&p.value<=c.max&&
        ['linear','smooth','hold'].includes(p.easing));
    });
  }
  function valid(raw){
    if(!object(raw)||raw.schema!==schema||!object(raw.effects)||Object.keys(raw).some(k=>!['schema','effects'].includes(k)))return false;
    return Object.entries(raw.effects).every(([name,e])=>{
      const d=definitions[name];if(!d||!object(e)||Object.keys(e).length!==Object.keys(d).length)return false;
      for(const [k,v] of Object.entries(e)){
        if(!Object.hasOwn(d,k))return false;
        if(k==='enabled'){if(typeof v!=='boolean')return false;}
        else if(k==='unit'){if(!['percent','ms'].includes(v))return false;}
        else if(k==='easing'){if(!['linear','ease-in','ease-out','smooth'].includes(v))return false;}
        else if(k==='channels'){if(!validChannels(v,e.unit))return false;}
        else{
          const bounds=timings(name).includes(k)?[0,e.unit==='percent'?100:60000]:k==='period'?[80,60000]:k.endsWith('Opacity')||k==='opacity'?[0,100]:k.endsWith('Scale')?[1,1000]:k.endsWith('Rotation')?[-360,360]:[-4096,4096];
          if(typeof v!=='number'||!Number.isFinite(v)||v<bounds[0]||v>bounds[1])return false;
        }
      }
      return name==='curves'||name==='fade'||e.end>e.start;
    });
  }
  function normalize(raw){if(!valid(raw))throw Error('字幕动画参数无效');return {schema,effects:{...clone(definitions),...clone(raw.effects)}};}
  const defaults=()=>({schema,effects:clone(definitions)});
  function resolve(base,override){return base===undefined&&override===undefined?null:normalize({schema,effects:{...(base?.effects||{}),...(override?.effects||{})}});}
  const ms=(e,key,duration)=>e[key]*(e.unit==='percent'?duration/100:1);
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const ease=(p,mode)=>mode==='ease-in'?p*p:mode==='ease-out'?1-(1-p)**2:mode==='smooth'?p*p*(3-2*p):p;
  function curveValue(points,time){
    if(time<=points[0].time)return points[0].value;
    for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i];if(time<b.time){
      const p=a.easing==='hold'?0:ease((time-a.time)/(b.time-a.time),a.easing);return a.value+(b.value-a.value)*p;
    }}
    return points.at(-1).value;
  }
  function convertUnit(effect,unit,duration){
    const next=clone(effect);if(next.unit===unit)return next;
    const limit=unit==='percent'?100:60000;
    const convert=t=>{
      const value=t*(effect.unit==='percent'?duration/100:1)*(unit==='percent'?100/duration:1);
      if(!Number.isFinite(value)||value>limit+1e-8)throw Error('转换后的时间超出范围，请先调整关键帧或动画时段');
      return Math.min(limit,value);
    };
    const times=effect.channels?Object.values(effect.channels).flat().map(p=>p.time):Object.keys(effect).filter(k=>['in','out','start','end'].includes(k)).map(k=>effect[k]);
    times.forEach(convert);
    if(effect.channels)for(const points of Object.values(next.channels))for(const p of points)p.time=convert(p.time);
    else for(const k of ['in','out','start','end'])if(Object.hasOwn(next,k))next[k]=convert(next[k]);
    next.unit=unit;return next;
  }
  function sample(raw,elapsed,duration,count=0){
    const {fade:f,typewriter:w,blink:b,transform:t}=raw.effects;
    const time=clamp(elapsed,0,duration),state={opacity:1,x:0,y:0,scale:100,rotation:0,revealed:count};
    if(f.enabled){let a=ms(f,'in',duration),z=ms(f,'out',duration);if(a+z>duration){const ratio=duration/(a+z);a*=ratio;z*=ratio;}state.opacity=Math.min(a?time/a:1,z?(duration-time)/z:1,1);}
    if(b.enabled&&time>=ms(b,'start',duration)&&time<ms(b,'end',duration)&&Math.floor((time-ms(b,'start',duration))/(b.period/2))%2)state.opacity*=b.opacity/100;
    let transformOpacity=100;
    if(t.enabled){const p=ease(clamp((time-ms(t,'start',duration))/(ms(t,'end',duration)-ms(t,'start',duration))),t.easing);for(const [key,suffix] of [['x','X'],['y','Y'],['scale','Scale'],['rotation','Rotation']])state[key]=t['from'+suffix]+(t['to'+suffix]-t['from'+suffix])*p;transformOpacity=t.fromOpacity+(t.toOpacity-t.fromOpacity)*p;}
    const c=raw.effects.curves;
    if(c?.enabled)for(const [key,points] of Object.entries(c.channels)){
      const v=curveValue(points,time*(c.unit==='percent'?100/duration:1));if(key==='opacity')transformOpacity=v;else state[key]=v;
    }
    state.opacity*=transformOpacity/100;
    if(w.enabled)state.revealed=Math.floor(clamp((time-ms(w,'start',duration))/(ms(w,'end',duration)-ms(w,'start',duration)))*count+1e-7);
    return state;
  }
  function envelope(row,width){
    const t=row.motion?.effects.transform,c=row.motion?.effects.curves;if(!t?.enabled&&!c?.enabled)return row;
    const values=(key,suffix)=>c?.enabled&&c.channels[key]?c.channels[key].map(p=>p.value):t?.enabled?[t['from'+suffix],t['to'+suffix]]:[channels[key].initial];
    const scales=values('scale','Scale'),dx=values('x','X'),dy=values('y','Y'),rotations=values('rotation','Rotation');
    const ax=row.position.x*width,ay=row.position.y*1080,s=Math.max(...scales)/100;
    const corners=[[row.x-ax,row.y-ay],[row.x+row.width-ax,row.y-ay],[row.x-ax,row.y+row.height-ay],[row.x+row.width-ax,row.y+row.height-ay]];
    const radius=Math.max(...corners.map(([x,y])=>Math.hypot(x,y)))*s,rotate=rotations.some(Boolean);
    const xs=rotate?[-radius,radius]:corners.flatMap(([x])=>scales.map(v=>x*v/100));
    const ys=rotate?[-radius,radius]:corners.flatMap(([,y])=>scales.map(v=>y*v/100));
    return {...row,x:ax+Math.min(...xs)+Math.min(...dx),y:ay+Math.min(...ys)+Math.min(...dy),width:Math.max(...xs)-Math.min(...xs)+Math.max(...dx)-Math.min(...dx),height:Math.max(...ys)-Math.min(...ys)+Math.max(...dy)-Math.min(...dy)};
  }
  // Extending the first exported event must hold its initial pose, then keep
  // the same source clock. Only tags emitted by our compiler are accepted.
  function delayAssTags(text,delta){
    const add=v=>String(Math.round((Number(v)+delta)*10000)/10000);
    return text.replace(/\\t\(([\d.]+),([\d.]+),1,/g,(_,a,b)=>`\\t(${add(a)},${add(b)},1,`)
      .replace(/\\move\(([-\d.,]+)\)/g,(tag,args)=>{const values=args.split(',');if(values.length!==6)return tag;values[4]=add(values[4]);values[5]=add(values[5]);return `\\move(${values.join(',')})`;});
  }
  const api={schema,names,timings,valid,normalize,defaults,resolve,ms,sample,envelope,delayAssTags,channels,curveValue,convertUnit};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWSubtitleAnimation=api;
})(typeof globalThis==='undefined'?window:globalThis);
