import {test,expect} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer,clickMenubarItem} from './helpers.mjs';
let server;
const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
test.beforeAll(async()=>{
 const dir=makeTempDir('track-import-export'),media=generateWav(join(dir,'media.wav'),5),project=join(dir,'test.mosp');
 writeFileSync(project,JSON.stringify({media,segments:[{start:0,end:1000,text:'Source'}],waveform:generateWaveformPayload(5000)}));
 server=await startServer(project,media,await findFreePort());
});
test.afterAll(async()=>server?.stop());
test.beforeEach(async({page})=>{
 await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false,clickBehavior:'select-only'})));
 await page.goto(server.url);await expect(page.locator('#editor-loading')).not.toBeVisible();
 await page.evaluate(()=>{
  const p=JSON.parse(buildJson()),base=p.subtitles.tracks[0];p.subtitles.cues=[];p.subtitles.bindings=[];p.subtitle_view.secondary_cue_ids=[];
  p.subtitles.tracks=[{...base,id:'one',display_number:1},{...base,id:'two',display_number:2},{...base,id:'three',display_number:3},{...base,id:'off',display_number:4,enabled:false}];p.subtitles.next_track_number=5;
  for(const [i,t]of p.subtitles.tracks.entries())p.subtitles.cues.push({id:'cue-'+t.id,track_id:t.id,content:{start:i===2?2000:1000,end:i===2?3000:2000,text:'Text '+t.id,items:[]}});
  p.subtitle_view.secondary_cue_ids=['cue-three'];applyCanonicalProject(p,'track-tools.mosp');fixedActiveTrackId='one';clearSelection({silent:true});renderAll({waveform:'full'});
 });
 await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle.ready)).toBe(true);
});
async function importSrt(page) {
 await page.locator('#load-srt-file').setInputFiles({name:'incoming.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nImported words\n')});
 await expect(page.locator('#multi-subtitle-import-modal')).toBeVisible();
}
test('SRT loading chooses independent new track by default and undoes once',async({page},info)=>{
 const before=await snapshot(page);await importSrt(page);
 await expect(page.locator('#subtitle-import-target')).toHaveValue('new');await expect(page.locator('#subtitle-import-bind')).not.toBeChecked();
 await page.screenshot({path:info.outputPath('import.png')});await page.locator('#multi-subtitle-import-result-confirm').click();
 const after=await snapshot(page);expect(after.subtitles.tracks.length).toBe(5);expect(after.subtitles.cues.length).toBe(5);expect(after.subtitles.bindings).toEqual([]);
 await page.keyboard.press('Control+z');expect((await snapshot(page)).subtitles.cues).toEqual(before.subtitles.cues);
});
test('import explicitly replaces physical track across list columns without replacing others',async({page})=>{
 const before=await snapshot(page);await importSrt(page);await page.locator('#subtitle-import-target').selectOption('three');
 await expect(page.locator('#multi-subtitle-import-preview')).toContainText('替换 S3');await page.locator('#multi-subtitle-import-result-confirm').click();
 const after=await snapshot(page);expect(after.subtitles.cues.filter(c=>c.track_id==='three').map(c=>c.content.text)).toEqual(['Imported words']);
 expect(after.subtitles.cues.filter(c=>c.track_id!=='three')).toEqual(before.subtitles.cues.filter(c=>c.track_id!=='three'));
});
test('optional import binding uses the explicit reference and preserves it through undo',async({page})=>{
 await importSrt(page);await page.locator('#subtitle-import-bind').check();await page.locator('#subtitle-import-reference').selectOption('two');
 await expect(page.locator('#multi-subtitle-import-preview')).toContainText('匹配绑定 1 对');await page.locator('#multi-subtitle-import-result-confirm').click();
 const p=await snapshot(page);expect(p.subtitles.bindings).toHaveLength(1);expect(p.subtitles.bindings[0].source_id).toBe('cue-two');
 await page.keyboard.press('Control+z');expect((await snapshot(page)).subtitles.bindings).toEqual([]);
});
test('project subtitle import selects the physical source even when its cues are displayed on the right',async({page})=>{
 const before=await snapshot(page);
 await page.evaluate(async()=>{
  const file=new File([buildJson()],'source.mosp',{type:'application/json'});
  await showMultiSubtitleImportChoice(file,await parseSubtitleImportFile(file),{projectFile:file});
 });
 await page.locator('#multi-subtitle-import-extension').click();
 await page.locator('#subtitle-import-source').selectOption('three');
 await page.locator('#multi-subtitle-import-result-confirm').click();
 const after=await snapshot(page),added=after.subtitles.cues.filter(c=>!before.subtitles.cues.some(old=>old.id===c.id));
 expect(added.map(c=>c.content.text)).toEqual(['Text three']);
 expect(after.subtitles.cues.filter(c=>before.subtitles.cues.some(old=>old.id===c.id))).toEqual(before.subtitles.cues);
});
test('dropping SRT into an empty project still asks for a destination and can be cancelled',async({page})=>{
 await page.evaluate(async()=>{
  const p=MSWProductionProject.toProject(DATA);p.subtitles.cues=[];p.subtitles.bindings=[];p.subtitle_view.secondary_cue_ids=[];productionCommitProject(p,'Empty test project');
  await handleDroppedFiles([new File(['1\n00:00:00,000 --> 00:00:01,000\nDropped text\n'],'drop.srt',{type:'text/plain'})]);
 });
 await expect(page.locator('#subtitle-import-target')).toBeVisible();expect((await snapshot(page)).subtitles.cues).toHaveLength(0);
 await page.locator('#multi-subtitle-import-result-cancel').click();expect((await snapshot(page)).subtitles.cues).toHaveLength(0);
});
test('shared SRT and exact ASS export scope includes right-column third track and excludes disabled',async({page},info)=>{
 const before=await snapshot(page);
 const all=await page.evaluate(()=>buildSrt());expect(all).toContain('Text three');expect(all).toContain('Text two');expect(all).not.toContain('Text off');
 await clickMenubarItem(page,'文件','subtitle-export-btn');
 await page.locator('#subtitle-export-scope label').filter({hasText:/^S1$/}).click();
 await expect.poll(()=>page.evaluate(()=>fixedExportTracks)).toEqual(['two','three']);
 await page.locator('#subtitle-export-scope label').filter({hasText:/^S2$/}).click();
 await expect.poll(()=>page.evaluate(()=>fixedExportTracks)).toEqual(['three']);
 await page.screenshot({path:info.outputPath('export-scope.png')});
 const scoped=await page.evaluate(async()=>({srt:buildSrt(),ass:await fixedAssDocument()}));
 for(const text of Object.values(scoped)){expect(text).toContain('Text three');expect(text).not.toContain('Text one');expect(text).not.toContain('Text two');expect(text).not.toContain('Text off');}
 expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
});
test('audio fill has explicit target, skips repeat and occupancy, and one undo preserves other tracks',async({page},info)=>{
 await page.evaluate(()=>{
  const extension=MSWProject.ensure(DATA),id='audio-'+'a'.repeat(32),asset={id,kind:'audio',path:'msw-'+'b'.repeat(24)+'.assets/audio/'+id+'.wav',sha256:'a'.repeat(64),sample_rate:8000,sample_count:8000,channels:1,byte_size:16044,job_id:'test-job',source_ref:{key:'test',id:'test',track_id:null,text:'Filled words',start:3000,end:4000},generation:{provider:'edge',model:'test',voice:'test',language_type:'Auto',display_text:'Filled words',spoken_text:'Filled words'}};
  extension.assets=[asset];extension.audio_tracks=[{id:'test-voice',name:'Voice',gain_db:0,muted:false}];extension.audio_clips=[MSWAudio.create(asset,'test-voice',3000,'clip-test')];
  window.dispatchEvent(new Event('msw:audio-changed'));waveformEditor.refreshAudioTimeline();
 });
 const before=await snapshot(page);await page.locator('.msw-audio-clip[data-clip-id="clip-test"]').first().click();
 await page.locator('#audio-actions-open').evaluate(n=>n.click());await page.locator('#audio-actions-fill-track').selectOption('three');
 await expect(page.locator('#audio-actions-fill-count')).toContainText('1 / 1');await page.screenshot({path:info.outputPath('audio-fill.png')});
 await page.locator('#audio-actions-fill').click();let p=await snapshot(page);
 expect(p.subtitles.cues.filter(c=>c.track_id==='three').sort((a,b)=>a.content.start-b.content.start).map(c=>c.content.text)).toEqual(['Text three','Filled words']);
 await page.locator('#audio-actions-fill').click();expect((await snapshot(page)).subtitles.cues).toHaveLength(5);
 await expect(page.locator('#audio-actions-message')).toContainText('跳过 1');
 await page.locator('#audio-actions-close').click();await page.keyboard.press('Control+z');p=await snapshot(page);expect(p.subtitles.cues).toEqual(before.subtitles.cues);
});
