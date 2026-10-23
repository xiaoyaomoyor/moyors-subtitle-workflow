// Preset gestures keep local drafts; a completed gesture is one undoable edit.
(function(global){
  'use strict';
  const A=global.MSWSubtitleAnimation,clone=v=>JSON.parse(JSON.stringify(v));
  const labels={fade:'淡入淡出',typewriter:'打字机',blink:'闪烁',transform:'舒展',slide:'滑入滑出'};
  const resetIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/></svg>';
  const inheritIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v11h13M14 11l4 4-4 4M9 4h11M9 8h11"/></svg>';
  const readout=v=>Math.round(v*10)/10;
  const parameters=(name,e)=>name==='blink'?
    [{key:'period',title:'循环间隔',min:e.periodUnit==='ms'?80:1,max:e.periodUnit==='ms'?Math.max(2000,e.period):100,lane:0,scale:e.periodUnit==='ms'?1000:1},{key:'opacity',title:'最低不透明度',min:0,max:100,lane:1}]:
    name==='transform'?[{key:'toScale',title:'缩放强度',min:1,max:Math.max(200,e.toScale),lane:0}]:name==='slide'?[{key:'distance',title:'滑动距离',min:0,max:Math.max(480,e.distance),lane:0}]:[];
  function create(root,{context,commit,message}){
    root.innerHTML=`<div class="msw-motion-presets" data-option-help="拖动手柄调整时间，拖动色块移动区间。固定时长的退场从结尾计算；短字幕自动缩短入场和退场。Ctrl 吸附整数，Ctrl+Shift 吸附 5 的倍数。关闭效果保留参数。"></div>
      <div id="motion-preset-controls"></div><div id="motion-curve-editor" hidden></div>`;
    const $=id=>root.querySelector('#'+id),bar=root.firstElementChild;
    let signature='',drag=null,states={},custom=false;
    const reference=()=>context().items[0]?.duration||1000;
    const timing=document.createElement('select');timing.id='motion-timing';timing.ariaLabel='动画时间方式';timing.innerHTML='<option value="percent">按比例</option><option value="ms">固定时长</option>';bar.append(timing);
    timing.onchange=()=>{cancel();curves.cancel();apply('all',{type:'timing',value:timing.value,referenceDuration:reference()});};
    const fingerprint=()=>JSON.stringify(context().items.map(i=>[i.row?.cue_id,i.track.id,i.value]));
    function apply(name,action){
      action={referenceDuration:reference(),...action};
      if(action.type==='values')action={...action,displayUnit:timing.value,referenceDuration:reference()};
      try{commit(name,'author',action);message('');}catch(e){message(e.message,true);}sync();
    }
    function cancel(){
      if(!drag)return;
      const d=drag;drag=null;states[d.name]=d.original;draw(d.name);
    }
    for(const [name,label] of Object.entries(labels)){
      const b=document.createElement('button');b.type='button';b.id='motion-preset-'+name;b.className='msw-motion-preset';
      b.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg><span>'+label+'</span>';
      b.onclick=()=>{cancel();apply(name,{type:'toggle',value:b.classList.contains('is-mixed')||b.getAttribute('aria-pressed')!=='true'});};bar.append(b);
      const section=document.createElement('section');section.id='motion-'+name;section.className='msw-motion-effect';section.hidden=true;
      section.innerHTML=`<div class="msw-motion-heading"><span>${label}</span>${name==='slide'?'<select id="motion-slide-direction" aria-label="滑动方向"><option value="right">向右</option><option value="left">向左</option><option value="down">向下</option><option value="up">向上</option></select>':''}<button type="button" class="msw-style-icon" id="motion-${name}-reset" title="恢复${label}默认值" aria-label="恢复${label}默认值">${resetIcon}</button></div>
        <svg id="motion-${name}-graph" class="msw-motion-range-graph" preserveAspectRatio="none" role="group" aria-label="${label}时间区间"></svg>`;
      $('motion-preset-controls').append(section);
      $('motion-'+name+'-reset').onclick=()=>apply(name,{type:'reset'});
      const graph=$('motion-'+name+'-graph');
      function valueAt(e){const r=graph.getBoundingClientRect();return (e.clientX-r.left-26)/Math.max(1,r.width-52)*states[name]._extent;}
      graph.onpointerdown=e=>{
        if(e.button!==0||context().blocked||custom)return;
        const node=e.target.closest('[data-edge],[data-band],[data-parameter]');if(!node)return;
        e.preventDefault();e.stopPropagation();
        drag={name,id:e.pointerId,original:clone(states[name]),start:valueAt(e),edge:node.dataset.edge,band:node.dataset.band,
          parameter:parameters(name,states[name]).find(p=>p.key===node.dataset.parameter),patch:{}};
        graph.setPointerCapture(e.pointerId);
      };
      graph.onpointermove=e=>{
        if(drag?.name!==name||drag.id!==e.pointerId)return;
        if(fingerprint()!==signature||context().blocked){cancel();sync();return;}
        e.preventDefault();
        const param=drag.parameter,scale=param?.scale||1;
        drag.patch=param?
          {[param.key]:A.snapValue(valueAt(e)/states[name]._extent*param.max/scale,e,param.min/scale,param.max/scale,scale===1000?.001:.1)*scale}:
          A.dragPreset(name,drag.original,drag,valueAt(e),valueAt(e)-drag.start,e);
        states[name]={...drag.original,...drag.patch};draw(name);
      };
      graph.onpointerup=e=>{
        if(drag?.name!==name||drag.id!==e.pointerId)return;
        const d=drag,next=clone(states[name]);drag=null;
        if(Object.hasOwn(d.patch,'end')&&next.endAnchor==='end')d.patch.end=next._extent-d.patch.end;
        if(fingerprint()!==signature||context().blocked){sync();return;}
        if(JSON.stringify(next)!==JSON.stringify(d.original))apply(name,{type:'values',value:d.patch});
      };
      graph.onpointercancel=cancel;graph.onlostpointercapture=cancel;
      graph.onkeydown=e=>{
        const node=e.target.closest('[data-edge],[data-parameter]');
        if(!node||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||context().blocked||custom)return;
        e.preventDefault();e.stopPropagation();
        const parameter=parameters(name,states[name]).find(p=>p.key===node.dataset.parameter),edge=node.dataset.edge;
        const current=parameter?states[name][parameter.key]:A.presetTimes(name,states[name])[Number(edge)],min=parameter?.min??0,max=parameter?.max??states[name]._extent,scale=parameter?.scale||(parameter?1:states[name].unit==='ms'?1000:1);
        const value=e.key==='Home'?min:e.key==='End'?max:current+(e.key==='ArrowLeft'?-1:1)*(e.ctrlKey?(e.shiftKey?5:1)*scale:scale===1000?10:1);
        let patch=parameter?{[parameter.key]:A.snapValue(value/scale,e,min/scale,max/scale,.001)*scale}:A.dragPreset(name,states[name],{edge},value,0,e);
        if(Object.hasOwn(patch,'end')&&states[name].endAnchor==='end')patch.end=states[name]._extent-patch.end;
        apply(name,{type:'values',value:patch});
        graph.querySelector(parameter?`[data-parameter="${parameter.key}"]`:`[data-edge="${edge}"]`)?.focus({preventScroll:true});
      };
      new ResizeObserver(()=>{if(states[name]&&!drag)draw(name);}).observe(graph);
    }
    $('motion-slide-direction').onchange=e=>apply('slide',{type:'values',value:{direction:e.target.value}});
    const mode=document.createElement('button');mode.id='motion-custom';mode.type='button';mode.className='msw-motion-preset msw-motion-custom';mode.textContent='自定义';bar.append(mode);
    const inherit=document.createElement('button');inherit.id='motion-inherit';inherit.type='button';inherit.className='msw-style-icon';inherit.title=inherit.ariaLabel='恢复轨道动画';inherit.innerHTML=inheritIcon;bar.append(inherit);
    const curves=global.MSWAnimationCurvesUI.create($('motion-curve-editor'),{context,commit,message});
    const reveal=document.createElement('button');reveal.id='motion-custom-typewriter';reveal.type='button';reveal.className='msw-motion-preset';reveal.textContent='打字机 ×';reveal.title='关闭保留的打字机效果';$('motion-curve-editor').prepend(reveal);
    reveal.onclick=()=>apply('typewriter',{type:'custom-typewriter',value:false});
    mode.onclick=()=>{cancel();curves.cancel();apply('all',{type:'mode',value:custom?'presets':'custom'});};
    inherit.onclick=()=>{try{commit('all','reset');message('');}catch(e){message(e.message,true);}sync();};
    function draw(name){
      const graph=$('motion-'+name+'-graph'),width=Math.max(180,graph.clientWidth||320),e=states[name],p=A.presetTimes(name,e),x=v=>26+v/e._extent*(width-52);
      const scalar=parameters(name,drag?.name===name?drag.original:e),height=scalar.length?92:82,off=context().blocked,tab=off?-1:0;
      const pair=['fade','slide'].includes(name),titles=name==='fade'?['淡入开始','淡入结束','淡出开始','淡出结束']:name==='slide'?['滑入开始','滑入结束','滑出开始','滑出结束']:['开始','结束'];
      const timeLabel=(v,i)=>e.unit==='ms'?((e.endAnchor==='end'&&i>=(pair?2:1)?'终−':'起+')+((e.endAnchor==='end'&&i>=(pair?2:1)?e._extent-v:v)/1000).toFixed(3)+' s'):readout(v)+'%';
      graph.setAttribute('viewBox',`0 0 ${width} ${height}`);graph.style.height=height+'px';
      const bands=pair?[[0,1,'in'],[2,3,'out']]:[[0,1,'range']];
      graph.innerHTML=`<rect class="motion-range-rail" x="26" y="17" width="${width-52}" height="22" rx="4"/>`+
        bands.map(([a,b,id])=>`<rect class="motion-range-fill" data-band="${id}" x="${x(p[a])}" y="17" width="${Math.max(1,x(p[b])-x(p[a]))}" height="22" rx="4"><title>拖动整个效果区间</title></rect>`).join('')+
        p.map((v,i)=>`<g class="motion-range-node" data-edge="${i}" tabindex="${tab}" role="slider" aria-disabled="${off}" aria-label="${titles[i]}" aria-valuemin="0" aria-valuemax="${e._extent}" aria-valuenow="${readout(v)}" aria-valuetext="${timeLabel(v,i)}">
          <path class="motion-range-handle" transform="translate(${x(v)} ${i%2?56:0}) scale(1 ${i%2?-1:1})" d="M0 25L-5.5 17A7 7 0 1 1 5.5 17Z"/>
          <rect class="motion-range-hit" x="${x(v)-10}" y="${i%2?39:2}" width="20" height="18"/>
          <title>${titles[i]} ${timeLabel(v,i)}</title></g>
          <text x="${x(v)}" y="${i%2&&(pair||x(v)-x(p[i-1])<100)?79:65}" text-anchor="${v/e._extent<.15?'start':v/e._extent>.85?'end':'middle'}">${timeLabel(v,i)}</text>`).join('')+
        scalar.map(({key,title,min,max,lane},i)=>{
          const px=x(e[key]/max*e._extent),y=lane?32:24,summary=key==='toScale'?`缩放 100% → ${readout(e[key])}%`:key==='distance'?`距离 ${readout(e[key])} px`:key==='period'&&e.periodUnit==='ms'?`间隔 ${(e[key]/1000).toFixed(3)} s`:`${lane?'不透明':'间隔'} ${readout(e[key])}%`;
          return `<g id="motion-${name}-${key}" class="motion-parameter-node" data-parameter="${key}" tabindex="${tab}" role="slider" aria-disabled="${off}" aria-label="${title}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${readout(e[key])}" aria-valuetext="${summary}">
            <path class="motion-parameter-stem" d="M${px} 18V38"/>
            <path class="motion-parameter-symbol" transform="translate(${px} ${y})" d="${lane?'M0-4L4 0L0 4L-4 0Z':'M-3-3H3V3H-3Z'}"/>
            <rect class="motion-range-hit" x="${px-8}" y="${lane?28:19}" width="16" height="9"/>
            <title>${summary}</title></g>
            <path class="motion-parameter-symbol" transform="translate(${26+i*(width-52)/2} 85)" d="${lane?'M0-3L3 0L0 3L-3 0Z':'M-2.5-2.5H2.5V2.5H-2.5Z'}"/>
            <text x="${34+i*(width-52)/2}" y="89">${summary}</text>`;
        }).join('');
      graph.setAttribute('aria-disabled',String(off));
    }
    function sync(){
      const c=context(),key=fingerprint();
      if(drag){if(c.blocked||signature!==key)cancel();else return;}
      signature=key;
      const first=c.items[0]?.value||A.defaults();custom=A.authoringMode(first)==='custom';
      mode.setAttribute('aria-pressed',String(custom));mode.disabled=c.blocked;
      $('motion-preset-controls').hidden=custom;$('motion-curve-editor').hidden=!custom;
      reveal.hidden=!custom||!first.effects.typewriter.enabled||!first.effects.typewriter.custom;reveal.disabled=c.blocked;
      timing.value=A.timingMode(first);timing.disabled=c.blocked;
      $('motion-slide-direction').value=first.effects.slide.direction;
      inherit.hidden=!c.cue;inherit.disabled=c.blocked||!c.items.some(i=>i.override);
      for(const name of Object.keys(labels)){
        const button=$('motion-preset-'+name),enabled=first.effects[name].enabled;
        button.setAttribute('aria-pressed',String(enabled));button.disabled=c.blocked||custom;
        const mixed=c.items.some(i=>i.value.effects[name].enabled!==enabled);
        button.classList.toggle('is-mixed',mixed);button.title=mixed?'所选字幕有多个值，点击统一开启':labels[name];
        try{states[name]=A.effectUnit(A.authorState(first,name,reference()),name,timing.value,reference());}
        catch(_){states[name]={...A.presetDefault(name),enabled};}
        const e=states[name];
        if(name==='fade'&&!Object.hasOwn(e,'start'))Object.assign(e,{start:0,end:e.unit==='ms'?0:100,...(e.unit==='ms'?{endAnchor:'end'}:{})});
        const extent=e.endAnchor==='end'?e.start+e.end+(e.in||0)+(e.out||0):e.end;
        e._extent=e.unit==='ms'?Math.max(1000,reference(),extent):100;
        if(e.endAnchor==='end')e.end=e._extent-e.end;
        const section=$('motion-'+name);section.hidden=!(enabled||mixed);
        for(const el of section.querySelectorAll('input,button,select'))el.disabled=c.blocked;
        draw(name);
      }
      curves.sync();global.MSWHelp?.hydrate(root);
    }
    global.addEventListener('blur',cancel);
    root.addEventListener('keydown',e=>{
      // SVG handles are editing controls too: do not split/delete a subtitle
      // when their local keyboard action has no applicable point.
      if(e.target.closest('svg')&&!e.ctrlKey&&!e.metaKey&&!['Tab','Escape'].includes(e.key))e.stopPropagation();
    });
    global.addEventListener('keydown',e=>{if(drag&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel();}},true);
    return {sync};
  }
  global.MSWSubtitleAnimationUI={create};
})(window);
