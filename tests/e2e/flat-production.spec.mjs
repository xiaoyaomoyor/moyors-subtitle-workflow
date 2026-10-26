import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer,toggleMediaSettings} from './helpers.mjs';
let server;
test.beforeAll(async()=>{const dir=makeTempDir('flat-production');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
test.afterAll(async()=>server?.stop());
const fixture=()=>({segments:[{id:'a',start:1000,end:3000,text:'Hello world',items:[]}],
  multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[{id:'b',start:1200,end:3200,text:'你好世界',items:[]}]}],
    bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['b'],start_offset_ms:200,end_offset_ms:200}]},waveform:generateWaveformPayload(10000)});
const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
const trackPoint=(page,id,time)=>page.evaluate(({id,time})=>{
  const row=[...document.querySelectorAll('.waveform-row')].find(r=>Number(r.dataset.startMs)<=time&&Number(r.dataset.endMs)>time);
  const rect=row.getBoundingClientRect(),lane=fixedLayout().positions.get(JSON.stringify([id,'main']));
  return {x:rect.left+rect.width*(time-Number(row.dataset.startMs))/(Number(row.dataset.endMs)-Number(row.dataset.startMs)),
    y:rect.bottom-7-(parseFloat(row.style.getPropertyValue('--audio-lane-space'))||0)-lane*waveformEditor.subtitleGeometry().pitch-waveformEditor.subtitleGeometry().height/2};
},{id,time});

async function dragFixture(page){
  const p=fixture();p.waveform=generateWaveformPayload(30000);
  await page.evaluate(p=>{applyCanonicalProject(p,'drag.mosp');fixedAddTrack('subtitle');
    waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.settings.rowHeight=170;
    updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false});waveformEditor.render();},p);
  return snap(page);
}
test.beforeEach(async({page})=>{await disableOnboarding(page);page.on('dialog',d=>d.accept());await page.goto(server.url);});
test('normal editor retains menus, paired cards and panels while saving native flat tracks',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#open-project-file').setInputFiles({name:'bilingual.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
  await expect(page.locator('#json-name')).toHaveText('bilingual.mosp');
  await expect(page.locator('#menubar')).toBeVisible();await expect(page.locator('#flat-trial-bar')).toHaveCount(0);
  await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  await expect(page.locator('.multi-cue-column.main')).toContainText('Hello world');
  await expect(page.locator('.multi-cue-column.extension')).toContainText('你好世界');
  const p=await snap(page);expect(p.schema).toBe('msw.project.v4');expect(p.segments).toBeUndefined();
  expect(p.subtitles.tracks).toHaveLength(2);expect(p.subtitles.bindings).toHaveLength(1);
  expect(p.subtitles.cues[0].track_id).not.toBe(p.subtitles.cues[1].track_id);
  await page.screenshot({path:info.outputPath('normal-flat-bilingual.png')});
  expect(errors).toEqual([]);
});

test('paired cards retain linked split, merge and one-step undo',async({page})=>{
  await page.locator('#open-project-file').setInputFiles({name:'bilingual.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
  await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  await page.locator('.multi-cue-column.main').click();
  await page.locator('#cue-panel-text').fill('Hello edited world');
  await page.locator('#cue-panel-text').blur();
  expect((await snap(page)).subtitles.cues.some(c=>c.content.text==='Hello edited world')).toBe(true);
  await page.mouse.move(1,1);
  await page.evaluate(()=>{player.currentTime=2;lastEditRegion='waveform';EDITOR_SETTINGS.keyboardOperationReference='playhead';setCuePanelTarget('main',0);});
  await page.keyboard.press('Control+b');
  await expect.poll(async()=>(await snap(page)).subtitles.cues.length).toBe(4);
  expect((await snap(page)).subtitles.bindings).toHaveLength(2);
  await page.evaluate(()=>{clearSelection({silent:true});DATA.segments.forEach((_,i)=>selectedIdxs.add(i));mergeSegments([...selectedIdxs]);});
  await expect.poll(async()=>(await snap(page)).subtitles.cues.length).toBe(2);
  expect((await snap(page)).subtitles.bindings).toHaveLength(1);
  await page.keyboard.press('Control+z');
  await expect.poll(async()=>(await snap(page)).subtitles.cues.length).toBe(4);
  expect((await snap(page)).subtitles.bindings).toHaveLength(2);
});

test('physical-track merge includes selected cues in both display columns and retains binding and undo',async({page})=>{
  await page.evaluate(waveform=>{
    let p=MSWFlatSubtitles.migrate({timebase:{unit:'frames',fps:25},segments:[
      {id:'a',start:1000,end:2000,text:'Hello',items:[{text:'Hello',start:1000,end:2000}]},
      {id:'b',start:3000,end:4000,text:'world',items:[{text:'world',start:3000,end:4000}]}],waveform});
    const [a,b]=p.subtitles.cues;
    p=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'peer',name:'peer'});
    p=MSWFlatEditing.addCue(p,'peer','translation',1200,2200,'你好');
    p=MSWFlatSubtitles.bind(p,a.id,'translation','pair');
    p.subtitle_view={secondary_cue_ids:[b.id]};
    applyCanonicalProject(p,'cross-columns.mosp');DATA.msw.removed_asset_ids=[];
    clearSelection({silent:true});selectedIdxs.add(DATA.segments.findIndex(c=>c.id===a.id));
    selectedExtensionIdxs.add(getActiveExtensionTrack().segments.findIndex(c=>c.id===b.id));
    setCuePanelTarget('main',0);updateMultiSelectionClasses();
  },generateWaveformPayload(10000));
  const before=await snap(page);
  expect(await page.evaluate(()=>[selectedIdxs.size,selectedExtensionIdxs.size])).toEqual([1,1]);
  await page.keyboard.press('c');
  const after=await snap(page);
  expect(after.subtitles.cues).toHaveLength(2);
  const merged=after.subtitles.cues.find(c=>c.content.text==='Hello world');
  expect(merged).toBeTruthy();expect(merged.track_id).toBe(before.subtitles.cues.find(c=>c.content.text==='Hello').track_id);
  expect([merged.content.start,merged.content.end,merged.content.start_frame,merged.content.end_frame]).toEqual([1000,4000,25,100]);
  expect(merged.content.items).toHaveLength(2);expect(after.subtitles.bindings).toHaveLength(1);
  expect(after.subtitles.bindings[0].source_id).toBe(merged.id);
  expect(after.subtitles.bindings[0].target_id).toBe('translation');
  expect(await page.evaluate(()=>fixedLastMessage)).toBe('');
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('single-cue merge is quiet and track rejections use one transient notification',async({page})=>{
  await page.evaluate(p=>{applyCanonicalProject(p,'notices.mosp');selectOnly(0);document.getElementById('hint-stack')?.replaceChildren();},fixture());
  const before=await snap(page);await page.keyboard.press('c');
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await expect(page.locator('#fixed-track-status')).toHaveCount(0);
  await expect(page.locator('#hint-stack .hint-card')).toHaveCount(0);
  await page.evaluate(()=>{for(let i=0;i<5;i++)fixedStatus('当前轨道已锁定，请先解锁');});
  await expect(page.locator('#hint-stack .hint-card')).toHaveCount(1);
  await expect(page.locator('#hint-stack .hint-card')).toHaveAttribute('data-persistent','false');
  await expect(page.locator('#hint-stack .hint-card')).toHaveCount(0,{timeout:4000});
  expect(await page.evaluate(()=>fixedLastMessage)).toContain('已锁定');
});

test('invalid track drag stays quiet until release and Escape or pointer cancellation shows no notice',async({page})=>{
  const before=await dragFixture(page),[main,secondary,target]=before.subtitles.tracks;
  const start=await trackPoint(page,main.id,2000),partner=await trackPoint(page,secondary.id,2000);
  const begin=async()=>{
    await page.evaluate(()=>document.getElementById('hint-stack')?.replaceChildren());
    await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(partner.x,partner.y,{steps:5});
    expect(await page.evaluate(()=>waveformEditor.drag?.destinationPreview?.blocked)).toBe(true);
    await expect(page.locator('#hint-stack .hint-card')).toHaveCount(0);
  };
  await begin();await page.mouse.up();
  await expect(page.locator('#hint-stack .hint-card')).toHaveCount(1);
  await expect(page.locator('#hint-stack .hint-card')).toContainText('不同轨道');
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await begin();await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('#hint-stack .hint-card')).toHaveCount(0);
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await begin();await page.evaluate(()=>window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:waveformEditor.drag.pointerId})));await page.mouse.up();
  await expect(page.locator('#hint-stack .hint-card')).toHaveCount(0);
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('list track filter lives in the native context submenu and selected ordinals are highlighted',async({page})=>{
  await page.evaluate(p=>{applyCanonicalProject(p,'filter.mosp');fixedAddTrack('subtitle');},fixture());
  await expect(page.locator('#fixed-track-filter')).toHaveCount(0);
  const card=page.locator('.multi-cue-column.main');await card.click();
  const selected=await card.locator('.index-label').evaluate(el=>({weight:getComputedStyle(el).fontWeight,decoration:getComputedStyle(el).textDecorationLine}));
  expect(selected.weight).toBe('700');expect(selected.decoration).not.toContain('underline');
  await card.click({button:'right'});await page.locator('#ctxmenu .ctx-submenu-toggle').filter({hasText:/^轨道$/}).hover();
  await page.locator('#ctxmenu .ctx-submenu-menu .item').filter({hasText:/^S2$/}).click();
  await expect(card).toBeHidden();
  await page.keyboard.press('Escape');
  await page.locator('#cues-module .module-tab-strip').click({button:'right'});
  await page.locator('#ctxmenu .ctx-submenu-toggle').filter({hasText:/^轨道$/}).hover();
  await page.locator('#ctxmenu .ctx-submenu-menu .item').filter({hasText:/^全部轨道$/}).click();
  await expect(card).toBeVisible();
});

test('arbitrary peer tracks bind into original bilingual cards and move independently',async({page})=>{
  await page.evaluate(()=>{
    const p=MSWFlatSubtitles.migrate({segments:[{id:'a',start:1000,end:3000,text:'Source'}],waveform:{duration_ms:10000,peaks:[]}});
    let n=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id:'second',name:'译文'});
    n=MSWFlatEditing.addCue(n,'second','b',1000,3000,'Translation');
    applyCanonicalProject(n,'peer.mosp');renderAll({waveform:'full'});clearSelection({silent:true});DATA.segments.forEach((_,i)=>selectedIdxs.add(i));
  });
  await page.keyboard.press('g');
  await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  expect((await snap(page)).subtitles.bindings).toHaveLength(1);
  await page.evaluate(()=>{fixedAddTrack('subtitle');fixedMove([fixedRef(DATA.segments[0])],DATA.subtitle_tracks.tracks.at(-1).id);});
  const p=await snap(page);expect(p.subtitles.bindings).toHaveLength(1);
  expect(p.subtitles.cues.find(c=>c.id==='b').track_id).toBe('second');
  expect(p.subtitles.cues.find(c=>c.content.text==='Source').track_id).toBe(p.subtitles.tracks.at(-1).id);
});

test('normal processing host uses native IDs and candidate revisions retain bindings and undo',async({page})=>{
  await page.locator('#open-project-file').setInputFiles({name:'source.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({segments:[{id:'a',start:0,end:2000,text:'Hello'}]}))});
  const result=await page.evaluate(()=>{
    selectOnly(0);const h=MSWE.resolve('processing-host'),snapshot=h.capture('secondary','new');
    const job={id:'translation-test',kind:'translation',project_id:DATA.msw.project_id,status:'succeeded',snapshot,result:{translations:[{id:snapshot.entries[0].source.id,text:'译文'}]}};
    MSWResults.register(DATA.msw,[job]);h.applyProcessing([job],'secondary');
    const first=JSON.parse(buildJson());job.result.translations[0].text='修改后的候选';h.applyProcessing([job],'secondary');
    const second=JSON.parse(buildJson());
    const tts=MSWTts.snapshot(DATA,{mainIds:[],extensionIds:[second.subtitles.bindings[0].target_id],trackId:MSWProductionProject.EXT,hasSelection:true},'secondary');
    return {schema:snapshot.project_schema,first,second,tts};
  });
  expect(result.schema).toBe('msw.project.v4');expect(result.first.subtitles.bindings).toHaveLength(1);
  expect(result.first.subtitles.tracks.map(t=>t.name)).toEqual(['S1主','S1副']);
  expect(result.second.subtitles.cues).toHaveLength(2);expect(result.second.subtitles.cues.some(c=>c.content.text==='修改后的候选')).toBe(true);
  expect(result.tts.entries[0].track_id).toBe(result.second.subtitles.tracks[1].id);
  await page.keyboard.press('Control+z');
  expect((await snap(page)).subtitles.cues.some(c=>c.content.text==='译文')).toBe(true);
});

test('compact numbered heads and group menus preserve bindings, ordinal cards and undo',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>{applyCanonicalProject(p,'groups.mosp');fixedAddTrack('subtitle');},fixture());
  const before=await snap(page),[a,b,c]=before.subtitles.tracks;
  await expect(page.locator('.multi-cue-column.main .index')).toHaveText('S1主_1');
  await expect(page.locator('.multi-cue-column.extension .index')).toHaveText('S1副_1');
  await expect(page.locator('.fixed-track-badge')).toHaveCount(0);
  await page.locator('.multi-cue-column.main').click();await expect(page.locator('#cue-panel-target')).toHaveText('S1主字幕_1');
  await expect(page.locator('#fixed-cue-owner')).toBeHidden();
  const head=id=>page.locator(`.fixed-track-head[data-subtitle-track-id="${id}"]`).first();
  expect((await head(a.id).boundingBox()).width).toBeLessThan(60);
  await head(a.id).click({button:'right'});
  await expect(page.locator('#ctxmenu')).not.toContainText('重命名');await expect(page.locator('#ctxmenu')).not.toContainText('轨道设置');
  await page.getByRole('menuitem',{name:'解除主副分组',exact:true}).click();
  await head(c.id).click({button:'right'});await page.locator('#ctxmenu .ctx-submenu-toggle').filter({hasText:'设为副轨道'}).hover();
  await page.getByRole('menuitem',{name:'S1',exact:true}).click();
  const grouped=await snap(page);expect(grouped.subtitles.tracks.map(t=>t.name)).toEqual(['S1主','S3','S1副']);
  expect(grouped.subtitles.cues).toEqual(before.subtitles.cues);expect(grouped.subtitles.bindings).toEqual(before.subtitles.bindings);
  expect(grouped.subtitles.tracks.map(t=>t.style)).toEqual(before.subtitles.tracks.map(t=>t.style));
  await expect(page.locator('.multi-cue-column.extension .index')).toHaveText('S3_1');
  await page.evaluate(p=>applyCanonicalProject(p,'reopened.mosp'),grouped);
  await head(c.id).click({button:'right'});await page.getByRole('menuitem',{name:'解除主副分组',exact:true}).click();
  expect((await snap(page)).subtitles.tracks.map(t=>t.name)).toEqual(['S1','S3','S4']);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles.tracks.map(t=>t.name)).toEqual(['S1主','S3','S1副']);
  await page.screenshot({path:info.outputPath('compact-track-groups.png')});expect(errors).toEqual([]);
});

test('style toolbar selects track groups, edits both appearances and swaps without moving subtitles',async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>{applyCanonicalProject(p,'styles.mosp');fixedAddTrack('subtitle');},fixture());
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle.ready)).toBe(true);
  const before=await snap(page),[a,b,c]=before.subtitles.tracks;
  await page.evaluate(id=>MSWSubtitleStyle.editTrack(id),a.id);
  await expect(page.locator('#style-edit-scope option')).toHaveText(['所选字幕','说话人','S1','S2']);
  await expect(page.locator('#style-track-controls')).toBeHidden();await expect(page.locator('#style-main')).toBeVisible();
  await expect(page.locator('#style-track-target')).toBeHidden();
  const toolbarSizes=await page.locator('#style-edit-scope,#style-main,#style-secondary,#style-swap').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
  expect(new Set(toolbarSizes).size).toBe(1);
  for(const language of ['en','zh']) {
    await page.locator('#subtitle-properties').evaluate(el=>el.style.width='360px');
    await page.evaluate(language=>MSWE_I18N.applyLanguage(language),language);
    expect(await page.locator('.msw-properties-scope').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.locator('#style-main,#style-secondary,#style-swap').evaluateAll(nodes=>nodes.every(el=>el.scrollHeight<=el.clientHeight))).toBe(true);
  }
  await page.locator('#subtitle-properties').evaluate(el=>el.style.width='560px');
  await page.locator('#style-field-fontSize').fill('61');await page.locator('#style-field-fontSize').blur();
  await page.locator('#style-secondary').click();await page.locator('#style-field-fontSize').fill('39');await page.locator('#style-field-fontSize').blur();
  const edited=await snap(page);expect(edited.subtitles.tracks[0].style.value.main.fontSize).toBe(61);expect(edited.subtitles.tracks[1].style.value.secondary.fontSize).toBe(39);
  await page.locator('#style-swap').click();const swapped=await snap(page);
  expect(swapped.subtitles.tracks[0].style.value.main.fontSize).toBe(39);expect(swapped.subtitles.tracks[1].style.value.secondary.fontSize).toBe(61);
  expect(swapped.subtitles.tracks.map(t=>t.position)).toEqual(before.subtitles.tracks.map(t=>t.position));
  expect(swapped.subtitles.cues).toEqual(before.subtitles.cues);expect(swapped.subtitles.bindings).toEqual(before.subtitles.bindings);
  await page.screenshot({path:info.outputPath('group-style-toolbar.png')});
  await page.locator('#style-edit-scope').selectOption(c.id);await expect(page.locator('#style-main')).toBeHidden();await expect(page.locator('#style-secondary')).toBeHidden();await expect(page.locator('#style-swap')).toBeHidden();
  await page.locator('#style-field-fontSize').fill('77');await page.locator('#style-field-fontSize').blur();
  const solo=await snap(page);expect(solo.subtitles.tracks[2].style.value.main.fontSize).toBe(77);expect(solo.subtitles.tracks[0].style.value.main.fontSize).toBe(39);
  await page.locator('#style-more').evaluate(el=>el.open=true);
  await page.locator('#style-position-y').fill('20');await page.locator('#style-position-y').blur();
  await expect(page.locator('#style-position-fields')).toBeVisible();
  expect((await snap(page)).subtitles.tracks[2].layout).toBe('fixed');expect(errors).toEqual([]);
  await toggleMediaSettings(page);await page.locator('#style-preview-mode').selectOption('default');await toggleMediaSettings(page);
  await page.locator('#style-project-preset').selectOption('default');
  await expect(page.locator('#style-preview-mode')).toHaveValue('default');
  await expect(page.locator('#style-field-fontSize')).toHaveValue('48');
});

test('track number setting hides native headers and releases their space in both waveform layouts',async({page})=>{
  const before=await dragFixture(page);
  await page.evaluate(()=>setWaveformSettingsPanelOpen(true));
  const toggle=page.locator('#waveform-show-track-heads');
  for(const mode of ['multi','basic']) {
    await page.evaluate(mode=>{waveformEditor.settings.mode=mode;waveformEditor.render();},mode);
    await toggle.check();
    await expect(page.locator('.fixed-track-head').first()).toBeVisible();
    const row=page.locator('.waveform-row').first(),shown=await row.boundingBox();
    await toggle.uncheck();await expect(page.locator('.waveform-track-heads-column')).toHaveCount(0);
    const hidden=await row.boundingBox();expect(hidden.width-shown.width).toBeGreaterThan(30);
    await toggle.check();expect((await row.boundingBox()).width).toBe(shown.width);
  }
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('track context menus collapse lanes, restore from blank space and open style settings',async({page},info)=>{
  await page.evaluate(p=>applyCanonicalProject(p,'menus.mosp'),fixture());
  const before=await snap(page),head=page.locator('.fixed-track-head').first();
  const id=await head.getAttribute('data-subtitle-track-id');
  await head.click({button:'right'});
  for(const name of ['新增字幕轨道','字幕样式与画面位置','上移轨道','下移轨道'])await expect(page.locator('#ctxmenu')).not.toContainText(name);
  await page.getByRole('menuitem',{name:'折叠轨道',exact:true}).click();
  await expect(page.locator(`.fixed-track-head[data-subtitle-track-id="${id}"]`)).toHaveCount(0);
  expect((await snap(page)).subtitles.cues).toEqual(before.subtitles.cues);
  await page.locator('.waveform-track-heads-column').click({button:'right',position:{x:10,y:12}});
  await page.getByRole('menuitem',{name:'展开轨道',exact:true}).hover();
  await page.screenshot({path:info.outputPath('track-context-menu.png')});
  await page.getByRole('menuitem',{name:'S1主',exact:true}).click();
  await expect(page.locator(`.fixed-track-head[data-subtitle-track-id="${id}"]`).first()).toBeVisible();
  await page.locator('.waveform-track-heads-column').click({button:'right',position:{x:10,y:12}});
  await expect(page.getByRole('menuitem',{name:'字幕样式与画面位置',exact:true}).locator('.menu-window-icon')).toBeVisible();
  await page.getByRole('menuitem',{name:'字幕样式与画面位置',exact:true}).click();
  await expect(page.locator('#style-edit-scope')).toBeVisible();
});

for(const role of ['main','secondary'])test(`drag ${role} across physical tracks and time rows keeps bindings and one-step undo`,async({page},info)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));const before=await dragFixture(page);
  const [main,secondary,target]=before.subtitles.tracks,source=role==='main'?main:secondary;
  const start=await trackPoint(page,source.id,2000),vertical=await trackPoint(page,target.id,2000);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(vertical.x,vertical.y,{steps:5});await page.mouse.up();
  const moved=await snap(page),cue=before.subtitles.cues.find(c=>c.track_id===source.id);
  expect(moved.subtitles.cues.find(c=>c.id===cue.id).track_id).toBe(target.id);
  expect(moved.subtitles.cues.find(c=>c.id===cue.id).content.start).toBe(cue.content.start);
  expect(moved.subtitles.bindings).toEqual(before.subtitles.bindings);
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles).toEqual(before.subtitles);
  const destination=await trackPoint(page,target.id,12000);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(destination.x,destination.y,{steps:8});
  const landing=page.locator(`.waveform-row[data-start-ms="10000"] .waveform-cue-block[data-cue-id="${cue.id}"]`);
  const rect=await landing.boundingBox();expect(rect.y).toBeLessThan(destination.y);expect(rect.y+rect.height).toBeGreaterThan(destination.y);
  await expect(landing).toHaveClass(/drag-destination/);await expect(page.locator('.waveform-drag-destination')).toContainText(target.name);
  await page.screenshot({path:info.outputPath('drag-destination-'+role+'.png')});
  await page.mouse.up();await expect(page.locator('.waveform-drag-destination')).toHaveCount(0);
  const after=await snap(page),a=after.subtitles.cues.find(c=>c.id===cue.id);
  expect(a.track_id).toBe(target.id);expect(a.content.start).toBe(cue.content.start+10000);
  expect(a.content.end-a.content.start).toBe(cue.content.end-cue.content.start);
  expect(after.subtitles.bindings).toHaveLength(1);
  if(role==='main')expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
  else expect(after.subtitles.cues.find(c=>c.track_id===main.id).content).toEqual(before.subtitles.cues.find(c=>c.track_id===main.id).content);
  await page.screenshot({path:info.outputPath('cross-track-row-'+role+'.png')});
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles).toEqual(before.subtitles);
  expect(errors).toEqual([]);
});

test('track drag rejects locked/occupied/bound-partner targets and Escape restores ownership and timing',async({page})=>{
  const before=await dragFixture(page),[main,secondary,target]=before.subtitles.tracks;
  const start=await trackPoint(page,main.id,2000),dest=await trackPoint(page,target.id,12000);
  const drag=async point=>{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(point.x,point.y);};
  await drag(dest);await page.keyboard.press('Escape');await page.mouse.up();
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(id=>fixedUpdateTrack(id,{locked:true}),target.id);const locked=await snap(page);
  await drag(dest);await page.mouse.up();expect((await snap(page)).subtitles).toEqual(locked.subtitles);
  await page.evaluate(id=>fixedUpdateTrack(id,{locked:false}),target.id);
  const partner=await trackPoint(page,secondary.id,2000);await drag(partner);await page.mouse.up();
  expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.evaluate(id=>layerCreateCue(10000,14000,'main',id),target.id);const occupied=await snap(page);
  await drag(dest);await page.mouse.up();expect((await snap(page)).subtitles).toEqual(occupied.subtitles);
  await page.locator('.waveform-cue-block[data-track="main"]').first().click({button:'right'});
  await expect(page.locator('#ctxmenu')).not.toContainText('移到轨道');
});

test('held drag keyboard adjustment survives the next pointer move and cancels as one operation',async({page})=>{
  const before=await dragFixture(page),[main,,target]=before.subtitles.tracks;
  const start=await trackPoint(page,main.id,2000),dest=await trackPoint(page,target.id,12000);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(dest.x,dest.y);
  // Observe live data without buildJson(), which commits pending editor state.
  const range=()=>page.evaluate(()=>[DATA.segments[0].start,getActiveExtensionTrack().segments[0].start]);
  expect(await range()).toEqual([11000,11200]);
  await page.keyboard.press('d');const adjusted=await range();expect(adjusted[0]).toBeGreaterThan(11000);expect(adjusted[1]-adjusted[0]).toBe(200);
  const next=await trackPoint(page,target.id,12500);await page.mouse.move(next.x,next.y);
  const moved=await range();expect(moved[0]).toBe(adjusted[0]+500);expect(moved[1]-moved[0]).toBe(200);
  await page.keyboard.press('Escape');await page.mouse.up();expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('preview polling and pending autosave do not commit stale panel times during a held drag',async({page})=>{
  const before=await dragFixture(page),[main,,target]=before.subtitles.tracks;
  const start=await trackPoint(page,main.id,2000),dest=await trackPoint(page,target.id,12000);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(dest.x,dest.y);
  const state=await page.evaluate(async()=>{
    // The preview renderer polls every 750 ms, independently of pointer events.
    await new Promise(resolve=>setTimeout(resolve,850));
    const project=MSWE.resolve('processing-host').exportProject();
    scheduleAutoSaveFlush();
    return {live:DATA.segments[0].start,exported:project.subtitles.cues.find(c=>c.content.text==='Hello world').content.start,
      dragging:Boolean(waveformEditor.drag)};
  });
  expect(state).toEqual({live:11000,exported:11000,dragging:true});
  await page.mouse.up();
  expect((await snap(page)).subtitles.cues.find(c=>c.content.text==='Hello world').content.start).toBe(11000);
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('subtitle dragging snaps only while Shift is held, including Shift before pointer down',async({page})=>{
  const before=await dragFixture(page),[main]=before.subtitles.tracks;
  await page.evaluate(()=>{player.currentTime=4;});
  const start=await trackPoint(page,main.id,2000),dest=await trackPoint(page,main.id,4980);
  const live=()=>page.evaluate(()=>DATA.segments[0].start);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(dest.x,dest.y);
  const free=await live();expect(Math.abs(free-3980)).toBeLessThan(25);expect(free).not.toBe(4000);
  const block=await page.locator(`.waveform-cue-block[data-cue-id="${before.subtitles.cues[0].id}"]`).first().elementHandle();
  await page.keyboard.down('Shift');expect(await live()).toBe(4000);
  await page.keyboard.up('Shift');expect(await live()).toBe(free);
  expect(await block.evaluate(el=>el.isConnected)).toBe(true);
  await page.keyboard.press('Escape');await page.mouse.up();
  await page.keyboard.down('Shift');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(dest.x,dest.y);await page.mouse.up();await page.keyboard.up('Shift');
  expect(await live()).toBe(4000);
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles).toEqual(before.subtitles);
  await page.mouse.move(start.x,start.y);await page.mouse.click(start.x,start.y);
  expect(await page.evaluate(()=>selectedIdxs.has(0))).toBe(true);
  await page.keyboard.down('Shift');await page.mouse.click(start.x,start.y);await page.keyboard.up('Shift');
  expect(await page.evaluate(()=>selectedIdxs.has(0))).toBe(false);
});

test('same-track cross-row relocation can pass earlier cues without overwriting them',async({page})=>{
  const before=await dragFixture(page),[main]=before.subtitles.tracks;
  await page.evaluate(id=>layerCreateCue(5000,6000,'main',id),main.id);const initial=await snap(page);
  const start=await trackPoint(page,main.id,2000),dest=await trackPoint(page,main.id,12000);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(dest.x,dest.y);await page.mouse.up();
  const result=await snap(page);expect(result.subtitles.cues.find(c=>c.content.text==='Hello world').content.start).toBe(11000);
  expect(result.subtitles.cues.find(c=>c.content.start===5000)).toEqual(initial.subtitles.cues.find(c=>c.content.start===5000));
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles).toEqual(initial.subtitles);
});

test('local timing undo preserves marker references when a head moves past its members',async({page})=>{
  const before=await dragFixture(page),[main]=before.subtitles.tracks;
  await page.evaluate(id=>{
    layerCreateCue(5000,6000,'main',id);
    DATA.segments[0].color={name:'red',value:'#ff0000',start:1000,end:6000};
    DATA.segments[1].color_ref={headIdx:0};fixedBeginEdit();renderAll();
  },main.id);
  const initial=await snap(page),start=await trackPoint(page,main.id,2000),dest=await trackPoint(page,main.id,12000);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(dest.x,dest.y);await page.mouse.up();
  const moved=await snap(page);
  expect(moved.subtitles.cues.find(c=>c.content.text==='Hello world').content.start).toBe(11000);
  expect(await page.evaluate(()=>DATA.segments[0].color_ref.headIdx)).toBe(1);
  for(let i=0;i<2;i++){
    await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(initial.subtitles);
    expect(await page.evaluate(()=>DATA.segments[1].color_ref.headIdx)).toBe(0);
    await page.evaluate(()=>performRedo());expect((await snap(page)).subtitles).toEqual(moved.subtitles);
  }
});

test('multi-selection changes physical tracks together while keeping relative lanes',async({page})=>{
  await page.evaluate(waveform=>{
    let p=MSWFlatSubtitles.migrate({segments:[{id:'a',start:1000,end:3000,text:'First'}],waveform});
    for(const id of ['second','third','fourth'])p=MSWFlatSubtitles.addTrack(p,{...p.subtitles.tracks[0],id,name:id});
    p=MSWFlatEditing.addCue(p,'second','b',4000,5000,'Second');
    applyCanonicalProject(p,'multi.mosp');waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.settings.rowHeight=240;
    updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false});waveformEditor.render();
    clearSelection({silent:true});DATA.segments.forEach((_,i)=>selectedIdxs.add(i));updateMultiSelectionClasses();
  },generateWaveformPayload(10000));
  const before=await snap(page),start=await trackPoint(page,before.subtitles.tracks[0].id,2000),dest=await trackPoint(page,'third',2000);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(dest.x,dest.y,{steps:8});await page.mouse.up();
  const moved=await snap(page);expect(moved.subtitles.cues.map(c=>c.track_id)).toEqual(['third','fourth']);
  expect(moved.subtitles.cues.map(c=>[c.content.start,c.content.end])).toEqual([[1000,3000],[4000,5000]]);
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles).toEqual(before.subtitles);
});

test('copy/paste and subtitle assets keep independent tracks and paired cards',async({page})=>{
  await page.locator('#open-project-file').setInputFiles({name:'pairs.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});
  const result=await page.evaluate(()=>{
    selectOnly(0);selectedExtensionIdxs.add(0);copySelectedCues();
    MSWE.resolve('processing-host').copySubtitleAssets();
    const ids=DATA.msw.subtitle_assets.map(a=>a.id),owner=fixedOwner(DATA.segments[0]);fixedActiveTrackId=owner;
    const placed=MSWProductionProject.place(DATA,productionClipboard.rows,productionClipboard.bindings,4000,owner);
    productionCommitProject(MSWProductionProject.toProject(placed.project),'测试粘贴',placed.ids);
    const pasted=JSON.parse(buildJson());
    const plan=MSWAssets.insert(DATA,ids,7000,{},c=>c,{subtitleTrackId:owner});productionCommitProject(MSWProductionProject.toProject(plan.project),'素材插入');
    return {pasted,final:JSON.parse(buildJson())};
  });
  expect(result.pasted.subtitles.cues).toHaveLength(4);expect(result.pasted.subtitles.bindings).toHaveLength(2);
  expect(result.final.subtitles.cues).toHaveLength(6);expect(result.final.subtitles.bindings).toHaveLength(3);
  await expect(page.locator('.multi-dual-cue')).toHaveCount(3);
  await page.keyboard.press('Control+z');expect((await snap(page)).subtitles.cues).toHaveLength(4);
});

for(const method of ['ctrl','menu'])test(`normal empty physical track creates through ${method}`,async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>{applyCanonicalProject(p,'empty.mosp');waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;
    waveformEditor.settings.rowHeight=140;waveformEditor.render();updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false});},fixture());
  await page.locator('.waveform-track-heads-column').click({button:'right',position:{x:10,y:12}});
  await page.getByRole('menuitem',{name:'新增字幕轨道',exact:true}).click();
  const before=await snap(page),target=before.subtitles.tracks.at(-1).id;
  const point=time=>page.evaluate(({target,time})=>{
    const row=document.querySelector('.waveform-row'),r=row.getBoundingClientRect(),lane=fixedLayout().positions.get(JSON.stringify([target,'main']));
    return {x:r.left+r.width*(time-Number(row.dataset.startMs))/(Number(row.dataset.endMs)-Number(row.dataset.startMs)),
      y:r.bottom-(parseFloat(row.style.getPropertyValue('--audio-lane-space'))||0)-7-lane*waveformEditor.subtitleGeometry().pitch-waveformEditor.subtitleGeometry().height/2};
  },{target,time});
  const a=await point(1500),b=await point(2500);await page.mouse.move(a.x,a.y);
  if(method==='ctrl') {
    await page.keyboard.down('Control');await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:5});
    await expect(page.locator('.waveform-create-preview')).toHaveAttribute('data-subtitle-track-id',target);
    await page.mouse.up();await page.keyboard.up('Control');
  } else {await page.mouse.click(a.x,a.y,{button:'right'});await page.locator('#ctxmenu .item').filter({hasText:'创建字幕'}).click();}
  const after=await snap(page),added=after.subtitles.cues.filter(c=>!before.subtitles.cues.some(a=>a.id===c.id));
  expect(added).toHaveLength(1);expect(added[0].track_id).toBe(target);expect(Math.abs(added[0].content.start-1500)).toBeLessThan(30);
  expect(after.subtitles.bindings).toEqual(before.subtitles.bindings);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);expect(errors).toEqual([]);
});

test('normal subtitle import, column swap and track replacement preserve other physical tracks',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>applyCanonicalProject(p,'import.mosp'),{segments:fixture().segments,waveform:fixture().waveform});
  const before=await snap(page);
  await page.evaluate(()=>showMultiSubtitleImportChoice({name:'translation.srt'},[{start:1000,end:3000,text:'新译文'}]));
  await page.locator('#subtitle-import-bind').check();
  await page.locator('#multi-subtitle-import-result-confirm').click();
  await expect(page.locator('.multi-cue-column.extension')).toContainText('新译文');
  const imported=await snap(page);expect(imported.subtitles.tracks).toHaveLength(2);expect(imported.subtitles.bindings).toHaveLength(1);
  await page.evaluate(()=>swapMainAndExtensionSubtitles());
  await expect(page.locator('.multi-cue-column.main')).toContainText('新译文');
  const swapped=await snap(page);expect([...swapped.subtitles.cues].sort((a,b)=>a.id.localeCompare(b.id))).toEqual([...imported.subtitles.cues].sort((a,b)=>a.id.localeCompare(b.id)));
  expect(swapped.subtitles.bindings).toEqual(imported.subtitles.bindings);
  await page.evaluate(p=>applyCanonicalProject(p,'reopen.mosp'),swapped);
  await expect(page.locator('.multi-cue-column.main')).toContainText('新译文');
  await page.evaluate(()=>{fixedActiveTrackId=DATA.subtitle_tracks.tracks[0].id;replaceMainTrack([{start:4000,end:5000,text:'新原文'}],'replace.srt');});
  const replaced=await snap(page);expect(replaced.subtitles.cues.map(c=>c.content.text).sort()).toEqual(['新原文','新译文']);
  expect(replaced.subtitles.tracks).toEqual(imported.subtitles.tracks);expect(replaced.subtitles.bindings).toEqual([]);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(swapped.subtitles);
  expect(before.subtitles.cues).toHaveLength(1);expect(errors).toEqual([]);
});

test('native paired blocks drag with offsets, disable independently, and restore without changing identity',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(p=>{applyCanonicalProject(p,'drag.mosp');waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;
    waveformEditor.settings.rowHeight=140;waveformEditor.render();updateEditorSettings({clickBehavior:'select-only',autoSaveProject:false});},fixture());
  const before=await snap(page),first=before.subtitles.cues[0],id=first.id;
  const block=await page.locator(`.waveform-cue-block[data-cue-id="${id}"]`).first().boundingBox(),row=await page.locator('.waveform-row').first().boundingBox();
  await page.mouse.move(block.x+block.width/2,block.y+block.height/2);await page.mouse.down();
  await page.mouse.move(row.x+row.width*.6,block.y+block.height/2,{steps:6});await page.mouse.up();
  const moved=await snap(page),a=moved.subtitles.cues.find(c=>c.id===id),b=moved.subtitles.cues.find(c=>c.id!==id);
  expect(a.content.start).toBeGreaterThan(first.content.start);expect(b.content.start-a.content.start).toBe(200);
  expect(moved.subtitles.bindings).toEqual(before.subtitles.bindings);expect(a.track_id).toBe(first.track_id);
  await page.evaluate(()=>performUndo());expect((await snap(page)).subtitles).toEqual(before.subtitles);
  const head=page.locator(`.fixed-track-head[data-subtitle-track-id="${first.track_id}"]`).first();await head.locator('.fixed-track-toggle').click();
  const disabled=await snap(page);expect(disabled.subtitles.tracks.find(t=>t.id===first.track_id).enabled).toBe(false);
  expect(disabled.subtitles.tracks.find(t=>t.id!==first.track_id).enabled).toBe(true);
  await page.evaluate(p=>MSWE.resolve('persistence-host').restore({project:p,filename:'restored.mosp'}),disabled);
  expect((await snap(page)).subtitles).toEqual(disabled.subtitles);await expect(page.locator('.multi-dual-cue')).toHaveCount(1);
  expect(errors).toEqual([]);
});
