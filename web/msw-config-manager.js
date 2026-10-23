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

  let dialog, categories=[], knownCategories=[], currentFile=null, preview=null, busy=false;
  const $=id=>dialog.querySelector('#config-'+id);
  const request=payload=>global.MSWConfig.request(payload);
  function message(text){$('message').textContent=text;}
  function invalidate(){preview=null;$('apply').disabled=true;$('preview-result').replaceChildren();}
  const selected=()=>[...dialog.querySelectorAll('[data-config-category]:checked')].map(x=>x.value);
  function syncAll(){
    const inputs=[...dialog.querySelectorAll('[data-config-category]:not(:disabled)')],count=inputs.filter(x=>x.checked).length;
    $('all').checked=inputs.length>0&&count===inputs.length;
    $('all').indeterminate=count>0&&count<inputs.length;
    $('all').disabled=!inputs.length;
  }
  function checkboxes(ids){
    $('categories').replaceChildren(...categories.map(row=>{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=row.id;input.dataset.configCategory='';
      input.checked=ids?ids.includes(row.id):true;input.disabled=ids?!ids.includes(row.id):false;
      input.addEventListener('change',()=>{syncAll();invalidate();});label.append(input,document.createTextNode(row.name));return label;
    }));
    syncAll();
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
    const known=global.MSWConfig.connected?knownCategories:global.MSWConfig.snapshot.transfer;
    if(raw.categories.some(id=>!known.some(x=>x.id===id)))throw Error('配置包含未知分类，请检查文件版本。');
    currentFile=raw;$('filename').textContent=name;checkboxes(raw.categories);invalidate();
    message(raw.kind==='workspace'?'保存为工作区预设，当前布局不变。':raw.categories.some(id=>['assStyles','onboarding'].includes(id))?'已略过旧样式库和首次提示状态，请选择其余分类。':!global.MSWConfig.connected&&raw.categories.some(id=>!offlineIds.includes(id))?'启动器、处理、配音和工程备份设置需在本机服务版导入。':'请选择要导入的分类，然后预览变更。');
  }
  async function changeMode(value){
    invalidate();currentFile=null;$('filename').textContent='';message('');checkboxes(value==='export'?null:[]);
    for(const tab of dialog.querySelectorAll('[data-config-mode]'))tab.setAttribute('aria-selected',String(tab.dataset.configMode===value));
    $('file-row').hidden=value!=='import';$('export').hidden=value!=='export';$('preview').hidden=value==='export';$('apply').hidden=value==='export';
    $('policy-note').hidden=value==='export'||$('policy').value!=='replace';
  }
  const editorHost=document.getElementById('editor-config-manager');
  const embeddedHost=editorHost||document.getElementById('launcher-config-manager');
  let initialized=false;
  function build(){
    dialog=document.createElement(embeddedHost?'section':'dialog');dialog.className='msw-config-manager'+(embeddedHost?' config-embedded':'');dialog.setAttribute('aria-label','配置管理');
    dialog.innerHTML=`${embeddedHost?'':'<header><strong id="config-title">配置管理</strong><button type="button" id="config-close" aria-label="关闭">×</button></header>'}
      <div class="config-body"><p class="config-scope">导入、导出个人设置；不会改动当前工程。</p>
      <nav role="tablist" aria-label="配置操作"><button data-config-mode="export" role="tab">导出</button><button data-config-mode="import" role="tab">导入</button></nav>
      <div id="config-file-row" class="config-file-row" hidden><button id="config-choose" type="button">选择配置文件</button><label id="config-policy-row"><span>导入机制</span><select id="config-policy"><option value="keep">保留本机，补充缺失项</option><option value="replace">使用导入配置，覆盖所选分类</option></select></label><span id="config-filename"></span><input id="config-file" type="file" accept=".mswconfig,.workspace.json" hidden></div>
      <fieldset><legend><label><input type="checkbox" id="config-all">配置分类</label></legend><div id="config-categories"></div></fieldset>
      <p id="config-policy-note" class="config-policy-note" hidden>覆盖时，所选分类中未包含的设置回到默认；未选择的分类保持不变。</p>
      <div id="config-preview-result" aria-live="polite"></div><p id="config-message" role="status"></p>
      <details class="config-scope-details"><summary>包含哪些内容？</summary><p>翻译与文本处理：翻译偏好、提示词、替换规则和后处理参数。配音设置：引擎、语速等合成偏好。工程备份设置：自动备份开关、间隔和保留数量。</p><p>字幕与素材随工程保存；密钥、私人音色、文件路径和备份文件不导出。界面设置在重开窗口后生效。</p></details></div>
      <footer><button id="config-export" type="button">导出 .mswconfig</button><button id="config-preview" type="button" hidden>预览变更</button><button id="config-apply" type="button" hidden disabled>确认应用</button></footer>`;
    (embeddedHost||document.body).append(dialog);
    if(!embeddedHost){$('close').onclick=()=>{if(!busy)dialog.close();};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});}
    for(const tab of dialog.querySelectorAll('[data-config-mode]'))tab.onclick=()=>run(()=>changeMode(tab.dataset.configMode));
    $('all').onchange=()=>{const checked=$('all').checked;dialog.querySelectorAll('[data-config-category]:not(:disabled)').forEach(x=>x.checked=checked);syncAll();invalidate();};
    $('policy').onchange=()=>{invalidate();$('policy-note').hidden=$('policy').value!=='replace';};
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
      if(!currentFile)throw Error('请先选择配置文件');
      const payload={categories:selected(),policy:$('policy').value,package:currentFile};
      preview={payload,result:await request({...payload,action:'preview'})};renderPreview(preview.result);
    });
    $('apply').onclick=()=>run(async()=>{
      if(!preview)return;
      const result=await request({...preview.payload,revision:preview.result.revision,token:preview.result.token,action:'import'});
      invalidate();message(result.changed?'配置已保存。请重开窗口使用新的界面设置；当前工程与任务保持不变。':'配置相同，无需更改。');
    });
  }
  async function initialize(){
    if(!dialog)build();
    await run(async()=>{knownCategories=(await request({action:'catalog'})).categories;categories=knownCategories.filter(row=>!row.retired&&!['assStyles','onboarding'].includes(row.id));await changeMode('export');initialized=true;if(!global.MSWConfig.connected)message('便携 HTML：仅管理此浏览器的界面与字幕偏好；处理设置请使用本机服务版。');});
  }
  async function open(){
    if(embeddedHost){
      if(editorHost)global.MSWE_EDITOR_BRIDGE.openConfigSettings();
      else global.MSWLauncher.openSettings('configurationSettingsSection');
      if(!initialized&&!busy)await initialize();
    }else{
      if(!dialog)build();if(!dialog.open)dialog.showModal();
      await initialize();
    }
  }
  if(embeddedHost){
    build();
    global.addEventListener(editorHost?'msw:settings-opened':'msw:launcher-settings-tab',event=>{
      if((editorHost||event.detail?.tab==='configuration')&&!initialized&&!busy)void initialize();
    });
  }
  global.MSWConfigManager={open};
  global.addEventListener('keydown',event=>{if(dialog?.open&&dialog.contains(event.target))event.stopPropagation();},true);
  document.addEventListener('click',event=>{if(event.target.closest('[data-open-config-manager]'))void open();});
})(window);
