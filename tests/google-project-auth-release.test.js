import test from 'node:test';
import assert from 'node:assert/strict';
import {assertGoogleProjectAuthRelease} from '../scripts/lib/google-project-auth-release.js';
import {GOOGLE_PROJECT_CONFIG,googleProjectAuthEnabled} from '../src/google-project-auth-config.js';
const entries=()=>Object.fromEntries(['FA','FB','FC','FD','FE'].map(target=>[target,{config:{projectId:target,appId:target},googleEnabled:true,clientSignupDisabled:true,acceptedGoogleClientIds:['source'],credentialExchangeVerified:true,...(target==='FA'?{googleButtonOriginVerified:true,sessionPersistenceVerified:true,globalSignOutVerified:true}:{})}]));
test('evidências completas permitem compilar a ativação sem ativar implicitamente a versão padrão',()=>{
  assert.equal(googleProjectAuthEnabled,false);
  assert.deepEqual(assertGoogleProjectAuthRelease({enabled:'false',entries:GOOGLE_PROJECT_CONFIG}),{enabled:false});
  assert.deepEqual(assertGoogleProjectAuthRelease({enabled:'true',entries:GOOGLE_PROJECT_CONFIG}),{enabled:true});
});
test('audiências FB e FC refletem o cliente externo FA mostrado nos consoles',()=>{
  const sourceClient=GOOGLE_PROJECT_CONFIG.FA.acceptedGoogleClientIds[0];
  assert.ok(sourceClient);
  for(const target of ['FB','FC'])assert.ok(GOOGLE_PROJECT_CONFIG[target].acceptedGoogleClientIds.includes(sourceClient));
  const config=entries();config.FC.acceptedGoogleClientIds=[];
  assert.throws(()=>assertGoogleProjectAuthRelease({enabled:'true',entries:config}),/AUDIENCE_UNVERIFIED_FC/);
});
test('ativação não aceita destino sem configuração, audiência ou evidência',()=>{
  for(const [field,value,code] of [['googleEnabled',false,'CONFIGURATION_REQUIRED'],['clientSignupDisabled',false,'SIGNUP_GUARD_REQUIRED'],['acceptedGoogleClientIds',[],'AUDIENCE_UNVERIFIED'],['credentialExchangeVerified',false,'REAL_PROOF_REQUIRED']]){
    const config=entries();config.FC[field]=value;
    assert.throws(()=>assertGoogleProjectAuthRelease({enabled:'true',entries:config}),new RegExp(code+'_FC'));
  }
});
test('entrada única ocorre por FA e só libera pacote com evidências completas',()=>{
  assert.throws(()=>assertGoogleProjectAuthRelease({enabled:'true',entries:entries(),target:'FB'}),/ENTRY_MUST_BE_FA/);
  assert.deepEqual(assertGoogleProjectAuthRelease({enabled:'true',entries:entries()}),{enabled:true});
  const noOrigin=entries();noOrigin.FA.googleButtonOriginVerified=false;
  assert.throws(()=>assertGoogleProjectAuthRelease({enabled:'true',entries:noOrigin}),/GOOGLE_AUTH_BUTTON_ORIGIN_UNVERIFIED/);
});
test('prova de login não dispensa prova real de restauração e saída',()=>{
  for(const [field,code] of [['sessionPersistenceVerified','PERSISTENCE_PROOF_REQUIRED'],['globalSignOutVerified','LOGOUT_PROOF_REQUIRED']]){
    const config=entries();config.FA[field]=false;
    assert.throws(()=>assertGoogleProjectAuthRelease({enabled:'true',entries:config}),new RegExp(code));
  }
});
