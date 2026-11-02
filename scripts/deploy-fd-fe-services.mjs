import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {targets,demand,cloudflare,unprotect,report} from './lib/fd-fe-release.js';
import {indicatorServiceToken} from '../worker-indicators/auth.js';
import {feServiceToken} from '../worker-fe-surveys/auth.js';
const station=process.argv[2],target=targets[station];demand(target,'RELEASE_STATION_INVALID');
const {request}=await cloudflare(station),config=JSON.parse(await readFile(target.config,'utf8'));
demand(config.account_id===target.account&&config.name===target.worker,'RELEASE_CONFIG_MISMATCH');
const credentials=await unprotect(station+'-service-key');
const getAccessToken=(station==='FD'?indicatorServiceToken:feServiceToken)({credentials});
const token=await getAccessToken();
// Read-only probes prove the actual service key works; they create no points.
const reads=station==='FD'?[[target.project,'fdPerformanceRuntime/current'],['sahmt-17a16','users/sahmt-fd-executor-access-probe-v1']]:[[target.project,'fePerformanceRuntime/current'],['sahmt-gestao-5ae66','users/sahmt-fe-executor-access-probe-v1']];
for(const [project,path] of reads){const r=await fetch('https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});await r.body?.cancel();demand([200,404].includes(r.status),'RELEASE_EXECUTOR_READ_'+r.status);}
const bundle=await build({entryPoints:[target.entry],bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*'],write:false,minify:false});
demand(bundle.outputFiles.length===1,'RELEASE_BUNDLE_INVALID');
const metadata={main_module:'index.js',compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,
 bindings:[...Object.entries(config.vars).map(([name,text])=>({type:'plain_text',name,text})),{type:'secret_text',name:target.secret,text:JSON.stringify(credentials)}],
 observability:{enabled:false},logpush:false};
const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));
form.set('index.js',new Blob([bundle.outputFiles[0].text],{type:'application/javascript+module'}),'index.js');
const path='/workers/scripts/'+target.worker;
const deployed=await request(path,{method:'PUT',body:form});
await request(path+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}});
const settings=await request(path+'/settings');
demand(settings.bindings.some(b=>b.name===target.secret&&b.type==='secret_text'),'RELEASE_SECRET_READBACK_FAILED');
const result={station,project:target.project,account:target.account,worker:target.worker,url:'https://'+target.worker+'.'+target.subdomain+'.workers.dev',deploymentId:deployed.deployment_id||null,modified:deployed.modified_on,enabled:true,performanceRuntimeActivated:false,scheduledTriggersInstalled:false,billingChanges:0,businessWrites:0,at:new Date().toISOString()};
await report('2026-11-01-'+station.toLowerCase()+'-worker-deployed',result);console.log(JSON.stringify(result));
