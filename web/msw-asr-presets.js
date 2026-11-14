/* Shared recognition recipes. Forms remain drafts; only explicit actions persist. */
(function(global){
  'use strict';
  const clone=v=>JSON.parse(JSON.stringify(v)),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const names={language:'语言',maxLen:'最大字数',minLen:'短句合并阈值',maxWords:'英文最大单词数',minWords:'英文短句合并阈值',gapSplit:'停顿切句阈值（毫秒）',speakerColors:'区分说话人',qwenKeepDialect:'保留方言表达',qwenAudioHotwords:'Qwen 热词',qwenAudioHotwordWeight:'热词权重',openaiKeywords:'OpenAI Keywords',openaiDiarize:'OpenAI 说话人',sonioxContextGeneral:'Soniox General',sonioxContextTerms:'Soniox Terms',sonioxContextTranslationTerms:'Soniox Translation Terms',doubaoHotwords:'豆包热词'};
  const english={'识别预设':'Recognition presets','背景与提示词':'Background and prompts','通用背景':'Shared background','服务专用覆盖':'Provider overrides','保存背景':'Save background','重新读取':'Reload','当前参数':'Current settings','已修改':'Modified','未保存':'Unsaved','已保存':'Saved','搜索预设':'Search presets','已删除':'Deleted','名称':'Name','描述':'Description','参数预览':'Settings preview','加载预设':'Load preset','另存当前参数':'Save current as new','更新为当前参数':'Update from current','保存名称与描述':'Save name and description','复制':'Duplicate','删除':'Delete','恢复':'Restore','关闭':'Close','暂无预设':'No presets','选择预设以预览':'Select a preset to preview','新预设':'New preset','副本':'Copy','启用':'Enabled','关闭选项':'Off','默认':'Default','已加载':'Loaded','未应用的参数':'Settings not applied','已删除，可在“已删除”中恢复':'Deleted. Restore it from Deleted.','当前模型不发送背景文本':'This model does not send background text','Qwen 最多 400 字':'Qwen: up to 400 characters','Soniox 上下文合计最多 10000 字':'Soniox: up to 10,000 characters across all context fields','背景随任务固定；保存后供两个入口复用。':'Each task keeps its own background. Save to reuse it in both interfaces.','加载仅修改参数，保留当前服务、模型和识别范围。':'Loading updates settings and keeps the current provider, model and scope.','预设不包含密钥、服务地址、业务空间、路径或账号热词表。':'Presets exclude keys, endpoints, workspaces, paths and account vocabulary IDs.','语言':'Language','最大字数':'Maximum characters','短句合并阈值':'Short segment threshold','英文最大单词数':'Maximum English words','英文短句合并阈值':'Short English segment threshold','停顿切句阈值（毫秒）':'Pause threshold (ms)','区分说话人':'Identify speakers','保留方言表达':'Preserve dialect','Qwen 热词':'Qwen hotwords','热词权重':'Hotword weight','OpenAI 说话人':'OpenAI diarization','豆包热词':'Doubao hotwords','识别预设与背景':'Recognition presets and background','请填写预设名称':'Enter a preset name','正在处理…':'Working…','刷新会放弃尚未保存的背景修改。':'Reloading discards unsaved background changes.','继续':'Continue'};
  Object.assign(english,{
    '配置已在其他窗口更新；本窗口改动已保留，请刷新后重试':'Settings changed in another window. Your draft is preserved; reload before saving again.',
    '已存在同名识别预设':'A preset with this name already exists.',
    '请填写有效的预设名称（最多 80 字）':'Enter a valid preset name (up to 80 characters).',
    '识别预设库最多保存 256 项（含已删除项）':'The library supports up to 256 presets, including deleted presets.',
    '识别预设数值参数无效':'A numeric preset setting is invalid.',
    '短句合并阈值不能大于最大长度':'The short segment threshold cannot exceed the maximum length.',
    '识别预设文本无效或过长':'Preset text is invalid or too long.'
  });
  const t=s=>document.documentElement.lang.startsWith('en')?(english[s]||s):s;
  const promptFor=(p,id)=>p.overrides[id]??p.text;
  function applicable(options,ctx){
    const applied={},skipped=[];
    const diarize=ctx.caps?.customDiarize&&Object.hasOwn(options,'openaiDiarize')?options.openaiDiarize:ctx.diarize;
    for(const [key,value] of Object.entries(options)){
      let allowed=key==='asrPrompts'||['maxLen','minLen','maxWords','minWords','gapSplit'].includes(key);
      if(key==='language')allowed=!value||value.split(',').every(x=>ctx.languages.includes(x))&&(ctx.multiLanguage||!value.includes(','));
      if(key==='speakerColors')allowed=Boolean(ctx.model.supportsSpeaker);
      if(key.startsWith('qwen'))allowed=ctx.id==='qwen'&&(key==='qwenKeepDialect'?ctx.model.supportsKeepDialect:ctx.model.supportsHotwords);
      if(key==='openaiKeywords')allowed=ctx.id==='openai'&&ctx.caps?.keywords&&!diarize;
      if(key==='openaiDiarize')allowed=ctx.id==='openai'&&ctx.caps?.customDiarize;
      if(key.startsWith('soniox'))allowed=ctx.id==='soniox'&&ctx.model.supportsContext;
      if(key==='doubaoHotwords')allowed=ctx.id==='doubao';
      if(allowed)applied[key]=clone(value);else if(value!==''&&value!==false)skipped.push(names[key]||key);
    }
    return {applied,skipped};
  }
  function create(host){
    let data=null,prompts={text:'',overrides:{}},savedPrompts=clone(prompts),selected=null,loaded=null,baseline=null,busy=false,dialog=null;
    const root=host.root;
    root.classList.add('msw-asr-presets');
    root.innerHTML='<div class="asr-preset-bar"><button type="button" data-action="library" data-label="识别预设"></button><span data-role="current"></span></div><details class="asr-background"><summary data-label="背景与提示词"></summary><label><span data-label="通用背景"></span><textarea data-role="background" rows="3" maxlength="12000"></textarea></label><p data-role="limit" class="asr-preset-hint"></p><details><summary data-label="服务专用覆盖"></summary><div data-role="overrides"></div></details><div class="asr-preset-actions"><button type="button" data-action="save-prompts" data-label="保存背景"></button><button type="button" data-action="reload" data-label="重新读取"></button><span data-role="prompt-state"></span></div><p class="asr-preset-hint" data-label="背景随任务固定；保存后供两个入口复用。"></p></details><p data-role="message" role="status" class="asr-preset-message"></p>';
    const find=(role,parent=root)=>parent.querySelector(`[data-role="${role}"]`);
    for(const [id,label] of [['qwen','Qwen'],['openai','OpenAI'],['soniox','Soniox']]){
      const field=document.createElement('div');field.className='asr-prompt-override';field.dataset.provider=id;
      const check=document.createElement('input');check.type='checkbox';check.dataset.override=id;
      const title=document.createElement('label');title.append(check,document.createTextNode(label));
      const area=document.createElement('textarea');area.rows=2;area.maxLength=12000;area.dataset.overrideText=id;area.setAttribute('aria-label',label);
      field.append(title,area);find('overrides').append(field);
      check.onchange=()=>{if(check.checked)prompts.overrides[id]=area.value||prompts.text;else delete prompts.overrides[id];paintPrompts();changed();};
      area.oninput=()=>{prompts.overrides[id]=area.value;changed();};
    }
    find('background').oninput=()=>{prompts.text=find('background').value;changed();};
    function localize(node=root){for(const el of node.querySelectorAll('[data-label]'))el.textContent=t(el.dataset.label);if(dialog)find('search',dialog).placeholder=t('搜索预设');}
    function message(value){find('message').textContent=t(value);if(dialog)find('message',dialog).textContent=t(value);}
    function capture(){const raw=host.getOptions(),o={};for(const key of data?.textFields||[])if(!(key==='qwenAudioHotwords'&&raw.qwenAudioHotwordsMode==='file'))o[key]=String(raw[key]??'');for(const key of data?.boolFields||[])o[key]=raw[key]===true;o.asrPrompts=clone(prompts);return o;}
    function paintPrompts(){find('background').value=prompts.text;for(const id of ['qwen','openai','soniox']){const on=Object.hasOwn(prompts.overrides,id);root.querySelector(`[data-override="${id}"]`).checked=on;const area=root.querySelector(`[data-override-text="${id}"]`);area.value=prompts.overrides[id]??'';area.hidden=!on;}}
    function changed(){host.onPrompts?.(clone(prompts));refresh();}
    function refresh(){
      const ctx=host.context(),supported=ctx.id==='qwen'?ctx.model.supportsContext:ctx.id==='soniox'?ctx.model.supportsContext:ctx.id==='openai'&&ctx.caps?.prompt&&!ctx.diarize;
      const count=Array.from(promptFor(prompts,ctx.id)||'').length;
      find('limit').textContent=!supported?t('当前模型不发送背景文本'):(ctx.id==='qwen'?`${count} / 400 · ${t('Qwen 最多 400 字')}`:ctx.id==='soniox'?t('Soniox 上下文合计最多 10000 字'):`${count}`);
      find('limit').classList.toggle('asr-preset-error',supported&&ctx.id==='qwen'&&count>400);
      find('prompt-state').textContent=t(same(prompts,savedPrompts)?'已保存':'未保存');
      find('current').textContent=loaded?`${loaded.name}${baseline&&!same(capture(),baseline)?' · '+t('已修改'):''}`:t('当前参数');
      for(const button of root.querySelectorAll('button'))button.disabled=busy||(!data&&button.dataset.action!=='reload')||host.locked();
      for(const input of root.querySelectorAll('input,textarea'))input.disabled=busy||!data||host.locked();
      localize();
    }
    async function load(reset=false){const next=await host.request();if(!data||reset||same(prompts,savedPrompts)){prompts=clone(next.prompts);savedPrompts=clone(next.prompts);paintPrompts();host.onPrompts?.(clone(prompts));}data=next;refresh();}
    async function run(fn){if(busy||host.locked())return;busy=true;message('');refresh();if(dialog)for(const button of dialog.querySelectorAll('button'))button.disabled=true;try{await fn();}catch(e){message(e.message);}finally{busy=false;refresh();if(dialog){renderList();renderDetail();}}}
    function selectedRow(){return data?.presets.find(row=>row.id===selected);}
    function renderList(){
      if(!dialog)return;
      const list=find('list',dialog),q=find('search',dialog).value.trim().toLocaleLowerCase(),deleted=find('deleted',dialog).checked;list.replaceChildren();
      for(const row of data.presets.filter(row=>row.deleted===deleted&&`${row.name} ${row.description}`.toLocaleLowerCase().includes(q))){
        const button=document.createElement('button');button.type='button';button.textContent=row.name;button.className='asr-preset-item';button.setAttribute('aria-pressed',String(row.id===selected));button.disabled=busy;
        button.onclick=()=>{selected=row.id;renderList();renderDetail(true);};list.append(button);
      }
      if(!list.children.length)list.textContent=t('暂无预设');
    }
    function preview(options){const lines=[];for(const [key,value] of [['asrPrompts',options.asrPrompts],...Object.entries(options).filter(([key,value])=>key!=='asrPrompts'&&value!=='')]){
      if(value===undefined)continue;
      if(key==='asrPrompts'){lines.push(`${t('通用背景')}\n${value.text||'—'}`);for(const [id,content] of Object.entries(value.overrides))lines.push(`${id} · ${t('服务专用覆盖')}\n${content||'—'}`);}
      else lines.push(`${t(names[key]||key)}: ${typeof value==='boolean'?t(value?'启用':'关闭选项'):value||t('默认')}`);
    }return lines.join('\n');}
    function renderDetail(fill=false){
      if(!dialog)return;const row=selectedRow();
      if(fill){find('name',dialog).value=row?.name||'';find('description',dialog).value=row?.description||'';}
      find('preview',dialog).textContent=row?preview(row.options):t('选择预设以预览');
      for(const button of dialog.querySelectorAll('[data-command]')){const action=button.dataset.command;button.disabled=busy||host.locked()||(!row&&!['new','close'].includes(action));button.hidden=['restore'].includes(action)?!row?.deleted:['load','update','rename','delete'].includes(action)&&Boolean(row?.deleted);}
      localize(dialog);
    }
    async function mutate(action,extra={}){const row=selectedRow();data=await host.request({action,...(row?{id:row.id,before:clone(row)}:{}),...extra});}
    async function command(action){
      const row=selectedRow(),name=find('name',dialog).value.trim(),description=find('description',dialog).value;
      if(action==='close'){dialog.close();return;}
      if(action==='load'){
        const result=applicable(row.options,host.context());
        if(result.applied.asrPrompts){prompts=clone(result.applied.asrPrompts);paintPrompts();}
        host.applyOptions(result.applied);host.onPrompts?.(clone(prompts));loaded=clone(row);baseline=capture();
        message(t('已加载')+' · '+row.name+(result.skipped.length?'\n'+t('未应用的参数')+': '+result.skipped.map(t).join('、'):''));dialog.close();return;
      }
      if(action==='new'){
        if(!name)throw Error(t('请填写预设名称'));
        data=await host.request({action:'save',name,description,options:capture()});selected=data.presets.at(-1).id;renderDetail(true);
      }else if(action==='update'||action==='rename')await mutate('save',{name,description,options:action==='update'?capture():row.options});
      else if(action==='copy'){
        let copyName=row.name+' · '+t('副本'),i=2;while(data.presets.some(p=>!p.deleted&&p.name===copyName))copyName=row.name+' · '+t('副本')+' '+i++;
        await mutate('copy',{name:copyName,description:row.description});selected=data.presets.at(-1).id;find('deleted',dialog).checked=false;renderDetail(true);
      }else if(action==='delete'||action==='restore'){await mutate(action,action==='restore'?{name,description}:{});message(t(action==='delete'?'已删除，可在“已删除”中恢复':'已保存'));}
      if(action==='new'||action==='update'){loaded=clone(selectedRow());baseline=capture();}
      if(loaded?.id===selected)loaded=clone(selectedRow());
    }
    async function open(){
      await load();
      if(!dialog){
        dialog=document.createElement('dialog');dialog.className='msw-asr-library';dialog.setAttribute('aria-label',t('识别预设'));
        dialog.innerHTML='<header><strong data-label="识别预设"></strong><button type="button" data-command="close" data-label="关闭"></button></header><div class="asr-library-body"><nav><input data-role="search" type="search"><label class="asr-deleted-filter"><input data-role="deleted" type="checkbox"><span data-label="已删除"></span></label><div data-role="list" class="asr-preset-list"></div></nav><section><div class="asr-preset-meta"><label><span data-label="名称"></span><input data-role="name" maxlength="80"></label><label><span data-label="描述"></span><textarea data-role="description" rows="2" maxlength="1000"></textarea></label></div><div class="asr-preset-actions"><button type="button" data-command="new" data-label="另存当前参数"></button><button type="button" data-command="rename" data-label="保存名称与描述"></button></div><details open><summary data-label="参数预览"></summary><pre data-role="preview"></pre></details><div class="asr-preset-actions"><button type="button" data-command="load" class="primary" data-label="加载预设"></button><button type="button" data-command="update" data-label="更新为当前参数"></button><button type="button" data-command="copy" data-label="复制"></button><button type="button" data-command="delete" class="danger" data-label="删除"></button><button type="button" data-command="restore" data-label="恢复"></button></div></section></div><footer><p data-role="message" role="status"></p><p data-label="加载仅修改参数，保留当前服务、模型和识别范围。"></p><p data-label="预设不包含密钥、服务地址、业务空间、路径或账号热词表。"></p></footer>';
        dialog.querySelector('footer').prepend(dialog.querySelector('.asr-library-body section > .asr-preset-actions:last-child'));
        document.body.append(dialog);find('search',dialog).setAttribute('aria-label',t('搜索预设'));
        find('search',dialog).oninput=renderList;find('deleted',dialog).onchange=()=>{selected=null;renderList();renderDetail(true);};
        dialog.addEventListener('click',event=>{const button=event.target.closest('[data-command]');if(button)void run(()=>command(button.dataset.command));});
        dialog.addEventListener('keydown',event=>event.stopPropagation());
        dialog.addEventListener('cancel',()=>host.onClose?.());
      }
      renderList();renderDetail(true);dialog.showModal();find('search',dialog).focus();
    }
    root.addEventListener('click',event=>{const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
      void run(async()=>{
        if(action==='library')await open();
        if(action==='save-prompts'){data=await host.request({action:'prompts',before:savedPrompts,value:prompts});savedPrompts=clone(data.prompts);message(t('已保存'));}
        if(action==='reload'){if(!same(prompts,savedPrompts)&&!await host.confirm(t('刷新会放弃尚未保存的背景修改。')))return;await load(true);}
      });
    });
    for(const event of ['mawe:languagechange','mswlanguage'])document.addEventListener(event,()=>{refresh();if(dialog){renderList();renderDetail();}});
    localize();refresh();
    return {load,refresh,capture,get ready(){return Boolean(data);},get prompts(){return clone(prompts);},setPrompts(value){prompts=clone(value);paintPrompts();changed();}};
  }
  global.MSWAsrPresets={create,applicable,promptFor};
  if(typeof module==='object')module.exports=global.MSWAsrPresets;
})(globalThis);
