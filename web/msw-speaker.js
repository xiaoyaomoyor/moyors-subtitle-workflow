// Translation metadata is independent of track roles and reference formats.
(function (global) {
  'use strict';
  function inherit(source, target, colorHead = null) {
    if (source.speaker != null && !target.speaker) target.speaker = source.speaker;
    const color = source.color || colorHead?.color;
    if (color && !target.color && !target.color_ref) {
      target.color = { ...JSON.parse(JSON.stringify(color)), start: target.start, end: target.end };
    }
  }
  const defaults=[['yellow','#c4a019'],['green','#66bb6a'],['red','#f07f6f'],['purple','#bf89e6'],['blue','#61a7fa']];
  const modes=['none','text','stroke','background','speaker'];
  const languages=[['','默认名称'],['en','英文'],['zh-hans','简体中文'],['zh-hant','繁体中文'],['ja','日文'],['ko','韩文'],['fr','法文'],['de','德文'],['es','西班牙文'],['pt','葡萄牙文'],['ru','俄文'],['ar','阿拉伯文'],['it','意大利文'],['vi','越南文'],['th','泰文'],['id','印尼文'],['hi','印地文']];
  function language(value) {
    const raw=typeof value==='string'?value.trim().toLowerCase().replace(/_/g,'-'):'';
    const aliases={zh:'zh-hans','zh-cn':'zh-hans','zh-sg':'zh-hans','zh-tw':'zh-hant','zh-hk':'zh-hant','zh-mo':'zh-hant',chinese:'zh-hans',english:'en',japanese:'ja',korean:'ko'};
    const code=aliases[raw]||raw;
    return code.length<=35&&/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(code)&&!['und','mul'].includes(code)?code:'';
  }
  function displayName(profile,locale='') {
    if(!profile)return '';
    const code=language(locale),keys=[code];
    if(code.startsWith('zh-hans-'))keys.push('zh-hans');
    if(code.startsWith('zh-hant-'))keys.push('zh-hant');
    keys.push(code.split('-')[0]);
    return keys.map(k=>profile.names?.[k]).find(Boolean)||profile.name;
  }
  function nameVisible(profile,locale='') {
    const code=language(locale),keys=[code];
    if(code.startsWith('zh-hans-'))keys.push('zh-hans');
    if(code.startsWith('zh-hant-'))keys.push('zh-hant');
    keys.push(code.split('-')[0]);
    return keys.map(k=>profile?.name_visibility?.[k]).find(v=>typeof v==='boolean')??true;
  }
  // Build once per operation. Do not scan a long project's assignments for
  // every rendered cue; identity/ownership, not list columns, decides language.
  function nameResolver(project,{visibleOnly=false}={}) {
    const model=project.subtitles||project.subtitle_tracks;
    const tracks=new Map((model?.tracks||[]).map(t=>[t.id,t]));
    const owners=new Map(project.subtitles?project.subtitles.cues.map(c=>[c.id,c.track_id]):(model?.assignments||[]).map(a=>[a.cue_id,a.subtitle_track_id]));
    return (profile,cue)=>{
      const locale=tracks.get(owners.get(cue?.id))?.language;
      return visibleOnly&&!nameVisible(profile,locale)?'':displayName(profile,locale);
    };
  }
  function languageOptions(project) {
    const extra=[...(project.subtitles?.tracks||project.subtitle_tracks?.tracks||[]).map(t=>language(t.language)),
      ...(project.preview?.speaker_palette?.rows||[]).flatMap(r=>[...Object.keys(r.names||{}),...Object.keys(r.name_visibility||{})])];
    const result=languages.map(r=>r.slice()),known=new Set(result.map(r=>r[0]));
    for(const code of extra)if(code&&!known.has(code)){let label=code;try{label=new Intl.DisplayNames(['zh'],{type:'language'}).of(code)||code;}catch(_){}result.push([code,label]);known.add(code);}
    return result;
  }
  const cueStyle=()=>global.MSWCueStyle||(typeof require==='function'?require('./msw-cue-style.js'):null);
  const motion=()=>global.MSWSubtitleAnimation||(typeof require==='function'?require('./msw-subtitle-animation.js'):null);
  const safeText=(value,max,fallback='')=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,max):fallback;
  function colorAt(i) {
    if(i<defaults.length)return defaults[i][1];
    const h=(i*137.508)%360,s=.55,l=.62,a=s*Math.min(l,1-l);
    return '#'+[0,8,4].map(n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');}).join('');
  }
  const row=(i,id=defaults[i]?.[0]||'speaker-'+(i+1))=>({id,name:'SP'+(i+1),color:colorAt(i),mode:'none',separator:'：'});
  function valid(value) {
    return value?.version===1&&Array.isArray(value.rows)&&value.rows.length>=1&&value.rows.length<=1024
      &&new Set(value.rows.map(r=>r?.id)).size===value.rows.length&&value.rows.every(r=>r&&typeof r.id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(r.id)
        &&typeof r.name==='string'&&r.name.trim()&&r.name.length<=64&&!/[\u0000-\u001f\u007f]/.test(r.name)
        &&(r.scheme_ref===undefined||r.scheme_ref&&Object.keys(r.scheme_ref).length===2
          &&['scheme_id','person_id'].every(k=>typeof r.scheme_ref[k]==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(r.scheme_ref[k])))
        &&(r.names===undefined||r.names&&typeof r.names==='object'&&!Array.isArray(r.names)&&Object.keys(r.names).length<=64
          &&Object.entries(r.names).every(([k,v])=>k&&k===language(k)&&typeof v==='string'&&v.trim()&&v.length<=64&&!/[\u0000-\u001f\u007f]/.test(v)))
        &&(r.name_visibility===undefined||r.name_visibility&&typeof r.name_visibility==='object'&&!Array.isArray(r.name_visibility)&&Object.keys(r.name_visibility).length<=65
          &&Object.entries(r.name_visibility).every(([k,v])=>k===language(k)&&typeof v==='boolean'))
        &&/^#[\da-f]{6}$/i.test(r.color)&&modes.includes(r.mode)&&typeof r.separator==='string'&&r.separator.length<=16&&!/[\u0000-\u001f\u007f]/.test(r.separator)
        &&(r.style===undefined||cueStyle()?.valid(r.style))&&(r.animation===undefined||motion()?.valid(r.animation))
        &&(r.style_preset===undefined||typeof r.style_preset==='string'&&r.style_preset.length<=160));
  }
  function ensure(project,legacyColors=null,discover=false) {
    project.preview||={};
    if(project.preview.speaker_palette) {
      if(!valid(project.preview.speaker_palette))throw Error('说话人色系配置无效');
    } else {
      const old=project.preview.subtitle||{},labels=old.speaker_labels||{};
      const groups=project.subtitles?.cues?[project.subtitles.cues.map(c=>c.content)]:[project.segments||[],...(project.multi_subtitle?.tracks||[]).map(t=>t.segments||[]),project.overlay_track?.segments||[]];
      const marked=new Set(groups.flatMap(g=>g.map(c=>c.color?.name||c.color_ref?.name)).filter(Boolean));
      const rows=defaults.map((_,i)=>row(i));
      for(const id of marked)if(!rows.some(r=>r.id===id)&&/^[a-zA-Z0-9_-]{1,160}$/.test(id))rows.push(row(rows.length,id));
      for(const r of rows) {
        r.name=safeText(labels.names?.[r.id],64,r.name).trim()||r.name;
        r.separator=safeText(labels.separator,16,'：');
        const color=legacyColors?.[r.id]||(project.color_palette||[]).find(c=>c.name===r.id)?.value
          ||groups.flatMap(g=>g).find(c=>c.color?.name===r.id)?.color.value;
        if(/^#[\da-f]{6}$/i.test(color))r.color=color;
        if(marked.has(r.id))r.mode=modes.includes(old.ass_color_style)?old.ass_color_style:'text';
      }
      project.preview.speaker_palette={version:1,rows};
    }
    const palette=project.preview.speaker_palette;
    if(discover) {
      const groups=project.subtitles?.cues?[project.subtitles.cues.map(c=>c.content)]:[project.segments||[],...(project.multi_subtitle?.tracks||[]).map(t=>t.segments||[]),project.overlay_track?.segments||[]];
      const known=new Set(palette.rows.map(r=>r.id));
      for(const cues of groups)for(const cue of cues) {
        const mark=cue.color||cue.color_ref,id=mark?.name;
        if(!id||known.has(id)||!/^[a-zA-Z0-9_-]{1,160}$/.test(id)||palette.rows.length>=1024)continue;
        const next=row(palette.rows.length,id);next.mode='text';
        if(/^#[\da-f]{6}$/i.test(mark.value))next.color=mark.value;
        palette.rows.push(next);known.add(id);
      }
    }
    return palette;
  }
  function profile(project,cue,head=null) {
    const name=cue?.color?.name||head?.color?.name||cue?.color_ref?.name;
    return project.preview?.speaker_palette?.rows.find(r=>r.id===name)||null;
  }
  function prefix(project,profile,locale='') {
    if(!profile)return '';
    const show=project.preview?.speaker_label_export??project.preview?.speaker_labels_visible;
    return (typeof show==='boolean'?show:profile.mode==='speaker')&&nameVisible(profile,locale)?displayName(profile,locale)+profile.separator:'';
  }
  function appearance(style,cue,profile) {
    if(!profile)return {...style};
    const result={...style},field={text:'primaryColor',stroke:'outlineColor',background:'backgroundColor'}[profile.mode];
    if(field&&!Object.hasOwn(cue?.subtitle_style||{},field))result[field]=profile.color;
    if(profile.mode==='background') {
      if(!Object.hasOwn(cue?.subtitle_style||{},'backgroundShape')&&(!result.backgroundShape||result.backgroundShape==='none'))result.backgroundShape='rounded';
      if(!Object.hasOwn(cue?.subtitle_style||{},'backgroundOpacity')&&!result.backgroundOpacity)result.backgroundOpacity=80;
    }
    Object.assign(result,profile.style||{},cue?.subtitle_style||{});
    if(profile.animation)result.animation=motion().resolve(style.animation,profile.animation);
    return result;
  }
  const api = { inherit,defaults,modes,languages,language,displayName,nameVisible,nameResolver,languageOptions,row,colorAt,valid,ensure,profile,prefix,appearance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MSWSpeaker = api;
})(typeof window !== 'undefined' ? window : globalThis);
