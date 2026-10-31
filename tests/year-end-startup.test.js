import test from 'node:test';
import assert from 'node:assert/strict';
import {createYearEndStartup} from '../src/year-end-startup.js';
const session=uid=>({status:'signed-in',user:{uid,email:uid+'@example.invalid',emailVerified:true},profile:{uid,email:uid+'@example.invalid',active:true,access:true}});
const participation={sigla:'AB',requireGroup:true,canParticipate:true};
const record=uid=>({uid,sigla:'AB',plantao:'natal',grupo:'reveillon',position:1});
const flush=()=>new Promise(setImmediate);

test('only server-approved participants see the temporary card; residents, signed-out sessions and disabled campaign do not',async()=>{
 for(const options of [{enabled:false},{participation:{...participation,canParticipate:false}},{error:true},{resident:true}]){
  let reads=0;const banner=createYearEndStartup({enabled:options.enabled,readStatus:async()=>{reads++;if(options.error)throw Error('unavailable');return {participation:options.participation||participation,own:null};}});
  const s=session('one');if(options.resident)s.profile.memberCategories=['RESIDENTE_1'];
  banner.setSession(s);await flush();assert.equal(banner.visible,false);
  if(options.enabled===false||options.resident)assert.equal(reads,0);
 }
 const banner=createYearEndStartup({readStatus:()=>assert.fail('signed out must not read')});banner.setSession({status:'signed-out'});assert.equal(banner.visible,false);
});

test('manual closing affects only this opening; completion is checked again from the server on another opening',async()=>{
 let own=null,reads=0;const make=()=>createYearEndStartup({readStatus:async()=>{reads++;return {participation,own};}});
 const first=make();first.setSession(session('one'));await flush();assert.equal(first.visible,true);
 first.dismiss();assert.equal(first.visible,false);first.setSession(session('one'));await flush();assert.equal(reads,1);
 const next=make();next.setSession(session('one'));await flush();assert.equal(next.visible,true);
 own=record('one');const anotherDevice=make();anotherDevice.setSession(session('one'));await flush();assert.equal(anotherDevice.status,'complete');assert.equal(anotherDevice.visible,false);
});

test('partial or foreign records never suppress the reminder and failed saves cannot mark completion',async()=>{
 for(const own of [null,{...record('one'),grupo:null},record('other'),{...record('one'),sigla:'ZZ'},{...record('one'),position:0}]){
  const banner=createYearEndStartup({readStatus:async()=>({participation,own})});banner.setSession(session('one'));await flush();assert.equal(banner.visible,true);
  assert.equal(banner.confirm('other',record('other'),participation),false);assert.equal(banner.confirm('one',{...record('one'),plantao:null},participation),false);
  assert.equal(banner.confirm('one',record('one'),participation),true);assert.equal(banner.visible,false);
 }
 const exemption={...participation,sigla:'FR',requireGroup:false};const banner=createYearEndStartup({readStatus:async()=>({participation:exemption,own:{...record('one'),sigla:'FR',grupo:null}})});banner.setSession(session('one'));await flush();assert.equal(banner.status,'complete');
});

test('a late response for another account cannot hide or revive the current account reminder',async()=>{
 const requests=[];const banner=createYearEndStartup({readStatus:({uid,isCurrent})=>new Promise(resolve=>requests.push({uid,isCurrent,resolve}))});
 banner.setSession(session('one'));await flush();banner.setSession(session('two'));await flush();
 requests[1].resolve({participation,own:null});await flush();assert.equal(banner.visible,true);
 assert.equal(requests[0].isCurrent(),false);requests[0].resolve({participation,own:record('one')});await flush();assert.equal(banner.visible,true);
 banner.setSession({status:'signed-out'});assert.equal(banner.visible,false);
});

test('cached profile waits for online validation without losing a manual dismissal in the same opening',async()=>{
 let reads=0;const banner=createYearEndStartup({readStatus:async()=>{reads++;return {participation,own:null};}});
 banner.setSession({...session('one'),offline:true,validatingProfile:true});await flush();assert.equal(reads,0);
 banner.setSession(session('one'));await flush();assert.equal(reads,1);assert.equal(banner.visible,true);
 banner.dismiss();banner.setSession({status:'auth-limited',user:{uid:'one'}});banner.setSession(session('one'));await flush();assert.equal(banner.visible,false);
});
