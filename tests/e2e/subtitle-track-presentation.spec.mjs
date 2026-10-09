import {expect,test} from '@playwright/test';
import {join} from 'node:path';
import {mkdirSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {cleanupTempDir,generateBlankEditor,findFreePort,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
let tempDir,server;
test.beforeAll(async()=>{
  tempDir=makeTempDir('track-presentation');
  const ffmpeg=process.env.MSW_TEST_FFMPEG?join(process.env.MSW_TEST_FFMPEG,process.platform==='win32'?'ffmpeg.exe':'ffmpeg'):'ffmpeg';
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x34465c:s=640x360:r=10:d=20','-c:v','libx264','-pix_fmt','yuv420p',join(tempDir,'video.mp4')],{windowsHide:true});
  server=await startStaticServer(generateBlankEditor(join(tempDir,'blank.html')),await findFreePort());
});
test.afterAll(async()=>{await server?.stop();cleanupTempDir(tempDir);});
const cue=(id,start,end,text=id)=>({id,start,end,text,items:[]});
const bilingual={multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'zh',role:'extension',segments:[cue('sub',1200,5200,'这是画面文字的译文')]}],bindings:[{id:'pair',track_id:'zh',main_segment_ids:['a'],extension_segment_ids:['sub'],start_offset_ms:200,end_offset_ms:200}]}};
async function open(page,extra={}){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.onboarding.v1','skipped'));
  await page.goto(server.url+'?subtitle-tracks=1');
  await page.evaluate(data=>{
    applyCanonicalProject(data,'presentation.mosp');updateEditorSettings({autoSaveProject:false,clickBehavior:'select-only'});
    overlayToggle.checked=true;extensionOverlayToggle.checked=true;
  },{segments:[cue('a',1000,5000,'Annotation and dialogue'),cue('b',2000,4000,'A simultaneous speaker'),cue('later',10000,12000,'A distant long sentence '.repeat(30))],waveform:generateWaveformPayload(20000),...extra});
  await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready);
  await page.evaluate(bytes=>loadMediaFile(new File([new Uint8Array(bytes)],'video.mp4',{type:'video/mp4'}),{localOnly:true,previewOnly:true}),[...readFileSync(join(tempDir,'video.mp4'))]);
  await page.waitForFunction(()=>player.readyState>=2&&player.videoWidth===640);
  await page.evaluate(()=>{player.currentTime=2.5;refreshSubtitlePreview(2500);});
  expect(errors).toEqual([]);return errors;
}
async function enable(page){await page.evaluate(()=>MSWE.resolve('processing-host').openMediaSettings());await page.locator('#style-track-layout').selectOption('fixed');}
const entries=page=>page.evaluate(()=>fixedPreviewLayout().layout.entries.map(e=>({id:e.cue_id,x:e.x,y:e.y,width:e.width,height:e.height,track:e.group.trackId})));
async function annotation(page){await page.evaluate(()=>{fixedAddTrack('annotation',[fixedRef(DATA.segments.find(c=>c.id==='a'))]);MSWSubtitleStyle.editTrack(fixedActiveTrackId);});}

test('legacy layout is preserved until explicit switch; measured dialogue stays stable as neighbours enter and leave',async({page})=>{
  const errors=await open(page);expect(await page.evaluate(()=>DATA.subtitle_tracks.presentation)).toBe('legacy');
  await enable(page);await page.locator('#media-settings-close').click();
  const before=await entries(page),a=before.find(e=>e.id==='a'),b=before.find(e=>e.id==='b');expect(b.y+b.height).toBeLessThan(a.y);
  const positions=[];for(const time of [1500,2500,4500])positions.push(await page.evaluate(time=>{refreshSubtitlePreview(time);const e=document.querySelector('.fixed-subtitle-row[data-cue-id="a"]');return e.style.top;},time));
  expect(new Set(positions).size).toBe(1);
  await page.evaluate(()=>{DATA.segments.find(c=>c.id==='later').text+='more '.repeat(100);fixedPreviewInvalidate();refreshSubtitlePreview(2500);});
  expect((await entries(page)).filter(e=>e.id!=='later')).toEqual(before.filter(e=>e.id!=='later'));
  await page.locator('#player').hover();expect((await entries(page)).find(e=>e.id==='a').y).toBe(a.y);
  expect(errors).toEqual([]);
});
test('track styles inherit or snapshot independently; proof choice survives switching and undo',async({page})=>{
  const errors=await open(page);await enable(page);
  const id=await page.evaluate(()=>DATA.subtitle_tracks.tracks[1].id);await page.locator('#style-track-target').selectOption(id);
  await expect(page.locator('#style-project-preset')).toHaveValue('inherit');
  await page.locator('#style-field-fontSize').fill('83');await page.locator('#style-field-fontSize').press('Tab');
  expect(await page.evaluate(()=>fixedStyleTarget().style.value.main.fontSize)).toBe(83);
  await page.locator('#style-preview-mode').selectOption('contrast');await page.locator('#style-project-preset').selectOption('large');
  await expect(page.locator('#style-preview-mode')).toHaveValue('contrast');
  await page.locator('#style-project-preset').selectOption('current');await expect(page.locator('#style-field-fontSize')).toHaveValue('83');
  await page.locator('#style-project-preset').selectOption('inherit');expect(await page.evaluate(()=>fixedStyleTarget().style.mode)).toBe('inherit');
  await page.evaluate(()=>performUndo());await expect(page.locator('#style-field-fontSize')).toHaveValue('83');
  await expect(page.locator('#style-preview-mode')).toHaveValue('contrast');expect(errors).toEqual([]);
});
test('bound annotation drag changes current pair only, supports Escape, one undo and saved reopening',async({page})=>{
  const errors=await open(page,bilingual);await enable(page);await annotation(page);
  await page.locator('#style-position-scope').selectOption('cue');await page.locator('#style-position-drag').click();
  const target=page.locator('.fixed-subtitle-row[data-cue-id="a"]');await expect(target).toBeVisible();
  const rect=await target.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();expect(await page.evaluate(()=>!!fixedPositionDrag)).toBe(true);await page.mouse.move(rect.x+rect.width/2+50,rect.y+rect.height/2+40,{steps:5});await page.mouse.up();
  const saved=await page.evaluate(()=>JSON.parse(buildJson()));const p=saved.segments.find(c=>c.id==='a').subtitle_position;
  expect(p.x).toBeGreaterThan(.5);expect(p.y).toBeGreaterThan(.08);expect(saved.multi_subtitle.tracks[0].segments[0].subtitle_position).toEqual(p);
  expect(saved.subtitle_tracks.tracks.at(-1).position).toBeUndefined();
  const now=await target.boundingBox();await page.mouse.move(now.x+10,now.y+10);await page.mouse.down();await page.mouse.move(now.x+30,now.y+30);await page.keyboard.press('Escape');await page.mouse.up();
  expect(await page.evaluate(()=>DATA.segments.find(c=>c.id==='a').subtitle_position)).toEqual(p);
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.segments.find(c=>c.id==='a').subtitle_position)).toBeUndefined();
  await page.evaluate(()=>performRedo());expect(await page.evaluate(()=>DATA.segments.find(c=>c.id==='a').subtitle_position)).toEqual(p);
  await page.evaluate(saved=>applyCanonicalProject(saved,'reopened.mosp'),saved);await page.waitForFunction(()=>MSWSubtitleStyle.ready);
  expect(await page.evaluate(()=>JSON.parse(buildJson()).segments.find(c=>c.id==='a').subtitle_position)).toEqual(p);expect(errors).toEqual([]);
});

test('real font wrapping, outline, negative gap and bilingual order use the same measured boxes',async({page})=>{
  const errors=await open(page,bilingual);await enable(page);
  await page.locator('#style-field-wrapMode').selectOption('characters');await page.locator('#style-field-charsPerLine').fill('10');await page.locator('#style-field-charsPerLine').press('Tab');
  await page.locator('#style-pair-order').selectOption('secondary-above');await page.locator('#style-pair-gap').fill('-12');await page.locator('#style-pair-gap').press('Tab');
  await page.locator('#media-settings-close').click();
  const first=await entries(page),main=first.find(e=>e.id==='a'),sub=first.find(e=>e.id==='sub');
  expect(main.y).toBeGreaterThan(sub.y);expect(main.y-sub.y).toBeCloseTo(sub.height-12,3);
  expect(main.height).toBeGreaterThan(sub.height*1.5);
  const boxes=await page.locator('.fixed-subtitle-row[data-cue-id="a"]').evaluate(node=>{
    const outer=node.getBoundingClientRect(),inner=node.firstElementChild.getBoundingClientRect();return{outer:{x:outer.x,y:outer.y,right:outer.right,bottom:outer.bottom},inner:{x:inner.x,y:inner.y,right:inner.right,bottom:inner.bottom},text:node.textContent};
  });
  expect(boxes.text).toContain('\n');expect(boxes.inner.x).toBeGreaterThanOrEqual(boxes.outer.x-.1);expect(boxes.inner.right).toBeLessThanOrEqual(boxes.outer.right+.1);expect(boxes.inner.bottom).toBeLessThanOrEqual(boxes.outer.bottom+.1);
  await page.evaluate(()=>{extensionOverlayToggle.checked=false;refreshSubtitlePreview(2500);});
  await expect(page.locator('.fixed-subtitle-row[data-cue-id="sub"]')).toHaveCount(0);expect((await entries(page)).find(e=>e.id==='a').y).toBe(main.y);expect(errors).toEqual([]);
});

test('annotation coordinates exclude black bars and remain stable after player resize',async({page})=>{
  const errors=await open(page);await enable(page);await annotation(page);
  await page.locator('#style-position-x').fill('30');await page.locator('#style-position-x').press('Tab');await page.locator('#style-position-y').fill('20');await page.locator('#style-position-y').press('Tab');
  await page.locator('#media-settings-close').click();
  const check=async height=>{
    await page.evaluate(height=>{player.style.height=height+'px';player.style.objectFit='contain';player.style.maxHeight='none';refreshSubtitlePreview(2500);},height);
    return page.evaluate(()=>{
      const r=fixedVideoRect(),entry=fixedPreviewLayout().layout.entries.find(e=>e.cue_id==='a');
      const box=document.querySelector('.fixed-subtitle-row[data-cue-id="a"]').getBoundingClientRect();
      return {x:(box.x+box.width/2-r.clientLeft)/r.width,y:(box.y-r.clientTop)/r.height,ratio:r.width/r.height,left:r.left,position:DATA.subtitle_tracks.tracks.at(-1).position};
    });
  };
  const a=await check(150),b=await check(300);for(const value of[a,b]){expect(value.x).toBeCloseTo(.3,3);expect(value.y).toBeCloseTo(.2,3);expect(value.ratio).toBeCloseTo(16/9,4);expect(value.position).toEqual({x:.3,y:.2});}
  expect(a.left).toBeGreaterThan(b.left);expect(errors).toEqual([]);
});

test('track positioning leaves cue overrides intact, collisions warn only while editing and locks prevent edits',async({page})=>{
  const errors=await open(page);await enable(page);await annotation(page);
  await page.locator('#style-position-y').fill('88');await page.locator('#style-position-y').press('Tab');await page.locator('#style-position-drag').click();
  await expect(page.locator('#fixed-position-message')).toContainText('重叠');
  await page.locator('#fixed-position-toolbar select').selectOption('cue');
  await page.evaluate(()=>fixedCommitPosition({x:.8,y:.3}));
  await page.locator('#fixed-position-toolbar select').selectOption('track');
  await page.evaluate(()=>fixedCommitPosition({x:.5,y:.1}));
  expect(await page.evaluate(()=>DATA.segments.find(c=>c.id==='a').subtitle_position)).toEqual({x:.8,y:.3});
  expect((await entries(page)).find(e=>e.id==='a').y).toBe(324);
  await page.getByRole('button',{name:'完成定位',exact:true}).click();await expect(page.locator('#fixed-position-toolbar')).toBeHidden();
  await page.evaluate(()=>{fixedUpdateTrack(fixedStyleTrackId,{locked:true});MSWSubtitleStyle.editTrack(fixedStyleTrackId);});
  await expect(page.locator('#style-position-drag')).toBeDisabled();await expect(page.locator('#style-field-fontSize')).toBeDisabled();
  expect(await page.evaluate(()=>fixedCommitPosition({x:0,y:0}))).toBe(false);expect(errors).toEqual([]);
});

test('positioned bound subtitles retain positions through split and linked merge, each with one undo',async({page})=>{
  const errors=await open(page,bilingual);await enable(page);await annotation(page);
  await page.locator('#style-position-scope').selectOption('cue');await page.locator('#style-position-drag').click();
  await page.evaluate(()=>{fixedCommitPosition({x:.4,y:.2});fixedPositionEditing=false;refreshSubtitlePreview();});
  const before=await page.evaluate(()=>JSON.parse(buildJson()));
  await page.evaluate(()=>requestSubtitleSplit('main',DATA.segments.findIndex(c=>c.id==='a'),{timeMs:3000,quick:true}));
  const split=await page.evaluate(()=>({main:DATA.segments.filter(c=>fixedTrack(c)?.kind==='annotation'),sub:getActiveExtensionTrack().segments}));
  expect(split.main).toHaveLength(2);expect(split.sub).toHaveLength(2);for(const c of [...split.main,...split.sub])expect(c.subtitle_position).toEqual({x:.4,y:.2});
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>JSON.parse(buildJson()).segments)).toEqual(before.segments);
  await page.evaluate(()=>performRedo());
  // The UI command is the same merge used by cards and waveform selection.
  expect(await page.evaluate(()=>layerMergeSelected(DATA.segments.map((c,i)=>fixedTrack(c)?.kind==='annotation'?i:-1).filter(i=>i>=0)))).toBe(true);
  expect(await page.evaluate(()=>DATA.segments.filter(c=>fixedTrack(c)?.kind==='annotation').length)).toBe(1);
  expect(await page.evaluate(()=>DATA.segments.find(c=>fixedTrack(c)?.kind==='annotation').subtitle_position)).toEqual({x:.4,y:.2});
  expect(await page.evaluate(()=>fixedTrackCore.validate(DATA))).toBe(true);await page.evaluate(()=>performUndo());
  expect(await page.evaluate(()=>DATA.segments.filter(c=>fixedTrack(c)?.kind==='annotation').length)).toBe(2);expect(errors).toEqual([]);
});

test('compact style panel and annotation preview visual evidence',async({page})=>{
  const errors=await open(page,bilingual);await page.setViewportSize({width:1500,height:1000});await enable(page);await annotation(page);
  const destination=process.env.MSW_TRACK_EVIDENCE_DIR||tempDir;mkdirSync(destination,{recursive:true});
  await page.locator('#project-subtitle-style').scrollIntoViewIfNeeded();await page.locator('#media-settings-modal').screenshot({path:join(destination,'track-style-settings.png')});
  const overflow=await page.locator('#project-subtitle-style').evaluate(p=>p.scrollWidth-p.clientWidth);expect(overflow).toBeLessThanOrEqual(1);
  await page.locator('#style-position-drag').click();await page.locator('.player-wrap').screenshot({path:join(destination,'track-position-preview.png')});
  expect(errors).toEqual([]);
});

test('multiple annotation tracks keep independent positions and observe disabled-track visibility',async({page})=>{
  const errors=await open(page);await enable(page);await annotation(page);
  const first=await page.evaluate(()=>fixedStyleTrackId);
  await page.evaluate(()=>{fixedAddTrack('annotation',[fixedRef(DATA.segments.find(c=>c.id==='b'))]);MSWSubtitleStyle.editTrack(fixedActiveTrackId);});
  const second=await page.evaluate(()=>fixedStyleTrackId);expect(second).not.toBe(first);
  await page.locator('#style-position-drag').click();await expect(page.locator('#fixed-position-message')).toContainText('重叠');
  await page.evaluate(()=>fixedCommitPosition({x:.7,y:.3}));
  const positions=await entries(page);expect(positions.find(e=>e.id==='a').y).toBe(86.4);expect(positions.find(e=>e.id==='b').y).toBe(324);
  await expect(page.locator('#fixed-position-message')).not.toContainText('发生重叠');
  await page.evaluate(first=>fixedUpdateTrack(first,{enabled:false}),first);await expect(page.locator('.fixed-subtitle-row[data-cue-id="a"]')).toHaveCount(0);
  expect((await entries(page)).find(e=>e.id==='b').y).toBe(324);
  await page.evaluate(()=>performUndo());expect((await entries(page)).find(e=>e.id==='a').y).toBe(86.4);expect(errors).toEqual([]);
});

test('speaker label text and colour remain live in measured track preview',async({page})=>{
  const errors=await open(page);await enable(page);await page.locator('#media-settings-close').click();
  await page.evaluate(()=>{
    const name=COLOR_PALETTE[0].name,cue=DATA.segments.find(c=>c.id==='a');cue.color={...COLOR_PALETTE[0],start:cue.start,end:cue.end};
    setSubtitleAppearance({ass_color_style:'speaker',speaker_labels:{mapping_enabled:true,enabled:true,separator:': ',names:{[name]:'甲'}}});refreshSubtitlePreview(2500);
  });
  const label=page.locator('.fixed-subtitle-row[data-cue-id="a"] .fixed-subtitle-text > span');await expect(label).toHaveText('甲: ');
  expect(await label.evaluate(node=>node.style.color)).not.toBe('');
  await page.evaluate(()=>{const settings=getSpeakerLabelSettings();settings.names[COLOR_PALETTE[0].name]='采访者';setSubtitleAppearance({speaker_labels:settings});refreshSubtitlePreview(2500);});
  await expect(label).toHaveText('采访者: ');expect(errors).toEqual([]);
});
