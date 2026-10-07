import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';

let server,folder;
test.beforeEach(async({page})=>{
  folder=makeTempDir('split-preview');
  process.env.MSW_APP_DATA_ROOT=join(folder,'local');process.env.MAW_ENV_FILE=join(folder,'isolated.env');
  const media=join(folder,'synthetic.mp4'),project=join(folder,'project.mosp');
  execFileSync(process.env.MSW_E2E_FFMPEG,['-v','error','-f','lavfi','-i','color=c=black:s=640x360:r=25:d=4','-c:v','libx264','-pix_fmt','yuv420p',media],{windowsHide:true});
  writeFileSync(project,JSON.stringify({media,segments:[{id:'m',start:0,end:4000,text:'Main subtitle'}],
    multi_subtitle:{enabled:true,display_mode:'both',tracks:[{id:'s',role:'extension',segments:[{id:'s1',start:0,end:4000,text:'Secondary subtitle'}]}],
      bindings:[{id:'b',track_id:'s',main_segment_ids:['m'],extension_segment_ids:['s1']}]},waveform:generateWaveformPayload(4000)}));
  await disableOnboarding(page);await page.addInitScript(()=>localStorage.setItem('moy.asr.editor.settings.v1',JSON.stringify({autoSaveProject:false})));
  page.on('dialog',d=>d.type()==='beforeunload'?d.accept():d.dismiss());
  server=await startServer(project,media,await findFreePort());await page.goto(server.url);
  await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
});
test.afterEach(async()=>{await server?.stop();server=null;});

async function setup(page,legacy=false){
  await page.evaluate(legacy=>{
    const h=window.MSWE.resolve('processing-host'),S=window.MSWProjectStyle;
    const style=legacy?S.fromBurn({main:{font_family:'Arial',font_size:48,color:'#ff0000',outline:2,outline_color:'#000000',background_color:'#000000',background_alpha:0,x:.5,y:.86,width:.8},secondary:{font_family:'Arial',font_size:40,color:'#00ff00',outline:2,outline_color:'#000000',background_color:'#000000',background_alpha:0,x:.5,y:.94,width:.8}}):S.defaults();
    Object.assign(style.main,{fontName:'Arial',primaryColor:'#ff0000'});Object.assign(style.secondary,{fontName:'Arial',primaryColor:'#00ff00'});
    style.pairLayout={order:'secondary-above',gap:0};h.commitProjectStyle(style);
    for(const id of ['overlay-toggle','extension-overlay-toggle']){const el=document.getElementById(id);el.checked=true;el.dispatchEvent(new Event('change'));}
    h.player.currentTime=1;h.player.pause();renderAll();
  },legacy);
  await ready(page);
  return page.evaluate(()=>structuredClone(window.MSWE.resolve('processing-host').data.preview.project_style));
}
async function ready(page){await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleRenderer.status==='libass'&&!window.MSWSubtitleRenderer.pending)).toBe(true);}
async function refresh(page){
  const response=page.waitForResponse(r=>r.url().endsWith('/subtitle-preview')&&r.status()===200);
  await page.evaluate(()=>window.MSWSubtitleRenderer.invalidate());await response;await ready(page);
}
async function preview(page){return page.evaluate(()=>{const h=window.MSWE.resolve('processing-host');return window.MSWSubtitleStyle.request('subtitle-preview',{project:h.exportProject(),target:'both',video:{width:640,height:360}});});}
async function cut(page,kind,duplicate){
  await page.evaluate(kind=>kind==='linked'?splitFromContextMenu(0,0,0,2000):openExtensionSplitModal(0,2000, getActiveExtensionTrack(), { independent: true }),kind);
  await expect(page.locator('#multi-subtitle-split-modal')).toHaveClass(/show/);
  if(duplicate) await page.locator('#multi-subtitle-split-modal summary').click();
  await page.locator(duplicate?'#multi-subtitle-split-duplicate':'#multi-subtitle-split-confirm').click();
  await expect(page.locator('#multi-subtitle-split-modal')).not.toHaveClass(/show/);
}

for(const legacy of [false,true])test(`linked split preserves exact rendering and project style (${legacy?'legacy':'modern'})`,async({page})=>{
  const style=await setup(page,legacy),before=await preview(page);
  const beforeImage=join(folder,'before.png');await page.locator('.JASSUB').screenshot({path:beforeImage});
  await cut(page,'linked',true);
  const snapshot=await page.evaluate(()=>window.MSWE.resolve('processing-host').exportProject());
  expect(snapshot.segments).toHaveLength(2);expect(snapshot.multi_subtitle.tracks[0].segments).toHaveLength(2);
  expect(snapshot.multi_subtitle.tracks[0].segments.map(s=>s.items)).toEqual([[],[]]);
  expect(snapshot.preview.project_style).toEqual(style);
  const after=await preview(page);expect(after.ass.split('[Events]')[0]).toBe(before.ass.split('[Events]')[0]);
  await refresh(page);await page.evaluate(()=>window.MSWSubtitleRenderer.repaint());
  const afterImage=join(folder,'after.png');await page.locator('.JASSUB').screenshot({path:afterImage});
  await page.evaluate(async()=>{const p=window.MSWE.resolve('processing-host').player;p.currentTime=3;await new Promise(resolve=>p.addEventListener('seeked',resolve,{once:true}));await window.MSWSubtitleRenderer.repaint();});
  const rightImage=join(folder,'right.png');await page.locator('.JASSUB').screenshot({path:rightImage});
  const bounds=JSON.parse(execFileSync(process.env.MSW_E2E_PYTHON,['-c',`from PIL import Image
import json,sys
def bounds(path):
 im=Image.open(path).convert('RGB');out=[]
 for channel in (0,1):
  pixels=[(x,y) for y in range(im.height) for x in range(im.width) if (lambda c:c[channel]>80 and c[channel]>2*c[1-channel] and c[channel]>2*c[2])(im.getpixel((x,y)))]
  out.append([min(x for x,y in pixels),min(y for x,y in pixels),max(x for x,y in pixels),max(y for x,y in pixels)])
 return out
print(json.dumps([bounds(p) for p in sys.argv[1:]]))`,beforeImage,afterImage,rightImage],{encoding:'utf8',windowsHide:true}));
  expect(bounds[1]).toEqual(bounds[0]);expect(bounds[2]).toEqual(bounds[0]);expect(bounds[1][1][3]).toBeLessThan(bounds[1][0][1]);
  await page.evaluate(()=>performUndo());expect((await page.evaluate(()=>window.MSWE.resolve('processing-host').exportProject())).segments).toHaveLength(1);await preview(page);
  await page.evaluate(()=>performRedo());await preview(page);await ready(page);
  const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/api/msw/project'));
  await page.keyboard.press('Control+s');expect((await (await saved).json()).ok).toBe(true);
  await expect.poll(()=>page.evaluate(()=>projectSaveInFlight)).toBe(false);
  await page.reload();await expect.poll(()=>page.evaluate(()=>window.MSWSubtitleStyle?.ready)).toBe(true);
  const restored=await page.evaluate(()=>window.MSWE.resolve('processing-host').exportProject());
  expect(restored.preview.project_style).toEqual(style);expect(restored.multi_subtitle.tracks[0].segments).toHaveLength(2);await preview(page);await ready(page);
});

test('independent secondary text split keeps valid word timestamps and exact preview',async({page})=>{
  await setup(page);await cut(page,'secondary',false);
  const p=await page.evaluate(()=>window.MSWE.resolve('processing-host').exportProject());
  expect(p.segments).toHaveLength(1);expect(p.multi_subtitle.tracks[0].segments.map(s=>s.items)).toEqual([[],[]]);
  expect(p.multi_subtitle.tracks[0].segments.map(s=>s.text)).toEqual(['Secondary','subtitle']);await preview(page);await ready(page);
});

test('serialization repairs old null timing placeholders without changing live undo data',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{const p=window.MSWE.resolve('processing-host').data;p.multi_subtitle.tracks[0].segments[0].items=null;});
  const p=await page.evaluate(()=>window.MSWE.resolve('processing-host').exportProject());
  expect(p.multi_subtitle.tracks[0].segments[0].items).toBeUndefined();
  expect(await page.evaluate(()=>window.MSWE.resolve('processing-host').data.multi_subtitle.tracks[0].segments[0].items)).toBeNull();
  await preview(page);await page.evaluate(()=>window.MSWSubtitleRenderer.invalidate());await ready(page);
});

test('standalone cursor split emits empty arrays while keeping available timed words',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{
    DATA.multi_subtitle.bindings=[];DATA.multi_subtitle.enabled=false;renderAll();
    startEdit(container.querySelector('.cue[data-idx="0"]'),0);setEditingCaretOffset(5);splitAtCursor();
  });
  expect(await page.evaluate(()=>DATA.segments.map(s=>s.items))).toEqual([[],[]]);await preview(page);await ready(page);
  const parts=await page.evaluate(()=>buildSplitPair({id:'timed',start:0,end:4000,text:'Main subtitle',items:[{start:0,end:1800,text:'Main'},{start:2200,end:4000,text:'subtitle'}]},5,2000,'timed',true,'word'));
  expect(parts.left.items).toEqual([{start:0,end:1800,text:'Main'}]);expect(parts.right.items).toEqual([{start:2200,end:4000,text:'subtitle'}]);
});
