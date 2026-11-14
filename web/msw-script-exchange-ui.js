(function(global){
  'use strict';
  const core=global.MSWScriptExchange,host=global.MSWFindEdit,$=id=>document.getElementById('script-exchange-'+id),root=$('modal');
  const t=text=>global.MSWE_I18N?.translateText(text)||text,format=MSWFindTextTools.formatTime;
  const states={update:'可更新',same:'未变化',preserved:'保留当前修改',review:'需要确认',missing:'未找到',conflict:'正文冲突',duplicate:'重复目标',locked:'已锁定',blocked:'先处理原有草稿',skipped:'已跳过'};
  const needsReview=state=>['review','conflict','duplicate','missing','blocked'].includes(state);
  const reasons={'number-time':'轨道、序号和时间一致',time:'按同轨时间对应',manual:'手动对应',candidate:'候选需要手动确认',partner:'根据绑定伙伴提供候选','duplicate-number':'文件中的轨道序号重复',unmapped:'请先选择目标轨道',record:'通过导出记录对应字幕','record-review':'无法对应原导出字幕，请手动确认'};
  let parsed=null,plan=null,snapshot=null,mapping=[],manual=new Map(),choices=new Map(),page=0,worker=null,timeout=null,serial=0,busy=false,opener=null,sourceName='';
  const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  function sourceLabel(){$('source-name').textContent=sourceName||t($('text').value?'已粘贴文本':'TXT · 最大 20 MB');}
  function message(text,error=false){$('message').textContent=t(text);$('message').classList.toggle('is-error',error);}
  function stop(){serial++;clearTimeout(timeout);worker?.terminate();worker=null;busy=false;$('preview').inert=false;root.setAttribute('aria-busy','false');$('analyze').disabled=false;$('stage').disabled=true;}
  function close(){const wasOpen=root.classList.contains('show');stop();root.classList.remove('show');if(wasOpen)opener?.focus();}
  function reset(){parsed=plan=snapshot=null;mapping=[];manual.clear();choices.clear();page=0;$('preview').hidden=true;$('map-section').hidden=true;$('baseline').textContent='';$('mapping-status').textContent='';root.querySelector('.modal').classList.remove('has-preview');footer();}
  // The editor blurs mouse-clicked buttons before their click handlers run.
  // Keep the actual trigger so Escape can restore keyboard navigation to it.
  function open(){opener=$('open');reset();$('record').replaceChildren(new Option(t('自动识别文件中的记录'),'auto'),new Option(t('不使用记录（兼容匹配）'),''),...host.exportRecords().map(r=>new Option(new Date(r.created_at).toLocaleString()+' · '+t(`${r.rows.length} 条字幕`),r.id)));$('record').value='auto';$('filter').value='changes';$('settings').open=false;sourceLabel();root.classList.add('show');$('source').open=true;message('');$('pick-file').focus();}
  const selected=()=>plan?.entries.filter(e=>e.checkable&&(choices.get(e.source.index)??e.checked))||[];
  function footer(){const count=selected().length;$('stage').disabled=busy||!count;$('selected').textContent=t(`已选 ${count} 条正文`);$('analyze').disabled=busy||!$('text').value.trim();$('preview').inert=busy;root.setAttribute('aria-busy',String(busy));}
  function setMapping(){
    const tracks=[...new Map(snapshot.rows.map(r=>[r.trackId,r.trackName])).entries()];
    $('mapping').replaceChildren(...parsed.tracks.map(name=>{
      const label=node('label'),select=node('select');select.ariaLabel=t('对应轨道')+' '+name;select.dataset.track=name;
      select.add(new Option(t('请选择目标轨道'),''));select.add(new Option(t('跳过此轨道'),'-'));for(const [id,name] of tracks)select.add(new Option(name,id));
      select.value=new Map(mapping).get(name)||'';select.onchange=()=>{mapping=mapping.map(([from,to])=>[from,from===name?select.value:to]);for(const row of parsed.rows)if(row.trackName===name){manual.delete(row.index);choices.delete(row.index);}void analyze(false);};
      label.append(node('span','',name),select);return label;
    }));
    const unmapped=parsed.tracks.some(name=>!new Map(mapping).get(name));
    $('map-section').hidden=false;$('mapping-status').textContent=t(unmapped?'有轨道需要对应':'轨道已对应');
    if(unmapped)$('settings').open=true;
  }
  function targetLabel(row){return `${row.trackName} · #${row.number} · ${format(row.start)} · ${row.text.replace(/\s+/g,' ').slice(0,80)}`;}
  function render(){
    if(!plan)return;const live=new Map(snapshot.rows.map(r=>[r.key,r]));
    $('counts').replaceChildren(...Object.entries(plan.counts).filter(([,count])=>count>0).map(([state,count])=>node('span',needsReview(state)?'is-review':state==='update'?'is-update':'',t(states[state])+' '+count)));
    const filter=$('filter').value,visible=plan.entries.filter(e=>filter==='all'||(filter==='changes'?!['same','skipped','preserved'].includes(e.status):e.status===filter||filter==='review'&&['duplicate','blocked'].includes(e.status)));
    const pages=Math.max(1,Math.ceil(visible.length/20));page=Math.min(page,pages-1);$('page').textContent=`${page+1} / ${pages}`;$('prev').disabled=page===0;$('next').disabled=page+1===pages;$('page').parentElement.hidden=pages===1;
    $('empty').hidden=visible.length>0;$('empty').textContent=t(filter==='changes'?'没有需要导入的变化或待处理条目':'当前筛选下没有条目');
    $('rows').replaceChildren(...visible.slice(page*20,(page+1)*20).map(entry=>{
      const row=node('article','script-exchange-row'+(needsReview(entry.status)?' is-review':''));row.dataset.index=entry.source.index;
      const header=node('header'),check=node('input');check.type='checkbox';check.checked=entry.checkable&&(choices.get(entry.source.index)??entry.checked);check.disabled=!entry.checkable;check.ariaLabel=t('导入此条正文');
      check.onchange=()=>{choices.set(entry.source.index,check.checked);footer();};
      const source=entry.source;header.append(check,node('span','script-exchange-state',t(states[entry.status])),node('span','',`${source.trackName} · #${source.number??'?'}${source.start===null?'':' · '+format(source.start)+'~'+format(source.end)}`));
      row.append(header);
      if(needsReview(entry.status)||entry.status==='preserved')row.append(node('p','script-exchange-hint',t(entry.status==='conflict'?'当前正文与导入正文存在冲突，请核对后勾选':entry.status==='preserved'?'外部正文未修改，保留工程中的新修改':reasons[entry.reason]||'')));
      const diff=node('div','script-exchange-diff'+(entry.base&&entry.status==='conflict'?' is-conflict':''));
      for(const [label,text] of [...(entry.base&&entry.status==='conflict'?[['导出时正文',entry.base.text]]:[]),['当前正文',entry.target?(entry.target.draftText??entry.target.text):null],['导入正文',source.text]]){
        const block=node('div');block.append(node('small','',t(label)),node('pre','',text===null?t('尚未对应字幕'):text===''?t('（空正文）'):text));diff.append(block);
      }row.append(diff);
      const targetOptions=node('details','script-exchange-target-options'),target=node('div','script-exchange-target'),select=node('select'),searchButton=node('button','',t('查找对应字幕'));searchButton.type='button';select.ariaLabel=t('对应字幕');
      targetOptions.open=['review','missing','duplicate'].includes(entry.status);
      targetOptions.append(node('summary','',t('对应字幕')+(entry.target?` · ${entry.target.trackName}_${entry.target.number} · ${format(entry.target.start)}`:' · '+t('请选择对应字幕'))));
      const fillSelect=keys=>{select.replaceChildren(new Option(t('请选择对应字幕'),'?'),new Option(t('跳过此条'),''));for(const key of [...new Set([entry.target?.key,...keys].filter(Boolean))]){const r=live.get(key);if(r)select.add(new Option(targetLabel(r),key));}select.value=entry.skip?'':entry.target?.key||'?';};
      fillSelect(entry.candidates);select.onchange=()=>{if(select.value==='?')manual.delete(source.index);else manual.set(source.index,select.value);choices.delete(source.index);void analyze(false);};
      searchButton.onclick=()=>{
        if(target.querySelector('input'))return;const search=node('input','script-exchange-search');search.type='search';search.ariaLabel=t('按序号、时间或正文查找');search.placeholder=t('输入 #序号、时间或正文');
        search.oninput=()=>{const query=search.value.trim(),track=new Map(mapping).get(source.trackName),number=/^#\s*(\d+)$/.exec(query);
          const matches=snapshot.rows.filter(r=>r.trackId===track&&(number?r.number===Number(number[1]):!query||core.canonical(r.text).includes(core.canonical(query))||format(r.start).includes(query))).slice(0,40);fillSelect(matches.map(r=>r.key));};
        target.append(search);search.focus();
      };
      target.append(select,searchButton);targetOptions.append(target);row.append(targetOptions);return row;
    }));footer();
  }
  async function analyze(fresh=true){
    const focusIndex=document.activeElement?.closest('.script-exchange-row')?.dataset.index,focusTrack=document.activeElement?.dataset.track,sourceWasOpen=$('source').open;
    stop();if(fresh){mapping=[];manual.clear();choices.clear();page=0;}const token=serial;
    const text=$('text').value;
    try{
      snapshot=host.exchangeSnapshot();const captured=snapshot;busy=true;footer();message('正在解析并匹配…');
      const recordId=$('record').value==='auto'?/^\s*(?:\uFEFF)?\[\[MSW-SCRIPT v1 \| ([A-Za-z0-9_.:-]{1,128})\]\]/.exec(text)?.[1]:$('record').value;
      const record=host.exportRecords().find(r=>r.id===recordId)||null;
      const options={...(mapping.length?{mapping}:{}),manual:[...manual],record};
      const result=await new Promise((resolve,reject)=>{
        try{
          const url=URL.createObjectURL(new Blob([core.workerSource()],{type:'text/javascript'}));try{worker=new Worker(url);}finally{URL.revokeObjectURL(url);}
          worker.onmessage=event=>{if(token!==serial)return;clearTimeout(timeout);worker?.terminate();worker=null;event.data.error?reject(Error(event.data.error)):resolve(event.data);};
          worker.onerror=event=>{event.preventDefault();reject(Error('无法匹配润色稿，请重新尝试'));};
          worker.postMessage({text,rows:captured.rows,options});timeout=setTimeout(()=>reject(Error('匹配耗时较长，请缩小导入范围')),15000);
        }catch(_){setTimeout(()=>{try{const parsed=core.parse(text);resolve({parsed,plan:core.plan(parsed,captured.rows,options)});}catch(e){reject(e);}},0);}
      });
      if(token!==serial||captured.generation!==host.exchangeSnapshot().generation)return;
      for(const index of choices.keys()){
        const before=plan?.entries[index],after=result.plan.entries[index];
        if(!before||before.status!==after?.status||JSON.stringify(before.target)!==JSON.stringify(after.target))choices.delete(index);
      }
      parsed=result.parsed;plan=result.plan;if(!mapping.length)mapping=core.defaultMapping(parsed,snapshot.rows,record);
      $('baseline').textContent=t(record?'已使用工程中的导出记录，可识别双方正文修改':recordId?'工程中没有对应记录，已使用兼容匹配；无法判断导出后工程内的正文修改':'未使用导出记录；按轨道和时间匹配，请核对较新的工程修改');
      $('baseline').classList.toggle('is-review',!record);
      $('preview').hidden=false;$('source').open=false;root.querySelector('.modal').classList.add('has-preview');setMapping();busy=false;render();message('已完成匹配，请核对正文差异。');
      const mappingControl=[...$('mapping').querySelectorAll('select')].find(n=>n.dataset.track===focusTrack);
      const rowControl=[...$('rows').children].find(n=>n.dataset.index===focusIndex)?.querySelector('summary');
      if(mappingControl)mappingControl.focus();else if(rowControl)rowControl.focus();else if(sourceWasOpen)($('settings').open?$('settings').querySelector('summary'):$('review-title')).focus({preventScroll:true});
    }catch(error){if(token===serial){stop();reset();$('source').open=true;message(error.message,true);}}
    finally{if(token===serial){busy=false;footer();}}
  }
  $('pick-file').onclick=()=>{$('file').value='';$('file').click();};
  $('file').onchange=async()=>{
    const file=$('file').files[0];if(!file)return;stop();reset();const token=serial,generation=host.exchangeSnapshot().generation;
    try{if(file.size>core.MAX_TEXT)throw Error('润色稿超过 20 MB');const text=AsrEditorUtils.decodeSubtitleText(await file.arrayBuffer());
      if(token!==serial||generation!==host.exchangeSnapshot().generation)return;sourceName=file.name;$('text').value=text;sourceLabel();await analyze(true);
    }catch(error){if(token===serial)message(error.message,true);}
  };
  $('text').addEventListener('input',()=>{stop();reset();sourceName='';sourceLabel();message($('text').value?'文本已变化，请重新解析并匹配':'');});
  // Chromium's native insertion becomes very slow with thousands of textarea lines.
  // This is an import buffer: insert a large clipboard payload in one value update.
  function largeInsert(event,text){
    if(typeof text!=='string'||text.length<2000)return;
    event.preventDefault();const input=$('text'),start=input.selectionStart,end=input.selectionEnd;
    if(input.value.length-end+start+text.length>core.MAX_TEXT){message('润色稿超过 20 MB',true);return;}
    const inserted=text.replace(/\r\n?/g,'\n');
    input.value=input.value.slice(0,start)+inserted+input.value.slice(end);
    input.setSelectionRange(start+inserted.length,start+inserted.length);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  }
  $('text').addEventListener('paste',event=>largeInsert(event,event.clipboardData?.getData('text/plain')));
  $('text').addEventListener('beforeinput',event=>{if(!event.isComposing&&['insertText','insertFromPaste'].includes(event.inputType))largeInsert(event,event.data);});
  $('open').onclick=open;$('analyze').onclick=()=>analyze(true);$('close').onclick=$('cancel').onclick=close;
  $('record').onchange=()=>{if($('text').value)void analyze(true);};
  $('refresh').onclick=()=>{choices.clear();void analyze(false);};
  $('export').onclick=async()=>{const button=$('export');button.disabled=true;try{await host.exportScript();}catch(error){document.getElementById('find-edit-message').textContent=t(error.message);}finally{button.disabled=false;}};
  $('filter').onchange=()=>{page=0;render();};$('prev').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
  $('select').onclick=()=>{for(const e of plan.entries)choices.set(e.source.index,e.status==='update');render();};$('deselect').onclick=()=>{for(const e of plan.entries)choices.set(e.source.index,false);render();};
  $('stage').onclick=()=>{try{host.stageScriptImport(selected().map(e=>({key:e.target.key,text:e.source.text})),snapshot);close();}catch(error){message(error.message,true);$('stage').disabled=true;$('message').scrollIntoView({block:'nearest'});}};
  root.addEventListener('click',event=>{if(event.target===root)close();});
  root.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.key==='Tab'){const controls=[...root.querySelectorAll('button,input,select,textarea,summary')].filter(n=>!n.disabled&&n.checkVisibility()),at=controls.indexOf(document.activeElement);if(event.shiftKey&&at===0||!event.shiftKey&&at===controls.length-1){event.preventDefault();controls[event.shiftKey?controls.length-1:0]?.focus();}}
  });
  global.addEventListener('msw:project-changed',()=>{close();$('text').value='';$('file').value='';sourceName='';reset();});
})(window);
