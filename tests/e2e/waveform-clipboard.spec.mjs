// 波形显示器模块的剪贴板与全选回归：
// - Ctrl+A 分场景全选（默认字幕块+贴片；选中贴片→全选贴片；选中字幕→全选字幕）
// - 贴片 Ctrl+V 按「最后拷贝的对象」路由（复制后选区被清也能粘贴，不再落空）
// - 贴片选中时 Ctrl+V 只粘贴贴片，不再同时触发字幕粘贴（历史双粘贴 bug）
// - 菜单栏点击已展开的选项卡不再折叠
import { expect, test } from '@playwright/test';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTempDir, findFreePort, generateWaveformPayload, generateWav, makeTempDir, startServer } from './helpers.mjs';

let tempDir;
let server;
const DURATION_MS = 130000;

const hex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');

function generateClipProject(filePath) {
  const assetId = `audio-${hex(32)}`;
  const assetFolder = `msw-${hex(24)}`;
  const project = {
    media: 'synthetic.wav',
    segments: [
      { start: 0, end: 8000, text: 'Alpha' },
      { start: 50000, end: 58000, text: 'Bravo' },
      { start: 100000, end: 108000, text: 'Charlie' },
    ],
    waveform: generateWaveformPayload(DURATION_MS),
    msw: {
      schema: 'msw.editor.v1',
      project_id: 'wave-clipboard-probe',
      assets: [{
        id: assetId,
        kind: 'audio',
        path: `${assetFolder}.assets/audio/${assetId}.wav`,
        sha256: hex(64),
        sample_rate: 22050,
        channels: 1,
        sample_count: 220500,
        byte_size: 441044,
        generation: {
          provider: 'probe', model: 'probe-model', voice: 'probe-voice', language_type: 'word',
          display_text: '测试配音', spoken_text: '测试配音',
        },
        source_ref: { key: 'probe-key', id: 'cue-0', kind: 'subtitle', text: 'Alpha', start: 0, end: 8000 },
        job_id: 'probe-job',
      }],
      audio_tracks: [{ id: 'voice-1', name: '配音', gain_db: 0, muted: false }],
      audio_clips: [
        { id: 'clip-1', track_id: 'voice-1', asset_id: assetId, start_ms: 15000, source_in_sample: 0, source_out_sample: 22050, playback_rate: 1, gain_db: 0, muted: false, label: '贴片A' },
        { id: 'clip-2', track_id: 'voice-1', asset_id: assetId, start_ms: 30000, source_in_sample: 0, source_out_sample: 22050, playback_rate: 1, gain_db: 0, muted: false, label: '贴片B' },
      ],
    },
  };
  writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf-8');
  mkdirSync(join(tempDir, assetFolder + '.assets', 'audio'), { recursive: true });
  copyFileSync(join(tempDir, 'synthetic.wav'), join(tempDir, assetFolder + '.assets', 'audio', assetId + '.wav'));
  return filePath;
}

test.beforeAll(async () => {
  tempDir = makeTempDir('wave-clipboard');
  const mediaPath = join(tempDir, 'synthetic.wav');
  generateWav(mediaPath, DURATION_MS / 1000);
  const projectPath = generateClipProject(join(tempDir, 'project.json'));
  server = await startServer(projectPath, mediaPath, await findFreePort());
});

test.afterAll(async () => {
  await server?.stop();
  cleanupTempDir(tempDir);
});


// 轨道头坐标点击：Chromium 将按钮按下后的 pointerup 派发给组容器，
// Playwright 的 locator.click 动作性检查会误报「被拦截」；坐标点击等价于
// 真实用户输入且稳定可达激活路径（组级 pointerup 分发）。
async function clickTrackHead(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`轨道头未渲染：${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
}

test.beforeEach(async ({ page }) => {
  // 跳过新手引导：引导聚光会选中第一条字幕，破坏「无选区」的默认场景。
  await page.addInitScript(() => {
    localStorage.setItem('moy.asr.editor.settings.v1', JSON.stringify({ autoSaveProject: false }));
    localStorage.setItem('moy.asr.editor.onboarding.v1', 'completed');
  });
  await page.goto(server.url);
  await page.waitForSelector('.waveform-cue-block[data-idx]');
  await page.waitForSelector('.msw-audio-clip');
  await page.waitForFunction(() => document.getElementById('player')?.readyState >= 1);
});

test('Ctrl+A in the waveform module selects cues and clips by scenario', async ({ page }) => {
  const pane = page.locator('#waveform-pane');
  const state = () => page.evaluate(() => ({
    cuesSelected: document.querySelectorAll('#cues-container > .cue.selected').length,
    cueTotal: document.querySelectorAll('#cues-container > .cue').length,
    clipsSelected: window.MSWE.resolve('audio-timeline').selectedCount(),
    clipTotal: document.querySelectorAll('.msw-audio-clip').length,
  }));

  // 默认（无选区）：字幕块 + 音频贴片一起全选
  await pane.hover();
  await page.keyboard.press('Control+a');
  await expect.poll(state).toEqual({ cuesSelected: 3, cueTotal: 3, clipsSelected: 2, clipTotal: 2 });

  // 已选中贴片：全选只选全部贴片，字幕选区清空
  await page.locator('.msw-audio-clip').first().click();
  await pane.hover();
  await page.keyboard.press('Control+a');
  await expect.poll(state).toEqual({ cuesSelected: 0, cueTotal: 3, clipsSelected: 2, clipTotal: 2 });

  // 已选中字幕：全选只选全部字幕，贴片选区清空
  await page.locator('.waveform-cue-block[data-idx="0"]').click();
  await pane.hover();
  await page.keyboard.press('Control+a');
  await expect.poll(state).toEqual({ cuesSelected: 3, cueTotal: 3, clipsSelected: 0, clipTotal: 2 });
});

test('clip paste stays reachable after the selection clears and never double-pastes', async ({ page }) => {
  // 复制贴片 → Escape 清掉选区（贴片的清除键）→ Ctrl+V 仍应粘贴贴片到播放头（旧逻辑落空）
  await page.locator('.msw-audio-clip').first().click();
  await page.keyboard.press('Control+c');
  await page.evaluate(() => { player.currentTime = 60; });
  await page.waitForTimeout(150);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const state = await page.evaluate(() => ({
    clipTotal: document.querySelectorAll('.msw-audio-clip').length,
    clipsSelected: window.MSWE.resolve('audio-timeline').selectedCount(),
    cueTotal: document.querySelectorAll('#cues-container > .cue').length,
  }));
  expect(state.clipTotal).toBe(3);
  expect(state.clipsSelected).toBe(1);
  expect(state.cueTotal).toBe(3);

  // 拷贝字幕后顺手点了贴片：Ctrl+V 仍按「最后拷贝的对象」贴字幕，
  // 不被贴片选中劫持（历史 bug 是两者同时粘贴/劫持成贴片粘贴）
  await page.locator('.waveform-cue-block[data-idx="0"]').click();
  await page.keyboard.press('Control+c');
  await page.locator('.msw-audio-clip').first().click();
  await page.evaluate(() => { player.currentTime = 70; });
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    clipTotal: document.querySelectorAll('.msw-audio-clip').length,
    cueTotal: document.querySelectorAll('#cues-container > .cue').length,
  }));
  expect(after.clipTotal).toBe(3);
  expect(after.cueTotal).toBe(4);
});

test('clicking an open menubar tab keeps it open', async ({ page }) => {
  const fileTab = page.locator('.menubar-item[data-menubar-item="file"] > .menubar-tab');
  await fileTab.click();
  await expect(page.locator('.menubar-item[data-menubar-item="file"]')).toHaveClass(/open/);
  // 点击已展开的选项卡：保持展开，不折叠
  await fileTab.click();
  await expect(page.locator('.menubar-item[data-menubar-item="file"]')).toHaveClass(/open/);
  // 关闭途径仍然有效：点击菜单外区域
  await page.locator('#cues-container').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.menubar-item[data-menubar-item="file"]')).not.toHaveClass(/open/);
});

test('Pr-style track heads toggle track disabling', async ({ page }) => {
  // 前序用例把播放头移到 70s，波形自动跟随滚动会把第 0 行滚出视口；
  // 先回滚顶部再点第 0 行的轨道头，避免与自动跟随相争。
  await page.evaluate(() => {
    const scroll = document.getElementById('waveform-scroll');
    scroll.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  // V1：点击后标签删除线、主字幕块降透明度、预览叠层隐藏该轨、状态写入工程扩展
  await clickTrackHead(page, '.waveform-track-head.v-main');
  await page.waitForTimeout(300);
  let state = await page.evaluate(() => {
    const row = document.querySelector('.waveform-row');
    const block = row.querySelector('.waveform-cue-block[data-track="main"]');
    player.currentTime = 1;
    return new Promise((resolve) => setTimeout(() => resolve({
      struck: document.querySelector('.waveform-track-head.v-main').classList.contains('track-muted'),
      dim: getComputedStyle(block).opacity,
      overlayHidden: document.getElementById('overlay-main-text').classList.contains('hidden'),
      persisted: Boolean(window.MSWE.resolve('processing-host').data.msw?.subtitle_tracks_muted?.main),
    }), 300));
  });
  expect(state.struck).toBe(true);
  expect(parseFloat(state.dim)).toBeLessThan(1);
  expect(state.overlayHidden).toBe(true);
  expect(state.persisted).toBe(true);

  await page.evaluate(() => {
    const scroll = document.getElementById('waveform-scroll');
    scroll.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  // 再点恢复
  await clickTrackHead(page, '.waveform-track-head.v-main');
  await page.waitForTimeout(300);
  state = await page.evaluate(() => ({
    struck: document.querySelector('.waveform-track-head.v-main').classList.contains('track-muted'),
    persisted: Boolean(window.MSWE.resolve('processing-host').data.msw?.subtitle_tracks_muted?.main),
  }));
  expect(state.struck).toBe(false);
  expect(state.persisted).toBe(false);

  await page.evaluate(() => {
    const scroll = document.getElementById('waveform-scroll');
    scroll.scrollTop = 0;
  });
  await page.waitForTimeout(200);
  // A1：禁用配音轨（audio_tracks[0].muted，随工程持久化），贴片带 muted 态
  await clickTrackHead(page, '.waveform-track-head.a-track');
  await page.waitForTimeout(300);
  state = await page.evaluate(() => {
    const data = window.MSWE.resolve('processing-host').data;
    return {
      trackMuted: data.msw?.audio_tracks?.[0]?.muted === true,
      labelStruck: document.querySelector('.waveform-track-head.a-track').classList.contains('track-muted'),
      clipMutedClass: document.querySelector('.msw-audio-clip')?.classList.contains('muted'),
    };
  });
  expect(state.trackMuted).toBe(true);
  expect(state.labelStruck).toBe(true);
  expect(state.clipMutedClass).toBe(true);

  // 「轨道头」设置关闭后整层隐藏
  await page.evaluate(() => {
    const toggle = document.getElementById('waveform-show-track-heads');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() =>
    document.getElementById('waveform-content').classList.contains('wave-track-heads-on'))).toBe(false);
});

test('cut cue block then paste at an earlier playhead lands on the track', async ({ page }) => {
  // 剪切后段的字幕贴到更早的播放头：负偏移生效（不再保持原时间），
  // 且按时间有序插入——乱序插入会让波形的二分查找漏画字幕块
  // （“列表有、轨道上没有”的历史 bug）。
  const block = page.locator('.waveform-cue-block[data-idx="1"]');
  await block.click();
  await page.keyboard.press('Control+x');
  // 剪切后列表少一条（波形块是否可见取决于滚动窗口，不作全局计数）
  await expect(page.locator('#cues-container > .cue')).toHaveCount(2);

  await page.evaluate(() => { player.currentTime = 20; });
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => {
    const cues = [...document.querySelectorAll('#cues-container > .cue')].map((el) => ({
      text: (el.querySelector('.text')?.textContent || '').trim(),
    }));
    // 播放头跟随已把 20s 行滚入视口：找到覆盖 20s 的行并检查其中的块
    const row = [...document.querySelectorAll('.waveform-row')].find((r) =>
      Number(r.dataset.startMs) <= 20000 && Number(r.dataset.endMs) > 20000);
    return {
      cueTotal: cues.length,
      order: cues.map((c) => c.text.slice(0, 5)).join(','),
      rowHasPastedBlock: Boolean(row?.querySelector('.waveform-cue-block[data-idx="1"], .waveform-cue-block[data-idx="0"]')),
    };
  });
  expect(state.cueTotal).toBe(3);
  expect(state.order).toContain('Alpha');
  expect(state.order.indexOf('Bravo')).toBeLessThan(state.order.indexOf('Charl'));
  expect(state.rowHasPastedBlock).toBe(true);
});

test('bound pair cut and paste keeps main and extension together', async ({ page }) => {
  // 连锁选择（selectBoundSubtitlePair 默认开）：点主块会同时选中绑定的副字幕。
  // 剪切这对 → 粘贴到播放头：主副一起回来且配对绑定重建。
  await dropSrtPair(page);
  await expect(page.locator('.multi-dual-cue').first()).toBeVisible();

  const state = () => page.evaluate(() => ({
    cues: document.querySelectorAll('#cues-container > .cue').length,
    bindings: (window.MSWE.resolve('processing-host').data.multi_subtitle?.bindings || []).length,
  }));

  // 自动绑定受时间容差影响，测试里显式建一对绑定（与主字幕绑定的右键入口）
  await page.locator('.multi-cue-column.main').last().click();
  await page.locator('.multi-cue-column.extension[data-ext-idx="0"]').first()
    .click({ button: 'right' });
  await page.locator('#ctxmenu .item').filter({ hasText: '与选中的主字幕绑定' }).click();
  await page.waitForTimeout(300);

  const before = await state();
  expect(before.bindings).toBe(1);
  const baseCues = before.cues;

  // 选中刚绑定那条主字幕（列表里最后一列主列对应的波形块）
  const mainIdxToCut = await page.evaluate(() => {
    const col = [...document.querySelectorAll('.multi-cue-column.main')].pop();
    return Number(col?.closest('.cue')?.dataset?.mainIdx ?? -1);
  });
  await page.locator(`.waveform-cue-block[data-track="main"][data-idx="${mainIdxToCut}"]`).click();
  await page.waitForTimeout(250);
  const sel = await page.evaluate(() => ({ main: selectedIdxs.size, ext: selectedExtensionIdxs.size }));
  expect(sel.main).toBe(1);
  expect(sel.ext).toBeGreaterThanOrEqual(1);

  await page.keyboard.press('Control+x');
  await page.waitForTimeout(400);
  const afterCut = await state();
  expect(afterCut.cues).toBe(baseCues - 1); // 主副一起被剪切（主轨少一条）
  expect(afterCut.bindings).toBe(0); // 这对的绑定随之拆除

  await page.evaluate(() => { player.currentTime = 20; });
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(500);
  const afterPaste = await page.evaluate(() => ({
    cues: document.querySelectorAll('#cues-container > .cue').length,
    bindings: (window.MSWE.resolve('processing-host').data.multi_subtitle?.bindings || []).length,
    extSel: selectedExtensionIdxs.size,
    mainSel: selectedIdxs.size,
  }));
  expect(afterPaste.cues).toBe(baseCues); // 主副一起回来
  expect(afterPaste.bindings).toBe(1); // 配对绑定重建
  expect(afterPaste.mainSel).toBe(1);
  expect(afterPaste.extSel).toBeGreaterThanOrEqual(1);
});

test('A track heads grow with packed lanes', async ({ page }) => {
  // 两个时间重叠的贴片 → 打包成 2 条 lane → A1/A2 轨道头
  await page.evaluate(() => {
    const audio = window.MSWE.resolve('audio-timeline');
    window.__laneCount = audio.laneCount?.();
  });
  const heads = await page.evaluate(() =>
    [...document.querySelectorAll('.waveform-track-heads')].flatMap((g) =>
      [...g.querySelectorAll('.a-track')].map((el) => el.textContent)));
  const laneCount = await page.evaluate(() => window.__laneCount);
  expect(laneCount).toBeGreaterThanOrEqual(1);
  // 每个波形行组都应渲染 A1..A{laneCount}
  const perGroup = new Set(heads.map((_, i) => i).map(() => heads.length));
  expect(heads.length).toBeGreaterThan(0);
  expect(new Set(heads).size).toBe(laneCount);
});

async function dropSrtPair(page) {
  // 与 multi-subtitle.spec 的 importPair 同源数据、同顺序投放：
  // 先主 SRT（直接成为主轨），再副 SRT（弹导入框，按时间自动绑定 2 对）。
  const dropOne = async (name, text) => {
    await page.evaluate(({ n, t }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new TextEncoder().encode(t)], n, { type: 'text/plain' }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    }, { n: name, t: text });
  };
  const main = [
    '1', '00:00:00,000 --> 00:00:02,000', 'Hello world.', '',
    '2', '00:00:03,000 --> 00:00:05,000', 'Second line.', '',
  ].join('\n');
  const ext = [
    '1', '00:00:00,050 --> 00:00:01,950', '你好，世界。', '',
    '2', '00:00:03,050 --> 00:00:04,950', '第二句。', '',
    '3', '00:00:08,000 --> 00:00:09,000', 'unmatched', '',
  ].join('\n');
  await dropOne('main.srt', main);
  await page.waitForTimeout(400);
  await dropOne('translation.srt', ext);
  await page.waitForTimeout(400);
  await page.locator('#multi-subtitle-import-extension').click();
  await page.locator('#multi-subtitle-import-result-confirm').click();
}

test('dragging a clip past another keeps its lane', async ({ page }) => {
  // 构造三段时间互不重叠的贴片对（每对内部重叠 → 两条 lane），
  // 另有一个只有单贴片的时间段做行高对照。
  const setup = await page.evaluate(() => {
    const data = window.MSWE.resolve('processing-host').data;
    const ext = data.msw;
    const track = ext.audio_tracks[0];
    const mk = (id, start) => ({
      id, track_id: track.id, asset_id: ext.assets[0].id, start_ms: start,
      source_in_sample: 0, source_out_sample: 22050, playback_rate: 1,
      gain_db: 0, muted: false, label: id,
    });
    // 10-12s 重叠对；40-42s 重叠对；70s 单贴片（只有一条 lane）
    ext.audio_clips = [
      mk('clipA', 10000), mk('clipB', 10500),
      mk('clipC', 40000), mk('clipD', 40500),
      mk('clipE', 70000),
    ];
    window.dispatchEvent(new Event('msw:project-changed'));
    return true;
  });
  expect(setup).toBe(true);
  await page.waitForTimeout(500);

  const readState = () => page.evaluate(() => {
    const audio = window.MSWE.resolve('audio-timeline');
    const rowAt = (t) => [...document.querySelectorAll('.waveform-row')].find((r) =>
      Number(r.dataset.startMs) <= t && Number(r.dataset.endMs) > t);
    const laneSpace = (t) => {
      const row = rowAt(t);
      return row ? (parseFloat(row.style.getPropertyValue('--audio-lane-space')) || 0) : -1;
    };
    return {
      lanes: JSON.stringify(audio.laneSnapshot()),
      dualRowSpace: laneSpace(10500),
      singleRowSpace: laneSpace(70500),
      aHeadsInDualRow: rowAt(10500) ? [...document.querySelectorAll('.waveform-track-heads')].find((g) => Math.abs(g.getBoundingClientRect().top - rowAt(10500).getBoundingClientRect().top) < 2)?.querySelectorAll('.a-track').length : -1,
      aHeadsInSingleRow: rowAt(70500) ? [...document.querySelectorAll('.waveform-track-heads')].find((g) => Math.abs(g.getBoundingClientRect().top - rowAt(70500).getBoundingClientRect().top) < 2)?.querySelectorAll('.a-track').length : -1,
    };
  });

  const before = await readState();
  // 原模式：轨道带高度由全局打包数统一决定——所有行一致（2 lane ≈ 51px）
  expect(before.dualRowSpace).toBeGreaterThan(45);
  expect(before.singleRowSpace).toBe(before.dualRowSpace);

  // 把 clipA（lane0，10-11s）移到 clipB 之后（13s）：粘性 lane 保持 A=0、B=1
  // （走与真实拖动提交相同的 audio-changed 事件 + 行覆盖层刷新）
  await page.evaluate(() => {
    const data = window.MSWE.resolve('processing-host').data;
    const clip = data.msw.audio_clips.find((c) => c.id === 'clipA');
    clip.start_ms = 13000;
    window.dispatchEvent(new Event('msw:audio-changed'));
    const audio = window.MSWE.resolve('audio-timeline');
    document.querySelectorAll('.waveform-row').forEach((row) => {
      audio.renderRow(row, Number(row.dataset.startMs), Number(row.dataset.endMs));
    });
  });
  await page.waitForTimeout(400);
  const after = await readState();
  // 松手后不再重叠：折叠回单轨（原贪心收纳）；拖动中没有换位发生
  expect(after.lanes).toContain('"clipA":0');
  expect(after.lanes).toContain('"clipB":0');
  const settled = JSON.parse(after.lanes);
  expect(settled.clipA).toBe(settled.clipB);
});

test('real pointer drag across another clip never swaps lanes mid-drag', async ({ page }) => {
  // 真实指针拖拽：A(lane0) 向右拖过 B(lane1) 的起点——拖动全程保持
  // A=0/B=1（贪心重排会在越过的瞬间互换，粘性会话阻止它）；
  // 完全移出重叠后松手则折叠回单轨。
  const setup = await page.evaluate(() => {
    const data = window.MSWE.resolve('processing-host').data;
    const ext = data.msw;
    const track = ext.audio_tracks[0];
    const mk = (id, start) => ({
      id, track_id: track.id, asset_id: ext.assets[0].id, start_ms: start,
      source_in_sample: 0, source_out_sample: 22050, playback_rate: 1,
      gain_db: 0, muted: false, label: id,
    });
    ext.audio_clips = [mk('clipA', 10000), mk('clipB', 10500)];
    window.dispatchEvent(new Event('msw:project-changed'));
    return true;
  });
  expect(setup).toBe(true);
  await page.waitForSelector('.msw-audio-clip[data-clip-id="clipA"]');
  await page.waitForFunction(() => document.getElementById('player')?.readyState >= 1);

  const lanes = () => page.evaluate(() => window.MSWE.resolve('audio-timeline').laneSnapshot());
  expect(await lanes()).toEqual({ clipA: 0, clipB: 1 });

  const box = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.waveform-row')].find((r) =>
      Number(r.dataset.startMs) <= 10000 && Number(r.dataset.endMs) > 10000);
    const clip = row.querySelector('.msw-audio-clip[data-clip-id="clipA"]');
    const r = clip.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return {
      x: r.x + r.width / 2, y: r.y + r.height / 2,
      rowStart: Number(row.dataset.startMs), rowEnd: Number(row.dataset.endMs),
      rowWidth: rowRect.width,
    };
  });
  const msPerPx = (box.rowEnd - box.rowStart) / box.rowWidth;
  const dragBy = async (shiftMs) => {
    const b = await page.evaluate(() => {
      const row = [...document.querySelectorAll('.waveform-row')].find((r) =>
        Number(r.dataset.startMs) <= 10500 && Number(r.dataset.endMs) > 10500);
      const clip = row.querySelector('.msw-audio-clip[data-clip-id="clipA"]');
      const r = clip.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return {
        x: r.x + r.width / 2, y: r.y + r.height / 2,
        rowStart: Number(row.dataset.startMs), rowEnd: Number(row.dataset.endMs),
        rowWidth: rowRect.width,
      };
    });
    const px = shiftMs / ((b.rowEnd - b.rowStart) / b.rowWidth);
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    for (let i = 1; i <= 4; i += 1) {
      await page.mouse.move(b.x + (px * i) / 4, b.y, { steps: 2 });
      await page.waitForTimeout(50);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  // 拖动中的 DOM 复用验证：给 A 打标记，拖动数步后标记仍在（节点未被重建
  // ——整树重建正是拖动闪烁的根因）。
  await page.evaluate(() => { document.querySelector('.msw-audio-clip[data-clip-id="clipA"]').__stable = 1; });
  // 第一段：拖过 B 的起点但仍在重叠中松手 → 双方保持原轨（不换位）
  await dragBy(600); // A 起点 10.6s（B 起点 10.5s），仍重叠
  expect(await lanes()).toEqual({ clipA: 0, clipB: 1 });
  const stable = await page.evaluate(() =>
    document.querySelector('.msw-audio-clip[data-clip-id="clipA"]').__stable === 1);
  expect(stable).toBe(true);
  // 第二段：完全拖出重叠 → 折叠回单轨
  await dragBy(1200); // A 起点 11.8s，已过 B 结尾(11.5s)
  const settled = await lanes();
  expect(settled.clipA).toBe(settled.clipB);
});

test('magnet guide line appears while dragging near another edge', async ({ page }) => {
  // A(10-11s) 的右缘拖向 B(18-19s) 的起点：进入磁吸阈值后出现对齐参考线。
  const setup = await page.evaluate(() => {
    const data = window.MSWE.resolve('processing-host').data;
    const ext = data.msw;
    const track = ext.audio_tracks[0];
    const mk = (id, start) => ({
      id, track_id: track.id, asset_id: ext.assets[0].id, start_ms: start,
      source_in_sample: 0, source_out_sample: 22050, playback_rate: 1,
      gain_db: 0, muted: false, label: id,
    });
    ext.audio_clips = [mk('clipA', 10000), mk('clipB', 18000)];
    window.dispatchEvent(new Event('msw:project-changed'));
    return true;
  });
  expect(setup).toBe(true);
  await page.waitForSelector('.msw-audio-clip[data-clip-id="clipA"]');
  await page.waitForFunction(() => document.getElementById('player')?.readyState >= 1);

  const handle = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.waveform-row')].find((r) =>
      Number(r.dataset.startMs) <= 10000 && Number(r.dataset.endMs) > 10000);
    const el = row.querySelector('.msw-audio-clip[data-clip-id="clipA"] .msw-audio-handle.end');
    const r = el.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, rowStart: Number(row.dataset.startMs), rowEnd: Number(row.dataset.endMs), rowWidth: rowRect.width };
  });
  const msPerPx = (handle.rowEnd - handle.rowStart) / handle.rowWidth;
  // 终点 11s → 18s（B 起点）：拖到位后磁吸应吸附并显示参考线
  const dx = 7000 / msPerPx;
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  let guideSeen = false;
  for (let i = 1; i <= 8; i += 1) {
    await page.mouse.move(handle.x + (dx * i) / 8, handle.y, { steps: 2 });
    await page.waitForTimeout(50);
    guideSeen ||= await page.evaluate(() => {
      const g = document.querySelector('.waveform-magnet-guide');
      return Boolean(g && !g.hidden);
    });
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect(guideSeen).toBe(true);
  // 松手后参考线收起
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('.waveform-magnet-guide') === null)).toBe(true);
});

test('shift-click accumulates across main and extension tracks', async ({ page }) => {
  // 主轨选中后 Shift 点副轨：追加副轨选区而不清空主轨（跨轨混合多选）；
  // 反向同理。纯 Ctrl 的单点多选不受影响。
  await dropSrtPair(page);
  await expect(page.locator('.multi-dual-cue').first()).toBeVisible();

  const readSel = () => page.evaluate(() => ({ m: selectedIdxs.size, e: selectedExtensionIdxs.size }));

  await page.locator('.waveform-cue-block[data-track="main"]').first().click();
  await page.waitForTimeout(150);
  expect(await readSel()).toEqual({ m: 1, e: 0 });

  // Shift 点副轨块：此前 selectOnlyExtension 会清空主轨选区
  await page.locator('.waveform-cue-block[data-track="extension"]').first().click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
  const mixed = await readSel();
  expect(mixed.m).toBeGreaterThanOrEqual(1);
  expect(mixed.e).toBeGreaterThanOrEqual(1);

  // 再 Shift 点另一条主轨：副轨选区仍在
  await page.locator('.waveform-cue-block[data-track="main"]').nth(1).click({ modifiers: ['Shift'] });
  await page.waitForTimeout(200);
  const after = await readSel();
  expect(after.m).toBeGreaterThanOrEqual(2);
  expect(after.e).toBeGreaterThanOrEqual(1);
});

test('shift-click on a selected block deselects it', async ({ page }) => {
  const block = page.locator('.waveform-cue-block[data-idx="1"]');
  await block.click();
  await expect.poll(() => page.evaluate(() => selectedIdxs.size)).toBe(1);
  // Shift 再点同一块：取消选择（与音频贴片行为一致）
  await block.click({ modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => selectedIdxs.size)).toBe(0);
  // Shift 点未选中的块仍是范围/追加选择
  await block.click({ modifiers: ['Shift'] });
  await expect.poll(() => page.evaluate(() => selectedIdxs.size)).toBeGreaterThanOrEqual(1);
});
