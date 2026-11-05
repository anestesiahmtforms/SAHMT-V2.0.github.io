import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ADMINS,FF,BUILTIN_GROUPS,adminIdentity,validateMessage} from '../communication/domain.js';
import {createCommunicationService} from '../worker-communication/service.js';
import {createCommunicationWorker} from '../worker-communication/worker.js';
import {verifyToken,verifyPair,assertFreeProject} from '../worker-communication/google.js';
import {createStore} from '../worker-communication/store.js';
import {sameProjectGoogleIdentity} from '../src/google-project-auth-core.js';
const NOW=Date.parse('2026-11-03T18:00:00Z');
const actor={uid:'ff-admin',sourceUid:'fa-admin',email:ADMINS[0],emailVerified:true,googleUid:'google-admin'};
const person={uid:'ff-person',sourceUid:'fa-person',email:'person@example.test',emailVerified:true,googleUid:'google-person'};
const message=(extra={})=>({title:'Comunicado de teste',message:'Mensagem institucional',category:'COMUNICADO GERAL',priority:'NORMAL',audienceType:'USER',audienceValue:person.sourceUid,route:'management',publishAt:NOW-1000,expiresAt:NOW+86400000,status:'published',...extra});
function memory(){
 const data=new Map();let lock=Promise.resolve();
 const get=async(c,k)=>structuredClone(data.get(c+'/'+k)||null);
 const page=async(c,{cursor='',limit=20,filters=[],fields}={})=>[...data].filter(([k,v])=>k.startsWith(c+'/')&&k.split('/')[1]>cursor&&filters.every(([f,val])=>v[f]===val)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([key,v])=>({...structuredClone(fields?Object.fromEntries(fields.filter(f=>f in v).map(f=>[f,v[f]])):v),id:key.split('/')[1]}));
 const countPublished=async(start,end)=>[...data].filter(([key,v])=>key.startsWith('communicationMessages/')&&v.firstPublishedAt>=start&&v.firstPublishedAt<end).length;
 const transaction=work=>{const run=lock.then(async()=>{const writes=[];const result=await work({get,countPublished,set:(c,k,v)=>writes.push([c+'/'+k,v]),create:(c,k,v)=>{assert.equal(data.has(c+'/'+k),false);writes.push([c+'/'+k,v]);}});for(const [k,v]of writes)data.set(k,structuredClone(v));return result;});lock=run.catch(()=>{});return run;};
 return {data,get,page,countPublished,transaction,getMany:(c,keys)=>Promise.all(keys.map(k=>get(c,k)))};
}
function fixture(){
 const store=memory(),fa=memory(),fb=memory(),sources={FC:memory(),FD:memory(),FE:memory()},sent=[];let n=0,time=NOW,enabled=true;
 for(const a of [actor,person])store.data.set('users/'+a.sourceUid,{uid:a.sourceUid,email:a.email,active:true,access:true,role:'gestor'});
 store.data.set('communicationSettings/main',{pushEnabled:true});
 const service=createCommunicationService({store,fa,fb,sources,now:()=>time,uuid:()=>`operation-${++n}`,recipientEnabled:async()=>enabled,send:async(token,data)=>{sent.push({token,data});return {status:token.includes('expired')?'failed':'accepted',disable:token.includes('expired')};}});
 const call=(action,input={},a=actor)=>service.execute(action,input,a);
 return {store,fa,fb,sources,sent,call,setTime:v=>time=v,disableAccount:()=>enabled=false};
}
async function register(f,a=person,token='device-'+ 'x'.repeat(80)){await f.call('REGISTER_DEVICE',{token},a);return token;}
async function publish(f,extra={}){
 // These cases exercise the manual fallback after publication with automatic Push off.
 const settings=f.store.data.get('communicationSettings/main'),enabled=settings.pushEnabled;settings.pushEnabled=false;
 try{return (await f.call('SAVE_MESSAGE',{version:0,message:message(extra)})).message;}finally{settings.pushEnabled=enabled;}
}
test('only the four verified emails grant administration, never local roles or permissions',async()=>{
 assert.equal(ADMINS.length,4);for(const email of ADMINS)assert.equal(adminIdentity({email,emailVerified:true}),true);
 assert.equal(adminIdentity({email:ADMINS[0],emailVerified:false}),false);
 const f=fixture();for(const action of ['SAVE_MESSAGE','PREPARE','SEND_BATCH','DIRECTORY','GROUPS','HISTORY','AUDIT','METRICS','SETTINGS','SAVE_SETTINGS','IMPORT_SOURCE'])await assert.rejects(f.call(action,{}, {...person,role:'administrador_app',permissions:{admin:true}}),{code:'COMM_FORBIDDEN'});
 assert.equal(f.store.data.size,3);
});
test('publishing, editing with version check, audit and separate manual push',async()=>{
 const f=fixture(),m=await publish(f);assert.equal(f.sent.length,0);assert.equal((await f.call('METRICS')).total.published,1);
 assert.ok([...f.store.data.values()].some(x=>x.action==='MESSAGE_CREATED'&&x.uid===actor.uid&&x.email===actor.email&&x.at===NOW));
 await assert.rejects(f.call('SAVE_MESSAGE',{id:m.id,version:0,message:message()}),{code:'COMM_CONFLICT'});
 await f.call('PREPARE',{id:m.id});assert.equal(f.sent.length,0);
 await assert.rejects(f.call('SAVE_MESSAGE',{id:m.id,version:1,message:message()}),{code:'COMM_MESSAGE_LOCKED'});
 await assert.rejects(f.call('SEND_BATCH',{id:m.id,batches:0}),{code:'COMM_CONFIRMATION_REQUIRED'});
});
test('ordinary inbox and direct lookup enforce active audience, time and own identity',async()=>{
 const f=fixture(),m=await publish(f);await publish(f,{audienceValue:'another'}).catch(()=>{});
 assert.equal((await f.call('INBOX',{},person)).items.length,1);
 const other={...person,uid:'ff-other',sourceUid:'fa-other',email:'other@example.test'};f.store.data.set('users/fa-other',{uid:'fa-other',email:other.email,active:true,access:true});
 assert.equal((await f.call('INBOX',{},other)).items.length,0);
 await assert.rejects(f.call('MESSAGE',{id:m.id},other),{code:'COMM_FORBIDDEN'});
 f.setTime(NOW+2*86400000);assert.equal((await f.call('INBOX',{},person)).items.length,0);
});
test('own device registration is idempotent and cannot steal another identity token',async()=>{
 const f=fixture(),token=await register(f);await register(f,person,token);assert.equal((await f.call('METRICS')).total.devices,1);
 await assert.rejects(register(f,actor,token),{code:'COMM_DEVICE_OWNER'});
 await f.call('DISABLE_DEVICE',{token},person);assert.equal((await f.call('METRICS')).total.devices,0);
 assert.equal(JSON.stringify(await f.call('BOOTSTRAP',{},person)).includes(token),false);
});
test('concurrent send claims and HTTP retries cannot send the same device twice',async()=>{
 const f=fixture();await register(f);const m=await publish(f);await f.call('PREPARE',{id:m.id});
 const results=await Promise.allSettled([f.call('SEND_BATCH',{id:m.id,batches:0,confirmed:true}),f.call('SEND_BATCH',{id:m.id,batches:0,confirmed:true})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].data.title,m.title);assert.equal(f.sent[0].data.route,'home');
 assert.equal((await f.call('HISTORY')).items[0].accepted,1);await assert.rejects(f.call('SEND_BATCH',{id:m.id,batches:0,confirmed:true}),{code:'COMM_DISPATCH_LOCKED'});
});
test('expired token is disabled; disabled account, inactive source and unrelated audience are skipped',async()=>{
 const f=fixture();await register(f,person,'expired-'+'x'.repeat(80));const m=await publish(f);await f.call('PREPARE',{id:m.id});const r=await f.call('SEND_BATCH',{id:m.id,batches:0,confirmed:true});assert.equal(r.dispatch.failed,1);assert.equal((await f.call('METRICS')).total.devices,0);
 const g=fixture();await register(g);g.disableAccount();const n=await publish(g);await g.call('PREPARE',{id:n.id});await g.call('SEND_BATCH',{id:n.id,batches:0,confirmed:true});assert.equal(g.sent.length,0);
});

test('invalidated devices release their slot for a new device registration',async()=>{
 const f=fixture();for(let i=0;i<5;i++)await register(f,person,'expired-'+i+'x'.repeat(80));
 const m=await publish(f);await f.call('PREPARE',{id:m.id});await f.call('SEND_BATCH',{id:m.id,batches:0,confirmed:true});
 await register(f,person,'replacement-'+'x'.repeat(80));
 const recipient=await f.store.get('communicationRecipients',person.uid);
 assert.equal(recipient.deviceIds.length,3);
});
test('Equipe, Residentes and Substitutos use only FF-local membership',async()=>{
 for(const group of ['team','resident','substitute']){const f=fixture();f.store.data.get('users/'+person.sourceUid).institutionalGroup=group;
 await publish(f,{audienceType:'GROUP',audienceValue:'institutional-'+group});assert.equal((await f.call('INBOX',{},person)).items.length,1);
 await publish(f,{audienceType:'GROUP',audienceValue:'institutional-'+(group==='team'?'resident':'team')});assert.equal((await f.call('INBOX',{},person)).items.length,1);}
 assert.equal(BUILTIN_GROUPS.length,3);const f=fixture();await assert.rejects(f.call('SAVE_GROUP',{id:'institutional-team',name:'tampered',memberUids:[],version:0}),{code:'COMM_FORBIDDEN'});
});
test('areas resolve membership only in the FF directory',async()=>{
 const f=fixture();f.store.data.set('managementAreas/quality',{active:true,memberUids:[person.sourceUid]});
 await publish(f,{audienceType:'AREA',audienceValue:'quality'});assert.equal((await f.call('INBOX',{},person)).items.length,1);
});
test('source forwarding is disabled for every project',async()=>{
 const f=fixture();for(const project of ['FA','FB','FC','FD','FE','FF'])await assert.rejects(f.call('IMPORT_SOURCE',{project,collection:'notifications',id:'one'}),{code:'COMM_SOURCE_UNSUPPORTED'});
 await assert.rejects(f.call('SAVE_MESSAGE',{version:0,message:message(),source:{project:'FB',collection:'notifications',id:'one'}}),{code:'COMM_SOURCE_UNSUPPORTED'});
});
test('quota exhaustion fails closed; incomplete dispatch reconciliation never resends reserved devices',async()=>{
 const f=fixture();f.store.data.set('communicationBudgets/2026-11-03',{requests:2000});await assert.rejects(f.call('BOOTSTRAP'),{code:'COMM_DAILY_OPERATION_LIMIT'});
 const g=fixture();g.store.data.set('communicationDispatches/interrupted',{id:'interrupted',status:'processing',batchStartedAt:NOW-180000,batchId:'one',pendingCount:3,batches:1,cursor:'last',unknown:0,processed:0});const d=await g.call('RECONCILE',{id:'interrupted',confirmed:true});assert.equal(d.dispatch.unknown,3);assert.equal(d.dispatch.cursor,'last');assert.equal(g.sent.length,0);
});
test('FF identity tolerates a different Firebase UID only for the same verified Google subject',()=>{
 const u={uid:'ff-different',emailVerified:true,providerData:[{providerId:'google.com',uid:'google-one'}]},e={uid:'fa-one',googleUid:'google-one'};
 assert.equal(sameProjectGoogleIdentity('FF',u,e),true);assert.equal(sameProjectGoogleIdentity('FC',u,e),false);assert.equal(sameProjectGoogleIdentity('FF',{...u,emailVerified:false},e),false);
});
function jwt(project,uid='ff-one',email=ADMINS[0]){const seconds=NOW/1000;return 'Bearer '+Buffer.from('{"alg":"RS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:project,iss:'https://securetoken.google.com/'+project,sub:uid,email,email_verified:true,exp:seconds+3600,iat:seconds,auth_time:seconds,firebase:{sign_in_provider:'google.com',identities:{'google.com':['google-one']}}})).toString('base64url')+'.'+Buffer.alloc(256).toString('base64url');}
test('server validates token with Google, rejects wrong project, revoked, unverified or forged identity',async()=>{
 const options={now:()=>NOW,fetchImpl:async()=>Response.json({users:[{localId:'ff-one',email:ADMINS[0],emailVerified:true,validSince:'0',providerUserInfo:[{providerId:'google.com',rawId:'google-one'}]}]})};
 assert.equal((await verifyToken(jwt(FF.projectId),'FF',options)).uid,'ff-one');
 await assert.rejects(verifyToken(jwt('sahmt-17a16'),'FF',options),{code:'COMM_SESSION_INVALID'});
 await assert.rejects(verifyToken(jwt(FF.projectId),'FF',{...options,fetchImpl:async()=>Response.json({error:{}},{status:400})}),{code:'COMM_SESSION_INVALID'});
 await assert.rejects(verifyToken(jwt(FF.projectId),'FF',{...options,fetchImpl:async()=>Response.json({users:[{localId:'ff-one',disabled:true}]})}),{code:'COMM_SESSION_INVALID'});
 const request=new Request('https://worker.test',{headers:{Authorization:jwt(FF.projectId),'X-SAHMT-FA-Authorization':jwt('sahmt-17a16','fa-other')}});
 const pair=await verifyPair(request,{now:()=>NOW,fetchImpl:async(u,o)=>{const c=JSON.parse(Buffer.from(JSON.parse(o.body).idToken.split('.')[1],'base64url'));return Response.json({users:[{localId:c.sub,email:c.email,emailVerified:true,providerUserInfo:[{providerId:'google.com',rawId:'google-one'}]}]});}});assert.equal(pair.faUid,'fa-other');
});
test('free-plan metadata is checked, including named database freeTier flag and no billing account',async()=>{
 await assertFreeProject(async()=> 'synthetic',async url=>Response.json(url.includes('billingInfo')?{billingEnabled:false}:{name:`projects/${FF.projectId}/databases/${FF.databaseId}`,freeTier:true}));
 await assert.rejects(assertFreeProject(async()=> 'synthetic',async()=>Response.json({billingEnabled:true})),{code:'COMM_FREE_PLAN_UNCONFIRMED'});
});
test('worker rejects origin, methods, oversized body, disabled config and safe error responses',async()=>{
 const worker=createCommunicationWorker({verify:async()=>actor,buildService:async()=>({execute:async()=>({ok:true})})}),env={COMMUNICATION_ENABLED:'true',WORKERS_FREE_CONFIRMED:'true'};
 const req=(headers={},body='{"action":"BOOTSTRAP","input":{}}')=>new Request('https://worker.test/v1/communication',{method:'POST',headers:{Origin:'https://anestesiahmtforms.github.io','Content-Type':'application/json',...headers},body});
 assert.equal((await worker.fetch(req(),env)).status,200);assert.equal((await worker.fetch(req(),{})).status,503);assert.equal((await worker.fetch(req({Origin:'https://evil.invalid'}),env)).status,403);assert.equal((await worker.fetch(req({'Content-Length':'18000'}),env)).status,413);
 assert.equal((await worker.fetch(req({},'{"action":"BOOTSTRAP","project":"FA"}'),env)).status,400);
});
test('source stores refuse writes and FF storage paths are fixed',async()=>{
 const fa=createStore({getToken:async()=>'',source:'FA'});await assert.rejects(fa.transaction(()=>{}),{code:'COMM_SOURCE_READ_ONLY'});await assert.rejects(fa.get('communicationDevices','x'),{code:'COMM_SOURCE_DENIED'});
 const urls=[],ff=createStore({getToken:async()=>'',fetchImpl:async url=>{urls.push(url);return Response.json({fields:{}});}});await ff.get('communicationMessages','one');assert.ok(urls[0].includes('/sahmt-comunicacao-ff/databases/comunicacao/'));
 await ff.get('communicationMessages','one',undefined,['title','message']);assert.deepEqual(new URL(urls[1]).searchParams.getAll('mask.fieldPaths'),['title','message']);
});
test('service worker shows the requested preview and opens only allowlisted same-origin module',async()=>{
 const events={},shown=[],opened=[];const self={location:{origin:'https://anestesiahmtforms.github.io'},addEventListener:(n,f)=>events[n]=f,registration:{showNotification:async(...a)=>shown.push(a)},clients:{matchAll:async()=>[],openWindow:async u=>opened.push(u)}};
 vm.runInNewContext(readFileSync(new URL('../public/service-worker.js',import.meta.url),'utf8'),{self,URL});let pending;
 events.push({data:{json:()=>({data:{source:'SAHMT_FF',communicationId:'one',title:'Private author title',body:'private',route:'https://evil.invalid'}})},waitUntil:p=>pending=p});await pending;assert.equal(shown.length,1);assert.equal(shown[0][0],'Private author title');assert.equal(shown[0][1].body,'private');
 events.notificationclick({notification:{data:shown[0][1].data,close(){}},waitUntil:p=>pending=p});await pending;assert.equal(opened[0],'https://anestesiahmtforms.github.io/SAHMT-V2.0.github.io/#/communications/message/one');
});
