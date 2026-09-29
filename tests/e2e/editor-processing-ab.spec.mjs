import {test,expect} from '@playwright/test';
import {writeFileSync,statSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,generateWav,generateWaveformPayload,makeTempDir,startServer,findFreePort,clickMenubarItem} from './helpers.mjs';

let server;
test.beforeEach(async({page})=>{
  const dir=makeTempDir('processing-ab');
  process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'local');
  const media=generateWav(join(dir,'source.wav'),30),info=statSync(media);
  await page.route('**/asset-audio?**',route=>route.fulfill({contentType:'audio/wav',body:readFileSync(media)}));
  const waveform=generateWaveformPayload(30000);waveform.audio_track=0;waveform.source={name:'source.wav',size:info.size,modified_ms:Math.floor(info.mtimeMs)};
  const path=join(dir,'project.mosp');writeFileSync(path,JSON.stringify({media,segments:[],waveform}));
  await disableOnboarding(page);
  await page.addInitScript(()=>{
    localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false}));
    window.__mediaNodes=[];
    const create=AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource=function(player){
      const node=create.call(this,player),connect=node.connect.bind(node),record={player,node,context:this};
      node.connect=(target,...args)=>{record.gain=target;return connect(target,...args);};
      window.__mediaNodes.push(record);return node;
    };
  });
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(path,media,await findFreePort());await page.goto(server.url);
  await expect(page.locator('#editor-loading')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#player').readyState)).toBeGreaterThan(0);
});

async function prepareVolumeClips(page){
  await page.evaluate(()=>{
    const id='audio-'+ 'a'.repeat(32);
    const asset={id,kind:'audio',path:`msw-${'b'.repeat(24)}.assets/audio/${id}.wav`,sha256:'c'.repeat(64),
      sample_rate:24000,channels:1,sample_count:24000,byte_size:48044,job_id:'synthetic-job',
      generation:{provider:'imported',model:'',voice:'',language_type:'',display_text:'Synthetic',spoken_text:''},
      source_ref:{key:'synthetic',id:'synthetic',text:'',start:0,end:1000}};
    MSWE.resolve('processing-host').commitAudio('fixture',ext=>{
      ext.assets=[asset];ext.audio_tracks=[{id:'voice-1',name:'Voice',gain_db:0,muted:false}];
      ext.audio_clips=[0,2000].map((start,i)=>({...MSWAudio.create(asset,'voice-1',start,'clip-'+i),gain_db:i?-6:0}));
    });MSWE.resolve('audio-timeline').selectAllClips();
  });
  await clickMenubarItem(page,'媒体','audio-actions-open');
}

test('mixed clip slider previews without mutation, commits once, and Escape restores',async({page},info)=>{
  await prepareVolumeClips(page);
  await expect(page.locator('#audio-actions-gain-output')).toHaveText('多个音量');
  const before=await page.evaluate(()=>editorHistory.undoLength());
  const slider=page.locator('#audio-actions-gain'),box=await slider.boundingBox();
  await page.mouse.move(box.x+box.width*.8,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.7,box.y+box.height/2,{steps:5});
  expect(await page.evaluate(()=>DATA.msw.audio_clips.map(c=>c.gain_db))).toEqual([0,-6]);
  expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(before);
  await page.mouse.up();
  await expect.poll(()=>page.evaluate(()=>editorHistory.undoLength())).toBe(before+1);
  const gains=await page.evaluate(()=>DATA.msw.audio_clips.map(c=>c.gain_db));expect(gains[0]).toBe(gains[1]);
  await page.evaluate(()=>MSWE.resolve('processing-host').undo());
  expect(await page.evaluate(()=>DATA.msw.audio_clips.map(c=>c.gain_db))).toEqual([0,-6]);
  await page.evaluate(()=>MSWE.resolve('audio-timeline').selectAllClips());
  await page.mouse.move(box.x+box.width*.4,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width*.6,box.y+box.height/2);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('#audio-actions-panel')).toBeVisible();
  expect(await page.evaluate(()=>DATA.msw.audio_clips.map(c=>c.gain_db))).toEqual([0,-6]);
  expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(before);
  await page.screenshot({path:info.outputPath('audio-volume-panel.png')});
  await page.setViewportSize({width:900,height:600});
  await page.evaluate(()=>{document.documentElement.dataset.theme='light';MSWE_I18N.applyLanguage('en',false);});
  await expect(page.locator('#audio-actions-gain-title')).toContainText('Selected clip volume');
  await expect.poll(()=>page.locator('#audio-actions-panel').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('audio-volume-light-en.png')});
});

test('source slider supports precise values, undo, reset without unmuting and rebind',async({page})=>{
  await clickMenubarItem(page,'媒体','audio-actions-open');
  const number=page.locator('#audio-actions-source-gain-value');
  await number.fill('6');await number.press('Enter');
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').sourceGainDb())).toBe(6);
  await expect(page.locator('#audio-actions-source-gain-output')).toHaveText('200%');
  await page.evaluate(()=>MSWE.resolve('processing-host').undo());
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').sourceGainDb())).toBe(0);
  await page.evaluate(()=>MSWE.resolve('processing-host').redo());
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').sourceGainDb())).toBe(6);
  await page.evaluate(()=>{player.muted=true;});await page.locator('#audio-actions-source-gain-reset').click();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').sourceGainDb())).toBe(0);
  expect(await page.evaluate(()=>player.muted)).toBe(true);
  await number.fill('-60');await number.press('Enter');
  await expect(page.locator('#audio-actions-source-gain-output')).toHaveText('0.1%');
  await page.evaluate(()=>resetLoadedMedia());
  await expect(number).toBeDisabled();
});
test.afterEach(async()=>{await server?.stop();server=null;});

test('initial default audio registration cannot cancel a pending gain edit',async({page})=>{
  let releaseContext,markRequested;
  const gate=new Promise(resolve=>releaseContext=resolve),requested=new Promise(resolve=>markRequested=resolve);
  await page.route('**/media-context?*',async route=>{markRequested();await gate;await route.continue();});
  await page.reload();await requested;
  await expect(page.locator('#editor-loading')).toBeHidden();
  expect(await page.evaluate(()=>MSWE.resolve('media').current)).toBeNull();
  await page.evaluate(()=>{
    const resume=AudioContext.prototype.resume;
    const gate=new Promise(resolve=>window.__releaseGainResume=resolve);
    AudioContext.prototype.resume=function(){return gate.then(()=>resume.call(this));};
  });
  await clickMenubarItem(page,'媒体','audio-actions-open');
  const before=await page.evaluate(()=>editorHistory.undoLength());
  const number=page.locator('#audio-actions-source-gain-value');
  await number.fill('6');await number.press('Enter');
  releaseContext();
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('media').current?.audio_index)).toBe(0);
  await page.evaluate(()=>window.__releaseGainResume());
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').sourceGainDb())).toBe(6);
  await expect.poll(()=>page.evaluate(()=>editorHistory.undoLength())).toBe(before+1);
  await expect(page.locator('#audio-actions-source-gain-output')).toHaveText('200%');
  await page.evaluate(()=>MSWE.resolve('processing-host').undo());
  await expect.poll(()=>page.evaluate(()=>MSWE.resolve('audio-timeline').sourceGainDb())).toBe(0);
  await expect(page.locator('#audio-actions-source-gain-output')).toHaveText('100%');
});

test('source gain amplifies the current player after replacement and rollback',async({page})=>{
  const result=await page.evaluate(async()=>{
    const api=MSWE.resolve('audio-timeline'),url=player.currentSrc;
    await api.setSourceGainDb(0);
    const first=player;
    resetLoadedMedia();
    await loadMediaFile({url,name:'synthetic.mp4',type:'video/mp4'},{localOnly:true,previewOnly:true});
    const current=player;current.volume=1;current.muted=false;current.loop=true;
    await api.setSourceGainDb(0);await current.play();
    const record=__mediaNodes.find(r=>r.player===current),analyser=record.context.createAnalyser();
    analyser.fftSize=2048;record.gain.connect(analyser);
    async function rms(db){
      await api.setSourceGainDb(db);
      const start=record.context.currentTime;
      await new Promise(resolve=>{const tick=()=>record.context.currentTime-start>.2?resolve():requestAnimationFrame(tick);tick();});
      const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
    }
    const base=await rms(0),boost=await rms(6);
    const failed=await loadMediaFile({url:'data:audio/wav;base64,AAAA',name:'broken.wav',type:'audio/wav'},{localOnly:true,previewOnly:true});
    const rolledBack=player===current;
    await api.setSourceGainDb(3);
    const uniqueNodes=__mediaNodes.filter(r=>r.player===current).length;
    current.pause();analyser.disconnect();
    return {changed:first!==current,tag:current.tagName,base,ratio:boost/base,failed,rolledBack,uniqueNodes,gain:record.gain.gain.value};
  });
  expect(result.changed).toBe(true);expect(result.tag).toBe('VIDEO');
  expect(result.base).toBeGreaterThan(.01);expect(result.ratio).toBeGreaterThan(1.8);expect(result.ratio).toBeLessThan(2.2);
  expect(result.failed).toBe(false);expect(result.rolledBack).toBe(true);expect(result.uniqueNodes).toBe(1);
});

test('waveform header unifies gain and active peaks; loading wins and stale results cannot revive it',async({page})=>{
  const readout=page.locator('#waveform-readout');
  await expect(readout).toContainText('peaks · 0.0 dB');
  await page.evaluate(async()=>{waveformEditor.settings.followSourceGain=false;await MSWE.resolve('audio-timeline').setSourceGainDb(3);});
  await expect(readout).toContainText('peaks · +3.0 dB');
  const reapeaks=generateWaveformPayload(12000);
  await page.evaluate(payload=>{EDITOR_SETTINGS.waveShapeSource='reapeaks';waveformEditor.setReapeaksWaveform(payload);},reapeaks);
  await expect(readout).toContainText('00:12.000 · 1,200 peaks');
  let release,arrive;const held=new Promise(resolve=>release=resolve),arrived=new Promise(resolve=>arrive=resolve);
  await page.route('**/media-analysis',route=>route.fulfill({json:{ok:true,job:{id:'held-job',status:'running'}}}));
  await page.route('**/media-analysis?*',async route=>{arrive();await held;await route.fulfill({json:{ok:true,job:{id:'held-job',status:'failed',error:'stale error'}}});});
  await page.evaluate(()=>MSWE.resolve('media-analysis').start('waveform',true));await arrived;
  await expect(readout).toHaveText('正在加载波形');await expect(readout).toHaveAttribute('aria-busy','true');
  await page.evaluate(async()=>{await MSWE.resolve('audio-timeline').setSourceGainDb(6);waveformEditor.refreshMediaReadout();});
  await expect(readout).toHaveText('正在加载波形');
  await page.evaluate(()=>MSWE.resolve('media-analysis').cancel('waveform'));release();
  await expect(readout).toHaveText('波形加载已取消');await expect(readout).toHaveAttribute('aria-busy','false');
  await page.unroute('**/media-analysis?*');
  await page.route('**/media-analysis?*',route=>route.fulfill({json:{ok:true,job:{id:'held-job',status:'failed',error:'synthetic failure'}}}));
  await page.evaluate(()=>MSWE.resolve('media-analysis').start('waveform',true));
  await expect(readout).toHaveText('波形加载失败');
});

test('a cancelled browser waveform decode never writes into the replacement media',async({page})=>{
  await page.evaluate(async()=>{
    const bytes=await (await fetch(player.currentSrc)).arrayBuffer(),payload=waveformEditor.getPayload();
    const file=new File([bytes],'deferred.wav',{type:'audio/wav'});
    let release;file.arrayBuffer=()=>new Promise(resolve=>release=()=>resolve(bytes));
    window.__decodeDone=waveformEditor.processFile(file);
    while(!release)await new Promise(resolve=>requestAnimationFrame(resolve));
    waveformEditor.resetWaveformLoading();waveformEditor.setPayload(payload);
    window.__retainedPayload=payload;release();
  });
  expect(await page.evaluate(async()=>{await window.__decodeDone;return waveformEditor.getPayload()===window.__retainedPayload;})).toBe(true);
  await expect(page.locator('#waveform-readout')).toHaveAttribute('aria-busy','false');
});
