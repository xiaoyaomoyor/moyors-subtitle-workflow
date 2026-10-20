// Preset gestures keep local drafts; a completed gesture is one undoable edit.
(function(global){
  'use strict';
  const A=global.MSWSubtitleAnimation,clone=v=>JSON.parse(JSON.stringify(v));
  const labels={fade:'淡入淡出',typewriter:'打字机',blink:'闪烁',transform:'舒展'};
  const resetIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/></svg>';
  function create(root,{context,commit,message}){
    root.innerHTML=`<div class="msw-motion-presets" data-option-help="预设可叠加，时间均为字幕时长百分比。切换自定义会暂停预设并保留参数，再次切换即可恢复。关闭效果也保留参数，点击对应还原图标才恢复默认值。"></div>
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
        const node=e.target.closest('[data-edge],[data-band]');if(!node)return;
        e.preventDefault();e.stopPropagation();
        drag={name,id:e.pointerId,original:clone(states[name]),start:valueAt(e),edge:node.dataset.edge,band:node.dataset.band};
        graph.setPointerCapture(e.pointerId);
      };
      graph.onpointermove=e=>{
        if(drag?.name!==name||drag.id!==e.pointerId)return;
        if(fingerprint()!==signature||context().blocked){cancel();sync();return;}
        e.preventDefault();move(name,drag.original,drag.edge,drag.band,valueAt(e),valueAt(e)-drag.start);draw(name);
      };
      graph.onpointerup=e=>{
        if(drag?.name!==name||drag.id!==e.pointerId)return;
        const d=drag,next=clone(states[name]);drag=null;
        if(fingerprint()!==signature||context().blocked){sync();return;}
        if(JSON.stringify(next)!==JSON.stringify(d.original))apply(name,{type:'values',value:timingPatch(name,next)});
      };
      graph.onpointercancel=cancel;graph.onlostpointercapture=cancel;
      graph.onkeydown=e=>{
        const edge=e.target.closest('[data-edge]')?.dataset.edge;
        if(edge===undefined||!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)||context().blocked)return;
        e.preventDefault();e.stopPropagation();
        const points=times(name),value=e.key==='Home'?0:e.key==='End'?100:points[Number(edge)]+(e.key==='ArrowLeft'?-1:1);
        move(name,states[name],edge,undefined,value,0);apply(name,{type:'values',value:timingPatch(name,states[name])});
        graph.querySelector(`[data-edge="${edge}"]`)?.focus({preventScroll:true});
      };
      new ResizeObserver(()=>{if(states[name]&&!drag)draw(name);}).observe(graph);
      const scalars=name==='blink'?[['period','循环间隔',1,100,'%'],['opacity','最低不透明度',0,100,'%']]:
        name==='transform'?[['fromScale','起始缩放',1,300,'%'],['toScale','结束缩放',1,300,'%']]:[];
      for(const [key,title,min,max,unit] of scalars){
        const field=document.createElement('label');field.className='msw-motion-strength';
        field.innerHTML=`<span>${title}</span><input id="motion-${name}-${key}" type="range" min="${min}" max="${max}" step="1"><output></output>`;
        const input=field.querySelector('input'),output=field.querySelector('output');let base='';
        input.onpointerdown=()=>{base=fingerprint();};
        input.oninput=()=>{output.textContent=input.value+unit;};
        input.onchange=()=>{
          if(base&&base!==fingerprint()){base='';sync();return;}
          base='';apply(name,{type:'values',value:{[key]:Number(input.value)}});
        };
        input.onkeydown=e=>{if(e.key.startsWith('Arrow'))e.stopPropagation();};
        section.append(field);
      }
    }
    const mode=document.createElement('button');mode.id='motion-custom';mode.type='button';mode.className='msw-motion-preset msw-motion-custom';mode.textContent='自定义';bar.append(mode);
    const inherit=document.createElement('button');inherit.id='motion-inherit';inherit.type='button';inherit.className='msw-style-icon';inherit.title=inherit.ariaLabel='恢复轨道动画';inherit.innerHTML=resetIcon;bar.append(inherit);
    const curves=global.MSWAnimationCurvesUI.create($('motion-curve-editor'),{context,commit,message});
    mode.onclick=()=>{cancel();curves.cancel();apply('all',{type:'mode',value:custom?'presets':'custom'});};
    inherit.onclick=()=>{try{commit('all','reset');message('');}catch(e){message(e.message,true);}sync();};
    function times(name,e=states[name]){
      return name==='fade'?[e.start,e.start+e.in,e.end-e.out,e.end]:[e.start,e.end];
    }
    function timingPatch(name,e){
      return {start:e.start,end:e.end,...(name==='fade'?{in:e.in,out:e.out}:{})};
    }
    function move(name,original,edge,band,value,delta){
      const p=times(name,original),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),round=v=>Math.round(v*10)/10;
      if(band!==undefined){
        const ids=name==='fade'?(band==='in'?[0,1]:[2,3]):[0,1],a=ids[0],b=ids[1];
        delta=round(clamp(delta,(a?p[a-1]:0)-p[a],(b<p.length-1?p[b+1]:100)-p[b]));
        for(const i of ids)p[i]+=delta;
      }else{
        const i=Number(edge),gap=name==='fade'?0:.1;
        p[i]=round(clamp(value,i?p[i-1]+gap:0,i<p.length-1?p[i+1]-gap:100));
      }
      if(p.at(-1)-p[0]<.1)return;
      states[name]={...original,start:p[0],end:p.at(-1)};
      if(name==='fade')Object.assign(states[name],{in:Math.max(0,p[1]-p[0]),out:Math.max(0,p[3]-p[2])});
    }
    function draw(name){
      const graph=$('motion-'+name+'-graph'),width=Math.max(180,graph.clientWidth||320),p=times(name),x=v=>26+v/100*(width-52);
      const titles=name==='fade'?['淡入开始','淡入结束','淡出开始','淡出结束']:['开始','结束'];
      graph.setAttribute('viewBox',`0 0 ${width} 68`);
      const bands=name==='fade'?[[0,1,'in'],[2,3,'out']]:[[0,1,'range']];
      graph.innerHTML=`<path class="motion-range-rail" d="M26 20H${width-26}"/>`+
        bands.map(([a,b,id])=>`<path class="motion-range-fill" data-band="${id}" d="M${x(p[a])} 20H${x(p[b])}"><title>拖动整个${name==='fade'?(id==='in'?'淡入':'淡出'):'效果'}区间</title></path>`).join('')+
        p.map((v,i)=>`<g class="motion-range-node" data-edge="${i}" tabindex="${context().blocked?-1:0}" role="slider" aria-label="${titles[i]}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v*10)/10}" aria-valuetext="${Math.round(v*10)/10}%">
          <rect class="motion-range-hit" x="${x(v)-10}" y="${i%2?16:2}" width="20" height="20"/>
          <path class="motion-range-handle" d="M${x(v)} 20V${i%2?26:14}"/>
          <circle class="motion-range-handle" cx="${x(v)}" cy="${i%2?26:14}" r="4"/>
          <title>${titles[i]} ${Math.round(v*10)/10}%</title></g>
          <text x="${x(v)}" y="${name==='fade'&&i%2?62:47}" text-anchor="${v<6?'start':v>94?'end':'middle'}">${Math.round(v*10)/10}%</text>`).join('');
      graph.setAttribute('aria-disabled',String(context().blocked));
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
        for(const input of section.querySelectorAll('input[type=range]')){
          const key=input.id.slice(('motion-'+name+'-').length),v=states[name][key];
          input.max=String(Math.max(Number(input.max),v));input.value=String(v);
          input.nextElementSibling.textContent=Math.round(v*10)/10+'%';
        }
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
