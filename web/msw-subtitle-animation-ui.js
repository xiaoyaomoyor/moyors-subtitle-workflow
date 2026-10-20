// Parameter editor: recipes fill the same values used by ASS, not a preset stack.
(function(global){
  'use strict';
  const A=global.MSWSubtitleAnimation,clone=v=>JSON.parse(JSON.stringify(v));
  function create(root,{context,commit,message}){
    const labels={fade:'淡入淡出',typewriter:'打字机',blink:'闪烁',transform:'舒展'};
    root.innerHTML=`<div class="msw-motion-presets" data-option-help="点击预设填入对应参数；不同参数可组合，同一参数会被覆盖。修改下方参数后不再匹配的预设取消高亮，再次点击可重新应用。"></div>
      <div class="msw-motion-parameter-bar">
        <label class="msw-style-field"><span>动画参数</span><select id="motion-parameter" aria-label="动画参数"></select></label>
        <label class="msw-style-field" data-option-help="百分比按每条字幕自己的时长计算；毫秒从字幕起点计算。切换按各字幕时长换算；空轨按 1 秒。"><span class="msw-option-label">时间单位</span><select id="motion-unit"><option value="percent">百分比</option><option value="ms">毫秒</option></select></label>
        <button type="button" class="msw-style-icon" id="motion-parameter-reset" aria-label="此组参数跟随轨道" title="此组参数跟随轨道"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v11h13M14 11l4 4-4 4M9 4h11M9 8h11"/></svg></button>
        <button type="button" class="msw-style-icon" id="motion-inherit" aria-label="恢复轨道动画" title="恢复轨道动画"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/></svg></button>
      </div><div id="motion-curve-editor"></div>
      <div id="motion-range-editor" hidden>
        <label class="msw-style-check"><input type="checkbox" id="motion-range-enabled"><span>启用</span></label>
        <svg id="motion-range-graph" viewBox="0 0 320 58" preserveAspectRatio="none" tabindex="0" role="img" aria-label="动画时间区间，拖动端点调整开始和结束"></svg>
        <div class="msw-style-fields">
          <label class="msw-style-field"><span id="motion-range-start-label">开始 (%)</span><input type="number" id="motion-range-start" min="0" max="100" step="any" required></label>
          <label class="msw-style-field"><span id="motion-range-end-label">结束 (%)</span><input type="number" id="motion-range-end" min="0" max="100" step="any" required></label>
          <label class="msw-style-field" id="motion-period-field"><span>循环间隔 (ms)</span><input type="number" id="motion-range-period" min="80" max="60000" step="1" required></label>
          <label class="msw-style-field" id="motion-opacity-field"><span>最低不透明度 (%)</span><input type="number" id="motion-range-opacity" min="0" max="100" step="1" required></label>
        </div>
      </div>`;
    const $=id=>root.querySelector('#'+id),parameter=()=> $('motion-parameter').value;
    const curves=global.MSWAnimationCurvesUI.create($('motion-curve-editor'),{context,commit,message});
    $('curve-channel').hidden=true;
    $('curve-active').nextElementSibling.textContent='使用关键帧';
    $('motion-parameter').replaceChildren(...[
      ['opacity','不透明度'],['x','横向位移'],['y','纵向位移'],['scale','缩放'],['rotation','旋转'],
      ['typewriter','文字显现'],['blink','闪烁']
    ].map(([key,label])=>new Option(label,key)));
    let shown='opacity',drag=null,signature='',range=null;
    const first=()=>context().items[0]?.value||A.defaults();
    const special=()=>['typewriter','blink'].includes(parameter());
    const effectName=()=>special()?parameter():'curves';
    const fingerprint=()=>JSON.stringify(context().items.map(i=>[i.row?.cue_id,i.track.id,i.value]));
    const apply=(name,key,value)=>{
      try{commit(name,key,value);message('');}catch(error){message(error.message,true);}
      sync();
    };
    for(const [name,label] of Object.entries(labels)){
      const button=document.createElement('button');button.type='button';button.className='msw-motion-preset';button.id='motion-preset-'+name;
      button.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg><span></span>';
      button.lastElementChild.textContent=label;button.title='填入'+label+'参数';
      button.onclick=()=>{
        cancel();$('motion-parameter').value={fade:'opacity',transform:'scale'}[name]||name;
        shown=parameter();if(!special())curves.selectChannel(shown);
        apply(name,'preset');
      };
      root.querySelector('.msw-motion-presets').append(button);
    }
    $('motion-parameter').onchange=()=>{
      cancel();curves.cancel();shown=parameter();
      if(!special())curves.selectChannel(shown);
      sync();
    };
    $('motion-unit').onchange=()=>apply(effectName(),'unit',$('motion-unit').value);
    $('motion-inherit').onclick=()=>apply('all','reset');
    $('motion-parameter-reset').onclick=()=>apply(effectName(),'reset');
    $('motion-range-enabled').onchange=e=>apply(parameter(),'enabled',e.target.checked);
    for(const key of ['start','end','period','opacity'])$('motion-range-'+key).onchange=()=>{
      const input=$('motion-range-'+key);if(!input.reportValidity()){sync();return;}
      apply(parameter(),'range',{[key]:Number(input.value),enabled:true});
    };
    function drawRange(writeValues=true){
      if(!range)return;
      const maximum=range.unit==='percent'?100:Math.min(60000,Math.max(context().items[0]?.duration||1000,range.end,1));
      const width=Math.max(200,$('motion-range-graph').clientWidth||320),right=width-12;
      $('motion-range-graph').setAttribute('viewBox',`0 0 ${width} 58`);
      const x=value=>12+value/maximum*(width-24);
      $('motion-range-graph').innerHTML=`<path class="motion-range-rail" d="M12 24H${right}"/>
        <path class="motion-range-fill" d="M${x(range.start)} 24H${x(range.end)}"/>
        ${['start','end'].map(key=>`<rect class="motion-range-handle" data-edge="${key}" x="${x(range[key])-4}" y="13" width="8" height="22" rx="2"/>`).join('')}
        <text x="12" y="52">0</text><text x="${right}" y="52" text-anchor="end">${Math.round(maximum*100)/100}${range.unit==='percent'?'%':' ms'}</text>`;
      if(writeValues)for(const key of ['start','end','period','opacity']){
        const node=$('motion-range-'+key);node.value=range[key]??'';
        if(['start','end'].includes(key)){
          node.max=range.unit==='percent'?'100':'60000';
          $('motion-range-'+key+'-label').textContent=(key==='start'?'开始':'结束')+(range.unit==='percent'?' (%)':' (ms)');
        }
      }
      return maximum;
    }
    function sync(){
      const c=context(),a=first();
      if(drag){if(c.blocked||fingerprint()!==signature)cancel();else return;}
      signature=fingerprint();
      for(const node of root.querySelectorAll('input,select,button'))node.disabled=c.blocked;
      $('motion-inherit').hidden=!c.cue;$('motion-inherit').disabled=c.blocked||!c.items.some(i=>i.override);
      $('motion-parameter-reset').hidden=!c.cue||!c.items.some(i=>Object.hasOwn(i.override?.effects||{},effectName()));
      for(const name of Object.keys(labels)){
        const matches=c.items.length&&c.items.every(i=>{
          try{
            const patch=A.presetPatch(i.value,name,i.duration);
            return Object.entries(patch.effects).every(([key,value])=>JSON.stringify(value)===JSON.stringify(i.value.effects[key]));
          }catch(_){return false;}
        });
        $('motion-preset-'+name).setAttribute('aria-pressed',String(!!matches));
      }
      $('motion-unit').value=a.effects[effectName()].unit;
      $('motion-curve-editor').hidden=special();$('motion-range-editor').hidden=!special();
      if(special()){
        range=clone(a.effects[parameter()]);drawRange();
        $('motion-range-enabled').checked=range.enabled;
        $('motion-range-enabled').indeterminate=c.items.some(i=>i.value.effects[parameter()].enabled!==range.enabled);
        for(const key of ['start','end','period','opacity']){
          const node=$('motion-range-'+key),mixed=c.items.some(i=>i.value.effects[parameter()][key]!==range[key]);
          if(mixed){node.value='';node.placeholder='多个值';}else node.placeholder='';
        }
        $('motion-period-field').hidden=$('motion-opacity-field').hidden=parameter()!=='blink';
      }else{
        curves.sync();
      }
      global.MSWHelp?.hydrate(root);
    }
    const graph=$('motion-range-graph');
    function cancel(){if(!drag)return;range=drag.original;drag=null;drawRange();}
    graph.addEventListener('pointerdown',event=>{
      const edge=event.target.closest('[data-edge]')?.dataset.edge;
      if(!edge||event.button!==0||context().blocked)return;
      event.preventDefault();event.stopPropagation();curves.cancel();
      drag={id:event.pointerId,edge,original:clone(range),maximum:drawRange()};graph.focus({preventScroll:true});graph.setPointerCapture(event.pointerId);
    });
    graph.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const rect=graph.getBoundingClientRect(),time=(event.clientX-rect.left-12)/Math.max(1,rect.width-24)*drag.maximum;
      range[drag.edge]=Math.round(Math.max(drag.edge==='end'?range.start+.01:0,Math.min(drag.edge==='start'?range.end-.01:drag.maximum,time))*100)/100;
      drawRange();
    });
    graph.addEventListener('pointerup',event=>{
      if(!drag||event.pointerId!==drag.id)return;const original=drag.original;drag=null;
      if(fingerprint()!==signature){sync();return;}
      if(original.start!==range.start||original.end!==range.end)apply(parameter(),'range',{start:range.start,end:range.end,enabled:true});
    });
    graph.addEventListener('pointercancel',cancel);graph.addEventListener('lostpointercapture',cancel);
    global.addEventListener('blur',cancel);
    new ResizeObserver(()=>{if(range&&!drag)drawRange(false);}).observe(graph);
    global.addEventListener('keydown',event=>{if(drag&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}},true);
    $('motion-range-editor').dataset.optionHelp='拖动区间两端设置开始与结束；Esc 取消拖动。文字显现逐字显示，闪烁按固定间隔循环，均按每条字幕自己的起点计时。';
    // Do not access the host's project-dependent state until its initialization ends.
    $('curve-channel').value='opacity';
    return {sync};
  }
  global.MSWSubtitleAnimationUI={create};
})(window);
