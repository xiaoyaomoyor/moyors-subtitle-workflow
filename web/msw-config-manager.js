/* Shared configuration manager: user defaults only, no project/task mutations. */
(function(global){
  'use strict';
  const clone=v=>v===undefined?undefined:JSON.parse(JSON.stringify(v));
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const equal=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
  const get=(v,path)=>path.reduce((x,k)=>x?.[k],v);
  function put(v,path,value){for(const key of path.slice(0,-1)){v[key]??={};v=v[key];}if(value===undefined)delete v[path.at(-1)];else v[path.at(-1)]=clone(value);}
  const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const offlineIds=['interface','waveform','subtitlePresets','preview','assStyles','onboarding'];
  const offlineHistory='msw.config.snapshots.v1';
  function safe(value,depth=0){
    if(depth>40)throw Error('配置层级过深');
    if(value&&typeof value==='object')for(const [key,item] of Object.entries(value)){
      if(['proto','prototype','constructor','apikey','accesstoken','refreshtoken','authorization','password','secret','requesttoken','accesskeyid','accesskeysecret','secretkey','privatekey','workspaceid','bearertoken','clientsecret'].includes(key.toLowerCase().replace(/[_-]/g,'')))throw Error('配置含无效字段或凭据');
      safe(item,depth+1);
    }
  }
  const spec=()=>global.MSWConfig.snapshot.transfer.filter(x=>offlineIds.includes(x.id));
  function pick(sections,ids){const result={};for(const row of spec().filter(x=>ids.includes(x.id)))for(const path of row.paths){let value=get(sections,path);if(path[0]==='server'&&['saved_workspaces','preset_workspaces'].includes(path[1])&&object(value))value=Object.fromEntries(Object.entries(value).map(([name,ws])=>[name,Object.fromEntries(Object.entries(ws).filter(([k])=>k!=='navigation'))]));if(value!==undefined)put(result,path,value);}return result;}
  const pack=(sections,ids)=>({format:'msw-config',version:1,kind:'preferences',categories:ids,sections:pick(sections,ids)});
  function validPackage(raw){
    safe(raw);
    if(!object(raw)||raw.format!=='msw-config'||raw.version!==1||!['preferences','workspace'].includes(raw.kind)
      ||Object.keys(raw).some(k=>!['format','version','kind','categories','sections'].includes(k))
      ||!Array.isArray(raw.categories)||!raw.categories.length||!object(raw.sections))throw Error('配置格式或版本不受支持');
    if(new TextEncoder().encode(JSON.stringify(raw)).length>4194304)throw Error('配置文件超过 4 MB');
    if(raw.categories.some(id=>!offlineIds.includes(id)))throw Error('此文件包含服务端配置，请在启动器或本机服务版编辑器中导入。');
    if(!equal(raw.sections,pick(raw.sections,raw.categories)))throw Error('配置包含未登记字段');
    for(const [key,value] of Object.entries(raw.sections.browser||{})){
      const rule=global.MSWConfig.snapshot.registry[key];
      if(rule.encoding==='text'?typeof value!=='string':key==='moy.asr.editor.customThemes.v1'?!Array.isArray(value):!object(value))throw Error('配置类型不匹配');
    }
    if(raw.sections.subtitlePresets){
      const library=raw.sections.subtitlePresets;
      if(library.version!==1||!Array.isArray(library.presets)||library.presets.length>256)throw Error('字幕预设库无效');
      const ids=new Set(['default','large','contrast','bilingual']);
      for(const item of library.presets){if(typeof item.id!=='string'||!item.id||ids.has(item.id))throw Error('预设标识重复或无效');ids.add(item.id);global.MSWProjectStyle.normalize(item);}
    }
    return raw;
  }
  function keep(old,value){if(old===undefined)return clone(value);if(object(old)&&object(value))return {...old,...Object.fromEntries(Object.entries(value).map(([k,v])=>[k,keep(old[k],v)]))};return old;}
  function mergeLibrary(old,incoming){const result=clone(old);for(const item of incoming)if(!result.some(x=>item.id&&x.id===item.id||x.name===item.name))result.push(clone(item));return result;}
  function errors(sections){const mode=sections.browser?.['msw.subtitle-proof.v1']?.mode||'project';return ['project','default','large','contrast','bilingual',...(sections.subtitlePresets?.presets||[]).map(x=>x.id)].includes(mode)?[]:['预览样式缺少对应字幕预设，请一并导入。'];}
  function offlinePreview(payload,raw){
    if(raw?.format==='msw-config'&&raw.version===1&&Array.isArray(raw.categories)) {
      if(!payload.categories?.length||payload.categories.some(id=>!raw.categories.includes(id)||!offlineIds.includes(id)))throw Error('请选择当前环境支持的配置分类');
      safe(raw);
      if(Object.keys(raw).some(k=>!['format','version','kind','categories','sections'].includes(k))||new Set(raw.categories).size!==raw.categories.length)throw Error('配置包含未知或重复字段');
      const allowed={};for(const row of global.MSWConfig.snapshot.transfer.filter(x=>raw.categories.includes(x.id)))for(const path of row.paths){const value=get(raw.sections,path);if(value!==undefined)put(allowed,path,value);}
      if(!equal(allowed,raw.sections))throw Error('配置包含未登记字段');
      raw={...raw,categories:payload.categories,sections:pick(raw.sections,payload.categories)};
    }
    validPackage(raw);
    if(!payload.categories?.length||payload.categories.some(id=>!raw.categories.includes(id))||!['keep','replace'].includes(payload.policy))throw Error('请选择分类和冲突处理方式');
    const before=global.MSWConfig.snapshot.sections,after=clone(before),rows=[];
    for(const row of spec().filter(x=>payload.categories.includes(x.id))){
      const paths=raw.kind==='workspace'?Object.keys(raw.sections.server?.saved_workspaces||{}).map(k=>['server','saved_workspaces',k]):row.paths;
      let conflicts=0;
      for(const path of paths){const old=get(after,path);let value=get(raw.sections,path);if(old!==undefined&&!equal(old,value))conflicts++;if(payload.policy==='keep'&&value===undefined)continue;
        if(payload.policy==='keep'&&path[0]==='subtitlePresets'&&old)value={version:1,presets:mergeLibrary(old.presets,value.presets)};
        else if(payload.policy==='keep'&&path[1]==='moy.asr.editor.customThemes.v1'&&old)value=mergeLibrary(old,value);
        else if(payload.policy==='keep')value=keep(old,value);
        put(after,path,value);
        if(path[0]==='server'&&['saved_workspaces','preset_workspaces'].includes(path[1])&&value){for(const [name,ws] of Object.entries(value)){if(old?.[name]?.navigation)after.server[path[1]][name].navigation=clone(old[name].navigation);}}
      }
      const delta=global.MSWConfig.diff(pick(before,[row.id]),pick(after,[row.id]));
      rows.push({id:row.id,name:row.name,changes:delta.length,conflicts,removed:delta.filter(x=>x.delete).length});
    }
    return {after,rows,token:JSON.stringify([before,raw,payload.categories,payload.policy]),revision:0,
      errors:payload.categories.some(x=>['preview','subtitlePresets'].includes(x))?errors(after):[],notes:['便携 HTML 配置仅保存在此浏览器。'],changed:!equal(before,after)};
  }
  global.MSWConfigOffline={request:async payload=>{
    const action=payload.action,sections=global.MSWConfig.snapshot.sections;
    if(action==='catalog')return {categories:spec()};
    if(action==='export'){
      const ids=[...payload.categories];if(!ids.length)throw Error('请至少选择一个分类');
      if(ids.includes('preview')&&errors(pick(sections,['preview'])).length&&!ids.includes('subtitlePresets'))ids.push('subtitlePresets');
      const result=validPackage(pack(sections,ids));return {package:result,notes:[]};
    }
    if(action==='convert-workspace'){
      const ws=payload.workspace?.workspace||payload.workspace;safe(ws);
      if(ws?.schema!=='moy.asr.editor.workspace.v1')throw Error('请选择 MSWE 导出的工作区文件');
      return {package:{format:'msw-config',version:1,kind:'workspace',categories:['waveform'],sections:{server:{saved_workspaces:{[payload.name]:ws}}}}};
    }
    const stored=JSON.parse(localStorage.getItem(offlineHistory)||'[]');
    if(action==='snapshots')return {snapshots:[...stored].reverse().map(({id,created,label})=>({id,created,label}))};
    const raw=action.startsWith('restore')?stored.find(x=>x.id===payload.id)?.package:payload.package;
    if(!raw)throw Error('配置快照不存在');
    const preview=offlinePreview(payload,raw);
    if(action.endsWith('preview'))return preview;
    if(preview.token!==payload.token||preview.errors.length)throw Error(preview.errors.join('；')||'配置预览已过期，请重新预览');
    if(preview.changed){
      stored.push({id:crypto.randomUUID(),created:new Date().toISOString(),label:action==='restore'?'回退前':'导入前',package:pack(sections,offlineIds)});
      // Throw on quota failure before touching current preferences.
      localStorage.setItem(offlineHistory,JSON.stringify(stored.slice(-10)));
      localStorage.setItem('msw.config.offline.v1',JSON.stringify(preview.after));
      global.MSWConfig.adopt({sections:preview.after});
    }
    return {changed:preview.changed};
  }};

  let dialog, categories=[], currentFile=null, preview=null, sourceId='', mode='export', busy=false, cacheReport=null;
  const $=id=>dialog.querySelector('#config-'+id);
  const request=payload=>global.MSWConfig.request(payload);
  function message(text){$('message').textContent=text;}
  function invalidate(){preview=null;$('apply').disabled=true;$('preview-result').replaceChildren();}
  const selected=()=>[...dialog.querySelectorAll('[data-config-category]:checked')].map(x=>x.value);
  function checkboxes(ids){
    $('categories').replaceChildren(...categories.map(row=>{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=row.id;input.dataset.configCategory='';
      input.checked=ids?ids.includes(row.id):row.id!=='onboarding';input.disabled=ids?!ids.includes(row.id):false;
      input.addEventListener('change',invalidate);label.append(input,document.createTextNode(row.name));return label;
    }));
  }
  function renderPreview(value){
    $('preview-result').replaceChildren();
    for(const row of value.rows){const line=document.createElement('div');line.className='config-change';const label=document.createElement('span');label.textContent=row.name;
      const count=document.createElement('span');count.textContent=`${row.changes} 项变更${row.conflicts?` · ${row.conflicts} 组差异`:''}${row.removed?` · 移除 ${row.removed} 项`:''}`;line.append(label,count);$('preview-result').append(line);
      if(row.details?.length){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('pre');summary.textContent='查看变更';body.textContent=row.details.map(x=>`${x.path.join(' / ')}\n${JSON.stringify(x.before)??'默认'} → ${JSON.stringify(x.after)??'默认'}`).join('\n\n');details.append(summary,body);$('preview-result').append(details);}
    }
    for(const text of [...value.errors,...value.notes]){const line=document.createElement('p');line.textContent=text;$('preview-result').append(line);}
    $('apply').disabled=!value.changed||value.errors.length>0;
  }
  async function run(fn){if(busy)return;busy=true;dialog.setAttribute('aria-busy','true');message('');try{await fn();}catch(error){invalidate();message(error.message||String(error));}finally{busy=false;dialog.removeAttribute('aria-busy');}}
  async function loadFile(name,content){
    if(new TextEncoder().encode(content).length>4194304)throw Error('配置文件超过 4 MB');
    let raw=JSON.parse(content.replace(/^\uFEFF/,''));safe(raw);
    if(!raw.format&&name.endsWith('.workspace.json'))raw=(await request({action:'convert-workspace',workspace:raw,name:name.replace(/\.workspace\.json$/i,'').slice(0,60)})).package;
    if(raw.format!=='msw-config'||raw.version!==1||!Array.isArray(raw.categories))throw Error('配置格式或版本不受支持');
    const known=global.MSWConfig.connected?categories:global.MSWConfig.snapshot.transfer;
    if(raw.categories.some(id=>!known.some(x=>x.id===id)))throw Error('配置包含未知分类，请检查文件版本。');
    currentFile=raw;sourceId='';$('filename').textContent=name;checkboxes(raw.categories);invalidate();
    message(raw.kind==='workspace'?'此文件将保存为工作区预设；当前布局不变。':!global.MSWConfig.connected&&raw.categories.some(id=>!offlineIds.includes(id))?'此处仅导入界面与字幕偏好；启动器、处理、配音和备份策略请在本机服务版中导入。':'请选择要导入的分类，然后预览变更。');
  }
  async function changeMode(value){
    mode=value;invalidate();currentFile=null;sourceId='';$('filename').textContent='';message('');checkboxes(value==='export'?null:[]);
    for(const tab of dialog.querySelectorAll('[data-config-mode]'))tab.setAttribute('aria-selected',String(tab.dataset.configMode===value));
    $('file-row').hidden=value!=='import';$('snapshots').hidden=value!=='restore';$('policy-row').hidden=value==='export';$('export').hidden=value!=='export';$('preview').hidden=value==='export';$('apply').hidden=value==='export';
    $('policy-note').hidden=value==='export'||$('policy').value!=='replace';
    const cache=value==='cache';
    $('categories').closest('fieldset').hidden=cache;
    $('cache-panel').hidden=!cache;
    if(cache){$('policy-row').hidden=true;$('policy-note').hidden=true;$('preview').hidden=true;$('apply').hidden=true;}
    if(value==='restore'){
      const {snapshots}=await request({action:'snapshots'});$('snapshots').replaceChildren(new Option('选择回退快照',''),...snapshots.map(row=>new Option(`${new Date(row.created).toLocaleString()} · ${row.label}`,row.id)));
      if(!snapshots.length)message('导入前会自动创建快照，目前还没有记录。');
    }
  }
  function build(){
    dialog=document.createElement('dialog');dialog.className='msw-config-manager';dialog.setAttribute('aria-labelledby','config-title');
    dialog.innerHTML=`<header><strong id="config-title">配置管理</strong><button type="button" id="config-close" aria-label="关闭">×</button></header>
      <div class="config-body"><p class="config-scope">管理用户默认值。当前工程与运行中任务不变；界面配置在重开窗口后生效。</p>
      <nav role="tablist" aria-label="配置操作"><button data-config-mode="export" role="tab">导出</button><button data-config-mode="import" role="tab">导入</button><button data-config-mode="restore" role="tab">快照回退</button><button data-config-mode="cache" role="tab">波形缓存</button></nav>
      <div id="config-cache-panel" hidden><p>优先复用完整缓存。仅清理其中已包含的重复基础波形，文件移入回收站。</p><div class="config-file-row"><button id="config-cache-analyze" type="button">分析当前媒体</button><button id="config-cache-clean" type="button" disabled>清理重复缓存</button></div><div id="config-cache-result"></div></div>
      <div id="config-file-row" class="config-file-row" hidden><button id="config-choose" type="button">选择配置文件</button><span id="config-filename"></span><input id="config-file" type="file" accept=".mswconfig,.workspace.json" hidden></div>
      <select id="config-snapshots" aria-label="配置快照" hidden></select>
      <fieldset><legend>配置分类 <button type="button" id="config-all">全选／取消</button></legend><div id="config-categories"></div></fieldset>
      <label id="config-policy-row" hidden><span>已有配置</span><select id="config-policy"><option value="keep">保留本机，补充缺失项</option><option value="replace">使用导入配置，覆盖所选分类</option></select></label>
      <p id="config-policy-note" class="config-policy-note" hidden>覆盖时，所选分类中未包含的设置回到默认；未选择的分类保持不变。</p>
      <div id="config-preview-result" aria-live="polite"></div><p id="config-message" role="status"></p>
      <details class="config-scope-details"><summary>包含哪些内容？</summary><p>用户默认：界面、操作和处理偏好。工程配置：字幕、样式、位置、素材和工程布局，随 .mosp 保存。本次任务：范围、输入文件及运行参数，导入配置不会改动。密钥、账号音色、本机路径和项目历史不导出。</p></details></div>
      <footer><button id="config-export" type="button">导出 .mswconfig</button><button id="config-preview" type="button" hidden>预览变更</button><button id="config-apply" type="button" hidden disabled>确认应用</button></footer>`;
    document.body.append(dialog);
    $('close').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
    const showCache=report=>{
      cacheReport=report;$('cache-result').replaceChildren();$('cache-clean').disabled=!report.count;
      const heading=document.createElement('p');heading.textContent=`${report.media} · 可清理 ${report.count} 项（${(report.bytes/1024).toFixed(1)} KB）`;$('cache-result').append(heading);
      for(const row of report.files){const line=document.createElement('div');line.className='config-change';line.textContent=`${row.name} · 音轨 ${row.track} · ${row.reason}`;$('cache-result').append(line);}
    };
    $('cache-analyze').onclick=()=>run(async()=>{cacheReport=null;$('cache-clean').disabled=true;const report=await request({action:'cache-analyze'});if(!report.cancelled)showCache(report);});
    $('cache-clean').onclick=()=>run(async()=>{if(!cacheReport)return;const token=cacheReport.token;cacheReport=null;$('cache-clean').disabled=true;const report=await request({action:'cache-clean',token});showCache(report);message([`已将 ${report.removed} 项重复缓存移入回收站。`,...(report.warnings||[])].join(' '));});
    for(const tab of dialog.querySelectorAll('[data-config-mode]'))tab.onclick=()=>run(()=>changeMode(tab.dataset.configMode));
    $('all').onclick=()=>{const inputs=[...dialog.querySelectorAll('[data-config-category]:not(:disabled)')],checked=inputs.some(x=>!x.checked);inputs.forEach(x=>x.checked=checked);invalidate();};
    $('policy').onchange=()=>{invalidate();$('policy-note').hidden=$('policy').value!=='replace';};
    $('snapshots').onchange=()=>{sourceId=$('snapshots').value;checkboxes(sourceId?categories.map(x=>x.id):[]);invalidate();};
    $('choose').onclick=()=>{
      if(global.MSWLauncher?.backend==='real')void run(async()=>{const result=await MSWLauncher.callBackend('choose_user_config_file',{});if(result.error)throw Error(result.error);if(!result.cancelled)await loadFile(result.name,result.content);});
      else{$('file').value='';$('file').click();}
    };
    $('file').onchange=()=>run(async()=>{const file=$('file').files[0];if(file?.size>4194304)throw Error('配置文件超过 4 MB');if(file)await loadFile(file.name,await file.text());});
    $('export').onclick=()=>run(async()=>{
      const ids=selected();if(!ids.length)throw Error('请至少选择一个分类');
      if(global.MSWLauncher?.backend==='real'){
        const result=await MSWLauncher.callBackend('save_user_config_file',{categories:ids});if(result.error)throw Error(result.error);message(result.cancelled?'':'配置文件已导出。');return;
      }
      const result=await request({action:'export',categories:ids});
      const url=URL.createObjectURL(new Blob([JSON.stringify(result.package,null,2)+'\n'],{type:'application/json'}));
      const link=document.createElement('a');link.href=url;link.download='MSW.mswconfig';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      message(result.package.categories.length>ids.length?'已导出，并包含预览所需的字幕预设。':'配置文件已导出。');
    });
    $('preview').onclick=()=>run(async()=>{
      if(mode==='import'&&!currentFile||mode==='restore'&&!sourceId)throw Error('请先选择配置文件或快照');
      const payload={categories:selected(),policy:$('policy').value,...(mode==='restore'?{id:sourceId}:{package:currentFile})};
      preview={payload,result:await request({...payload,action:mode==='restore'?'restore-preview':'preview'})};renderPreview(preview.result);
    });
    $('apply').onclick=()=>run(async()=>{
      if(!preview)return;
      const result=await request({...preview.payload,revision:preview.result.revision,token:preview.result.token,action:mode==='restore'?'restore':'import'});
      invalidate();message(result.changed?'配置已保存。请重开窗口使用新的界面设置；当前工程与任务保持不变。':'配置相同，无需更改。');
    });
  }
  async function open(){
    if(!dialog)build();if(!dialog.open)dialog.showModal();
    cacheReport=null;$('cache-clean').disabled=true;$('cache-result').replaceChildren();
    dialog.querySelector('[data-config-mode="cache"]').hidden=!global.MSWConfig.connected;
    $('cache-analyze').textContent=global.MSWLauncher?'选择媒体并分析':'分析当前媒体';
    await run(async()=>{categories=(await request({action:'catalog'})).categories;await changeMode('export');if(!global.MSWConfig.connected)message('便携 HTML：仅管理此浏览器的界面与字幕偏好；处理默认值请使用本机服务版。');});
  }
  global.MSWConfigManager={open};
  global.addEventListener('keydown',event=>{if(dialog?.open&&dialog.contains(event.target))event.stopPropagation();},true);
  document.addEventListener('click',event=>{if(event.target.closest('[data-open-config-manager]'))void open();});
})(window);
