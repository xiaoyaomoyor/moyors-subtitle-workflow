// Project styles are snapshots. Library presets and proofreading never mutate them.
(function(global) {
  'use strict';
  const U = global.AsrEditorUtils;
  const clone = value => JSON.parse(JSON.stringify(value));
  const schema = 'msw.subtitle-style.v1';
  function normalize(raw = {}) {
    return {schema, name: String(raw.name || '默认白字').slice(0, 80),
      main: U.normalizeAssStyle(raw.main || {}, U.ASS_DEFAULT_ASS_STYLE, 'main'),
      secondary: U.normalizeAssStyle(raw.secondary || {}, U.ASS_DEFAULT_EXTENSION_STYLE, 'secondary'),
      animations: U.normalizeAssAnimations(raw.animations),
      ...(raw.legacyBurn ? {legacyBurn: clone(raw.legacyBurn)} : {})};
  }
  function defaults() {
    return normalize({main:{fontSize:48,marginV:108,marginL:96,marginR:96},
      secondary:{fontSize:40,marginV:48,marginL:96,marginR:96}});
  }
  function fromLibrary(raw, profileId) {
    const library = U.normalizeAssStyleLibrary(raw);
    const profile = U.assProfileForId(library, profileId || library.assignments.assExportProfileId);
    return normalize({name:profile.name,main:U.assStyleForId(library,profile.styleId),
      secondary:U.assStyleForId(library,library.assignments.assExtensionStyleId),animations:profile.animations});
  }
  function toLibrary(style) {
    const s=normalize(style);
    return U.normalizeAssStyleLibrary({styles:[{...s.main,id:'project-main'},{...s.secondary,id:'project-secondary'}],
      assProfiles:[{id:'project',name:s.name,styleId:'project-main',animations:s.animations}],
      assignments:{assExportProfileId:'project',assExtensionStyleId:'project-secondary'}});
  }
  const family = value => ({default:U.ASS_DEFAULT_ASS_STYLE.fontName, sans:'Arial', yahei:'Microsoft YaHei',hei:'SimHei',song:'SimSun'}[value] || value || U.ASS_DEFAULT_ASS_STYLE.fontName);
  function fromBurn(raw = {}) {
    const s = defaults(); s.name='旧工程烧录样式'; s.legacyBurn=clone(raw);
    for(const [role,size,y] of [['main',48,.86],['secondary',40,.94]]) {
      const b={font_family:'Arial',font_size:size,color:'#ffffff',outline_color:'#000000',outline:2,background_color:'#000000',background_alpha:0,x:.5,y,width:.8,...raw[role]};
      s[role]={...s[role],fontName:b.font_family,fontSize:b.font_size,primaryColor:b.color,outlineColor:b.outline_color,outline:b.outline,
        backColor:b.background_color,borderStyle:b.background_alpha>0?3:1,marginL:Math.round(Math.max(0,b.x-b.width/2)*1920),
        marginR:Math.round(Math.max(0,1-b.x-b.width/2)*1920),marginV:Math.round((1-b.y)*1080),alignment:2};
    }
    return normalize(s);
  }
  function fromPreview(preview={}) {
    const s=defaults(); s.name='旧工程预览样式';
    for(const [role,key] of [['main','subtitle'],['secondary','extension_subtitle']]) {
      const p=preview[key] || {};
      s[role]={...s[role],fontName:family(p.font_family),fontSize:(p.font_size || (role==='main'?18:16))*4,primaryColor:p.color||s[role].primaryColor};
    }
    return normalize(s);
  }
  function migrate(project, library, originalPreview=project.preview||{}) {
    project.preview ||= {};
    if(project.preview.project_style?.schema===schema) return false;
    if(project.preview.project_style!=null)throw Error('工程字幕样式版本不受支持，请使用兼容的编辑器');
    const p=project.preview;
    const old=Object.keys(originalPreview).some(k=>['subtitle','extension_subtitle','burn_subtitles','ass_library_exports'].includes(k));
    p.project_style=originalPreview.ass_library_exports===true?fromLibrary(originalPreview.burn_ass_library || library):old?fromBurn(originalPreview.burn_subtitles):defaults();
    if(old) p.style_migration={version:1,presets:[fromPreview(originalPreview),fromLibrary(library)],
      source:originalPreview.ass_library_exports===true?'ass':'burn',notice:true};
    return true;
  }
  function presets() {
    const normal=defaults();
    return [{id:'default',...normal},
      {id:'large',...normalize({...normal,name:'大字清晰',main:{...normal.main,fontSize:72,outline:3},secondary:{...normal.secondary,fontSize:56}})},
      {id:'contrast',...normalize({...normal,name:'高对比底框',main:{...normal.main,borderStyle:3,outline:5,backColor:'#000000'},secondary:{...normal.secondary,borderStyle:3,outline:4}})},
      {id:'bilingual',...normalize({...normal,name:'双语紧凑',main:{...normal.main,fontSize:44,marginV:100},secondary:{...normal.secondary,fontSize:36,marginV:48}})}];
  }
  function apply(project, style) { project.preview ||= {}; project.preview.project_style=normalize(style); }
  // Preserve the old two-pass translucent background even in portable exports.
  // This mirrors subtitle_style.styled_ass's legacy branch, using the shared layout.
  function buildLegacyAss(project, options={}) {
    const raw=project.preview?.project_style?.legacyBurn;if(!raw)return null;
    const styles={};
    for(const [role,size,y] of [['main',48,.86],['secondary',40,.94]])styles[role]={font_family:'Arial',font_size:size,color:'#ffffff',outline_color:'#000000',outline:2,background_color:'#000000',background_alpha:0,x:.5,y,width:.8,...raw[role]};
    if(project.overlay_track?.enabled){const anchor=project.multi_subtitle?.enabled?styles.secondary:styles.main;styles.overlay={...styles.main,y:Math.max(.05,anchor.y-1.2*anchor.font_size/1080)};}
    const width=Math.round(options.playResX||1920),target=options.target||'both';
    const color=(hex,alpha=0)=>`&H${Math.round(alpha).toString(16).padStart(2,'0')}${hex.slice(5,7)}${hex.slice(3,5)}${hex.slice(1,3)}`.toUpperCase();
    const time=ms=>{const cs=Math.max(0,Math.round(ms/10));return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;};
    const escape=text=>String(text||'').replaceAll('\\','\\\\').replaceAll('{','\\{').replaceAll('}','\\}').replace(/\r\n|\r|\n/g,'\\N');
    const lines=['[Script Info]',`Title: ${String(options.title||'MSW').replace(/[\r\n]/g,' ')}`,'ScriptType: v4.00+',`PlayResX: ${width}`,'PlayResY: 1080','ScaledBorderAndShadow: yes','WrapStyle: 0','','[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'];
    for(const [name,s] of Object.entries(styles))for(const background of [false,true]){
      const primary=color(s.color,background?255:0),border=background?color(s.background_color,(1-s.background_alpha)*255):color(s.outline_color);
      lines.push(`Style: ${name}${background?'-bg':''},${s.font_family},${s.font_size},${primary},${primary},${border},${border},0,0,0,0,100,100,0,0,${background?3:1},${background?6:s.outline},0,2,${Math.round(Math.max(0,s.x-s.width/2)*width)},${Math.round(Math.max(0,1-s.x-s.width/2)*width)},${Math.round((1-s.y)*1080)},1`);
    }
    lines.push('','[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
    const layout=project.schema==='msw.project.v2'?global.MSWSubtitlePresentation.layout(project,styles,target,width):null;
    const groups={main:project.segments||[],secondary:project.multi_subtitle?.enabled?project.multi_subtitle.tracks?.[0]?.segments||[]:[],overlay:project.overlay_track?.enabled?project.overlay_track.segments||[]:[]};
    const map=options.mapTime||((v)=>v);
    for(const [name,cues] of Object.entries(groups)){
      if(target!=='both'&&target!==name&&name!=='overlay')continue;
      const s=styles[name];if(!s)continue;
      const first=options.alignFirstStart&&name=== (target==='secondary'?'secondary':'main')?U.getSrtExportFirstIndex(cues,true):-1;
      cues.forEach((cue,index)=>{
        if(cue.disabled||!String(cue.text||'').trim()||(layout&&name==='main'&&!global.MSWSubtitlePresentation.visible(project,cue)))return;
        const start=index===first?0:map(cue.start),end=map(cue.end);if(end<=start)return;
        const offset=layout?.offsets.get(global.MSWSubtitlePresentation.key(name,cue.id))?.offset||0;
        const margin=layout?Math.round((1-s.y)*1080+offset):0,text=escape(cue.text);
        if(s.background_alpha>0)lines.push(`Dialogue: 0,${time(start)},${time(end)},${name}-bg,,0,0,${margin},,${text}`);
        lines.push(`Dialogue: 1,${time(start)},${time(end)},${name},,0,0,${margin},,${text}`);
      });
    }
    return lines.join('\n')+'\n';
  }
  global.MSWProjectStyle=Object.freeze({schema,clone,normalize,defaults,fromLibrary,toLibrary,fromBurn,fromPreview,migrate,presets,apply,buildLegacyAss});
})(typeof window==='undefined'?globalThis:window);
