// Reusable speaker descriptions; project color IDs are never cross-project IDs.
(function(global){
  'use strict';
  const speaker=global.MSWSpeaker||(typeof require==='function'?require('./msw-speaker.js'):null);
  const clone=v=>JSON.parse(JSON.stringify(v));
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  const signature=v=>JSON.stringify(canonical(v));
  const fields=['name','names','name_visibility','color','mode','separator','style','animation'];
  const identity=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(v);
  const describe=row=>Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,clone(row[k])]));
  function validScheme(s){
    return s&&Object.keys(s).every(k=>['id','name','rows'].includes(k))&&identity(s.id)
      &&typeof s.name==='string'&&s.name.trim()&&s.name.length<=80&&!/[\u0000-\u001f\u007f]/.test(s.name)
      &&speaker.valid({version:1,rows:s.rows})&&s.rows.every(r=>Object.keys(r).every(k=>k==='id'||fields.includes(k)));
  }
  function validate(library){
    if(!library||Object.keys(library).some(k=>!['version','schemes'].includes(k))||library.version!==1
      ||!Array.isArray(library.schemes)||library.schemes.length>64||!library.schemes.every(validScheme)
      ||new Set(library.schemes.map(s=>s.id)).size!==library.schemes.length
      ||new Set(library.schemes.map(s=>s.name)).size!==library.schemes.length)throw Error('说话人方案库无效（最多 64 个方案）');
    return library;
  }
  function checkPalette(p){if(!speaker.valid(p))throw Error('说话人色系配置无效');}
  function suggestions(palette,scheme){
    checkPalette(palette);if(!validScheme(scheme))throw Error('说话人方案无效');
    const people=new Set(scheme.rows.map(r=>r.id));
    return Object.fromEntries(palette.rows.map(r=>[r.id,r.scheme_ref?.scheme_id===scheme.id&&people.has(r.scheme_ref.person_id)?r.scheme_ref.person_id:'']));
  }
  function apply(palette,scheme,mapping,{addMissing=false,makeId}={}){
    checkPalette(palette);if(!validScheme(scheme))throw Error('说话人方案无效');
    const ids=new Set(palette.rows.map(r=>r.id)),people=new Map(scheme.rows.map(r=>[r.id,r]));
    if(!mapping||typeof mapping!=='object'||Array.isArray(mapping)||Object.entries(mapping).some(([id,to])=>!ids.has(id)||typeof to!=='string'||to&&!people.has(to)))throw Error('说话人对应关系已失效，请重新选择');
    const next=clone(palette),used=new Set();let updated=0,added=0;
    for(const row of next.rows){
      const to=mapping[row.id];if(!to)continue;
      used.add(to);const before=signature(row);
      for(const key of [...fields,'style_preset'])delete row[key];
      Object.assign(row,describe(people.get(to)),{scheme_ref:{scheme_id:scheme.id,person_id:to}});
      if(signature(row)!==before)updated++;
    }
    if(addMissing)for(const person of scheme.rows){
      if(used.has(person.id)||next.rows.some(r=>r.scheme_ref?.scheme_id===scheme.id&&r.scheme_ref.person_id===person.id))continue;
      const id=makeId?.();if(!identity(id)||ids.has(id))throw Error('无法创建独立说话人编号');ids.add(id);
      next.rows.push({id,...describe(person),scheme_ref:{scheme_id:scheme.id,person_id:person.id}});added++;
    }
    checkPalette(next);return {palette:next,updated,added};
  }
  // Overwrite updates linked people and keeps absent cast members. Adding
  // unassigned people is explicit, so unused SP rows do not accumulate.
  // Multiple recognition IDs may map to one person. Conflicting descriptions must
  // be resolved in the project instead of silently letting the last row win.
  function capture(palette,{id,name,previous=null,makeId,includeUnmapped=!previous}){
    checkPalette(palette);if(previous&&(!validScheme(previous)||previous.id!==id))throw Error('说话人方案已变化');
    const scheme=previous?clone(previous):{id,name,rows:[]};scheme.name=name;
    const rows=new Map(scheme.rows.map(r=>[r.id,r])),written=new Map(),linked=clone(palette);
    for(const row of linked.rows){
      const ref=row.scheme_ref;
      let personId=ref?.scheme_id===id&&rows.has(ref.person_id)?ref.person_id:null;
      if(!personId&&!includeUnmapped)continue;
      if(!personId){personId=makeId();if(!identity(personId)||rows.has(personId))throw Error('无法创建方案说话人编号');}
      const person={id:personId,...describe(row)},value=signature(person);
      if(written.has(personId)&&written.get(personId)!==value)throw Error('同一方案说话人对应的多行配置不同，请先统一或另存为新方案');
      written.set(personId,value);rows.set(personId,person);row.scheme_ref={scheme_id:id,person_id:personId};
    }
    scheme.rows=[...rows.values()];if(!validScheme(scheme))throw Error('说话人方案名称或内容无效');
    return {scheme,palette:linked};
  }
  const api={validate,validScheme,describe,suggestions,apply,capture};
  global.MSWSpeakerSchemes=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
