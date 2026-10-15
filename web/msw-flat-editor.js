// Explicit v4 editing trial. DATA is only a disposable waveform view; History
// owns the document, and no v3 processing or persistence endpoint receives it.
(function(global) {
  'use strict';
  const $=id=>document.getElementById(id), copy=value=>structuredClone(value);
  const button=(text,fn,cls='')=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.className=cls;b.onclick=fn;return b;};
  const node=(tag,cls='',text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
  const core=global.MSWFlatSubtitles,edit=global.MSWFlatEditing;
  const id=kind=>global.MSWProject.id(kind);
  let history,selection=new Set(),activeId=null,activeTrack=null,filter='',query='',pendingText=null,pendingSplit=null;
  let name='未命名工程',saved='',draftTimer=null,hover=null,tool='select',drag=null,clipboard=null;
  let panel,list,bar,message,trackSelect,search,undoButton,redoButton,draftKey,viewReady=false;
  const project=()=>history.project, cues=()=>project().subtitles.cues, tracks=()=>project().subtitles.tracks;
  const find=cueId=>edit.cue(project(),cueId), owner=c=>edit.track(project(),c.track_id);
  const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
  function report(text,error=false){message.textContent=text;message.classList.toggle('error',error);}
  function run(fn){try{return fn();}catch(error){report(error.message||String(error),true);return null;}}
  function dirty(){return history&&JSON.stringify(snapshot())!==saved;}
  function snapshot(){const next=pendingText?edit.updateText(project(),pendingText.id,pendingText.value):copy(project());const workspace=buildCurrentWorkspaceData();if(workspace)next.workspace=copy(workspace);return next;}
  function draft(){clearTimeout(draftTimer);draftTimer=setTimeout(()=>{
    try{localStorage.setItem(draftKey,JSON.stringify({name,project:snapshot()}));}
    catch(_){report('浏览器草稿空间不足，请下载工程保存修改。',true);}
  },600);}
  function flushText(){if(!pendingText)return;const pending=pendingText;pendingText=null;
    history.commit(edit.updateText(project(),pending.id,pending.value),'编辑字幕',[...selection]);
    const index=DATA.segments.findIndex(c=>c.id===pending.id);if(index>=0)Object.assign(DATA.segments[index],copy(find(pending.id).content));
    const text=list.querySelector(`[data-flat-cue="${CSS.escape(pending.id)}"] .flat-cue-text`);if(text)text.textContent=pending.value||'（空字幕）';
    for(const label of document.querySelectorAll(`.waveform-cue-block[data-idx="${index}"] .waveform-cue-label`))label.textContent=pending.value;
    draft();global.dispatchEvent(new Event('msw:flat-changed'));}
  function commit(next,label,ids=[...selection]){
    if(history.commit(next,label,[...selection])){selection=new Set(ids);activeId=ids[0]||null;pendingSplit=null;hover=null;report(label);draft();render();}
  }
  function action(label,fn,ids){return run(()=>{flushText();const result=fn();commit(result.project||result,label,result.ids||ids);return result;});}
  function feedbackPoint(cueId){const target=hover?.from==='wave'?document.querySelector(`.waveform-cue-block[data-cue-id="${CSS.escape(cueId)}"]`):list.querySelector(`[data-flat-cue="${CSS.escape(cueId)}"]`);const rect=target?.getBoundingClientRect();return rect&&rect.bottom>0&&rect.top<innerHeight?{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2}:null;}
  function step(direction){run(()=>{flushText();const ids=history.step(direction,[...selection]);if(ids){selection=new Set(ids);activeId=ids[0]||null;pendingSplit=null;hover=null;draft();report(direction==='undo'?'已撤销':'已重做');render();}});}
  function select(cueId,add=false){run(()=>{flushText();if(pendingSplit&&pendingSplit.ids.includes(cueId)){pendingSplit.active=cueId;renderPanel();return;}
    if(EDITOR_SETTINGS.cueEditorSplitAutoClose)pendingSplit=null;if(!add)selection.clear();if(add&&selection.has(cueId))selection.delete(cueId);else selection.add(cueId);
    activeId=selection.has(cueId)?cueId:[...selection][0]||null;if(find(activeId))activeTrack=find(activeId).track_id;
    syncSelection();renderPanel();updatePreview();});}
  function syncSelection(){selectedIdxs.clear();DATA.segments.forEach((c,i)=>{if(selection.has(c.id))selectedIdxs.add(i);});
    for(const card of list.querySelectorAll('[data-flat-cue]'))card.classList.toggle('selected',selection.has(card.dataset.flatCue));
    $('sel-count').textContent=String(selection.size);waveformEditor?.updateSelection();
  }
  function render(){if(!history||!list)return;
    const view=edit.editorView(project());
    // No round trip through legacy serialization: renderer callbacks see only
    // this view, while every edit and save uses stable v4 IDs above.
    Object.assign(DATA,view);fixedInvalidate();layerInvalidate();fixedActiveTrackId=activeTrack||tracks()[0].id;
    viewReady=true;
    for(const cueId of selection)if(!find(cueId))selection.delete(cueId);
    if(!tracks().some(t=>t.id===activeTrack))activeTrack=tracks()[0].id;
    if(filter&&!tracks().some(t=>t.id===filter))filter='';
    trackSelect.replaceChildren(new Option('全部轨道',''),...tracks().map(t=>new Option(t.name,t.id)));trackSelect.value=filter;
    renderList();syncSelection();waveformEditor?.renderSegments();renderPanel();updatePreview();
    undoButton.disabled=!history.undoStack.length;redoButton.disabled=!history.redoStack.length;
    $('flat-project-name').textContent=name;document.title=`${name} · 平级轨道试用`;
    global.dispatchEvent(new Event('msw:flat-changed'));
  }
  function renderList(){list.replaceChildren();const rows=[...cues()].sort((a,b)=>a.content.start-b.content.start||tracks().indexOf(owner(a))-tracks().indexOf(owner(b)));
    for(const c of rows){const t=owner(c);if(filter&&t.id!==filter||query&&!c.content.text.toLocaleLowerCase().includes(query.toLocaleLowerCase()))continue;
      const card=node('article','flat-cue');card.dataset.flatCue=c.id;card.tabIndex=0;card.classList.toggle('disabled-cue',!t.enabled||c.content.disabled||!!c.hidden);
      const header=node('header'),label=node('span','flat-cue-track',t.name+(t.locked?' · 已锁定':'')+(c.hidden?' · 已隐藏':''));
      header.append(label,node('span','flat-cue-time',`${stamp(c.content.start)} → ${stamp(c.content.end)}`));
      if(edit.partner(project(),c.id))header.append(node('span','flat-linked','已对应'));
      const text=node('div','flat-cue-text',c.content.text||'（空字幕）');if(!c.content.text)text.classList.add('empty');
      const color=c.content.color||find(c.content.color_ref?.cue_id)?.content.color;if(color?.name){label.textContent+=' · '+color.name;card.style.borderLeft=`4px solid ${colorValue(color.name)}`;}
      card.append(header,text);card.onclick=e=>select(c.id,e.ctrlKey||e.metaKey||e.shiftKey);
      card.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();select(c.id);$('flat-text')?.focus();}};
      card.oncontextmenu=e=>{stop(e);if(!selection.has(c.id))select(c.id);cueMenu(c.id,e.clientX,e.clientY);};
      card.onpointermove=e=>{if(pendingSplit||drag)return;const offset=pointerOffset(text,e,c.content.text);hover={id:c.id,time:edit.timeAt(c.content,offset),offset,from:'card'};
        card.style.setProperty('--flat-cut-x',`${e.clientX-card.getBoundingClientRect().left}px`);card.classList.add('cut-hover');updatePreview();};
      card.onpointerleave=()=>{card.classList.remove('cut-hover');if(hover?.from==='card'&&!pendingSplit){hover=null;updatePreview();}};
      list.append(card);
    }
    if(!list.children.length)list.append(node('p','flat-empty',cues().length?'此范围没有字幕':'右键轨道头可新增轨道；点击“新字幕”开始编辑。'));
  }
  function stamp(ms){const seconds=ms/1000;return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toFixed(3).padStart(6,'0')}`;}
  function pointerOffset(el,event,text){let caret=document.caretPositionFromPoint?.(event.clientX,event.clientY),range;
    if(caret){range=document.createRange();range.setStart(caret.offsetNode,caret.offset);range.collapse(true);}else range=document.caretRangeFromPoint?.(event.clientX,event.clientY);
    if(range&&el.contains(range.startContainer)){const prefix=document.createRange();prefix.selectNodeContents(el);prefix.setEnd(range.startContainer,range.startOffset);return edit.nearestOffset(text,prefix.toString().length);}
    return edit.nearestOffset(text,text.length*(event.clientX-el.getBoundingClientRect().left)/Math.max(1,el.clientWidth));
  }
  function field(label,input){const el=node('label','flat-field');el.append(node('span','',label),input);return el;}
  function number(value,change,min=0){const input=document.createElement('input');input.type='number';input.min=min;input.step='0.001';input.value=value;input.onchange=()=>run(()=>change(Number(input.value)));return input;}
  function renderPanel(){if(!panel)return;panel.replaceChildren();panel.scrollTop=0;if(pendingSplit){renderSplit();return;}
    const c=find(activeId);if(!c){panel.append(node('p','flat-empty','选择一条字幕开始编辑'));return;}
    const t=owner(c),row=node('div','flat-fields'),move=document.createElement('select');move.id='flat-cue-track';
    move.replaceChildren(...tracks().map(t=>new Option(t.name,t.id)));move.value=c.track_id;move.disabled=t.locked;
    move.onchange=()=>action('换轨',()=>core.move(project(),[...selection],move.value));
    row.append(field('轨道',move));
    for(const edge of ['start','end']){const input=number(c.content[edge]/1000,value=>action('调整字幕时间',()=>edit.updateRanges(project(),[{id:c.id,...c.content,[edge]:Math.round(value*1000)}])));input.id=`flat-${edge}`;input.disabled=t.locked;row.append(field(edge==='start'?'起点（秒）':'终点（秒）',input));}
    const text=document.createElement('textarea');text.id='flat-text';text.value=c.content.text;text.disabled=t.locked;text.setAttribute('aria-label','字幕正文');text.spellcheck=false;
    text.oninput=()=>{pendingText={id:c.id,value:text.value};draft();};text.onblur=()=>run(()=>{flushText();undoButton.disabled=!history.undoStack.length;});
    const actions=node('div','flat-actions');actions.append(button('切分',()=>{const offset=text.selectionStart;run(()=>{flushText();requestSplit(c.id,edit.timeAt(find(c.id).content,offset),{positions:{[c.id]:offset}});});}),button(c.content.disabled?'启用字幕':'禁用字幕',()=>action('切换字幕状态',()=>edit.setDisabled(project(),[...selection],!c.content.disabled))));
    if(t.locked)for(const b of actions.querySelectorAll('button'))b.disabled=true;
    const info=node('span','flat-info');MSWHelp.attach(info,'调整时间会联动对应字幕并保留时间差；换轨只移动选中字幕。修改正文会清除本条旧的逐词时间码，避免错误对齐。');actions.append(info);
    const other=edit.partner(project(),c.id);if(other){const linked=button(`对应：${owner(other).name}`,()=>select(other.id),'flat-partner');linked.title=other.content.text;actions.append(linked);}
    panel.append(row,text,actions);
  }
  function requestSplit(cueId,time,{quick=false,independent=false,positions={}}={}){run(()=>{flushText();const c=find(cueId),other=edit.partner(project(),cueId);if(!c)throw Error('请先选择字幕');
    const members=other&&!independent?[c,other]:[c],low=Math.max(...members.map(c=>c.content.start))+1,high=Math.min(...members.map(c=>c.content.end))-1;
    if(low>high||time<low||time>high)throw Error('切分点须在参与字幕的共同时间范围内；请移动波形指针后重试。');
    if(quick||independent||!other){const point=feedbackPoint(cueId),result=action(independent?'单切并解绑':'切分字幕',()=>edit.split(project(),cueId,time,{independent,positions,makeId:id}));if(result)triggerNinjaSplitFeedback(point);return;}
    pendingSplit={ids:members.map(c=>c.id),active:cueId,time:Math.round(time),positions:Object.fromEntries(members.map(c=>[c.id,positions[c.id]??edit.offsetAt(c.content,time)]))};renderPanel();updatePreview();
  });}
  function renderSplit(){const header=node('div','flat-actions');header.append(node('strong','','联动切分'));const input=number(pendingSplit.time/1000,v=>setSplitTime(v*1000));input.id='flat-split-time';header.append(field('切分时间（秒）',input));const help=node('span');MSWHelp.attach(help,'点击文字或用左右键调整分界，上下键切换操作对象；拖动波形虚线调整共同切分时间。Enter 确认，Esc 取消。Shift+B 单切当前高亮字幕并解绑。');header.append(help);panel.append(header);
    for(const cueId of pendingSplit.ids){const c=find(cueId),row=node('div','flat-split-row');row.dataset.flatSplitCue=cueId;row.tabIndex=0;row.classList.toggle('active',pendingSplit.active===cueId);
      const label=node('span','',owner(c).name),text=node('span','flat-split-text'),at=pendingSplit.positions[cueId];text.append(node('span','',c.content.text.slice(0,at)),node('span','flat-split-tail',c.content.text.slice(at)));
      row.append(label,text);row.onclick=e=>{pendingSplit.active=cueId;pendingSplit.positions[cueId]=pointerOffset(text,e,c.content.text);renderPanel();panel.querySelector(`[data-flat-split-cue="${CSS.escape(cueId)}"]`)?.focus();};row.onfocus=()=>{pendingSplit.active=cueId;for(const r of panel.querySelectorAll('.flat-split-row'))r.classList.toggle('active',r===row);};panel.append(row);
    }
    const actions=node('div','flat-actions');actions.append(button('取消',cancelSplit));
    if(EDITOR_SETTINGS.cueEditorSplitMoreActions)actions.append(button('保留两侧原文',()=>confirmSplit({keepText:true})),button('单切当前并解绑',()=>confirmSplit({independent:true})));
    actions.append(button('确认切分',()=>confirmSplit(),'primary'));panel.append(actions);
  }
  function setSplitTime(time){if(!pendingSplit)return;const members=pendingSplit.ids.map(find),min=Math.max(...members.map(c=>c.content.start))+1,max=Math.min(...members.map(c=>c.content.end))-1;
    pendingSplit.time=Math.round(Math.max(min,Math.min(max,time)));for(const c of members)pendingSplit.positions[c.id]=edit.offsetAt(c.content,pendingSplit.time);renderPanel();updatePreview();}
  function cancelSplit(){pendingSplit=null;renderPanel();updatePreview();}
  function confirmSplit(options={}){if(!pendingSplit)return;const split=pendingSplit,point=feedbackPoint(split.active);const result=action(options.independent?'单切并解绑':'联动切分',()=>edit.split(project(),split.active,split.time,{positions:split.positions,...options,makeId:id}));if(result)triggerNinjaSplitFeedback(point);}
  function updatePreview(){waveformEditor?.setSplitPreview(pendingSplit?.time??hover?.time??null,{draggable:!!pendingSplit});}
  function merge(mode='union'){const point=activeId?feedbackPoint(activeId):null;const result=action(mode==='common'?'最小状态合并':'累加状态合并',()=>{
    const c=find(activeId);if(!c)throw Error('请先选择同轨道的字幕');
    const ids=[...selection].filter(cueId=>find(cueId)?.track_id===c.track_id);
    const result=edit.merge(project(),ids,{mode,makeId:id,joinText:(rows,trackId)=>{const t=edit.track(project(),trackId),splitMode=getExtensionSubtitleSplitMode(t,{text:rows.map(c=>c.text).join('\n')});return AsrEditorUtils.joinSegmentTexts(rows,mergeJoinSeparatorForMode(splitMode));}});
    // Other selected tracks must consist only of these captions' partners.
    const allowed=new Set(ids.flatMap(cueId=>[cueId,edit.partner(project(),cueId)?.id]));
    if([...selection].some(cueId=>!allowed.has(cueId)))throw Error('选区包含无对应关系的其他轨道，请分别合并');
    return result;
  });if(result){if(point)triggerMergeFeedback([point]);if(result.conflicts.length)report('已合并；不同标记按当前合并规则处理，请检查颜色和表情包。');}}
  function binding(unlink=false){action(unlink?'解除对应':'建立对应',()=>{
    if(unlink){let next=project();const links=new Set([...selection].map(cueId=>edit.relation(next,cueId)?.id).filter(Boolean));if(!links.size)throw Error('选中字幕没有对应关系');for(const link of links)next=core.unbind(next,link);return next;}
    const ids=[...selection];if(ids.length!==2)throw Error('请选择不同轨道的两条字幕');return core.bind(project(),ids[0],ids[1],id('binding'));
  });}
  function menuItem(text,fn,disabled=false){fixedMenuItem(text,()=>run(fn),disabled);}
  function cueMenu(cueId,x,y){ctxmenu.replaceChildren();const c=find(cueId),locked=owner(c).locked;
    menuItem('切分　B',()=>requestSplit(cueId,hover?.id===cueId?hover.time:player.currentTime*1000),locked);
    menuItem('快速联动切分　Ctrl+B',()=>requestSplit(cueId,hover?.id===cueId?hover.time:player.currentTime*1000,{quick:true}),locked);
    menuItem('单切并解绑　Shift+B',()=>requestSplit(cueId,hover?.id===cueId?hover.time:player.currentTime*1000,{independent:true}),locked);
    menuItem('累加状态合并　C',()=>merge(),locked);menuItem('最小状态合并　Ctrl+Shift+C',()=>merge('common'),locked);
    menuItem('建立对应　G',()=>binding(),locked);menuItem('解除对应　Shift+G',()=>binding(true),locked);
    menuItem(c.content.disabled?'启用字幕':'禁用字幕',()=>action('切换字幕状态',()=>edit.setDisabled(project(),[...selection],!c.content.disabled)),locked);
    menuItem('颜色标记…',()=>{ctxmenu.replaceChildren();for(const color of COLOR_PALETTE)menuItem(color.label||color.name,()=>action('颜色标记',()=>edit.setColor(project(),[...selection],color.name)));menuItem('清除颜色',()=>action('清除颜色',()=>edit.setColor(project(),[...selection],null)));ctxShowAt(x,y);},locked);
    menuItem('移动到轨道…',()=>moveMenu(x,y),locked);menuItem('删除字幕　Delete',()=>action('删除字幕',()=>edit.remove(project(),[...selection]),[]),locked);ctxShowAt(x,y);
  }
  function moveMenu(x,y){ctxmenu.replaceChildren();for(const t of tracks())menuItem(t.name,()=>action('换轨',()=>core.move(project(),[...selection],t.id)),t.locked);ctxShowAt(x,y);}
  function addTrack(){action('新增轨道',()=>{const trackId=id('track');activeTrack=trackId;return core.addTrack(project(),{id:trackId,name:`字幕 ${tracks().length+1}`,purpose:'none',layout:'auto',enabled:true,locked:false,collapsed:false,style:{mode:'inherit',slot:'main',base:'dialogue'}});});}
  function trackMenu(trackId,x,y){const t=edit.track(project(),trackId);if(!t)return;activeTrack=trackId;ctxmenu.replaceChildren();
    menuItem('轨道设置…',()=>trackForm(t,x,y));menuItem(t.enabled?'禁用轨道':'启用轨道',()=>action('切换轨道状态',()=>edit.updateTrack(project(),t.id,{enabled:!t.enabled})));
    menuItem(t.locked?'解锁轨道':'锁定轨道',()=>action('切换轨道锁定',()=>edit.updateTrack(project(),t.id,{locked:!t.locked})));
    menuItem(t.collapsed?'展开轨道':'折叠轨道',()=>action('切换轨道折叠',()=>edit.updateTrack(project(),t.id,{collapsed:!t.collapsed})));
    menuItem('新增字幕',()=>newCue(),t.locked);menuItem('新增轨道',addTrack);
    const index=tracks().indexOf(t);menuItem('上移轨道',()=>action('调整轨道顺序',()=>edit.reorder(project(),t.id,-1)),index===0);menuItem('下移轨道',()=>action('调整轨道顺序',()=>edit.reorder(project(),t.id,1)),index===tracks().length-1);
    menuItem('删除空轨道',()=>action('删除空轨道',()=>edit.deleteTrack(project(),t.id)),t.locked||tracks().length===1||cues().some(c=>c.track_id===t.id));ctxShowAt(x,y);
  }
  function trackForm(t,x,y){ctxmenu.replaceChildren();const form=node('form','fixed-track-form'),nameInput=document.createElement('input');nameInput.value=t.name;nameInput.maxLength=160;nameInput.setAttribute('aria-label','轨道名称');
    const purpose=document.createElement('select');purpose.setAttribute('aria-label','轨道用途');for(const [value,label] of [['none','未指定'],['source','源字幕'],['translation','译字幕'],['dialogue','对白'],['annotation','画面文字']])purpose.add(new Option(label,value));purpose.value=t.purpose;
    const layout=document.createElement('select');layout.setAttribute('aria-label','排布');layout.add(new Option('自动排布','auto'));layout.add(new Option('固定位置','fixed'));layout.value=t.layout;layout.disabled=t.locked;
    form.append(field('名称',nameInput),field('用途',purpose),field('排布',layout),node('small','flat-note','用途不限制编辑操作；在“字幕样式”中调整该轨道的画面样式。'));
    const apply=button('完成',()=>{});apply.type='submit';form.append(apply);form.onsubmit=e=>{e.preventDefault();const patch={name:nameInput.value.trim(),purpose:purpose.value};if(!t.locked)patch.layout=layout.value;const result=action('编辑轨道',()=>edit.updateTrack(project(),t.id,patch));if(result)ctxmenu.classList.remove('show');};
    form.onpointerdown=e=>e.stopPropagation();form.onclick=e=>e.stopPropagation();ctxmenu.append(form);ctxShowAt(x,y);nameInput.focus();
  }
  function renderHeads(group,row,audioSpace){if(!viewReady)return false;for(const band of fixedLayout().bands){const t=edit.track(project(),band.track.id);if(!t)continue;
    const head=node('div','fixed-track-head');head.dataset.subtitleTrackId=t.id;head.style.bottom=`${7+audioSpace+band.bottom*38}px`;head.style.height=`${band.size*38-4}px`;head.classList.toggle('disabled-track',!t.enabled);head.classList.toggle('current',t.id===activeTrack);
    const toggle=button(t.name,()=>action('切换轨道状态',()=>edit.updateTrack(project(),t.id,{enabled:!t.enabled})),'fixed-track-toggle');toggle.title=`${t.name}${t.locked?' · 已锁定':''}；点击启停，右键管理`;toggle.setAttribute('aria-label',t.name);toggle.setAttribute('aria-pressed',String(t.enabled));head.append(toggle);if(t.locked)head.append(node('span','fixed-track-lock','锁'));
    for(const type of ['pointerdown','pointerup','click','dblclick'])head.addEventListener(type,e=>e.stopPropagation());head.oncontextmenu=e=>{stop(e);trackMenu(t.id,e.clientX,e.clientY);};head.onkeydown=e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){stop(e);const rect=head.getBoundingClientRect();trackMenu(t.id,rect.right,rect.bottom);}};group.append(head);
  }return true;}
  function newCue(time=hover?.time??player.currentTime*1000){const start=Math.max(0,Math.round(time)),trackId=filter||activeTrack||tracks()[0].id;
    action('新增字幕',()=>{const next=cues().filter(c=>c.track_id===trackId&&c.content.start>start).sort((a,b)=>a.content.start-b.content.start)[0];const cueId=id('cue');return {project:edit.addCue(project(),trackId,cueId,start,Math.min(start+2000,next?.content.start??Infinity),''),ids:[cueId]};});$('flat-text')?.focus();}
  function waveId(target){const block=target.closest('.waveform-cue-block');return block?DATA.segments[Number(block.dataset.idx)]?.id:null;}
  function waveTime(e,row){return Math.round(waveformEditor.timeFromPointer(e,row));}
  function pointerDown(e){if(!history||e.button!==0)return;const block=e.target.closest('.waveform-cue-block'),row=e.target.closest('.waveform-row');if(!row)return;
    if(e.target.closest('.waveform-split-preview'))return;
    if(!block){stop(e);const time=waveTime(e,row);hover={time,from:'wave'};if(e.ctrlKey||e.metaKey){newCue(time);}else if(!e.altKey){seekFromWaveform(time/1000);if(!e.shiftKey){selection.clear();activeId=null;syncSelection();renderPanel();}}return;}
    stop(e);const cueId=waveId(block),c=find(cueId);if(!c)return;const time=waveTime(e,row);hover={id:cueId,time,from:'wave'};
    if(tool==='razor'){requestSplit(cueId,time,{quick:e.ctrlKey||e.metaKey,independent:e.shiftKey});return;}
    if(e.altKey){action('切换字幕状态',()=>edit.setDisabled(project(),[cueId],!c.content.disabled));return;}
    if(!selection.has(cueId)||e.ctrlKey||e.metaKey||e.shiftKey)select(cueId,e.ctrlKey||e.metaKey||e.shiftKey);else{activeId=cueId;activeTrack=c.track_id;renderPanel();}
    if(owner(c).locked||e.ctrlKey||e.metaKey||e.shiftKey)return;
    const edge=e.target.closest('.waveform-cue-handle'),kind=edge?(edge.classList.contains('left')?'start':'end'):'move';
    const original=copy(project()),ids=kind==='move'?[...selection]:[cueId];drag={pointer:e.pointerId,origin:time,row,kind,ids,original,next:null,moved:false,x:e.clientX,y:e.clientY};
  }
  function pointerMove(e){if(drag){if(e.pointerId!==drag.pointer)return;stop(e);const hit=document.elementFromPoint(e.clientX,e.clientY)?.closest('.waveform-row');if(hit)drag.row=hit;
    if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<3&&!drag.moved)return;drag.moved=true;
    let delta=waveTime(e,drag.row)-drag.origin;const members=drag.ids.map(cueId=>edit.cue(drag.original,cueId));
    const edges=cues().filter(c=>!drag.ids.includes(c.id)&&!members.some(a=>edit.partner(drag.original,a.id)?.id===c.id)).flatMap(c=>[c.content.start,c.content.end]);
    const tolerance=(Number(drag.row.dataset.endMs)-Number(drag.row.dataset.startMs))*6/Math.max(1,drag.row.clientWidth);
    if(!e.altKey){let nearest=tolerance,adjustment=0;for(const c of members)for(const edge of drag.kind==='move'?['start','end']:[drag.kind])for(const target of edges){const distance=target-(c.content[edge]+delta);if(Math.abs(distance)<nearest){adjustment=distance;nearest=Math.abs(distance);}}delta+=adjustment;}
    const changes=members.map(c=>({id:c.id,start:c.content.start+(drag.kind==='end'?0:delta),end:c.content.end+(drag.kind==='start'?0:delta)}));
    try{drag.next=edit.updateRanges(drag.original,changes);const view=edit.editorView(drag.next);DATA.segments=view.segments;fixedInvalidate();layerInvalidate();waveformEditor.refreshCueOverlay();report(`调整至 ${stamp(changes[0].start)} → ${stamp(changes[0].end)}`);}
    catch(error){drag.next=null;report(error.message,true);}return;
  }
    const row=e.target.closest('.waveform-row');if(row&&!pendingSplit){hover={id:waveId(e.target),time:waveTime(e,row),from:'wave'};updatePreview();}
  }
  function finishDrag(cancel=false){if(!drag)return;const done=drag;drag=null;if(!cancel&&done.moved&&done.next)commit(done.next,'调整字幕时间');else render();}
  function copySelection(){clipboard={cues:[...selection].map(cueId=>copy(find(cueId))).filter(Boolean),bindings:copy(project().subtitles.bindings.filter(b=>selection.has(b.source_id)&&selection.has(b.target_id)))};
    for(const c of clipboard.cues)for(const field of ['color','sticker'])if(c.content[field+'_ref']){c.content[field]=copy(find(c.content[field+'_ref'].cue_id).content[field]);delete c.content[field+'_ref'];}
    report(`已复制 ${clipboard.cues.length} 条字幕`);}
  function pasteSelection(){if(!clipboard?.cues.length)return;action('粘贴字幕',()=>{
    const start=Math.max(0,Math.round(hover?.time??player.currentTime*1000)),origin=Math.min(...clipboard.cues.map(c=>c.content.start)),mapping=new Map(clipboard.cues.map(c=>[c.id,id('cue')]));
    const target=filter||activeTrack;const sameTrack=new Set(clipboard.cues.map(c=>c.track_id)).size===1;
    return {project:edit.transaction(project(),next=>{for(const copied of clipboard.cues){const c=copy(copied),t=sameTrack?target:c.track_id;if(!edit.track(next,t)||edit.track(next,t).locked)throw Error('粘贴目标轨道不存在或已锁定');
      c.id=mapping.get(copied.id);c.track_id=t;const delta=start-origin;c.content.start+=delta;c.content.end+=delta;for(const item of c.content.items||[]){item.start+=delta;item.end+=delta;}
      for(const f of ['color','sticker']){const ref=c.content[f+'_ref'];if(ref){const value=clipboard.cues.find(c=>c.id===ref.cue_id)?.content[f]||find(ref.cue_id)?.content[f];delete c.content[f+'_ref'];if(value)c.content[f]=copy(value);}if(c.content[f]){c.content[f].start=c.content.start;c.content[f].end=c.content.end;}}
      edit.frame(next,c.content);next.subtitles.cues.push(c);
    }for(const binding of clipboard.bindings)next.subtitles.bindings.push({...binding,id:id('binding'),source_id:mapping.get(binding.source_id),target_id:mapping.get(binding.target_id)});
    }),ids:[...mapping.values()]};
  });}
  function keydown(e){if(!history)return;const editable=e.target.closest('input,textarea,select,[contenteditable="true"]'),mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    // Prevent the old role-based shortcut handlers from mutating the view.
    // Let native input/clipboard/focus behavior run inside editable fields.
    e.stopImmediatePropagation();
    if(mod&&(key==='c'||key==='x')&&global.getSelection()?.toString())return;
    if(e.target.closest('.flat-processing-panel')){if(e.key==='Escape'){e.preventDefault();e.target.closest('dialog')?.close();}return;}
    if(drag&&e.key==='Escape'){e.preventDefault();finishDrag(true);return;}
    if(waveformEditor?.splitPreviewDrag&&e.key==='Escape'){e.preventDefault();waveformEditor.splitPreviewDrag.finish(true);return;}
    if(mod&&key==='s'){e.preventDefault();save();return;}
    if(editable){if(key==='escape'){e.target.blur();}return;}
    if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){const head=e.target.closest('.fixed-track-head'),card=e.target.closest('[data-flat-cue]'),rect=(head||card)?.getBoundingClientRect();if(rect){e.preventDefault();if(head)trackMenu(head.dataset.subtitleTrackId,rect.right,rect.bottom);else{select(card.dataset.flatCue);cueMenu(card.dataset.flatCue,rect.right,rect.bottom);}}return;}
    if(e.key==='Enter'&&e.target.closest('button'))return;
    if(pendingSplit){if(e.key==='Escape'){e.preventDefault();cancelSplit();return;}if(e.key==='Enter'){e.preventDefault();confirmSplit();return;}
      if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();pendingSplit.active=pendingSplit.ids.find(cueId=>cueId!==pendingSplit.active);renderPanel();panel.querySelector('.flat-split-row.active')?.focus();return;}
      if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const c=find(pendingSplit.active),at=pendingSplit.positions[c.id],dir=e.key==='ArrowLeft'?-1:1;let value=at+dir;while(value>=0&&value<=c.content.text.length&&edit.nearestOffset(c.content.text,value)===at)value+=dir;pendingSplit.positions[c.id]=edit.nearestOffset(c.content.text,Math.max(0,Math.min(c.content.text.length,value)));renderPanel();return;}
      if(key==='b'&&e.shiftKey){e.preventDefault();confirmSplit({independent:true});return;}
    }
    if(mod&&key==='z'){e.preventDefault();step(e.shiftKey?'redo':'undo');return;}if(mod&&key==='y'){e.preventDefault();step('redo');return;}
    if(mod&&key==='c'&&!e.shiftKey){if(selection.size){e.preventDefault();copySelection();}return;}
    if(mod&&key==='v'){e.preventDefault();pasteSelection();return;}
    if(mod&&key==='a'){e.preventDefault();selection=new Set(cues().filter(c=>!filter||c.track_id===filter).map(c=>c.id));activeId=[...selection][0];syncSelection();renderPanel();return;}
    if(e.key==='Enter'&&e.target.closest('[data-flat-cue]')){e.preventDefault();select(e.target.closest('[data-flat-cue]').dataset.flatCue);$('flat-text')?.focus();return;}
    if(key==='b'){e.preventDefault();const cueId=hover?.id||activeId;requestSplit(cueId,hover?.time??player.currentTime*1000,{quick:mod,independent:e.shiftKey,positions:hover?.from==='card'?{[cueId]:hover.offset}:{}});}
    else if(key==='c'&&!e.altKey){e.preventDefault();merge(mod&&e.shiftKey?'common':'union');}
    else if(key==='g'){e.preventDefault();binding(e.shiftKey);}
    else if(key==='delete'||key==='backspace'){e.preventDefault();action('删除字幕',()=>edit.remove(project(),[...selection]),[]);}
    else if(key==='n'){e.preventDefault();newCue();}
    else if(/^[0-5]$/.test(key)){e.preventDefault();action('颜色标记',()=>edit.setColor(project(),[...selection],key==='0'?null:COLOR_PALETTE[Number(key)-1]?.name));}
    else if(key===' '){e.preventDefault();togglePlayback();}
    else if(key==='r'||key==='v'){e.preventDefault();setTool(key==='r'?'razor':'select');}
    else if(key==='escape'){MSWHelp.close();cancelSplit();setTool('select');ctxmenu.classList.remove('show');}
  }
  function setTool(value){tool=value;for(const b of document.querySelectorAll('[data-waveform-tool]'))b.classList.toggle('active',b.dataset.waveformTool===tool);}
  function preferences(anchor){ctxmenu.replaceChildren();const form=node('div','fixed-track-form flat-preferences');
    for(const [key,label] of [['cueEditorSplitMoreActions','联动切分：更多操作'],['cueEditorSplitAutoClose','选择其他字幕时关闭确认区']]){const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=EDITOR_SETTINGS[key];checkbox.onchange=()=>{updateEditorSettings({[key]:checkbox.checked});if(pendingSplit)renderPanel();};const row=node('label');row.append(checkbox,node('span','',label));form.append(row);}
    form.append(button('恢复默认布局',()=>{waveformEditor?.setLayout('wave-right');ctxmenu.classList.remove('show');}));
    form.onpointerdown=e=>e.stopPropagation();form.onclick=e=>e.stopPropagation();ctxmenu.append(form);const rect=anchor.getBoundingClientRect();ctxShowAt(rect.left,rect.bottom);
  }
  async function save(){try{flushText();const p=snapshot();core.validate(p);const blob=new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');
    a.href=url;a.download=`${name.replace(/(?:\.flat)?\.(?:mosp|json)$/i,'')}.flat.mosp`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);saved=JSON.stringify(p);draft();report('已下载平级轨道工程；原工程未覆盖。');return true;
  }catch(error){report(error.message,true);return false;}}
  function load(input,fileName='未命名工程'){let next;try{next=core.migrate(copy(input));core.validate(next);}catch(error){throw Error(`无法打开工程：${error.message}。请确认文件为支持的字幕工程；当前修改已保留。`);}
    if(history)resetLoadedMedia();mswProjectGeneration++;
    MSWProject.ensure(next);history=new edit.History(next);pendingText=null;pendingSplit=null;selection.clear();activeId=null;activeTrack=next.subtitles.tracks[0].id;filter='';name=fileName;
    if(next.workspace)waveformEditor?.setLayoutData(next.workspace,{render:false});
    render();waveformEditor?.setPayload(next.waveform||null);saved=JSON.stringify(snapshot());report('已载入平级轨道工程。');draft();global.dispatchEvent(new Event('msw:flat-loaded'));}
  function allowReplace(){return !dirty()||confirm('当前有未下载保存的修改，仍要打开其他工程吗？');}
  function setup(){
    if(!global.MSWFlatTrialRequested&&productionFlatMode())return;
    const entry=button('平级轨道试用',()=>{try{const url=new URL(location.href),token=id('handoff'),source=MSWE.resolve('persistence-host').draftSnapshot();
      localStorage.setItem(`msw.flat-handoff:${token}`,JSON.stringify({project:source,name:FILENAME_BASE}));url.searchParams.set('flat-subtitles','1');url.searchParams.set('flat-import',token);url.searchParams.delete('flat-draft');global.open(url.href,'_blank','noopener');
    }catch(error){flashHint(`无法创建试用副本：${error.message}。请先下载工程，再从试用窗口打开。`,'warning');}},'dropdown-item');entry.id='flat-trial-entry';entry.role='menuitem';$('open-project')?.after(entry);
    if(!global.MSWFlatTrialRequested)return;
    const url=new URL(location.href),session=url.searchParams.get('flat-draft')||id('draft'),handoff=url.searchParams.get('flat-import');url.searchParams.set('flat-draft',session);url.searchParams.delete('flat-import');global.history.replaceState(null,'',url);draftKey=`msw.flat-draft.v1:${session}`;
    let transferred=null;if(handoff)try{transferred=JSON.parse(localStorage.getItem(`msw.flat-handoff:${handoff}`)||'null');localStorage.removeItem(`msw.flat-handoff:${handoff}`);}catch(_){}
    let recovery=null;try{recovery=JSON.parse(localStorage.getItem(draftKey)||'null');}catch(_){}
    bar=node('div','flat-trial-bar');bar.id='flat-trial-bar';const title=node('strong','','平级轨道试用'),projectName=node('span','flat-project-name');projectName.id='flat-project-name';
    const openInput=document.createElement('input');openInput.type='file';openInput.accept='.mosp,.json';openInput.id='flat-open-file';openInput.hidden=true;openInput.onchange=async()=>{const f=openInput.files[0];openInput.value='';if(f&&allowReplace()){try{load(JSON.parse(await f.text()),f.name);}catch(error){report(error.message,true);}}};
    const mediaInput=document.createElement('input');mediaInput.type='file';mediaInput.accept='audio/*,video/*,.mkv';mediaInput.id='flat-media-file';mediaInput.hidden=true;mediaInput.onchange=async()=>{const f=mediaInput.files[0];mediaInput.value='';if(!f)return;
      try{const result=await loadMediaFile(f,{localOnly:true,previewOnly:true});if(result){global.dispatchEvent(new Event('msw:flat-audition'));await waveformEditor?.processFile(f);report(`试听媒体：${f.name}（工程素材引用保持不变）`);}}catch(error){report(error.message,true);}};
    undoButton=button('撤销',()=>step('undo'));undoButton.id='flat-undo';redoButton=button('重做',()=>step('redo'));redoButton.id='flat-redo';
    const settings=button('编辑设置',e=>preferences(e.currentTarget));
    bar.append(title,button('打开工程',()=>openInput.click()),button('下载工程',save),button('试听媒体',()=>mediaInput.click()),undoButton,redoButton,settings,projectName,openInput,mediaInput);
    const help=node('span');MSWHelp.attach(help,'试用范围：平级轨道编辑、对应关系、切分合并、撤销及 v4 工程下载。使用“字幕处理”发起识别、翻译、配音；“字幕样式”调整画面及导出 ASS。B 联动确认，Ctrl+B 快速切分，Shift+B 单切解绑；C 累加合并，Ctrl+Shift+C 最小合并；Ctrl+C/V 复制粘贴，G/Shift+G 建立/解除对应，N 新字幕。');bar.append(help);
    const normal=button('返回普通编辑器',()=>{const normalURL=new URL(location.href);normalURL.searchParams.delete('flat-subtitles');normalURL.searchParams.delete('flat-draft');global.open(normalURL.href,'_blank','noopener');});bar.append(normal);$('menubar').after(bar);
    message=node('div','flat-message');message.id='flat-message';message.role='status';bar.after(message);
    panel=node('div','flat-cue-editor');panel.id='flat-cue-editor';for(const child of $('current-cue-panel').children)if(!child.classList.contains('module-tab-strip'))child.classList.add('flat-legacy-panel');$('current-cue-panel').append(panel);
    const holder=$('cues-container');for(const child of holder.children)if(!child.classList.contains('module-tab-strip'))child.classList.add('flat-legacy-list');
    const toolbar=node('div','flat-list-tools');trackSelect=document.createElement('select');trackSelect.id='flat-track-filter';trackSelect.setAttribute('aria-label','字幕轨道范围');trackSelect.onchange=()=>{filter=trackSelect.value;activeTrack=filter||activeTrack;renderList();syncSelection();};search=document.createElement('input');search.type='search';search.placeholder='搜索字幕';search.setAttribute('aria-label','搜索字幕');search.oninput=()=>{query=search.value;renderList();syncSelection();};
    toolbar.append(trackSelect,search,button('新字幕',()=>newCue()),button('新轨道',addTrack));list=node('div','flat-cue-list');list.id='flat-cue-list';holder.append(toolbar,list);
    $('fixed-track-filter')?.closest('label')?.classList.add('flat-legacy-list');
    $('player-empty').textContent='点击“试听媒体”载入视频或音频';
    global.MSWFlatEditor={active:true,snapshot,render,save,dirty,load,flush:flushText,report,
      get data(){return project();},get selection(){return [...selection];},get trackId(){return activeTrack;},get generation(){return mswProjectGeneration;},get player(){return player;},
      apply:(label,fn)=>{flushText();const result=fn(project());commit(result.project||result,label,result.ids);return result;},
      useMedia:async file=>{const result=await loadMediaFile(file,{localOnly:true,previewOnly:true});if(result)await waveformEditor?.processFile(file);return result;}};
    if(waveformEditor){waveformEditor.options.renderFixedTrackHeads=renderHeads;waveformEditor.options.getAudioTrackCount=()=>0;waveformEditor.options.onLayoutUndo=()=>{};
      waveformEditor.options.beginSplitPreviewDrag=()=>{if(!pendingSplit)return null;const initial=copy(pendingSplit);return {move:time=>setSplitTime(time),finish:cancelled=>{if(cancelled){pendingSplit=initial;renderPanel();updatePreview();}}};};}
    global.addEventListener('keydown',keydown,true);
    global.addEventListener('keyup',e=>e.stopImmediatePropagation(),true);
    global.addEventListener('pointerdown',pointerDown,true);global.addEventListener('pointermove',pointerMove,true);
    global.addEventListener('pointerup',e=>{if(drag){stop(e);finishDrag();}},true);global.addEventListener('pointercancel',()=>finishDrag(true),true);global.addEventListener('blur',()=>finishDrag(true));
    global.addEventListener('contextmenu',e=>{const cueId=waveId(e.target);if(cueId){stop(e);if(!selection.has(cueId))select(cueId);cueMenu(cueId,e.clientX,e.clientY);}else if(e.target.closest('.waveform-track-heads-column')&&!e.target.closest('.fixed-track-head')){stop(e);ctxmenu.replaceChildren();menuItem('新增轨道',addTrack);ctxShowAt(e.clientX,e.clientY);}},true);
    global.addEventListener('click',e=>{const b=e.target.closest('[data-waveform-tool]');if(b){stop(e);setTool(b.dataset.waveformTool==='razor'?'razor':'select');}else if(waveId(e.target))stop(e);},true);
    global.addEventListener('dblclick',e=>{const cueId=waveId(e.target);if(cueId){stop(e);select(cueId);$('flat-text')?.focus();}},true);
    global.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))stop(e);},true);
    global.addEventListener('drop',async e=>{if(!e.dataTransfer?.files.length)return;stop(e);const file=e.dataTransfer.files[0];if(!/\.(mosp|json)$/i.test(file.name)){report('请用“试听媒体”载入视频或音频。');return;}if(allowReplace())try{load(JSON.parse(await file.text()),file.name);}catch(error){report(error.message,true);}},true);
    global.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue='';}});
    // Old file inputs may still be reached by automation or a stale UI node.
    // Route project opening to v4 and block all other old input handlers.
    global.addEventListener('change',async e=>{if(e.target.id==='open-project-file'){e.stopImmediatePropagation();const f=e.target.files[0];e.target.value='';if(f&&allowReplace())try{load(JSON.parse(await f.text()),f.name);}catch(error){report(error.message,true);}}else if(['load-media-file','load-srt-file'].includes(e.target.id)){e.stopImmediatePropagation();report('请使用试用工具栏的打开工程／试听媒体入口。');}},true);
    load(transferred?.project||copy(DATA),transferred?.name||FILENAME_BASE||'未命名工程');
    if(recovery){clearTimeout(draftTimer);const restore=button('恢复上次试用草稿',()=>run(()=>{load(recovery.project,recovery.name);saved='';restore.remove();report('已恢复试用草稿，请下载保存。');}));bar.append(restore);report('发现此试用窗口的草稿，可在工具栏恢复。');}
    global.MSWFlatProcessingUI?.setup(global.MSWFlatEditor);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})(window);
