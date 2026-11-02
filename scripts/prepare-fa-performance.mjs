import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {google,protect,unprotect,demand} from './lib/fd-fe-release.js';
import {faPerformanceCloudflare} from './lib/fa-performance-cloudflare.js';

const target={project:'sahmt-17a16',email:'anestesiahmtforms@gmail.com',account:'1851e9f4cd5f026371beaa2c5a85f1b8',folder:'1QaZ3-QOGXZruz-Rk8WkJdcG_mckSMS5-',worker:'sahmt-fa-performance',subdomain:'anestesiahmtforms'};
const apply=process.argv.includes('--apply');
if(!apply){console.log(JSON.stringify({code:'FA_PREPARATION_PLAN',target,apply:false,workerEnabled:false,readerPermissions:['datastore.entities.get','datastore.entities.list'],externalProjectPermissions:[],billingChanges:0,activationRequiresInitialCycle:true}));process.exit(0);}
const dir=resolve('.local-preview/fa-performance');await mkdir(dir,{recursive:true});
// Each identity is explicitly checked; an open browser tab is not an API session.
const {request:cf}=await faPerformanceCloudflare();
const owner=await firebaseCliAccountToken(target.email);
demand((await google('https://cloudbilling.googleapis.com/v1/projects/'+target.project+'/billingInfo',owner)).billingEnabled===false,'FA_BILLING_MUST_BE_DISABLED');
// No free/paid plan APIs are mutated. An explicit verified Free record is required.
const plan=JSON.parse(await readFile(resolve(dir,'workers-free-confirmed.json'),'utf8'));
demand(plan.accountId===target.account&&plan.workersFreeConfirmed===true,'FA_WORKERS_FREE_CONFIRMATION_REQUIRED');
const sa='fa-performance-reader@'+target.project+'.iam.gserviceaccount.com',serviceUrl='https://iam.googleapis.com/v1/projects/'+target.project+'/serviceAccounts/'+sa;
let account=await google(serviceUrl,owner,undefined,'GET',true);
if(!account)account=await google('https://iam.googleapis.com/v1/projects/'+target.project+'/serviceAccounts',owner,{accountId:'fa-performance-reader',serviceAccount:{displayName:'FA performance read-only API'}});
demand(account.email===sa&&!account.disabled,'FA_READER_IDENTITY_INVALID');
const permissions=['datastore.entities.get','datastore.entities.list'],roleId='sahmtFaPerformanceReader',roleName='projects/'+target.project+'/roles/'+roleId;
let role=await google('https://iam.googleapis.com/v1/'+roleName,owner,undefined,'GET',true);
if(!role)role=await google('https://iam.googleapis.com/v1/projects/'+target.project+'/roles',owner,{roleId,role:{title:roleId,stage:'GA',includedPermissions:permissions}});
demand(!role.deleted&&JSON.stringify([...role.includedPermissions].sort())===JSON.stringify([...permissions].sort()),'FA_READER_ROLE_CONFLICT');
const policyUrl='https://cloudresourcemanager.googleapis.com/v1/projects/'+target.project;
const policy=await google(policyUrl+':getIamPolicy',owner,{options:{requestedPolicyVersion:3}});await protect('FA-iam-before',policy);
const bindings=policy.bindings||[],member='serviceAccount:'+sa;
demand(!bindings.some(b=>b.members?.includes(member)&&b.role!==roleName),'FA_READER_UNEXPECTED_ROLE');
let binding=bindings.find(b=>b.role===roleName&&!b.condition);
if(!binding?.members.includes(member)){if(binding)binding.members.push(member);else bindings.push({role:roleName,members:[member]});await google(policyUrl+':setIamPolicy',owner,{policy:{...policy,bindings}});}
let key;try{key=await unprotect('FA-reader-key');}catch(e){if(e.code!=='ENOENT')throw e;}
if(!key){const response=await google(serviceUrl+'/keys',owner,{privateKeyType:'TYPE_GOOGLE_CREDENTIALS_FILE',keyAlgorithm:'KEY_ALG_RSA_2048'});key=JSON.parse(Buffer.from(response.privateKeyData,'base64'));await protect('FA-reader-key',key);}
demand(key.project_id===target.project&&key.client_email===sa,'FA_KEY_BINDING_INVALID');
const prefix='/accounts/'+target.account+'/workers';
let subdomain=await cf(prefix+'/subdomain',{missing:true});
if(!subdomain)subdomain=await cf(prefix+'/subdomain',{method:'PUT',body:{subdomain:target.subdomain}});
demand(subdomain.subdomain===target.subdomain,'FA_SUBDOMAIN_MISMATCH');
const config=JSON.parse(await readFile('worker-fa-performance/wrangler.jsonc','utf8'));
const bundle=await build({entryPoints:['worker-fa-performance/worker.js'],bundle:true,format:'esm',platform:'node',target:'es2022',external:['node:*'],write:false});
const form=new FormData();form.set('metadata',new Blob([JSON.stringify({main_module:'index.js',compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags,bindings:[...Object.entries(config.vars).map(([name,text])=>({type:'plain_text',name,text})),{name:'FA_PERFORMANCE_SERVICE_ACCOUNT_JSON',type:'secret_text',text:JSON.stringify(key)}],observability:{enabled:false}})],{type:'application/json'}));form.set('index.js',new Blob([bundle.outputFiles[0].text],{type:'application/javascript+module'}),'index.js');
await cf(prefix+'/scripts/'+target.worker,{method:'PUT',body:form});await cf(prefix+'/scripts/'+target.worker+'/subdomain',{method:'POST',body:{enabled:true,previews_enabled:false}});
const indexRoot='https://firestore.googleapis.com/v1/projects/'+target.project+'/databases/(default)/collectionGroups/faPerformanceLedger/indexes';
const indexFields=[{fieldPath:'uid',order:'ASCENDING'},{fieldPath:'createdAt',order:'DESCENDING'}];
const indexes=await google(indexRoot,owner);
if(!(indexes.indexes||[]).some(i=>i.name?.startsWith(indexRoot+'/')&&i.queryScope==='COLLECTION'&&i.fields?.[0]?.fieldPath==='uid'&&i.fields?.[1]?.fieldPath==='createdAt'&&i.fields?.[1]?.order==='DESCENDING'))await google(indexRoot,owner,{queryScope:'COLLECTION',fields:indexFields});
const report={code:'FA_EXECUTOR_PREPARED',...target,workerEnabled:false,performanceActivated:false,billingChanges:0,businessWrites:0,credentialsReadOnly:true,at:new Date().toISOString()};await writeFile(resolve(dir,'prepared.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
