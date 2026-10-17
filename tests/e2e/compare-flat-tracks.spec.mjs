import {expect, test} from '@playwright/test';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const flat = require('../../web/msw-flat-subtitles.js');

function fixture() {
  const project = flat.migrate({segments: [
    {id: 'a', start: 0, end: 1000, text: 'Source A'},
    {id: 'b', start: 1200, end: 2200, text: 'Source B'},
  ]});
  const base = project.subtitles.tracks[0];
  base.name = 'S1'; base.locked = true; base.collapsed = true;
  for (const [id, name, enabled] of [['translation','S2',true],['empty','S3',true],['disabled','S4',false]]) {
    project.subtitles.tracks.push({...base,id,name,enabled,locked:false,collapsed:false});
  }
  project.subtitles.cues.push({id:'translated',track_id:'translation',content:{start:0,end:1000,text:'译文'}});
  project.subtitles.cues.push({id:'hidden',track_id:base.id,hidden:true,content:{start:2400,end:2600,text:'隐藏内容'}});
  project.subtitles.cues.push({id:'off',track_id:'disabled',content:{start:0,end:1000,text:'禁用轨内容'}});
  flat.validate(project);
  return project;
}
const url = name => pathToFileURL(resolve(`tools/${name}.html`)).href;
async function upload(page, projects) {
  await page.locator('#fileInput').setInputFiles(projects.map((project,i) => ({name:`project-${i}.mosp`,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))})));
}

test('text comparison selects actual tracks and handles hidden, disabled, locked and empty tracks', async ({page}) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url('compare'));
  await upload(page,[fixture()]);
  const select=page.getByRole('combobox',{name:/字幕轨道/});
  await expect(select.locator('option')).toHaveCount(4);
  expect(await page.evaluate(()=>MSWCompare.state.files[0].segments.map(c=>c.text))).toEqual(['Source A','Source B']);
  await select.selectOption('translation');
  expect(await page.evaluate(()=>MSWCompare.state.files[0].segments.map(c=>c.text))).toEqual(['译文']);
  await select.selectOption('empty');
  await expect(page.locator('.card-stats')).toContainText('0 段');
  await select.selectOption('disabled');
  expect(await page.evaluate(()=>MSWCompare.state.files[0].warnings)).toContain('所选轨道已禁用，没有参与比较的字幕');
  await select.selectOption({index:0});
  await expect(page.locator('.card-stats')).toContainText('2 段');
  expect(errors).toEqual([]);
});

test('text comparison keeps legacy secondary and overlay content separate and accepts SRT', async ({page}) => {
  await page.goto(url('compare'));
  await upload(page,[{segments:[{start:0,end:1000,text:'original'}],multi_subtitle:{enabled:true,tracks:[{id:'zh',language:'zh',segments:[{start:0,end:1000,text:'翻译'}]}]},overlay_track:{enabled:true,segments:[{start:0,end:1000,text:'注释'}]}}]);
  const select=page.getByRole('combobox',{name:/字幕轨道/});
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption('legacy-secondary:zh');
  expect(await page.evaluate(()=>MSWCompare.state.files[0].segments[0].text)).toBe('翻译');
  await page.locator('#fileInput').setInputFiles([{name:'test.srt',mimeType:'text/plain',buffer:Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nSubtitle\n')}]);
  await expect(page.locator('.card')).toHaveCount(2);
  await expect(select).toHaveCount(1);
});

test('timecode comparison pairs stable cue IDs after insertions and deletions', async ({page}) => {
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const before=fixture(),after=structuredClone(before);
  const first=before.subtitles.cues[0], second=before.subtitles.cues[1];
  after.subtitles.cues=after.subtitles.cues.filter(c=>c.id!==first.id);
  after.subtitles.cues.unshift({id:'inserted',track_id:second.track_id,content:{start:300,end:800,text:'Inserted'}});
  after.subtitles.cues.find(c=>c.id===second.id).content.start=1250;
  await page.goto(url('timestamp-compare'));
  await upload(page,[before,after]);
  await expect(page.locator('#summary')).toContainText('字幕 ID 对照');
  const rows=await page.evaluate(()=>MSWTsCompare.buildRows().map(r=>r.cells.map(c=>c?.text||null)));
  expect(rows).toEqual([['Source A',null],[null,'Inserted'],['Source B','Source B']]);
  await expect(page.locator('#summary')).toContainText('1 对');
  await page.getByRole('combobox',{name:/字幕轨道/}).nth(0).selectOption('translation');
  await expect(page.locator('#summary')).toContainText('段序号对照');
  await page.getByRole('combobox',{name:/字幕轨道/}).nth(1).selectOption('translation');
  await expect(page.locator('#summary')).toContainText('字幕 ID 对照');
  await page.getByRole('combobox',{name:/字幕轨道/}).nth(0).selectOption('empty');
  await expect(page.locator('.row-grid')).toHaveCount(1);
  await page.getByRole('combobox',{name:/字幕轨道/}).nth(1).selectOption('disabled');
  await expect(page.locator('.row-grid')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('native timecode diagnosis keeps malformed items visible and uses track granularity', async ({page}) => {
  const project=fixture();
  project.subtitles.tracks[0].timestamp_granularity='word';
  project.subtitles.cues[0].content.items=[{start:0,end:1300,text:'Source A'}];
  await page.goto(url('timestamp-compare'));
  await upload(page,[project]);
  await expect(page.locator('.card-source')).toContainText('词级');
  await expect(page.locator('#warning')).toContainText('超出');
  await expect(page.locator('.row-grid')).toHaveCount(2);
  await page.getByRole('combobox',{name:/字幕轨道/}).selectOption('translation');
  await expect(page.locator('.row-grid')).toHaveCount(1);
  await expect(page.locator('#warning')).toBeHidden();
});
