import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {disableOnboarding,findFreePort,generateBlankEditor,generateWaveformPayload,makeTempDir,startStaticServer} from './helpers.mjs';
export const snap=page=>page.evaluate(()=>JSON.parse(buildJson()));
export const inputs=page=>page.locator('#find-edit-rows textarea');
export const apply=async page=>{await expect(page.locator('#find-edit-apply')).toBeEnabled();await page.locator('#find-edit-apply').click();await expect(page.locator('#find-edit-message')).toContainText('已修改');};
export const count=async(page,n)=>expect(page.locator('#find-edit-count')).toContainText(`${n} 条 ·`);
export function setup(){
 let server,env;const errors=new WeakMap();
 test.beforeAll(async()=>{env={MAW_ENV_FILE:process.env.MAW_ENV_FILE,MSW_APP_DATA_ROOT:process.env.MSW_APP_DATA_ROOT};const dir=makeTempDir('find-unified');process.env.MAW_ENV_FILE=join(dir,'isolated.env');process.env.MSW_APP_DATA_ROOT=join(dir,'app-data');server=await startStaticServer(generateBlankEditor(join(dir,'editor.html')),await findFreePort());});
 test.afterAll(async()=>{await server?.stop();for(const [k,v] of Object.entries(env)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 test.beforeEach(async({page})=>{errors.set(page,[]);page.on('pageerror',e=>errors.get(page).push(e.message));await disableOnboarding(page);await page.goto(server.url);
 await page.evaluate(waveform=>{
  const rows=[1000,4000].map((start,i)=>({id:'a'+i,start,end:start+1000,text:i?'alpha Bravo':'  Alpha Bravo  ',items:[],color:{name:i?'green':'red',value:i?'#00ff00':'#ff0000',start,end:start+1000}}));
  applyCanonicalProject({segments:rows,waveform,multi_subtitle:{enabled:true,tracks:[{id:'zh',segments:rows.map((r,i)=>({...r,id:'b'+i,text:' 中文 '+i}))}],bindings:rows.map((r,i)=>({id:'bind'+i,track_id:'zh',main_segment_ids:[r.id],extension_segment_ids:['b'+i]}))}},'unified.mosp');
  const p=JSON.parse(buildJson());p.subtitles.tracks.push({...p.subtitles.tracks[0],id:'third',name:'S2',display_number:2});p.subtitles.cues.push(...rows.map(({id,...content},i)=>({id:'third-'+i,track_id:'third',content:{...content,disabled:i===1}})));p.subtitles.next_track_number=3;
  window.testTracks=p.subtitles.tracks.map(t=>t.id);applyCanonicalProject(p,'unified.mosp');clearSelection({silent:true});updateEditorSettings({autoSaveProject:false,selectBoundSubtitlePair:false});
 },generateWaveformPayload(10000));await page.keyboard.press('Control+f');await count(page,6);});
 test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
}
