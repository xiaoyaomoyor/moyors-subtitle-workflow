// One pointer gesture is one edit. Drafts stay local until release.
(function(global){
  'use strict';
  const A=global.MSWSubtitleAnimation,clone=v=>JSON.parse(JSON.stringify(v));
  function create(root,{context,commit,message}){
    root.className='msw-curves msw-motion-wide';
    root.innerHTML=`<div class="msw-curve-toolbar"><select id="curve-channel" aria-label="关键帧参数"></select>
      <label class="msw-style-check"><input id="curve-active" type="checkbox"><span>使用曲线</span></label></div>
      <div class="msw-curve-plot"><svg id="curve-graph" viewBox="0 0 320 180" tabindex="0" role="img" aria-label="关键帧曲线，拖动圆点调整时间与数值"></svg></div>
      <p id="curve-note" class="msw-processing-hint"></p>
      <div class="msw-curve-toolbar"><select id="curve-point" aria-label="当前关键帧"></select>
      <button id="curve-add" type="button" class="msw-style-icon" title="添加关键帧" aria-label="添加关键帧"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16M4 12h16"/></svg></button>
      <button id="curve-delete" type="button" class="msw-style-icon" title="删除关键帧" aria-label="删除关键帧"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16"/></svg></button></div>
      <div class="msw-style-fields"><label class="msw-style-field"><span id="curve-time-label">时间 (%)</span><input id="curve-time" type="number" min="0" max="100" step="any" required></label>
      <label class="msw-style-field"><span>数值</span><input id="curve-value" type="number" step="any" required></label>
      <label class="msw-style-field msw-motion-wide" data-option-help="控制此关键帧到下一帧的过渡。平滑在两端减速且不超出端点数值；保持直到下一帧才跳变。"><span class="msw-option-label">过渡到下一帧</span><select id="curve-easing"><option value="linear">匀速</option><option value="smooth">平滑</option><option value="hold">保持</option></select></label></div>`;
    const $=id=>root.querySelector('#'+id),graph=$('curve-graph');
    $('curve-channel').replaceChildren(...Object.entries(A.channels).map(([key,c])=>new Option(c.label,key)));
    let state,points=[],selected=0,drag=null,geometry,mixed=false,signature='',targetSignature='';
    const channel=()=>$('curve-channel').value,number=v=>Math.round(v*1000)/1000;
    function fingerprint(c){return JSON.stringify(c.items.map(i=>[i.row?.cue_id,i.track.id,i.value.effects.curves]));}
    function save(next){
      try{commit('curves','channel:'+channel(),next);message('');}catch(e){message(e.message,true);}sync();
    }
    function draw(){
      const c=A.channels[channel()],duration=context().items[0]?.duration||1000;
      let end=state.unit==='percent'?100:Math.min(60000,Math.max(duration,...points.map(p=>p.time),1));
      const values=points.map(p=>p.value),pad=channel()==='opacity'?0:Math.max(10,((Math.max(c.initial,...values)-Math.min(c.initial,...values))*.15));
      let low=Math.max(c.min,Math.min(c.initial,...values)-(values.length?pad:100));
      let high=Math.min(c.max,Math.max(c.initial,...values)+(values.length?pad:100));
      if(channel()==='opacity'){low=0;high=100;}if(high===low)high=low+1;
      if(drag)({end,low,high}=drag.geometry);
      const X=t=>38+t/end*270,Y=v=>150-(v-low)/(high-low)*130;
      geometry={end,low,high,X,Y};
      const ticks=[0,.5,1],commands=[];
      if(points.length){
        commands.push(`M${X(0)},${Y(points[0].value)}`,`L${X(points[0].time)},${Y(points[0].value)}`);
        for(let i=1;i<points.length;i++){
          const a=points[i-1],b=points[i],steps=a.easing==='smooth'?32:1;
          if(a.easing==='hold')commands.push(`L${X(b.time)},${Y(a.value)}`);
          for(let j=1;j<=steps;j++){const time=a.time+(b.time-a.time)*j/steps;commands.push(`L${X(time)},${Y(A.curveValue(points,time))}`);}
        }
        commands.push(`L${X(end)},${Y(points.at(-1).value)}`);
      }
      const path=commands.join(' ');
      graph.innerHTML=ticks.map(p=>`<path class="curve-grid" d="M38 ${Y(low+(high-low)*p)}H308M${X(end*p)} 20V150"/>
        <text x="33" y="${Y(low+(high-low)*p)+4}" text-anchor="end">${Math.round((low+(high-low)*p)*10)/10}</text>
        <text x="${X(end*p)}" y="170" text-anchor="${p===1?'end':p===0?'start':'middle'}">${number(end*p)}${state.unit==='percent'?'%':''}</text>`).join('')+
        `<path class="curve-line" d="${path}"/>`+points.map((p,i)=>`<circle class="curve-handle${i===selected?' selected':''}" data-point="${i}" cx="${X(p.time)}" cy="${Y(p.value)}" r="${i===selected?5:4}"/>`).join('');
      $('curve-point').replaceChildren(...points.map((p,i)=>new Option(`${String(i+1).padStart(2,'0')} · ${number(p.time)}${state.unit==='percent'?'%':' ms'}`,String(i))));
      $('curve-point').value=String(selected);const point=points[selected];
      $('curve-time-label').textContent=state.unit==='percent'?'时间 (%)':'时间 (ms)';
      $('curve-time').max=state.unit==='percent'?'100':'60000';
      $('curve-value').min=String(c.min);$('curve-value').max=String(c.max);
      $('curve-time').value=point?String(number(point.time)):'';
      $('curve-value').value=point?String(number(point.value)):'';
      $('curve-easing').value=point?.easing||'linear';
      const blocked=context().blocked;
      for(const id of ['curve-point','curve-time','curve-value','curve-easing','curve-delete'])$(id).disabled=blocked||!point;
      $('curve-easing').disabled=blocked||!point||selected===points.length-1;
      $('curve-add').disabled=blocked||!points.length||points.length>=32;
      $('curve-note').textContent=mixed?'多个值：图表显示首条；编辑只统一当前参数。':!points.length?'启用当前参数后添加关键帧。':'拖动圆点调整；Esc 取消拖动。';
      graph.setAttribute('aria-disabled',String(blocked||!points.length));
    }
    function sync(){
      const c=context(),key=fingerprint(c);
      if(drag){if(c.blocked||key!==signature)cancel();else return;}
      signature=key;state=clone(c.items[0]?.value.effects.curves||A.defaults().effects.curves);
      const target=JSON.stringify(c.items.map(i=>[i.row?.cue_id,i.track.id]));
      if(target!==targetSignature){
        targetSignature=target;
        if(!state.channels[channel()]){
          const used=Object.keys(state.channels)[0];if(used)$('curve-channel').value=used;
        }
        selected=0;
      }
      for(const option of $('curve-channel').options)option.textContent=A.channels[option.value].label+(state.channels[option.value]?' •':'');
      points=clone(state.channels[channel()]||[]);
      mixed=c.items.some(i=>JSON.stringify(i.value.effects.curves.channels[channel()]||[])!==JSON.stringify(points));
      selected=Math.min(selected,Math.max(0,points.length-1));
      $('curve-active').checked=!!points.length;$('curve-active').indeterminate=mixed;
      $('curve-active').disabled=c.blocked;$('curve-channel').disabled=c.blocked;draw();
    }
    $('curve-channel').onchange=()=>{cancel();selected=0;sync();};
    $('curve-active').onchange=e=>{
      const value=A.channels[channel()].initial;
      save(e.target.checked?[{time:0,value,easing:'smooth'},{time:state.unit==='percent'?100:Math.min(60000,context().items[0]?.duration||1000),value,easing:'smooth'}]:null);
    };
    $('curve-point').onchange=()=>{selected=Number($('curve-point').value);draw();};
    $('curve-add').onclick=()=>{
      const max=state.unit==='percent'?100:Math.min(60000,geometry.end),times=[0,...points.map(p=>p.time),max];
      let a=0,b=0;for(let i=1;i<times.length;i++)if(times[i]-times[i-1]>b-a){a=times[i-1];b=times[i];}
      if(b-a<.02){message('没有足够空间添加关键帧',true);return;}
      const time=(a+b)/2,next=[...clone(points),{time,value:A.curveValue(points,time),easing:'smooth'}].sort((a,b)=>a.time-b.time);
      selected=next.findIndex(p=>p.time===time);save(next);
    };
    $('curve-delete').onclick=()=>{const next=clone(points);next.splice(selected,1);selected=Math.max(0,selected-1);save(next.length?next:null);};
    for(const key of ['time','value','easing'])$('curve-'+key).onchange=()=>{
      const input=$('curve-'+key);if(!input.reportValidity()){draw();return;}
      const next=clone(points),point=next[selected];if(!point)return;
      point[key]=key==='easing'?input.value:Number(input.value);
      if(key==='time'){next.sort((a,b)=>a.time-b.time);selected=next.indexOf(point);}
      save(next);
    };
    function cancel(){if(!drag)return;const original=drag.original;drag=null;points=original;draw();}
    graph.addEventListener('pointerdown',e=>{
      const circle=e.target.closest('[data-point]');if(!circle||context().blocked||e.button!==0)return;
      e.preventDefault();e.stopPropagation();selected=Number(circle.dataset.point);graph.focus({preventScroll:true});
      drag={id:e.pointerId,original:clone(points),geometry:{...geometry}};graph.setPointerCapture(e.pointerId);draw();
    });
    graph.addEventListener('pointermove',e=>{
      if(!drag||e.pointerId!==drag.id)return;e.preventDefault();
      const rect=graph.getBoundingClientRect(),g=drag.geometry,c=A.channels[channel()],point=points[selected];
      const time=((e.clientX-rect.left)*320/rect.width-38)/270*g.end;
      point.time=number(Math.max(selected?points[selected-1].time+.001:0,Math.min(selected<points.length-1?points[selected+1].time-.001:state.unit==='percent'?100:60000,time)));
      const value=g.low+(150-(e.clientY-rect.top)*180/rect.height)/130*(g.high-g.low);
      point.value=number(Math.max(c.min,Math.min(c.max,value)));draw();
    });
    graph.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.id)return;const original=drag.original;drag=null;
      if(fingerprint(context())!==signature){sync();return;}if(JSON.stringify(points)!==JSON.stringify(original))save(points);});
    graph.addEventListener('pointercancel',cancel);
    graph.addEventListener('lostpointercapture',cancel);
    global.addEventListener('blur',cancel);
    global.addEventListener('keydown',e=>{if(drag&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}},true);
    return {sync};
  }
  global.MSWAnimationCurvesUI={create};
})(window);
