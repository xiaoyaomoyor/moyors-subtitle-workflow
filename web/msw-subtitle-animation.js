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
    if(!object(raw)||raw.schema!==schema||!object(raw.effects)||Object.keys(raw).some(k=>!['schema','effects','mode'].includes(k))||
      (Object.hasOwn(raw,'mode')&&!['presets','custom'].includes(raw.mode)))return false;
    return Object.entries(raw.effects).every(([name,e])=>{
      const d=definitions[name],extra=name==='fade'?['start','end']:name==='blink'?['periodUnit']:[];
      if(!d||!object(e)||Object.keys(d).some(k=>!Object.hasOwn(e,k))||Object.keys(e).some(k=>!Object.hasOwn(d,k)&&!extra.includes(k)))return false;
      if(name==='fade'&&Object.hasOwn(e,'start')!==Object.hasOwn(e,'end'))return false;
      for(const [k,v] of Object.entries(e)){
        if(k==='enabled'){if(typeof v!=='boolean')return false;}
        else if(k==='unit'||k==='periodUnit'){if(!['percent','ms'].includes(v))return false;}
        else if(k==='easing'){if(!['linear','ease-in','ease-out','smooth'].includes(v))return false;}
        else if(k==='channels'){if(!validChannels(v,e.unit))return false;}
        else{
          const bounds=[...timings(name),'start','end'].includes(k)?[0,e.unit==='percent'?100:60000]:k==='period'?(e.periodUnit==='percent'?[1,100]:[80,60000]):k.endsWith('Opacity')||k==='opacity'?[0,100]:k.endsWith('Scale')?[1,1000]:k.endsWith('Rotation')?[-360,360]:[-4096,4096];
          if(typeof v!=='number'||!Number.isFinite(v)||v<bounds[0]||v>bounds[1])return false;
        }
      }
      if(name==='fade'&&Object.hasOwn(e,'start'))return e.end>e.start&&e.in+e.out<=e.end-e.start+1e-8;
      return name==='curves'||name==='fade'||e.end>e.start;
    });
  }
  function normalize(raw){if(!valid(raw))throw Error('字幕动画参数无效');return {schema,...(raw.mode?{mode:raw.mode}:{}),effects:{...clone(definitions),...clone(raw.effects)}};}
  const defaults=()=>({schema,effects:clone(definitions)});
  function resolve(base,override){const mode=override?.mode??base?.mode;return base===undefined&&override===undefined?null:normalize({schema,...(mode?{mode}:{}),effects:{...(base?.effects||{}),...(override?.effects||{})}});}
  function active(raw){
    if(!raw.mode)return raw;
    return {...raw,effects:Object.fromEntries(Object.entries(raw.effects).map(([key,e])=>[key,
      (raw.mode==='custom')===(key==='curves')?e:{...e,enabled:false}]))};
  }
  const authoringMode=raw=>raw.mode||(raw.effects.curves?.enabled&&Object.keys(raw.effects.curves.channels).length?'custom':'presets');
  // Snap within legal bounds, never across a neighbouring keyframe. If a very
  // narrow interval contains no grid point, keep its valid boundary instead.
  function snapValue(value,modifiers={},min=0,max=100,precision=.1){
    const step=modifiers.ctrlKey?(modifiers.shiftKey?5:1):precision;
    const low=Math.ceil((min-1e-9)/step)*step,high=Math.floor((max+1e-9)/step)*step;
    const bounded=low<=high?Math.max(low,Math.min(high,Math.round(value/step)*step)):Math.max(min,Math.min(max,value));
    return Math.max(min,Math.min(max,Math.round(bounded*1e9)/1e9));
  }
  function presetTimes(name,e){return name==='fade'?[e.start,e.start+e.in,e.end-e.out,e.end]:[e.start,e.end];}
  function dragPreset(name,original,{edge,band},value,delta,modifiers={}){
    const p=presetTimes(name,original),round=v=>Math.round(v*1e9)/1e9;
    if(band!==undefined){
      const [a,b]=name==='fade'?(band==='in'?[0,1]:[2,3]):[0,1];
      delta=snapValue(p[a]+delta,modifiers,a?p[a-1]:0,(b<p.length-1?p[b+1]:100)-(p[b]-p[a]))-p[a];
      for(let i=a;i<=b;i++)p[i]=round(p[i]+delta);
    }else{
      const i=Number(edge),gap=name==='fade'?0:.1;
      p[i]=snapValue(value,modifiers,i?p[i-1]+gap:0,i<p.length-1?p[i+1]-gap:100);
    }
    if(p.at(-1)-p[0]<.099999999)return {};
    return {start:p[0],end:p.at(-1),...(name==='fade'?{in:round(p[1]-p[0]),out:round(p[3]-p[2])}:{})};
  }
  function presetDefault(name){
    const e=clone(definitions[name]);
    if(name==='fade')Object.assign(e,{start:0,end:100});
    if(name==='blink')Object.assign(e,{period:20,periodUnit:'percent'});
    return e;
  }
  function presetState(raw,name,duration=1000){
    const source=normalize(raw).effects[name];
    if(JSON.stringify(source)===JSON.stringify(definitions[name]))return presetDefault(name);
    const e=clone(source);
    if(e.unit==='ms'){
      for(const key of ['in','out','start','end'])if(Object.hasOwn(e,key))e[key]=clamp(e[key]*100/Math.max(1,duration),0,100);
      e.unit='percent';
      if(Object.hasOwn(e,'end')&&e.end<=e.start)e.start=Math.max(0,e.end-.1);
    }
    if(name==='fade'&&!Object.hasOwn(e,'start')){
      const ratio=e.in+e.out>100?100/(e.in+e.out):1;
      Object.assign(e,{start:0,end:100,in:e.in*ratio,out:e.out*ratio});
    }
    if(name==='fade'&&e.in+e.out>e.end-e.start){
      const ratio=(e.end-e.start)/(e.in+e.out);e.in*=ratio;e.out*=ratio;
    }
    if(name==='blink'&&e.periodUnit!=='percent')Object.assign(e,{period:clamp(e.period*100/duration,1,100),periodUnit:'percent'});
    return e;
  }
  // Authoring modes retain both banks. Only the active bank is sampled/exported.
  function authorPatch(raw,name,action,duration=1000){
    const a=normalize(raw),patch={schema,effects:{}};
    if(action.type==='mode'){
      patch.mode=action.value;
      if(action.value==='custom'&&Object.keys(a.effects.curves.channels).length&&!a.effects.curves.enabled)patch.effects.curves={...a.effects.curves,enabled:true};
      if(!valid(patch))throw Error('动画模式无效');
      return patch;
    }
    if(name==='curves'){
      const c=clone(a.effects.curves);
      if(action.type==='unit')patch.effects.curves=convertUnit(c,action.value,duration);
      else if(action.type==='reset')patch.effects.curves=clone(definitions.curves);
      else{
        // Multi-selection edits normalize other channels to the displayed unit.
        const next=convertUnit(c,action.unit||c.unit,duration);
        next.enabled=true;
        if(action.points===null)delete next.channels[action.channel];else next.channels[action.channel]=clone(action.points);
        patch.effects.curves=next;
      }
      patch.mode='custom';
    }else{
      const e=action.type==='reset'?{...presetDefault(name),enabled:a.effects[name].enabled}:presetState(a,name,duration);
      if(action.type==='toggle')e.enabled=action.value;
      if(action.type==='values')Object.assign(e,action.value);
      patch.effects[name]=e;patch.mode='presets';
    }
    if(!valid(patch))throw Error('动画参数无效：时间不能交叉，数值须在允许范围内');
    return patch;
  }
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
  // Editing uses the existing ASS contract. Presets write parameters once;
  // they never become a second stack of render-time switches.
  function editablePoints(raw,key,duration=1000){
    const a=normalize(raw),c=a.effects.curves,t=a.effects.transform,f=a.effects.fade;
    if(c.enabled&&c.channels[key]&&!(key==='opacity'&&f.enabled))return clone(c.channels[key]);
    const end=c.unit==='percent'?100:Math.min(60000,duration);
    const sampleAt=time=>{
      const plain=clone(a);plain.effects.blink.enabled=false;
      return sample(plain,time*(c.unit==='percent'?duration/100:1),duration)[key]*(key==='opacity'?100:1);
    };
    const times=new Set([0,end]);
    const toTime=ms=>clamp(ms*(c.unit==='percent'?100/duration:1),0,end);
    if(t.enabled&&!(c.enabled&&c.channels[key])){
      const start=ms(t,'start',duration),finish=ms(t,'end',duration);
      for(let i=0;i<=12;i++)times.add(toTime(start+(finish-start)*i/12));
    }
    if(key==='opacity'&&f.enabled){
      let start=ms(f,'in',duration),out=ms(f,'out',duration);
      if(start+out>duration){const ratio=duration/(start+out);start*=ratio;out*=ratio;}
      times.add(toTime(start));times.add(toTime(duration-out));
      // Combined envelopes are sampled only when the user edits this channel.
      if(c.enabled&&c.channels.opacity)for(let i=0;i<=24;i++)times.add(end*i/24);
    }
    let sorted=[...times].sort((a,b)=>a-b);
    if(sorted.length>32)sorted=Array.from({length:32},(_,i)=>end*i/31);
    return sorted.map(time=>({time,value:sampleAt(time),easing:'linear'}));
  }
  function editChannel(raw,key,points){
    const a=normalize(raw),effects={curves:clone(a.effects.curves)};
    effects.curves.enabled=true;
    if(points===null)delete effects.curves.channels[key];else effects.curves.channels[key]=clone(points);
    if(key==='opacity')effects.fade={...a.effects.fade,enabled:false};
    // Disabling a channel must not reveal a hidden older transform beneath it.
    if(points===null&&a.effects.transform.enabled){
      const suffix={x:'X',y:'Y',scale:'Scale',rotation:'Rotation',opacity:'Opacity'}[key];
      effects.transform={...a.effects.transform,['from'+suffix]:channels[key].initial,['to'+suffix]:channels[key].initial};
    }
    return {schema,effects};
  }
  function presetPatch(raw,name,duration=1000){
    const a=normalize(raw);
    if(name==='typewriter'||name==='blink')return {schema,effects:{[name]:{...clone(definitions[name]),enabled:true}}};
    const key=name==='fade'?'opacity':'scale',unit=a.effects.curves.unit;
    const time=p=>{
      const value=unit==='percent'?p:duration*p/100;
      if(value>60000)throw Error('此预设超过毫秒时间上限，请先切换为百分比');
      return value;
    };
    const points=name==='fade'?
      [{time:0,value:0,easing:'linear'},{time:time(10),value:100,easing:'linear'},{time:time(90),value:100,easing:'linear'},{time:time(100),value:0,easing:'linear'}]:
      [{time:0,value:85,easing:'smooth'},{time:time(25),value:100,easing:'linear'}];
    if(!['fade','transform'].includes(name))throw Error('未知动画预设');
    return editChannel(a,key,points);
  }
  function sample(raw,elapsed,duration,count=0){
    raw=active(raw);
    const {fade:f,typewriter:w,blink:b,transform:t}=raw.effects;
    const time=clamp(elapsed,0,duration),state={opacity:1,x:0,y:0,scale:100,rotation:0,revealed:count};
    if(f.enabled){let a=ms(f,'in',duration),z=ms(f,'out',duration),start=Object.hasOwn(f,'start')?ms(f,'start',duration):0,end=Object.hasOwn(f,'end')?ms(f,'end',duration):duration;if(a+z>end-start){const ratio=(end-start)/(a+z);a*=ratio;z*=ratio;}state.opacity=time<start||time>end?0:clamp(Math.min(a?(time-start)/a:1,z?(end-time)/z:1,1));}
    const period=b.period*(b.periodUnit==='percent'?duration/100:1);
    if(b.enabled&&time>=ms(b,'start',duration)&&time<ms(b,'end',duration)&&Math.floor((time-ms(b,'start',duration))/(period/2))%2)state.opacity*=b.opacity/100;
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
    const motion=row.motion?active(row.motion):null,t=motion?.effects.transform,c=motion?.effects.curves;if(!t?.enabled&&!c?.enabled)return row;
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
  const api={schema,names,timings,valid,normalize,defaults,resolve,ms,sample,envelope,delayAssTags,channels,curveValue,convertUnit,editablePoints,editChannel,presetPatch,active,authoringMode,presetDefault,presetState,authorPatch,snapValue,presetTimes,dragPreset};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWSubtitleAnimation=api;
})(typeof globalThis==='undefined'?window:globalThis);
