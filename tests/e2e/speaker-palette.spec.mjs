import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync,readFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server,dir,project;
test.setTimeout(120000);
test.beforeEach(async({page})=>{
  dir=makeTempDir('speaker-palette');const media=join(dir,'video.mp4');project=join(dir,'project.mosp');
  process.env.MSW_APP_DATA_ROOT=join(dir,'app');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=darkblue:s=640x360:r=25:d=6','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media,segments:[{id:'a',start:0,end:3000,text:'Hello 世界'},{id:'b',start:3500,end:5500,text:'Second'}],waveform:generateWaveformPayload(6000)}));
  server=await startServer(project,media,await findFreePort());
  for(const stream of [server.proc.stdout,server.proc.stderr])stream.on('data',chunk=>appendFileSync(join(dir,'server.log'),chunk));
  await disableOnboarding(page);
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  await page.goto(server.url);await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2);
  await page.evaluate(()=>{player.pause();updateEditorSettings({autoSaveProject:false});});
});
test.afterEach(async()=>{await server?.stop();});
async function settings(page){await page.evaluate(()=>setEditorSettingsPanelOpen(true));await page.getByRole('button',{name:'说话人色系',exact:true}).click();}

test('project speaker table extends beyond five, marks from menu and saves renamed identities',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await settings(page);
  const rows=page.locator('#speaker-palette-rows tr');await expect(rows).toHaveCount(6);
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows.map(r=>r.mode))).toEqual(Array(5).fill('none'));
  for(let i=0;i<4;i++)await page.locator('#speaker-palette-add').click();
  await expect(rows).toHaveCount(10);const ninth=rows.nth(9);
  await ninth.locator('td:nth-child(2) input').fill('九号');await ninth.locator('td:nth-child(2) input').press('Tab');
  await ninth.locator('select').selectOption('text');
  await page.evaluate(()=>{setEditorSettingsPanelOpen(false);selectOnly(0);});await page.locator('.player-stage').click({position:{x:10,y:10}});
  await page.keyboard.press('9');
  expect(await page.evaluate(()=>DATA.segments[0].color.name)).toBe('speaker-9');
  await page.evaluate(()=>showContextMenu(500,300,0));
  await expect(page.locator('#ctxmenu > .item').filter({hasText:/^标记颜色|^清除颜色/})).toHaveCount(0);
  await page.getByRole('menuitem',{name:'标记字幕',exact:true}).hover();
  await expect(page.locator('.speaker-mark-swatches button')).toHaveCount(9);
  await expect(page.locator('[data-speaker="speaker-9"]')).toHaveAttribute('title','九号（9）');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(()=>saveCurrentProject({silent:true}))).toBe(true);
  const disk=JSON.parse(readFileSync(project));expect(disk.preview.speaker_palette.rows[8].name).toBe('九号');
  await page.reload();await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
  await settings(page);await page.screenshot({path:join(dir,'speakers-dark.png')});
  await page.evaluate(()=>{updateEditorSettings({themePreset:'alice',colors:null});applyThemeAndColors();});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');await page.screenshot({path:join(dir,'speakers-light.png'),animations:'disabled'});
  expect(await page.evaluate(()=>COLOR_PALETTE[8].label)).toBe('九号');expect(errors).toEqual([]);
});

test('master row, per-speaker separators, native preview, export name choice and undo agree',async({page})=>{
  await settings(page);const master=page.locator('#speaker-palette-rows tr').first();
  await master.locator('select').selectOption('speaker');
  expect(await page.evaluate(()=>DATA.preview.speaker_palette.rows.map(r=>r.mode))).toEqual(Array(5).fill('speaker'));
  await page.locator('#speaker-palette-rows tr').nth(1).locator('td:nth-child(5) input').fill(' / ');
  await page.locator('#speaker-palette-rows tr').nth(1).locator('td:nth-child(5) input').press('Tab');
  await page.evaluate(()=>{setEditorSettingsPanelOpen(false);selectOnly(0);assignColor([0],'yellow');seekFromWaveform(.5);});
  await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(r=>r.text.startsWith('SP1 / ')),null,{timeout:45000});
  const result=await page.evaluate(async()=>{
    const host=MSWE.resolve('processing-host');
    updateEditorSettings({exportSpeakerLabels:false});const plain=buildSrt(),ass=await fixedAssDocument();
    updateEditorSettings({exportSpeakerLabels:true});const named=buildSrt(),namedAss=await fixedAssDocument();
    const snapshot=host.exportProject();MSWSubtitleStyle.applyExport(snapshot);
    return {plain,ass,named,namedAss,videoNames:snapshot.preview.speaker_label_export};
  });
  expect(result.plain).not.toContain('SP1');expect(result.ass).not.toContain('SP1');
  expect(result.named).toContain('SP1 / Hello');expect(result.namedAss).toContain('SP1 / ');expect(result.videoNames).toBe(false);
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.segments[0].color)).toBeFalsy();
});

test('multi-track marking changes only selected identities, respects locking and undoes once',async({page})=>{
  const state=await page.evaluate(()=>{
    const F=MSWFlatSubtitles;let p=MSWE.resolve('processing-host').exportProject();
    const [a,b]=p.subtitles.cues;
    a.content.color={name:'red',start:0,end:5500};b.content.color_ref={name:'red',cue_id:a.id};
    p=F.addTrack(p,{...p.subtitles.tracks[0],id:'extra',name:'S2'});
    p.subtitles.cues.push({id:'extra-cue',track_id:'extra',content:{start:0,end:2000,text:'Other'}});
    applyCanonicalProject(p,'multi.mosp');
    const ids=[a.id,'extra-cue'],indices=ids.map(id=>DATA.segments.findIndex(c=>c.id===id));
    assignColor(indices,'blue');const saved=JSON.parse(buildJson());
    F.validate(saved);
    const colors=Object.fromEntries(saved.subtitles.cues.map(c=>[c.id,c.content.color?.name||c.content.color_ref?.name]));
    performUndo();const undone=DATA.segments.map(c=>MULTI_SUBTITLE_UTILS.effectiveColorName(c,DATA.segments));
    DATA.subtitle_tracks.tracks.find(t=>t.id==='extra').locked=true;
    assignColor(indices,'yellow');
    return {a:a.id,b:b.id,colors,undone,locked:DATA.segments.map(c=>MULTI_SUBTITLE_UTILS.effectiveColorName(c,DATA.segments))};
  });
  expect(state.colors).toEqual({[state.a]:'blue',[state.b]:'red','extra-cue':'blue'});
  expect(state.undone).toEqual(state.locked);expect(state.undone.filter(Boolean)).toEqual(['red','red']);
});
