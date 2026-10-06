// Shared keyed batch view. Polling updates status nodes, never active text fields.
(function(global) {
  'use strict';
  const model=global.MSWResults, t=s => global.MSWE_I18N?.translateText?.(s)||s;
  const node=(tag,cls,text) => {const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=t(text);return n;};
  const labels={queued:'等待处理',running:'正在处理',cancel_requested:'正在取消',succeeded:'处理完成',failed:'处理失败',cancelled:'已取消',interrupted:'服务中断'};
  function create({host,kind,container,footer,count,onApply,onStore,onCancel,onRetry,onMessage}) {
    const cards=new Map();let selected=null,current=[],rawJobs=[],restored=null;
    const prefix=kind==='asr'?'识别':'翻译',id=kind==='asr'?'msw-asr':'translation';
    const selectedLabel=node('small','msw-result-current');selectedLabel.id=`${id}-selected`;
    const actions=node('div','msw-result-actions');
    const primary=node('button','','覆盖主字幕'),secondary=node('button','','覆盖副字幕'),store=node('button','','存入素材库');
    primary.id=`${id}-apply`;secondary.id=`${id}-secondary`;store.id=`${id}-store`;
    const menus=new Map();
    for(const [button,target] of [[primary,'main'],[secondary,'secondary']]) {
      button.type='button';const wrap=node('div','msw-result-target'),select=node('select');
      select.setAttribute('aria-label',t(target==='main'?'覆盖主字幕策略':'覆盖副字幕策略'));
      const title=target==='main'?'主字幕':'副字幕';
      select.append(new Option(t(`覆盖${title}…`),''),new Option(t(`替换涉及的整条${title}`),'whole'),new Option(t('仅替换选区内，保留区外部分'),'trim'));
      button.onclick=()=>perform(()=>onApply(chosen(),target,null));
      select.onchange=()=>{const strategy=select.value;select.value='';if(strategy)void perform(()=>onApply(chosen(),target,strategy));};
      wrap.append(button,select);actions.append(wrap);menus.set(target,{button,select});
    }
    store.type='button';store.onclick=()=>perform(()=>onStore(chosen()));actions.append(store);
    footer.classList.add('msw-result-footer');footer.replaceChildren(selectedLabel,actions);
    const chosen=()=>current.filter(j => model.key(j)===selected && j.status==='succeeded' && j.result);
    async function perform(fn) {
      for(const n of actions.querySelectorAll('button,select'))n.disabled=true;
      try {await fn();}catch(e){onMessage(e.message,true);}finally{refresh();}
    }
    function persist() {
      host.touchProcessing();
      try {localStorage.setItem(`msw.processing.drafts.${host.data.msw.project_id}`,JSON.stringify(host.data.msw.processing_results.map(({id,kind,number,edits,edited_at})=>({id,kind,number,edits,edited_at,applications:{}}))));}
      catch {onMessage('候选暂存空间不足，请保存工程',true);}
    }
    function restore() {
      const projectId=host.data.msw.project_id;if(restored===projectId)return;
      restored=projectId;cards.clear();container.replaceChildren();selected=null;
      mergeDrafts();
    }
    function mergeDrafts() {
      const projectId=host.data.msw.project_id;
      try {
        const drafts=JSON.parse(localStorage.getItem(`msw.processing.drafts.${projectId}`)||'[]');model.validate(drafts);
        host.data.msw.processing_results ||= [];
        for(const b of drafts) {
          const existing=host.data.msw.processing_results.find(r=>r.id===b.id);
          if(existing){if((b.edited_at||0)>(existing.edited_at||0)){existing.edits=b.edits;existing.edited_at=b.edited_at;}}
          else host.data.msw.processing_results.push(b);
        }
      }catch {onMessage('候选暂存无法恢复，已保留工程中的结果',true);}
    }
    function refresh() {
      const jobs=chosen(),batch=host.data.msw.processing_results?.find(b=>b.id===selected);
      selectedLabel.textContent=t('当前批次：')+(batch?t(prefix+'批次')+String(batch.number).padStart(2,'0'):t('未选择'));
      const invalid=!jobs.length || jobs.some(j=>!model.rows(j).length||model.rows(j).some(r=>!r.text?.trim()));
      for(const [target,{button,select}] of menus) {
        const crossing=kind==='asr' && jobs.length && global.MSWResultApply.crossing(host.data,jobs,target);
        let issue='';
        if(!invalid) try {
          const plan=global.MSWResultApply.plan(host.data,global.MSWE.resolve('media')?.current,jobs,target,crossing?'trim':null);
          if(plan.duplicate)issue=t('此修订已应用到当前目标');
        }catch(error){if(error.code!=='choose-targets')issue=error.message;}
        button.hidden=Boolean(crossing);select.hidden=!crossing;
        button.disabled=select.disabled=invalid||Boolean(issue);button.title=select.title=issue;
      }
      store.disabled=invalid||batch?.applications.library?.revision===model.revision(jobs);
      for(const [key,card] of cards){card.radio.checked=key===selected;card.root.classList.toggle('is-selected',key===selected);}
    }
    function render(jobs) {
      rawJobs=jobs;
      restore();
      const before=host.data.msw.processing_results?.length||0;
      model.register(host.data.msw,jobs);
      if(host.data.msw.processing_results.length!==before)persist();
      current=[...jobs].sort((a,b)=>a.created_at-b.created_at||a.id.localeCompare(b.id)).map(j=>j.result?model.candidate(host.data.msw,j):j);
      const groups=new Map();for(const j of current){const k=model.key(j);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(j);}
      const sorted=[...groups].sort((a,b)=>model.record(host.data.msw,b[1][0]).number-model.record(host.data.msw,a[1][0]).number);
      for(const [key,members] of sorted) {
        let card=cards.get(key);
        if(!card) {
          const root=node('article','msw-result-batch'),header=node('div','msw-result-header'),toggle=node('button','msw-result-toggle');
          root.dataset.batchId=key;toggle.type='button';toggle.setAttribute('aria-expanded','false');
          const title=node('span'),arrow=node('span','msw-result-chevron');arrow.setAttribute('aria-hidden','true');toggle.append(arrow,title);
          const label=node('label','msw-result-choice'),radio=node('input');radio.type='radio';radio.name=`${id}-batch`;label.append(radio,t('选择结果'));
          const body=node('div','msw-result-body'),status=node('small','msw-result-status'),list=node('div','msw-result-rows'),controls=node('div','msw-result-job-actions');body.hidden=!members.some(j=>['queued','running','cancel_requested'].includes(j.status));
          toggle.setAttribute('aria-expanded',String(!body.hidden));
          const more=node('button','msw-result-more','显示更多结果');more.type='button';more.hidden=true;
          body.append(status,controls,list,more);header.append(toggle,label);root.append(header,body);
          card={root,title,radio,body,status,list,controls,more,rows:new Map(),limit:50};cards.set(key,card);container.append(root);
          toggle.onclick=()=>{body.hidden=!body.hidden;toggle.setAttribute('aria-expanded',String(!body.hidden));if(!body.hidden)fill(card);};
          radio.onchange=()=>{selected=key;onMessage('');refresh();};
          more.onclick=()=>{card.limit+=50;fill(card);};
        }
        card.members=members;card.raw=jobs.filter(j=>model.key(j)===key);
        const batch=model.record(host.data.msw,members[0]);card.title.textContent=t(prefix+'批次')+String(batch.number).padStart(2,'0');
        card.radio.disabled=!members.some(j=>j.result&&model.rows(j).length);
        card.status.textContent=members.map(j=>`${t(labels[j.status]||j.status)}${j.error?' · '+j.error:''}${j.result&&!model.rows(j).length?' · '+t('没有识别到语音；保留现有字幕'):''}${j.progress?.message?' · '+t(j.progress.message):''}${j.result?.warnings?.length?' · '+j.result.warnings.join('；'):''}`).join(' / ');
        // Replace only task controls if status actually changed.
        const statusKey=members.map(j=>[j.id,j.status,j.retry_active]).join('|');
        if(card.statusKey!==statusKey) {
          card.statusKey=statusKey;card.controls.replaceChildren();
          for(const j of members) {
            const cancel=['queued','running','cancel_requested'].includes(j.status),retry=['failed','cancelled','interrupted'].includes(j.status);
            if(!cancel&&!retry)continue;
            const action=node('button','',cancel?'取消任务':j.retry_active?'正在重试':'使用此范围重试');action.type='button';
            action.onclick=()=>perform(()=>cancel?onCancel(j):onRetry(j));action.disabled=retry&&(!onRetry||j.retry_active);card.controls.append(action);
          }
        }
        if(!card.body.hidden)fill(card);
      }
      // Insertion order changes only for new batches; never detach existing editors.
      sorted.forEach(([key],i)=>{cards.get(key).root.style.order=String(i);});
      count.textContent=String(groups.size);refresh();
    }
    function fill(card) {
      const entries=card.members.filter(j=>j.result).flatMap(job=>model.rows(job).map((row,index)=>({job,row,index})));
      entries.slice(0,card.limit).forEach(({job,row,index},ordinal)=>{
        const key=`${job.id}:${index}`;let entry=card.rows.get(key);
        if(!entry) {
          const root=node('div','msw-result-row'),info=node('div','msw-result-row-info'),title=node('strong');
          title.textContent=t(prefix)+String(ordinal+1).padStart(3,'0');
          const detail=node('div','msw-result-row-detail');detail.textContent=kind==='asr'?`${(row.start/1000).toFixed(3)}–${(row.end/1000).toFixed(3)} s${job.snapshot.source?.kind==='clip'?'\n'+job.snapshot.source.name:''}`:job.snapshot.entries.find(e=>e.source.id===row.id)?.source.text||'';
          const preserved=node('small','msw-processing-hint','原文保留');
          const text=node('textarea');text.rows=2;text.maxLength=12000;text.value=row.text;text.setAttribute('aria-label',title.textContent);
          const error=node('small','msw-result-row-error','请填写内容');error.hidden=Boolean(row.text.trim());
          text.oninput=()=>{
            const raw=card.raw.find(j=>j.id===job.id);model.edit(host.data.msw,raw,index,text.value);
            error.hidden=Boolean(text.value.trim());persist();current=current.map(j=>j.id===job.id?model.candidate(host.data.msw,raw):j);
            card.members=current.filter(j=>model.key(j)===model.key(job));
            preserved.hidden=kind!=='translation'||!current.find(j=>j.id===job.id)?.result.skipped_ids?.includes(row.id);refresh();
          };
          // Text editing has its own browser undo history, not timeline undo.
          text.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase()))e.stopPropagation();});
          const field=node('div','msw-result-row-field');field.append(text,error);info.append(title,detail,preserved);root.append(info,field);card.list.append(root);entry={root,text,error,preserved};card.rows.set(key,entry);
        }
        entry.preserved.hidden=kind!=='translation'||!job.result.skipped_ids?.includes(row.id);
        if(document.activeElement!==entry.text && entry.text.value!==row.text)entry.text.value=row.text;
      });
      card.more.hidden=card.limit>=entries.length;
    }
    global.addEventListener('msw:subtitles-changed',()=>{
      if(rawJobs.length&&restored===host.data.msw?.project_id){mergeDrafts();render(rawJobs);}
    });
    return {render,refresh,reset:()=>{restored=null;current=[];rawJobs=[];},choose:job=>{
      selected=model.key(job);const card=cards.get(selected);
      if(card){card.body.hidden=false;card.root.querySelector('.msw-result-toggle').setAttribute('aria-expanded','true');fill(card);}
      refresh();
    },get selected(){return selected;}};
  }
  global.MSWResultView=Object.freeze({create});
})(window);
