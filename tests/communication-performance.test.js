import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {ADMINS,FF,fail} from '../communication/domain.js';
import {communicationEntryFromSession} from '../src/communication-entry.js';
import {loadCommunicationPushDirectory} from '../src/communication-push-directory.js';

const session=email=>({status:'signed-in',offline:false,validatingProfile:false,user:{uid:'fa-person',email,emailVerified:true},profile:{active:true,access:true}});
test('static administration opens from an already verified app session only for the four administrators',()=>{
 for(const email of ADMINS)assert.deepEqual(communicationEntryFromSession(session(email),{adminMode:true}),{isAdmin:true});
 assert.equal(communicationEntryFromSession(session('person@example.test'),{adminMode:true}),null);
 assert.equal(communicationEntryFromSession({...session(ADMINS[0]),user:{...session(ADMINS[0]).user,emailVerified:false}},{adminMode:true}),null);
 for(const change of [{offline:true},{validatingProfile:true},{status:'checking'},{profile:{active:false,access:true}},{profile:{active:true,access:false}}])assert.equal(communicationEntryFromSession({...session(ADMINS[0]),...change},{adminMode:true}),null);
 assert.deepEqual(communicationEntryFromSession(session('person@example.test')),{isAdmin:false});
});

function clientHarness(fetchImpl){
 const source={uid:'fa-one',getIdToken:async()=> 'fa-token'},target={uid:'ff-one',getIdToken:async()=> 'ff-token'};
 const auth={currentUser:source},ff={app:{options:{projectId:FF.projectId,appId:FF.appId,messagingSenderId:FF.senderId}},currentUser:target};
 const listeners=new Map(),document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const env={VITE_COMMUNICATION_FF_ENABLED:'true',VITE_COMMUNICATION_FF_ENDPOINT:'https://communication.example.workers.dev/v1/communication'};
 const context=vm.createContext({document,auth,FF,fail,env,fetch:fetchImpl,AbortController,setTimeout,clearTimeout,waitForGoogleProjectSession:async()=>true,getGoogleProjectAuth:()=>ff});
 const code=readFileSync(new URL('../src/communication-client.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'').replaceAll('import.meta.env','env');
 vm.runInContext(code+'\nglobalThis.client=createCommunicationClient();',context);
 return {client:context.client,auth,ff,document,listeners};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('identical in-flight reads share one authenticated request; settled reads are fetched again',async()=>{
 let release,requests=0;const headers=[];
 const h=clientHarness(async(_url,options)=>{requests++;headers.push(options.headers);if(requests===1)return new Promise(resolve=>release=resolve);return Response.json({items:[]});});
 const first=h.client.request('GROUPS',{}),second=h.client.request('GROUPS',{});
 assert.equal(first,second);await tick();assert.equal(requests,1);
 release(Response.json({items:[]}));await Promise.all([first,second]);
 await h.client.request('GROUPS',{});assert.equal(requests,2);
 assert.equal(headers[0].Authorization,'Bearer ff-token');assert.equal(headers[0]['X-SAHMT-FA-Authorization'],'Bearer fa-token');h.client.dispose();
});

test('writes are never cached, merged, retried or sent automatically',async()=>{
 let requests=0;const h=clientHarness(async()=>{requests++;return Response.json({saved:true});});
 await Promise.all([h.client.request('SAVE_MESSAGE',{version:0}),h.client.request('SAVE_MESSAGE',{version:0})]);
 assert.equal(requests,2);h.client.dispose();
});

test('cliente preserva consumo e renovação de um bloqueio diário sem repetir o envio',async()=>{
 let requests=0;const resetsAt=Date.parse('2026-11-05T00:00:00Z');
 const h=clientHarness(async()=>{requests++;return Response.json({code:'COMM_DAILY_PUBLICATION_LIMIT',used:200,limit:200,resetsAt,privateDetail:'not forwarded'},{status:429});});
 await assert.rejects(h.client.request('SAVE_MESSAGE',{version:0}),error=>error.code==='COMM_DAILY_PUBLICATION_LIMIT'&&error.used===200&&error.limit===200&&error.resetsAt===resetsAt&&error.privateDetail===undefined);
 assert.equal(requests,1);h.client.dispose();
});

test('an account change cannot reuse another account’s in-flight result',async()=>{
 let release,requests=0;
 const h=clientHarness(async()=>{requests++;if(requests===1)return new Promise(resolve=>release=resolve);return Response.json({items:[{id:'new-account'}]});});
 const old=h.client.request('GROUPS',{}),denied=assert.rejects(old,{code:'COMM_SESSION_INVALID'});await tick();
 h.auth.currentUser={uid:'fa-two',getIdToken:async()=> 'fa-two-token'};h.ff.currentUser={uid:'ff-two',getIdToken:async()=> 'ff-two-token'};
 const next=await h.client.request('GROUPS',{});assert.equal(next.items[0].id,'new-account');assert.equal(requests,2);
 release(Response.json({items:[{id:'old-account'}]}));await denied;h.client.dispose();
});

test('backgrounding aborts the shared request and does not keep a failed read cached',async()=>{
 let requests=0;const h=clientHarness(async(_url,{signal})=>{
  requests++;if(requests>1)return Response.json({items:[]});
  return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})),{once:true}));
 });
 const pending=h.client.request('GROUPS',{}),aborted=assert.rejects(pending,{name:'AbortError'});await tick();
 h.document.visibilityState='hidden';h.listeners.get('visibilitychange')();await aborted;
 h.document.visibilityState='visible';await h.client.request('GROUPS',{});assert.equal(requests,2);h.client.dispose();
});

test('directory and Push scan overlap and emit pending users before every page finishes',async()=>{
 let releaseUsers,releasePush;const snapshots=[],calls=[];
 const usersGate=new Promise(resolve=>releaseUsers=resolve),pushGate=new Promise(resolve=>releasePush=resolve);
 const loading=loadCommunicationPushDirectory({onProgress:value=>snapshots.push(value),request:async(action,{cursor})=>{
  calls.push([action,cursor]);
  if(action==='DIRECTORY'&&!cursor)return {items:[{uid:'a',displayName:'Ana'}],cursor:'more'};
  if(action==='DIRECTORY')return usersGate;
  return pushGate;
 }});
 await tick();assert.equal(calls.some(([action])=>action==='PUSH_DEVICE_DIRECTORY'),true);
 assert.equal(calls.some(([action,cursor])=>action==='DIRECTORY'&&cursor==='more'),true);
 assert.equal(snapshots[0].items[0].pushPending,true);assert.equal(snapshots[0].complete,false);
 releasePush({items:[{uid:'b',devices:[{pushStatus:'ACTIVE'}]}],cursor:null});
 releaseUsers({items:[{uid:'b',displayName:'Bruno'}],cursor:null});
 const items=await loading;
 assert.deepEqual(items.map(user=>user.uid),['b','a']);assert.equal(items.every(user=>user.pushPending===false),true);
 assert.equal(snapshots.at(-1).complete,true);
});
