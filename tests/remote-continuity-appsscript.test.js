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
 ctx.ocsRemote_=()=>({code:'CONTINUITY_DRAIN',operations:[{uid:'synthetic'}]});ctx.ocsGet_=()=>{throw Error('CONTINUITY_FIRESTORE_429');};
 assert.equal(ctx.sincronizarCanalOperacionalRemotoV1().code,'CONTINUITY_FIRESTORE_429');assert.ok(Number(values.get('SAHMT_CONTINUITY_PAUSE_UNTIL'))>Date.now());
 ctx.ocsRemote_=()=>assert.fail('Paused must not poll');assert.equal(ctx.sincronizarCanalOperacionalRemotoV1().code,'CONTINUITY_SYNC_PAUSED');
});
