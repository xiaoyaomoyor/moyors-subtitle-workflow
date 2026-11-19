import {test,expect} from '@playwright/test';
import {setup,snap} from './find-unified-fixture.mjs';
import {generateWaveformPayload} from './helpers.mjs';

setup();
test.beforeEach(async({page})=>{
  await page.evaluate(()=>MSWFindEdit.close());
  const project=await snap(page);
  project.waveform=generateWaveformPayload(60000);
  project.subtitles.cues.push({id:'late',track_id:project.subtitles.tracks[0].id,content:{start:21000,end:22000,text:'Later subtitle',items:[]}});
  project.review_markers={schema:'msw.review.v1',items:[
    {id:'early-mark',start_ms:1500,name:'Early',note:'',color:'#e7b35a',status:'pending'},
    {id:'late-mark',start_ms:21500,end_ms:23500,name:'Later',note:'',color:'#61a7fa',status:'pending'},
  ]};
  await page.evaluate(project=>{
    applyCanonicalProject(project,'reuse.mosp');
    waveformEditor.settings.visibleSeconds=10;waveformEditor.setMode('basic');
    waveformEditor.basicWindowStartMs=0;waveformEditor.render();
  },project);
});

test('single-row navigation retains its canvas and base nodes with no backing-store resize',async({page},info)=>{
  const result=await page.evaluate(()=>{
    const wave=waveformEditor,row=wave.renderedRows[0],canvas=row.querySelector('canvas');
    const selectors=['canvas','.waveform-row-time','.waveform-playhead','.waveform-pointer-line','.waveform-split-preview'];
    const nodes=selectors.map(selector=>row.querySelector(selector));
    let created=0,resized=0;
    const create=wave.createRow;wave.createRow=function(...args){created++;return create.apply(this,args);};
    const observer=new MutationObserver(()=>{});observer.observe(canvas,{attributes:true,attributeFilter:['width','height']});
    const times=[];
    try {
      for(let i=0;i<60;i++){
        wave.basicWindowStartMs=(i%30)*1000;
        const start=performance.now();wave.renderBasic();times.push(performance.now()-start);
      }
      resized=observer.takeRecords().length;
    } finally {wave.createRow=create;observer.disconnect();}
    times.sort((a,b)=>a-b);
    return {created,resized,sameRow:wave.renderedRows[0]===row,
      sameNodes:selectors.every((selector,i)=>wave.renderedRows[0].querySelector(selector)===nodes[i]),
      medianMs:times[30],p95Ms:times[57],rows:wave.content.querySelectorAll('.waveform-row').length};
  });
  await info.attach('single-row-measurement',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  console.log('single-row-measurement',JSON.stringify(result));
  expect(result).toMatchObject({created:0,resized:0,sameRow:true,sameNodes:true,rows:1});
});

test('reused rows refresh cues, reviews, time labels and pointer coordinates after wheel scrolling',async({page})=>{
  const before=(await snap(page)).subtitles;
  const row=page.locator('.waveform-row[data-basic="true"]');
  await expect(row.locator('[data-review-id="early-mark"]')).toBeVisible();
  await page.evaluate(()=>{
    window.reusedRow=waveformEditor.renderedRows[0];
    waveformEditor.basicWindowStartMs=20000;waveformEditor.renderBasic();
    // This static fixture has no media. Observe the real click handler's seek
    // request; playback itself is covered by the media-backed boundary suite.
    const seek=waveformEditor.options.seek;
    waveformEditor.options.seek=(seconds,...args)=>{window.lastSeek=seconds;return seek(seconds,...args);};
  });
  await expect(row).toHaveAttribute('data-start-ms','20000');
  await expect(row.locator('[data-review-id="early-mark"]')).toHaveCount(0);
  await expect(row.locator('[data-review-id="late-mark"]')).toBeVisible();
  await expect(row.locator('.waveform-cue-label')).toHaveText(['Later subtitle']);
  await expect(row.locator('.waveform-row-time')).toContainText('00:20.000');
  const box=await row.boundingBox();
  await page.mouse.click(box.x+box.width*.5,box.y+box.height*.4);
  expect(await page.evaluate(()=>window.lastSeek)).toBeCloseTo(25,1);
  const startBeforeWheel=await row.getAttribute('data-start-ms');
  await page.mouse.wheel(0,200);
  await expect.poll(()=>row.getAttribute('data-start-ms')).not.toBe(startBeforeWheel);
  expect(await page.evaluate(()=>waveformEditor.renderedRows[0]===window.reusedRow)).toBe(true);
  expect((await snap(page)).subtitles).toEqual(before);
});

test('time-window changes cancel stale hover callbacks; zoom, resize and mode switches stay current',async({page})=>{
  await page.evaluate(()=>{
    const wave=waveformEditor,row=wave.renderedRows[0];window.reusedCanvas=row.querySelector('canvas');
    wave.options.getHoverSeekPreview=()=>true;
    wave.scheduleHoverSeekPreview({clientX:200,clientY:200,buttons:0},row);
    wave.basicWindowStartMs=20000;wave.renderBasic();
  });
  expect(await page.evaluate(()=>({frame:waveformEditor.hoverSeekPreviewFrame,event:waveformEditor.hoverSeekPreviewLastEvent}))).toEqual({frame:0,event:null});
  await page.evaluate(()=>{waveformEditor.settings.visibleSeconds=2;waveformEditor.render();});
  expect(await page.evaluate(()=>waveformEditor.renderedRows[0].querySelector('canvas')===window.reusedCanvas)).toBe(true);
  await expect(page.locator('.waveform-row')).toHaveAttribute('data-end-ms','22000');
  await page.setViewportSize({width:960,height:900});
  await expect.poll(()=>page.evaluate(()=>{
    const row=waveformEditor.renderedRows[0];return row.querySelector('canvas').width===Math.round(row.clientWidth*Math.min(2,devicePixelRatio));
  })).toBe(true);
  await page.evaluate(()=>{waveformEditor.settings.secondsPerRow=10;waveformEditor.setMode('multi');waveformEditor.render();});
  await expect(page.locator('.waveform-row[data-basic="true"]')).toHaveCount(0);
  await page.evaluate(()=>{waveformEditor.setMode('basic');waveformEditor.render();});
  await expect(page.locator('.waveform-row')).toHaveCount(1);
  await expect(page.locator('.waveform-row')).toHaveAttribute('data-basic','true');
});

test('pan refreshes MSW audio lanes, gaps and selected review guides without duplicates',async({page},info)=>{
  const project=await snap(page),assetId='audio-'+'a'.repeat(32);
  // Export intentionally omits rebuildable waveform samples; restore the
  // synthetic media duration when loading this second fixture.
  project.waveform=generateWaveformPayload(60000);
  project.gap_remove={schema:'moy.asr.gap_remove.v1',detector:'audio_gate',
    gaps:[{start:7000,end:8000,removed:true},{start:27000,end:28000,removed:true}]};
  project.msw={...project.msw,schema:'msw.editor.v1',project_id:'row-reuse-audio',
    assets:[{id:assetId,kind:'audio',sample_rate:8000,sample_count:16000,channels:1,byte_size:32044,
      path:'msw-'+'b'.repeat(24)+'.assets/audio/'+assetId+'.wav',sha256:'c'.repeat(64),job_id:'test',
      source_ref:{key:'a0',id:'a0',text:'Voice',start:1000,end:2000,track_id:null},
      generation:{provider:'test',model:'test',voice:'test',language_type:'Auto',display_text:'Voice',spoken_text:'Voice'}}],
    audio_tracks:[{id:'voice',name:'配音',gain_db:0,muted:true}],audio_settings:{gap_policy:'follow'},
    audio_clips:[1000,21000].map((start_ms,i)=>({id:'clip-'+i,asset_id:assetId,label:'Voice '+i,
      playback_rate:1,gain_db:0,track_id:'voice',start_ms,source_in_sample:0,source_out_sample:16000,muted:true}))};
  await page.evaluate(project=>{
    applyCanonicalProject(project,'reuse-audio.mosp');
    waveformEditor.settings.visibleSeconds=10;waveformEditor.basicWindowStartMs=0;waveformEditor.render();
    window.reusedRow=waveformEditor.renderedRows[0];
  },project);
  await expect(page.locator('.msw-audio-clip')).toHaveAttribute('data-clip-id','clip-0');
  await page.evaluate(()=>{waveformEditor.basicWindowStartMs=20000;waveformEditor.renderBasic();MSWE.resolve('reviews').open();});
  await page.locator('.msw-review-row[data-id="late-mark"] .msw-review-entry').click();
  // Keep the selected marker while changing the displayed window again.
  await page.evaluate(()=>{waveformEditor.basicWindowStartMs=20500;waveformEditor.renderBasic();});
  const row=page.locator('.waveform-row');
  await expect(row.locator('.msw-audio-clip')).toHaveAttribute('data-clip-id','clip-1');
  await expect(row.locator('.msw-audio-lanes')).toHaveCount(1);
  await expect(row.locator('.waveform-gap-block')).toHaveCount(1);
  await expect(row.locator('.msw-review-guide')).toHaveCount(2);
  await expect(page.locator('.waveform-track-heads-column')).toHaveCount(1);
  expect(await page.evaluate(()=>waveformEditor.renderedRows[0]===window.reusedRow)).toBe(true);
  const geometry=await row.evaluate(row=>{
    const audio=row.querySelector('.msw-audio-clip'),gap=row.querySelector('.waveform-gap-block');
    return {audioLeft:parseFloat(audio.style.left),gapLeft:parseFloat(gap.style.left),
      guides:[...row.querySelectorAll('.msw-review-guide')].map(line=>parseFloat(line.style.left))};
  });
  expect(geometry).toEqual({audioLeft:5,gapLeft:65,guides:[10,30]});
  await page.screenshot({path:info.outputPath('reused-row-msw-layers.png')});
});
