import {test,expect} from '@playwright/test';
import {setup,snap} from './find-unified-fixture.mjs';
setup();
test.beforeEach(async({page})=>page.evaluate(()=>MSWFindEdit.close()));

test('waveform details use physical-track numbering across unequal pairs, moves and undo',async({page},info)=>{
 const project=await snap(page),[main,secondary]=project.subtitles.tracks;
 project.subtitles.cues.push({id:'extra-secondary',track_id:secondary.id,content:{start:500,end:700,text:'Intro secondary',items:[]}});
 Object.assign(project.subtitles.cues.find(c=>c.id==='third-0').content,{start:2500,end:3500,color:{name:'red',value:'#ff0000',start:2500,end:3500}});
 const mainId=project.subtitles.cues.find(c=>c.track_id===main.id&&c.content.start===4000).id;
 const secondaryId=project.subtitles.cues.find(c=>c.track_id===secondary.id&&c.content.start===4000).id;
 await page.evaluate(p=>{applyCanonicalProject(p,'labels.mosp');waveformEditor.settings.hoverDetails=true;waveformEditor.render();},project);
 const before=(await snap(page)).subtitles;
 const mainBlock=page.locator(`.waveform-cue-block[data-cue-id="${mainId}"]`).first(),secondaryBlock=page.locator(`.waveform-cue-block[data-cue-id="${secondaryId}"]`).first();
 await expect(page.locator('#cues-container .index').filter({hasText:/^S1主_2$/})).toHaveCount(1);
 await expect(page.locator('#cues-container .index').filter({hasText:/^S1副_3$/})).toHaveCount(1);
 await expect(mainBlock).toHaveAttribute('title',/\nS1主_2 · /);await expect(secondaryBlock).toHaveAttribute('title',/\nS1副_3 · /);
 expect(await page.evaluate(id=>DATA.segments.findIndex(c=>c.id===id)+1,mainId)).not.toBe(2);
 await mainBlock.hover();await page.screenshot({path:info.outputPath('track-labels.png')});
 await page.evaluate(track=>fixedMove([fixedRef(DATA.segments.find(c=>c.id==='third-0'))],track),main.id);
 await expect(mainBlock).toHaveAttribute('title',/\nS1主_3 · /);
 await expect(page.locator('#cues-container .index').filter({hasText:/^S1主_3$/})).toHaveCount(1);
 await page.evaluate(()=>performUndo());await expect(mainBlock).toHaveAttribute('title',/\nS1主_2 · /);
 expect((await snap(page)).subtitles).toEqual(before);
 await page.evaluate(()=>{waveformEditor.settings.hoverDetails=false;waveformEditor.render();});
 await expect(mainBlock).not.toHaveAttribute('title',/\nS1主_/);
});

test('playhead uses hour time in every refresh path and preserves the frame-mode clock',async({page},info)=>{
 page.on('dialog',dialog=>dialog.accept());
 await page.evaluate(()=>applyCanonicalProject({segments:[{id:'long',start:0,end:93600000,text:'Long timeline',items:[]}]},'clock.mosp'));
 const before=(await snap(page)).subtitles;
 for(const [ms,text] of [[0,'00:00:00.000'],[59999,'00:00:59.999'],[60000,'00:01:00.000'],[3599999,'00:59:59.999'],[3600000,'01:00:00.000'],[3633622,'01:00:33.622'],[90033622,'25:00:33.622']]){
  await page.evaluate(ms=>{player.currentTime=ms/1000;update();},ms);await expect(page.locator('#now')).toHaveText(text);
  await page.evaluate(()=>updatePlaybackFrame());await expect(page.locator('#now')).toHaveText(text);
  await page.evaluate(ms=>MSWE.resolve('processing-host').refreshAudioPlayback(ms),ms);await expect(page.locator('#now')).toHaveText(text);
 }
 expect((await snap(page)).subtitles).toEqual(before);
 await page.evaluate(()=>{player.currentTime=3633.622;update();waveformEditor.updatePlayback();});await page.screenshot({path:info.outputPath('hour-playhead.png')});
 await page.setViewportSize({width:760,height:760});await expect(page.locator('#now')).toBeInViewport();
 await page.evaluate(()=>setTimelineTimebase({unit:'frames',fps:25}));
 await page.evaluate(()=>{player.currentTime=3633.64;update();});await expect(page.locator('#now')).toHaveText('01:00:33:16');
 await page.evaluate(()=>setTimelineTimebase({unit:'milliseconds'}));await expect(page.locator('#now')).toHaveText('01:00:33.640');
});
