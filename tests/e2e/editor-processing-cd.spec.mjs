import {test,expect} from '@playwright/test';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,generateWav,generateWaveformPayload,makeTempDir,startServer,findFreePort} from './helpers.mjs';
let server,root,jobs;
test.beforeEach(async({page})=>{
  root=makeTempDir('processing-cd');jobs=[];
  process.env.MAW_ENV_FILE=join(root,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(root,'local');
  writeFileSync(process.env.MAW_ENV_FILE,'DASHSCOPE_API_KEY=synthetic-key\n');
  const media=generateWav(join(root,'source.wav'),10),path=join(root,'project.mosp');
  writeFileSync(path,JSON.stringify({media,msw:{schema:'msw.editor.v1',project_id:'cd-project'},segments:[{id:'original',start:1000,end:9000,text:'Hello world'}],waveform:generateWaveformPayload(10000)}));
  await disableOnboarding(page);
  await page.addInitScript(()=>{localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false}));localStorage.setItem('msw.waveform.auto','false');});
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  await page.route('**/api/msw/providers',r=>r.fulfill({json:{ok:true,providers:[{id:'custom',label:'Synthetic',hasApiKey:true,baseUrl:'http://127.0.0.1:1',model:'test'}],selectedProvider:'custom'}}));
  await page.route('**/api/msw/jobs**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()==='POST'&&url.pathname.endsWith('/jobs')){
      const p=request.postDataJSON(),job={id:'job-'+(jobs.length+1),kind:p.kind,project_id:p.project_id,status:'succeeded',created_at:jobs.length+1,model:'synthetic',provider:'custom',snapshot:p.snapshot};
      job.batch_id=p.snapshot.batch_id;job.source_range=p.snapshot.range;
      job.result=p.kind==='translation'?{translations:p.snapshot.entries.map(e=>({id:e.source.id,text:'译文 '+e.source.text})),skipped_ids:[],language:'zh'}:{segments:[{id:'result',start:p.snapshot.range.start+100,end:p.snapshot.range.end-100,text:'识别内容'}]};
      jobs.push(job);await route.fulfill({json:{ok:true,job}});
    }else if(url.pathname.endsWith('/result')){
      const job=jobs.find(j=>url.pathname.includes('/'+j.id+'/'));await route.fulfill({json:{ok:true,job}});
    }else await route.fulfill({json:{ok:true,jobs,revision:jobs.length}});
  });
  await page.route('**/api/msw/asr-validate',r=>r.fulfill({json:{ok:true,valid:true}}));
  server=await startServer(path,media,await findFreePort());await page.goto(server.url);await expect(page.locator('#editor-loading')).toBeHidden();
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();});
async function translation(page){await page.evaluate(()=>{selectRange(0,DATA.segments.length-1);document.querySelector('#subtitle-translate-btn').click();});await expect(page.locator('#translation-start')).toBeEnabled();await page.locator('#translation-start').click();await expect(page.locator('#translation-jobs input[type=radio]')).toBeEnabled();}
async function selectBatch(page,kind='translation'){
  const root=page.locator(kind==='asr'?'#msw-asr-jobs':'#translation-jobs');
  await root.locator('.msw-result-toggle').first().click();await root.locator('input[type=radio]').first().check();return root;
}
test('translation generates editable candidates only, writes each target explicitly and undo restores one application',async({page})=>{
  await translation(page);expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Hello world');
  await expect(page.locator('#translation-output-mode')).toHaveCount(0);await expect(page.locator('#translation-selected')).toHaveText('当前批次：未选择');
  const list=await selectBatch(page);await list.locator('textarea').fill('手工译文');
  await expect(page.locator('#translation-selected')).toHaveText('当前批次：翻译批次01');
  await page.locator('#translation-apply').click();expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('手工译文');
  await page.locator('#translation-secondary').click();expect(await page.evaluate(()=>DATA.multi_subtitle.tracks[0].segments[0].text)).toBe('手工译文');
  await page.locator('#translation-store').click();expect(await page.evaluate(()=>DATA.msw.subtitle_assets[0].text)).toBe('手工译文');
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.msw.subtitle_assets?.length||0)).toBe(0);
  expect(await page.evaluate(()=>DATA.multi_subtitle.tracks[0].segments[0].text)).toBe('手工译文');
  await page.screenshot({path:join(root,'translation-candidates.png'),fullPage:true});
});
test('candidate input survives polling and reload; all 351 results remain editable',async({page})=>{
  await page.evaluate(()=>{DATA.segments=Array.from({length:351},(_,i)=>({id:'cue-'+i,start:i*100,end:i*100+90,text:'Source '+i}));renderAll();});
  await translation(page);const list=await selectBatch(page);
  const first=list.locator('textarea').first();await first.fill('Draft stays');await first.evaluate(n=>{window.__candidateNode=n;n.setSelectionRange(3,5);});
  // Another submission forces the existing record to receive polling updates.
  await page.evaluate(()=>document.querySelector('#translation-start').click());await expect(page.locator('#translation-history-count')).toHaveText('2');
  expect(await page.evaluate(()=>window.__candidateNode.isConnected)).toBe(true);expect(await page.evaluate(()=>window.__candidateNode.value)).toBe('Draft stays');
  for(let i=0;i<7;i++) {const more=list.locator('.msw-result-more').filter({visible:true}).first();if(await more.count())await more.click();}
  await expect(list.locator('textarea')).toHaveCount(351);await list.locator('textarea').last().fill('Final row edited');
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();await page.evaluate(()=>document.querySelector('#subtitle-translate-btn').click());
  await expect(page.locator('#translation-jobs .msw-result-batch')).toHaveCount(2);
  await page.locator('#translation-jobs .msw-result-toggle').filter({hasText:'翻译批次01'}).click();
  await expect(page.locator('#translation-jobs textarea').first()).toHaveValue('Draft stays');
});
test('ASR can start inside a cue, trim leaves reviewed outside pieces, secondary is independent',async({page})=>{
  await page.evaluate(()=>{MSWE.resolve('time-range').setRange({start:3000,end:5000});});
  await page.evaluate(()=>MSWE.resolve('asr').open('range'));
  await expect(page.locator('#msw-asr-start')).toBeEnabled();await page.locator('#msw-asr-start').click();
  await expect.poll(()=>jobs.length).toBe(1);expect(jobs[0].snapshot.range).toEqual({start:3000,end:5000});
  await page.evaluate(id=>MSWE.resolve('asr').showResult(id),jobs[0].id);
  const strategy=page.getByRole('combobox',{name:'覆盖主字幕策略'});await expect(strategy).toBeVisible();await expect(page.locator('#msw-asr-apply')).toBeHidden();
  await strategy.selectOption('trim');
  await expect.poll(()=>page.evaluate(()=>({rows:DATA.segments.map(c=>[c.start,c.end,!!c.review_required]),message:document.querySelector('#msw-asr-message').textContent}))).toEqual({rows:[[1000,3000,true],[3100,4900,false],[5000,9000,true]],message:'ASR 结果已应用，可一次撤销'});
  await expect(page.locator('.msw-review-badge')).toHaveCount(2);
  await page.locator('#msw-asr-secondary').click();await expect.poll(()=>page.evaluate(()=>DATA.multi_subtitle.tracks[0]?.segments[0].text)).toBe('识别内容');
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.multi_subtitle.tracks.length)).toBe(0);
  await page.evaluate(()=>performUndo());expect(await page.evaluate(()=>DATA.segments.map(c=>c.text))).toEqual(['Hello world']);
  await page.screenshot({path:join(root,'asr-boundary.png'),fullPage:true});
});

test('timeline undo preserves newer candidate edits and a revision reapplies after frame normalization',async({page})=>{
  await translation(page);const list=await selectBatch(page);await page.locator('#translation-apply').click();
  await list.locator('textarea').fill('Newer candidate');await page.evaluate(()=>performUndo());
  await expect(list.locator('textarea')).toHaveValue('Newer candidate');
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Hello world');
  await page.locator('#translation-apply').click();expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Newer candidate');
  await list.locator('textarea').fill('Third revision');await page.locator('#translation-apply').click();
  expect(await page.evaluate(()=>DATA.segments[0].text)).toBe('Third revision');
});

test('English compact result panels keep batch choices, editable rows and destination actions inside the modal',async({page})=>{
  await page.evaluate(()=>localStorage.setItem('mawe.language','en'));
  await page.setViewportSize({width:960,height:700});await page.reload();
  await expect(page.locator('#editor-loading')).toBeHidden();
  await translation(page);const list=await selectBatch(page);
  await expect(list.locator('.msw-result-toggle')).toContainText('Translation batch');
  await expect(page.locator('#translation-selected')).toContainText('Current batch');
  for(const selector of ['#translation-jobs textarea','#translation-apply','#translation-secondary','#translation-store']){
    const rect=await page.locator(selector).boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(960);
    expect(rect.y+rect.height).toBeLessThanOrEqual(700);
  }
  await page.screenshot({path:join(root,'translation-compact-en.png')});
});

test('edited batch and independent destination receipts survive disk save and reload without local drafts',async({page})=>{
  await translation(page);const list=await selectBatch(page);await list.locator('textarea').fill('Saved candidate');
  for(const id of ['translation-apply','translation-secondary','translation-store'])await page.locator('#'+id).click();
  const saved=page.waitForResponse(r=>r.url().endsWith('/api/msw/project')&&r.request().method()==='POST');
  await page.keyboard.press('Escape');await page.keyboard.press('Control+s');
  const savedBody=await (await saved).json();
  expect(savedBody.ok,JSON.stringify(savedBody)).toBe(true);
  const disk=JSON.parse(readFileSync(join(root,'project.mosp'),'utf8'));
  expect(disk.segments[0].text).toBe('Saved candidate');
  expect(disk.multi_subtitle.tracks[0].segments[0].text).toBe('Saved candidate');
  expect(disk.msw.subtitle_assets[0].text).toBe('Saved candidate');
  expect(Object.keys(disk.msw.processing_results[0].applications).sort()).toEqual(['library','main','secondary']);
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('msw.processing.drafts.'))localStorage.removeItem(key);});
  await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();
  await page.evaluate(()=>document.querySelector('#subtitle-translate-btn').click());await selectBatch(page);
  await expect(page.locator('#translation-jobs textarea')).toHaveValue('Saved candidate');
  for(const id of ['translation-apply','translation-secondary','translation-store'])await expect(page.locator('#'+id)).toBeDisabled();
});
