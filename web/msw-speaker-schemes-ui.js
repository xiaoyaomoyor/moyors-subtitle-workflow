// Speaker library actions are explicit; importing preferences never edits a project.
(function(global){
  'use strict';
  const core=global.MSWSpeakerSchemes,key='msw.speaker-schemes.v1';
  const container=document.getElementById('speaker-label-settings');if(!container)return;
  const root=document.createElement('div');root.className='speaker-schemes';
  const icon=(id,title,path)=>`<button type="button" id="speaker-scheme-${id}" class="msw-style-icon" title="${title}" aria-label="${title}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></button>`;
  root.innerHTML=`<div class="speaker-scheme-toolbar"><label>说话人方案<select id="speaker-scheme-select" aria-label="说话人方案"></select></label><button type="button" id="speaker-scheme-open">对应并应用</button>
    ${icon('overwrite','更新所选说话人方案','M20 11V7l-4-4H3v18h10M7 3v6h9V3M7 21v-7h5m3 3h7m-3-3 3 3-3 3')}
    ${icon('save','另存为说话人方案','M14 21H3V3h14l4 4v6M7 3v6h10V3M7 21v-7h7m4 2v6m-3-3h6')}
    ${icon('delete','删除说话人方案','M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7')}
    <span id="speaker-scheme-help" class="msw-help-anchor"></span></div>
    <p hidden data-help-for="speaker-scheme-help">方案保存名字、译名、颜色、外观和动画，可在配置管理中导出。不同工程的 SP 编号不代表同一个人，请先确认对应；应用后可一次撤销，单条手动样式优先。</p>
    <form id="speaker-scheme-form" class="speaker-scheme-edit" hidden><label>方案名称<input id="speaker-scheme-name" maxlength="80" required autocomplete="off"></label><span id="speaker-scheme-save-note" class="editor-settings-hint"></span><label id="speaker-scheme-include-row" class="speaker-scheme-add-missing"><input type="checkbox" id="speaker-scheme-include">加入尚未对应的工程说话人</label><div class="speaker-scheme-actions"><button type="button" id="speaker-scheme-save-cancel">取消</button><button type="submit">保存方案</button></div></form>
    <div id="speaker-scheme-remove" class="speaker-scheme-edit" hidden><span id="speaker-scheme-remove-question"></span><div class="speaker-scheme-actions"><button type="button" id="speaker-scheme-delete-cancel">取消</button><button type="button" id="speaker-scheme-delete-confirm">删除方案</button></div></div>
    <section id="speaker-scheme-mapping" class="speaker-scheme-edit" hidden aria-label="说话人对应"><div class="speaker-mapping-scroll"><table><thead><tr><th>当前工程</th><th>方案中的说话人</th></tr></thead><tbody id="speaker-scheme-mapping-rows"></tbody></table></div><label class="speaker-scheme-add-missing"><input type="checkbox" id="speaker-scheme-add-missing">补充方案中未对应的说话人</label><div class="speaker-scheme-actions"><span id="speaker-scheme-plan" role="status"></span><button type="button" id="speaker-scheme-cancel">取消</button><button type="button" id="speaker-scheme-apply">确认应用</button></div></section>
    <p id="speaker-scheme-status" class="editor-settings-hint" role="status" hidden></p>`;
  container.querySelector('.speaker-name-language').before(root);
  const $=id=>root.querySelector('#speaker-scheme-'+id),storage=global.MSWConfig?.storage||localStorage;
  const newId=()=>global.MSWProject.id('person');
  let library={version:1,schemes:[]},selected='',pending=null,busy=false;
  const palette=()=>global.MSWSpeaker.ensure(DATA);
  const fingerprint=()=>JSON.stringify(palette());
  function message(text=''){$('status').textContent=text;$('status').hidden=!text;}
  function load(){const raw=storage.getItem(key);library=core.validate(JSON.parse(raw||'{"version":1,"schemes":[]}'));if(raw)global.MSWConfig?.observe(key,raw);return library;}
  function sync(){
    const found=library.schemes.some(s=>s.id===selected);if(!found)selected='';
    const signature=JSON.stringify(library.schemes.map(s=>[s.id,s.name]));
    if($('select').dataset.value!==signature){$('select').replaceChildren(new Option('选择方案',''),...library.schemes.map(s=>new Option(s.name,s.id)));$('select').dataset.value=signature;}
    $('select').value=selected;
    for(const id of ['open','overwrite','delete'])$(id).disabled=busy||!selected;
    const linked=palette().rows.some(r=>r.scheme_ref?.scheme_id===selected);
    $('overwrite').disabled=busy||!selected||!linked;$('overwrite').title=linked?'更新所选说话人方案':'请先对应并应用方案';
    $('save').disabled=busy||library.schemes.length>=64;$('select').disabled=busy;
    for(const el of root.querySelectorAll('.speaker-scheme-edit input,.speaker-scheme-edit select,.speaker-scheme-edit button'))el.disabled=busy;
  }
  function close(){pending=null;for(const id of ['form','remove','mapping'])$(id).hidden=true;message();}
  function start(kind){
    close();load();sync();const scheme=library.schemes.find(s=>s.id===selected);
    if(kind!=='save'&&!scheme)return null;
    pending={kind,scheme:scheme?structuredClone(scheme):null,generation:mswProjectGeneration,base:fingerprint()};return pending;
  }
  function commitPalette(next,label){
    if(fingerprint()===JSON.stringify(next))return;
    pushPreviewUndo(label,snapshotPreviewState());DATA.preview.speaker_palette=next;speakerPaletteChanged();
  }
  async function saveLibrary(next){
    core.validate(next);const text=JSON.stringify(next);
    if(new TextEncoder().encode(text).length>4194304)throw Error('说话人方案超过 4 MB');
    if(global.MSWConfig?.connected){storage.setItem(key,text);await global.MSWConfig.flush();}
    else {
      // Use the offline transaction too: its import cache and the visible
      // storage must agree after reload; quota failure leaves the project intact.
      const payload={package:{format:'msw-config',version:1,kind:'preferences',categories:['speakerSchemes'],sections:{speakerSchemes:next}},categories:['speakerSchemes'],policy:'replace'};
      const preview=await global.MSWConfig.request({...payload,action:'preview'});
      await global.MSWConfig.request({...payload,action:'import',revision:preview.revision,token:preview.token});
    }
    library=next;
  }
  async function run(fn){if(busy)return;busy=true;sync();try{await fn();}catch(error){message(error.message||String(error));}finally{busy=false;sync();}}
  function guard(action){
    if(action!==pending||action.generation!==mswProjectGeneration||action.base!==fingerprint())throw Error('工程说话人已变化，请重新打开对应或保存操作');
    const current=load().schemes.find(s=>s.id===action.scheme?.id);
    if(action.scheme&&JSON.stringify(current)!==JSON.stringify(action.scheme))throw Error('说话人方案已变化，请重新选择');
  }
  function edit(kind){try{const action=start(kind);if(!action)return;$('form').hidden=false;$('name').value=kind==='overwrite'?action.scheme.name:'';
    $('save-note').textContent=kind==='overwrite'?'仅更新已对应的人物；本工程未出现的方案人物保留。':'保存当前说话人配置，可用于其他工程。';$('include-row').hidden=kind!=='overwrite';$('include').checked=false;$('name').focus();}catch(e){message(e.message);}}
  $('save').onclick=()=>edit('save');$('overwrite').onclick=()=>edit('overwrite');
  $('form').onsubmit=event=>{event.preventDefault();const action=pending;if(!action)return;void run(async()=>{
    guard(action);const name=$('name').value.trim();if(!name)throw Error('请输入方案名称');
    const id=action.kind==='overwrite'?action.scheme.id:global.MSWProject.id('scheme');
    if(library.schemes.some(s=>s.name===name&&s.id!==id))throw Error('已有同名方案，请更换名称');
    const result=core.capture(palette(),{id,name,previous:action.kind==='overwrite'?action.scheme:null,makeId:newId,includeUnmapped:action.kind==='save'||$('include').checked});
    const next={version:1,schemes:[...library.schemes.filter(s=>s.id!==id),result.scheme]};
    await saveLibrary(next);selected=id;
    if(action.generation===mswProjectGeneration&&action.base===fingerprint())commitPalette(result.palette,'记录说话人方案对应');
    close();message('方案已保存；其他工程保持原配置。');
  });};
  $('delete').onclick=()=>{try{const action=start('delete');if(!action)return;$('remove-question').textContent=`删除「${action.scheme.name}」？工程中的说话人配置会保留。`;$('remove').hidden=false;}catch(e){message(e.message);}};
  $('delete-confirm').onclick=()=>{const action=pending;if(action?.kind!=='delete')return;void run(async()=>{guard(action);await saveLibrary({version:1,schemes:library.schemes.filter(s=>s.id!==action.scheme.id)});selected='';close();message('方案已删除；工程配置保留。');});};
  for(const id of ['save-cancel','delete-cancel','cancel'])$(id).onclick=close;
  $('select').onchange=()=>{selected=$('select').value;close();sync();};
  function previewPlan(){
    if(pending?.kind!=='apply')return;
    const mapping=Object.fromEntries([...$('mapping-rows').querySelectorAll('select')].map(s=>[s.dataset.speakerId,s.value]));
    pending.mapping=mapping;
    const result=core.apply(palette(),pending.scheme,mapping,{addMissing:$('add-missing').checked,makeId:newId});
    pending.result=result;$('plan').textContent=`更新 ${result.updated} 人 · 新增 ${result.added} 人`;
    $('apply').disabled=busy||!(result.updated||result.added);
  }
  $('add-missing').onchange=()=>{try{previewPlan();}catch(e){$('apply').disabled=true;message(e.message);}};
  $('open').onclick=()=>{try{
    const action=start('apply');if(!action)return;
    const guesses=core.suggestions(palette(),action.scheme),usage=new Map();
    const flatCues=new Map((DATA.subtitles?.cues||[]).map(c=>[c.id,c.content]));
    const groups=DATA.subtitles?[[...flatCues.values()]]:[DATA.segments,...(DATA.multi_subtitle?.tracks||[]).map(t=>t.segments),DATA.overlay_track?.segments];
    for(const cues of groups)for(const cue of cues||[]){const head=DATA.subtitles?flatCues.get(cue.color_ref?.cue_id):cues[cue.color_ref?.headIdx];const id=cue.color?.name||head?.color?.name||cue.color_ref?.name;if(!id)continue;const row=usage.get(id)||{count:0,text:cue.text||''};row.count++;usage.set(id,row);}
    $('mapping-rows').replaceChildren(...palette().rows.map(row=>{
      const tr=document.createElement('tr'),from=document.createElement('td'),to=document.createElement('td');
      const name=document.createElement('span');name.textContent=row.name;from.append(name);
      const sample=document.createElement('small'),use=usage.get(row.id);sample.textContent=use?`${use.count} 条 · ${use.text.slice(0,72)}`:'未标记字幕';sample.title=use?.text||'';from.append(sample);
      const select=document.createElement('select');select.dataset.speakerId=row.id;select.setAttribute('aria-label',row.name+' 对应');
      select.add(new Option('保持当前',''));action.scheme.rows.forEach((person,i)=>select.add(new Option(`${i+1} · ${person.name}`,person.id)));select.value=guesses[row.id];
      select.onchange=()=>{message();try{previewPlan();}catch(e){$('apply').disabled=true;message(e.message);}};
      to.append(select);tr.append(from,to);return tr;
    }));
    $('add-missing').checked=false;$('mapping').hidden=false;previewPlan();
  }catch(e){message(e.message);}};
  $('apply').onclick=()=>{try{const action=pending;if(action?.kind!=='apply')return;guard(action);previewPlan();
    const result=action.result;close();commitPalette(result.palette,'应用说话人方案');message(`已更新 ${result.updated} 人，新增 ${result.added} 人。`);
  }catch(e){$('apply').disabled=true;message(e.message);}};
  global.addEventListener('msw:project-changed',()=>{close();try{load();sync();}catch(e){message(e.message);}});
  // Imports intentionally do not apply a scheme; refresh just the library choices.
  global.addEventListener('msw:config-adopted',()=>{if(!busy){close();try{load();sync();}catch(e){message(e.message);}}});
  try{load();sync();}catch(e){message(e.message);for(const el of root.querySelectorAll('button,select'))el.disabled=true;}
})(window);
