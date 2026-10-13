import test from 'node:test';
import assert from 'node:assert/strict';
import {createManagementGatewayClient} from '../scripts/lib/management-gateway-client.js';
import {MANAGEMENT_GATEWAY_DENIAL_CODES} from '../scripts/lib/management-gateway-protocol.js';

const TIME=1800000000000,FA='sahmt-17a16',FB='sahmt-gestao-5ae66',FC='indicadores---sahmt';
const ENDPOINT='https://script.google.com/macros/s/'+'A'.repeat(30)+'/exec';
const REDIRECT='https://script.googleusercontent.com/macros/echo?user_content_key=synthetic-content-key&lib=synthetic-lib';
const reply=(url,data,{status=200,headers={},stream,redirected=false}={})=>({url,status,redirected,
  headers:new Headers({'content-type':'application/json',...headers}),body:stream||new Response(JSON.stringify(data)).body});
function harness({options={},fetchOverride,protocolOverride={}}={}) {
  const calls=[],protocolCalls=[];let time=TIME;
  const result={status:'SUCCESS',code:'OK',body:{users:[]}};
  const protocol={
    createRequest:request=>{protocolCalls.push(['create',request]);return {...request,signature:'synthetic-only'};},
    acceptResponse:async(data,request,context)=>{protocolCalls.push(['accept',data,request,context]);await context.claimNonce({requestId:request.requestId},context);return result;},
    ...protocolOverride
  };
  const client=createManagementGatewayClient({enabled:true,protocol,endpoint:ENDPOINT,policy:{maxRequestMs:1000,maxResponseBytes:4096,maxResponseChunks:16},
    clock:()=>time,newRequestId:()=> 'a'.repeat(32),newNonce:()=> 'b'.repeat(32),
    claimResponseNonce:async(request,context)=>{protocolCalls.push(['claim',request,context]);return {status:'CLAIMED'};},
    fetchImpl:async(url,init)=>{calls.push([url,init]);return fetchOverride?fetchOverride(url,init):reply(url,{synthetic:true});},...options});
  return {client,calls,protocolCalls,result,advance:ms=>{time+=ms;}};
}
const denied=(work,code)=>assert.rejects(work,error=>error.code===code&&error.message===code);

test('only pilot context retains a closed denial reason after authenticated response acceptance',async()=>{
 for(const pilotDiagnostics of [false,true])for(const code of [...MANAGEMENT_GATEWAY_DENIAL_CODES,'private-email@example.invalid']){
  const h=harness();Object.assign(h.result,{status:'DENIED',code,body:null});
  await assert.rejects(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'},{pilotDiagnostics}),error=>{
   assert.equal(error.code,'GATEWAY_OPERATION_DENIED');assert.equal(error.message,'GATEWAY_OPERATION_DENIED');
   assert.equal(error.gatewayDenialCode,pilotDiagnostics&&MANAGEMENT_GATEWAY_DENIAL_CODES.includes(code)?code:undefined);
   assert.equal(JSON.stringify(error).includes('private'),false);return true;
  });
 }
 const h=harness({protocolOverride:{acceptResponse:async()=>{throw Object.assign(Error('private raw response'),
  {code:'GATEWAY_OPERATION_DENIED',gatewayDenialCode:'GATEWAY_ADMISSION_DENIED'});}}});
 await assert.rejects(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'},{pilotDiagnostics:true}),error=>{
  assert.equal(error.code,'GATEWAY_CLIENT_UNAVAILABLE');assert.equal(error.gatewayDenialCode,undefined);return true;
 });
});

test('default disable has no request, signing or transport effects',async()=>{
  const h=harness({options:{enabled:false}});await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_CLIENT_DISABLED');
  assert.equal(h.calls.length,0);assert.equal(h.protocolCalls.length,0);
});

test('fixed POST carries authenticated envelope only, no credentials, cookies or URL token',async()=>{
  const h=harness();assert.deepEqual(await h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),{users:[]});
  const [url,options]=h.calls[0];assert.equal(url,ENDPOINT);assert.equal(options.method,'POST');
  assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');
  assert.equal(Object.hasOwn(options.headers,'Authorization'),false);assert.equal(Object.hasOwn(options.headers,'Cookie'),false);
  assert.deepEqual(h.protocolCalls[0][1].body,{uid:'uid-a'});assert.equal(h.protocolCalls[0][1].operation,'AUTH_USER_LOOKUP_FA');
  assert.equal(h.protocolCalls[0][1].expiresAtMs,TIME+1000);assert.equal(h.protocolCalls.filter(c=>c[0]==='claim').length,1);
});

test('FB/FC lookups and signers choose closed project-specific operations',async()=>{
  const h=harness();await h.client.lookupAuthUser({projectId:FB,uid:'uid-a'});await h.client.signFbCustomToken({uid:'uid-a',claims:{synthetic:true},issuedAtSeconds:1,expiresAtSeconds:2});
  await h.client.lookupAuthUser({projectId:FC,uid:'uid-a'});
  await h.client.signFcCustomToken({uid:'uid-a',claims:{},issuedAtSeconds:1,expiresAtSeconds:2});
  assert.deepEqual(h.protocolCalls.filter(c=>c[0]==='create').map(c=>c[1].operation),['AUTH_USER_LOOKUP_FB','SIGN_FB_CUSTOM_TOKEN','AUTH_USER_LOOKUP_FC','SIGN_FC_CUSTOM_TOKEN']);
  assert.deepEqual(h.protocolCalls.find(c=>c[0]==='create'&&c[1].operation==='SIGN_FC_CUSTOM_TOKEN')[1].body,
    {uid:'uid-a',claims:{},issuedAtSeconds:1,expiresAtSeconds:2});
  await denied(h.client.lookupAuthUser({projectId:'other',uid:'uid-a'}),'GATEWAY_LOOKUP_REQUEST_INVALID');
  await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a',url:'https://bad.invalid'}),'GATEWAY_LOOKUP_REQUEST_INVALID');
  assert.equal(h.calls.length,4);
});

test('first-login Gateway request uses a digest-derived atomic envelope nonce and never accepts a caller UID',async()=>{
  const h=harness();
  await h.client.authorizeAndSignFaFirstLogin({email:'professional@example.org',googleSub:'google-sub-synthetic',
    nonceDigest:'c'.repeat(64),issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+300});
  const request=h.protocolCalls.find(call=>call[0]==='create')[1];
  assert.equal(request.operation,'FIRST_LOGIN_FA_SIGN');assert.equal(request.nonce,'c'.repeat(32));
  assert.equal(request.body.email,'professional@example.org');assert.equal(request.body.googleSub,'google-sub-synthetic');
  assert.equal(Object.hasOwn(request.body,'uid'),false);assert.equal(Object.hasOwn(request.body,'nonceDigest'),false);
  assert.equal(h.calls.length,1);
  await denied(h.client.authorizeAndSignFaFirstLogin({email:'professional@example.org',googleSub:'google-sub-synthetic',
    nonceDigest:'not-a-digest',issuedAtSeconds:TIME/1000,expiresAtSeconds:TIME/1000+300}),'GATEWAY_FIRST_LOGIN_REQUEST_INVALID');
  assert.equal(h.calls.length,1);
});

test('one ContentService redirect follows GET with no envelope or original headers',async t=>{
  for(const status of [302,303])await t.test(String(status),async()=>{
    const h=harness({fetchOverride:async(url)=>url===ENDPOINT?reply(url,null,{status,headers:{location:REDIRECT}}):reply(url,{synthetic:true})});
    await h.client.lookupAuthUser({projectId:FA,uid:'uid-a'});assert.equal(h.calls.length,2);
    const [url,options]=h.calls[1];assert.equal(url,REDIRECT);assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    assert.deepEqual(options.headers,{Accept:'application/json'});assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
  });
});

test('unsafe or repeated redirects deny without replaying POST or sending data to another host',async t=>{
  for(const location of ['http://script.googleusercontent.com/macros/echo?user_content_key=a',
    'https://script.googleusercontent.com.evil.invalid/macros/echo?user_content_key=a',
    'https://user:password@script.googleusercontent.com/macros/echo?user_content_key=a',
    'https://script.googleusercontent.com:444/macros/echo?user_content_key=a',
    'https://script.googleusercontent.com/macros/echo?user_content_key=a&access_token=synthetic',
    'https://script.googleusercontent.com/macros/echo?user_content_key=a&user_content_key=b',
    'https://script.googleusercontent.com/other?user_content_key=a',
    'https://script.googleusercontent.com/macros/echo?user_content_key=a#fragment','/relative'])await t.test('redirect',async()=>{
      const h=harness({fetchOverride:async url=>reply(url,null,{status:302,headers:{location}})});
      await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_REDIRECT_DENIED');assert.equal(h.calls.length,1);assert.equal(h.protocolCalls.some(c=>c[0]==='accept'),false);
    });
  const h=harness({fetchOverride:async url=>reply(url,null,{status:302,headers:{location:REDIRECT}})});
  await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_HTTP_RESPONSE_INVALID');assert.equal(h.calls.length,2);
});

test('endpoint, policy and durable response claim must be explicit before transport',async t=>{
  for(const options of [{endpoint:ENDPOINT+'?token=synthetic'},{endpoint:ENDPOINT.replace('https:','http:')},{endpoint:ENDPOINT.replace('/exec','/dev')},
    {policy:{maxRequestMs:1,maxResponseBytes:100000,maxResponseChunks:1}},{claimResponseNonce:undefined},{protocol:{}}])await t.test('configuration',async()=>{
      const h=harness({options});await assert.rejects(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}));assert.equal(h.calls.length,0);
    });
});

test('caller deadline reduces original envelope lifetime and expired deadline denies without transport',async()=>{
  const h=harness();await h.client.lookupAuthUser({projectId:FA,uid:'uid-a'},{deadlineMs:TIME+100});
  assert.equal(h.protocolCalls[0][1].expiresAtMs,TIME+100);
  const other=harness();await denied(other.client.lookupAuthUser({projectId:FA,uid:'uid-a'},{deadlineMs:TIME}),'GATEWAY_DEADLINE_EXCEEDED');assert.equal(other.calls.length,0);
});

test('HTTP error, implicit redirect, URL change and nonJSON body cannot reach response authentication',async t=>{
  for(const override of [url=>reply(url,{}, {status:403}),url=>reply(url,{}, {redirected:true}),
    url=>reply('https://different.invalid',{}),url=>reply(url,{}, {headers:{'content-type':'text/html'}})])await t.test('transport',async()=>{
      const h=harness({fetchOverride:async url=>override(url)});await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_HTTP_RESPONSE_INVALID');assert.equal(h.protocolCalls.some(c=>c[0]==='accept'),false);
    });
});

test('oversized, empty and endless streams are bounded before authentication',async t=>{
  const endless={getReader:()=>({read:async()=>({done:false,value:new Uint8Array([32])}),cancel:async()=>{},releaseLock(){}})};
  const empty={getReader:()=>({read:async()=>({done:false,value:new Uint8Array()}),cancel:async()=>{},releaseLock(){}})};
  for(const stream of [endless,empty,new Response('a'.repeat(5000)).body])await t.test('body',async()=>{
    const h=harness({fetchOverride:async url=>reply(url,{}, {stream})});await assert.rejects(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}));assert.equal(h.protocolCalls.some(c=>c[0]==='accept'),false);
  });
});

test('malformed body and invalid authenticated envelope return no source or signing result',async t=>{
  await t.test('JSON',async()=>{const h=harness({fetchOverride:async url=>reply(url,{}, {stream:new Response('{').body})});
    await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_RESPONSE_INVALID');assert.equal(h.protocolCalls.some(c=>c[0]==='accept'),false);});
  await t.test('signature',async()=>{const h=harness({protocolOverride:{acceptResponse:async()=>{throw Error('synthetic secret error');}}});
    await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_CLIENT_UNAVAILABLE');});
  await t.test('DENIED',async()=>{const h=harness();h.result.status='DENIED';h.result.code='GATEWAY_REJECTED';
    await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_OPERATION_DENIED');});
});

test('cancelled caller and hanging fetch never claim response nonce',async t=>{
  await t.test('abort',async()=>{const h=harness();const controller=new AbortController();controller.abort();
    await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'},{signal:controller.signal}),'GATEWAY_CANCELLED');assert.equal(h.calls.length,0);});
  await t.test('hang',async()=>{const h=harness({options:{policy:{maxRequestMs:20,maxResponseBytes:4096,maxResponseChunks:16}},fetchOverride:()=>new Promise(()=>{})});
    await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'}),'GATEWAY_DEADLINE_EXCEEDED');assert.equal(h.protocolCalls.some(c=>c[0]==='claim'),false);});
});

test('dispose rejects pending transport and a late reply cannot be accepted',async()=>{
  let resolve;const pending=new Promise(yes=>{resolve=yes;});const h=harness({fetchOverride:()=>pending});
  const work=h.client.lookupAuthUser({projectId:FA,uid:'uid-a'});await new Promise(yes=>setImmediate(yes));h.client.dispose();
  await denied(work,'GATEWAY_CANCELLED');resolve(reply(ENDPOINT,{synthetic:true}));await new Promise(yes=>setImmediate(yes));assert.equal(h.protocolCalls.some(c=>c[0]==='accept'),false);
});


test('malformed caller signal and throwing cleanup cannot leak raw errors',async t=>{
  await t.test('malformed',async()=>{const h=harness();await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'},{signal:{aborted:false}}),'GATEWAY_CONTEXT_INVALID');assert.equal(h.calls.length,0);});
  await t.test('cleanup',async()=>{const signal={aborted:false,addEventListener(){},removeEventListener(){throw Error('synthetic-sensitive cleanup');}};
    const h=harness({fetchOverride:async()=>{throw Error('synthetic-sensitive transport');}});
    await denied(h.client.lookupAuthUser({projectId:FA,uid:'uid-a'},{signal}),'GATEWAY_CLIENT_UNAVAILABLE');});
});
