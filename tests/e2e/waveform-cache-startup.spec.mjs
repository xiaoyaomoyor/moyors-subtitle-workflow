import {expect, test} from '@playwright/test';
import {readFileSync, writeFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {cleanupTempDir, disableOnboarding, findFreePort, generateProjectJson,
  generateWav, generateWaveformPayload, makeTempDir, startServer} from './helpers.mjs';

test('normal startup reads disk cache and deferred layers without inline waveform', async ({page}) => {
  const dir=makeTempDir('disk-cache-startup');
  let server;
  try {
    const media=join(dir,'synthetic.wav'), project=join(dir,'project.mosp');
    generateWav(media,60);
    generateProjectJson(project);
    const data=JSON.parse(readFileSync(project,'utf8'));
    delete data.waveform;
    writeFileSync(project,JSON.stringify(data));
    const basic=generateWaveformPayload(60000);
    const waves=Buffer.alloc(basic.peak_count*4);
    const spectral=Buffer.alloc(basic.peak_count*4);
    for(let i=0;i<basic.peak_count;i++) {
      waves.writeInt16LE(8192,i*4);waves.writeInt16LE(-8192,i*4+2);
      spectral.writeInt32LE((20<<15)|440,i*4);
    }
    const scale=Buffer.alloc(8);scale.writeUInt32LE(1000,0);scale.writeUInt32LE(10,4);
    const layers=[[80,basic.peak_count,waves],[-115,basic.peak_count,spectral],
      [-109,basic.peak_count,Buffer.concat([scale,Buffer.from(basic.data,'base64')])]];
    const stat=statSync(media), header=Buffer.alloc(18+layers.length*8);
    header.write('QPK1');header[4]=1;header[5]=layers.length;header.writeInt32LE(8000,6);
    header.writeUInt32LE(Math.floor(stat.mtimeMs/1000)>>>0,10);header.writeUInt32LE(stat.size,14);
    layers.forEach(([div,count],i)=>{header.writeInt32LE(div,18+i*8);header.writeInt32LE(count,22+i*8);});
    writeFileSync(media+'.quapeaks',Buffer.concat([header,...layers.map(layer=>layer[2])]));
    server=await startServer(project,media,await findFreePort(),{loadWaveform:true});
    await disableOnboarding(page);
    await page.goto(server.url);
    await expect.poll(()=>page.evaluate(()=>typeof buildJson==='function')).toBe(true);
    const loaded=await page.evaluate(()=>DATA.waveform);
    expect(loaded.data).toBe(basic.data);
    expect(loaded.peak_count).toBe(6000);
    await expect.poll(async()=> (await (await page.request.get(server.url+'api/waveform')).json()).status).toBe('ready');
    const optional=await (await page.request.get(server.url+'api/waveform')).json();
    expect(JSON.stringify(optional)).toContain('u16-freq-density-base64');
    await expect(page.locator('.waveform-row').first()).toBeVisible();
    expect(JSON.parse(readFileSync(project,'utf8')).waveform).toBeUndefined();
  } finally {await server?.stop();cleanupTempDir(dir);}
});
