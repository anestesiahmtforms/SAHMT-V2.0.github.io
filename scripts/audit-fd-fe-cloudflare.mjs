import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const station=process.argv[2];
const targets={FD:{id:'434b7325287b58f36d214c9403819db2',email:'anestesiahmtforms4@gmail.com'},FE:{id:'fb3d38f501820ddf90764aadaa94fc89',email:'anestesiahmtforms5@gmail.com'}};
const target=targets[station];if(!target)throw Error('STATION_REQUIRED');
const cwd=resolve('.local-preview',station.toLowerCase()+'-cloudflare');
const cli=resolve('node_modules/wrangler/bin/wrangler.js');
const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'};
delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_API_KEY;delete env.CLOUDFLARE_EMAIL;
try {
 const credential=JSON.parse(execFileSync(process.execPath,[cli,'auth','token','--json'],{cwd,env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));
 if(credential.type!=='oauth'||typeof credential.token!=='string')throw Error('OAUTH_REQUIRED');
 async function get(path){
  const r=await fetch('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:'Bearer '+credential.token},redirect:'error',signal:AbortSignal.timeout(25000)});
  const body=await r.json();return {status:r.status,ok:r.ok&&body.success===true,data:body.result};
 }
 const user=await get('/user');if(!user.ok||user.data.email!==target.email)throw Error('IDENTITY_MISMATCH');
 const base='/accounts/'+target.id;
 const account=await get(base);if(!account.ok||account.data.id!==target.id)throw Error('ACCOUNT_MISMATCH');
 const [scripts,subdomain,settings,subscriptions]=await Promise.all([
  get(base+'/workers/scripts'),get(base+'/workers/subdomain'),get(base+'/workers/account-settings'),get(base+'/subscriptions')
 ]);
 const report={capturedAt:new Date().toISOString(),station,accountId:target.id,authenticatedEmail:user.data.email,
  workers:{status:scripts.status,names:scripts.ok?scripts.data.map(w=>w.id):[]},
  subdomain:{status:subdomain.status,value:subdomain.ok?subdomain.data.subdomain:null},
  settings:{status:settings.status,defaultUsageModel:settings.ok?settings.data.default_usage_model:null},
  subscriptions:{status:subscriptions.status,plans:subscriptions.ok?subscriptions.data.map(s=>({state:s.state,plan:s.rate_plan?.public_name||s.rate_plan?.id})):[]},
  cloudMutations:0,secretValuesRecorded:false};
 await mkdir('docs/superpowers/reports',{recursive:true});
 await writeFile(`docs/superpowers/reports/2026-11-01-${station.toLowerCase()}-cloudflare-inventory.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({code:/^[A-Z_]+$/.test(error.message)?error.message:'CLOUDFLARE_INVENTORY_FAILED',cloudMutations:0}));process.exitCode=1;}
