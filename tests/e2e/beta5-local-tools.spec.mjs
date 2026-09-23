import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setLauncherLanguage } from './launcher-language.mjs';

test('new tools preserve English navigation and narrow layout', async ({page}, testInfo) => {
  await open(page);
  await setLauncherLanguage(page, 'en');
  await page.setViewportSize({width:760,height:760});
  await page.evaluate(() => { MSWNavigation.show('tools'); MSWTools.select('timestamps'); });
  await expect(page.locator('#timestampToolPanel h2')).toHaveText('Word timestamp alignment');
  await expect(page.locator('#timestampMode')).toHaveValue('fill');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('timestamp-tool-en.png'),fullPage:true});
});

test('restoring the same disconnected session does not open another tab', async ({page}) => {
  await open(page);
  await page.evaluate(() => {
    window.__opened = []; window.__running = true; window.__port = 8250;
    MSWLauncher.bridgeOverride = async (method, payload, next) => {
      if (method === 'start_server') { __running = true; return {ok:true,url:`http://127.0.0.1:${__port}/`}; }
      if (method === 'open_url') { __opened.push(payload.url); return {ok:true}; }
      if (method === 'get_server_status') return {ok:true,running:__running,url:`http://127.0.0.1:${__port}/`};
      return next();
    };
    document.getElementById('jsonPath').value = 'same.mosp';
  });
  await page.evaluate(() => MSWLauncher.openServerEditor());
  expect(await page.evaluate(() => __opened)).toHaveLength(1);
  await page.evaluate(() => { __running=false; MSWLauncher.refreshServerStatus(); });
  await expect(page.locator('#stopServer')).toBeHidden();
  await page.evaluate(() => MSWLauncher.openServerEditor());
  expect(await page.evaluate(() => __opened)).toHaveLength(1);
  await page.evaluate(() => { __running=false; MSWLauncher.refreshServerStatus(); });
  await expect(page.locator('#stopServer')).toBeHidden();
  await page.evaluate(() => { __port=8251; return MSWLauncher.openServerEditor(); });
  expect(await page.evaluate(() => __opened)).toEqual(['http://127.0.0.1:8250/','http://127.0.0.1:8251/']);
});

test('offline text comparison treats subtitle markup as data and supports search', async ({page}) => {
  await page.goto(pathToFileURL(resolve('tools/compare.html')).href);
  const project = {segments:[{start:0,end:1000,text:'<img src=x onerror="window.pwned=1">'},{start:2000,end:3000,text:'matching'}]};
  await page.locator('#fileInput').setInputFiles([
    {name:'one.mosp',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))},
    {name:'two.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,000 --> 00:00:01,000\ndifferent\n\n2\n00:00:02,000 --> 00:00:03,000\nmatching\n')},
  ]);
  await expect(page.locator('#cards .card')).toHaveCount(2);
  await page.getByRole('button',{name:'设为基准',exact:true}).first().click();
  await page.locator('#diffOnly').check();
  await page.locator('#search').fill('different');
  await expect(page.locator('#tableWrap')).toContainText('different');
  expect(await page.evaluate(() => window.pwned)).toBeUndefined();
  await expect(page.locator('#tableWrap img')).toHaveCount(0);
});

async function open(page) {
  await page.goto(pathToFileURL(resolve('web/launcher/index.html')).href);
  await page.waitForFunction(()=>window.MSWLauncher?.config?.providers?.length);
}

test('MSW mixed queue carries explicit local ASR and alignment options',async({page})=>{
  await open(page);
  await page.evaluate(()=>{MSWNavigation.show('prefab');MSWModules.setEnabled?.('asr',true);});
  await page.locator('#prefabRail input[data-module-id="asr"]').check();
  await page.evaluate(()=>MSWWorkflow.setCollapsed('asr',false));
  await page.locator('#provider').selectOption('local');
  await page.locator('#model').selectOption('firered-asr2-ctc-local');
  await page.locator('#fireredPunc').selectOption('none');
  await page.locator('#alignmentModel').selectOption('firered-asr2-ctc');
  const payload=await page.evaluate(()=>MSWLauncher.getTranscriptionPayload());
  expect(payload).toMatchObject({providerId:'local',modelId:'firered-asr2-ctc-local',fireredPunc:'none',alignmentModel:'firered-asr2-ctc'});
});

test('alignment tool defaults main-only and requires explicit secondary audio',async({page})=>{
  await open(page);
  await page.evaluate(()=>{
    window.__alignCalls=[];
    MSWLauncher.callBackend=async(method,payload)=>{
      if(method==='inspect_alignment_input')return {ok:true,tracks:[{id:'main',label:'主字幕'},{id:'secondary:translation',label:'译文'}]};
      if(method==='run_timestamp_alignment'){__alignCalls.push(payload);return {ok:true,projectPath:'new.mosp',report:{alignedSegments:1}};}
      return {ok:true};
    };
    MSWNavigation.show('tools');MSWTools.select('timestamps');
  });
  await page.locator('#timestampInput').fill('synthetic.mosp');await page.locator('#timestampInput').dispatchEvent('change');
  await expect(page.locator('#timestampTrack option')).toHaveCount(2);
  await expect(page.locator('#timestampTrack')).toHaveValue('main');
  await expect(page.locator('#timestampMode')).toHaveValue('fill');
  await page.locator('#timestampTrack').selectOption('secondary:translation');
  await page.locator('#runTimestampTool').click();await expect(page.locator('#timestampResult')).toContainText('明确指定');
  expect(await page.evaluate(()=>__alignCalls)).toHaveLength(0);
  await page.locator('#timestampMedia').fill('dub.wav');await page.locator('#timestampAudio').fill('1');
  await page.locator('#runTimestampTool').click();await expect(page.locator('#timestampResult')).toContainText('new.mosp');
  expect(await page.evaluate(()=>__alignCalls[0])).toMatchObject({targetTrack:'secondary:translation',audioIndex:1,mediaPath:'dub.wav',alignmentMode:'fill'});
});

test('both offline comparison tools are reachable from the existing tools page',async({page})=>{
  await open(page);
  await page.evaluate(()=>{window.__tools=[];MSWLauncher.callBackend=async(method,payload)=>{__tools.push({method,payload});return {ok:true};};MSWNavigation.show('tools');MSWTools.select('compare');});
  await page.locator('[data-comparison-tool="compare"]').click();
  await page.locator('[data-comparison-tool="timestamp-compare"]').click();
  expect(await page.evaluate(()=>__tools.filter(call=>call.method==='open_comparison_tool'))).toEqual([{method:'open_comparison_tool',payload:{tool:'compare'}},{method:'open_comparison_tool',payload:{tool:'timestamp-compare'}}]);
});
