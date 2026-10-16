import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {disableOnboarding, generateWav, generateWaveformPayload, makeTempDir, startServer, findFreePort, clickMenubarItem} from './helpers.mjs';

let server, dir;
const tool = name => join(process.env.MSW_TEST_FFMPEG, name + (process.platform === 'win32' ? '.exe' : ''));
test.beforeEach(async ({page}, testInfo) => {
  test.skip(!process.env.MSW_TEST_FFMPEG, 'Synthetic video requires FFmpeg');
  dir = makeTempDir('video-export');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir, 'local');
  process.env.FFMPEG_PATH = process.env.MSW_TEST_FFMPEG;
  const original = generateWav(join(dir, 'original.wav'), testInfo.title.includes('native audio tail') ? 4.032 : 4), media = join(dir, 'video.mp4');
  execFileSync(tool('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=4',
    '-i', original, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', media], {windowsHide: true});
  const id = 'audio-' + 'a'.repeat(32), path = 'msw-' + 'b'.repeat(24) + '.assets/audio/' + id + '.wav';
  const assetPath = join(dir, path); mkdirSync(dirname(assetPath), {recursive: true}); generateWav(assetPath, 2);
  const data = readFileSync(assetPath), asset = {id, kind: 'audio', path, sha256: createHash('sha256').update(data).digest('hex'),
    sample_rate: 8000, channels: 1, sample_count: 16000, byte_size: data.length, job_id: 'job',
    source_ref: {key: 'cue', id: 'cue', track_id: null, text: '测试配音', start: 1000, end: 3000},
    generation: {provider: 'bailian', model: 'test', voice: 'Cherry', language_type: 'Auto', display_text: '测试配音', spoken_text: '测试配音'}};
  const project = {media, segments: [{id: 'cue', start: 1000, end: 3000, text: '测试配音'}], waveform: generateWaveformPayload(4000),
    gap_remove: {schema: 'moy.asr.gap_remove.v1', detector: 'audio_gate', skip_playback: true, gaps: [{start: 1500, end: 2500, removed: true}]},
    msw: {schema: 'msw.editor.v1', project_id: 'video-project', assets: [asset], audio_tracks: [{id: 'voice', name: '配音', gain_db: 0, muted: false}],
      audio_clips: [{id: 'clip', asset_id: id, track_id: 'voice', start_ms: 1000, source_in_sample: 0, source_out_sample: 16000,
        playback_rate: 1, gain_db: 0, muted: false, label: '测试配音'}], audio_settings: {gap_policy: 'protect'}}};
  const projectPath = join(dir, 'project.mosp'); writeFileSync(projectPath, JSON.stringify(project));
  await disableOnboarding(page); page.on('dialog', d => d.type() === 'beforeunload' ? d.accept() : d.dismiss());
  server = await startServer(projectPath, media, await findFreePort()); await page.goto(server.url);
  await expect(page.locator('#editor-loading')).not.toBeVisible();
});
test.afterEach(async () => {await server?.stop(); server = null;});

async function open(page) {
  await clickMenubarItem(page, '文件', 'video-export-btn');
  await expect(page.locator('#video-export-panel')).toBeVisible();
}
async function finish(page) {
  const projectName = await page.evaluate(()=>PROJECT_NAME);
  await page.locator('#video-export-start').click();
  const card = page.locator('#video-export-jobs .msw-processing-job').first();
  await expect(card.getByRole('button', {name: '下载 MP4', exact: true})).toBeVisible({timeout: 30000});
  const ready = page.waitForEvent('download'); await card.getByRole('button', {name: '下载 MP4', exact: true}).click();
  const file = await ready, output = join(dir, 'result.mp4');
  expect(file.suggestedFilename()).toBe(`${projectName}_MSW.mp4`); await file.saveAs(output);
  const info = JSON.parse(execFileSync(tool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], {encoding: 'utf8', windowsHide: true}));
  expect(info.streams.filter(s => s.codec_type === 'audio')).toHaveLength(1);
  expect(info.streams.find(s => s.codec_type === 'video').codec_name).toBe('h264');
  return {info, card};
}
async function expectDetail(page,card,text){
  await card.getByRole('button',{name:'导出详情',exact:true}).click();
  await expect(page.locator('#msw-option-help')).toContainText(text);await page.keyboard.press('Escape');
}

test('video and audio menu entries show window icons and video downloads the protected mix', async ({page}) => {
  await page.evaluate(()=>{PROJECT_NAME='字幕工程.最终版';});
  await open(page);
  await expect(page.locator('#video-export-panel').getByLabel('跳过空隙',{exact:true})).not.toBeChecked();
  await page.locator('#video-export-remove-gaps').check();
  await page.locator('#video-export-close').click();
  await open(page);
  await expect(page.locator('#video-export-remove-gaps')).not.toBeChecked();
  await expect(page.locator('#audio-export-btn .menu-window-icon')).toHaveCount(1);
  await expect(page.locator('#video-export-btn .menu-window-icon')).toHaveCount(1);
  await expect(page.locator('#video-export-start')).toBeEnabled();
  const {info, card} = await finish(page);
  expect(Number(info.format.duration)).toBeCloseTo(4, 1);
  await expectDetail(page,card,'原声+配音 | 画面直接复制 | 不烧录字幕 | 同步试听（不同步）');
  await expectDetail(page,card,'成品时长：00:04.000 | 字幕块：0 | 音频贴片：1');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'd3-video-export.png')});
  await page.locator('#video-export-close').click();
  await clickMenubarItem(page, '文件', 'audio-export-btn');
  await expect(page.locator('#audio-export-jobs .msw-processing-job')).toHaveCount(0);
});

test('video follows gap cuts while retaining the shared audio clock', async ({page}) => {
  await page.evaluate(() => window.MSWE.resolve('processing-host').commitAudio('Follow gaps', ext => {ext.audio_settings.gap_policy = 'follow';}));
  await open(page); await page.locator('#video-export-remove-gaps').check();
  await expect(page.locator('#video-export-summary')).toContainText('00:03.000');
  const {info, card} = await finish(page);
  expect(Number(info.format.duration)).toBeCloseTo(3, 1);
  await expectDetail(page,card,'编码');
});

test('export help is compact, pinnable and accessible without closing its panel',async({page})=>{
  await open(page);
  const help=page.locator('#video-export-tail-field .msw-help-button');
  await help.click();
  await expect(page.locator('#msw-option-help')).toContainText('音视频一致');
  await expect(page.locator('p[data-help-for="video-export-tail"]')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#msw-option-help')).toBeHidden();
  await expect(page.locator('#video-export-panel')).toBeVisible();
  await page.locator('#video-export-close').click();
  await clickMenubarItem(page,'字幕','auto-merge-manage');
  await expect(page.locator('#auto-merge-panel')).toBeVisible();
  await expect(page.locator('#auto-merge-panel .gap-remove-field small:visible')).toHaveCount(0);
  await expect(page.locator('#auto-merge-scope')).toHaveValue('track');
  await expect(page.locator('#auto-merge-track')).toBeVisible();
  await page.setViewportSize({width:900,height:600});
  expect(await page.locator('#auto-merge-panel').evaluate(p=>p.scrollWidth<=p.clientWidth)).toBe(true);
  if(process.env.MSW_UI_EVIDENCE_DIR)await page.screenshot({path:join(process.env.MSW_UI_EVIDENCE_DIR,'merge-panel.png')});
});

test('monitor selection locks effective gain and snapshots it for export',async({page})=>{
  await open(page);
  await page.locator('#video-export-advanced > summary').click();
  await page.locator('#video-export-source-gain').fill('3');
  await page.locator('#video-export-voice-gain').fill('-2');
  await page.evaluate(async()=>{
    window.MSWE.resolve('processing-host').player.volume=.5;
    await window.MSWE.resolve('audio-timeline').setSourceGainDb(-6);
  });
  await page.locator('#video-export-monitor').selectOption('both');
  await expect(page.locator('#video-export-source-gain')).toHaveValue('-12.02');
  await expect(page.locator('#video-export-voice-gain')).toHaveValue('-6.02');
  await expect(page.locator('#video-export-source-gain')).toHaveJSProperty('readOnly',true);
  const submitted=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/audio-exports'));
  await finish(page);
  const body=(await submitted).postDataJSON();
  expect(body.options.monitor).toEqual({mode:'both',volume:.5,muted:false,source_gain_db:-6});
  await page.locator('#video-export-monitor').selectOption('none');
  await expect(page.locator('#video-export-source-gain')).toHaveValue('3');
  await expect(page.locator('#video-export-voice-gain')).toHaveValue('-2');
});

test('subtitle preset selection is direct and keeps export fields in two columns',async({page},info)=>{
  await open(page);
  await expect(page.locator('#video-export-style-choice')).toBeHidden();
  await page.locator('#video-export-burn-subtitles').selectOption('both');
  const choice=page.locator('#video-export-style-source');
  await expect(choice).toHaveValue('project');
  await expect(choice.locator('option')).toHaveText(['跟随工程样式','默认白字','大字清晰','高对比底框','双语紧凑']);
  await choice.selectOption('preset:large');
  const result=await page.evaluate(()=>{const h=window.MSWE.resolve('processing-host'),p=h.exportProject();window.MSWSubtitleStyle.applyExport(p);return {size:p.preview.project_style.main.fontSize,original:h.data.preview.project_style.main.fontSize,preview:window.MSWSubtitleStyle.currentPreview().scope};});
  expect(result.size).toBe(72);expect(result.original).not.toBe(72);expect(result.preview).toBe('export');
  await page.setViewportSize({width:540,height:750});
  const boxes=await page.locator('#video-export-subtitle-fields').evaluate(p=>[...p.querySelectorAll('label')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width};}));
  expect(boxes[0].y).toBe(boxes[1].y);expect(boxes[0].w).toBeCloseTo(boxes[1].w,0);
  await expect(page.locator('#video-export-monitor')).toBeHidden();
  await page.locator('#video-export-advanced > summary').click();
  const monitor=await page.locator('#video-export-monitor-field').boundingBox(),rate=await page.locator('#video-export-rate').locator('..').boundingBox();
  expect(monitor.width).toBeCloseTo(rate.width,0);expect(monitor.y).toBe(rate.y);
  await page.locator('#video-export-advanced > summary').click();
  expect(await page.locator('#video-export-panel').evaluate(p=>p.scrollWidth<=p.clientWidth)).toBe(true);
  await expect(page.locator('#video-export-start')).toBeEnabled();
  await page.locator('#video-export-panel').screenshot({path:info.outputPath('video-export-compact.png')});
  const submitted=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/audio-exports'));
  await finish(page);expect((await submitted).postDataJSON().project.preview.project_style.main.fontSize).toBe(72);
  await page.locator('#video-export-burn-subtitles').selectOption('none');await expect(page.locator('#video-export-style-choice')).toBeHidden();
});

test('native audio tail is explained only in help and default export aligns to video',async({page})=>{
  await open(page);
  await expect(page.locator('#video-export-tail')).toHaveValue('truncate');
  await expect(page.locator('#video-export-tail option')).toHaveText(['对齐至视频','对齐至音频（定格）','对齐至音频（黑屏）']);
  await expect(page.locator('#video-export-tail-summary')).toHaveCount(0);
  await page.locator('#video-export-tail-field .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('音频领先视频 0.032 秒');
  await expect(page.locator('#msw-option-help')).toContainText('对齐至音频（黑屏）');
  await expect(page.locator('#msw-option-help')).not.toContainText('原画面时长');
  await page.keyboard.press('Escape');
  await page.locator('#video-export-range').selectOption('custom');
  await page.locator('#video-export-end-time').fill('4.020');
  await expect(page.locator('#video-export-start')).toBeEnabled();
  await expect(page.locator('#video-export-summary')).toContainText('00:04.000');
  const {info}=await finish(page);expect(Number(info.format.duration)).toBeCloseTo(4,2);
});

test('video optionally burns the chosen subtitle track and rejects an empty track', async ({page}) => {
  await open(page);
  await expect(page.locator('#video-export-burn-subtitles')).toHaveValue('none');
  await page.locator('#video-export-burn-subtitles').selectOption('both');
  await page.locator('#video-export-track-scope summary').click();
  await page.locator('#video-export-track-choices input').nth(1).uncheck();
  await expect(page.locator('#video-export-start')).toBeDisabled();
  await expect(page.locator('#video-export-summary')).toContainText('没有所选轨道');
  await page.locator('#video-export-track-choices input').first().check();
  const {card} = await finish(page);
  await expectDetail(page,card,'字幕块：1');
  await expectDetail(page,card,'烧录字幕（全部轨道）');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'video-burn-subtitles.png')});
});

test('video scope burns only the third physical track and previews the same scope without mutating the project',async({page},info)=>{
  await page.evaluate(()=>{
    const p=MSWProductionProject.toProject(DATA),base=p.subtitles.tracks[0];
    p.subtitles.tracks.push({...base,id:'second',display_number:2},{...base,id:'third',display_number:3});p.subtitles.next_track_number=4;
    p.subtitles.cues.push({id:'third-cue',track_id:'third',content:{start:1000,end:3000,text:'THIRD TRACK',items:[]}});
    p.subtitle_view.secondary_cue_ids.push('third-cue');productionCommitProject(p,'Test tracks');
  });
  await open(page);await page.locator('#video-export-burn-subtitles').selectOption('both');
  await page.locator('#video-export-track-scope summary').click();
  await page.locator('#video-export-track-choices input').nth(1).uncheck();
  await page.locator('#video-export-track-choices input').nth(2).uncheck();
  await expect.poll(()=>page.evaluate(()=>MSWSubtitleStyle.currentPreview().trackIds)).toEqual(['third']);
  expect(await page.evaluate(()=>fixedPreviewLayout().layout.entries.map(e=>e.cue_id))).toEqual(['third-cue']);
  await expect(page.locator('#video-export-start')).toBeEnabled();
  expect(await page.locator('#video-export-track-choices input').first().evaluate(n=>n.getBoundingClientRect().width)).toBe(14);
  await page.locator('#video-export-panel').screenshot({path:info.outputPath('video-track-scope.png')});
  const submitted=page.waitForRequest(r=>r.method()==='POST'&&r.url().endsWith('/audio-exports'));
  await finish(page);const body=(await submitted).postDataJSON();expect(body.options.burn_subtitles).toBe('both');
  expect(body.project.subtitles.tracks.filter(t=>t.enabled).map(t=>t.id)).toEqual(['third']);
  expect(await page.evaluate(()=>MSWProductionProject.toProject(DATA).subtitles.tracks.every(t=>t.enabled))).toBe(true);
});

for(const policy of ['freeze','black'])test(`longer voice aligns to audio with ${policy} video padding`,async({page})=>{
  await page.setViewportSize({width:900,height:600});
  await page.evaluate(()=>window.MSWE.resolve('processing-host').commitAudio('Extend voice',ext=>{ext.audio_clips[0].start_ms=4000;}));
  await open(page);
  await page.locator('#video-export-remove-gaps').uncheck();
  await expect(page.locator('#video-export-summary')).toContainText('00:04.000');
  await expect(page.locator('#video-export-start')).toBeEnabled();
  await page.locator('#video-export-tail-field .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('音频领先视频 2.000 秒');
  await page.keyboard.press('Escape');
  await page.locator('#video-export-tail').selectOption(policy);
  await page.locator('#video-export-remove-gaps').uncheck();
  await expect(page.locator('#video-export-summary')).toContainText('00:06.000');
  const {info}=await finish(page);expect(Number(info.format.duration)).toBeCloseTo(6,1);
  const pixels=execFileSync(tool('ffmpeg'),['-v','error','-ss','5','-i',join(dir,'result.mp4'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true});
  expect(pixels.length).toBeGreaterThan(0);
  if(policy==='black')expect(Math.max(...pixels)).toBeLessThan(8);else expect(Math.max(...pixels)).toBeGreaterThan(150);
});

test('voice-only audio alignment trims longer video and rejects empty audio',async({page})=>{
  await open(page);await page.locator('#video-export-mode').selectOption('voice');
  await page.locator('#video-export-tail').selectOption('black');
  await page.locator('#video-export-remove-gaps').uncheck();
  await page.locator('#video-export-tail-field .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('视频领先音频 1.000 秒');
  await page.keyboard.press('Escape');
  const {info}=await finish(page);expect(Number(info.format.duration)).toBeCloseTo(3,1);
  await page.evaluate(()=>window.MSWE.resolve('processing-host').commitAudio('Mute voice',ext=>{ext.audio_clips[0].muted=true;}));
  await expect(page.locator('#video-export-start')).toBeDisabled();await expect(page.locator('#video-export-summary')).toContainText('没有音频内容');
  await page.locator('#video-export-tail').selectOption('truncate');await expect(page.locator('#video-export-start')).toBeEnabled();
});

test('merged subtitle menu precedes the main SRT export',async({page})=>{
  const entries=await page.locator('#subtitle-export-menu > .dropdown-item').allTextContents();
  const merged=entries.indexOf('合并同时显示文本（SRT）');
  expect(merged).toBe(0);expect(entries[merged+1]).toBe('字幕（SRT）');
});

test('editable OTIOZ exports independent overlapping voice lanes and portable media', async ({page}) => {
  await page.evaluate(() => window.MSWE.resolve('processing-host').commitAudio('Overlap voice', ext => {
    ext.audio_clips.push({...ext.audio_clips[0], id: 'overlap', start_ms: 1500, muted: true});
  }));
  await clickMenubarItem(page, '文件', 'timeline-export-btn');
  await expect(page.locator('#timeline-export-panel')).toBeVisible();
  await expect(page.locator('#timeline-export-start')).toBeEnabled();
  await expect(page.locator('#timeline-export-collect-media')).toBeChecked();
  await page.locator('#timeline-export-start').click();
  const card = page.locator('#timeline-export-jobs .msw-processing-job').first();
  await expect(card.getByRole('button', {name: '下载 OTIOZ', exact: true})).toBeVisible({timeout: 30000});
  const ready = page.waitForEvent('download'); await card.getByRole('button', {name: '下载 OTIOZ', exact: true}).click();
  const file = await ready, output = join(dir, 'result.otioz'); await file.saveAs(output);
  const code = "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'files':z.namelist(),'timeline':json.loads(z.read('content.otio'))}))";
  const data = JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON, ['-c', code, output], {encoding: 'utf8', windowsHide: true}));
  expect(data.files).toContain('media/source.mp4'); expect(data.files).toContain('reference/mix.wav');
  expect(data.files).toContain('subtitles/track-1.srt');
  const audio = data.timeline.tracks.children.filter(t => t.kind === 'Audio');
  expect(audio).toHaveLength(3);
  expect(audio.flatMap(t => t.children).some(c => c.enabled === false)).toBe(true);
  for (const track of data.timeline.tracks.children) for (const clip of track.children) {
    if (clip.OTIO_SCHEMA === 'Clip.2') expect(data.files).toContain(clip.media_references.DEFAULT_MEDIA.target_url);
  }
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'd4-timeline-export.png')});
});

test('all user presets are selectable and English export stays compact',async({page},info)=>{
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  await page.evaluate(async()=>{
    const preset={...window.MSWProjectStyle.defaults(),id:'custom-export',name:'Custom export preset'};
    await window.MSWSubtitleStyle.request('subtitle-presets',{version:1,presets:[preset]});
    localStorage.setItem('mawe.language','en');
  });
  await page.reload();await expect(page.locator('#editor-loading')).not.toBeVisible();
  await open(page);await page.locator('#video-export-burn-subtitles').selectOption('both');
  await expect(page.locator('#video-export-style-source option').last()).toHaveText('Custom export preset');
  await page.locator('#video-export-style-source').selectOption('preset:custom-export');
  await expect(page.locator('#video-export-style-choice')).toContainText('Subtitle style');
  await page.locator('#video-export-tail-field .msw-help-button').click();
  await expect(page.locator('#msw-option-help')).toContainText('Audio and video match');
  await expect(page.locator('#msw-option-help')).toContainText('Audio (black)');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:360,height:700});
  expect(await page.locator('#video-export-panel').evaluate(p=>p.scrollWidth<=p.clientWidth)).toBe(true);
  await page.locator('#video-export-panel').screenshot({path:info.outputPath('video-export-english.png')});
});

test('old video backend is explicitly rejected until restart',async({page})=>{
  await page.route('**/video-export-context?*',async route=>{
    const response=await route.fetch(),body=await response.json();delete body.video_alignment_version;
    await route.fulfill({response,json:body});
  });
  await open(page);await expect(page.locator('#video-export-summary')).toContainText('请重启本机编辑器服务');
  await expect(page.locator('#video-export-start')).toBeDisabled();
});


test('encoding choices disable unavailable hardware and reveal a selector only for multiple encoders',async({page})=>{
  let encoders=[];
  await page.route('**/video-export-context?*',async route=>{
    const response=await route.fetch(),body=await response.json();body.video_encoders=encoders;
    await route.fulfill({response,json:body});
  });
  await open(page);
  await expect(page.locator('#video-export-encoding option')).toHaveText(['自动（推荐）','硬件编码','软件编码（CPU）']);
  await page.locator('#video-export-encoding').selectOption('hardware');
  await expect(page.locator('#video-export-start')).toBeDisabled();
  await expect(page.locator('#video-export-encoder-status')).toContainText('未检测到可用硬件');
  await expect(page.locator('#video-export-hardware-field')).toBeHidden();
  await page.locator('#video-export-encoding').selectOption('h264');
  await expect(page.locator('#video-export-start')).toBeEnabled();
  encoders=[{id:'h264_nvenc',label:'NVIDIA NVENC',available:true},{id:'h264_qsv',label:'Intel Quick Sync',available:true}];
  await page.locator('#video-export-close').click();await open(page);
  await page.locator('#video-export-encoding').selectOption('hardware');
  await expect(page.locator('#video-export-hardware-field')).toBeVisible();
  await page.locator('#video-export-hardware').selectOption('h264_qsv');
  await page.locator('#video-export-encoding').selectOption('h264');
  const {card}=await finish(page);await expectDetail(page,card,'软件编码（CPU）');
});

test('video track master supports clearing all, partial selection and safe empty scope',async({page},info)=>{
  await page.evaluate(()=>{
    const p=JSON.parse(buildJson()),first=p.subtitles.tracks[0];
    p.subtitles.tracks.push({...structuredClone(first),id:'extra',display_number:2});p.subtitles.next_track_number=3;
    p.subtitles.cues.push({...structuredClone(p.subtitles.cues[0]),id:'extra-cue',track_id:'extra'});
    applyCanonicalProject(p,'video-scope.mosp');
  });
  await open(page);await page.locator('#video-export-burn-subtitles').selectOption('both');
  await expect(page.locator('#video-export-summary')).toHaveText('成品时长：00:04.000 | 字幕块：2 | 音频贴片：1');
  const general=await page.locator('#video-export-general').boundingBox(),subtitles=await page.locator('#video-export-subtitles').boundingBox();
  expect(subtitles.y-general.y-general.height).toBeGreaterThanOrEqual(10);
  await page.locator('#video-export-track-scope > summary').click();
  const all=page.locator('#video-export-track-choices input[data-track="all"]');
  await expect(all.locator('..')).toHaveText('全部轨道');await expect(all).toBeChecked();await all.uncheck();
  expect(await page.evaluate(()=>MSWVideoSubtitleScope.ids())).toEqual([]);
  await expect(page.locator('#video-export-track-choices input:checked')).toHaveCount(0);
  await expect(page.locator('#video-export-start')).toBeDisabled();
  await page.locator('#video-export-track-choices input[data-track="extra"]').check();
  expect(await page.evaluate(()=>MSWVideoSubtitleScope.ids())).toEqual(['extra']);
  await expect(page.locator('#video-export-summary')).toContainText('字幕块：1');
  await expect(all).toHaveJSProperty('indeterminate',true);await expect(page.locator('#video-export-start')).toBeEnabled();
  await all.check();expect(await page.evaluate(()=>MSWVideoSubtitleScope.ids())).toBeNull();
  await expect(page.locator('#video-export-track-choices input:checked')).toHaveCount(3);
  for(const theme of ['alice','default']){
    await page.evaluate(theme=>{updateEditorSettings({themePreset:theme,colors:null});applyThemeAndColors();},theme);
    await page.locator('#video-export-panel').screenshot({path:info.outputPath(`export-${theme}.png`)});
  }
  await page.setViewportSize({width:360,height:700});
  expect(await page.locator('#video-export-panel').evaluate(p=>p.scrollWidth<=p.clientWidth)).toBe(true);
  await page.locator('#video-export-panel').screenshot({path:info.outputPath('export-narrow.png')});
});

test('video history keeps three-line snapshot details and pinned errors across polling',async({page},info)=>{
  const base={created_at:Date.now()/1000,progress_at:Date.now()/1000,format:'mp4',mode:'mix',client_token:'test',project_id:'video-project'};
  let jobs=[{...base,id:'active-export',status:'running',stage:'video',progress:65,encoding_eta_seconds:78,
    started_at:new Date('2026-10-16T17:31:58').getTime()/1000,video_encoder:'h264_qsv',encoder_label:'Intel Quick Sync',
    options:{burn_subtitles:'both',monitor:{mode:'none'}},summary:{duration_ms:465470,subtitle_count:12,clip_count:2,subtitle_scope:'all'}},
    {...base,id:'failed-export',status:'failed',error:'模拟编码失败：请检查输出目录',download_name:'上次测试_MSW.mp4'}];
  await page.route('**/audio-exports?*',route=>route.fulfill({json:{ok:true,jobs}}));
  await page.route('**/audio-exports/active-export/cancel',route=>{jobs=[{...jobs[0],status:'cancelled'},jobs[1]];return route.fulfill({json:{ok:true,job:jobs[0]}});});
  await open(page);
  const active=page.locator('[data-job-id="active-export"].msw-video-job'),failed=page.locator('[data-job-id="failed-export"].msw-video-job');
  await expect(active).toContainText('#02');await expect(failed).toContainText('#01');
  await expect(page.locator('.msw-video-job summary')).toHaveCount(0);
  await expect(active.locator('.msw-video-job-progress')).toContainText('编码视频 · 65%');
  await expect(active.locator('.msw-video-job-progress')).toContainText('1 分 20 秒');
  await failed.getByRole('button',{name:'错误详情'}).click();
  await expect(page.locator('#msw-option-help')).toContainText('模拟编码失败');
  jobs=[{...jobs[0],progress:68},jobs[1]];
  await expect(active.locator('.msw-video-job-progress')).toContainText('68%');
  await expect(page.locator('#msw-option-help')).toBeVisible();await page.keyboard.press('Escape');
  await active.getByRole('button',{name:'导出详情',exact:true}).click();
  const tooltip=page.locator('#msw-option-help');
  await expect(tooltip).toHaveText('2026/10/16 17:31:58 ~ 导出中\n原声+配音 | 硬件编码（Intel Quick Sync） | 烧录字幕（全部轨道） | 同步试听（不同步）\n成品时长：07:45.470 | 字幕块：12 | 音频贴片：2',{useInnerText:true});
  jobs=[{...jobs[0],progress:70},jobs[1]];await expect(active.locator('.msw-video-job-progress')).toContainText('70%');
  await expect(tooltip).toBeVisible();
  expect((await tooltip.textContent()).split('\n')).toHaveLength(3);
  await page.screenshot({path:info.outputPath('export-detail-popup.png')});
  const cancel=active.getByRole('button',{name:'取消导出'});await expect(cancel.locator('svg')).toHaveCount(1);
  await page.locator('#video-export-jobs').screenshot({path:info.outputPath('export-history.png')});
  await cancel.click();await expect(active).toContainText('已取消');await expect(cancel).toBeHidden();
  await failed.getByRole('button',{name:'导出详情',exact:true}).click();await expect(tooltip).toContainText('字幕块：—');
});

test('video estimates are stage-aware and stale progress never keeps a countdown',async({page})=>{
  let job={id:'eta-test',status:'running',stage:'preparing',progress:0,created_at:Date.now()/1000,progress_at:Date.now()/1000,format:'mp4',mode:'mix',client_token:'test'};
  await page.route('**/audio-exports?*',route=>route.fulfill({json:{ok:true,jobs:[job]}}));
  await open(page);
  const estimate=page.locator('#video-export-jobs [data-encoding-estimate]');
  await expect(estimate).toContainText('正在估算');
  job={...job,stage:'video',progress:65,encoding_eta_seconds:78,progress_at:Date.now()/1000};
  await expect(estimate).toContainText('1 分 20 秒');
  job={...job,progress_at:Date.now()/1000-20};
  await expect(estimate).toContainText('正在估算');
  job={...job,stage:'muxing',progress:94,progress_at:Date.now()/1000};
  await expect(estimate).toContainText('正在收尾');
  await page.locator('#video-export-close').click();
  job={...job,status:'failed',error:'测试编码失败'};
  await expect(page.locator('.hint-warning')).toContainText('测试编码失败');
});
