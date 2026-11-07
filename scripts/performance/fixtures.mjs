// Synthetic-only benchmark inputs. No personal project or provider settings are read.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const flat=require('../../web/msw-flat-subtitles.js');
const speakers=require('../../web/msw-speaker.js');
const motion=require('../../web/msw-subtitle-animation.js');

export const FIXTURE_VERSION=1;
export const DURATION_MS=7_200_000;
export const MATRIX=['bound:1000','bound:6000','bound:10000','bound:15000','mixed:10000','migrated:10000'];
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value)).digest('hex');

export function parseScenario(value) {
  const match=/^(plain|bound|mixed|migrated|long-note):(\d+)$/.exec(value);
  if(!match)throw Error('Scenario must be plain|bound|mixed|migrated|long-note:COUNT');
  const count=Number(match[2]);
  if(count<100||count>30000||count%2)throw Error('Cue count must be an even integer between 100 and 30000');
  return {profile:match[1],count};
}

function track(id,number,secondary=false) {
  return {id,name:`S${number}${secondary?'副':'主'}`,display_number:number,
    ...(secondary?{secondary_for:`s${number}`} : {}),purpose:secondary?'translation':'source',
    layout:'auto',enabled:true,locked:false,collapsed:false,language:secondary?'zh-hans':'en',
    split_mode:secondary?'continuous':'word',style:{mode:'inherit',slot:secondary?'secondary':'main',base:'dialogue'}};
}

export function audioFixture() {
  const samples=8000,buffer=Buffer.alloc(44+samples*2);
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVE',8);
  buffer.write('fmt ',12);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);
  buffer.writeUInt32LE(8000,24);buffer.writeUInt32LE(16000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);
  buffer.write('data',36);buffer.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++)buffer.writeInt16LE(Math.round(600*Math.sin(2*Math.PI*220*i/8000)),44+i*2);
  return buffer;
}

export function waveform(durationMs=DURATION_MS) {
  const count=Math.ceil(durationMs/10),data=Buffer.alloc(count*2);let seed=42;
  for(let i=0;i<count;i++) {seed=(Math.imul(seed,1664525)+1013904223)>>>0;const amp=12+seed%75;data.writeInt8(-amp,i*2);data.writeInt8(amp,i*2+1);}
  return {schema:'moy.asr.waveform.v1',encoding:'i8-minmax-base64',peaks_per_second:100,peak_count:count,
    duration_ms:durationMs,audio_track:0,data:data.toString('base64')};
}

export function createFixture(profile,count) {
  parseScenario(`${profile}:${count}`);
  const mixed=profile==='mixed',paired=profile!=='plain',groups=mixed?3:1;
  const notes=profile==='long-note'?2:mixed?Math.floor(count/50)*2:0;
  const pairs=paired?(count-notes)/2:count,step=DURATION_MS/pairs;
  const tracks=Array.from({length:groups},(_,i)=>[track(`s${i+1}`,i+1),track(`s${i+1}-sub`,i+1,true)]).flat();
  const destNumber=groups+1;
  tracks.push(track(`s${destNumber}`,destNumber),track(`s${destNumber}-sub`,destNumber,true));
  if(notes)tracks.push({...track('annotation',destNumber+1),name:'注释',purpose:'annotation',layout:'fixed',language:'zh-hans',position:{x:.5,y:.08}});
  const palette=Array.from({length:mixed?12:5},(_,i)=>({...speakers.row(i,`bench-sp-${i+1}`),name:`Speaker ${i+1}`,names:{'zh-hans':`说话人 ${i+1}`},mode:mixed?['text','stroke','none'][i%3]:'none'}));
  if(mixed)palette[1].role_styles={main:{style:{primaryColor:'#ffffff',fontSize:48}},secondary:{style:{outlineColor:'#66bb6a',fontSize:42}}};
  const cues=[],bindings=[];
  for(let i=0;i<pairs;i++) {
    const start=Math.round(i*step),end=Math.round((i+.8)*step),owner=`s${i%groups+1}`;
    const text=`This is a reproducible subtitle timing and editing example number ${i+1}`;
    const words=text.split(' '),content={start,end,text,items:words.map((text,j)=>({text:text+(j+1<words.length?' ':''),start:start+Math.round(j*(end-start)/words.length),end:start+Math.round((j+1)*(end-start)/words.length)}))};
    if(paired) {
      const speaker=palette[Math.floor(i/5)%palette.length];
      content.color={name:speaker.id,value:speaker.color};
    }
    if(mixed) {
      if(i%13===0)content.subtitle_style={backgroundShape:'rounded',backgroundColor:'#111827',backgroundRadius:12,backgroundOpacity:70};
      if(i%37===0)content.subtitle_style={...content.subtitle_style,gradientMode:'characters',gradientStart:'#ffffff',gradientEnd:'#66bbff'};
      if(i%10===0) {const animation=motion.defaults();animation.effects.fade.enabled=true;content.subtitle_animation=animation;}
      if(i%101===0) {const animation=motion.defaults();Object.assign(animation.effects.wave,{enabled:true,amplitude:5,unit:'ms',start:0,end:400,period:200,periodUnit:'ms'});content.subtitle_animation=animation;}
    }
    const id=`cue-${i}-main`;cues.push({id,track_id:owner,content});
    if(paired) {
      const target=`cue-${i}-sub`,secondary={...structuredClone(content),text:`用于字幕编辑和性能测试的示例 ${i+1}`,items:[]};
      cues.push({id:target,track_id:owner+'-sub',content:secondary});
      bindings.push({id:`binding-${i}`,source_id:id,target_id:target,start_offset_ms:0,end_offset_ms:0});
    }
  }
  for(let i=0;i<notes;i++) {
    const stride=DURATION_MS/notes,start=Math.round(i*stride+(profile==='long-note'?0:Math.min(3000,stride*.1))),end=Math.round(start+(profile==='long-note'?stride:Math.min(2500,stride*.5)));
    cues.push({id:`note-${i}`,track_id:'annotation',content:{start,end,text:`固定注释 ${i+1}`,items:[]}});
  }
  let project={schema:'msw.project.v4',media:'../media/synthetic.mp4',timebase:{unit:'milliseconds',fps:25},
    subtitles:{schema:'msw.subtitles.v1',tracks,cues,bindings,next_track_number:destNumber+(notes?2:1)},
    preview:{speaker_palette:{version:1,rows:palette},speaker_labels_visible:true}};
  if(mixed) {
    const id='audio-'+('1'.repeat(32)),audio=audioFixture(),path='msw-'+('1'.repeat(24))+'.assets/audio/'+id+'.wav';
    project.msw={schema:'msw.editor.v1',project_id:'synthetic-perf-mixed',assets:[{id,kind:'audio',path,sha256:hash(audio),sample_rate:8000,channels:1,sample_count:8000,byte_size:audio.length,
      generation:{provider:'synthetic',model:'synthetic',voice:'tone',language_type:'word',display_text:'测试音频',spoken_text:'测试音频'},job_id:'synthetic',
      source_ref:{key:'synthetic-audio-text',id:'synthetic-audio-text',kind:'editor_text',track_id:null,text:'测试音频',start:0,end:1000}}],
      audio_tracks:[{id:'voice-1',name:'测试音频',gain_db:0,muted:false}],audio_clips:Array.from({length:100},(_,i)=>({id:`clip-${i}`,track_id:'voice-1',asset_id:id,start_ms:i*60000+500,source_in_sample:0,source_out_sample:8000,playback_rate:1,gain_db:0,muted:false,label:`音频 ${i+1}`}))};
  }
  if(profile==='migrated') {
    const segments=cues.filter(c=>c.track_id==='s1').map(c=>({id:c.id,...c.content}));
    const secondary=cues.filter(c=>c.track_id==='s1-sub').map(c=>({id:c.id,...c.content}));
    project=flat.normalizeGroups(flat.migrate({media:project.media,preview:project.preview,timebase:project.timebase,segments,
      multi_subtitle:{schema:'moy.asr.multi_subtitle.v1',enabled:true,display_mode:'both',tracks:[{id:'translation',role:'extension',segments:secondary}],
        bindings:bindings.map(b=>({id:b.id,track_id:'translation',main_segment_ids:[b.source_id],extension_segment_ids:[b.target_id],start_offset_ms:0,end_offset_ms:0}))}}),{infer:true});
    project.subtitles.tracks.push(track('s2',2),track('s2-sub',2,true));project.subtitles.next_track_number=3;
  }
  flat.validate(project);
  return {project,manifest:{version:FIXTURE_VERSION,profile,count,durationMs:DURATION_MS,bindings:bindings.length,tracks:tracks.length,speakers:palette.length,
    audioClips:project.msw?.audio_clips.length||0,styledCues:cues.filter(c=>c.content.subtitle_style).length,animatedCues:cues.filter(c=>c.content.subtitle_animation).length,
    contentHash:hash(project),destination:'s'+destNumber,firstCue:project.subtitles.cues[0].id}};
}
