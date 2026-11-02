import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const specs={FD:{id:'434b7325287b58f36d214c9403819db2',email:'anestesiahmtforms4@gmail.com',subdomain:'anestesiahmtforms4'},FE:{id:'fb3d38f501820ddf90764aadaa94fc89',email:'anestesiahmtforms5@gmail.com',subdomain:'anestesiahmtforms5'}};
const station=process.argv[2],spec=specs[station];if(!spec)throw Error('STATION_REQUIRED');
try{
 const proof=JSON.parse(await readFile('docs/superpowers/reports/2026-11-01-cloudflare-free-confirmation.json','utf8'));
 if(proof.accounts?.[station]!==spec.id||proof.workersFreeConfirmed!==true||proof.paidActionsAllowed!==false)throw Error('FREE_PLAN_CONFIRMATION_REQUIRED');
 const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'};
 delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_API_KEY;delete env.CLOUDFLARE_EMAIL;
 const credential=JSON.parse(execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'auth','token','--json'],{cwd:resolve('.local-preview',station.toLowerCase()+'-cloudflare'),env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));
 if(credential.type!=='oauth'||!credential.token)throw Error('OAUTH_REQUIRED');
 const base='/accounts/'+spec.id;
 async function request(path,body){
  if(body!==undefined&&path!==base+'/workers/subdomain')throw Error('MUTATION_PATH_DENIED');
  const response=await fetch('https://api.cloudflare.com/client/v4'+path,{method:body===undefined?'GET':'PUT',headers:{Authorization:'Bearer '+credential.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
  const data=await response.json();return {status:response.status,ok:response.ok&&data.success===true,data:data.result};
 }
 const user=await request('/user');if(!user.ok||user.data.email!==spec.email)throw Error('IDENTITY_MISMATCH');
 const account=await request(base);if(!account.ok||account.data.id!==spec.id)throw Error('ACCOUNT_MISMATCH');
 let sub=await request(base+'/workers/subdomain'),created=false;
 if(sub.status===404){
  sub=await request(base+'/workers/subdomain',{subdomain:spec.subdomain});
  if(!sub.ok)throw Error('SUBDOMAIN_CREATION_FAILED');created=true;
 }
 if(!sub.ok||sub.data.subdomain!==spec.subdomain)throw Error('SUBDOMAIN_MISMATCH');
 const verified=await request(base+'/workers/subdomain');if(!verified.ok||verified.data.subdomain!==spec.subdomain)throw Error('SUBDOMAIN_READBACK_FAILED');
 const report={capturedAt:new Date().toISOString(),station,accountId:spec.id,subdomain:spec.subdomain+'.workers.dev',created,workersCreated:0,billingChanges:0,businessWrites:0};
 await writeFile(`docs/superpowers/reports/2026-11-01-${station.toLowerCase()}-cloudflare-prepared.json`,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}catch(e){console.error(JSON.stringify({code:/^[A-Z_]+$/.test(e.message)?e.message:'CLOUDFLARE_PREPARATION_FAILED'}));process.exitCode=1;}
