import {test, expect} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const url = pathToFileURL(resolve('web/launcher/index.html')).href;
async function open(page) {
  await page.goto(url);
  await page.waitForFunction(() => MSWLauncher.config?.postprocessProviders?.length);
  await page.evaluate(() => {
    MSWNavigation.show('prefab');
    for (const id of ['asr','proofread','resegment','translate']) {
      MSWModules.setEnabled(id, true); MSWWorkflow.setCollapsed(id, false);
    }
  });
}

test('step models inherit independently, search, type and reset on provider change', async ({page}) => {
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await open(page);
  await page.evaluate(() => {
    Object.assign(MSWLauncher.config.postprocessProviders.find(p=>p.id==='custom'), {
      model:'gemini-3.8-flash', reasoningMode:'low', availableModels:['gemini-3.6-flash','gemini-3.5-flash-lite']
    });
  });
  for (const id of ['proofread','translate']) await page.locator(`#${id}Provider`).selectOption('custom');
  await expect(page.locator('#proofreadModel')).toHaveAttribute('placeholder', /跟随更多设置.*gemini-3.8-flash/);
  await expect(page.locator('#proofreadReasoningMode option:checked')).toHaveText(/跟随更多设置.*低/);
  await page.locator('#proofreadModel').fill('3.6');
  await expect(page.locator('#proofreadModelOptions')).not.toContainText('3.5-flash-lite');
  await page.locator('#proofreadModelOptions button').filter({hasText:'gemini-3.6-flash'}).click();
  await page.locator('#proofreadReasoningMode').selectOption('high');
  await page.locator('#translateModel').fill('gemini-3.5-flash-lite');
  await page.locator('#translateModel').press('Tab');
  const plan = await page.evaluate(()=>MSWPlan.build());
  expect(plan.postprocess.steps.find(s=>s.id==='proofread')).toMatchObject({model:'gemini-3.6-flash',reasoningMode:'high'});
  expect(plan.postprocess.steps.find(s=>s.id==='translate')).toMatchObject({model:'gemini-3.5-flash-lite',reasoningMode:''});
  expect(await page.evaluate(()=>MSWLauncher.config.postprocessProviders.find(p=>p.id==='custom').model)).toBe('gemini-3.8-flash');
  await page.locator('#proofreadModel').click();
  await page.locator('#proofreadModelOptions button').first().click();
  await expect(page.locator('#proofreadModel')).toHaveValue('');
  await expect(page.locator('#proofreadReasoningMode')).toHaveValue('high');
  await page.locator('#proofreadProvider').selectOption('qwen');
  await expect(page.locator('#proofreadReasoningMode')).toHaveValue('');
  await page.locator('#proofreadProvider').selectOption('custom');
  await expect(page.locator('#proofreadModel')).toHaveValue('');
  expect(errors).toEqual([]);
  await page.locator('#proofreadCard').screenshot({path:'output/prefab-step-models.png'});
});

test('saved step overrides restore after reload without copying defaults or credentials', async ({page}) => {
  let saved = null;
  await page.exposeFunction('stepPlanStore', value => { if (value) saved = value; return saved; });
  await page.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'get_config') {
        const config = await next(method, payload), plan = await window.stepPlanStore();
        return plan ? {...config, postprocessAutoPlan: plan} : config;
      }
      if (method === 'save_postprocess_plan') { await window.stepPlanStore(payload.plan); return {ok:true, plan:payload.plan}; }
      return next(method, payload);
    };
  }, {once:true}));
  await open(page);
  await page.locator('#proofreadModel').fill('proofreader-manual');
  await page.locator('#proofreadReasoningMode').selectOption('low');
  await page.locator('#translateReasoningMode').selectOption('high');
  await expect.poll(()=>saved?.steps.find(s=>s.id==='translate')?.reasoningMode).toBe('high');
  const json = JSON.stringify(saved);
  expect(json).not.toContain('apiKey'); expect(json).not.toContain('baseUrl');
  expect(saved.steps.find(s=>s.id==='translate').model).toBe('');
  await open(page);
  await expect(page.locator('#proofreadModel')).toHaveValue('proofreader-manual');
  await expect(page.locator('#proofreadReasoningMode')).toHaveValue('low');
  await expect(page.locator('#translateModel')).toHaveValue('');
  await expect(page.locator('#translateReasoningMode')).toHaveValue('high');
});

test('capability response cannot replace a newer model and unknown manual models stay usable', async ({page}) => {
  await open(page);
  await page.evaluate(() => {
    const original=MSWLauncher.callBackend;
    MSWLauncher.callBackend=async (method,payload)=>{
      if(method==='get_postprocess_model_capabilities') {
        if(payload.model==='slow-model') return new Promise(resolve=>window.__slowCaps=()=>resolve({ok:true,modes:['auto','off','low','medium','high'],effectiveMode:'off'}));
        return {ok:true,modes:['auto','low','high','max'],effectiveMode:'low'};
      }
      return original(method,payload);
    };
  });
  await page.locator('#proofreadModel').fill('slow-model');
  await page.waitForFunction(()=>typeof __slowCaps==='function');
  await page.locator('#proofreadModel').fill('glm-5.3-flash');
  await expect(page.locator('#proofreadReasoningMode option[value="max"]')).toHaveCount(1);
  await page.evaluate(()=>__slowCaps());
  await expect(page.locator('#proofreadReasoningMode option[value="off"]')).toHaveCount(0);
  await page.locator('#proofreadReasoningMode').selectOption('max');
  expect(await page.evaluate(()=>MSWLauncher.getAutoPostprocessPayload().steps.find(s=>s.id==='proofread').reasoningMode)).toBe('max');
});

test('ASR connections live in settings and unsaved changes never leak into a task', async ({page}) => {
  await open(page);
  await expect(page.locator('#recognitionCard #apiKey')).toHaveCount(0);
  await expect(page.locator('#asrSettingsSection #apiKey')).toHaveCount(1);
  await page.locator('#provider').selectOption('openai');
  await page.locator('#model').selectOption('gpt-4o-transcribe');
  const before=await page.evaluate(()=>MSWLauncher.getTranscriptionPayload());
  await page.locator('#openConnectionSettings').click();
  await expect(page.locator('#asrConnectionProvider')).toHaveValue('openai');
  await page.locator('#openaiBaseUrl').fill('https://saved.example/v1');
  await page.locator('#apiKey').fill('test-only-secret');
  const draft=await page.evaluate(()=>MSWLauncher.getTranscriptionPayload());
  expect(draft.apiKey).toBe(''); expect(draft.openaiBaseUrl).toBe(before.openaiBaseUrl);
  await page.locator('#saveAsrConnection').click();
  await expect(page.locator('#apiKey')).toHaveValue('');
  await page.locator('#asrConnectionProvider').selectOption('qwen');
  expect(await page.evaluate(()=>MSWLauncher.getTranscriptionPayload())).toMatchObject({providerId:'openai',modelId:'gpt-4o-transcribe',apiKey:'',openaiBaseUrl:'https://saved.example/v1'});
  await page.evaluate(()=>MSWNavigation.show('prefab'));
  await page.locator('#provider').selectOption('qwen');
  await page.locator('#recognitionCard').screenshot({path:'output/prefab-asr-models.png'});
});
