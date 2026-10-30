// Opt-in local acceptance: an explicit real project is copied before any writes.
// Personal projects, media, traces and timings stay in the ignored output tree.
import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync,statSync,utimesSync} from 'node:fs';
import {resolve,dirname,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {disableOnboarding,findFreePort,startServer} from './helpers.mjs';

const input=process.env.MSW_E2E_LONG_PROJECT;
const root=resolve(process.env.MSW_E2E_LONG_OUTPUT||'output/find-edit-long');
const hash=b=>createHash('sha256').update(b).digest('hex');
let media,source,sourceHash,server,projectPath;
const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
const unchangedFields=p=>p.subtitles.cues.map(c=>{const content={...c.content};delete content.text;delete content.items;delete content._dirty;return {...c,content};});
async function flush(page){await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}

test.beforeAll(async()=>{
 if(!input)return;
 source=JSON.parse(readFileSync(input,'utf8'));sourceHash=hash(readFileSync(input));
 if(!source.subtitles?.cues?.length)throw Error('Long acceptance requires a v4 project');
 const original=resolve(dirname(input),source.media),cacheDir=resolve('output/find-edit-long-media');mkdirSync(cacheDir,{recursive:true});
 // Copy the media once across before/after runs, preserving its cache identity.
 const identity=hash(original).slice(0,12);media=join(cacheDir,identity+'.mp4');
 const info=statSync(original);
 if(!existsSync(media)||statSync(media).size!==info.size){copyFileSync(original,media);utimesSync(media,info.atime,info.mtime);}
 const candidates=[original+'.quapeaks',join(dirname(original),basename(original,'.mp4')+'_msw',basename(original)+'.quapeaks')];
 const cache=candidates.find(existsSync);
 if(cache){copyFileSync(cache,media+'.quapeaks');const s=statSync(cache);utimesSync(media+'.quapeaks',s.atime,s.mtime);}
 mkdirSync(root,{recursive:true});process.env.MAW_ENV_FILE=join(root,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(root,'settings');
 process.env.FFMPEG_PATH=process.env.MSW_TEST_FFMPEG||'';
 projectPath=join(root,'test.mosp');writeFileSync(projectPath,JSON.stringify({...source,media}));
 server=await startServer(projectPath,media,await findFreePort(),{loadWaveform:true});
});
test.afterAll(async()=>{await server?.stop();if(input)expect(hash(readFileSync(input))).toBe(sourceHash);});

test('real long project: search, editing, undo, responsiveness and round trip',async({page,context},info)=>{
 test.skip(!input,'Set MSW_E2E_LONG_PROJECT to an explicit personal fixture');test.setTimeout(300000);
 const errors=[],metrics={};page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await disableOnboarding(page);await page.setViewportSize({width:1600,height:1000});
 await page.goto(server.url,{timeout:90000});await expect(page.locator('#editor-loading')).toBeHidden({timeout:90000});
 await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2,null,{timeout:90000});
 await page.evaluate(()=>{updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false,clickBehavior:'select-only'});player.pause();
  waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.render();
  window.longSamples=[];new PerformanceObserver(list=>longSamples.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
 });
 await page.waitForFunction(()=>!projectSaveInFlight&&!projectCheckpointInFlight);
 const before=await snapshot(page);metrics.fixture={cues:before.subtitles.cues.length,tracks:before.subtitles.tracks.length,bindings:before.subtitles.bindings.length};
 const measure=async(name,action)=>{await flush(page);const start=await page.evaluate(()=>performance.now());await action();await flush(page);
  metrics[name]=await page.evaluate(start=>({elapsed:performance.now()-start,longTasks:longSamples.filter(e=>e.start>=start).map(e=>e.ms)}),start);
  writeFileSync(join(root,'metrics.json'),JSON.stringify(metrics,null,2));console.log(name,JSON.stringify(metrics[name]));};
 const countFor=text=>before.subtitles.cues.reduce((n,c)=>n+Number(c.content.text.toLowerCase().includes(text.toLowerCase())),0);
 const query=async(text)=>{await page.locator('#find-edit-query').fill(text);await page.waitForFunction(n=>document.getElementById('find-edit-count').textContent.startsWith(n+' 条 ·'),countFor(text));};
 await measure('firstSearch',async()=>{await page.keyboard.press('Control+f');await query('the');});
 for(const text of ['you','我','the'])await measure('search_'+text,()=>query(text));
 await measure('rapidSearch',async()=>{await page.locator('#find-edit-query').fill('the');await page.locator('#find-edit-query').fill('MSW_missing_82716');await page.waitForFunction(()=>document.getElementById('find-edit-count').textContent==='0 条 · 已选 0');});
 expect(await page.locator('.msw-search-hit').count()).toBe(0);
 await query('the');expect(await page.locator('.find-unified-row').count()).toBeLessThan(30);
 await page.locator('#find-edit-panel').evaluate(n=>{n.style.left='10px';n.style.top='100px';n.style.width='470px';n.style.height='620px';});
 await page.locator('[data-locate]').first().click();await page.waitForFunction(()=>MSWSubtitleRenderer.status==='libass'&&!MSWSubtitleRenderer.pending,null,{timeout:60000});
 const originalText=await page.locator('#find-edit-rows textarea').first().inputValue();
 await page.locator('#find-edit-rows textarea').first().fill(originalText+' [checked]');
 const history=await page.evaluate(()=>editorHistory.undoLength());
 await measure('singleEdit',async()=>{await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();await expect(page.locator('#find-edit-message')).toContainText('已修改');});
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 const single=await snapshot(page);expect(unchangedFields(single)).toEqual(unchangedFields(before));expect(single.subtitles.bindings).toEqual(before.subtitles.bindings);
 await measure('previewSettled',async()=>{await page.waitForFunction(()=>!MSWSubtitleRenderer.pending&&MSWSubtitleRenderer.geometry.some(c=>c.text.includes('[checked]')),null,{timeout:60000});});
 await measure('singleUndo',()=>page.evaluate(()=>performUndo()));expect((await snapshot(page)).subtitles).toEqual(before.subtitles);

 // Replace the complete text of every non-empty cue once, preserving original text.
 await page.locator('#find-edit-regex').check();
 await page.locator('#find-edit-query').fill('[\\s\\S]+');await page.locator('#find-edit-replace-enabled').check();
 await page.locator('#find-edit-replacement').fill('$& [MSW]');await expect(page.locator('#find-edit-apply')).toBeEnabled();
 const batchHistory=await page.evaluate(()=>editorHistory.undoLength()),cdp=await context.newCDPSession(page);
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 await measure('replaceAll',async()=>{await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();await page.waitForFunction(()=>document.getElementById('find-edit-message').textContent.startsWith('已修改'));});
 const profile=await cdp.send('Profiler.stop');writeFileSync(join(root,'replace.cpuprofile'),JSON.stringify(profile.profile));await cdp.detach();
 const replaced=await snapshot(page);expect(replaced.subtitles.cues.map(c=>c.content.text)).toEqual(before.subtitles.cues.map(c=>c.content.text?c.content.text+' [MSW]':c.content.text));
 expect(replaced.subtitles.bindings).toEqual(before.subtitles.bindings);expect(unchangedFields(replaced)).toEqual(unchangedFields(before));
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(batchHistory+1);
 metrics.history=await page.evaluate(()=>({kind:editorHistory.peekUndo().kind,bytes:JSON.stringify(editorHistory.peekUndo()).length}));
 await measure('batchUndo',()=>page.evaluate(()=>performUndo()));expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await measure('batchRedo',()=>page.evaluate(()=>performRedo()));expect((await snapshot(page)).subtitles).toEqual(replaced.subtitles);
 await page.evaluate(()=>performUndo());

 await measure('clearSearch',()=>page.locator('#find-edit-query').fill(''));await expect(page.locator('#find-edit-count')).toContainText(`${before.subtitles.cues.length} 条 ·`);
 expect(await page.locator('#find-edit-rows textarea').count()).toBeLessThan(30);
 await measure('continuousTyping',()=>page.locator('#find-edit-rows textarea').first().pressSequentially(' 校对',{delay:30}));
 await page.locator('[data-reset]:visible').first().click();
 await page.locator('#find-tidy-prefix').check();
 await measure('tidyPreview',async()=>{await page.locator('#find-tidy-prefix-text').fill('MSW: ');await expect(page.locator('#find-edit-apply')).toBeEnabled();});
 await measure('tidyApply',()=>page.locator('#find-edit-apply').click());
 expect((await snapshot(page)).subtitles.cues.every(c=>c.content.text.startsWith('MSW: '))).toBe(true);
 await page.evaluate(()=>performUndo());expect((await snapshot(page)).subtitles).toEqual(before.subtitles);

 await page.locator('#find-edit-regex').uncheck();await query('the');
 await page.evaluate(()=>{player.currentTime=1;waveformEditor.scroll.scrollTop=0;waveformEditor.renderMultiVisible(true);return player.play();});
 const playing=await page.evaluate(()=>player.currentTime);
 await measure('searchWhilePlaying',()=>query('you'));expect(await page.evaluate(()=>!player.paused&&player.currentTime>0)).toBe(true);
 const block=page.locator('.waveform-cue-block[data-track="main"]').filter({visible:true}).first();
 await measure('rightClickWhileSearching',async()=>{await block.click({button:'right'});await expect(page.locator('#ctxmenu')).toBeVisible();});
 await page.evaluate(()=>{ctxmenu.classList.remove('show');player.pause();});
 metrics.playback={start:playing,end:await page.evaluate(()=>player.currentTime)};
 await page.locator('#find-edit-close').click();expect(await page.locator('.msw-search-hit').count()).toBe(0);
 await page.screenshot({path:info.outputPath('long-project.png')});
 metrics.errors=errors;writeFileSync(join(root,'metrics.json'),JSON.stringify(metrics,null,2));expect(errors).toEqual([]);
});

test('real long project: scoped edits, locked tracks, conflict, drag and disk exports',async({page},info)=>{
 test.skip(!input,'Set MSW_E2E_LONG_PROJECT to an explicit personal fixture');test.setTimeout(300000);
 const errors=[],report={};page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await disableOnboarding(page);await page.setViewportSize({width:1600,height:1000});
 await page.goto(server.url,{timeout:90000});await expect(page.locator('#editor-loading')).toBeHidden({timeout:90000});
 await page.waitForFunction(()=>window.MSWSubtitleStyle?.ready&&player.readyState>=2,null,{timeout:90000});
 await page.evaluate(()=>{updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false,clickBehavior:'select-only',exportSpeakerLabels:false,exportStartAtZero:false});player.pause();});
 const before=await snapshot(page),tracks=before.subtitles.tracks,chosen=before.subtitles.cues.filter(c=>c.track_id===tracks[0].id&&!c.content.disabled&&c.content.text.trim()).slice(0,3).map(c=>c.id);
 report.fixture={cues:before.subtitles.cues.length,tracks:tracks.length,bindings:before.subtitles.bindings.length};
 await page.evaluate(ids=>MSWFindEdit.open({view:'tidy',ids}),chosen);
 await page.locator('#find-tidy-prefix').check();await page.locator('#find-tidy-prefix-text').fill('验收 ');await expect(page.locator('#find-edit-apply')).toBeEnabled();
 await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();const scoped=await snapshot(page);
 expect(scoped.subtitles.cues.filter((c,i)=>c.content.text!==before.subtitles.cues[i].content.text).map(c=>c.id)).toEqual(chosen);
 expect(scoped.subtitles.bindings).toEqual(before.subtitles.bindings);expect(unchangedFields(scoped)).toEqual(unchangedFields(before));
 await page.evaluate(()=>performUndo());expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await page.evaluate(id=>fixedUpdateTrack(id,{locked:true}),tracks[0].id);await page.locator('#find-tidy-prefix').check();
 await expect(page.locator('#find-edit-message')).toContainText('跳过 3 条锁定字幕');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.evaluate(()=>performUndo());await page.locator('#find-tidy-prefix').uncheck();
 const first=page.locator('#find-edit-rows textarea').first();await first.fill('Pending conflict');
 await page.locator('#find-edit-close').click();await page.keyboard.press('Control+f');await expect(first).toHaveValue('Pending conflict');
 await page.evaluate(id=>{const row=layerCore.tracks(DATA).flatMap(s=>s.segments).find(c=>c.id===id);window.longOldText=row.text;row.text='Changed elsewhere';waveformEditor.refreshCueOverlay();MSWFindEdit.changed();},chosen[0]);
 await expect(page.locator('#find-edit-message')).toContainText('目标字幕已改变');await expect(page.locator('#find-edit-apply')).toBeDisabled();
 await page.locator('[data-reset]:visible').first().click();
 await page.evaluate(id=>{const row=layerCore.tracks(DATA).flatMap(s=>s.segments).find(c=>c.id===id);row.text=window.longOldText;waveformEditor.refreshCueOverlay();MSWFindEdit.changed();},chosen[0]);
 await page.locator('#find-edit-close').click();

 // A waveform drag must keep search available and preserve the bound partner.
 const pair=before.subtitles.bindings.find(b=>chosen.includes(b.source_id));
 await page.evaluate(id=>{player.currentTime=1;waveformEditor.settings.mode='multi';waveformEditor.settings.secondsPerRow=10;waveformEditor.render();waveformEditor.scroll.scrollTop=0;waveformEditor.renderMultiVisible(true);selectOnly(DATA.segments.findIndex(c=>c.id===id));},chosen[0]);
 const dragBefore=await snapshot(page),block=page.locator(`.waveform-cue-block[data-cue-id="${chosen[0]}"]`).first(),box=await block.boundingBox();
 expect(box).toBeTruthy();const h=await page.evaluate(()=>editorHistory.undoLength());
 await page.mouse.move(box.x+Math.min(box.width/2,70),box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+Math.min(box.width/2,70)+10,box.y+box.height/2,{steps:6});await page.mouse.up();
 const dragAfter=await snapshot(page),moved=dragAfter.subtitles.cues.find(c=>c.id===chosen[0]),old=dragBefore.subtitles.cues.find(c=>c.id===chosen[0]);
 expect(moved.content.start).not.toBe(old.content.start);
 if(pair){const a=dragAfter.subtitles.cues.find(c=>c.id===pair.target_id),b=dragBefore.subtitles.cues.find(c=>c.id===pair.target_id);expect(a.content.start-b.content.start).toBe(moved.content.start-old.content.start);}
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(h+1);await page.evaluate(()=>performUndo());expect((await snapshot(page)).subtitles).toEqual(dragBefore.subtitles);
 report.drag={deltaMs:moved.content.start-old.content.start,bound:!!pair};

 await page.evaluate(ids=>MSWFindEdit.open({view:'edit',ids}),chosen);
 await page.locator('#find-edit-rows textarea').first().fill('Long project validation\n长工程校对');await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();
 const expected=await snapshot(page);await page.locator('#find-edit-close').click();
 await page.waitForFunction(()=>!projectSaveInFlight&&!projectCheckpointInFlight);
 const saveStart=Date.now();expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);report.saveMs=Date.now()-saveStart;
 expect(JSON.parse(readFileSync(projectPath,'utf8')).subtitles).toEqual(expected.subtitles);
 await page.reload();await expect(page.locator('#editor-loading')).toBeHidden({timeout:90000});expect((await snapshot(page)).subtitles).toEqual(expected.subtitles);
 await page.waitForFunction(()=>MSWSubtitleStyle.ready);
 await page.evaluate(()=>{window.longSaves=[];window.showSaveFilePicker=async options=>({name:options.suggestedName,createWritable:async()=>({write:async b=>longSaves.push({name:options.suggestedName,text:await b.text()}),close:async()=>{}})});MSWSubtitleExport.open('srt');});
 await page.locator('#subtitle-export-mode').selectOption('original');
 await page.locator('#subtitle-export-start').click();await expect(page.locator('#subtitle-export-message')).toContainText('已导出',{timeout:60000});
 const srt=await page.evaluate(()=>longSaves.at(-1).text),eligible=expected.subtitles.cues.filter(c=>!c.content.disabled&&c.content.text.trim()&&tracks.find(t=>t.id===c.track_id).enabled);
 const timeMs=s=>{const [h,m,seconds,ms]=s.split(/[:,]/).map(Number);return ((h*60+m)*60+seconds)*1000+ms;};
 const payloads=srt.trim().split(/\r?\n\r?\n/).map(part=>{const lines=part.split(/\r?\n/),[a,b]=lines[1].split(' --> ');return JSON.stringify([timeMs(a),timeMs(b),lines.slice(2).join('\n')]);});
 expect(payloads.sort()).toEqual(eligible.map(c=>JSON.stringify([c.content.start,c.content.end,c.content.text])).sort());report.srtCues=payloads.length;writeFileSync(join(root,'verified.srt'),srt);
 await page.locator('#subtitle-export-format').selectOption('ass');const assStart=Date.now();await page.locator('#subtitle-export-start').click();await expect.poll(()=>page.evaluate(()=>longSaves.at(-1)?.name.endsWith('.ass')),{timeout:90000}).toBe(true);
 const ass=await page.evaluate(()=>longSaves.at(-1).text);writeFileSync(join(root,'verified.ass'),ass);report.assMs=Date.now()-assStart;
 const plain=ass.replace(/\{[^}]*\}/g,'').replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ');
 const missing=eligible.filter(c=>!plain.includes(c.content.text));report.assWrappedBodies=missing.length;
 // Font switches, explicit wrapping and name prefixes can split text, but the
 // complete visible body must occur after whitespace normalization.
 const compact=plain.replace(/\s/g,'');report.assMissingBodies=missing.filter(c=>!compact.includes(c.content.text.replace(/\s/g,''))).map(c=>c.id);expect(report.assMissingBodies).toEqual([]);
 await page.locator('#subtitle-export-close').click();
 await page.evaluate(()=>document.getElementById('video-export-btn').click());await page.locator('#video-export-range').selectOption('custom');
 await page.locator('#video-export-burn-subtitles').selectOption('both');
 await page.locator('#video-export-start-time').fill('00:00.000');await page.locator('#video-export-end-time').fill('00:02.000');await page.locator('#video-export-end-time').press('Tab');
 const submitted=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/audio-exports'));await page.locator('#video-export-start').click();
 const job=(await(await submitted).json()).job;report.videoJob=job.id;
 const downloadButton=page.locator(`#video-export-jobs [data-job-id="${job.id}"]`).getByRole('button',{name:'下载 MP4',exact:true});await expect(downloadButton).toBeVisible({timeout:120000});
 const downloaded=page.waitForEvent('download');await downloadButton.click();const file=await downloaded;const target=join(root,'verified.mp4');await file.saveAs(target);
 const probe=process.env.MSW_TEST_FFMPEG?join(process.env.MSW_TEST_FFMPEG,process.platform==='win32'?'ffprobe.exe':'ffprobe'):'ffprobe';
 report.video=JSON.parse(execFileSync(probe,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name','-of','json',target],{encoding:'utf8',windowsHide:true}));expect(Number(report.video.format.duration)).toBeCloseTo(2,1);
 expect(errors).toEqual([]);report.errors=errors;writeFileSync(join(root,'verification.json'),JSON.stringify(report,null,2));await page.screenshot({path:info.outputPath('verified-export.png')});
});
