// Preset gestures keep local drafts; a completed gesture is one undoable edit.
(function(global){
  'use strict';
  const A=global.MSWSubtitleAnimation,clone=v=>JSON.parse(JSON.stringify(v));
  const labels={fade:'淡入淡出',typewriter:'打字机',blink:'闪烁',transform:'舒展'};
  const resetIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/></svg>';
  const inheritIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v11h13M14 11l4 4-4 4M9 4h11M9 8h11"/></svg>';
  const readout=v=>Math.round(v*10)/10;
  const parameters=(name,e)=>name==='blink'?
    [{key:'period',title:'循环间隔',min:1,max:100,lane:0},{key:'opacity',title:'最低不透明度',min:0,max:100,lane:1}]:
    name==='transform'?[{key:'fromScale',title:'缩放强度',min:1,max:Math.max(200,e.fromScale),lane:0}]:[];
  function create(root,{context,commit,message}){
    root.innerHTML=`<div class="msw-motion-presets" data-option-help="预设可叠加，时间均为字幕时长百分比。水滴手柄控制时间，可拖动两点之间的色条移动整个区间；虚线方形／菱形手柄控制强度，名称和数值显示在滑条下方。舒展强度控制起始缩放，末尾恢复原结束缩放。按住 Ctrl 拖动吸附整数，Ctrl+Shift 吸附 5 的倍数，Esc 取消。切换自定义或关闭效果均保留参数，还原图标才恢复默认值。"></div>
      <div id="motion-preset-controls"></div><div id="motion-curve-editor" hidden></div>`;
    const $=id=>root.querySelector('#'+id),bar=root.firstElementChild;
    let signature='',drag=null,states={},custom=false;
    const fingerprint=()=>JSON.stringify(context().items.map(i=>[i.row?.cue_id,i.track.id,i.value]));
    function apply(name,action){
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
      section.innerHTML=`<div class="msw-motion-heading"><span>${label}</span><button type="button" class="msw-style-icon" id="motion-${name}-reset" title="恢复${label}默认值" aria-label="恢复${label}默认值">${resetIcon}</button></div>
        <svg id="motion-${name}-graph" class="msw-motion-range-graph" preserveAspectRatio="none" role="group" aria-label="${label}时间区间"></svg>`;
      $('motion-preset-controls').append(section);
      $('motion-'+name+'-reset').onclick=()=>apply(name,{type:'reset'});
      const graph=$('motion-'+name+'-graph');
      function valueAt(e){const r=graph.getBoundingClientRect();return (e.clientX-r.left-26)/Math.max(1,r.width-52)*100;}
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
        drag.patch=drag.parameter?
          {[drag.parameter.key]:A.snapValue(valueAt(e)*drag.parameter.max/100,e,drag.parameter.min,drag.parameter.max)}:
          A.dragPreset(name,drag.original,drag,valueAt(e),valueAt(e)-drag.start,e);
        states[name]={...drag.original,...drag.patch};draw(name);
      };
      graph.onpointerup=e=>{
        if(drag?.name!==name||drag.id!==e.pointerId)return;
        const d=drag,next=clone(states[name]);drag=null;
        if(fingerprint()!==signature||context().blocked){sync();return;}
        if(JSON.stringify(next)!==JSON.stringify(d.original))apply(name,{type:'values',value:d.patch});
      };
      graph.onpointercancel=cancel;graph.onlostpointercapture=cancel;
      graph.onkeydown=e=>{
        const node=e.target.closest('[data-edge],[data-parameter]');
        if(!node||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||context().blocked||custom)return;
        e.preventDefault();e.stopPropagation();
        const parameter=parameters(name,states[name]).find(p=>p.key===node.dataset.parameter),edge=node.dataset.edge;
        const current=parameter?states[name][parameter.key]:A.presetTimes(name,states[name])[Number(edge)],min=parameter?.min??0,max=parameter?.max??100;
        const value=e.key==='Home'?min:e.key==='End'?max:current+(e.key==='ArrowLeft'?-1:1)*(e.ctrlKey&&e.shiftKey?5:1);
        const patch=parameter?{[parameter.key]:A.snapValue(value,e,min,max)}:A.dragPreset(name,states[name],{edge},value,0,e);
        apply(name,{type:'values',value:patch});
        graph.querySelector(parameter?`[data-parameter="${parameter.key}"]`:`[data-edge="${edge}"]`)?.focus({preventScroll:true});
      };
      new ResizeObserver(()=>{if(states[name]&&!drag)draw(name);}).observe(graph);
    }
    const mode=document.createElement('button');mode.id='motion-custom';mode.type='button';mode.className='msw-motion-preset msw-motion-custom';mode.textContent='自定义';bar.append(mode);
    const inherit=document.createElement('button');inherit.id='motion-inherit';inherit.type='button';inherit.className='msw-style-icon';inherit.title=inherit.ariaLabel='恢复轨道动画';inherit.innerHTML=inheritIcon;bar.append(inherit);
    const curves=global.MSWAnimationCurvesUI.create($('motion-curve-editor'),{context,commit,message});
    mode.onclick=()=>{cancel();curves.cancel();apply('all',{type:'mode',value:custom?'presets':'custom'});};
    inherit.onclick=()=>{try{commit('all','reset');message('');}catch(e){message(e.message,true);}sync();};
    function draw(name){
      const graph=$('motion-'+name+'-graph'),width=Math.max(180,graph.clientWidth||320),e=states[name],p=A.presetTimes(name,e),x=v=>26+v/100*(width-52);
      const scalar=parameters(name,drag?.name===name?drag.original:e),height=scalar.length?92:82,off=context().blocked,tab=off?-1:0;
      const titles=name==='fade'?['淡入开始','淡入结束','淡出开始','淡出结束']:['开始','结束'];
      graph.setAttribute('viewBox',`0 0 ${width} ${height}`);graph.style.height=height+'px';
      const bands=name==='fade'?[[0,1,'in'],[2,3,'out']]:[[0,1,'range']];
      graph.innerHTML=`<path class="motion-range-rail" d="M26 28H${width-26}"/>`+
        bands.map(([a,b,id])=>`<path class="motion-range-fill" data-band="${id}" d="M${x(p[a])} 28H${x(p[b])}"><title>拖动整个${name==='fade'?(id==='in'?'淡入':'淡出'):'效果'}区间</title></path>`).join('')+
        p.map((v,i)=>`<g class="motion-range-node" data-edge="${i}" tabindex="${tab}" role="slider" aria-disabled="${off}" aria-label="${titles[i]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${readout(v)}" aria-valuetext="${readout(v)}%">
          <path class="motion-range-handle" transform="translate(${x(v)} ${i%2?56:0}) scale(1 ${i%2?-1:1})" d="M0 25L-5.5 17A7 7 0 1 1 5.5 17Z"/>
          <rect class="motion-range-hit" x="${x(v)-10}" y="${i%2?39:2}" width="20" height="18"/>
          <title>${titles[i]} ${readout(v)}%</title></g>
          <text x="${x(v)}" y="${i%2&&(name==='fade'||x(v)-x(p[i-1])<42)?79:65}" text-anchor="${v<6?'start':v>94?'end':'middle'}">${readout(v)}%</text>`).join('')+
        scalar.map(({key,title,min,max,lane},i)=>{
          const px=x(e[key]/max*100),y=lane?32:24,summary=key==='fromScale'?`缩放 ${readout(e[key])}% → ${readout(e.toScale)}%`:`${lane?'不透明':'间隔'} ${readout(e[key])}%`;
          return `<g id="motion-${name}-${key}" class="motion-parameter-node" data-parameter="${key}" tabindex="${tab}" role="slider" aria-disabled="${off}" aria-label="${title}" aria-valuemin="${min}" aria-valuemax="${max}" aria-valuenow="${readout(e[key])}" aria-valuetext="${summary}">
            <path class="motion-parameter-stem" d="M${px} 18V38"/>
            <path class="motion-parameter-symbol" transform="translate(${px} ${y})" d="${lane?'M0-4L4 0L0 4L-4 0Z':'M-3-3H3V3H-3Z'}"/>
            <rect class="motion-range-hit" x="${px-8}" y="${lane?28:19}" width="16" height="9"/>
            <title>${title}：${readout(e[key])}%${key==='fromScale'?`，结束缩放 ${readout(e.toScale)}%`:''}</title></g>
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
      inherit.hidden=!c.cue;inherit.disabled=c.blocked||!c.items.some(i=>i.override);
      for(const name of Object.keys(labels)){
        const button=$('motion-preset-'+name),enabled=first.effects[name].enabled;
        button.setAttribute('aria-pressed',String(enabled));button.disabled=c.blocked||custom;
        const mixed=c.items.some(i=>i.value.effects[name].enabled!==enabled);
        button.classList.toggle('is-mixed',mixed);button.title=mixed?'所选字幕有多个值，点击统一开启':labels[name];
        try{states[name]=A.presetState(first,name,c.items[0]?.duration||1000);}
        catch(_){states[name]={...A.presetDefault(name),enabled};}
        const section=$('motion-'+name);section.hidden=!(enabled||mixed);
        for(const el of section.querySelectorAll('input,button'))el.disabled=c.blocked;
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
