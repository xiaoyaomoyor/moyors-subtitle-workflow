import {createRequire} from 'node:module';
import {createFixture,hash} from './fixtures.mjs';
import {stats} from './metrics.mjs';
const require=createRequire(import.meta.url),bridge=require('../../web/msw-production-project.js'),tracks=require('../../web/msw-subtitle-tracks.js');

// Model-only checks are separate from browser timings and run after the matrix.
export function runModelProbes(count=10000,repeats=3) {
  const view=bridge.fromProject(createFixture('bound',count).project),before=hash(view),result={count,repeats,cases:{}};
  const measure=(name,fn)=>{const samples=[];let value;for(let i=0;i<repeats;i++){const start=performance.now();value=fn();samples.push(performance.now()-start);}result.cases[name]={samples,ms:stats(samples),outputCues:value?.subtitles?.cues?.length};};
  measure('preview-window-90s',()=>bridge.toProject(view,{previewWindow:{start:0,end:90000}}));
  measure('full-project-conversion',()=>bridge.toProject(view));
  measure('locks-none',()=>tracks.assertLocks(view,view));
  if(hash(view)!==before)throw Error('Read-only model probes changed the source');
  view.subtitle_tracks.tracks[1].locked=true;
  measure('locks-half-project',()=>tracks.assertLocks(view,view));
  const note=bridge.fromProject(createFixture('long-note',count).project);
  measure('preview-window-with-fixed-long-note',()=>bridge.toProject(note,{previewWindow:{start:0,end:90000}}));
  return result;
}
