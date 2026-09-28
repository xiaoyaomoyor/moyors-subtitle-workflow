// Immutable service results plus project-owned candidate revisions.
(function (global) {
  'use strict';
  const copy = value => global.MSWProject.clone(value);
  const key = job => job.snapshot?.batch_id || job.batch_id || job.id;
  const rows = job => job.kind === 'translation' ? job.result?.translations || [] : job.result?.segments || [];
  function register(ext, jobs) {
    ext.processing_results ||= [];
    for (const job of [...jobs].sort((a,b) => a.created_at-b.created_at || a.id.localeCompare(b.id))) {
      if (!['asr','translation'].includes(job.kind)) continue;
      let batch = ext.processing_results.find(b => b.id === key(job));
      if (!batch) {
        const number = Math.max(0,...ext.processing_results.filter(b => b.kind === job.kind).map(b => b.number))+1;
        batch = {id:key(job),kind:job.kind,number,edits:[],applications:{}};
        ext.processing_results.push(batch);
      }
    }
    return ext.processing_results;
  }
  const record = (ext, job) => ext.processing_results?.find(b => b.id === key(job));
  function edit(ext, job, index, text) {
    const batch = register(ext,[job]).find(b => b.id === key(job));
    batch.edited_at=Math.max(Date.now(),(batch.edited_at||0)+1);
    batch.edits = batch.edits.filter(e => e.job_id !== job.id || e.index !== index);
    if (text !== rows(job)[index]?.text) batch.edits.push({job_id:job.id,index,text});
  }
  function candidate(ext, job) {
    const next = copy(job), edits = record(ext,job)?.edits || [];
    const output = rows(next);
    for (const entry of edits.filter(e => e.job_id === job.id)) {
      if (!output[entry.index]) continue;
      output[entry.index].text = entry.text;
      delete output[entry.index].items;
    }
    if (job.kind === 'translation') {
      // Validate the original response before accepting an edit of a preserved row.
      const skipped = global.MSWTranslation.skipped(job.snapshot,job.result);
      next.result.skipped_ids = [...skipped].filter(id => output.find(r => r.id === id)?.text === job.snapshot.entries.find(e => e.source.id === id)?.source.text);
      next.result.skipped_id_namespace = 'project';
    }
    return next;
  }
  function revision(jobs) { return JSON.stringify([...jobs].sort((a,b)=>a.id.localeCompare(b.id)).map(j => [j.id,rows(j).map(r => r.text)])); }
  function validate(value) {
    const object = v => v && typeof v === 'object' && !Array.isArray(v);
    if (!Array.isArray(value) || value.length > 10000 || new Set(value.map(b => b?.id)).size !== value.length
      || value.some(b => !object(b) || !global.MSWProject.validId(b.id) || !['asr','translation'].includes(b.kind)
        || !Number.isSafeInteger(b.number) || b.number < 1 || !Array.isArray(b.edits) || b.edits.length > 10000
        || (b.edited_at!==undefined&&(!Number.isSafeInteger(b.edited_at)||b.edited_at<0))
        || b.edits.some(e => !object(e) || !global.MSWProject.validId(e.job_id) || !Number.isSafeInteger(e.index)
          || e.index < 0 || e.index >= 10000 || typeof e.text !== 'string' || [...e.text].length > 12000)
        || !object(b.applications) || Object.entries(b.applications).some(([k,a]) => !['main','secondary','library'].includes(k)
          || !object(a) || typeof a.revision !== 'string' || a.revision.length > 4000000
          || (a.state !== undefined && !object(a.state))))) throw Error('候选结果修订记录无效');
    if (JSON.stringify(value).length > 16000000) throw Error('候选结果修订记录过大');
  }
  function store(project,jobs) {
    if (!jobs.length) throw Error('请选择已完成的批次');
    if(jobs.some(j=>j.project_id!==project.msw.project_id||j.status!=='succeeded'||key(j)!==key(jobs[0]))) throw Error('候选结果不属于当前工程或批次');
    const next = copy(project.msw), batch = record(next,jobs[0]), rev = revision(jobs);
    if (batch.applications.library?.revision === rev) return null;
    if(!batch.edits.length && jobs.every(j=>(next.asset_batches||[]).some(b=>b.result_id===j.id||b.result_ids?.includes(j.id)))) return null;
    const segments = jobs.flatMap(job => job.kind === 'translation' ? job.result.translations.map(row => {
      const source = job.snapshot.entries.find(e => e.source.id === row.id)?.source;
      return {...source,text:row.text};
    }) : job.result.segments.map((cue,i,all) => {
      const color = cue.color || all[cue.color_ref?.headIdx]?.color;
      const result = {...cue,id:`${job.id}-${i}`}; delete result.color_ref;
      if (color) result.color = copy(color); return result;
    }));
    if (!segments.length || segments.some(r => !r.text?.trim())) throw Error('候选中存在空内容，请先填写');
    const input = {segments,msw:{schema:global.MSWProject.SCHEMA,project_id:next.project_id}};
    const assets = global.MSWAssets.capture(input,{mainIds:segments.map(c => c.id)}, {kind:jobs[0].kind});
    assets.batch.name = (jobs[0].kind === 'asr' ? '识别批次' : '翻译批次')+String(batch.number).padStart(2,'0');
    assets.batch.parent_id = batch.id;
    Object.assign(next,global.MSWAssets.add(next,assets.assets,assets.batch));
    record(next,jobs[0]).applications.library = {revision:rev};
    return {extension:next,count:segments.length,batchId:assets.batch.id};
  }
  global.MSWResults = Object.freeze({key,rows,register,record,edit,candidate,revision,validate,store});
})(window);
