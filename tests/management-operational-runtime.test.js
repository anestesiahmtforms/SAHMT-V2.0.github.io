import test from 'node:test';
import assert from 'node:assert/strict';
import {operationalFixture,jsonResponse,ENDPOINT,FA,FB,FC,TIME} from './helpers/management-operational-fixture.js';
import {createManagementFaFirstLoginTransport} from '../src/management-fa-first-login-transport.js';
import {createManagementFaFirstLoginFlow,createGoogleCredentialFactory} from '../src/management-fa-first-login.js';
import {createGoogleIdentityTokenRequester} from '../src/management-fa-google-identity.js';
import {createManagementGoogleLogin} from '../src/management-google-login.js';
import {createGoogleIdTokenVerifier} from '../scripts/lib/google-id-token-verifier.js';
import {createFirebaseProjectBrokerTransport} from '../src/firebase-project-broker-transport.js';
import {createFirebaseProjectAuthCoordinator} from '../src/firebase-project-auth.js';
import {createFirebaseSecondarySessionLifecycle,signOutAllFirebaseProjects} from '../src/firebase-secondary-session-lifecycle.js';
import {FIREBASE_PROJECTS} from '../src/firebase-projects.js';
import {buildManagementAuthRuntime,parseManagementPilotUidAllowlist,parseManagementPilotOrigin,MANAGEMENT_RUNTIME_DEFAULTS} from '../worker-management-auth/runtime.js';
import {jwt,publicJwk} from './helpers/gateway-vm.js';
import {createManagementBrokerHttp} from '../scripts/lib/management-broker-http.js';
import {createManagementPilotAuthDiagnostics} from '../src/management-pilot-auth-diagnostics.js';
function browser(fixture){
 const auth={currentUser:{uid:'member-a',getIdToken:async()=>fixture.token}},events=[];
 const targets=Object.fromEntries(['FB','FC'].map(name=>[name,{auth:{app:{name:FIREBASE_PROJECTS[name].appName,options:{projectId:FIREBASE_PROJECTS[name].projectId}},currentUser:null},signOut:async a=>{a.currentUser=null;events.push(name+':signed-out');}}]));
 const transport=createFirebaseProjectBrokerTransport({enabled:true,endpoint:ENDPOINT,allowedOrigins:[new URL(ENDPOINT).origin],fetchImpl:fixture.workerFetch});
 const coordinator=createFirebaseProjectAuthCoordinator({enabled:true,faAuth:auth,targets,broker:transport,now:()=>TIME,
  signInWithCustomToken:async(a,token)=>{const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));const target=a.app.options.projectId;
   assert.equal(claims.iss.endsWith('@'+target+'.iam.gserviceaccount.com'),true);assert.equal(claims.uid,auth.currentUser.uid);
   assert.equal(claims.claims.admin,undefined);a.currentUser={uid:claims.uid};events.push(target+':signed-in');return {user:a.currentUser};}});
 const lifecycle=createFirebaseSecondarySessionLifecycle({listApps:()=>Object.values(targets).map(t=>t.auth.app),getExistingAuth:app=>Object.values(targets).find(t=>t.auth.app===app).auth,signOut:async a=>{a.currentUser=null;}});
 return {auth,targets,coordinator,events,transport,lifecycle};
}
test('Gateway preserves explicit occurrence reader and auditor rights without adding them to the FB lease',async()=>{
 const f=operationalFixture({profile:{permissions:{trainingsRead:true,occurrencesRead:true,occurrencesAuditRead:true}}});
 const response=await f.workerFetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({faIdToken:f.token,sourceProjectId:FA,targetProjectIds:{FB,FC}})});
 const result=await response.json();assert.equal(response.status,200);
 const claims=JSON.parse(Buffer.from(result.targets.FC.customToken.split('.')[1],'base64url')).claims;
 assert.equal(claims.sahmtOccurrencesRead,true);assert.equal(claims.sahmtOccurrencesAuditRead,true);
 const leases=[...f.docs.values()].filter(d=>d.fields?.permissions&&d.name.includes('/'+FB+'/'));
 for(const lease of leases)assert.equal(Object.keys(lease.fields.permissions.mapValue.fields).some(k=>k.startsWith('occurrences')),false);
 await Promise.all(f.completions);
});
test('concrete runtime propagates sanitized verification stage only in the single-user pilot',async()=>{
 for(const pilotOnly of [false,true]){
  const f=operationalFixture({env:pilotOnly?{MANAGEMENT_AUTH_PILOT_ONLY:'true',MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["member-a"]'}:{}});
  const response=await f.workerFetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({faIdToken:'private-invalid-token',sourceProjectId:FA,targetProjectIds:{FB,FC}})});
  const result=await response.json();assert.equal(response.status,403);assert.equal(result.code,'FA_TOKEN_REJECTED');
  assert.deepEqual(result.diagnostic,pilotOnly?{stage:'TOKEN_DECODE',code:'JWT_FORMAT_INVALID'}:undefined);
  assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(f.operations.length,0);assert.equal(f.google.length,0);
  await Promise.all(f.completions);
 }
});
test('partial target diagnostic reaches pilot panel while the other real destination connects',async()=>{
 for(const pilotOnly of [false,true]){
  const f=operationalFixture({env:pilotOnly?{MANAGEMENT_AUTH_PILOT_ONLY:'true',MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["member-a"]'}:{}});
  let certificateRequests=0;
  const runtime=buildManagementAuthRuntime(f.env,{now:()=>f.h.state.time,fetchImpl:async(url,options)=>{
   if(url==='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'&&++certificateRequests===2)
    throw Error('private-token@example.invalid');
   return f.fetchImpl(url,options);
  }});
  const handle=createManagementBrokerHttp(runtime);
  const b=browser({...f,workerFetch:async(url,options)=>{
   const response=await handle(new Request(url,{...options,headers:{...options.headers,Origin:'https://anestesiahmtforms.github.io'}}),f.env,
    {waitUntil:promise=>f.completions.push(promise)});
   Object.defineProperty(response,'url',{value:url});return response;
  }});
  const result=await b.coordinator.connect();assert.equal(result.status,'partial');
  assert.equal(result.targets.FB.status,'ready');assert.equal(result.targets.FC.code,'FA_TOKEN_REJECTED');
  assert.deepEqual(result.targets.FC.diagnostic,pilotOnly?{stage:'PUBLIC_KEYS',code:'GOOGLE_AUTH_ADAPTER_FAILED'}:undefined);
  const panel=createManagementPilotAuthDiagnostics({enabled:true});panel.finishConnect(panel.beginConnect(),result);
  assert.deepEqual(panel.snapshot().lastConnect.targets.FC,{status:'unavailable',code:'FA_TOKEN_REJECTED',
   ...(pilotOnly?{diagnostic:{stage:'PUBLIC_KEYS',code:'GOOGLE_AUTH_ADAPTER_FAILED'}}:{})});
  assert.equal(JSON.stringify(panel.snapshot()).includes('private'),false);
  assert.equal(b.targets.FB.auth.currentUser.uid,'member-a');assert.equal(b.targets.FC.auth.currentUser,null);
  b.coordinator.dispose();b.transport.dispose();panel.dispose();await Promise.all(f.completions);
 }
});
test('real local PWA transport to production Worker runtime, HMAC, Gateway VM, broker, FB/FC sessions and global logout',async()=>{
 const f=operationalFixture(),b=browser(f),result=await b.coordinator.connect();
 assert.equal(result.status,'ready',JSON.stringify(result));assert.equal(b.targets.FB.auth.currentUser.uid,'member-a');assert.equal(b.targets.FC.auth.currentUser.uid,'member-a');
 assert.ok(f.operations.includes('READ_FA_AUTHORIZATION'));assert.ok(f.operations.includes('WRITE_FB_LEASE'));assert.ok(f.operations.includes('SIGN_FC_CUSTOM_TOKEN'));
 assert.equal(await signOutAllFirebaseProjects({signOutPrimary:async()=>{b.auth.currentUser=null;},signOutSecondary:()=>b.lifecycle.signOutAll()}),true);
 assert.equal(b.auth.currentUser,null);assert.equal(b.targets.FB.auth.currentUser,null);assert.equal(b.targets.FC.auth.currentUser,null);
 await Promise.all(f.completions);assert.equal(f.logs.length,0);
});

test('production timing accommodates sequential Gateway calls without removing fresh authorization checks',async()=>{
 assert.equal(MANAGEMENT_RUNTIME_DEFAULTS.maxExecutionMs,60000);
 assert.equal(MANAGEMENT_RUNTIME_DEFAULTS.cleanupTimeoutMs,10000);
 assert.equal(MANAGEMENT_RUNTIME_DEFAULTS.maxRequestMs,80000);
 assert.equal(MANAGEMENT_RUNTIME_DEFAULTS.cleanupDrainMs,10000);
 const f=operationalFixture({beforeGateway:async(_envelope,_request,h)=>{h.state.time+=2000;}});
 const b=browser(f),result=await b.coordinator.connect();
 assert.equal(result.status,'ready',JSON.stringify(result));
 assert.ok(f.h.state.time-TIME>18000);assert.ok(f.h.state.time-TIME<60000);
 assert.equal(f.operations.filter(op=>op==='READ_FA_AUTHORIZATION').length,5);
 assert.equal(f.operations.filter(op=>op==='AUTH_USER_LOOKUP_FA').length,5);
 assert.equal(f.operations.filter(op=>op==='AUTH_USER_LOOKUP_FB').length,3);
 assert.equal(f.operations.filter(op=>op==='READ_FB_LEASE').length,2);
 assert.equal(f.operations.filter(op=>op==='WRITE_FB_LEASE').length,1);
 await Promise.all(f.completions);
});
test('pre-enrolled first Google login links the existing FA UID, then opens independent FB and FC sessions',async()=>{
 const nonce=Buffer.alloc(32,7).toString('base64url');
 const jwk={...publicJwk,kid:'synthetic-google-key',alg:'RS256',use:'sig',kty:'RSA'};
 const f=operationalFixture({firstLoginEnabled:true,providerlessFa:true,googleCertJwks:{keys:[jwk]}});
 f.h.state.user.providerUserInfo=[];
 const googleToken=jwt({iss:'https://accounts.google.com',aud:'synthetic-google-client-id.apps.googleusercontent.com',
  iat:TIME/1000-2,exp:TIME/1000+3598,nonce,sub:'google-id-a',email:'synthetic-private-email@example.invalid',email_verified:true},{alg:'RS256',kid:'synthetic-google-key',typ:'JWT'});
 const verifier=createGoogleIdTokenVerifier({fetchImpl:f.fetchImpl,clock:()=>TIME});
 await verifier.verifyIdToken(googleToken,{audience:'synthetic-google-client-id.apps.googleusercontent.com',nonce,nowMs:TIME});
 const firstLoginUrl='https://synthetic-broker.example/v1/auth/first-login';
 const transport=createManagementFaFirstLoginTransport({enabled:true,endpoint:firstLoginUrl,
  allowedBrokerOrigins:['https://synthetic-broker.example'],fetchImpl:f.workerFetch});
 const faAuth={currentUser:null},faUser={uid:'member-a',providerData:[]};let transportError=null,transportSummary=null;
 const flow=createManagementFaFirstLoginFlow({enabled:true,auth:faAuth,
  requestGoogleIdToken:async({nonce:received})=>{assert.equal(received,nonce);return googleToken;},
  claimFirstLogin:async(...args)=>{try{const value=await transport.claimFirstLogin(...args);transportSummary={status:value.status,code:value.code};return value;}catch(error){transportError=error.code;throw error;}},googleCredential:createGoogleCredentialFactory({credential:token=>({providerId:'google.com',token})}),
  cryptoImpl:{getRandomValues:bytes=>{bytes.fill(7);return bytes;}},signInWithCustomToken:async(auth,customToken)=>{
   const claims=JSON.parse(Buffer.from(customToken.split('.')[1],'base64url'));
   assert.equal(claims.uid,'member-a');faAuth.currentUser=faUser;return {user:faUser};
  },linkWithCredential:async(user,credential)=>{assert.equal(user,faUser);assert.equal(credential.providerId,'google.com');
   user.providerData=[{providerId:'google.com',uid:'google-id-a'}];return {user};},
  reload:async()=>{},signOut:async auth=>{auth.currentUser=null;}});
 const login=createManagementGoogleLogin({enabled:true,firstLogin:flow,popupSignIn:async()=>{throw Error('popup must not run for linked setup');}});
 let loginResult,loginError;try{loginResult=await login.signIn();}catch(error){loginError=error.code||'UNSPECIFIED';}
 assert.equal(loginError,undefined,JSON.stringify({operations:f.operations,googleCalls:f.google,transportError,transportSummary}));
 assert.equal(f.operations[0],'FIRST_LOGIN_FA_SIGN');assert.deepEqual(loginResult,{ok:true,status:'FIRST_LOGIN_LINKED'});
 assert.equal(faAuth.currentUser,faUser);assert.equal(faUser.uid,'member-a');
 const b=browser(f,faUser),connected=await b.coordinator.connect();
 assert.equal(connected.status,'ready',JSON.stringify({connected,operations:f.operations,googleCalls:f.google}));
 assert.equal(faAuth.currentUser.uid,'member-a');assert.equal(b.targets.FB.auth.currentUser.uid,'member-a');assert.equal(b.targets.FC.auth.currentUser.uid,'member-a');
 assert.equal(f.operations[0],'FIRST_LOGIN_FA_SIGN');
  assert.ok(f.operations.includes('READ_FA_AUTHORIZATION'));
  assert.ok(f.operations.includes('SIGN_FB_CUSTOM_TOKEN'));
  assert.ok(f.operations.includes('SIGN_FC_CUSTOM_TOKEN'));
 assert.equal(JSON.stringify(f.logs).includes(googleToken),false);
  assert.equal(await signOutAllFirebaseProjects({signOutPrimary:async()=>{faAuth.currentUser=null;},signOutSecondary:()=>b.lifecycle.signOutAll()}),true);
  assert.equal(faAuth.currentUser,null);assert.equal(b.targets.FB.auth.currentUser,null);assert.equal(b.targets.FC.auth.currentUser,null);
 transport.dispose();
});
for(const failed of ['FB','FC'])test(failed+' signer failure preserves the other real broker path',async()=>{
 const f=operationalFixture({failSigner:failed}),b=browser(f),result=await b.coordinator.connect();
 assert.equal(result.status,'partial',JSON.stringify(result));assert.equal(result.targets[failed].status,'unavailable');assert.equal(result.targets[failed==='FB'?'FC':'FB'].status,'ready');assert.equal(b.auth.currentUser.uid,'member-a');
});
for(const [title,profile,ready] of [['FB only',{trainingsRead:true},['FB','FC']],['FC indicators only',{managementIndicatorsRead:true},['FC']],['occurrences only',{},['FC']]])test('server authorization '+title,async()=>{
 const f=operationalFixture({profile:{permissions:profile}}),b=browser(f),result=await b.coordinator.connect();
 for(const name of ['FB','FC']) {
  if(ready.includes(name)){assert.equal(result.targets[name].status,'ready',JSON.stringify(result));assert.equal(b.targets[name].auth.currentUser.uid,'member-a');}
  else {assert.notEqual(result.targets[name]?.status,'ready');assert.equal(b.targets[name].auth.currentUser,null);}
 }
 if(title==='occurrences only') assert.equal(f.operations.includes('WRITE_FB_LEASE'),false);
});
test('mismatched destination UID cannot bind an account and FC remains independent',async()=>{
 const b=browser(operationalFixture({wrongUid:FB})),result=await b.coordinator.connect();assert.equal(result.status,'partial',JSON.stringify(result));assert.equal(result.targets.FB.status,'unavailable');assert.equal(result.targets.FC.status,'ready');
});
test('response HMAC corruption fails closed without a Firebase session',async()=>{
 const b=browser(operationalFixture({tamperResponse:true})),result=await b.coordinator.connect();assert.notEqual(result.status,'ready');assert.equal(b.targets.FB.auth.currentUser,null);assert.equal(b.targets.FC.auth.currentUser,null);
});
test('expired or altered FA JWT is rejected before profile or signer calls',async()=>{
 for(const expired of [true,false]){const f=operationalFixture();f.token=expired?jwt({sub:'member-a',aud:FA,iss:'https://securetoken.google.com/'+FA,auth_time:1,iat:1,exp:2,email_verified:true,firebase:{sign_in_provider:'google.com',identities:{'google.com':['google-id-a']}}}):f.token.slice(0,-10)+'invalidsig';
  const b=browser(f),result=await b.coordinator.connect();assert.notEqual(result.status,'ready');assert.equal(f.operations.length,0);}
});
test('FC signer timeout does not block FB and FA remains signed in',async()=>{
 const f=operationalFixture({hangOperation:'SIGN_FC_CUSTOM_TOKEN'}),b=browser(f),result=await b.coordinator.connect();assert.equal(result.status,'partial',JSON.stringify(result));assert.equal(result.targets.FB.status,'ready');assert.equal(result.targets.FC.status,'unavailable');assert.equal(b.auth.currentUser.uid,'member-a');
});
test('source access revoked during FC signing is rechecked before release',async()=>{
 const f=operationalFixture({revokeOnSign:'FC'}),b=browser(f),result=await b.coordinator.connect(['FC']);assert.notEqual(result.status,'ready');assert.equal(b.targets.FC.auth.currentUser,null);
});
test('a delayed gateway response for a previous FA user cannot start either new-user session',async()=>{
 let release,started;const signal=new Promise(r=>started=r),gate=new Promise(r=>release=r);
 const f=operationalFixture({beforeGateway:async envelope=>{if(envelope.operation==='AUTH_USER_LOOKUP_FA'){started();await gate;}}}),b=browser(f),pending=b.coordinator.connect();
 await signal;b.auth.currentUser={uid:'member-b',getIdToken:async()=>''};release();const result=await pending;
 assert.equal(result.status,'blocked');assert.equal(b.targets.FB.auth.currentUser,null);assert.equal(b.targets.FC.auth.currentUser,null);
});
test('all activation bindings remain opt-in and missing bindings cause no HTTP',()=>{
 assert.throws(()=>buildManagementAuthRuntime({}, {fetchImpl:()=>{throw Error('must not fetch');}}),/WORKER_RUNTIME_DISABLED/);
 const f=operationalFixture();delete f.env.BROKER_STATE;assert.throws(()=>buildManagementAuthRuntime(f.env,{fetchImpl:f.fetchImpl,now:()=>TIME}));assert.equal(f.operations.length,0);
});
for(const status of [401,403,404])test('Firestore documents.get HTTP '+status+' stays sanitized and does not sign',async()=>{
 const f=operationalFixture({firestoreStatus:status}),b=browser(f),result=await b.coordinator.connect();assert.notEqual(result.status,'ready');
 assert.equal(f.operations.some(op=>op.startsWith('SIGN_')),false);assert.equal(JSON.stringify(result).includes('email@example.invalid'),false);assert.equal(f.logs.length,0);
});

test('server pilot allowlist accepts exactly one UID only when pilot mode is explicit',()=>{
 assert.deepEqual(parseManagementPilotUidAllowlist({MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["pilot-uid"]'},true),['pilot-uid']);
 assert.equal(parseManagementPilotUidAllowlist({},false),null);
 for(const env of [{},{MANAGEMENT_AUTH_PILOT_UIDS_JSON:'[]'},{MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["a","b"]'},
  {MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["bad uid"]'},{MANAGEMENT_AUTH_PILOT_UIDS_JSON:'not-json'}])
  assert.throws(()=>parseManagementPilotUidAllowlist(env,true),/WORKER_PILOT_POLICY_INVALID/);
 assert.throws(()=>parseManagementPilotUidAllowlist({MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["pilot-uid"]'},false),/WORKER_PILOT_POLICY_INVALID/);
});

test('FC pilot provisioning requires an explicit single-UID pilot and enabled FC',()=>{
 const f=operationalFixture();
 const env={...f.env,MANAGEMENT_AUTH_FC_ENABLED:'false',MANAGEMENT_AUTH_PILOT_ONLY:'true',MANAGEMENT_AUTH_PILOT_UIDS_JSON:'["pilot-uid"]',
  MANAGEMENT_AUTH_FC_PILOT_PROVISION:'true'};
 assert.throws(()=>buildManagementAuthRuntime(env,{fetchImpl:f.fetchImpl,now:()=>TIME}),/WORKER_FC_PILOT_PROVISION_INVALID/);
 const noProvision={...env,MANAGEMENT_AUTH_FC_PILOT_PROVISION:'false'};
 assert.equal(buildManagementAuthRuntime(noProvision,{fetchImpl:f.fetchImpl,now:()=>TIME}).fcPilotProvision,false);
});

test('an isolated origin can only be configured for the server single-user pilot', () => {
 const origin = 'https://pilot.example.invalid';
 assert.equal(parseManagementPilotOrigin({}, false), undefined);
 assert.equal(parseManagementPilotOrigin({MANAGEMENT_AUTH_PILOT_ORIGIN: origin}, true), origin);
 assert.throws(() => parseManagementPilotOrigin({MANAGEMENT_AUTH_PILOT_ORIGIN: origin}, false), /WORKER_PILOT_ORIGIN_INVALID/);
 for (const bad of ['*', 'http://pilot.example.invalid', origin + '/', origin + '?x=1', 'https://*.example.invalid'])
  assert.throws(() => parseManagementPilotOrigin({MANAGEMENT_AUTH_PILOT_ORIGIN: bad}, true), /WORKER_PILOT_ORIGIN_INVALID/);
 const f = operationalFixture();
 const env = {...f.env, MANAGEMENT_AUTH_PILOT_ONLY: 'true', MANAGEMENT_AUTH_PILOT_ORIGIN: origin,
  MANAGEMENT_AUTH_PILOT_UIDS_JSON: '["pilot-uid"]'};
 const runtime = buildManagementAuthRuntime(env, {fetchImpl:f.fetchImpl, now:()=>TIME});
 assert.equal(runtime.allowedOrigin, origin); runtime.dispose();
 assert.throws(() => buildManagementAuthRuntime({...env, MANAGEMENT_AUTH_PILOT_UIDS_JSON:'[]'},
  {fetchImpl:f.fetchImpl,now:()=>TIME}), /WORKER_PILOT_POLICY_INVALID/);
 assert.equal(f.operations.length, 0);
});

 test('FB domain context is opt-in and never added to FC source requests',async()=>{
  const domainRequests=[];
  const f=operationalFixture({env:{MANAGEMENT_DOMAIN_ENABLED:'true'},beforeGateway:envelope=>{if(envelope.operation==='READ_FA_AUTHORIZATION')domainRequests.push(envelope.body.includeManagementDomain===true);}});
  const response=await f.workerFetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({faIdToken:f.token,sourceProjectId:FA,targetProjectIds:{FB,FC}})});
  const result=await response.json();assert.equal(result.targets.FB.status,'READY');assert.equal(result.targets.FC.status,'READY');
  assert.ok(domainRequests.includes(true));assert.ok(domainRequests.includes(false));await Promise.all(f.completions);
 });
 test('FB area read failure does not stop the independent FC session',async()=>{
  const f=operationalFixture({env:{MANAGEMENT_DOMAIN_ENABLED:'true'},failDomainRead:true});
  const response=await f.workerFetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({faIdToken:f.token,sourceProjectId:FA,targetProjectIds:{FB,FC}})});
  const result=await response.json();assert.equal(result.targets.FB.status,'UNAVAILABLE');assert.equal(result.targets.FC.status,'READY');await Promise.all(f.completions);
 });
