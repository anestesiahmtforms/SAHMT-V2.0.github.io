import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {canEnterModule} from '../worker-operational-domain/identity.js';
import {createOperationalDomainWorker} from '../worker-operational-domain/worker.js';
const source=readFileSync(new URL('../src/data.js',import.meta.url),'utf8');
const names=['listContactCatalog','syncEventMemberDirectory','saveContact','updateContactRegistrationFields'];
const code=names.map(name=>{const start=source.indexOf('export async function '+name+'(');const end=source.indexOf('\nexport ',start+1);return source.slice(start,end).replace('export ','');}).join('\n');
function fixture({deny=false,missing=false,failCommit=false}={}){
 const calls=[],reads=[],writes=[],mirrors=[],fi={project:'FI'},fa={project:'FA'};
 const current={sigla:'AA',name:'Anterior',active:true,createdByUid:'original',createdAt:'original-time',role:'staff',phone:'',email:'',whatsAppLink:'',crm:'',entryDate:''};
 const snap={id:'AA',exists:()=>!missing,data:()=>current};
 const ref=(db,collection,id)=>({db,collection,id});
 const check=db=>{assert.equal(db,fi,'no FA access');};
 const ctx=vm.createContext({db:fa,console,Set,Map,Date,JSON,Math,Number,
  assertOnlineOperation(){},globalThis:{sahmtMirrorConfirmedSource:p=>mirrors.push(p)},
  getOperationalModuleDatabase:async(station,uid)=>{calls.push({station,uid});if(deny)throw Error('MODULE_ACCESS_DENIED');return fi;},
  operationalModuleEnabled:()=>true,operationalDatabase:async()=>{throw Error('LEGACY_HELPER_FORBIDDEN');},
  doc:ref,collection:(db,name)=>({db,collection:name}),query:(r,...clauses)=>({...r,clauses}),orderBy:()=>null,limit:n=>n,
  serverTimestamp:()=> 'server-time',
  getDocsFromServer:async q=>{check(q.db);reads.push(q);return {docs:[snap]};},
  getDocFromServer:async r=>{check(r.db);reads.push(r);return snap;},
  writeBatch:db=>{check(db);const pending=[];return {set:(r,v)=>{check(r.db);pending.push({r,v});},commit:async()=>{if(failCommit)throw Error('COMMIT_FAILED');writes.push(...pending);}};},
  runTransaction:async(db,fn)=>{check(db);const pending=[];await fn({get:async r=>{check(r.db);reads.push(r);return snap;},set:(r,v)=>{check(r.db);pending.push({r,v});}});if(failCommit)throw Error('COMMIT_FAILED');writes.push(...pending);}
 });vm.runInContext(code,ctx);return {ctx,calls,reads,writes,mirrors,current};
}
const input={sigla:'AA',name:'Atual',active:true,email:'person@example.test',phone:'123',whatsAppLink:''};
test('Pessoas reads its full contact fields from FI with the current actor',async()=>{
 const f=fixture();const rows=await f.ctx.listContactCatalog({uid:'actor'});
 assert.equal(rows[0].id,'AA');assert.equal(rows[0].createdByUid,'original');
 assert.deepEqual(f.calls,[{station:'FI',uid:'actor'}]);
});
test('saveContact writes contact and event directory only in FI and preserves original authorship',async()=>{
 const f=fixture();await f.ctx.saveContact(input,'actor');
 assert.deepEqual(f.calls,[{station:'FI',uid:'actor'}]);assert.equal(f.writes.length,2);
 assert.deepEqual(f.writes.map(w=>w.r.collection),['contacts','eventMembers']);
 assert.equal(f.writes[0].v.createdByUid,'original');assert.equal(f.writes[0].v.createdAt,'original-time');assert.equal(f.writes[0].v.updatedByUid,'actor');assert.equal(f.mirrors.length,0);
});
test('registration import updates the two FI collections in one transaction and missing contact aborts all',async()=>{
 const f=fixture();await f.ctx.updateContactRegistrationFields([input],'actor');
 assert.equal(f.writes.length,2);assert.equal(f.writes[0].v.role,'staff');assert.equal(f.writes[0].v.createdAt,'original-time');
 const absent=fixture({missing:true});await assert.rejects(absent.ctx.updateContactRegistrationFields([input],'actor'));assert.equal(absent.writes.length,0);
});
test('directory sync reads FI contacts and writes only FI eventMembers',async()=>{
 const f=fixture();assert.equal(await f.ctx.syncEventMemberDirectory('actor'),1);
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].r.collection,'eventMembers');assert.equal(f.writes[0].v.updatedByUid,'actor');assert.equal(f.mirrors.length,0);
});
test('FI denial and commit errors cannot fall back, mirror or claim success',async()=>{
 for(const invoke of [c=>c.listContactCatalog({uid:'actor'}),c=>c.saveContact(input,'actor'),c=>c.updateContactRegistrationFields([input],'actor'),c=>c.syncEventMemberDirectory('actor')]){
  const f=fixture({deny:true});await assert.rejects(invoke(f.ctx),/MODULE_ACCESS_DENIED/);assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);assert.equal(f.mirrors.length,0);
 }
 for(const invoke of [c=>c.saveContact(input,'actor'),c=>c.updateContactRegistrationFields([input],'actor'),c=>c.syncEventMemberDirectory('actor')]){
  const f=fixture({failCommit:true});await assert.rejects(invoke(f.ctx),/COMMIT_FAILED/);assert.equal(f.writes.length,0);assert.equal(f.mirrors.length,0);
 }
});
test('FI accepts only an active matching local profile with peopleManage, never an unrelated grant',()=>{
 const actor={uid:'actor',email:'person@example.test'},profile={...actor,active:true,access:true,permissions:{peopleManage:true}};
 assert.equal(canEnterModule(profile,actor,'FI'),true);
 for(const patch of [{active:false},{access:false},{uid:'other'},{permissions:{usersManage:true}}])assert.equal(canEnterModule({...profile,...patch},actor,'FI'),false);
 assert.equal(canEnterModule(profile,actor,'FJ'),false);
});

test('invalid contact and import inputs perform no destination lookup or writes',async()=>{
 for(const invoke of [c=>c.saveContact({...input,sigla:'invalid'},'actor'),c=>c.saveContact(input,''),c=>c.updateContactRegistrationFields([input,input],'actor'),c=>c.syncEventMemberDirectory('')]){
  const f=fixture();await assert.rejects(invoke(f.ctx));assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
 }
});

test('FI session endpoint admits a people-only local grant after checking the current FA access gate',async()=>{
 const urls=[],actor={uid:'actor',email:'person@example.test'};
 const worker=createOperationalDomainWorker({verify:async()=>actor,createService:()=>({accessToken:async()=>'synthetic',customToken:()=> 'synthetic-custom-token'}),
 fetchImpl:async url=>{urls.push(url);return Response.json({name:url.replace('https://firestore.googleapis.com/v1/',''),fields:{uid:{stringValue:actor.uid},email:{stringValue:actor.email},active:{booleanValue:true},access:{booleanValue:true},permissions:{mapValue:{fields:{peopleManage:{booleanValue:true}}}}}});}});
 const response=await worker.fetch(new Request('https://worker.test/v1/session',{method:'POST',headers:{Origin:'https://example.test',Authorization:'Bearer synthetic-proof','Content-Type':'application/json'},body:'{}'}),
 {MODULE_STATION:'FI',MODULE_PROJECT_ID:'sahmt-operacional-fi',MODULE_CUTOVER_ACTIVE:'true',ALLOWED_ORIGINS:'https://example.test',MODULE_SERVICE_ACCOUNT_JSON:'{}'});
 assert.equal(response.status,200);assert.equal((await response.json()).uid,actor.uid);
 assert.equal(urls.length,2);assert.match(urls[0],/projects\/sahmt-17a16\/.*\/users\/actor$/);assert.match(urls[1],/projects\/sahmt-operacional-fi\/.*\/users\/actor$/);
});
