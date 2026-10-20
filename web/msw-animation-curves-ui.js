// Channel curves share a cue clock, but retain independent values and keyframes.
(function(global){
  'use strict';
  const A=global.MSWSubtitleAnimation,clone=v=>JSON.parse(JSON.stringify(v)),number=v=>Math.round(v*1000)/1000;
  const labels={opacity:'不透明度',x:'水平偏移',y:'垂直偏移',rotation:'旋转',scale:'缩放'};
  const icons={linear:'M-5 0L0-5L5 0L0 5Z',smooth:'M-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',hold:'M-5-5H5V5H-5Z'};
  function create(root,{context,commit,message}){
    root.className='msw-curves';
    root.innerHTML=`<div class="msw-curve-values" data-option-help="点击图表选择时间与数值，＋新建关键帧；选中已有关键帧后可直接输入数值或拖动。右键设置过渡、删除、切换坐标。菱形为匀速，圆形为平滑，方形为定格；底部短线表示其他参数的关键帧时间，切换参数不会丢失它们。Esc 取消拖动。">
      <label><span id="curve-time-label">时间 (%)</span><input id="curve-time" type="number" min="0" max="100" step="any" value="0" required></label>
      <label><span id="curve-value-label">不透明度 (%)</span><input id="curve-value" type="number" step="any" value="100" required></label>
      <button id="curve-add" type="button" class="msw-style-icon" title="在此时间新建关键帧" aria-label="在此时间新建关键帧"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg></button>
      <button id="curve-reset" type="button" class="msw-style-icon" title="恢复自定义默认值" aria-label="恢复自定义默认值"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/></svg></button></div>
      <div class="msw-curve-plot"><svg id="curve-graph" viewBox="0 0 320 200" preserveAspectRatio="none" tabindex="0" role="group" aria-label="自定义动画图表，右键切换坐标及编辑关键帧"></svg></div>
      <p id="curve-note" class="msw-processing-hint"></p>`;
    const $=id=>root.querySelector('#'+id),graph=$('curve-graph');
    let channel='opacity',state,points=[],selected=-1,drag=null,geometry,signature='',targetSignature='',cursor={time:0,value:100},mixed=false;
    const fingerprint=()=>JSON.stringify(context().items.map(i=>[i.row?.cue_id,i.track.id,i.value]));
    const blocked=()=>context().blocked||A.authoringMode(context().items[0]?.value||A.defaults())!=='custom';
    function apply(action){
      try{commit('curves','author',action);message('');}catch(e){message(e.message,true);}sync();
    }
    function save(next){apply({type:'channel',channel,points:next.length?next:null,unit:state.unit});}
    function controls(){
      const c=A.channels[channel],off=blocked();
      $('curve-time-label').textContent=state.unit==='percent'?'时间 (%)':'时间 (ms)';
      $('curve-value-label').textContent=labels[channel]+(channel==='rotation'?' (°)':['x','y'].includes(channel)?' (px)':' (%)');
      $('curve-time').max=state.unit==='percent'?'100':'60000';
      $('curve-value').min=String(c.min);$('curve-value').max=String(c.max);
      $('curve-time').value=String(number(cursor.time));$('curve-value').value=String(number(cursor.value));
      $('curve-time').disabled=$('curve-value').disabled=$('curve-reset').disabled=off;
      $('curve-add').disabled=off||points.length>=32||points.some(p=>Math.abs(p.time-cursor.time)<.001);
      $('curve-note').textContent=mixed?'多个值：显示首条，编辑仅统一当前参数。':'';
      graph.setAttribute('aria-disabled',String(off));
    }
    function draw(){
      const c=A.channels[channel],duration=context().items[0]?.duration||1000;
      let end=state.unit==='percent'?100:Math.min(60000,Math.max(duration,...Object.values(state.channels).flat().map(p=>p.time),cursor.time,1));
      const values=points.map(p=>p.value),pad=Math.max(20,(Math.max(c.initial,...values)-Math.min(c.initial,...values))*.15);
      let low=Math.max(c.min,Math.min(c.initial,...values)-pad),high=Math.min(c.max,Math.max(c.initial,...values)+pad);
      if(channel==='opacity'){low=0;high=100;}if(high===low)high=low+1;
      if(drag)({end,low,high}=drag.geometry);
      const width=Math.max(200,graph.clientWidth||320),X=t=>44+t/end*(width-60),Y=v=>164-(v-low)/(high-low)*140;
      geometry={end,low,high,X,Y,width};
      graph.setAttribute('viewBox',`0 0 ${width} 200`);
      const commands=[];
      if(points.length){
        commands.push(`M${X(0)},${Y(points[0].value)}`,`L${X(points[0].time)},${Y(points[0].value)}`);
        for(let i=1;i<points.length;i++){
          const a=points[i-1],b=points[i],steps=a.easing==='smooth'?32:1;
          if(a.easing==='hold')commands.push(`L${X(b.time)},${Y(a.value)}`);
          for(let j=1;j<=steps;j++){const t=a.time+(b.time-a.time)*j/steps;commands.push(`L${X(t)},${Y(A.curveValue(points,t))}`);}
        }
        commands.push(`L${X(end)},${Y(points.at(-1).value)}`);
      }else commands.push(`M${X(0)},${Y(c.initial)}H${X(end)}`);
      const other=[...new Set(Object.entries(state.channels).filter(([key])=>key!==channel).flatMap(([,p])=>p.map(v=>v.time)))];
      graph.innerHTML=[0,.5,1].map(p=>`<path class="curve-grid" d="M44 ${Y(low+(high-low)*p)}H${width-16}M${X(end*p)} 24V164"/>
        <text x="39" y="${Y(low+(high-low)*p)+4}" text-anchor="end">${number(low+(high-low)*p)}</text>
        <text x="${X(end*p)}" y="188" text-anchor="${p===1?'end':p===0?'start':'middle'}">${number(end*p)}${state.unit==='percent'?'%':'ms'}</text>`).join('')+
        `<text x="46" y="14">${labels[channel]}</text><path class="curve-line${points.length?'':' is-empty'}" d="${commands.join(' ')}"/>`+
        other.map(t=>`<path class="curve-other-frame" d="M${X(t)} 161V169"><title>其他参数的关键帧：${number(t)}${state.unit==='percent'?'%':'ms'}</title></path>`).join('')+
        points.map((p,i)=>`<g data-point="${i}" class="curve-handle${selected===i?' selected':''}" tabindex="${blocked()?-1:0}" role="button" aria-label="关键帧 ${i+1}，${number(p.time)}${state.unit==='percent'?'%':'ms'}，${number(p.value)}" transform="translate(${X(p.time)} ${Y(p.value)})">
          <circle class="curve-hit" r="10"/><path d="${icons[p.easing]}"/><title>${{linear:'匀速',smooth:'平滑',hold:'定格'}[p.easing]}</title></g>`).join('')+
        '<g class="curve-crosshair" pointer-events="none" visibility="hidden"><path/><text class="curve-hover-y" text-anchor="end"/><text class="curve-hover-x" text-anchor="middle"/></g>';
    }
    function sync(){
      if(!context().items.length&&!state)state=clone(A.defaults().effects.curves);
      const c=context(),key=fingerprint();
      if(drag){if(blocked()||key!==signature)cancel();else return;}
      signature=key;state=clone(c.items[0]?.value.effects.curves||A.defaults().effects.curves);
      const target=JSON.stringify(c.items.map(i=>[i.row?.cue_id,i.track.id]));
      if(target!==targetSignature){targetSignature=target;selected=-1;cursor={time:0,value:A.channels[channel].initial};}
      points=clone(state.channels[channel]||[]);
      mixed=c.items.some(i=>JSON.stringify(i.value.effects.curves.channels[channel]||[])!==JSON.stringify(points)||i.value.effects.curves.unit!==state.unit);
      selected=points.findIndex(p=>Math.abs(p.time-cursor.time)<.001);
      if(selected>=0)cursor={...points[selected]};
      controls();draw();
    }
    function selectChannel(key){cancel();channel=key;selected=-1;cursor.value=A.channels[key].initial;sync();}
    function changeUnit(unit){
      try{
        for(const i of context().items)A.convertUnit(i.value.effects.curves,unit,i.duration);
        if(unit!==state.unit)cursor.time*=unit==='ms'?(context().items[0]?.duration||1000)/100:100/(context().items[0]?.duration||1000);
        apply({type:'unit',value:unit});
      }catch(e){message(e.message,true);}
    }
    function at(e){
      const r=graph.getBoundingClientRect(),g=geometry,c=A.channels[channel];
      const time=Math.max(0,Math.min(g.end,(e.clientX-r.left-44)/Math.max(1,r.width-60)*g.end));
      const value=Math.max(c.min,Math.min(c.max,g.low+(164-(e.clientY-r.top)*200/r.height)/140*(g.high-g.low)));
      return {time:number(time),value:number(value)};
    }
    function add(point=cursor){
      if(blocked()||points.length>=32)return;
      const old=points.findIndex(p=>Math.abs(p.time-point.time)<.001);
      if(old>=0){selected=old;cursor={...points[old]};controls();draw();return;}
      cursor={...point};
      save([...points,{time:point.time,value:point.value,easing:'linear'}].sort((a,b)=>a.time-b.time));
    }
    $('curve-add').onclick=()=>{if($('curve-time').reportValidity()&&$('curve-value').reportValidity())add();};
    $('curve-reset').onclick=()=>{cursor={time:0,value:A.channels[channel].initial};apply({type:'reset'});};
    $('curve-time').onchange=()=>{
      if(!$('curve-time').reportValidity()){controls();return;}
      cursor.time=Number($('curve-time').value);selected=points.findIndex(p=>p.time===cursor.time);
      if(selected>=0)cursor.value=points[selected].value;
      controls();draw();
    };
    $('curve-value').onchange=()=>{
      if(!$('curve-value').reportValidity()){controls();return;}
      cursor.value=Number($('curve-value').value);
      if(selected>=0){const next=clone(points);next[selected].value=cursor.value;save(next);}else controls();
    };
    function menu(e){
      e.preventDefault();e.stopPropagation();if(blocked())return;
      const index=Number(e.target.closest('[data-point]')?.dataset.point??-1),here=at(e),stamp=fingerprint();
      if(index>=0){selected=index;cursor={...points[index]};controls();draw();}
      const safe=fn=>()=>{if(stamp===fingerprint()&&!blocked())fn();};
      document.getElementById('ctxmenu').replaceChildren();
      if(index>=0){
        for(const [easing,label] of Object.entries({linear:'匀速',smooth:'平滑',hold:'定格'})){
          const item=global.ctxAppendItem(label,safe(()=>{const next=clone(points);next[index].easing=easing;save(next);}));
          item.classList.toggle('ctx-choice-selected',points[index].easing===easing);
          item.insertAdjacentHTML('afterbegin',`<svg class="curve-menu-icon" viewBox="-8 -8 16 16" aria-hidden="true"><path d="${icons[easing]}"/></svg>`);
        }
        global.ctxAppendSeparator();
        global.ctxAppendItem('删除关键帧',safe(()=>{const next=clone(points);next.splice(index,1);save(next);}));
      }else{
        global.ctxAppendItem('在这里新建关键帧',safe(()=>add(here)),{disabled:points.length>=32});
        global.ctxAppendSeparator();
        global.ctxAppendExpandableSettings('X 轴 · 时间',[
          {label:'时间百分比',selected:state.unit==='percent',action:safe(()=>changeUnit('percent'))},
          {label:'毫秒',selected:state.unit==='ms',action:safe(()=>changeUnit('ms'))}
        ]);
        global.ctxAppendExpandableSettings('Y 轴 · 参数',Object.entries(labels).map(([key,label])=>({label,selected:channel===key,action:safe(()=>selectChannel(key))})));
      }
      global.ctxShowAt(e.clientX,e.clientY);
    }
    graph.oncontextmenu=menu;
    function cancel(){if(!drag)return;const d=drag;drag=null;points=d.original;cursor=d.cursor;selected=points.findIndex(p=>p.time===cursor.time);controls();draw();}
    graph.onpointerdown=e=>{
      if(e.button!==0||blocked())return;
      e.preventDefault();e.stopPropagation();
      const node=e.target.closest('[data-point]');
      if(!node){cursor=at(e);selected=-1;controls();draw();return;}
      selected=Number(node.dataset.point);cursor={...points[selected]};
      drag={id:e.pointerId,original:clone(points),cursor:{...cursor},geometry:{...geometry}};
      graph.setPointerCapture(e.pointerId);controls();draw();
    };
    graph.onpointermove=e=>{
      if(!state)return;
      if(!drag){
        const v=at(e),g=geometry,group=graph.querySelector('.curve-crosshair');
        group.setAttribute('visibility','visible');group.querySelector('path').setAttribute('d',`M44 ${g.Y(v.value)}H${g.width-16}M${g.X(v.time)} 24V164`);
        const y=group.querySelector('.curve-hover-y'),x=group.querySelector('.curve-hover-x');
        y.setAttribute('x','39');y.setAttribute('y',String(g.Y(v.value)+4));y.textContent=number(v.value);
        x.setAttribute('x',String(Math.max(60,Math.min(g.width-30,g.X(v.time)))));x.setAttribute('y','199');x.textContent=number(v.time)+(state.unit==='percent'?'%':'ms');
        return;
      }
      if(e.pointerId!==drag.id)return;
      if(fingerprint()!==signature||blocked()){cancel();sync();return;}
      e.preventDefault();const v=at(e),p=points[selected];
      p.time=number(Math.max(selected?points[selected-1].time+.001:0,Math.min(selected<points.length-1?points[selected+1].time-.001:geometry.end,v.time)));
      p.value=v.value;cursor={...p};controls();draw();
    };
    graph.onpointerleave=()=>graph.querySelector('.curve-crosshair')?.setAttribute('visibility','hidden');
    graph.onpointerup=e=>{
      if(!drag||e.pointerId!==drag.id)return;
      const original=drag.original;drag=null;
      if(signature!==fingerprint()||blocked()){sync();return;}
      if(JSON.stringify(original)!==JSON.stringify(points))save(points);
    };
    graph.onpointercancel=cancel;graph.onlostpointercapture=cancel;
    graph.onkeydown=e=>{
      if(blocked())return;
      if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){const r=e.target.getBoundingClientRect();menu({target:e.target,clientX:r.x+r.width/2,clientY:r.y+r.height/2,preventDefault:()=>e.preventDefault(),stopPropagation:()=>e.stopPropagation()});return;}
      const i=Number(e.target.closest('[data-point]')?.dataset.point??-1);
      if(i<0||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete'].includes(e.key))return;
      e.preventDefault();e.stopPropagation();const next=clone(points),p=next[i],c=A.channels[channel];
      if(e.key==='Delete')next.splice(i,1);
      else if(e.key==='ArrowUp'||e.key==='ArrowDown')p.value=Math.max(c.min,Math.min(c.max,p.value+(e.key==='ArrowUp'?1:-1)));
      else p.time=Math.max(i?next[i-1].time+.001:0,Math.min(i<next.length-1?next[i+1].time-.001:geometry.end,p.time+(e.key==='ArrowLeft'?-1:1)*(state.unit==='ms'?10:1)));
      cursor={...p};save(next);graph.querySelector(`[data-point="${i}"]`)?.focus({preventScroll:true});
    };
    global.addEventListener('blur',cancel);
    global.addEventListener('keydown',e=>{if(drag&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}},true);
    new ResizeObserver(()=>{if(state&&!drag)draw();}).observe(graph);
    return {sync,cancel,selectChannel};
  }
  global.MSWAnimationCurvesUI={create};
})(window);
