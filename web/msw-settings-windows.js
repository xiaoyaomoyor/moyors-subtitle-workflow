/* Two settings scopes, one instance of every control and its existing handler. */
(function(global){
  'use strict';
  const storage=()=>global.MSWConfig?.storage||localStorage;
  const $=id=>document.getElementById(id);
  const text=(node,value)=>{node.textContent=value;return node;};
  function category(root,key,title){
    const node=document.createElement('section');node.className='editor-settings-group settings-category';node.dataset.settingsCategory=key;
    node.append(text(document.createElement('h4'),title));node.firstChild.className='settings-category-header';root.append(node);return node;
  }
  function group(parent,title){
    const node=document.createElement('section');node.className='settings-subsection';
    const heading=text(document.createElement('h4'),title);heading.className='settings-subsection-title';node.append(heading);
    const body=document.createElement('div');body.className='editor-settings-sub-group';node.append(body);parent.append(node);return body;
  }
  function link(parent,title,action,id){
    const button=text(document.createElement('button'),title);button.type='button';button.className='settings-shortcut';if(id)button.id=id;
    button.addEventListener('click',action);parent.append(button);return button;
  }
  function rename(node,title){node.querySelectorAll(':scope > .settings-category-header,:scope > .editor-settings-sub-group > .editor-settings-title').forEach(n=>text(n,title));}
  function assemble(host){
    const editor=$('editor-settings-content'),project=$('project-settings-content');
    const current=key=>editor.querySelector(`[data-settings-category="${key}"]`);
    const appearance=current('appearance'),editing=current('general'),save=current('save'),environment=current('environment'),defaults=current('stickers');
    rename(appearance,'外观与语言');rename(editing,'编辑操作');rename(save,'保存与备份');rename(environment,'服务与环境');rename(defaults,'默认值与方案');
    appearance.querySelector('.settings-category-header').after(editing.querySelector('[data-subsection="language"]'));
    // Keep old category keys as aliases so existing saved navigation still works.
    const speakers=current('subtitle-speakers');rename(speakers,'说话人');
    const follow=$('speaker-auto-follow').closest('label');
    const followGroup=group(editing,'说话人标记');followGroup.append(follow);
    const help=document.querySelector('[data-help-for="speaker-auto-follow-help"]');if(help)followGroup.append(help);
    const time=category(project,'time-tracks','时间与轨道');
    const timeline=editing.querySelector('[data-subsection="timebase"]');time.append(timeline);
    const timingPrefs=group(editing,'时间操作');
    for(const id of ['timeline-snap-to-frame','timeline-timecode-separator']){
      timingPrefs.append($(id).closest('label'));const hint=$(id+'-hint');if(hint)timingPrefs.append(hint);
    }
    const split=$('track-split-track').closest('section');
    const splitShortcut=link(split.parentElement,'轨道文字切分 → 项目设置',()=>host.openProject('time-tracks'),'project-track-settings-shortcut');
    split.before(splitShortcut);time.append(split);
    const tracks=group(time,'当前轨道');tracks.id='project-settings-tracks';
    project.append(speakers);
    link(speakers.querySelector('.editor-settings-sub-group'),'说话人预览 → 媒体播放器设置',host.openPlayer,'project-speaker-preview-open');
    const styles=category(project,'subtitle-layout','字幕与排布'),styleBody=group(styles,'轨道外观与画面位置');
    const styleSummary=text(document.createElement('p'),'外观、位置和动画在属性列表中调整；保留轨道、说话人及单条字幕的覆盖关系。');styleSummary.className='editor-settings-hint';styleBody.append(styleSummary);
    link(styleBody,'打开属性列表',()=>host.openProperties(),'project-style-settings-open');
    const styleTracks=document.createElement('div');styleTracks.id='project-style-tracks';styleTracks.className='settings-shortcuts';styleBody.append(styleTracks);
    const resources=category(project,'media-resources','媒体与资源'),media=group(resources,'当前媒体');media.id='project-settings-media';
    const stickers=group(resources,'表情包资源');stickers.append($('sticker-root-btn').closest('.editor-settings-field'));
    const resourceTools=group(resources,'时间轴资源');link(resourceTools,'音频空隙',()=>host.openGaps());link(resourceTools,'素材库',()=>host.openAssets());
    const display=category(editor,'display-playback','显示与播放');
    const displayTools=group(display,'模块显示与播放');displayTools.classList.add('settings-shortcuts');
    for(const [id,label,action] of [['media','媒体播放器',host.openPlayer],['wave','波形显示器',host.openWave],['cue','字幕编辑器',host.openCue],['list','字幕列表',host.openList]])link(displayTools,label+'设置',action,'settings-open-'+id);
    const previewHint=text(document.createElement('p'),'调整模块的显示与播放习惯；预览样式不改变导出样式。');previewHint.className='editor-settings-hint';displayTools.append(previewHint);
    const schemes=group(defaults,'方案与工具默认值');schemes.classList.add('settings-shortcuts');
    link(schemes,'字幕样式预设',()=>host.openProperties(),'settings-open-style-presets');link(schemes,'说话人方案',()=>host.openProject('subtitle-speakers'),'settings-open-speaker-schemes');
    link(schemes,'工作区布局',()=>host.openWorkspaces(),'settings-open-workspaces');
    const note=text(document.createElement('p'),'预设和方案可跨工程复用，应用后工程保存独立副本。处理与导出默认值在各自工具中调整。');note.className='editor-settings-hint';schemes.append(note);
    // History actions belong to the existing recovery tool, not backup policy.
    const history=document.createElement('div');history.className='msw-processing-actions';history.id='project-history-actions';
    for(const id of ['project-version-create','project-version-directory','project-version-list'])if($(id))history.append($(id));
    $('project-recovery-list').before(history);
    const historyStatus=document.createElement('p');historyStatus.id='project-version-operation-status';historyStatus.className='msw-save-note';historyStatus.setAttribute('role','status');history.after(historyStatus);
    editor.replaceChildren(appearance,editing,display,save,environment,defaults,current('configuration'),current('ninja'));
    const obsolete=editing.querySelector('.split-language-type-field');if(obsolete)obsolete.hidden=true;
    let summaryKey='';
    function focusTarget({trackId,speakerId}={}){
      if(trackId){
        const select=$('track-split-track');
        if([...select.options].some(o=>o.value===trackId)){select.value=trackId;select.dispatchEvent(new Event('change'));select.focus();}
      }
      if(speakerId){
        const row=[...$('speaker-palette-rows').rows].find(r=>r.dataset.speakerId===speakerId);
        row?.querySelector('input')?.focus({preventScroll:true});row?.scrollIntoView({block:'nearest'});
      }
    }
    function refresh(){
      if(!$('project-settings-modal').classList.contains('show'))return;
      const info=host.describe(),english=global.MSWE_I18N?.language==='en',key=JSON.stringify([english,info]);
      if(key===summaryKey)return;
      summaryKey=key;tracks.replaceChildren();styleTracks.replaceChildren();media.replaceChildren();
      if(!info.tracks.length)tracks.append(text(document.createElement('p'),'尚无字幕轨道'));
      for(const track of info.tracks){
        const row=document.createElement('div');row.className='settings-track-summary';
        const detail=english
          ? `${track.count} cues · ${track.language||'Auto language'}${track.locked?' · Locked':''}${track.enabled===false?' · Disabled':''}`
          : `${track.count} 条字幕 · ${track.language||'自动语言'}${track.locked?' · 已锁定':''}${track.enabled===false?' · 已禁用':''}`;
        row.dataset.trackId=track.id;
        const name=link(row,track.name,()=>focusTarget({trackId:track.id}));
        name.title=english?'Track settings; right-click for actions':'轨道设置；右键进行轨道操作';
        name.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();host.trackMenu(track.id,event.clientX,event.clientY);});
        row.append(text(document.createElement('span'),detail));tracks.append(row);
        link(styleTracks,track.name,()=>host.openProperties(track.id));
      }
      const path=text(document.createElement('p'),info.media||'尚未导入媒体');path.className='settings-resource-path';media.append(path);
      media.append(text(document.createElement('p'),english?`Subtitle cues: ${info.cues} · Audio clips: ${info.audio}`:`字幕块：${info.cues} · 音频贴片：${info.audio}`));
    }
    for(const event of ['msw:project-replaced','msw:project-changed','msw:subtitles-changed','msw:assets-changed','msw:audio-changed','msw:media-changed'])global.addEventListener(event,refresh);
    document.addEventListener('mawe:languagechange',refresh);
    return {refresh,focusTarget};
  }
  function navigation(prefix){
    const root=$(prefix+'-content'),nav=$(prefix+'-nav'),input=$(prefix+'-search');
    const key=prefix==='editor-settings'?'msw.editor.settings.category.v1':'msw.project.settings.category.v1';
    const categories=[...root.children].filter(n=>n.matches('.settings-category'));
    if(prefix==='project-settings')try{
      if(storage().getItem(key)===null){
        const previous=storage().getItem('msw.editor.settings.category.v1');
        storage().setItem(key,previous==='subtitle-speakers'?previous:previous==='stickers'?'media-resources':'time-tracks');
      }
    }catch(_){}
    let active='all';try{active=storage().getItem(key)||'all';}catch(_){}
    if(!categories.some(n=>n.dataset.settingsCategory===active))active='all';
    const label=node=>node.querySelector('.settings-category-header')?.textContent.trim()||'';
    const available=node=>!!node.querySelector('.editor-settings-sub-group:not([hidden]),.settings-panel-section:not([hidden])');
    function search(){
      const q=input.value.trim().toLocaleLowerCase();let found=false;
      root.classList.toggle('show-all-categories',!!q||active==='all');
      for(const node of categories){
        // Search groups, not individual labels, to preserve help/conditional fields.
        const groups=[...node.children].filter(n=>!n.matches('.settings-category-header'));
        const categoryHit=label(node).toLocaleLowerCase().includes(q);
        for(const group of groups){const haystack=group.textContent+' '+[...group.querySelectorAll('[title]')].map(n=>n.title).join(' ');group.classList.toggle('search-hidden',!!q&&!categoryHit&&!haystack.toLocaleLowerCase().includes(q));}
        node.hidden=!available(node)||(q?!groups.some(g=>!g.hidden&&!g.classList.contains('search-hidden')):active!=='all'&&node.dataset.settingsCategory!==active);
        found ||= !node.hidden;
      }
      empty.hidden=found;
      nav.querySelectorAll('button').forEach(button=>{
        const selected=!q&&button.dataset.settingsCategory===active;
        button.classList.toggle('active',selected);button.setAttribute('aria-current',selected?'page':'false');
      });
    }
    const empty=text(document.createElement('p'),'没有匹配的设置');empty.className='settings-empty';empty.hidden=true;root.append(empty);
    function activate(value,{persist=true}={}){
      active=typeof value==='string'?value:value?.dataset.settingsCategory||'all';
      if(!categories.some(n=>n.dataset.settingsCategory===active&&available(n)))active='all';
      if(persist)try{storage().setItem(key,active);}catch(_){}
      input.value='';search();root.scrollTop=0;
    }
    function build(){
      nav.replaceChildren();
      for(const [id,title] of [['all','全部'],...categories.filter(available).map(n=>[n.dataset.settingsCategory,label(n)])]){
        const button=text(document.createElement('button'),title);button.type='button';button.className='settings-nav-item';button.dataset.settingsCategory=id;button.onclick=()=>activate(id);nav.append(button);
      }
    }
    nav.addEventListener('keydown',event=>{
      const buttons=[...nav.querySelectorAll('button')],index=buttons.indexOf(event.target);if(index<0)return;
      const target=event.key==='ArrowDown'?buttons[(index+1)%buttons.length]:event.key==='ArrowUp'?buttons[(index-1+buttons.length)%buttons.length]:event.key==='Home'?buttons[0]:event.key==='End'?buttons.at(-1):null;
      if(target){event.preventDefault();event.stopPropagation();target.click();target.focus();}
    });
    input.addEventListener('input',search);build();search();
    document.addEventListener('mawe:languagechange',()=>{build();search();});
    return {activate,refresh(){build();search();},categories};
  }
  global.MSWSettingsWindows={assemble,navigation};
})(window);
