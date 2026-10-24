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
  function prefix(project,profile) {
    if(!profile)return '';
    const show=project.preview?.speaker_label_export??project.preview?.speaker_labels_visible;
    return (typeof show==='boolean'?show:profile.mode==='speaker')?profile.name+profile.separator:'';
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
  const api = { inherit,defaults,modes,row,colorAt,valid,ensure,profile,prefix,appearance };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.MSWSpeaker = api;
})(typeof window !== 'undefined' ? window : globalThis);
