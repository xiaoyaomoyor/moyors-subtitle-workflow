// Project styles are snapshots. Library presets and proofreading never mutate them.
(function(global) {
  'use strict';
  const U = global.AsrEditorUtils;
  const clone = value => JSON.parse(JSON.stringify(value));
  const schema = 'msw.subtitle-style.v1';
  const layoutVersion = 5;
  function normalizePair(raw) {
    if(!raw||!['main-above','secondary-above'].includes(raw.order)||!Number.isInteger(raw.gap)||raw.gap< -240||raw.gap>240)throw Error('主副字幕排列设置无效');
    return {order:raw.order,gap:raw.gap};
  }
  function normalizeWrapping(raw={}) {
    const wrapMode=raw.wrapMode===undefined?'auto':raw.wrapMode,charsPerLine=raw.charsPerLine===undefined?20:raw.charsPerLine;
    if(!['auto','characters'].includes(wrapMode))throw Error('字幕换行方式无效');
    if(!Number.isInteger(charsPerLine)||charsPerLine<1||charsPerLine>200)throw Error('每行字数必须是 1–200 的整数');
    return {wrapMode,charsPerLine};
  }
  function characters(text) {
    const units=[];let regional=0;
    for(const char of text){
      const code=char.codePointAt(0),flag=code>=0x1f1e6&&code<=0x1f1ff;
      const attached=/\p{Mark}/u.test(char)||char==='\u200d'||code>=0x1f3fb&&code<=0x1f3ff||code>=0xe0020&&code<=0xe007f;
      if(units.length&&(attached||units.at(-1).endsWith('\u200d')||flag&&regional%2))units[units.length-1]+=char;
      else units.push(char);
      regional=flag?regional+1:0;
    }
    return units;
  }
  function wrapText(text,style={}) {
    text=String(text??'');if(style.wrapMode!=='characters')return text;
    const count=normalizeWrapping(style).charsPerLine,lines=[];
    for(const line of text.replace(/\r\n?/g,'\n').split('\n')){
      const units=characters(line);
      for(let i=0;i<units.length;i+=count)lines.push(units.slice(i,i+count).join(''));
      if(!units.length)lines.push('');
    }
    return lines.join('\n');
  }
  function wrapCues(cues=[],style={}) {
    return style?.wrapMode==='characters'?cues.map(c=>({...c,text:wrapText(c.text,style)})):cues;
  }
  function renderProject(project,style=project.preview?.project_style) {
    if(!style)return project;
    const result={...project,segments:wrapCues(project.segments,style.main)};
    if(project.multi_subtitle?.tracks)result.multi_subtitle={...project.multi_subtitle,tracks:project.multi_subtitle.tracks.map(t=>({...t,segments:wrapCues(t.segments,style.secondary)}))};
    return result;
  }
  function normalize(raw = {}) {
    if(raw.annotation!==undefined&&(!raw.annotation||typeof raw.annotation!=='object'||Array.isArray(raw.annotation)||raw.annotation.annotation!==undefined))throw Error('画面文字基础样式无效');
    return {schema, name: String(raw.name || '默认白字').slice(0, 80),
      main: {...U.normalizeAssStyle(raw.main || {}, U.ASS_DEFAULT_ASS_STYLE, 'main'),...normalizeWrapping(raw.main||{})},
      secondary: {...U.normalizeAssStyle(raw.secondary || {}, U.ASS_DEFAULT_EXTENSION_STYLE, 'secondary'),...normalizeWrapping(raw.secondary||{})},
      animations: U.normalizeAssAnimations(raw.animations),
      ...(raw.annotation!==undefined?{annotation:normalize(raw.annotation)}:{}),
      ...(raw.pairLayout!==undefined?{pairLayout:normalizePair(raw.pairLayout)}:{}),
      ...(raw.legacyBurn ? {legacyBurn: clone(raw.legacyBurn)} : {})};
  }
  function defaults() {
    return normalize({pairLayout:{order:'main-above',gap:0},main:{fontSize:48,marginV:96,marginL:96,marginR:96},
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
    const s = defaults(); delete s.pairLayout; s.name='旧工程烧录样式'; s.legacyBurn=clone(raw);
    for(const [role,size,y] of [['main',48,.86],['secondary',40,.94]]) {
      const b={font_family:'Arial',font_size:size,color:'#ffffff',outline_color:'#000000',outline:2,background_color:'#000000',background_alpha:0,x:.5,y,width:.8,...raw[role]};
      s[role]={...s[role],fontName:b.font_family,fontSize:b.font_size,primaryColor:b.color,outlineColor:b.outline_color,outline:b.outline,
        backColor:b.background_color,borderStyle:b.background_alpha>0?3:1,marginL:Math.round(Math.max(0,b.x-b.width/2)*1920),
        marginR:Math.round(Math.max(0,1-b.x-b.width/2)*1920),marginV:Math.round((1-b.y)*1080),alignment:2};
    }
    return normalize(s);
  }
  function fromPreview(preview={}) {
    const s=defaults(); delete s.pairLayout; s.main.marginV=108; s.name='旧工程预览样式';
    for(const [role,key] of [['main','subtitle'],['secondary','extension_subtitle']]) {
      const p=preview[key] || {};
      s[role]={...s[role],fontName:family(p.font_family),fontSize:(p.font_size || (role==='main'?18:16))*4,primaryColor:p.color||s[role].primaryColor};
    }
    return normalize(s);
  }
  function migrate(project, library, originalPreview=project.preview||{}) {
    project.preview ||= {};
    for(const field of ['project_style','project_style_custom'])if(project.preview[field]!=null){
      if(project.preview[field].schema!==schema)throw Error('工程字幕样式版本不受支持，请使用兼容的编辑器');
      normalize(project.preview[field]);
    }
    const selection=project.preview.project_style_selection;
    if(selection!==undefined&&(typeof selection!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(selection)))throw Error('工程样式选择无效');
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
    const standard=defaults(),normal={...standard,pairLayout:undefined,main:{...standard.main,marginV:108}};
    return [{id:'default',...standard},
      {id:'large',...normalize({...normal,name:'大字清晰',main:{...normal.main,fontSize:72,outline:3},secondary:{...normal.secondary,fontSize:56}})},
      {id:'contrast',...normalize({...normal,name:'高对比底框',main:{...normal.main,borderStyle:3,outline:5,backColor:'#000000'},secondary:{...normal.secondary,borderStyle:3,outline:4}})},
      {id:'bilingual',...normalize({...normal,name:'双语紧凑',main:{...normal.main,fontSize:44,marginV:100},secondary:{...normal.secondary,fontSize:36,marginV:48}})}];
  }
  function apply(project, style) { project.preview ||= {}; project.preview.project_style=normalize(style); }
  function applyPreset(project,style,{proof=false}={}) {
    const old=normalize(project.preview?.project_style||defaults()),value=normalize(style);
    for(const track of project.subtitle_tracks?.tracks||[]) {
      if(track.kind==='annotation'&&!proof) {
        if(value.annotation)track.style={mode:'snapshot',value:clone(value.annotation)};
        else if(track.style.mode==='inherit')track.style={mode:'snapshot',value:clone(old.annotation||old)};
      } else track.style={mode:'snapshot',value:clone(value)};
    }
    apply(project,value);
  }
  function forKind(style,kind) { const value=normalize(style);const result=kind==='annotation'&&value.annotation?value.annotation:value;delete result.annotation;return result; }
  function presetSnapshot(project,style,kind='dialogue') {
    const base=normalize(project.preview?.project_style||defaults()),value=normalize(style);
    if(kind==='annotation')return {...base,annotation:forKind(value,'annotation')};
    return {...value,annotation:forKind(value.annotation||base.annotation||base,'annotation')};
  }
  function capture(project) {
    const p=project.preview||{};
    return {style:normalize(p.project_style||defaults()),customStyle:p.project_style_custom?normalize(p.project_style_custom):null,selection:p.project_style_selection||null};
  }
  function restore(project, state) {
    apply(project,state.style);
    if(state.customStyle)project.preview.project_style_custom=normalize(state.customStyle);else delete project.preview.project_style_custom;
    if(state.selection)project.preview.project_style_selection=state.selection;else delete project.preview.project_style_selection;
  }
  function edit(project, style, selection='current') {
    apply(project,style);project.preview.project_style_selection=selection;
    if(selection==='current')project.preview.project_style_custom=normalize(style);
  }
  const lineHeight=s=>s.fontSize*1.2*s.scaleY/100;
  const bottom=s=>s.alignment>=7?s.marginV+lineHeight(s):s.alignment>=4?540+lineHeight(s)/2:1080-s.marginV;
  function pairSettings(raw) {
    const s=normalize(raw);if(s.pairLayout)return clone(s.pairLayout);
    const order=bottom(s.main)<=bottom(s.secondary)?'main-above':'secondary-above';
    const lower=order==='main-above'?'secondary':'main';
    const distance=Math.abs(bottom(s.main)-bottom(s.secondary))-lineHeight(s[lower]);
    return {order,gap:Math.min(240,Math.max(-240,Math.round(distance)))};
  }
  function arrangePair(raw, settings) {
    const style=normalize(raw),pair=normalizePair(settings),lower=pair.order==='main-above'?'secondary':'main',upper=lower==='main'?'secondary':'main';
    const oldLower=style.pairLayout?.order==='main-above'?'secondary':'main';
    const base=Math.round(1080-(style.pairLayout?bottom(style[oldLower]):Math.max(bottom(style.main),bottom(style.secondary))));
    for(const role of ['main','secondary'])style[role].alignment=(style[role].alignment-1)%3+1;
    style[lower].marginV=Math.max(0,base);
    const distance=Math.max(1,(lineHeight(style[lower])-lineHeight(style[upper]))/2+1,lineHeight(style[lower])+pair.gap);
    style[upper].marginV=Math.round(style[lower].marginV+distance);
    style.pairLayout=pair;
    if(style.legacyBurn)for(const role of ['main','secondary']){style.legacyBurn[role] ||= {};style.legacyBurn[role].y=1-style[role].marginV/1080;}
    return normalize(style);
  }
  function swapAppearance(raw) {
    const style=normalize(raw),position=['id','name','alignment','marginL','marginR','marginV','encoding'];
    const before=clone(style);
    for(const [role,other] of [['main','secondary'],['secondary','main']]) {
      style[role]={...before[other]};for(const key of position)style[role][key]=before[role][key];
    }
    if(before.legacyBurn){
      const burn={};for(const [r,size,y] of [['main',48,.86],['secondary',40,.94]])burn[r]={font_family:'Arial',font_size:size,color:'#ffffff',outline_color:'#000000',outline:2,background_color:'#000000',background_alpha:0,x:.5,y,width:.8,...before.legacyBurn[r]};
      for(const [role,other] of [['main','secondary'],['secondary','main']])style.legacyBurn[role]={...burn[other],x:burn[role].x,y:burn[role].y,width:burn[role].width};
    }
    return normalize(style);
  }
  // Preserve the old two-pass translucent background even in portable exports.
  // This mirrors subtitle_style.styled_ass's legacy branch, using the shared layout.
  function buildLegacyAss(project, options={}) {
    project=renderProject(project);
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
        const paired=!!project.preview?.project_style?.pairLayout,backgroundLayer=paired?{main:0,secondary:1,overlay:2}[name]:0,textLayer=paired?backgroundLayer+3:1;
        if(s.background_alpha>0)lines.push(`Dialogue: ${backgroundLayer},${time(start)},${time(end)},${name}-bg,,0,0,${margin},,${text}`);
        lines.push(`Dialogue: ${textLayer},${time(start)},${time(end)},${name},,0,0,${margin},,${text}`);
      });
    }
    return lines.join('\n')+'\n';
  }
  global.MSWProjectStyle=Object.freeze({schema,layoutVersion,clone,normalize,forKind,presetSnapshot,normalizeWrapping,wrapText,wrapCues,renderProject,defaults,fromLibrary,toLibrary,fromBurn,fromPreview,migrate,presets,apply,applyPreset,capture,restore,edit,pairSettings,arrangePair,swapAppearance,buildLegacyAss});
})(typeof window==='undefined'?globalThis:window);
