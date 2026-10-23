import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {execFileSync} from 'node:child_process';
const host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^127\.0\.0\.1:\d+$/.test(host||''))throw Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
const root='http://'+host+'/v1/projects/indicadores---sahmt/databases/(default)/documents';
const code=await readFile(new URL('../apps-script-v2/QmentumQuarterly.gs',import.meta.url),'utf8');
const request=async(path,method='GET',body)=>{const r=await fetch(root+path,{method,headers:{Authorization:'Bearer owner','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error('EMULATOR_HTTP_'+r.status);return value;};
function runtime(){const context={QMENTUM_DATA_PROJECT_:'indicadores---sahmt',firestoreRequest_:(url,options)=>{
 // Apps Script's fetch is synchronous. Run Node fetch in a child against the
 // explicitly pinned local emulator, exercising the exact production REST body.
 const suffix=String(url).replace(/^https:\/\/firestore\.googleapis\.com\/v1\/projects\/indicadores---sahmt\/databases\/\(default\)\/documents/,'');
 if(suffix===url)throw Error('FC_ENDPOINT_REQUIRED');
 return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`const r=await fetch(process.argv[1],{method:'POST',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:process.argv[2]});if(!r.ok)throw Error('EMULATOR_HTTP_'+r.status);console.log(JSON.stringify(await r.json()));`,root+suffix,options.payload],{encoding:'utf8',timeout:15000}));
 }};vm.createContext(context);vm.runInContext(code,context);return context.qmServerCommit_;}
test('real REST transaction commits a target while protecting the profile read set',async()=>{
 const profile=await request('/profiles/allowed','PATCH',{fields:{schemaVersion:{integerValue:'1'},active:{booleanValue:true}}});const name=root.replace(/^http:\/\/[^/]+\/v1\//,'')+'/months/2026-10';
 runtime()([{verify:profile.name,currentDocument:{updateTime:profile.updateTime}},{update:{name,fields:{version:{integerValue:'1'}}},currentDocument:{exists:false}}]);
 assert.equal((await request('/months/2026-10')).fields.version.integerValue,'1');
});
test('real REST stale profile aborts and creates no target',async()=>{
 const profile=await request('/profiles/revoked','PATCH',{fields:{active:{booleanValue:true}}});await request('/profiles/revoked','PATCH',{fields:{active:{booleanValue:false}}});
 assert.throws(()=>runtime()([{verify:profile.name,currentDocument:{updateTime:profile.updateTime}},{update:{name:profile.name.replace('/profiles/revoked','/months/blocked'),fields:{version:{integerValue:'1'}}},currentDocument:{exists:false}}]),/QMENTUM_VERSION_CONFLICT/);
 const r=await fetch(root+'/months/blocked',{headers:{Authorization:'Bearer owner'}});assert.equal(r.status,404);
});
test('real REST verification-only transaction commits without modifying the document',async()=>{
 const profile=await request('/profiles/verification','PATCH',{fields:{schemaVersion:{integerValue:'1'}}});runtime()([{verify:profile.name,currentDocument:{updateTime:profile.updateTime}}]);assert.equal((await request('/profiles/verification')).updateTime,profile.updateTime);
});
