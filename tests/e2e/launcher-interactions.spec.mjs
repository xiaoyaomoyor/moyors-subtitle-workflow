import { setLauncherLanguage } from './launcher-language.mjs';
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/launcher/index.html');

async function openLauncher(page) {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  // B 阶段横向工作台：识别/媒体/后处理内容位于「预制工程」页。
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
}

test('OpenAI ASR exposes official models and a conditional Custom model input', async ({ page }) => {
  await openLauncher(page);
  // R4/F09：识别默认关闭；本用例操作识别表单，先启用识别模块。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.evaluate(id => MSWWorkflow.setCollapsed(id, false), "asr");
  await page.locator('#provider').selectOption('openai');

  await expect(page.locator('#provider option[value="openai"]')).toHaveText('OpenAI（及兼容接口）');
  await expect(page.locator('#model')).toHaveValue('whisper-1');
  await expect(page.locator('#model option')).toHaveCount(4);
  expect(await page.locator('#model option').allTextContents()).toEqual([
    'whisper-1',
    'gpt-4o-transcribe',
    'gpt-4o-mini-transcribe',
    '自定义（Custom）',
  ]);
  await expect(page.locator('#openaiModelField')).toBeHidden();
  await expect(page.locator('#openKeyUrl')).toHaveText('OpenAI 官方');
  await expect(page.locator('#keyHintSuffix')).toHaveText('获取 API Key');

  await page.locator('#model').selectOption('custom-asr');
  await expect(page.locator('#openaiModelField')).toBeVisible();
  await expect(page.locator('label[for="openaiModel"]')).toHaveText('自定义 ASR 模型名');
  await page.locator('#openaiModel').fill('my-custom-model');
  await page.locator('#model').selectOption('gpt-4o-mini-transcribe');
  await expect(page.locator('#openaiModelField')).toBeHidden();
  await page.locator('#model').selectOption('custom-asr');
  await expect(page.locator('#openaiModel')).toHaveValue('my-custom-model');
});

test('explicit OCR video source is not overwritten when another media is queued', async ({ page }) => {
  await openLauncher(page);
  // S4：OCR 配置在预制页独立卡内（先启用模块使卡可见）。
  await page.locator('#prefabRail input[data-module-id="ocr"]').check();
  await page.evaluate(id => MSWWorkflow.setCollapsed(id, false), "ocr");
  await page.locator('#ocrVideoPath').fill('D:\\Demo\\1.mov');
  await page.evaluate(() => {
    const jsonPath = document.getElementById('jsonPath');
    jsonPath.value = 'D:\\Demo\\previous.mosp';
    jsonPath.dispatchEvent(new Event('input', { bubbles: true }));
    window.MSWLauncher.onBackendEvent({ type: 'dropMedia', path: 'D:\\Demo\\new-video.mp4' });
  });

  await expect.poll(() => page.evaluate(() => MSWQueue.tasks()[0]?.mediaPath)).toBe('D:\\Demo\\new-video.mp4');
  await expect(page.locator('#ocrVideoPath')).toHaveValue('D:\\Demo\\1.mov');
  await expect.poll(async () => page.evaluate(() => {
    const step = window.MSWLauncher.config?.postprocessAutoPlan?.steps?.find((item) => item.id === 'ocr');
    return [step?.videoPath || '', step?.videoPathMode || ''];
  })).toEqual(['D:\\Demo\\1.mov', 'manual']);
});

test('automatic OCR video source is not persisted as a manual override', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(path => MSWQueue.addPaths([path]), 'D:\\Demo\\1.mov');

  const ocrStep = await page.evaluate(() => window.MSWLauncher.getAutoPostprocessPayload()
    .steps.find((step) => step.id === 'ocr'));
  expect(ocrStep.videoPath).toBe('');
  expect(ocrStep.videoPathMode).toBe('auto');

  await page.evaluate(() => {
    window.MSWLauncher.onBackendEvent({ type: 'dropMedia', path: 'D:\\Demo\\2.mov' });
  });
  await expect.poll(() => page.evaluate(() => MSWQueue.tasks().length)).toBe(2);
  expect(await page.evaluate(() => MSWLauncher.getAutoPostprocessPayload().steps.find(s => s.id === 'ocr').videoPathMode)).toBe('auto');
});

test('translation merge option follows manual and automatic translation controls', async ({ page }) => {
  await openLauncher(page);

  // S4：合并双语是翻译卡的固定选项（不再随手动操作面板显隐）。
  await expect(page.locator('#translationWriteMode')).toHaveCount(1);

  await page.evaluate(() => {
    const provider = window.MSWLauncher.config.postprocessProviders.find((item) => item.id === 'deepseek');
    Object.assign(provider, { verified: true, hasApiKey: true, hasBaseUrl: true, hasModel: true });
    window.__savedPlans = [];
    const original = window.MSWLauncher.callBackend;
    window.MSWLauncher.callBackend = async (method, payload) => {
      if (method === 'save_postprocess_plan') window.__savedPlans.push(JSON.parse(JSON.stringify(payload.plan)));
      return original(method, payload);
    };
  });
  // D 阶段模块化：后处理配置卡在任一后处理模块启用后出现；deepseek 已就绪，经右栏启用翻译模块。
  await page.locator('#prefabRail input[data-module-id="translate"]').check();
  await page.evaluate(id => MSWWorkflow.setCollapsed(id, false), "translate");
  await expect(page.locator('[data-module-card="translate"]')).toBeVisible();
  await expect(page.locator('#autoTranslateTarget')).toBeVisible();
  await expect(page.locator('#translationWriteMode')).toHaveValue('secondary');

  await page.locator('#translationWriteMode').selectOption('bilingual');
  await expect.poll(() => page.evaluate(() => {
    const plans = window.__savedPlans || [];
    const latest = plans[plans.length - 1];
    return latest?.steps?.find((step) => step.id === 'translate')?.mergeBilingual;
  })).toBe(true);

  await page.locator('#prefabRail input[data-module-id="translate"]').uncheck();
  await expect(page.locator('#autoTranslateTargetField')).toBeHidden();
  await expect(page.locator('#translationWriteMode')).toBeHidden();
});

test('Launcher settings switch between accessible tabs and deep links', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.locator('[data-nav-page="settings"]').click();
  await page.mouse.move(600, 400); // 移开悬停，让折叠导航收起（展开层覆盖左缘内容）

  // S2：设置改为右侧单选分组栏（六组）；键盘左右/上下/Home/End 在分组间移动。
  const tabs = page.locator('#settingsRail [role="tab"]');
  await expect(tabs).toHaveCount(6);
  await expect(page.locator('#settingsRail')).toHaveAttribute('aria-label', '设置分组');
  await expect(page.locator('#settingsAppearancePanel')).toBeVisible();
  await expect(page.locator('#settingsConnectionPanel')).toBeHidden();
  await expect(page.locator('#settingsRailConnection')).toHaveText('服务与连接');

  const scrollInfo = await page.locator('.settings-scroll').evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollbarGutter: getComputedStyle(element).scrollbarGutter,
  }));

  await page.locator('#settingsRailConnection').click();
  await expect(page.locator('#settingsRailConnection')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#settingsConnectionPanel')).toBeVisible();
  await expect(page.locator('#settingsAppearancePanel')).toBeHidden();
  expect(scrollInfo.scrollbarGutter).toContain('stable');

  await page.locator('#settingsRailConnection').press('ArrowRight');
  await expect(page.locator('#settingsRailProcessing')).toBeFocused();
  await expect(page.locator('#settingsProcessingPanel')).toBeVisible();
  await page.locator('#settingsRailProcessing').press('End');
  await expect(page.locator('#settingsRailCache')).toBeFocused();
  await expect(page.locator('#settingsCachePanel')).toBeVisible();

  // 深链：FFmpeg 锚点进入「运行环境」分组并定位锚点。
  await page.evaluate(() => window.MSWLauncher.openSettings('ffmpegSettingsSection'));
  await expect(page.locator('#settingsRailRuntime')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ffmpegSettingsSection')).toBeVisible();

  // 窄窗口：分组栏收为右侧抽屉，不产生页面横向溢出。
  await page.setViewportSize({ width: 520, height: 520 });
  await page.reload();
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.locator('[data-nav-page="settings"]').click();
  await page.mouse.move(600, 400);
  const railLayout = await page.locator('#settingsRail').evaluate((element) => {
    const style = getComputedStyle(element);
    return { position: style.position, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
  });
  expect(railLayout.position).toBe('fixed');
  expect(railLayout.overflow).toBe(false);
});

test('does not start local transcription while model status is still checking', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  // R4/F09：识别默认关闭；本用例操作识别表单，先启用识别模块。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.evaluate(id => MSWWorkflow.setCollapsed(id, false), "asr");
  await page.locator('#provider').selectOption('local');
  await expect(page.locator('#localModelPanel')).toBeVisible();
  await page.evaluate(path => MSWQueue.addPaths([path]), 'D:\\Demo\\clip.mp4');
  // S5：SRT 输出字段迁入输出卡——经表单状态直接设置（输出卡未启用时不阻塞用例语义）。
  await page.evaluate(() => {
    const field = document.getElementById('srtPath');
    field.disabled = false;
    field.value = 'D:\\Demo\\clip.local.srt';
  });

  // R4/F09：识别默认关闭；本用例验证转录管线，先显式启用识别模块。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.evaluate(id => MSWWorkflow.setCollapsed(id, false), "asr");
  await page.evaluate(() => {
    const config = window.MSWLauncher.config;
    config.localRuntime = { status: 'ready', ready: true, path: '', pythonPath: '' };
    const local = config.providers.find((item) => item.id === 'local');
    const model = local.models.find((item) => item.id === document.querySelector('#model').value);
    model.localStatus = { status: 'checking', installed: false, canPrepare: false };
  });

  await page.locator('#start').click();
  await expect(page.locator('#status')).toHaveText('正在检查本地模型……');
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('#stop')).toBeHidden();
});

test('keeps local runtime events working after the page learns that installation is in progress', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  // R4/F09：识别默认关闭；本用例操作识别表单，先启用识别模块。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.evaluate(id => MSWWorkflow.setCollapsed(id, false), "asr");
  await page.locator('#provider').selectOption('local');
  await page.locator('#openLocalRuntimeSettings').click();
  await expect(page.locator('#localRuntimePanel')).toBeVisible();

  await page.evaluate(() => {
    const config = window.MSWLauncher.config;
    config.localRuntime = { status: 'installing', ready: false, path: 'D:\\Demo\\local-runtime', pythonPath: '' };
    window.MSWLauncher.onBackendEvent({
      type: 'localRuntimeProgress',
      percent: 37,
      message: '正在安装本地运行环境……',
    });
  });
  await expect(page.locator('#localRuntimeProgress')).toBeVisible();
  await expect.poll(() => page.locator('#localRuntimeProgressBar').getAttribute('style')).toContain('37%');
  await expect(page.locator('#localRuntimeProgressMessage')).toHaveText('正在安装本地运行环境……');

  await page.evaluate(() => window.MSWLauncher.onBackendEvent({ type: 'localRuntimeReady' }));
  await expect(page.locator('#status')).toHaveText('本地模型支持已安装完成');
});

test('LLM settings refill the saved key and save only after a successful connection test', async ({ page }) => {
  await openLauncher(page);
  // S4：LLM 连接配置在更多设置·服务与连接。
  await page.evaluate(() => window.MSWLauncher.openSettings('llmSettingsSection'));
  await page.evaluate(async () => {
    await window.MSWLauncher.callBackend('save_postprocess_settings', {
      providerId: 'deepseek',
      apiKey: 'sk-saved-for-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash',
    });
    const select = document.querySelector('#postprocessProvider');
    select.value = 'zhipu';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = 'deepseek';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  await expect(page.locator('#llmApiKey')).toHaveValue('sk-saved-for-test');
  await expect(page.locator('#llmKeyStatus')).toHaveText('已从本地环境读取密钥 sk-…mock');
  await page.locator('#llmApiKey').fill('sk-entered-for-test');
  await page.evaluate(() => {
    const callBackend = window.MSWLauncher.callBackend;
    window.__llmCalls = [];
    window.MSWLauncher.callBackend = async (method, payload) => {
      if (method === 'test_postprocess_connection' || method === 'save_postprocess_settings') {
        window.__llmCalls.push({ method, payload });
      }
      return callBackend(method, payload);
    };
  });

  await page.locator('#testLlmConnection').click();
  await expect(page.locator('#llmSettingsSaveStatus')).toHaveText('连接成功（已自动保存到本地环境）');
  expect(await page.evaluate(() => window.__llmCalls.map(({ method }) => method))).toEqual([
    'test_postprocess_connection',
  ]);
  expect(await page.evaluate(() => window.__llmCalls[0].payload.save)).toBe(true);
  await expect(page.locator('#llmApiKey')).toHaveValue('sk-entered-for-test');
});

test('Custom provider labels and missing-key errors follow the selected language', async ({ page }) => {
  await openLauncher(page);

  const customOption = page.locator('#postprocessProvider option[value="custom"]');
  const settingsCustomOption = page.locator('#llmProvider option[value="custom"]');
  await expect(customOption).toHaveText('自定义（兼容 OpenAI）');
  await expect(settingsCustomOption).toHaveText('自定义（兼容 OpenAI）');

  await setLauncherLanguage(page, 'en');
  await expect(customOption).toHaveText('Custom (OpenAI-compatible)');
  await expect(settingsCustomOption).toHaveText('Custom (OpenAI-compatible)');
  // S4：LLM 连接配置在更多设置·服务与连接。
  await page.evaluate(() => window.MSWLauncher.openSettings('llmSettingsSection'));
  await page.evaluate(() => {
    window.MSWLauncher.callBackend = async (method) => (
      method === 'test_postprocess_connection'
        ? { ok: false, field: 'postprocessApiKey', code: 'api_key_missing', detail: 'Post-processing API key is required.', error: 'Post-processing API key is required.' }
        : { ok: true }
    );
  });

  await page.locator('#llmApiKey').fill('');
  await page.locator('#testLlmConnection').click();
  await expect(page.locator('#llmSettingsSaveStatus')).toHaveText('');
  await expect(page.locator('#llmSettingsSaveStatus')).toBeHidden();
  await expect(page.locator('#llmApiKeyError')).toHaveText('Enter an API Key first; keys are stored only in the local connection config.');
  await expect(page.locator('#llmApiKey')).toHaveClass(/invalid/);

  await page.locator('#llmProvider').selectOption('zhipu');
  await expect(page.locator('#llmApiKey')).not.toHaveClass(/invalid/);
  await expect(page.locator('#llmApiKeyError')).toHaveText('');

  await page.evaluate(() => {
    window.MSWLauncher.callBackend = async (method) => (
      method === 'test_postprocess_connection'
        ? { ok: true, saved: true, verified: true, maskedApiKey: 'sk-…mock' }
        : { ok: true }
    );
  });
  await page.locator('#llmApiKey').fill('sk-success');
  await page.locator('#testLlmConnection').click();
  await expect(page.locator('#llmSettingsSaveStatus')).toHaveText('Connection successful (saved to local environment automatically).');
  await expect(page.locator('#llmApiKeyError')).toHaveText('');
  await expect(page.locator('#llmApiKey')).not.toHaveClass(/invalid/);
});

test('LLM HTTP failures give provider-aware actions without showing the key', async ({ page }) => {
  await openLauncher(page);
  // S4：LLM 连接配置在更多设置·服务与连接。
  await page.evaluate(() => window.MSWLauncher.openSettings('llmSettingsSection'));
  await page.locator('#llmApiKey').fill('test-only-key');
  await page.evaluate(() => {
    window.__llmFailureStatus = 401;
    window.__llmFailureProvider = 'deepseek';
    window.MSWLauncher.callBackend = async (method) => {
      if (method === 'test_postprocess_connection') {
        return {
          ok: false,
          field: 'postprocessProvider',
          code: 'postprocess_connection_failed',
          httpStatus: window.__llmFailureStatus,
          providerId: window.__llmFailureProvider,
          operation: 'connection test',
        };
      }
      if (method === 'get_postprocess_models') {
        return {
          ok: false,
          field: 'postprocessModel',
          code: 'postprocess_models_failed',
          httpStatus: window.__llmFailureStatus,
          providerId: window.__llmFailureProvider,
          operation: 'model list',
        };
      }
      return { ok: true };
    };
  });

  await page.locator('#testLlmConnection').click();
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('认证失败（HTTP 401');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('当前供应商：DeepSeek 官网');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('API URL');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('官方控制台');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('自定义（兼容 OpenAI）');
  await expect(page.locator('#llmSettingsSaveStatus')).not.toContainText('正确配置模型名');
  await expect(page.locator('#llmSettingsSaveStatus')).not.toContainText('test-only-key');

  await page.evaluate(() => { window.__llmFailureStatus = 403; });
  await page.locator('#testLlmConnection').click();
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('供应商拒绝了请求（HTTP 403');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('账号或模型有权限');

  await page.evaluate(() => { window.__llmFailureStatus = 404; });
  await page.locator('#getLlmModels').click();
  await expect(page.locator('#llmModelError')).toContainText('接口或模型不存在（HTTP 404');
  await expect(page.locator('#llmModelError')).toContainText('/models');
  await expect(page.locator('#llmModelError')).not.toContainText('官方控制台');
  await expect(page.locator('#llmModelError')).not.toContainText('test-only-key');

  await page.evaluate(() => { window.__llmFailureStatus = 429; });
  await page.locator('#getLlmModels').click();
  await expect(page.locator('#llmModelError')).toContainText('请求被限流或额度暂时耗尽（HTTP 429');
  await expect(page.locator('#llmModelError')).toContainText('稍后重试');
  await expect(page.locator('#llmModelError')).not.toContainText('官方控制台');
  await expect(page.locator('#llmModelError')).not.toContainText('HTTP 404');

  await page.evaluate(() => { window.__llmFailureStatus = 401; window.__llmFailureProvider = 'custom'; });
  await page.locator('#testLlmConnection').click();
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('认证失败（HTTP 401');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('当前供应商：自定义（兼容 OpenAI）');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('API URL、API Key 是否来自同一服务商');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('正确配置模型名');
  await expect(page.locator('#llmSettingsSaveStatus')).toContainText('请勿在错误报告中粘贴你的个人 API Key');
  await expect(page.locator('#llmSettingsSaveStatus')).not.toContainText('官方控制台');
});

test('runtime errors show an actionable notice outside the log', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  // S1：闲置状态不再显示「就绪」——空消息时整块收起。
  await expect(page.locator('#status')).toBeHidden();
  await expect(page.locator('#status')).toHaveText('');

  await page.evaluate(() => window.MSWLauncher.onBackendEvent({
    type: 'error',
    code: 'ffmpeg_missing',
    detail: 'ffmpeg and ffprobe were not found',
  }));

  const notice = page.locator('#errorNotice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('未找到 FFmpeg / FFprobe');
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toContainText('未找到 FFmpeg / FFprobe');
  await expect(page.locator('#errorNoticeActions')).toBeVisible();
  await expect(page.locator('#errorNoticeAction')).toHaveText('FFmpeg 配置项');
  await expect(page.locator('#errorNoticeFaq')).toHaveText('查看常见问题');
  await expect(page.locator('#errorNoticeIssue')).toBeHidden();
  await expect(page.locator('#errorNoticeActions > button')).toHaveCount(4);
  await expect(notice).toHaveCSS('display', 'flex');
  await expect(notice).toHaveCSS('flex-direction', 'column');
  await expect(page.locator('#errorNoticeActions')).toHaveCSS('display', 'flex');
  await expect(page.locator('#errorNoticeActions')).toHaveCSS('flex-direction', 'row');
  await expect(page.locator('#errorNoticeActions')).toHaveCSS('flex-wrap', 'wrap');
  await expect(page.locator('#errorNoticeClose')).toHaveCSS('position', 'absolute');
  await page.setViewportSize({ width: 480, height: 800 });
  await expect(page.locator('#errorNoticeActions')).toHaveCSS('display', 'flex');
  await expect(page.locator('#errorNoticeActions')).toHaveCSS('flex-direction', 'row');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    const original = window.MSWLauncher.callBackend;
    window.__faqCalls = [];
    window.MSWLauncher.callBackend = async (method, payload) => {
      if (method === 'open_faq') window.__faqCalls.push({ method, payload });
      return original(method, payload);
    };
  });
  await page.locator('#errorNoticeFaq').click();
  await expect.poll(() => page.evaluate(() => window.__faqCalls.length)).toBe(1);
  await page.locator('#errorNoticeAction').click();
  await expect(page.locator('#settingsModal')).toBeVisible();
  await expect(page.locator('#ffmpegSettingsSection')).toBeVisible();

  await page.keyboard.press('Escape');
  await page.locator('#errorNoticeClose').click();
  await expect(notice).toBeHidden();
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toContainText('未找到 FFmpeg / FFprobe');
});

test('provider HTTP failures keep retry guidance and original transcription discoverable', async ({ page }) => {
  await openLauncher(page);
  await page.evaluate(() => window.MSWLauncher.onBackendEvent({
    type: 'error',
    code: 'postprocess_provider_response',
    detail: '后处理步骤 translate 失败：LLM provider returned HTTP 400: invalid request. This is a provider response, not a network outage.',
    canRetry: true,
    failedStep: 'translate',
    originalSrtPath: 'D:\\Demo\\clip.srt',
    originalProjectPath: 'D:\\Demo\\clip.mosp',
  }));

  await expect(page.locator('#errorNotice')).toBeVisible();
  await expect(page.locator('#errorNoticeMessage')).toContainText('这不是网络中断');
  await expect(page.locator('#errorNoticeMessage')).toContainText('原始转写仍然保留');
  await expect(page.locator('#retryPostprocess')).toBeVisible();
  await expect(page.locator('#openFolder')).toBeVisible();
  await expect(page.locator('#srtPath')).toHaveValue('D:\\Demo\\clip.srt');
  await expect(page.locator('#jsonPath')).toHaveValue('D:\\Demo\\clip.mosp');
});

test('error notice and status remain above the fixed footer at desktop and narrow widths', async ({ page }) => {
  const measure = () => page.evaluate(() => {
    const box = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
    };
    return {
      notice: box('#errorNotice'),
      copy: box('.error-notice-copy'),
      actions: box('#errorNoticeActions'),
      close: box('#errorNoticeClose'),
      status: box('#status'),
      footer: box('[data-page-id="prefab"] .page-actions'),
    };
  });
  const showFailure = async () => {
    await page.evaluate(() => {
      window.MSWLauncher.onBackendEvent({ type: 'error', code: 'ffmpeg_missing', detail: 'ffmpeg and ffprobe were not found' });
    });
    await expect(page.locator('#errorNotice')).toBeVisible();
    await page.evaluate(() => { const scroller = document.querySelector('[data-page-id="prefab"] .page-scroll'); if (scroller) scroller.scrollTop = scroller.scrollHeight; });
    await expect.poll(async () => {
      const metrics = await measure();
      return metrics.notice.bottom <= metrics.footer.top + 1 && metrics.status.bottom <= metrics.footer.top + 1;
    }).toBe(true);
  };
  const showRetry = async () => {
    await page.evaluate(() => document.querySelector('#retryPostprocess').classList.remove('hidden'));
    // Let ResizeObserver recalculate the shell's bottom reserve before moving
    // to the document end; this models the real late-arriving retry action.
    await page.waitForTimeout(80);
    await page.evaluate(() => { const scroller = document.querySelector('[data-page-id="prefab"] .page-scroll'); if (scroller) scroller.scrollTop = scroller.scrollHeight; });
    await expect.poll(async () => {
      const metrics = await measure();
      return metrics.notice.bottom <= metrics.footer.top + 1 && metrics.status.bottom <= metrics.footer.top + 1;
    }).toBe(true);
  };

  await page.setViewportSize({ width: 1180, height: 520 });
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await showFailure();
  const desktopNormal = await measure();
  expect(desktopNormal.notice.bottom).toBeLessThanOrEqual(desktopNormal.footer.top + 1);
  expect(desktopNormal.status.bottom).toBeLessThanOrEqual(desktopNormal.footer.top + 1);
  expect(desktopNormal.copy.width).toBeGreaterThan(250);
  expect(desktopNormal.actions.top).toBeGreaterThanOrEqual(desktopNormal.copy.bottom - 1);
  expect(desktopNormal.actions.left).toBeGreaterThanOrEqual(desktopNormal.notice.left - 1);
  expect(desktopNormal.actions.right).toBeLessThanOrEqual(desktopNormal.notice.right + 1);
  expect(desktopNormal.close.right).toBeGreaterThanOrEqual(desktopNormal.notice.right - 16);
  expect(desktopNormal.close.top).toBeGreaterThanOrEqual(desktopNormal.notice.top - 1);
  expect(desktopNormal.close.bottom).toBeLessThanOrEqual(desktopNormal.notice.top + 42);
  expect(desktopNormal.actions.height).toBeGreaterThanOrEqual(30);
  await showRetry();
  const desktopDynamic = await measure();
  await expect(page.locator('#retryPostprocess')).toBeVisible();
  expect(desktopDynamic.footer.height).toBeGreaterThanOrEqual(desktopNormal.footer.height);
  expect(desktopDynamic.notice.bottom).toBeLessThanOrEqual(desktopDynamic.footer.top + 1);
  expect(desktopDynamic.status.bottom).toBeLessThanOrEqual(desktopDynamic.footer.top + 1);

  await page.setViewportSize({ width: 520, height: 520 });
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await showFailure();
  const narrowNormal = await measure();
  expect(narrowNormal.notice.bottom).toBeLessThanOrEqual(narrowNormal.footer.top + 1);
  expect(narrowNormal.status.bottom).toBeLessThanOrEqual(narrowNormal.footer.top + 1);
  expect(narrowNormal.actions.top).toBeGreaterThanOrEqual(narrowNormal.copy.bottom - 1);
  expect(narrowNormal.close.right).toBeGreaterThanOrEqual(narrowNormal.notice.right - 16);
  expect(narrowNormal.close.top).toBeGreaterThanOrEqual(narrowNormal.notice.top - 1);
  expect(narrowNormal.close.bottom).toBeLessThanOrEqual(narrowNormal.notice.top + 42);
  await showRetry();
  const narrowDynamic = await measure();
  // 横向工作台：操作栏在流内且按钮不收缩，520px 下三个按钮可单行容纳；
  // 安全契约为「不遮挡内容」而非「必须换行增高」。
  expect(narrowDynamic.footer.height).toBeGreaterThanOrEqual(narrowNormal.footer.height);
  expect(narrowDynamic.notice.bottom).toBeLessThanOrEqual(narrowDynamic.footer.top + 1);
  expect(narrowDynamic.status.bottom).toBeLessThanOrEqual(narrowDynamic.footer.top + 1);
  expect(narrowDynamic.actions.top).toBeGreaterThanOrEqual(narrowDynamic.copy.bottom - 1);
  expect(narrowDynamic.close.right).toBeGreaterThanOrEqual(narrowDynamic.notice.right - 16);
  expect(narrowDynamic.close.top).toBeGreaterThanOrEqual(narrowDynamic.notice.top - 1);
  expect(narrowDynamic.close.bottom).toBeLessThanOrEqual(narrowDynamic.notice.top + 42);
});

test('error reports copy safe details and support file URL fallback', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  // R4/F09：识别默认关闭；本用例涉及识别表单，先启用识别模块。
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.evaluate(id => MSWWorkflow.setCollapsed(id, false), "asr");
  await page.locator('#apiKey').fill('sk-secret-test-key');
  await page.evaluate(() => {
    window.MSWLauncher.appendLog('child output: duration probe failed');
    window.MSWLauncher.appendLog('Authorization: Bearer secret-bearer-token');
    window.__copiedReports = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => window.__copiedReports.push(text) },
    });
  });
  await page.evaluate(() => {
    const event = { type: 'error', code: 'transcription_failed', detail: 'backend detail' };
    window.MSWLauncher.onBackendEvent(event);
    window.MSWLauncher.onBackendEvent(event);
    window.MSWLauncher.appendLog('[error] unrelated child failure');
    window.MSWLauncher.appendLog('[detail] unrelated child detail');
  });
  await expect(page.locator('#errorNoticeIssue')).toBeVisible();
  await page.locator('#errorNoticeCopy').click();
  await expect(page.locator('#errorNoticeCopy')).toHaveText('已复制');
  const report = (await page.evaluate(() => window.__copiedReports[0]));
  expect(report).toContain('错误码: transcription_failed');
  expect(report).toContain('backend detail');
  expect(report).toContain('child output: duration probe failed');
  expect(report).toContain('[error] unrelated child failure');
  expect(report).toContain('[detail] unrelated child detail');
  expect(report).not.toContain('[error] 转写失败，本次任务已停止。请查看日志后修正问题，再重新尝试。');
  expect(report).not.toContain('secret-bearer-token');
  expect(report.match(/详细信息: backend detail/g)?.length).toBe(1);
  expect(report.match(/\[detail\] backend detail/g)?.length).toBe(2);
  const expectedVersion = await page.locator('#appVersion').evaluate((element) => ((element.textContent.trim().match(/v[\w.-]+/u) || [''])[0]).replace(/^v/u, ''));
  expect(report).toContain(expectedVersion);
  expect(report).not.toContain('sk-secret-test-key');

  await page.evaluate(() => {
    window.__copiedReports = [];
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    document.execCommand = () => { window.__fallbackCopyUsed = true; return true; };
  });
  await page.locator('#errorNoticeCopy').click();
  await expect(page.locator('#errorNoticeCopy')).toHaveText('已复制');
  await expect.poll(() => page.evaluate(() => Boolean(window.__fallbackCopyUsed))).toBe(true);

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error('denied'); };
    document.execCommand = () => false;
  });
  await page.locator('#errorNoticeCopy').click();
  await expect(page.locator('#errorNoticeCopy')).toHaveText('复制失败，请手动复制日志。');
  await page.locator('#errorNoticeClose').click();
  await expect(page.locator('#errorNotice')).toBeHidden();
  await expect(page.locator('#errorNoticeCopy')).toHaveText('复制错误报告');
});

test('unknown errors stay generic and do not expose FFmpeg actions', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.evaluate(() => window.MSWLauncher.onBackendEvent({
    type: 'error', code: 'unknown_backend_failure', detail: 'service exploded',
  }));
  await expect(page.locator('#errorNotice')).toBeVisible();
  await expect(page.locator('#errorNoticeMessage')).toContainText('service exploded');
  await expect(page.locator('#errorNoticeAction')).toBeHidden();
  await expect(page.locator('#errorNoticeFaq')).toBeVisible();
  await expect(page.locator('#errorNoticeFaq')).toHaveText('查看常见问题');
  await expect(page.locator('#errorNoticeCopy')).toHaveText('复制错误报告');
  await expect(page.locator('#errorNoticeIssue')).toHaveText('打开项目主页');
  await expect(page.locator('#errorNoticeIssue')).toBeVisible();
  await page.evaluate(() => {
    const original = window.MSWLauncher.callBackend;
    window.__issueCalls = [];
    window.MSWLauncher.callBackend = async (method, payload) => {
      if (method === 'open_url') window.__issueCalls.push({ method, payload });
      return original(method, payload);
    };
  });
  await page.locator('#errorNoticeIssue').click();
  await expect.poll(() => page.evaluate(() => window.__issueCalls[0])).toEqual({
    method: 'open_url', payload: { url: 'https://github.com/xiaoyaomoyor/moyors-subtitle-workflow/issues/new' },
  });
});

test('error reports keep one structured hint when detail matches the hint', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.evaluate(() => {
    window.__copiedReports = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text) => window.__copiedReports.push(text) },
    });
    window.MSWLauncher.onBackendEvent({
      type: 'error', code: 'unknown_backend_failure', detail: 'same\nmessage',
    });
  });
  await expect(page.locator('#errorNotice')).toBeVisible();
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('same message');
  await page.locator('#errorNoticeCopy').click();
  await expect(page.locator('#errorNoticeCopy')).toHaveText('已复制');
  const report = await page.evaluate(() => window.__copiedReports[0]);
  expect(report.match(/提示: same message/g)?.length).toBe(1);
  expect(report).not.toContain('详细信息: same message');
  expect(report).toContain('[detail] same\nmessage');
  await page.locator('#errorNoticeClose').click();
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toHaveText('same message');
});

test('FAQ open failures remain visible without an unhandled rejection', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.evaluate(() => {
    window.MSWLauncher.callBackend = async (method) => method === 'open_faq' ? { ok: false, error: 'FAQ unavailable' } : { ok: true };
    window.MSWLauncher.onBackendEvent({ type: 'error', code: 'transcription_failed', detail: 'failed' });
  });
  await page.locator('#errorNoticeFaq').click();
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toContainText('FAQ unavailable');
  await expect(page.locator('#log')).toContainText('open_faq: FAQ unavailable');
  await page.evaluate(() => {
    window.MSWLauncher.callBackend = async (method) => method === 'open_url' ? { ok: false, error: 'Issue page unavailable' } : { ok: true };
    window.MSWLauncher.onBackendEvent({ type: 'error', code: 'unknown_backend_failure', detail: 'unknown failure' });
  });
  await page.locator('#errorNoticeIssue').click();
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#status')).toContainText('Issue page unavailable');
  await expect(page.locator('#log')).toContainText('open_issue: Issue page unavailable');
});

test('server media accepts a dropped file even when batch mode is selected', async ({ page }) => {
  await page.goto(`file://${launcherPath}`);
  await page.waitForFunction(() => window.MSWLauncher?.config?.postprocessProviders?.length > 0);
  // 工程文件/服务器媒体字段位于「启动编辑器」页的高级折叠区（R3/H04 默认收起）。
  await page.evaluate(() => window.MSWNavigation.show('home'));
  await page.locator('#serverToggle').click();
  await page.locator('#jsonPath').fill('D:\\Demo\\missing-media.mosp');
  await page.locator('#serverMediaField').evaluate((element) => element.classList.remove('hidden'));
  // 批量切换位于「预制工程」页的媒体卡。
  await page.evaluate(() => window.MSWNavigation.show('prefab'));
  await page.evaluate(() => MSWQueue.addPaths(['D:/Demo/queued-a.mp4', 'D:/Demo/queued-b.mp4']));

  await page.locator('#serverMediaPath').evaluate((input) => {
    const dataTransfer = { types: ['Files'], files: [{ path: 'D:\\Demo\\clip.mp4' }] };
    const dragEnter = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, 'dataTransfer', { value: dataTransfer });
    input.dispatchEvent(dragEnter);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    input.dispatchEvent(drop);
  });

  await expect(page.locator('#serverMediaPath')).toHaveValue('D:\\Demo\\clip.mp4');
  await expect(page.locator('#serverMediaPath')).not.toHaveClass(/drag-over/);
  await expect(page.locator('.queue-file')).toHaveCount(2);
});

test('adding tasks keeps manuscript matching enabled and requires per-task mappings', async ({ page }) => {
  await openLauncher(page);
  await page.locator('#prefabRail input[data-module-id="match"]').check();
  await page.evaluate(() => MSWQueue.addPaths(['D:/Demo/a.srt', 'D:/Demo/b.srt']));
  await expect(page.locator('#prefabRail input[data-module-id="match"]')).toBeChecked();
  await expect(page.locator('#prefabRail input[data-module-id="match"]')).toBeEnabled();
  expect(await page.evaluate(() => MSWPlan.build().postprocess.steps.find(s => s.id === 'match').enabled)).toBe(true);
  await page.locator('.queue-details summary').first().click();
  await expect(page.locator('.queue-file').first().getByLabel('本任务文稿', { exact: true })).toBeVisible();
});

for (const cancelled of [true, false]) {
  test('queueDone reconciles missing terminal outcomes: cancelled=' + cancelled, async ({ page }) => {
    await openLauncher(page);
    await page.evaluate(() => MSWQueue.addPaths(['D:/Demo/one.mp3', 'D:/Demo/two.mp3']));
    await page.evaluate(() => {
      const original = MSWLauncher.callBackend;
      MSWLauncher.callBackend = (method, payload) => method === 'start_prefab_queue' ? Promise.resolve({ ok: true, runId: 'test-run' }) : original(method, payload);
    });
    await page.locator('#start').click();
    await page.waitForFunction(() => MSWQueue.state.runId === 'test-run');
    await page.evaluate(cancelled => MSWLauncher.onBackendEvent({ type: 'queueDone', runId: 'test-run', cancelled, results: [{ taskId: MSWQueue.tasks()[0].id, status: 'done', result: { projectPath: 'D:/Demo/result.mosp' } }] }), cancelled);
    await expect(page.locator('.queue-status').first()).toHaveText('已完成');
    await expect(page.locator('.queue-status').last()).toHaveText(cancelled ? '已取消' : '失败');
    if (!cancelled) await expect(page.locator('.queue-file').last()).toContainText('未收到此任务的结果');
    await expect(page.locator('#start')).toBeEnabled();
  });
}
