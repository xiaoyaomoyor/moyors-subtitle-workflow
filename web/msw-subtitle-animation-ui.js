// Compact effect controls shared by track defaults and actual cue selections.
(function(global){
  'use strict';
  const A=global.MSWSubtitleAnimation;
  function create(root,{context,commit,message,preview}){
    const labels={fade:'淡入淡出',typewriter:'打字机',blink:'闪烁',transform:'舒展'};
    const help={fade:'按字幕自身时长淡入淡出；两段相加超过字幕时长时等比缩短。',typewriter:'逐字显示，保留完整文字的换行与位置；空格和换行不占一次出字。',blink:'在指定时段内交替显示；间隔是一次完整亮暗循环的毫秒数。可与淡入淡出叠加。',transform:'从起始状态变化到结束状态，前后保持各自状态。位移相对字幕原位置，缩放相对原字号；坐标单位以 1080p 为基准。'};
    const svg='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2 8M3 3v7h7"/></svg>';
    root.innerHTML='<div class="msw-motion-actions"><button type="button" id="motion-inherit">跟随轨道动画</button><button type="button" id="motion-clear">关闭全部</button><button type="button" id="motion-preview" aria-label="从字幕起点预览" title="从字幕起点预览"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"/></svg></button></div><div class="msw-motion-presets"></div><div class="msw-motion-effects"></div>';
    const $=id=>root.querySelector('#'+id),controls=new Map();
    for(const name of A.names){
      const label=document.createElement('label');label.className='msw-style-check';label.dataset.optionHelp=help[name];
      label.innerHTML=`<input type="checkbox" id="motion-${name}-enabled"><span class="msw-option-label">${labels[name]}</span>`;
      root.querySelector('.msw-motion-presets').append(label);
      const card=document.createElement('details');card.className='msw-motion-effect';card.hidden=true;card.open=true;card.id='motion-'+name+'-card';
      card.innerHTML=`<summary class="msw-motion-heading"><span>${labels[name]}</span><button type="button" class="msw-style-icon" id="motion-${name}-reset" title="此效果跟随轨道" aria-label="${labels[name]}跟随轨道">${svg}</button></summary><div class="msw-style-fields"></div>`;
      root.querySelector('.msw-motion-effects').append(card);
      const fields=card.lastElementChild;
      const add=(key,title,type='number',choices)=>{
        const line=document.createElement('label');line.className='msw-style-field';
        const caption=document.createElement('span');caption.className='msw-option-label';caption.textContent=title;
        const input=document.createElement(type==='select'?'select':'input');input.id='motion-'+name+'-'+key;input.dataset.motion=key;input.setAttribute('aria-label',title);
        if(['unit','easing'].includes(key))line.classList.add('msw-motion-wide');
        if(type==='select')input.replaceChildren(...choices.map(([v,l])=>new Option(l,v)));
        else{input.type=type;input.required=true;input.step='any';input.min=key.endsWith('Rotation')?'-360':/[XY]$/.test(key)?'-4096':key==='period'?'80':key.endsWith('Scale')?'1':'0';input.max=key.endsWith('Rotation')?'360':/[XY]$/.test(key)?'4096':key==='period'?'60000':key.endsWith('Scale')?'1000':'100';}
        line.append(caption,input);fields.append(line);controls.set(name+'.'+key,{input,caption,title});
        input.onchange=()=>{
          if(!input.reportValidity()){sync();return;}
          try{commit(name,key,type==='number'?Number(input.value):input.value);message('');}catch(error){message(error.message,true);sync();}
        };
      };
      add('unit','时间单位','select',[['percent','字幕时长 (%)'],['ms','毫秒 (ms)']]);
      const unit=controls.get(name+'.unit');unit.input.closest('label').dataset.optionHelp='比例按每条字幕自己的时长计算；毫秒从字幕起点计算。切换单位按当前预览字幕换算，多选分别换算；空轨按 1 秒换算。超出字幕的部分不显示。';
      for(const key of A.timings(name))add(key,{in:'淡入',out:'淡出',start:'开始',end:'结束'}[key]);
      if(name==='blink'){add('period','循环间隔 (ms)');add('opacity','变暗时不透明度 (%)');}
      if(name==='transform'){
        add('easing','变化方式','select',[['linear','匀速'],['ease-in','先慢后快'],['ease-out','先快后慢'],['smooth','平滑']]);
        const table=document.createElement('div');table.className='msw-motion-transform msw-motion-wide';
        table.innerHTML='<div class="msw-motion-transform-row msw-motion-transform-head"><span>参数</span><span>起始</span><span>结束</span></div>';
        for(const [suffix,title] of [['Scale','缩放 (%)'],['X','横向位移 (px)'],['Y','纵向位移 (px)'],['Rotation','旋转 (°)'],['Opacity','不透明度 (%)']]){
          add('from'+suffix,'起始'+title);add('to'+suffix,'结束'+title);
          const row=document.createElement('div');row.className='msw-motion-transform-row';
          const caption=document.createElement('span');caption.textContent=title;row.append(caption);
          for(const side of ['from','to'])row.append(controls.get(name+'.'+side+suffix).input.closest('label'));
          table.append(row);
        }
        fields.append(table);
      }
      $('motion-'+name+'-enabled').onchange=event=>{try{commit(name,'enabled',event.target.checked);message('');}catch(error){message(error.message,true);sync();}};
      $('motion-'+name+'-reset').onclick=event=>{event.preventDefault();try{commit(name,'reset');message('');}catch(error){message(error.message,true);}sync();};
    }
    $('motion-inherit').onclick=()=>{try{commit('all','reset');message('');}catch(error){message(error.message,true);}sync();};
    $('motion-clear').onclick=()=>{try{commit('all','disable');message('');}catch(error){message(error.message,true);}sync();};
    $('motion-preview').onclick=()=>preview();
    function sync(){
      const c=context(),items=c.items,first=items[0]?.value||A.defaults();
      for(const el of root.querySelectorAll('input,select,button'))el.disabled=c.blocked;
      $('motion-inherit').hidden=!c.cue;$('motion-inherit').disabled=c.blocked||!items.some(i=>i.override);
      $('motion-preview').disabled=!c.preview;
      for(const name of A.names){
        const e=first.effects[name],check=$('motion-'+name+'-enabled');
        check.checked=e.enabled;check.indeterminate=items.some(i=>i.value.effects[name].enabled!==e.enabled);
        const overridden=c.cue&&items.some(i=>Object.hasOwn(i.override?.effects||{},name));
        check.closest('label').classList.toggle('is-overridden',overridden);
        const card=$('motion-'+name+'-card');card.hidden=!e.enabled&&!check.indeterminate;
        const reset=$('motion-'+name+'-reset');reset.hidden=!overridden;
        for(const [key,{input,caption,title}] of controls){if(!key.startsWith(name+'.'))continue;
          const k=key.split('.')[1],mixed=items.some(i=>i.value.effects[name][k]!==e[k]);
          input.value=mixed?'':String(e[k]);input.placeholder=mixed?'多个值':'';
          input.closest('label').classList.toggle('is-mixed',mixed);
          if(A.timings(name).includes(k)){input.max=e.unit==='percent'?'100':'60000';caption.textContent=title+(e.unit==='percent'?' (%)':' (ms)');}
          if(k==='period')input.max='60000';
        }
      }
      global.MSWHelp?.hydrate(root);
    }
    return {sync};
  }
  global.MSWSubtitleAnimationUI={create};
})(window);
