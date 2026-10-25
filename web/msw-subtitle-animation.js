// Shared animation contract. Time is always relative to the original cue.
(function(global){
  'use strict';
  const schema='msw.subtitle-animation.v1';
  const definitions={
    fade:{enabled:false,unit:'percent',in:10,out:10},
    typewriter:{enabled:false,unit:'percent',start:0,end:40},
    blink:{enabled:false,unit:'percent',start:0,end:100,period:600,opacity:0},
    transform:{enabled:false,unit:'percent',start:0,end:25,fromX:0,fromY:0,toX:0,toY:0,fromScale:85,toScale:100,fromRotation:0,toRotation:0,fromOpacity:100,toOpacity:100,easing:'smooth'},
    slide:{enabled:false,unit:'percent',start:0,in:15,out:15,end:100,direction:'right',distance:120},
    curves:{enabled:false,unit:'percent',channels:{}}
  };
  const channels={x:{label:'横向位移 (px)',min:-4096,max:4096,initial:0},y:{label:'纵向位移 (px)',min:-4096,max:4096,initial:0},
    scale:{label:'缩放 (%)',min:1,max:1000,initial:100},rotation:{label:'旋转 (°)',min:-360,max:360,initial:0},opacity:{label:'不透明度 (%)',min:0,max:100,initial:100}};
  const names=Object.keys(definitions),clone=v=>JSON.parse(JSON.stringify(v));
  const object=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const timings=name=>name==='curves'?[]:name==='fade'?['in','out']:['start','end'];
  const anchor=p=>p.anchor||'start';
  const pointOrder=(a,b)=>anchor(a)!==anchor(b)?(anchor(a)==='start'?-1:1):(a.time-b.time)*(anchor(a)==='end'?-1:1);
  const sortPoints=points=>points.sort(pointOrder);
  function validChannels(raw,unit){
    return object(raw)&&Object.entries(raw).every(([key,points])=>{
      const c=channels[key];return c&&Array.isArray(points)&&points.length>0&&points.length<=32&&points.every((p,i)=>
        object(p)&&Object.keys(p).every(k=>['time','value','easing','anchor'].includes(k))&&['time','value','easing'].every(k=>Object.hasOwn(p,k))&&
        (!Object.hasOwn(p,'anchor')||['start','end'].includes(p.anchor))&&
        typeof p.time==='number'&&Number.isFinite(p.time)&&p.time>=0&&p.time<=(unit==='percent'?100:60000)&&
        (!i||pointOrder(points[i-1],p)<0)&&typeof p.value==='number'&&Number.isFinite(p.value)&&p.value>=c.min&&p.value<=c.max&&
        ['linear','smooth','hold'].includes(p.easing));
    });
  }
  function valid(raw){
    if(!object(raw)||raw.schema!==schema||!object(raw.effects)||Object.keys(raw).some(k=>!['schema','effects','mode','timing'].includes(k))||
      (Object.hasOwn(raw,'timing')&&!['percent','ms'].includes(raw.timing))||
      (Object.hasOwn(raw,'mode')&&!['presets','custom'].includes(raw.mode)))return false;
    return Object.entries(raw.effects).every(([name,e])=>{
      const d=definitions[name],extra=[...(name==='curves'?['pulse']:['endAnchor']),...(name==='fade'?['start','end']:name==='blink'?['periodUnit']:name==='typewriter'?['custom']:[])];
      if(!d||!object(e)||Object.keys(d).some(k=>!Object.hasOwn(e,k))||Object.keys(e).some(k=>!Object.hasOwn(d,k)&&!extra.includes(k)))return false;
      if(name==='fade'&&Object.hasOwn(e,'start')!==Object.hasOwn(e,'end'))return false;
      for(const [k,v] of Object.entries(e)){
        if(k==='enabled'||k==='custom'){if(typeof v!=='boolean')return false;}
        else if(k==='direction'){if(!['left','right','up','down'].includes(v))return false;}
        else if(k==='unit'||k==='periodUnit'){if(!['percent','ms'].includes(v))return false;}
        else if(k==='easing'){if(!['linear','ease-in','ease-out','smooth'].includes(v))return false;}
        else if(k==='channels'){if(!validChannels(v,e.unit))return false;}
        else if(k==='endAnchor'){if(!['start','end'].includes(v)||!Object.hasOwn(e,'end'))return false;}
        else if(k==='pulse'){if(!valid({schema,effects:{blink:v}}))return false;}
        else{
          const bounds=[...timings(name),'start','end',...(name==='slide'?['in','out']:[])].includes(k)?[0,e.unit==='percent'?100:60000]:k==='distance'?[0,4096]:k==='period'?(e.periodUnit==='percent'?[1,100]:[80,60000]):k.endsWith('Opacity')||k==='opacity'?[0,100]:k.endsWith('Scale')?[1,1000]:k.endsWith('Rotation')?[-360,360]:[-4096,4096];
          if(typeof v!=='number'||!Number.isFinite(v)||v<bounds[0]||v>bounds[1])return false;
        }
      }
      if(e.endAnchor==='end')return true;
      if((name==='fade'||name==='slide')&&Object.hasOwn(e,'start'))return e.end>e.start&&e.in+e.out<=e.end-e.start+1e-8;
      return name==='curves'||name==='fade'||e.end>e.start;
    });
  }
  function normalize(raw){if(!valid(raw))throw Error('字幕动画参数无效');return {schema,...(raw.mode?{mode:raw.mode}:{}),...(raw.timing?{timing:raw.timing}:{}),effects:{...clone(definitions),...clone(raw.effects)}};}
  const defaults=()=>({schema,effects:clone(definitions)});
  function resolve(base,override){const mode=override?.mode??base?.mode,timing=override?.timing??base?.timing;return base===undefined&&override===undefined?null:normalize({schema,...(mode?{mode}:{}),...(timing?{timing}:{}),effects:{...(base?.effects||{}),...(override?.effects||{})}});}
  function active(raw){
    if(!raw.mode)return raw;
    return {...raw,effects:Object.fromEntries(Object.entries(raw.effects).map(([key,e])=>[key,
      (raw.mode==='custom'?(key==='curves'||key==='typewriter'&&e.custom):key!=='curves')?e:{...e,enabled:false}]))};
  }
  const authoringMode=raw=>raw.mode||(raw.effects.curves?.enabled&&Object.keys(raw.effects.curves.channels).length?'custom':'presets');
  // Snap within legal bounds, never across a neighbouring keyframe. If a very
  // narrow interval contains no grid point, keep its valid boundary instead.
  function snapValue(value,modifiers={},min=0,max=100,precision=.1,ctrlStep=1){
    const step=modifiers.ctrlKey?(modifiers.shiftKey?5:1)*ctrlStep:precision;
    const low=Math.ceil((min-1e-9)/step)*step,high=Math.floor((max+1e-9)/step)*step;
    const bounded=low<=high?Math.max(low,Math.min(high,Math.round(value/step)*step)):Math.max(min,Math.min(max,value));
    return Math.max(min,Math.min(max,Math.round(bounded*1e9)/1e9));
  }
  function presetTimes(name,e){return ['fade','slide'].includes(name)?[e.start,e.start+e.in,e.end-e.out,e.end]:[e.start,e.end];}
  function dragPreset(name,original,{edge,band},value,delta,modifiers={}){
    const p=presetTimes(name,original),round=v=>Math.round(v*1e9)/1e9,limit=original._extent||100,scale=original.unit==='ms'?1000:1;
    const snap=(v,lo,hi)=>snapValue(v/scale,modifiers,lo/scale,hi/scale,scale===1000?.001:.1,scale===1000?.01:1)*scale;
    if(band!==undefined){
      const [a,b]=['fade','slide'].includes(name)?(band==='in'?[0,1]:[2,3]):[0,1];
      delta=snap(p[a]+delta,a?p[a-1]:0,(b<p.length-1?p[b+1]:limit)-(p[b]-p[a]))-p[a];
      for(let i=a;i<=b;i++)p[i]=round(p[i]+delta);
    }else{
      const i=Number(edge),gap=['fade','slide'].includes(name)?0:scale===1000?1:.1;
      p[i]=snap(value,i?p[i-1]+gap:0,i<p.length-1?p[i+1]-gap:limit);
    }
    if(p.at(-1)-p[0]<.099999999)return {};
    return {start:p[0],end:p.at(-1),...(['fade','slide'].includes(name)?{in:round(p[1]-p[0]),out:round(p[3]-p[2])}:{})};
  }
  function presetDefault(name){
    const e=clone(definitions[name]);
    if(name==='fade')Object.assign(e,{start:0,end:100});
    if(name==='blink')Object.assign(e,{period:20,periodUnit:'percent'});
    if(name==='transform')Object.assign(e,{fromScale:100,toScale:115});
    return e;
  }
  function presetState(raw,name,duration=1000){
    const source=normalize(raw).effects[name];
    if(JSON.stringify(source)===JSON.stringify(definitions[name]))return presetDefault(name);
    const e=source.endAnchor?clockEffect(source,duration):clone(source);
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
  function authorState(raw,name,duration=1000){
    const source=normalize(raw).effects[name];
    const e=JSON.stringify(source)===JSON.stringify(definitions[name])?presetDefault(name):clone(source);
    if(name==='fade'&&e.unit==='ms'&&!Object.hasOwn(e,'start'))Object.assign(e,{start:0,end:0,endAnchor:'end'});
    return raw.timing?effectUnit(e,name,raw.timing,duration):e;
  }
  function anchoredCurves(raw,duration){
    const a=normalize(raw),c={enabled:true,unit:'ms',channels:{}};
    const effects=Object.fromEntries(names.filter(n=>n!=='curves').map(n=>[n,effectUnit(authorState(a,n,duration),n,'ms',duration)]));
    const point=(time,value,easing='linear',anchor='start')=>({time,value,easing,anchor});
    const ends=e=>{
      const start=e.start||0,end=e.end??0,tail=e.endAnchor==='end'||!Object.hasOwn(e,'end');
      return [point(start,0),point(start+e.in,0),point(tail?end+e.out:end-e.out,0,'linear',tail?'end':'start'),point(end,0,'linear',tail?'end':'start')];
    };
    const zeroPhases=(points,e,isFade)=>{
      if(!e.out){
        if(isFade&&e.endAnchor==='end'&&e.end===0)points.pop();
        else {points.splice(2,1);points[1].easing='hold';}
      }
      if(!e.in){
        const first=points.shift();
        if(e.start>0)points.unshift({...first,time:0,easing:'hold'});
      }
      return points;
    };
    const {fade:f,blink:b,transform:t,slide:s}=effects;
    if(t.enabled)for(const [key,suffix] of [['opacity','Opacity'],['x','X'],['y','Y'],['scale','Scale'],['rotation','Rotation']]){
      if(t['from'+suffix]===channels[key].initial&&t['to'+suffix]===channels[key].initial)continue;
      if(!['linear','smooth'].includes(t.easing))throw Error('请将原有舒展过渡改为匀速或平滑，再转为自定义');
      c.channels[key]=[point(t.start,t['from'+suffix],t.easing),point(t.end,t['to'+suffix],'linear',t.endAnchor||'start')];
    }
    if(f.enabled){
      if(c.channels.opacity)throw Error('请先分别编辑淡入淡出与原有透明度变换，再转为自定义');
      c.channels.opacity=zeroPhases(ends(f).map((p,i)=>({...p,value:i===1||i===2?100:0})),f,true);
    }
    if(s.enabled){
      const key=['left','right'].includes(s.direction)?'x':'y',sign=['left','up'].includes(s.direction)?-1:1;
      if(c.channels[key])throw Error('滑入滑出与原有位移动画重合，请先保留其中一种再转为自定义');
      c.channels[key]=zeroPhases(ends(s).map((p,i)=>({...p,value:(!i?-1:i===3?1:0)*sign*s.distance,easing:i===0||i===2?'smooth':'linear'})),s,false);
    }
    // A finite list of baked keys cannot represent a fixed period on arbitrary
    // cue lengths. Retain the oscillator as editable curve modulation.
    if(b.enabled)c.pulse=clone(b);
    for(const [key,p] of Object.entries(c.channels))c.channels[key]=sortPoints(p).filter((p,i,all)=>!i||pointOrder(all[i-1],p)!==0);
    return c;
  }
  // Bake only active numeric channels. Preserve discontinuities and reject a
  // conversion that cannot fit the editable curve budget instead of losing it.
  function curvesFromPresets(raw,duration=1000){
    if(timingMode(raw)==='ms')return anchoredCurves(raw,duration);
    const a=normalize(raw);a.mode='presets';
    const {fade:f,blink:b,transform:t,slide:s}=a.effects,c={enabled:true,unit:'percent',channels:{}};
    const phase=e=>[ms(e,'start',duration),ms(e,'start',duration)+ms(e,'in',duration),ms(e,'end',duration)-ms(e,'out',duration),ms(e,'end',duration)];
    for(const [key,suffix] of [['opacity','Opacity'],['x','X'],['y','Y'],['scale','Scale'],['rotation','Rotation']]){
      const transform=t.enabled&&(t['from'+suffix]!==channels[key].initial||t['to'+suffix]!==channels[key].initial);
      const sliding=s.enabled&&key===(['left','right'].includes(s.direction)?'x':'y');
      if(!transform&&!sliding&&!(key==='opacity'&&(f.enabled||b.enabled)))continue;
      const value=time=>sample(a,time,duration)[key]*(key==='opacity'?100:1);
      if((key!=='opacity'||!f.enabled&&!b.enabled)&&((transform&&!sliding&&['linear','smooth'].includes(t.easing))||sliding&&!transform)){
        const critical=sliding?phase(s):[ms(t,'start',duration),ms(t,'end',duration)];
        c.channels[key]=[...new Set([0,...critical,duration].map(time=>clamp(time,0,duration)))].sort((a,b)=>a-b).map(time=>({time:time/duration*100,value:value(time),easing:sliding?(time===critical[0]||time===critical[2]?'smooth':'linear'):time===critical[0]?t.easing:'linear'}));
        // A phase clipped by the cue end needs sampling, not a shortened ease.
        if(critical.every(time=>time<=duration))continue;
      }
      const times=new Set([0,duration]),add=x=>times.add(clamp(x,0,duration));
      if(transform){add(ms(t,'start',duration));add(ms(t,'end',duration));}
      if(sliding)phase(s).forEach(add);
      if(key==='opacity'){
        if(f.enabled){const start=Object.hasOwn(f,'start')?ms(f,'start',duration):0,end=Object.hasOwn(f,'end')?ms(f,'end',duration):duration;
          const fi=ms(f,'in',duration),fo=ms(f,'out',duration),ratio=Math.min(1,(end-start)/(fi+fo||1));[start,start+fi*ratio,end-fo*ratio,end].forEach(add);}
        if(b.enabled){const start=ms(b,'start',duration),end=Math.min(duration,ms(b,'end',duration)),step=b.period*(b.periodUnit==='percent'?duration/100:1)/2;
          if((end-start)/step>30)throw Error('闪烁过于密集，请增大循环间隔后再转为自定义');
          for(let time=start;time<end;time+=step)add(time);add(end);}
      }
      const epsilon=Math.min(.001,duration/1e6);
      for(const time of [...times])if(time>0&&Math.abs(value(time)-value(time-epsilon))>.11)add(time-epsilon);
      let sorted=[...times].sort((a,b)=>a-b);
      function refine(left,right,depth=0){
        if(right-left<=epsilon*1.01||depth>10)return [left];
        const va=value(left),vb=value(right);
        if([.25,.5,.75].some(p=>Math.abs(value(left+(right-left)*p)-(va+(vb-va)*p))>.1)){
          const mid=(left+right)/2;return [...refine(left,mid,depth+1),...refine(mid,right,depth+1)];
        }
        return [left];
      }
      sorted=sorted.slice(0,-1).flatMap((time,i)=>refine(time,sorted[i+1])).concat(duration);
      if(sorted.length>32)throw Error('动画变化过于复杂，请简化效果后再转为自定义（每个参数最多 32 帧）');
      c.channels[key]=sorted.map(time=>({time:time/duration*100,value:value(time),easing:'linear'}));
    }
    return c;
  }
  // Authoring modes retain both banks. Only the active bank is sampled/exported.
  function authorPatch(raw,name,action,duration=1000){
    const a=normalize(raw),patch={schema,effects:{}};
    if(action.type==='timing'&&name==='all'){
      patch.timing=action.value;
      const reference=action.referenceDuration||duration;
      for(const key of names)patch.effects[key]=effectUnit(authorState(a,key,reference),key,action.value,reference);
      if(!valid(patch))throw Error('转换后的动画时间超出范围');
      return patch;
    }
    if(action.type==='mode'){
      patch.mode=action.value;
      if(action.value==='custom'){
        if(names.some(n=>n!=='curves'&&a.effects[n].enabled))patch.effects.curves=curvesFromPresets(a,duration);
        else if(Object.keys(a.effects.curves.channels).length)patch.effects.curves={...a.effects.curves,enabled:true};
        patch.effects.typewriter={...a.effects.typewriter,custom:a.effects.typewriter.enabled};
      }
      if(!valid(patch))throw Error('动画模式无效');
      return patch;
    }
    if(action.type==='custom-typewriter')return {schema,mode:'custom',effects:{typewriter:{...a.effects.typewriter,custom:action.value}}};
    if(name==='curves'){
      const c=clone(a.effects.curves);
      if(action.type==='unit')return authorPatch(a,'all',{type:'timing',value:action.value,referenceDuration:action.referenceDuration},duration);
      else if(action.type==='reset')patch.effects.curves={...clone(definitions.curves),unit:timingMode(a)};
      else if(action.type==='pulse'){if(action.value===null)delete c.pulse;else c.pulse={...c.pulse,...action.value};patch.effects.curves=c;}
      else if(action.type==='playhead'){
        if(action.time<0||action.time>duration)throw Error('请将播放头移到所选字幕共同覆盖的时间内');
        const time=action.time*(c.unit==='percent'?100/duration:1),points=c.channels[action.channel]||[];
        const value=sample(a,action.time,duration)[action.channel]*(action.channel==='opacity'?100:1);
        c.channels[action.channel]=sortPoints([...points.filter(p=>anchor(p)!=='start'||Math.abs(p.time-time)>.001),{time,value,easing:'linear',...(c.unit==='ms'?{anchor:'start'}:{})}]);c.enabled=true;patch.effects.curves=c;
      }
      else{
        // Multi-selection edits normalize other channels to the displayed unit.
        const next=effectUnit(c,'curves',action.unit||c.unit,duration);
        next.enabled=true;
        if(action.points===null)delete next.channels[action.channel];else next.channels[action.channel]=clone(action.points);
        patch.effects.curves=next;
      }
      patch.mode='custom';
    }else{
      let e=action.type==='reset'?{...effectUnit(presetDefault(name),name,timingMode(a),action.referenceDuration||duration),enabled:a.effects[name].enabled}:authorState(a,name,action.referenceDuration||duration);
      if(action.displayUnit)e=effectUnit(e,name,action.displayUnit,action.referenceDuration||duration);
      if(name==='fade'&&action.type==='values'&&action.timeUnit){
        if(action.timeUnit==='ms')e={enabled:e.enabled,unit:'ms',in:ms(e,'in',duration),out:ms(e,'out',duration)};
        else e=presetState(a,name,duration);
      }
      if(name==='fade'&&action.type==='timing'){
        if(action.value==='ms')e={enabled:e.enabled,unit:'ms',in:action.in??Math.round(ms(e,'in',duration)),out:action.out??Math.round(ms(e,'out',duration))};
        else e={...presetState(a,name,duration),unit:'percent'};
      }
      if(action.type==='toggle')e.enabled=action.value;
      if(action.type==='values')Object.assign(e,action.value);
      if(name==='transform'&&action.type==='values'&&Object.hasOwn(action.value,'toScale'))e.fromScale=100;
      patch.effects[name]=e;patch.mode='presets';
    }
    if(!valid(patch))throw Error('动画参数无效：时间不能交叉，数值须在允许范围内');
    return patch;
  }
  const ms=(e,key,duration)=>e[key]*(e.unit==='percent'?duration/100:1);
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const timingMode=raw=>raw.timing||(authoringMode(raw)==='custom'?raw.effects.curves.unit:raw.effects.fade.unit);
  // Stored offsets are never clamped to one reference cue. Resolve at the last
  // moment so a short cue cannot overwrite the author's requested durations.
  function clockEffect(e,duration){
    const n=clone(e);if(!e.endAnchor)return n;
    const start=ms(e,'start',duration),finish=ms(e,'end',duration),a=ms(e,'in',duration)||0,z=ms(e,'out',duration)||0;
    const extent=e.endAnchor==='end'?start+a+finish+z:Math.max(finish,start+a+z);
    const ratio=Math.min(1,duration/Math.max(extent,1e-9));
    Object.assign(n,{unit:'ms',start:start*ratio,end:e.endAnchor==='end'?duration-finish*ratio:finish*ratio});
    for(const key of ['in','out'])if(Object.hasOwn(e,key))n[key]=ms(e,key,duration)*ratio;
    // A range with both ends at the compressed junction has zero exposure.
    if(!Object.hasOwn(e,'in')&&n.end<=n.start)n.end=n.start+1e-7;
    delete n.endAnchor;return n;
  }
  function pointExtent(points,unit){
    return Math.max(0,...points.filter(p=>anchor(p)==='start').map(p=>p.time))+Math.max(0,...points.filter(p=>anchor(p)==='end').map(p=>p.time));
  }
  function resolvePoints(points,unit,duration){
    const factor=unit==='percent'?duration/100:1;
    const ratio=points.some(p=>p.anchor)?Math.min(1,duration/Math.max(1e-9,pointExtent(points,unit)*factor)):1;
    const result=[];
    for(const p of points){
      const time=anchor(p)==='end'?duration-p.time*factor*ratio:p.time*factor*ratio;
      const next={...p,time};delete next.anchor;
      // Keep both limits at a compressed junction: replacing the incoming key
      // would incorrectly interpolate toward the outgoing jump value.
      result.push(next);
    }
    return result;
  }
  function runtime(raw,duration){
    const next={...raw,effects:{...raw.effects}};
    for(const [name,e] of Object.entries(next.effects))if(e.endAnchor)next.effects[name]=clockEffect(e,duration);
    const c=next.effects.curves;
    if(c?.enabled){
      next.effects.curves={...c,unit:'ms',channels:Object.fromEntries(Object.entries(c.channels).map(([key,p])=>[key,resolvePoints(p,c.unit,duration)]))};
      if(c.pulse)next.effects.blink=clockEffect(c.pulse,duration);
    }
    return next;
  }
  function effectUnit(effect,name,unit,duration){
    if(effect.unit===unit)return clone(effect);
    const n=clone(effect);
    if(name==='curves'){
      if(unit==='percent')for(const points of Object.values(n.channels)){
        const ratio=points.some(p=>p.anchor)?Math.min(1,duration/Math.max(1e-9,pointExtent(points,n.unit))):1;
        for(const p of points)p.time*=ratio*100/duration;
      }
      else for(const points of Object.values(n.channels))for(const p of points){p.time*=duration/100;p.anchor=anchor(p);}
      if(n.pulse)n.pulse=effectUnit(n.pulse,'blink',unit,duration);
    }else if(unit==='ms'){
      for(const key of ['start','end','in','out'])if(Object.hasOwn(n,key))n[key]*=duration/100;
      if(name==='fade'&&!Object.hasOwn(n,'start'))Object.assign(n,{start:0,end:duration});
      if(['fade','slide','blink'].includes(name)){n.end=duration-n.end;n.endAnchor='end';}else n.endAnchor='start';
    }else{
      const timed=clockEffect(n,duration);
      for(const key of ['start','end','in','out'])if(Object.hasOwn(timed,key))n[key]=timed[key]*100/duration;
      delete n.endAnchor;
    }
    if(name==='blink'){
      const period=n.period*(n.periodUnit==='percent'?duration/100:1);
      n.period=unit==='ms'?clamp(period,80,60000):clamp(period*100/duration,1,100);n.periodUnit=unit;
    }
    n.unit=unit;return n;
  }
  const ease=(p,mode)=>mode==='ease-in'?p*p:mode==='ease-out'?1-(1-p)**2:mode==='smooth'?p*p*(3-2*p):p;
  function curveValue(points,time){
    if(time<points[0].time)return points[0].value;
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
    raw=runtime(active(raw),duration);
    const {fade:f,typewriter:w,blink:b,transform:t,slide:s}=raw.effects;
    const time=clamp(elapsed,0,duration),state={opacity:1,x:0,y:0,scale:100,rotation:0,revealed:count};
    if(f.enabled){let a=ms(f,'in',duration),z=ms(f,'out',duration),start=Object.hasOwn(f,'start')?ms(f,'start',duration):0,end=Object.hasOwn(f,'end')?ms(f,'end',duration):duration;if(a+z>end-start){const ratio=(end-start)/(a+z);a*=ratio;z*=ratio;}state.opacity=time<start||time>end?0:clamp(Math.min(a?(time-start)/a:1,z?(end-time)/z:1,1));}
    const period=b.period*(b.periodUnit==='percent'?duration/100:1);
    if(b.enabled&&time>=ms(b,'start',duration)&&time<ms(b,'end',duration)&&Math.floor((time-ms(b,'start',duration))/(period/2))%2)state.opacity*=b.opacity/100;
    let transformOpacity=100;
    if(t.enabled){const p=ease(clamp((time-ms(t,'start',duration))/(ms(t,'end',duration)-ms(t,'start',duration))),t.easing);for(const [key,suffix] of [['x','X'],['y','Y'],['scale','Scale'],['rotation','Rotation']])state[key]=t['from'+suffix]+(t['to'+suffix]-t['from'+suffix])*p;transformOpacity=t.fromOpacity+(t.toOpacity-t.fromOpacity)*p;}
    if(s?.enabled){const start=ms(s,'start',duration),end=ms(s,'end',duration),a=ms(s,'in',duration),z=ms(s,'out',duration);
      const offset=-(1-ease(a?clamp((time-start)/a):time>=start?1:0,'smooth'))+ease(z?clamp((time-end+z)/z):time>=end?1:0,'smooth');
      state[['left','right'].includes(s.direction)?'x':'y']+=offset*s.distance*(['left','up'].includes(s.direction)?-1:1);
    }
    const c=raw.effects.curves;
    if(c?.enabled)for(const [key,points] of Object.entries(c.channels)){
      const v=curveValue(points,time*(c.unit==='percent'?100/duration:1));if(key==='opacity')transformOpacity=v;else state[key]=v;
    }
    state.opacity*=transformOpacity/100;
    if(w.enabled)state.revealed=Math.floor(clamp((time-ms(w,'start',duration))/(ms(w,'end',duration)-ms(w,'start',duration)))*count+1e-7);
    return state;
  }
  function envelope(row,width){
    const motion=row.motion?active(row.motion):null,t=motion?.effects.transform,c=motion?.effects.curves,slide=motion?.effects.slide;if(!t?.enabled&&!c?.enabled&&!slide?.enabled)return row;
    const values=(key,suffix)=>c?.enabled&&c.channels[key]?c.channels[key].map(p=>p.value):t?.enabled?[t['from'+suffix],t['to'+suffix]]:[channels[key].initial];
    const scales=values('scale','Scale'),dx=values('x','X'),dy=values('y','Y'),rotations=values('rotation','Rotation');
    if(slide?.enabled){const key=['left','right'].includes(slide.direction)?'x':'y';if(!(c?.enabled&&c.channels[key])){const v=key==='x'?dx:dy;v.push(Math.min(...v)-slide.distance,Math.max(...v)+slide.distance);}}
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
  const api={schema,names,timings,valid,normalize,defaults,resolve,ms,sample,envelope,delayAssTags,channels,curveValue,convertUnit,editablePoints,editChannel,presetPatch,active,authoringMode,presetDefault,presetState,authorPatch,snapValue,presetTimes,dragPreset,curvesFromPresets,timingMode,clockEffect,pointExtent,resolvePoints,sortPoints,anchor,effectUnit,authorState};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;global.MSWSubtitleAnimation=api;
})(typeof globalThis==='undefined'?window:globalThis);
