import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import core from '../web/msw-subtitle-layers.js';
import '../web/msw-subtitle-presentation.js';
const P=globalThis.MSWSubtitlePresentation;
const fixture=()=>core.migrate(JSON.parse(readFileSync(new URL('fixtures/subtitle-layers.json',import.meta.url))).find(f=>f.name==='bound-bilingual').project);
const styles={main:{font_size:48,width:.8,y:.86},secondary:{font_size:40,width:.8,y:.94}};
test('bound groups retain line order; half-open merged SRT does not mutate the source',()=>{
 const project=fixture(),before=JSON.stringify(project),layout=P.layout(project,styles);
 assert.equal(layout.groups.length,2);assert.equal(layout.entries.length,4);
 const rows=P.mergedSrtRows(project), active=rows.find(r=>r.start<=2500&&r.end>2500);
 assert.equal(active.text,[project.segments[0].text,project.multi_subtitle.tracks[0].segments[0].text,project.segments[1].text,project.multi_subtitle.tracks[0].segments[1].text].join('\n'));
 assert.equal(JSON.stringify(project),before);
 project.subtitle_layers.presentation={mode:'manual',gap:12};assert.ok([...P.layout(project,styles).offsets.values()].every(v=>v.offset===0));
 project.subtitle_layers.presentation={mode:'auto',gap:12,order:'earlier-top'};
 const reversed=P.layout(project,styles);assert.ok(reversed.offsets.get(P.key('main',project.segments[0].id)).offset>reversed.offsets.get(P.key('main',project.segments[1].id)).offset);
});
test('local repacking retains the interval tree during a drag and matches brute-force hit testing',()=>{
 const measurements=[];
 for(const count of [1000,10000])for(const depth of [2,4,8]){
  const cues=Array.from({length:count},(_,i)=>({id:'c'+i,start:Math.floor(i/depth)*1000,end:Math.floor(i/depth)*1000+900,text:'Sample'}));
  const started=performance.now(),layout=core.pack(cues),build=performance.now()-started,tree=layout.index.entries,times=[];
  for(let n=0;n<120;n++){
   const t=performance.now();cues[0].start=n*77;cues[0].end=n*77+900;
   core.updatePack(layout,cues,[0]);layout.index.at(n*81);times.push(performance.now()-t);
  }
  assert.equal(layout.index.entries,tree,'drag must not sort or rebuild the whole project');
  const time=8800,expected=cues.map((c,i)=>[c,i]).filter(([c])=>c.start<=time&&c.end>time).map(([,i])=>i).sort((a,b)=>a-b);
  assert.deepEqual(layout.index.at(time).sort((a,b)=>a-b),expected);
  times.sort((a,b)=>a-b);measurements.push({count,depth,build_ms:+build.toFixed(3),drag_p95_ms:+times[114].toFixed(3)});
 }
 console.log('subtitle-layer-performance',JSON.stringify(measurements));
});
