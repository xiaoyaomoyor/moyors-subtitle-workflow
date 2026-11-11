import {test,expect} from '@playwright/test';
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import flat from '../../web/msw-flat-subtitles.js';
import speakers from '../../web/msw-speaker.js';
import {disableOnboarding,findFreePort,generateWav,generateWaveformPayload,makeTempDir,startServer} from './helpers.mjs';
let server,path;const errors=new WeakMap();
const snapshot=page=>page.evaluate(()=>JSON.parse(buildJson()));
const rows=page=>page.locator('#speaker-palette-rows tr');
const action=(page,id,name)=>page.locator(`#speaker-palette-rows tr[data-speaker-id="${id}"] [data-speaker-action="${name}"]`);
const order=page=>page.evaluate(()=>DATA.preview.speaker_palette.rows.map(r=>r.id));
test.beforeEach(async({page})=>{
 const dir=makeTempDir('speaker-rows'),media=join(dir,'audio.wav');path=join(dir,'project.mosp');generateWav(media,6);
 process.env.MSW_APP_DATA_ROOT=join(dir,'settings');process.env.MAW_ENV_FILE=join(dir,'isolated.env');
 let p=flat.migrate({media,segments:[{id:'head',start:0,end:1000,text:'Head',speaker:'original-asr',color:{name:'yellow',start:0,end:1000}},
  {id:'follow',start:1500,end:2500,text:'Follower',color_ref:{headIdx:0,name:'yellow'}},
  {id:'other',start:3000,end:4000,text:'Other',color:{name:'green',start:3000,end:4000}}],waveform:generateWaveformPayload(6000)});
 const main=p.subtitles.tracks[0],head=p.subtitles.cues[0];p=flat.addTrack(p,{...main,id:'secondary',secondary_for:main.id,style:{...main.style,slot:'secondary'}});
 p.subtitles.cues.push({id:'cross',track_id:'secondary',hidden:true,content:{start:0,end:1000,text:'Cross track',disabled:true,color_ref:{cue_id:head.id,name:'yellow'},subtitle_style:{fontSize:60}}});
 p=flat.bind(p,head.id,'cross','pair');speakers.ensure(p);p.preview.speaker_palette.rows[0].names={en:'A'};
 writeFileSync(path,JSON.stringify(p));server=await startServer(path,media,await findFreePort());
 errors.set(page,[]);page.on('pageerror',e=>errors.get(page).push(e.message));page.on('dialog',d=>d.accept());
 await disableOnboarding(page);await page.goto(server.url);await expect(page.locator('#editor-loading')).toBeHidden();
 await page.evaluate(()=>{updateEditorSettings({autoSaveProject:false});setProjectSettingsPanelOpen(true,'subtitle-speakers');});
 await expect(rows(page)).toHaveCount(6);
});
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false});await server?.stop();expect(errors.get(page)).toEqual([]);});

test('drag fifth speaker to second, undo and shortcuts preserve identities',async({page})=>{
 const before=await snapshot(page),history=await page.evaluate(()=>editorHistory.undoLength());
 await action(page,'blue','drag').dragTo(page.locator('#speaker-palette-rows tr[data-speaker-id="green"]'),{targetPosition:{x:25,y:2}});
 await expect.poll(()=>order(page)).toEqual(['yellow','blue','green','red','purple']);expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.evaluate(()=>performUndo());expect(await order(page)).toEqual(['yellow','green','red','purple','blue']);
 await page.evaluate(()=>performRedo());expect(await order(page)).toEqual(['yellow','blue','green','red','purple']);
 await expect(rows(page).locator('[data-speaker-action="up"],[data-speaker-action="down"]')).toHaveCount(0);
 await expect(rows(page).first().locator('button')).toHaveCount(0);
 await page.evaluate(()=>{setProjectSettingsPanelOpen(false);selectCueByClick(2);document.activeElement?.blur();});await page.keyboard.press('2');
 expect((await snapshot(page)).subtitles.cues.find(c=>c.content.text==='Other').content.color.name).toBe('blue');
});

test('deleting an in-use speaker clears all references atomically and survives save/reload',async({page})=>{
 const before=await snapshot(page),history=await page.evaluate(()=>editorHistory.undoLength());
 await action(page,'yellow','delete').click();await expect(page.locator('#speaker-row-remove-count')).toHaveText('3');
 await page.locator('#speaker-row-remove-cancel').click();expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await action(page,'yellow','delete').click();await page.locator('#speaker-row-remove-confirm').click();await expect(rows(page)).toHaveCount(5);
 const after=await snapshot(page);expect(after.preview.speaker_palette.rows.some(r=>r.id==='yellow')).toBe(false);
 const expected=structuredClone(before.subtitles);for(const c of expected.cues)if(c.content.text!=='Other'){delete c.content.color;delete c.content.color_ref;}
 expect(after.subtitles).toEqual(expected);expect(await page.evaluate(()=>editorHistory.undoLength())).toBe(history+1);
 await page.evaluate(()=>performUndo());expect((await snapshot(page)).subtitles).toEqual(before.subtitles);expect(await order(page)).toEqual(before.preview.speaker_palette.rows.map(r=>r.id));
 await page.evaluate(()=>performRedo());expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
 await expect.poll(()=>page.evaluate(()=>!projectSaveInFlight&&!projectCheckpointInFlight)).toBe(true);expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
 expect(JSON.parse(readFileSync(path,'utf8')).subtitles).toEqual(after.subtitles);
 await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();expect((await snapshot(page)).preview.speaker_palette).toEqual(after.preview.speaker_palette);
 expect((await snapshot(page)).subtitles).toEqual(after.subtitles);
});

test('locked references block deletion, unused rows remain removable, last row stays',async({page})=>{
 await page.evaluate(()=>fixedUpdateTrack('secondary',{locked:true}));const before=await snapshot(page);
 await action(page,'yellow','delete').click();await expect(page.locator('#speaker-row-status')).toContainText('锁定轨道');await expect(page.locator('#speaker-row-remove')).toBeHidden();expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
 await action(page,'blue','delete').click();await expect(page.locator('#speaker-row-remove-count')).toHaveText('0');await page.locator('#speaker-row-remove-confirm').click();expect(await order(page)).not.toContain('blue');
 await page.evaluate(()=>performUndo());expect(await order(page)).toContain('blue');
 await page.evaluate(()=>{applyCanonicalProject({segments:[],preview:{speaker_palette:{version:1,rows:[MSWSpeaker.row(0)]}}},'single.mosp');setProjectSettingsPanelOpen(true,'subtitle-speakers');});
 await expect(rows(page)).toHaveCount(2);await expect(action(page,'yellow','delete')).toBeDisabled();
});

test('confirmation rejects changed usage and project switches cancel pending deletion',async({page})=>{
 await action(page,'yellow','delete').click();await page.evaluate(()=>{DATA.preview.speaker_palette.rows[0].name='Changed';speakerPaletteChanged();});
 await page.locator('#speaker-row-remove-confirm').click();await expect(page.locator('#speaker-row-status')).toContainText('已变化');expect(await order(page)).toContain('yellow');
 await action(page,'yellow','delete').click();await page.evaluate(()=>applyCanonicalProject({segments:[]},'new.mosp'));await expect(page.locator('#speaker-row-remove')).toBeHidden();expect(await order(page)).toContain('yellow');
});

test('row order persists after save and new speakers do not reuse remaining identities',async({page})=>{
 await action(page,'blue','drag').dragTo(page.locator('#speaker-palette-rows tr[data-speaker-id="purple"]'),{targetPosition:{x:25,y:2}});
 expect(await order(page)).toEqual(['yellow','green','red','blue','purple']);const before=await snapshot(page);
 await expect.poll(()=>page.evaluate(()=>!projectSaveInFlight&&!projectCheckpointInFlight)).toBe(true);expect(await page.evaluate(()=>saveProjectToServer())).toBe(true);
 await page.reload();await expect(page.locator('#editor-loading')).toBeHidden();expect(await order(page)).toEqual(before.preview.speaker_palette.rows.map(r=>r.id));
 await page.evaluate(()=>setProjectSettingsPanelOpen(true,'subtitle-speakers'));await page.locator('#speaker-palette-add').click();
 const ids=await order(page);expect(new Set(ids).size).toBe(ids.length);expect((await snapshot(page)).subtitles).toEqual(before.subtitles);
});

test('speaker row controls fit the project settings and remain accessible when narrow',async({page},info)=>{
 await expect(rows(page).nth(1).locator('td:last-child button')).toHaveCount(3);
 await expect(rows(page).locator('th button,td:nth-child(2) button')).toHaveCount(0);
 expect(await page.locator('.speaker-palette-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.locator('#project-settings-modal').screenshot({path:info.outputPath('speaker-rows.png')});
 await action(page,'green','style').click();await expect(page.locator('#style-edit-scope')).toHaveValue('speaker');
 await expect(page.locator('#style-speaker-target')).toHaveValue('green');await page.locator('#style-project-settings-open').click();
 await page.setViewportSize({width:600,height:850});await expect(action(page,'yellow','delete')).toBeVisible();
 await action(page,'yellow','delete').click();await expect(page.locator('#speaker-row-remove-confirm')).toBeVisible();
 await page.locator('#project-settings-modal').screenshot({path:info.outputPath('speaker-rows-narrow.png')});
});
