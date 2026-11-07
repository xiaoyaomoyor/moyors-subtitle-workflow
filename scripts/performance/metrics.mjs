export const REPORT_SCHEMA='msw.performance-baseline.v1';
export const HARNESS_VERSION=1;
export function stats(values) {
  const sorted=values.filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0).sort((a,b)=>a-b),n=sorted.length;
  if(!n)return {n:0,median:null,p95:null,max:null};
  const median=n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;
  return {n,median,p95:n>=20?sorted[Math.ceil(n*.95)-1]:null,max:sorted[n-1]};
}
export function summarize(samples) {
  const successful=samples.filter(s=>s.status==='ok');
  return {samples:samples.length,successful:successful.length,failed:samples.length-successful.length,
    syncMs:stats(successful.map(s=>s.syncMs)),feedbackMs:stats(successful.map(s=>s.feedbackMs)),settledMs:stats(successful.map(s=>s.settledMs)),
    longestTaskMs:stats(successful.map(s=>s.longTasks?.max||0)),blockedMs:stats(successful.map(s=>s.longTasks?.total||0)),
    frameGapMs:stats(successful.flatMap(s=>s.frameGaps||[])),
    calls:Object.fromEntries([...new Set(successful.flatMap(s=>Object.keys(s.calls||{})))].map(k=>[k,{count:stats(successful.map(s=>s.calls?.[k]?.count||0)),ms:stats(successful.map(s=>s.calls?.[k]?.ms||0))}]))};
}
export function comparisonKey(report) {
  const {fixture,environment:e,config}=report;
  return JSON.stringify([HARNESS_VERSION,report.harnessVersion,fixture.contentHash,config.viewport,config.video,config.warmup,config.repeats,config.idleMs,
    e.harnessHash,e.platform,e.release,e.arch,e.cpu,e.cpuThreads,e.memoryBytes,e.node,e.python,e.ffmpeg,e.fontInventoryHash,e.browser,e.headless]);
}
export function compareReports(before,after) {
  if(before.schema!==REPORT_SCHEMA||after.schema!==REPORT_SCHEMA)throw Error('Unsupported performance report');
  if(comparisonKey(before)!==comparisonKey(after))return {compatible:false,reason:'Fixture, harness, environment or run settings differ; measurements are not comparable.',rows:[]};
  const rows=[];
  for(const [name,b] of Object.entries(before.operations)) {
    const a=after.operations[name];if(!a)continue;
    for(const metric of ['syncMs','feedbackMs','settledMs','longestTaskMs']) {
      const prior=b.summary[metric],next=a.summary[metric];
      if(prior?.median===null||next?.median===null||!prior||!next)continue;
      const delta=next.median-prior.median;
      rows.push({name,metric,before:prior.median,after:next.median,deltaMs:delta,
        regression:b.summary.failed===0&&a.summary.failed===0&&prior.n>=3&&next.n>=3&&delta>50&&next.median>prior.median*1.2});
    }
  }
  return {compatible:true,rows,failures:[...(before.status&&before.status!=='complete'?['baseline-incomplete']:[]),...(after.status&&after.status!=='complete'?['candidate-incomplete']:[]),...Object.entries(after.operations).filter(([,v])=>v.summary.failed).map(([k])=>k)],missing:Object.keys(before.operations).filter(k=>!after.operations[k])};
}
