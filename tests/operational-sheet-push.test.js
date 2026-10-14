import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {relayOperationalSheet} from '../worker-management-auth/operational-sheet-relay.js';
const secret='s'.repeat(43),origin='https://anestesiahmtforms.github.io',now=1700000000000;
const project='sahmt-17a16',name=`projects/${project}/databases/(default)/documents/events/synthetic`;
const document={name,updateTime:'2023-11-14T22:13:20Z',fields:{createdByUid:{stringValue:'synthetic-author'}}};
const signature=p=>createHmac('sha256',secret).update('SAHMT_SHEET_V1\n'+p).digest('hex');
const pack=body=>{const payload=Buffer.from(JSON.stringify(body)).toString('base64url');return {payload,mac:signature(payload)};};
const req=()=>new Request('https://worker.example/v1/operational-sheets/notify',{method:'POST',headers:{Origin:origin,
  Authorization:'Bearer '+['header',Buffer.from(JSON.stringify({aud:project,iss:`https://securetoken.google.com/${project}`,sub:'synthetic-author'})).toString('base64url'),'signature'.repeat(10)].join('.')},
  body:JSON.stringify({collection:'events',id:'synthetic'})});
const env={OPERATIONAL_SHEETS_ENABLED:'true',OPERATIONAL_SHEETS_HMAC_SECRET:secret,
  OPERATIONAL_SHEETS_SCRIPT_URL:'https://script.google.com/macros/s/'+'a'.repeat(30)+'/exec'};
const ctx=()=>{
  const properties=new Map([['SAHMT_OPERATIONAL_PUSH_ENABLED','YES'],['enabled','YES'],['SAHMT_OPERATIONAL_PUSH_HMAC_SECRET',secret]]);
  let receives=0;
  const c=vm.createContext({Date,JSON,Number,Object,Error,OSC:{enabled:'enabled'},
    sahmtV2Properties_:()=>({getProperty:k=>properties.get(k),setProperty:(k,v)=>properties.set(k,v),
      getProperties:()=>Object.fromEntries(properties),deleteProperty:k=>properties.delete(k)}),
    Utilities:{Charset:{UTF_8:'UTF-8'},base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),
      base64EncodeWebSafe:s=>Buffer.from(s).toString('base64url'),newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString()}),
      computeHmacSha256Signature:(p,k)=>[...createHmac('sha256',k).update(p).digest()]},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    oscLocked_:f=>f()});
  vm.runInContext(readFileSync(new URL('../apps-script-v2/OperationalSheetPush.gs',import.meta.url),'utf8'),c);
  c.ospReceive_=()=>{receives++;return 'CONTROLE_REGISTRO_JA_RECEBIDO';};
  return {c,properties,receives:()=>receives};
};
function envelope(changes={}) {const issuedAt=Date.now();return pack({v:1,aud:'sahmt-operational-sheet',nonce:'1'.repeat(32),issuedAt,expiresAt:issuedAt+60000,document,...changes});}
const run=(c,value)=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(value)}}).text);
test('receiver accepts a valid HMAC once and rejects replay',()=>{
  const {c,receives}=ctx(),value=envelope();
  const first=run(c,value);assert.equal(first.mac,signature(first.payload));
  assert.equal(JSON.parse(Buffer.from(first.payload,'base64url')).code,'CONTROLE_REGISTRO_JA_RECEBIDO');
  const second=run(c,value);assert.equal(JSON.parse(Buffer.from(second.payload,'base64url')).code,'CONTROLE_REPLAY_RECUSADO');
  assert.equal(receives(),1);
});
test('disabled receiver never accesses a document or spreadsheet',()=>{
  const {c,properties,receives}=ctx();properties.set('SAHMT_OPERATIONAL_PUSH_ENABLED','NO');
  assert.equal(run(c,envelope()).code,'CONTROLE_ENVIO_DESATIVADO');assert.equal(receives(),0);
});
test('tampered HMAC, expired envelope and wrong project never reach spreadsheet',()=>{
  for(const value of [{...envelope(),mac:'0'.repeat(64)},envelope({issuedAt:1,expiresAt:60001}),
    envelope({document:{...document,name:name.replace(project,'another-project')}})]){
    const {c,receives}=ctx();run(c,value);assert.equal(receives(),0);
  }
});
test('relay reads one document and authenticates the response; no scan',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push([url,options]);
    if(calls.length===1)return Response.json(document);
    const e=JSON.parse(options.body);assert.equal(e.mac,signature(e.payload));
    const body=JSON.parse(Buffer.from(e.payload,'base64url'));assert.deepEqual(body.document,document);
    assert.equal(options.headers.Authorization,undefined);
    return Response.json(pack({v:1,nonce:body.nonce,code:'CONTROLE_REGISTRO_RECEBIDO'}));
  };
  const response=await relayOperationalSheet(req(),env,{fetchImpl,now:()=>now});
  assert.equal(response.status,200);assert.equal(calls.length,2);
  assert.equal(calls[0][0],'https://firestore.googleapis.com/v1/'+name);assert.equal(calls[0][1].method,'GET');
});
test('Firestore denial and divergent author never contact Apps Script',async()=>{
  for(const response of [new Response('',{status:403}),Response.json({...document,fields:{createdByUid:{stringValue:'other'}}})]){
    let calls=0;const answer=await relayOperationalSheet(req(),env,{fetchImpl:async()=>{calls++;return response;}});
    assert.equal(answer.status,403);assert.equal(calls,1);
  }
});
test('relay rejects response without HMAC and redirects outside Content Service',async()=>{
  for(const reply of [Response.json({code:'CONTROLE_REGISTRO_RECEBIDO'}),new Response(null,{status:302,headers:{Location:'https://evil.example/'}})]){
    let calls=0;const response=await relayOperationalSheet(req(),env,{fetchImpl:async()=>++calls===1?Response.json(document):reply});
    assert.equal(response.status,503);assert.equal(calls,2);
  }
});
test('disabled relay makes no external request',async()=>{
  const response=await relayOperationalSheet(req(),{...env,OPERATIONAL_SHEETS_ENABLED:'false'},
    {fetchImpl:()=>{throw Error('NETWORK_FORBIDDEN');}});assert.equal(response.status,503);
});
test('already registered spreadsheet row is never overwritten',()=>{
  const c=vm.createContext({oscDocKey_:()=> 'events/synthetic',oscTable_:()=>({}),oscBook_:()=>({}),
    oscState_:()=>new Map([['events/synthetic',{deleted:true}]]),firestoreFieldsToJs_:()=>{throw Error('MUST_NOT_REWRITE');}});
  vm.runInContext(readFileSync(new URL('../apps-script-v2/OperationalSheetPush.gs',import.meta.url),'utf8'),c);
  assert.equal(c.ospReceive_(document),'CONTROLE_REGISTRO_JA_RECEBIDO');
});
