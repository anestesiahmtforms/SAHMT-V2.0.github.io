import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteContinuityClient} from '../src/remote-continuity-client.js';
const now=Date.parse('2026-10-20T15:00:00Z'),day='2026-10-20';
const user={uid:'member-a',getIdToken:async()=> 'synthetic-token'};
const profile={uid:user.uid,displayName:'Pessoa sintética',email:'fixture@example.invalid',sigla:'AA',active:true,access:true,role:'temporario',permissions:{checklistRead:true,checklistWrite:true}};
const result=()=>({code:'CONTINUITY_READY',profile:structuredClone(profile),profileVerifiedAt:now-25*3600000,authorizedUntil:now+3600000,entries:[{kind:'stations',id:'all',data:[{id:'s1',name:'Arsenal',active:true}],verifiedAt:now-3600000,revision:'r1'}],operations:[{uid:user.uid,collection:'checklists',day,requestId:'stable-id',createdAt:now-3600000,data:{date:day,stationId:'s1',condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null}}],nextCursor:null});
function harness(fetcher=async()=>Response.json(result())){
 const cache=[],profiles=[],operations=[],receipts=[];let current=user,calls=0;
 const client=createRemoteContinuityClient({endpoint:'https://channel.example/v1/operational-channel',now:()=>now,getCurrentUser:()=>current,online:()=>true,fetchImpl:async(...args)=>{calls++;return fetcher(...args);},
  cacheProfile:async(...args)=>profiles.push(args),writeCache:async(...args)=>cache.push(args),listOperations:async()=>operations,
  enqueue:async operation=>{operations.push(operation);return operation.requestId;},updateOperation:async()=>{},saveReceipt:async(...args)=>receipts.push(args)});
 return {client,cache,profiles,operations,receipts,get calls(){return calls;},setUser:value=>{current=value;}};
}
test('cache vazio é reconstruído do servidor com a data original e IDs estáveis',async()=>{
 const h=harness();const value=await h.client.bootstrap(user,{day});
 assert.equal(value.profile.uid,user.uid);assert.equal(h.cache[0][1],'stations');
 assert.equal(h.profiles[0][2].validatedAt,now-25*3600000);assert.equal(h.operations[0].requestId,'stable-id');
 assert.equal(h.operations[0].createdAt,now-3600000);assert.equal(h.receipts[0][1],'stable-id');
 await h.client.bootstrap(user,{day});assert.equal(h.calls,1);assert.equal(h.operations.length,1);
});
test('resposta para outra identidade é recusada antes de gravar qualquer cache',async()=>{
 const h=harness(async()=>Response.json({...result(),profile:{...profile,uid:'other'}}));
 await assert.rejects(()=>h.client.bootstrap(user,{day}),/CONTINUITY_/);assert.equal(h.cache.length,0);assert.equal(h.profiles.length,0);
});
test('troca de conta descarta resposta tardia',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));const loading=h.client.bootstrap(user,{day});
 while(!finish)await new Promise(resolve=>setImmediate(resolve));h.setUser({uid:'other'});finish(Response.json(result()));
 await assert.rejects(()=>loading,/CONTINUITY_SESSION_CHANGED/);assert.equal(h.cache.length,0);
});
test('requisições simultâneas são coalescidas e falhas não expõem conteúdo HTTP',async()=>{
 const h=harness(async()=>Response.json({code:'CONTINUITY_PROFILE_MISSING',private:'must not escape'},{status:503}));
 const values=await Promise.allSettled([h.client.bootstrap(user,{day}),h.client.bootstrap(user,{day})]);assert.equal(h.calls,1);
 assert.equal(values[0].status,'rejected');assert.doesNotMatch(String(values[0].reason),/must not escape/);
 await assert.rejects(()=>h.client.bootstrap(user,{day}),/CONTINUITY_BACKOFF/);assert.equal(h.calls,1);
});
test('negação remota permanece durante o intervalo de espera e não reabre pelo cache',async()=>{
 const h=harness(async()=>Response.json({code:'CONTINUITY_ACCESS_DENIED'},{status:403}));
 await assert.rejects(()=>h.client.bootstrap(user,{day}),/CONTINUITY_ACCESS_DENIED/);
 await assert.rejects(()=>h.client.bootstrap(user,{day}),/CONTINUITY_ACCESS_DENIED/);assert.equal(h.calls,1);
});
