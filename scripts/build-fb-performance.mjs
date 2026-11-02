import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const result=await build({entryPoints:['fb-performance/domain.js'],bundle:true,format:'iife',globalName:'FbPerformanceDomain',write:false,target:'es2020'});
const domain=result.outputFiles[0].text;
await mkdir('.local-preview/fb-performance',{recursive:true});
const files=[{name:'FbPerformanceDomain',type:'SERVER_JS',source:domain},{name:'FbPerformance',type:'SERVER_JS',source:await readFile('apps-script-fb/FbPerformance.gs','utf8')},{name:'appsscript',type:'JSON',source:await readFile('apps-script-fb/appsscript.json','utf8')}];
await writeFile('.local-preview/fb-performance/apps-script-bundle.json',JSON.stringify({files}));
console.log(JSON.stringify({code:'FB_PERFORMANCE_BUNDLE_READY',files:files.map(f=>f.name),deployed:false}));
