import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {google,protect,unprotect,demand} from './lib/fd-fe-release.js';
import {googleFbClient} from './lib/google-fb-client.js';
import {prepareFbScript} from './lib/prepare-fb-script.js';
const target={project:'sahmt-gestao-5ae66',email:'anestesiahmtforms2@gmail.com',account:'679464db2379db8562b62ae982f30471',folder:'1SiIvED7gjlsA0tA5SqGAUE3U3jCHRuSj',worker:'sahmt-fb-performance',subdomain:'anestesiahmtforms2'};
const apply=process.argv.includes('--apply');
if(!apply){console.log(JSON.stringify({code:'FB_PREPARATION_PLAN',target,apply:false,workerEnabled:false,readerPermissions:['datastore.entities.get','datastore.entities.list'],externalProjectPermissions:[],billingChanges:0,activationRequiresCentralCutover:true}));process.exit(0);}
const dir=resolve('.local-preview/fb-performance');await mkdir(dir,{recursive:true});
// Each identity is explicitly checked; an open browser tab is not an API session.
const env={...process.env,CLOUDFLARE_AUTH_USE_KEYRING:'true',WRANGLER_WRITE_LOGS:'false',WRANGLER_SEND_METRICS:'false'};
for(const k of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL'])delete env[k];
let credential;try{credential=JSON.parse(execFileSync(process.execPath,[resolve('node_modules/wrangler/bin/wrangler.js'),'auth','token','--json','--profile','sahmt-fb-isolation'],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:40000}));}catch{throw Error('FB_CF_CREDENTIAL_UNAVAILABLE');}
demand(credential.type==='oauth','FB_CLOUDFLARE_LOGIN_REQUIRED');
async function cf(path,{method='GET',body,missing=false}={}){
 demand(path==='/user'&&method==='GET'||path==='/accounts/'+target.account||path.startsWith('/accounts/'+target.account+'/workers/'),'FB_CF_SCOPE_DENIED');
 const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+credential.token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},...(body?{body:body instanceof FormData?body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000),redirect:'error'});
 if(missing&&r.status===404)return null;const data=await r.json();demand(r.ok&&data.success===true,'FB_CF_HTTP_'+r.status);return data.result;
}
demand((await cf('/user')).email===target.email,'FB_CF_IDENTITY_MISMATCH');demand((await cf('/accounts/'+target.account)).id===target.account,'FB_CF_ACCOUNT_MISMATCH');
const owner=await firebaseCliAccountToken(target.email);
demand((await google('https://cloudbilling.googleapis.com/v1/projects/'+target.project+'/billingInfo',owner)).billingEnabled===false,'FB_BILLING_MUST_BE_DISABLED');
// No free/paid plan APIs are mutated. An explicit verified Free record is required.
const plan=JSON.parse(await readFile(resolve(dir,'workers-free-confirmed.json'),'utf8'));
demand(plan.accountId===target.account&&plan.workersFreeConfirmed===true,'FB_WORKERS_FREE_CONFIRMATION_REQUIRED');
const {request:admin}=await googleFbClient();
const folder=await admin('https://www.googleapis.com/drive/v3/files/'+target.folder+'?fields=id,mimeType,capabilities');
demand(folder.id===target.folder&&folder.mimeType==='application/vnd.google-apps.folder'&&folder.capabilities?.canAddChildren===true,'FB_DRIVE_FOLDER_NOT_WRITABLE');
const sa='fb-performance-reader@'+target.project+'.iam.gserviceaccount.com',serviceUrl='https://iam.googleapis.com/v1/projects/'+target.project+'/serviceAccounts/'+sa;
let account=await google(serviceUrl,owner,undefined,'GET',true);
if(!account)account=await google('https://iam.googleapis.com/v1/projects/'+target.project+'/serviceAccounts',owner,{accountId:'fb-performance-reader',serviceAccount:{displayName:'FB performance read-only API'}});
demand(account.email===sa&&!account.disabled,'FB_READER_IDENTITY_INVALID');
const permissions=['datastore.entities.get','datastore.entities.list'],roleId='sahmtFbPerformanceReader',roleName='projects/'+target.project+'/roles/'+roleId;
let role=await google('https://iam.googleapis.com/v1/'+roleName,owner,undefined,'GET',true);
if(!role)role=await google('https://iam.googleapis.com/v1/projects/'+target.project+'/roles',owner,{roleId,role:{title:roleId,stage:'GA',includedPermissions:permissions}});
demand(!role.deleted&&JSON.stringify([...role.includedPermissions].sort())===JSON.stringify([...permissions].sort()),'FB_READER_ROLE_CONFLICT');
const policyUrl='https://cloudresourcemanager.googleapis.com/v1/projects/'+target.project;
const policy=await google(policyUrl+':getIamPolicy',owner,{options:{requestedPolicyVersion:3}});await protect('FB-iam-before',policy);
const bindings=policy.bindings||[],member='serviceAccount:'+sa;
demand(!bindings.some(b=>b.members?.includes(member)&&b.role!==roleName),'FB_READER_UNEXPECTED_ROLE');
let binding=bindings.find(b=>b.role===roleName&&!b.condition);
if(!binding?.members.includes(member)){if(binding)binding.members.push(member);else bindings.push({role:roleName,members:[member]});await google(policyUrl+':setIamPolicy',owner,{policy:{...policy,bindings}});}
let key;try{key=await unprotect('FB-reader-key');}catch(e){if(e.code!=='ENOENT')throw e;}
if(!key){const response=await google(serviceUrl+'/keys',owner,{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});key=JSON.parse(Buffer.from(response.privateKeyData,'base64'));await protect('FB-reader-key',key);}
demand(key.project_id===target.project&&key.client_email===sa,'FB_KEY_BINDING_INVALID');
const prefix='/accounts/'+target.account+'/workers';
let subdomain=await cf(prefix+'/subdomain',{missing:true});
if(!subdomain)subdomain=await cf(prefix+'/subdomain',{method:'PUT',body:{subdomain:target.subdomain}});
demand(subdomain.subdomain===target.subdomain,'FB_SUBDOMAIN_MISMATCH');
const config=JSON.parse(await readFile('worker-fb-performance/wrangler.jsonc','utf8'));
const bundle=await build({entryPoints:['worker-fb-performance/worker.js'],bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*'],write:false});
const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'index.js',compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,bindings:[...Object.entries(config.vars).map(([name,text])=>({type:'plain_text',name,text})),{name:'FB_PERFORMANCE_SERVICE_ACCOUNT_JSON',type:'secret_text',text:JSON.stringify(key)}],observability:{enabled:false}})],{type:'application/json'}));form.set('index.js',new Blob([bundle.outputFiles[0].text],{type:'application/javascript+module'}),'index.js');
await cf(prefix+'/scripts/'+target.worker,{method:'PUT',body:form});await cf(prefix+'/scripts/'+target.worker+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}});
const script=await prepareFbScript({request:admin,dir,folderId:target.folder});
const report={code:'FB_EXECUTOR_PREPARED',...target,scriptId:script.scriptId,folderMovement:script.folderMovement,workerEnabled:false,performanceActivated:false,billingChanges:0,businessWrites:0,credentialsReadOnly:true,at:new Date().toISOString()};await writeFile(resolve(dir,'prepared.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
