import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
const source=readFileSync(new URL('../apps-script-v2/OperationalContinuitySync.gs',import.meta.url),'utf8');
test('fila remota vazia não consulta Firestore nem token OAuth',()=>{
 const p={getProperty:key=>key==='SAHMT_CONTINUITY_SYNC_ENABLED'?'YES':null},ctx=vm.createContext({PropertiesService:{getScriptProperties:()=>p},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},console,Date,ScriptApp:{getOAuthToken:()=>assert.fail('No OAuth call')}});
 vm.runInContext(source,ctx);ctx.ocsRemote_=()=>({code:'CONTINUITY_DRAIN',operations:[]});ctx.ocsFirestore_=()=>assert.fail('No Firestore call');
 assert.equal(ctx.sincronizarCanalOperacionalRemotoV1().code,'CONTINUITY_SYNC_IDLE');
});
test('cota esgotada abre circuito por uma hora e preserva operações remotas',()=>{
 const values=new Map([['SAHMT_CONTINUITY_SYNC_ENABLED','YES']]);const p={getProperty:key=>values.get(key),setProperty:(key,value)=>values.set(key,value)};
 const ctx=vm.createContext({PropertiesService:{getScriptProperties:()=>p},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},console:{log(){}},Date});vm.runInContext(source,ctx);
 ctx.ocsRemote_=body=>body.action==='claim'?{code:'CONTINUITY_CLAIMED'}:{code:'CONTINUITY_DRAIN',operations:[{uid:'synthetic',requestId:'stable'}]};ctx.ocsGet_=()=>{throw Error('CONTINUITY_FIRESTORE_429');};
 assert.equal(ctx.sincronizarCanalOperacionalRemotoV1().code,'CONTINUITY_FIRESTORE_429');assert.ok(Number(values.get('SAHMT_CONTINUITY_PAUSE_UNTIL'))>Date.now());
 ctx.ocsRemote_=()=>assert.fail('Paused must not poll');assert.equal(ctx.sincronizarCanalOperacionalRemotoV1().code,'CONTINUITY_SYNC_PAUSED');
});
test('commit enfileira apenas caminhos alterados e só uma prova direcionada é feita',()=>{
 const values=new Map([['SAHMT_CONTINUITY_SYNC_ENABLED','YES']]);const p={getProperty:key=>values.get(key),getProperties:()=>Object.fromEntries(values),setProperty:(key,value)=>values.set(key,value),deleteProperty:key=>values.delete(key)};
 const ctx=vm.createContext({PropertiesService:{getScriptProperties:()=>p},Utilities:{DigestAlgorithm:{SHA_256:1},computeDigest:()=>[1],base64EncodeWebSafe:()=> 'path-key',getUuid:()=> 'revision'},console:{log(){}},Date});vm.runInContext(source,ctx);
 let reads=0,pushes=0;ctx.ocsFirestore_=()=>{reads++;return {fields:{name:{stringValue:'Nova escala'}}};};ctx.ocsRemote_=()=>pushes++;
 const payload=JSON.stringify({writes:[{update:{name:'projects/sahmt-17a16/databases/(default)/documents/scheduleDays/2026-10-21'}}]});
 ctx.ocsMirrorCommitted_('https://firestore.googleapis.com/documents:commit',{method:'post',payload},{writeResults:[{}]});
 assert.equal(reads,0);assert.ok([...values.keys()].some(key=>key.startsWith('SAHMT_CONTINUITY_DIRTY_')));
 assert.equal(ctx.ocsFlushSources_(),1);assert.equal(reads,1);assert.equal(pushes,1);
 assert.equal(ctx.ocsFlushSources_(),0);assert.equal(reads,1);
});
