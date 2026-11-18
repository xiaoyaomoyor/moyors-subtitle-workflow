(function(global) {
  'use strict';
  const host=global.MSWE?.resolve('processing-host'),core=global.MSWReview,wave=host?.waveform;
  // Restoring a custom workspace can detach closed panels before this module
  // loads. Initialize the retained dock node so reopening it has real content.
  const root=wave?.reviews?.querySelector('#review-content');
  if(!root||!wave)return;
  const $=id=>root.querySelector('#review-'+id),ranges=()=>global.MSWE.resolve('time-range')?.ranges||[];
  let selected='',selectionActive=false,drag=null,loop=null,loopFrame=0,visible=true,draftDirty=false;
  const checked=new Set();let filteredIds=[];
  const state=()=>host.data.review_markers||core.empty(),item=()=>state().items.find(x=>x.id===selected);
  root.innerHTML=`<div class="msw-review-toolbar">
    <button type="button" id="review-add-point">＋时间点</button><button type="button" id="review-add-range">＋时间选区</button>
    <label><input type="checkbox" id="review-visible" checked>波形标记</label></div>
    <div class="msw-review-filters"><input type="search" id="review-search" placeholder="搜索名称、备注" aria-label="搜索复核标记">
    <select id="review-filter" aria-label="复核状态"><option value="">全部状态</option><option value="pending">待处理</option><option value="resolved">已解决</option></select>
    <select id="review-kind" aria-label="标记类型"><option value="">全部类型</option><option value="point">时间点</option><option value="range">区段</option></select></div>
    <div id="review-count" class="msw-review-muted" role="status"></div>
    <div class="msw-review-batch"><label title="仅选择当前筛选结果"><input type="checkbox" id="review-select-all" aria-label="全选当前筛选结果">全选</label>
      <span id="review-selected-count" class="msw-review-muted" role="status"></span>
      <button type="button" id="review-batch-resolve">已解决</button><button type="button" id="review-batch-pending">待处理</button><button type="button" id="review-batch-delete" class="danger">删除</button></div>
    <div id="review-list" role="list" aria-label="复核标记"></div>
    <form id="review-edit" hidden><div class="msw-review-fields">
      <label class="msw-review-wide">名称<input id="review-name" maxlength="120" placeholder="未命名复核标记"></label>
      <label>开始<input id="review-start" aria-label="复核开始时间" title="时:分:秒.毫秒" required></label>
      <label>结束（留空为时间点）<input id="review-end" aria-label="复核结束时间" title="时:分:秒.毫秒"></label>
      <label>状态<select id="review-status"><option value="pending">待处理</option><option value="resolved">已解决</option></select></label>
      <div class="msw-review-colors"><label>标签色<input type="color" id="review-color" value="#e7b35a"></label>
      <label>文字色<input type="color" id="review-text-color" value="#20242b" title="用于标记文字和旗帜图标"></label></div>
      <label class="msw-review-wide">备注<textarea id="review-note" rows="3" maxlength="2000" placeholder="记录需要检查的内容"></textarea></label>
    </div><div id="review-links" class="msw-review-muted"></div><div class="msw-review-toolbar">
      <button type="button" id="review-link">关联所选字幕</button><button type="button" id="review-unlink">解除关联</button>
      <button type="button" id="review-jump">定位</button><button type="button" id="review-loop">循环区段</button>
      <button type="button" id="review-delete" class="danger">删除</button></div></form>
    <div id="review-message" role="status" aria-live="polite"></div>`;
  function message(value=''){$('message').textContent=value;}
  function change(label,mutate) {
    try {const next=structuredClone(state());mutate(next.items);host.commitReviews(next,label);message();return true;}
    catch(error){message(error.message);return false;}
  }
  function open() {wave.showModule('reviews',{recordUndo:false});wave.activateModuleTab('reviews');}
  function refreshOverlays(){wave.renderedRows.forEach(row=>renderRow(row,Number(row.dataset.startMs),Number(row.dataset.endMs)));}
  function select(id,{jump=false}={}) {selected=id;selectionActive=true;open();refresh();$('edit').scrollTop=0;if(jump)jumpTo(item());}
  function jumpTo(mark) {if(mark){stopLoop();host.seek(mark.start_ms/1000,{pauseAfterSeek:true});wave.revealTime(mark.start_ms);}}
  function highlighted(element,text,query) {
    element.replaceChildren();
    if(!query){element.textContent=text;return;}
    const pattern=new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'giu');let end=0;
    for(const match of text.matchAll(pattern)) {
      element.append(document.createTextNode(text.slice(end,match.index)));
      const highlight=document.createElement('mark');highlight.textContent=match[0];element.append(highlight);end=match.index+match[0].length;
    }
    element.append(document.createTextNode(text.slice(end)));
  }
  function refreshBatch() {
    const count=checked.size,all=$('select-all');
    all.checked=Boolean(filteredIds.length&&count===filteredIds.length);all.indeterminate=count>0&&!all.checked;all.disabled=!filteredIds.length;
    $('selected-count').textContent=`已选 ${count} 条`;
    for(const action of ['resolve','pending','delete'])$('batch-'+action).disabled=!count;
    $('list').querySelectorAll('.msw-review-row').forEach(row=>{row.classList.toggle('checked',checked.has(row.dataset.id));row.querySelector('input').checked=checked.has(row.dataset.id);});
  }
  function batch(action) {
    if(!checked.size)return;
    const ids=new Set(checked);
    if(action!=='delete'&&!state().items.some(mark=>ids.has(mark.id)&&mark.status!==action))return;
    stopLoop();change(action==='delete'?'批量删除复核标记':action==='resolved'?'批量解决复核标记':'批量重新打开复核标记',items=>{
      if(action==='delete'){for(let i=items.length-1;i>=0;i--)if(ids.has(items[i].id))items.splice(i,1);}
      else for(const mark of items)if(ids.has(mark.id))mark.status=action;
    });
  }
  $('select-all').onchange=()=>{checked.clear();if($('select-all').checked)filteredIds.forEach(id=>checked.add(id));refreshBatch();};
  $('batch-resolve').onclick=()=>batch('resolved');$('batch-pending').onclick=()=>batch('pending');$('batch-delete').onclick=()=>batch('delete');
  function refresh() {
    draftDirty=false;
    const marks=core.sorted(state()),query=$('search').value.toLocaleLowerCase(),filter=$('filter').value,kind=$('kind').value;
    const filtered=marks.filter(m=>(!filter||m.status===filter)&&(!kind||(m.end_ms===undefined?'point':'range')===kind)
      &&`${m.name}\n${m.note}`.toLocaleLowerCase().includes(query));
    filteredIds=filtered.map(mark=>mark.id);const available=new Set(filteredIds);
    for(const id of checked)if(!available.has(id))checked.delete(id);
    if(selected&&!marks.some(mark=>mark.id===selected)){selected='';selectionActive=false;}
    $('count').textContent=`${filtered.length} / ${marks.length} 条 · ${marks.filter(m=>m.status==='pending').length} 条待处理`;
    const list=$('list');list.replaceChildren();
    if(!filtered.length){const p=document.createElement('p');p.className='msw-review-muted';p.textContent=marks.length?'没有符合筛选条件的标记':'在播放头添加时间点，或将波形时间选区记为复核区段。';list.append(p);}
    for(const mark of filtered) {
      const row=document.createElement('div');row.className='msw-review-row';row.setAttribute('role','listitem');row.dataset.id=mark.id;
      row.classList.toggle('selected',mark.id===selected);row.style.setProperty('--review-color',mark.color);
      const check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',`选择标记：${mark.name||'未命名'}`);
      check.onchange=()=>{if(check.checked)checked.add(mark.id);else checked.delete(mark.id);refreshBatch();};
      const button=document.createElement('button');button.type='button';button.className='msw-review-entry';button.setAttribute('aria-pressed',String(mark.id===selected));
      const name=document.createElement('strong');highlighted(name,mark.name||'未命名复核标记',query);name.setAttribute('data-i18n-skip','');
      const time=document.createElement('span');time.textContent=core.format(mark.start_ms)+(mark.end_ms===undefined?'':` → ${core.format(mark.end_ms)}`);
      const note=document.createElement('span');note.className='msw-review-note';highlighted(note,mark.note,query);note.setAttribute('data-i18n-skip','');
      const status=document.createElement('button');status.type='button';status.className='msw-review-state';status.textContent=mark.status==='resolved'?'已解决':'待处理';status.setAttribute('aria-label',`${mark.status==='resolved'?'标为待处理':'标为已解决'}：${mark.name||'未命名'}`);
      status.onclick=()=>change(mark.status==='resolved'?'重新打开复核标记':'解决复核标记',items=>{items.find(x=>x.id===mark.id).status=mark.status==='resolved'?'pending':'resolved';});
      button.append(name,time,note);button.onclick=()=>select(mark.id);button.ondblclick=()=>jumpTo(mark);row.append(check,button,status);list.append(row);
    }
    refreshBatch();
    const mark=item();$('edit').hidden=!mark;
    if(mark) {
      for(const key of ['name','note','color','status'])$(key).value=mark[key];
      $('text-color').value=core.textColor(mark);
      $('start').value=core.format(mark.start_ms);$('end').value=mark.end_ms===undefined?'':core.format(mark.end_ms);
      $('loop').disabled=mark.end_ms===undefined;$('loop').textContent=loop?.id===mark.id?'停止循环':'循环区段';
      const project=global.MSWProductionProject.toProject(host.data),cues=new Set(project.subtitles?.cues.map(c=>c.id)||[]),tracks=project.subtitles?.tracks||[];
      const missing=(mark.cue_ids||[]).filter(id=>!cues.has(id)).length,track=tracks.find(t=>t.id===mark.track_id);
      $('links').textContent=mark.track_id||mark.cue_ids?.length
        ?`${mark.track_id?(track?.name||'关联轨道已删除')+' · ':''}关联 ${mark.cue_ids?.length||0} 条字幕${missing?`（${missing} 条已删除，备注保留）`:''}`:'独立时间标记';
      $('unlink').disabled=!mark.track_id&&!mark.cue_ids?.length;
    }
    $('add-range').disabled=!ranges().length;refreshOverlays();
  }
  function add(values) {
    const marks=values.map(span=>({id:crypto.randomUUID(),start_ms:span.start,...(span.end>span.start?{end_ms:span.end}:{}),name:'',note:'',color:'#e7b35a',status:'pending'}));
    selected=marks[0].id;selectionActive=true;open();if(change('添加复核标记',items=>items.push(...marks)))$('name').focus();
  }
  $('add-point').onclick=()=>add([{start:Math.round(wave.currentTimeMs())}]);
  $('add-range').onclick=()=>{if(ranges().length)add(ranges());};
  $('visible').onchange=()=>{visible=$('visible').checked;refreshOverlays();};
  for(const id of ['search','filter','kind'])$(id).addEventListener('input',refresh);
  $('edit').onsubmit=e=>e.preventDefault();
  function edit() {
    const mark=item();if(!mark)return;
    try {
      const next={...mark,name:$('name').value,note:$('note').value,color:$('color').value,text_color:$('text-color').value,status:$('status').value,start_ms:core.parse($('start').value)};
      if($('end').value.trim())next.end_ms=core.parse($('end').value);else delete next.end_ms;
      if(next.end_ms!==undefined&&next.end_ms<=next.start_ms)throw Error('结束时间必须晚于开始时间');
      stopLoop();change('编辑复核标记',items=>{items[items.findIndex(x=>x.id===selected)]=next;});
    }catch(error){message(error.message);}
  }
  for(const id of ['name','note','color','text-color','status','start','end'])$(id).addEventListener('input',()=>{draftDirty=true;});
  for(const id of ['name','note','color','text-color','status','start','end'])$(id).addEventListener('change',()=>{
    if(id==='end'&&!$('end').value.trim()) {stopLoop();change('改为时间点',items=>{delete items.find(x=>x.id===selected).end_ms;});}
    else edit();
  });
  $('jump').onclick=()=>jumpTo(item());
  $('delete').onclick=()=>{stopLoop();change('删除复核标记',items=>items.splice(items.findIndex(x=>x.id===selected),1));selected='';refresh();};
  $('link').onclick=()=>{
    const selection=host.selection(),ids=[...new Set([...(selection.mainIds||[]),...(selection.extensionIds||[]),...(selection.overlayIds||[])])];
    if(!ids.length){message('请先选择需要关联的字幕');return;}
    const project=global.MSWProductionProject.toProject(host.data),tracks=new Set(project.subtitles?.cues.filter(c=>ids.includes(c.id)).map(c=>c.track_id)||[]);
    change('关联复核字幕',items=>{const m=items.find(x=>x.id===selected);m.cue_ids=ids;if(tracks.size===1)m.track_id=[...tracks][0];else delete m.track_id;});
  };
  $('unlink').onclick=()=>change('解除复核关联',items=>{const m=items.find(x=>x.id===selected);delete m.cue_ids;delete m.track_id;});
  function stopLoop({pause=false}={}) {cancelAnimationFrame(loopFrame);loopFrame=0;loop=null;if(pause)host.pause();$('loop').textContent='循环区段';}
  function loopTick() {
    if(!loop)return;
    const now=wave.currentTimeMs();
    if(now>=loop.end_ms){host.seek(loop.start_ms/1000);if(!host.isPlaying())host.togglePlayback();}
    else if(now<loop.start_ms-100||!host.isPlaying()){stopLoop();return;}
    loopFrame=requestAnimationFrame(loopTick);
  }
  $('loop').onclick=()=>{
    if(loop){stopLoop({pause:true});return;}
    const mark=item();if(mark?.end_ms===undefined)return;
    if(mark.end_ms>wave.durationMs){message('复核区段超出可播放的媒体范围');return;}
    loop={...mark};host.seek(mark.start_ms/1000);if(!host.isPlaying())host.togglePlayback();$('loop').textContent='停止循环';
    // Media playback may start asynchronously after the seek.
    const current=loop;setTimeout(()=>{if(loop===current)loopFrame=requestAnimationFrame(loopTick);},150);
  };
  function pointInRow(time,start,end) {return time>=start&&(time<end||time===end&&end===wave.durationMs);}
  function renderGuides(row,start,end) {
    row.querySelector('.msw-review-guides')?.remove();
    if(!visible||!selectionActive||end<=start)return;
    const mark=drag?.id===selected?drag.preview:item();if(!mark)return;
    const guides=document.createElement('div');guides.className='msw-review-guides';guides.setAttribute('aria-hidden','true');
    guides.style.setProperty('--review-color',mark.color);
    const times=[];
    if(pointInRow(mark.start_ms,start,end))times.push(mark.start_ms);
    if(mark.end_ms!==undefined&&mark.end_ms>start&&mark.end_ms<=end)times.push(mark.end_ms);
    for(const time of times) {
      const line=document.createElement('span');line.className='msw-review-guide';line.style.left=`${(time-start)/(end-start)*100}%`;guides.append(line);
    }
    if(times.length)row.append(guides);
  }
  function updateMarkerSelection() {
    wave.renderedRows.forEach(row=>{
      row.querySelectorAll('.msw-review-flag').forEach(button=>{
        const active=selectionActive&&button.dataset.reviewId===selected;
        button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));
      });
      renderGuides(row,Number(row.dataset.startMs),Number(row.dataset.endMs));
    });
  }
  // Retain the inspector target for "link selected subtitles", but show guides
  // only while the user is working with a review marker, not editing a cue.
  function updateSelectionFocus(event) {
    const target=event.target;if(!(target instanceof Element)||target.closest('.msw-review-flag'))return;
    const active=Boolean(selected&&root.contains(target));
    if(selectionActive!==active){selectionActive=active;updateMarkerSelection();}
  }
  global.addEventListener('pointerdown',updateSelectionFocus,true);
  global.addEventListener('focusin',updateSelectionFocus,true);
  function renderRow(row,start,end) {
    row.querySelector('.msw-review-layer')?.remove();renderGuides(row,start,end);row.classList.remove('has-review-markers');
    if(!visible||end<=start)return;
    const layer=document.createElement('div');layer.className='msw-review-layer';
    for(const original of core.sorted(state())) {
      const mark=drag?.id===original.id?drag.preview:original,isPoint=mark.end_ms===undefined,finish=mark.end_ms??mark.start_ms;
      if(isPoint?!pointInRow(mark.start_ms,start,end):mark.start_ms>=end||finish<=start)continue;
      const button=document.createElement('button');button.type='button';button.className='msw-review-flag';button.dataset.reviewId=mark.id;
      button.style.setProperty('--review-color',mark.color);button.style.left=`${Math.max(0,(mark.start_ms-start)/(end-start)*100)}%`;
      button.style.setProperty('--review-text-color',core.textColor(mark));
      button.classList.add(isPoint?'point':'range');
      if(!isPoint)button.style.width=`${(Math.min(finish,end)-Math.max(mark.start_ms,start))/(end-start)*100}%`;
      button.classList.toggle('resolved',mark.status==='resolved');button.classList.toggle('selected',selectionActive&&mark.id===selected);
      button.setAttribute('aria-pressed',String(selectionActive&&mark.id===selected));
      button.title=`${mark.status==='resolved'?'已解决':'待处理'} · ${mark.name||'未命名'}\n${core.format(mark.start_ms)}${mark.end_ms===undefined?'':` → ${core.format(mark.end_ms)}`}\n${mark.note}`;
      button.setAttribute('aria-label',button.title);
      const label=document.createElement('span');label.className='msw-review-label';label.setAttribute('data-i18n-skip','');
      if(isPoint||!mark.name) {
        label.classList.add('is-icon');
        label.innerHTML='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1h1v1c2-2 4 2 7 0v6c-3 2-5-2-7 0v3H2z"/></svg>';
      } else label.textContent=mark.name;
      button.append(label);
      if(mark.end_ms!==undefined)for(const edge of ['start','end']) {
        if(edge==='start'&&mark.start_ms<start||edge==='end'&&mark.end_ms>end)continue;
        const handle=document.createElement('span');handle.className='msw-review-edge '+edge;handle.dataset.edge=edge;button.append(handle);
      }
      button.onpointerdown=e=>beginDrag(e,mark,row);button.onclick=e=>{e.stopPropagation();if(e.detail===0)select(mark.id);};button.ondblclick=e=>{e.stopPropagation();select(mark.id,{jump:true});};
      layer.append(button);
    }
    if(layer.childElementCount){row.classList.add('has-review-markers');row.append(layer);}
  }
  function beginDrag(event,mark,row) {
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();stopLoop();
    drag={id:mark.id,original:{...mark},preview:{...mark},edge:event.target.dataset.edge||'move',start:wave.timeFromPointer(event,row),x:event.clientX,y:event.clientY,moved:false,generation:host.generation};
    wave.cancelHoverSeekPreview();selected=mark.id;selectionActive=true;updateMarkerSelection();
  }
  global.addEventListener('pointermove',event=>{
    if(!drag)return;event.preventDefault();event.stopImmediatePropagation();
    if(Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<3&&!drag.moved)return;
    const time=Math.round(wave.timeAtViewportPoint(event.clientX,event.clientY));if(!Number.isFinite(time))return;
    const {original,edge}=drag,next={...original},limit=Math.max(wave.durationMs,original.end_ms??original.start_ms);
    if(edge==='start')next.start_ms=Math.max(0,Math.min(original.end_ms-1,time));
    else if(edge==='end')next.end_ms=Math.max(original.start_ms+1,Math.min(limit,time));
    else {const delta=Math.max(-original.start_ms,Math.min(limit-(original.end_ms??original.start_ms),Math.round(time-drag.start)));next.start_ms+=delta;if(next.end_ms!==undefined)next.end_ms+=delta;}
    drag.preview=next;drag.moved=true;refreshOverlays();
  },true);
  function finish(cancel=false) {if(!drag)return;const old=drag;drag=null;if(!cancel&&old.moved&&old.generation===host.generation)change('移动复核标记',items=>Object.assign(items.find(x=>x.id===old.id),old.preview));else refreshOverlays();if(!cancel)select(old.id);}
  global.addEventListener('pointerup',()=>finish(),true);
  global.addEventListener('pointercancel',()=>finish(true),true);
  global.addEventListener('blur',()=>{finish(true);stopLoop();});
  global.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    if(drag||loop){e.preventDefault();e.stopImmediatePropagation();finish(true);stopLoop({pause:true});}
    else if(selectionActive){selectionActive=false;updateMarkerSelection();}
  },true);
  global.addEventListener('msw:project-changed',()=>{finish(true);stopLoop();checked.clear();selected='';selectionActive=false;refresh();});
  global.addEventListener('msw:reviews-changed',()=>{stopLoop();refresh();});
  global.addEventListener('msw:range-changed',()=>{
    $('add-range').disabled=!ranges().length;
    // The range tool captures pointer events before ordinary selection handlers.
    if(selectionActive){selectionActive=false;updateMarkerSelection();}
  });
  global.addEventListener('msw:subtitles-changed',()=>{if(!draftDirty&&root.getClientRects().length)refresh();});
  global.MSWE.register('reviews',()=>({open,renderRow,commitEdit(){if(draftDirty){edit();if($('message').textContent)throw Error($('message').textContent);draftDirty=false;}},get dragging(){return Boolean(drag);}}));
  refresh();
})(window);
