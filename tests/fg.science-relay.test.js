import {createHmac} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {callFgScienceWebhook,relayFgScience} from '../worker-checklist-fg/science-relay.js';

const secret='x'.repeat(43);
const url='https://script.google.com/macros/s/fixture-deployment-key-000000/exec';
const day='2026-11-07';
const mac=payload=>createHmac('sha256',secret).update('SAHMT_SHEET_V1\n'+payload).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const decode=value=>JSON.parse(Buffer.from(value,'base64url').toString());

test('signed relay rejects non-Google redirects and accepts a verified response for the same request',async()=>{
  let expected;
  const fetchImpl=async(location,options)=>{
    if(options.method==='POST'){
      const body=JSON.parse(options.body);assert.equal(body.mac,mac(body.payload));
      expected=decode(body.payload);
      assert.equal(expected.action,'settle');assert.equal(expected.uid,'author');
      return new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/macros/echo?key=fixture'}});
    }
    assert.equal(String(location),'https://script.googleusercontent.com/macros/echo?key=fixture');
    const payload=encode({v:1,code:'VALIDATED',nonce:expected.nonce});return Response.json({payload,mac:mac(payload)});
  };
  assert.equal(await callFgScienceWebhook({url,secret,action:'settle',day,uid:'author',fetchImpl}),'VALIDATED');
  await assert.rejects(callFgScienceWebhook({url,secret,action:'probe',fetchImpl:async()=>new Response(null,{status:302,headers:{Location:'https://example.test/macros/echo'}})}),/FG_SCIENCE_REDIRECT/);
});

test('public relay derives the signer only from FA and never scores a forged request',async()=>{
  const origin='https://anestesiahmtforms.github.io';
  const env={ALLOWED_ORIGINS:origin,MODULE_STATION:'FG',MODULE_PROJECT_ID:'sahmt-checklist-fg',MODULE_CUTOVER_ACTIVE:'true',FG_SCIENCE_WEBHOOK_URL:url,FG_SCORING_SHARED_SECRET:secret};
  const send=(body,requestOrigin=origin)=>new Request(origin+'/v1/science/settle',{method:'POST',headers:{Origin:requestOrigin,Authorization:'Bearer central-session'},body:JSON.stringify(body)});
  let calls=0;
  const options={verify:async()=>({uid:'author',emailVerified:true}),relay:async input=>{calls++;assert.equal(input.uid,'author');assert.equal(input.day,day);return 'VALIDATED';}};
  assert.equal((await relayFgScience(send({day,uid:'forged'}),env,options)).status,400);
  assert.equal((await relayFgScience(send({day},'https://example.test'),env,options)).status,403);
  assert.equal((await relayFgScience(send({day}),{...env,MODULE_CUTOVER_ACTIVE:'false'},options)).status,503);
  assert.equal(calls,0);
  assert.equal((await (await relayFgScience(send({day}),env,options)).json()).code,'VALIDATED');
  assert.equal(calls,1);
});

test('native receiver validates only the authenticated signer of the persisted current-day request',async()=>{
  const source=await readFile(new URL('../apps-script-fg/ScienceWebhook.gs',import.meta.url),'utf8');
  const current={id:day,day,signerUid:'author',acknowledgedAt:new Date('2026-11-07T20:00:00Z'),status:'PENDING_VALIDATION'};
  let validations=0;
  const context=vm.createContext({Date,fgNativeOwner_(){},checklistScienceAssertOperator_:()=>({activatedAt:new Date('2026-11-07T10:00:00Z')}),
    checklistSaoPauloDay_:()=>day,sahmtV2Properties_:()=>({getProperty:()=>secret}),isValidDateKey:value=>value===day,
    ospJson_:value=>value,ospMac_:mac,ospEqual_:(a,b)=>a===b,ospReply_:(_nonce,code)=>({code}),
    Utilities:{base64DecodeWebSafe:payload=>Buffer.from(payload,'base64url'),newBlob:data=>({getDataAsString:()=>data.toString()}),parseDate:()=>new Date('2026-11-08T02:59:00Z')},
    evaluationGet_:(collection,id)=>{assert.equal(collection,'checklistSignatureRequests');assert.equal(id,day);return current;},
    fgAcknowledgementOnTime_:request=>request===current,
    validateChecklistSignatureRequest_:(request,options)=>{assert.equal(request,current);assert.equal(options.scienceOnly,true);validations++;return 'VALIDATED';}});
  vm.runInContext(source,context);
  const send=(uid,sign=mac,issuedAt=Date.now())=>{const payload=encode({v:1,aud:'fg-science',action:'settle',day,uid,nonce:'a'.repeat(32),issuedAt});return context.fgScienceHttp_({postData:{contents:JSON.stringify({payload,mac:sign(payload)})}}).code;};
  assert.equal(send('other'),'FG_WEBHOOK_DENIED');
  assert.equal(send('author',()=>''),'FG_WEBHOOK_DENIED');
  assert.equal(send('author',mac,Date.now()-65000),'FG_WEBHOOK_DENIED');
  assert.equal(validations,0);
  assert.equal(send('author'),'VALIDATED');
  assert.equal(validations,1);
});
