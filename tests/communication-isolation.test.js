import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommunicationService} from '../worker-communication/service.js';
import {createStore} from '../worker-communication/store.js';
import {ADMINS} from '../communication/domain.js';
const now=Date.parse('2026-11-04T18:00:00Z');
const actor={uid:'ff-admin',email:ADMINS[0],emailVerified:true,googleUid:'g-admin'};
function fixture(){
 const data=new Map([
  ['users/local-admin',{uid:'local-admin',ffUid:actor.uid,email:actor.email,active:true,access:true,role:'administrador_app'}],
  ['users/local-person',{uid:'local-person',ffUid:'ff-person',email:'person@example.test',displayName:'Pessoa',sigla:'AB',active:true,access:true,institutionalGroup:'team'}],
  ['communicationSettings/main',{pushEnabled:false}],
  ['communicationMessages/notice',{id:'notice',title:'Aviso',message:'Aviso local',status:'published',publishAt:now-1000,expiresAt:now+86400000,audienceType:'GROUP',audienceValue:'institutional-team'}]
 ]),calls=[];
 const get=async(c,k)=>structuredClone(data.get(c+'/'+k)||null);
 const page=async(c,{filters=[],cursor='',limit=20}={})=>[...data].filter(([k,v])=>k.startsWith(c+'/')&&k.split('/')[1]>cursor&&filters.every(([f,val])=>v[f]===val)).slice(0,limit).map(([k,v])=>({...structuredClone(v),id:k.split('/')[1]}));
 const store={get,page,getMany:(c,ks)=>Promise.all(ks.map(k=>get(c,k))),countPublished:async()=>0,transaction:async work=>work({get,countPublished:async()=>0,set:(c,k,v)=>data.set(c+'/'+k,v),create:(c,k,v)=>data.set(c+'/'+k,v)})};
 const foreign=new Proxy({},{get:(_t,key)=>async()=>{calls.push(key);throw Error('FOREIGN_FIREBASE_FORBIDDEN');}});
 const service=createCommunicationService({store,fa:foreign,fb:foreign,sources:{FC:foreign,FD:foreign,FE:foreign},now:()=>now,uuid:()=>crypto.randomUUID(),recipientEnabled:async()=>true,send:async()=>({status:'accepted'})});
 return {data,calls,execute:(action,input={},identity=actor)=>service.execute(action,input,identity)};
}
for(const action of ['BOOTSTRAP','DIRECTORY','GROUPS','AREAS','PUSH_DEVICE_DIRECTORY','INBOX','SETTINGS'])test(`${action} uses FF even when every foreign Firebase is inaccessible`,async()=>{
 const f=fixture();await f.execute(action);assert.deepEqual(f.calls,[]);
});
test('institutional membership and recipient identity are resolved in FF',async()=>{
 const f=fixture(),r=await f.execute('INBOX',{}, {uid:'ff-person',email:'person@example.test',emailVerified:true,googleUid:'g-person'});
 assert.equal(r.items[0]?.id,'notice');assert.deepEqual(f.calls,[]);
});
test('foreign import attempts fail without reading another project',async()=>{
 for(const project of ['FA','FB','FC','FD','FE']){const f=fixture();await assert.rejects(f.execute('IMPORT_SOURCE',{project,collection:'notifications',id:'test'}),e=>['COMM_SOURCE_UNSUPPORTED','COMM_INVALID_ACTION'].includes(e.code));assert.deepEqual(f.calls,[]);}
});
test('source adapter cannot read FB, FC, FD or FE, including direct document reads',()=>{
 for(const source of ['FB','FC','FD','FE'])assert.throws(()=>createStore({source,getToken:async()=>''}),{code:'COMM_CONFIG_REQUIRED'});
});
test('FA adapter cannot search users or groups',async()=>{
 let calls=0;const fa=createStore({source:'FA',getToken:async()=>'',fetchImpl:async()=>{calls++;throw Error('NETWORK_FORBIDDEN');}});
 await assert.rejects(fa.page('users',{}),{code:'COMM_SOURCE_DENIED'});assert.equal(calls,0);
});
