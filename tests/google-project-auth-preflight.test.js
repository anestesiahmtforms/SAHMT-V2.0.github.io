import test from 'node:test';
import assert from 'node:assert/strict';
import {googleTokenClaims,verifyExistingGoogleDestination} from '../src/google-project-auth-preflight.js';
const token=claims=>`header.${Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:'source-client',sub:'google-person',...claims})).toString('base64url')}.signature`;
const expected={uid:'firebase-person',googleUid:'google-person'};
const entry={googleEnabled:true,clientSignupDisabled:true,config:{apiKey:'public-web-key'},acceptedGoogleClientIds:['source-client']};
const ok=(body,status=200)=>({ok:status===200,status,json:async()=>body});
const credential={providerId:'google.com',idToken:token({})};
function fixture(overrides={}){const calls=[];let responses=[ok({localId:expected.uid,idToken:'target-token',refreshToken:'memory-only'}),
  ok({users:[{localId:expected.uid,providerUserInfo:[{providerId:'google.com',rawId:expected.googleUid}]}]})];
  const run=()=>verifyExistingGoogleDestination({entry,credential,expected,requestUri:'https://app.example/',
    fetchImpl:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return responses.shift();},...overrides});
  return {run,calls,setResponses:value=>{responses=value;}};
}
test('credencial Google e UID são conferidos no destino sem guardar tokens no resultado',async()=>{
  const f=fixture();assert.deepEqual(await f.run(),expected);assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].body.autoCreate,false);assert.equal(f.calls[0].body.returnSecureToken,true);
  assert.equal(f.calls[0].body.idToken,undefined);
  assert.equal(new URLSearchParams(f.calls[0].body.postBody).get('id_token'),credential.idToken);
  assert.equal(f.calls[1].body.idToken,'target-token');
  assert.ok(f.calls.every(c=>c.options.credentials==='omit'&&c.options.cache==='no-store'&&c.options.signal));
});
test('não aceita token Firebase FA como token Google',async()=>{
  const f=fixture({credential:{...credential,idToken:token({iss:'https://securetoken.google.com/sahmt-17a16'})}});
  await assert.rejects(f.run(),{code:'AUTH_GOOGLE_IDENTITY_MISMATCH'});assert.equal(f.calls.length,0);
});
test('não aceita provedor, audiência ou identidade Google não conferidos',async()=>{
  for(const [overrides,code] of [[{credential:{...credential,providerId:'password'}},'AUTH_CREDENTIAL_REQUIRED'],
    [{entry:{...entry,acceptedGoogleClientIds:[]}},'AUTH_AUDIENCE_NOT_VERIFIED'],
    [{credential:{...credential,idToken:token({sub:'another-google'})}},'AUTH_GOOGLE_IDENTITY_MISMATCH']]){
    const f=fixture(overrides);await assert.rejects(f.run(),{code});assert.equal(f.calls.length,0);
  }
});
test('não conecta cadastro ausente nem faz nova tentativa sem autoCreate false',async()=>{
  const f=fixture();f.setResponses([ok({error:{message:'USER_NOT_FOUND'}},400)]);
  await assert.rejects(f.run(),{code:'AUTH_EXISTING_ACCOUNT_REQUIRED'});assert.equal(f.calls.length,1);
});
test('UID divergente, conta nova, necessidade de vínculo e MFA interrompem a conexão',async()=>{
  for(const data of [{localId:'other',idToken:'x'}, {localId:expected.uid,idToken:'x',isNewUser:true},
    {localId:expected.uid,idToken:'x',needConfirmation:true},{mfaPendingCredential:'private'}]){
    const f=fixture();f.setResponses([ok(data)]);await assert.rejects(f.run());assert.equal(f.calls.length,1);
  }
});
test('lookup exige mesmo UID, mesmo vínculo Google e conta ativa',async()=>{
  for(const account of [{localId:'other'}, {localId:expected.uid,disabled:true},
    {localId:expected.uid,providerUserInfo:[{providerId:'google.com',rawId:'other'}]}]){
    const f=fixture();f.setResponses([ok({localId:expected.uid,idToken:'x'}),ok({users:[account]})]);await assert.rejects(f.run());
  }
});
test('mudança da conta durante a requisição interrompe antes da consulta seguinte',async()=>{
  let current=true,calls=0;const f=fixture({isCurrent:()=>current,fetchImpl:async()=>{calls++;current=false;return ok({localId:expected.uid,idToken:'x'});}});
  await assert.rejects(f.run(),{code:'AUTH_ACCOUNT_CHANGED'});assert.equal(calls,1);
});
test('falhas de rede e respostas não previstas retornam somente códigos seguros',async()=>{
  const f=fixture({fetchImpl:async()=>{throw Error('secret-token-url');}});
  await assert.rejects(f.run(),{message:'auth/network-request-failed'});
  const g=fixture();g.setResponses([ok({error:{message:'secret-server-message'}},400)]);
  await assert.rejects(g.run(),{message:'AUTH_UNAVAILABLE'});
});
test('payload inválido ou audiência composta é rejeitado localmente',()=>{
  for(const idToken of ['bad','header.!bad.signature',token({aud:['source-client']})])
    assert.throws(()=>googleTokenClaims({...credential,idToken}),{code:'AUTH_GOOGLE_IDENTITY_MISMATCH'});
});
