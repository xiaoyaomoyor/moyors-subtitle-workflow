// npm ci --ignore-scripts && node scripts/build_subtitle_renderer.mjs
// Only build-time dependencies are installed; shipped assets work offline.
import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='web/vendor/jassub';
const textFile=text=>text.replaceAll('\r\n','\n').replace(/[ \t]+$/gm,'');
await mkdir(out+'/licenses',{recursive:true});
for(const [input,output] of [['dist/jassub.js','jassub.js'],['dist/worker/worker.js','worker.js']])
  await build({entryPoints:['node_modules/jassub/'+input],bundle:true,format:'esm',platform:'browser',outfile:out+'/'+output});
await copyFile('node_modules/jassub/dist/wasm/jassub-worker.wasm',out+'/libass.wasm');
const packages={};
for(const name of ['jassub','abslink','lfa-ponyfill','rvfc-polyfill','throughput']) {
  const directory='node_modules/'+name,info=JSON.parse(await readFile(directory+'/package.json','utf8'));
  packages[name]={version:info.version,license:info.license,source:`https://registry.npmjs.org/${name}/-/${name}-${info.version}.tgz`};
  await writeFile(`${out}/licenses/${name}-package.json`,JSON.stringify(info,null,2)+'\n');
  for(const file of await readdir(directory))if(/^readme/i.test(file))
    await writeFile(`${out}/licenses/${name}-${file}.txt`,textFile(await readFile(directory+'/'+file,'utf8')));
  for(const file of await readdir(directory))if(/^(license|licence|copying)/i.test(file))
    await writeFile(`${out}/licenses/${name}-${file}.txt`,textFile(await readFile(directory+'/'+file,'utf8')));
}
const files={};for(const file of ['jassub.js','worker.js','libass.wasm'])files[file]=createHash('sha256').update(await readFile(out+'/'+file)).digest('hex');
await writeFile(out+'/SOURCES.json',JSON.stringify({packages,files,build:'npm ci --ignore-scripts; node scripts/build_subtitle_renderer.mjs',
  upstreamSource:'https://github.com/ThaUnknown/jassub',wasmSourceReference:'b78bc67194d4b63fab8bf82db54be8cec31fa207',
  note:'WASM is the unmodified binary from the pinned npm package. Source reference records upstream source inspected at integration; npm does not publish gitHead.'},null,2)+'\n');
