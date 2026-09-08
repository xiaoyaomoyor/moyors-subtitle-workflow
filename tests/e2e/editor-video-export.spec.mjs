import {test, expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {disableOnboarding, generateWav, generateWaveformPayload, makeTempDir, startServer, findFreePort, clickMenubarItem} from './helpers.mjs';

let server, dir;
const tool = name => join(process.env.MSW_TEST_FFMPEG, name + (process.platform === 'win32' ? '.exe' : ''));
test.beforeEach(async ({page}) => {
  test.skip(!process.env.MSW_TEST_FFMPEG, 'Synthetic video requires FFmpeg');
  dir = makeTempDir('video-export');
  process.env.MAW_ENV_FILE = join(dir, 'isolated.env'); process.env.MSW_APP_DATA_ROOT = join(dir, 'local');
  process.env.FFMPEG_PATH = process.env.MSW_TEST_FFMPEG;
  const original = generateWav(join(dir, 'original.wav'), 4), media = join(dir, 'video.mp4');
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
  await page.locator('#video-export-start').click();
  const card = page.locator('#video-export-jobs .msw-processing-job').first();
  await expect(card.getByRole('button', {name: '下载 MP4', exact: true})).toBeVisible({timeout: 30000});
  const ready = page.waitForEvent('download'); await card.getByRole('button', {name: '下载 MP4', exact: true}).click();
  const file = await ready, output = join(dir, 'result.mp4'); await file.saveAs(output);
  const info = JSON.parse(execFileSync(tool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], {encoding: 'utf8', windowsHide: true}));
  expect(info.streams.filter(s => s.codec_type === 'audio')).toHaveLength(1);
  expect(info.streams.find(s => s.codec_type === 'video').codec_name).toBe('h264');
  return {info, card};
}

test('video and audio menu entries show window icons and video downloads the protected mix', async ({page}) => {
  await open(page);
  await expect(page.locator('#audio-export-btn .menu-window-icon')).toHaveCount(1);
  await expect(page.locator('#video-export-btn .menu-window-icon')).toHaveCount(1);
  await expect(page.locator('#video-export-start')).toBeEnabled();
  const {info, card} = await finish(page);
  expect(Number(info.format.duration)).toBeCloseTo(4, 1);
  await expect(card).toContainText('画面直接复制');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'd3-video-export.png')});
  await page.locator('#video-export-close').click();
  await clickMenubarItem(page, '文件', 'audio-export-btn');
  await expect(page.locator('#audio-export-jobs .msw-processing-job')).toHaveCount(0);
});

test('video follows gap cuts while retaining the shared audio clock', async ({page}) => {
  await page.evaluate(() => window.MSWE.resolve('processing-host').commitAudio('Follow gaps', ext => {ext.audio_settings.gap_policy = 'follow';}));
  await open(page); await expect(page.locator('#video-export-summary')).toContainText('3.000 s');
  const {info, card} = await finish(page);
  expect(Number(info.format.duration)).toBeCloseTo(3, 1);
  await expect(card).toContainText('画面已重新编码');
});

test('video optionally burns the chosen subtitle track and rejects an empty track', async ({page}) => {
  await open(page);
  await expect(page.locator('#video-export-burn-subtitles')).toHaveValue('none');
  await page.locator('#video-export-burn-subtitles').selectOption('secondary');
  await expect(page.locator('#video-export-start')).toBeDisabled();
  await expect(page.locator('#video-export-summary')).toContainText('没有所选轨道');
  await page.locator('#video-export-burn-subtitles').selectOption('main');
  const {card} = await finish(page);
  await expect(card).toContainText('已压制字幕');
  await expect(card).toContainText('画面已重新编码');
  if (process.env.MSW_UI_EVIDENCE_DIR) await page.screenshot({path: join(process.env.MSW_UI_EVIDENCE_DIR, 'video-burn-subtitles.png')});
});

test('longer voice requires a tail choice and the panel fits a small viewport', async ({page}) => {
  await page.setViewportSize({width: 900, height: 600});
  await page.evaluate(() => window.MSWE.resolve('processing-host').commitAudio('Extend voice', ext => {ext.audio_clips[0].start_ms = 4000;}));
  await open(page);
  await expect(page.locator('#video-export-summary')).toContainText('超出画面尾部');
  await expect(page.locator('#video-export-start')).toBeDisabled();
  await page.locator('#video-export-tail').selectOption('freeze');
  await page.locator('#video-export-remove-gaps').uncheck();
  await expect(page.locator('#video-export-start')).toBeEnabled();
  await expect.poll(() => page.locator('#video-export-panel').evaluate(p => {
    const r = p.getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  })).toBe(true);
  const {info} = await finish(page);
  expect(Number(info.format.duration)).toBeCloseTo(6, 1);
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
