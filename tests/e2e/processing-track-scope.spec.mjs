import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,enableSplitMoreActions,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server;
test.beforeAll(async()=>{
 const dir=makeTempDir('processing-track-scope'),media=generateWav(join(dir,'media.wav'),5),project=join(dir,'test.mosp');
 process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');
 writeFileSync(process.env.MAW_ENV_FILE,'');
 writeFileSync(project,JSON.stringify({media,segments:[{start:0,end:1000,text:'Source'}],waveform:generateWaveformPayload(5000)}));
 server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>server?.stop());
test.afterEach(async({page})=>page.unrouteAll({behavior:'ignoreErrors'}));
test.beforeEach(async({page})=>{
 await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,clickBehavior:'select-only',selectBoundSubtitlePair:false})));
 await page.route('**/providers',route=>route.fulfill({json:{ok:true,selectedProvider:'custom',providers:[{id:'custom',label:'Test provider',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',hasApiKey:true}]}}));
 await page.route('**/asr-settings',async route=>{const response=await route.fetch(),data=await response.json();for(const provider of data.providers)provider.hasApiKey=true;await route.fulfill({json:data});});
 await page.goto(server.url);await expect(page.locator('#editor-loading')).not.toBeVisible();
 await page.evaluate(()=>{
  const p=JSON.parse(buildJson()),base=p.subtitles.tracks[0];
  p.subtitles.tracks=[{...base,id:'one',display_number:1},{...base,id:'two',secondary_for:'one',display_number:1},{...base,id:'three',display_number:2}];p.subtitles.next_track_number=3;
  p.subtitles.cues=[{id:'a',track_id:'one',content:{start:500,end:2200,text:'one two three four',items:[]}},
   {id:'b',track_id:'two',content:{start:600,end:1800,text:'甲乙丙丁戊己',items:[]}},
   {id:'c',track_id:'three',content:{start:3000,end:4000,text:'Other words',items:[]}}];
  p.subtitles.bindings=[{id:'pair',source_id:'a',target_id:'b',start_offset_ms:100,end_offset_ms:-400}];
  p.subtitle_view.secondary_cue_ids=['b','c'];applyCanonicalProject(p,'processing-scopes.mosp');
  fixedActiveTrackId='one';clearSelection({silent:true});renderAll({waveform:'full'});
 });
});
const openTranslation=page=>page.locator('#subtitle-translate-btn').evaluate(n=>n.click());

test('translation source selects a physical track independently of selection and snapshots only that track',async({page},info)=>{
 await openTranslation(page);await page.locator('#translation-source').selectOption('two');
 await expect(page.locator('#translation-scope')).toHaveText('来源：S1副 · 1');
 await expect(page.locator('#translation-start')).toBeEnabled();
 await page.evaluate(()=>selectOnly(0));await openTranslation(page);
 await expect(page.locator('#translation-scope')).toHaveText('来源：S1副 · 1');
 let payload;await page.route('**/jobs',async route=>{payload=route.request().postDataJSON();await route.fulfill({status:400,json:{ok:false,error:'Fixture: captured without cloud request'}});});
 await page.locator('#translation-start').click();
 await expect.poll(()=>payload?.snapshot?.entries?.length).toBe(1);
 expect(payload.snapshot.entries.map(e=>e.source.text)).toEqual(['甲乙丙丁戊己']);
 expect(payload.snapshot.entries[0].target.text).toBe('one two three four');
 await page.screenshot({path:info.outputPath('translation-source.png')});
 await page.locator('#translation-source').selectOption('selected');await expect(page.locator('#translation-scope')).toHaveText('来源：S1主 · 1');
 await page.evaluate(()=>clearSelection());await openTranslation(page);await expect(page.locator('#translation-start')).toBeDisabled();
});
test('ASR rejects an empty time selection and expands only the destination track on the right',async({page},info)=>{
 await page.evaluate(()=>{
  const p=MSWProductionProject.toProject(DATA);p.subtitles.bindings=[];productionCommitProject(p,'Unbind test');
 });
 await page.evaluate(()=>MSWE.resolve('media').refresh());
 await expect.poll(()=>page.evaluate(()=>Boolean(MSWE.resolve('media').current))).toBe(true);
 await page.evaluate(()=>{
  MSWE.resolve('time-range').setRange([]);MSWE.resolve('asr').open('range');
 });
 await expect(page.locator('#msw-asr-scope')).toContainText('有效时间范围');await expect(page.locator('#msw-asr-start')).toBeDisabled();
 await page.locator('#msw-asr-target-track').selectOption('two');
 await page.evaluate(()=>MSWE.resolve('time-range').setRange({start:800,end:1900}));
 await expect(page.locator('#msw-asr-expand')).toBeVisible();await page.locator('#msw-asr-expand').click();
 expect(await page.evaluate(()=>MSWE.resolve('time-range').ranges)).toEqual([{start:600,end:1900}]);
 await expect(page.locator('#msw-asr-scope')).toHaveText('S1副 · 0.600–1.900 s · 范围内已有字幕 1');
 await expect(page.locator('#msw-asr-start')).toBeEnabled();await expect(page.locator('#msw-asr-expand')).toBeHidden();
 await page.screenshot({path:info.outputPath('asr-scope.png'),animations:'disabled'});
 await page.locator('#msw-asr-target-track').selectOption('three');
 await expect(page.locator('#msw-asr-scope')).toHaveText('S2 · 0.600–1.900 s · 范围内已有字幕 0');
 await expect(page.locator('#msw-asr-expand')).toBeHidden();
 await page.evaluate(()=>fixedUpdateTrack('three',{enabled:false}));
 await expect(page.locator('#msw-asr-target-track')).toHaveValue('three');await expect(page.locator('#msw-asr-start')).toBeDisabled();
 await expect(page.locator('#msw-asr-scope')).toContainText('已启用且未锁定');
});
test('translation shows binding reference and destination despite swapping display columns',async({page},info)=>{
 await page.evaluate(()=>{selectOnly(0);selectedExtensionIdxs.add(0);});await openTranslation(page);
 await expect(page.locator('#translation-scope')).toContainText('S1主 · 1 · 绑定双方去重 1');
 await expect(page.locator('#translation-target-summary')).toHaveText('译文：S1副 · 1');await expect(page.locator('#translation-start')).toBeEnabled();
 await expect(page.locator('#subtitle-translation-panel')).toHaveCSS('opacity','1');
 await page.screenshot({path:info.outputPath('translation-scope.png'),animations:'disabled'});
 await page.locator('#translation-destination').selectOption('one');await expect(page.locator('#translation-scope-issue')).toContainText('另一条轨道');await expect(page.locator('#translation-start')).toBeDisabled();
 await page.locator('#translation-destination').selectOption('');
 await page.evaluate(()=>{
  productionCommitProject(MSWProductionProject.swapColumns(DATA),'Swap test', ['a','b'],{displayOnly:true});
  selectedIdxs.clear();selectedExtensionIdxs.clear();
  selectedIdxs.add(DATA.segments.findIndex(c=>c.id==='b'));selectedExtensionIdxs.add(getActiveExtensionTrack().segments.findIndex(c=>c.id==='a'));
 });await openTranslation(page);
 await expect(page.locator('#translation-scope')).toContainText('S1主 · 1');await expect(page.locator('#translation-target-summary')).toHaveText('译文：S1副 · 1');
 await page.evaluate(()=>{clearSelection({silent:true});selectOnly(DATA.segments.findIndex(c=>c.id==='b'));});await openTranslation(page);
 await expect(page.locator('#translation-scope')).toHaveText('来源：S1副 · 1');await expect(page.locator('#translation-target-summary')).toHaveText('译文：S1主 · 1');
});
test('translation counts mixed physical tracks and validates disabled sources before submission',async({page})=>{
 await page.evaluate(()=>{
  const p=MSWProductionProject.toProject(DATA);p.subtitles.bindings=[];productionCommitProject(p,'Unbind test');
  clearSelection({silent:true});selectedIdxs.add(0);selectedExtensionIdxs.add(getActiveExtensionTrack().segments.findIndex(c=>c.id==='c'));
 });await openTranslation(page);await page.locator('#translation-destination').selectOption('new');
 await expect(page.locator('#translation-scope')).toHaveText('来源：S1主 · 1 / S2 · 1');await expect(page.locator('#translation-target-summary')).toHaveText('译文：新建 S3 · 2');
 await expect(page.locator('#translation-start')).toBeEnabled();
 await page.evaluate(()=>{DATA.segments[0].disabled=true;window.dispatchEvent(new Event('msw:subtitles-changed'));});
 await expect(page.locator('#translation-scope-issue')).toContainText('禁用');await expect(page.locator('#translation-start')).toBeDisabled();
 await page.evaluate(()=>clearSelection({silent:true}));await openTranslation(page);
 await expect(page.locator('#translation-scope')).toHaveText('请先选择要翻译的字幕');await expect(page.locator('#translation-start')).toBeDisabled();
});
test('linked split labels and active-only action identify physical cues on either display side',async({page},info)=>{
 await enableSplitMoreActions(page);await page.evaluate(()=>requestSubtitleSplit('main',0,{timeMs:1200,requireConfirm:true}));
 await expect(page.locator('#multi-subtitle-split-main-lane h4')).toHaveText('S1主_1');
 await expect(page.locator('#multi-subtitle-split-extension-lane h4')).toHaveText('S1副_1');
 await expect(page.locator('#multi-subtitle-split-independent')).toContainText('仅切 S1主_1 并解绑');
 await page.locator('#multi-subtitle-split-main-text').press('ArrowDown');
 await expect(page.locator('#multi-subtitle-split-independent')).toContainText('仅切 S1副_1 并解绑');
 await page.screenshot({path:info.outputPath('linked-labels.png')});
 await page.locator('#multi-subtitle-split-cancel').click();
 await page.evaluate(()=>{productionCommitProject(MSWProductionProject.swapColumns(DATA),'Swap test',[],{displayOnly:true});requestSubtitleSplit('main',0,{timeMs:1200,requireConfirm:true});});
 await expect(page.locator('#multi-subtitle-split-main-lane h4')).toHaveText('S1副_1');
 await expect(page.locator('#multi-subtitle-split-extension-lane h4')).toHaveText('S1主_1');
});
