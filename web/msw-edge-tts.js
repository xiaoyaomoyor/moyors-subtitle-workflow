(function(global){
  'use strict';
  function create({el,t,request,updateScope}){
    let data={voices:[],dependency:{ready:false}},busy=false,attempted=false,pending=null;
    const panel=el('tts-edge-fields'),env=el('tts-edge-management'),fields={};
    function field(parent,key,title,type){const l=document.createElement('label');l.className='msw-processing-field';
      const s=document.createElement('span');s.textContent=t(title);const f=document.createElement(type==='select'?'select':'input');if(type!=='select')f.type=type;
      f.id='tts-edge-'+key;l.append(s,f);parent.append(l);fields[key]=f;return f;}
    const grid=document.createElement('div');grid.className='msw-processing-grid';panel.append(grid);
    const lang=field(grid,'language','筛选语言','select'),search=field(grid,'search','搜索音色','search');
    const voice=field(panel,'voice','音色','select');
    const adjustments=document.createElement('div');adjustments.className='msw-processing-grid';panel.append(adjustments);
    for(const [key,title,min,max,unit] of [['rate','语速变化',-50,100,'%'],['volume','合成音量变化',-100,100,'%'],['pitch','音高变化',-100,100,'Hz']]){
      const f=field(adjustments,key,title,'range');Object.assign(f,{min:String(min),max:String(max),step:'1',value:'0'});
      const o=document.createElement('output');o.id='tts-edge-'+key+'-value';o.textContent='+0'+unit;f.parentElement.firstChild.append(' · ',o);
      f.oninput=()=>{o.textContent=(Number(f.value)>=0?'+':'')+f.value+unit;updateScope();};
    }
    const hint=document.createElement('p');hint.className='msw-processing-hint';hint.id='tts-edge-call-status';panel.append(hint);
    const info=document.createElement('p');info.className='msw-processing-message';info.id='tts-edge-status';info.setAttribute('role','status');env.append(info);
    const timeout=field(env,'timeout','单次等待上限（秒）','number');timeout.min='30';timeout.max='600';timeout.value='120';
    const envActions=document.createElement('div');envActions.className='msw-processing-actions';env.append(envActions);
    const panelActions=document.createElement('div');panelActions.className='msw-processing-actions';panel.append(panelActions);
    const refresh=document.createElement('button');refresh.type='button';refresh.id='tts-edge-refresh';refresh.textContent=t('检测连接／刷新音色');envActions.append(refresh);
    const quick=document.createElement('button');quick.type='button';quick.id='tts-edge-refresh-panel';quick.textContent=t('刷新音色');panelActions.append(quick);
    async function reload(){if(pending)return pending;attempted=true;busy=true;refresh.disabled=quick.disabled=true;
      info.textContent=hint.textContent=t('正在验证连接并加载音色…');info.setAttribute('aria-busy','true');hint.setAttribute('aria-busy','true');
      refresh.textContent=quick.textContent=t('正在验证…');updateScope();
      pending=(async()=>{try{
      const current=recipe(),out=await request('edge-tts',{action:'refresh'});configure({...out,recipe:current,timeout:Number(timeout.value)});
      info.textContent=hint.textContent=`${t('在线音色已更新')} · ${data.voices.length}`;
    }catch(e){info.textContent=hint.textContent=e.message;}finally{busy=false;pending=null;refresh.disabled=quick.disabled=false;refresh.textContent=t('检测连接／刷新音色');quick.textContent=t('刷新音色');info.setAttribute('aria-busy','false');hint.setAttribute('aria-busy','false');updateScope();}})();return pending;}
    refresh.onclick=quick.onclick=reload;
    function renderVoices(current=voice.value){const query=search.value.trim().toLowerCase();const rows=data.voices.filter(v=>(!lang.value||v.language===lang.value)&&`${v.name} ${v.id} ${v.gender}`.toLowerCase().includes(query));
      voice.replaceChildren(...rows.map(v=>new Option(`${v.id} · ${v.gender}`,v.id)));
      if(current&&!rows.some(v=>v.id===current))voice.add(new Option(current,current),0);voice.value=current;
      hint.textContent=data.dependency.ready?(data.voices.length?'':t('在线服务，无需 API Key；可刷新音色列表')):t(data.dependency.message||'尚未检测 Edge 依赖');updateScope();}
    lang.onchange=search.oninput=()=>renderVoices();voice.onchange=updateScope;
    function recipe(){return {provider:'edge',model:'edge-online',voice:voice.value||'zh-CN-XiaoxiaoNeural',language_type:(voice.value||'zh-CN-XiaoxiaoNeural').split('-').slice(0,-1).join('-'),rate:Number(fields.rate.value),volume:Number(fields.volume.value),pitch:Number(fields.pitch.value)};}
    function configure(value){data={...data,...value};const r=data.recipe||recipe();const previous=lang.value;
      lang.replaceChildren(new Option(t('全部语言'),''),...[...new Set(data.voices.map(v=>v.language))].sort().map(v=>new Option(v,v)));lang.value=previous;
      for(const key of ['rate','volume','pitch']){fields[key].value=String(r[key]||0);fields[key].oninput();}
      timeout.value=String(data.timeout||120);info.textContent=t(data.dependency.message||'');renderVoices(r.voice);}
    function ensureVoices(){if(!attempted&&!data.voices.length&&data.dependency.ready)void reload();}
    return {configure,recipe,ensureVoices,connection:()=>({timeout:Number(timeout.value)}),ready:()=>!busy&&data.dependency.ready&&!!voice.value,
      problem:()=>data.dependency.ready?'':data.dependency.message||'尚未检测 Edge 依赖'};
  }
  global.MSWEdgeTts=Object.freeze({create});
})(window);
