import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createManagementFaFirstLoginBroker} from '../scripts/lib/management-fa-first-login.js';
import {createGoogleCredentialFactory,createManagementFaFirstLoginFlow} from '../src/management-fa-first-login.js';
import {createGoogleIdentityTokenRequester} from '../src/management-fa-google-identity.js';
import {isManagementFaFirstLoginPending,observeManagementFaFirstLoginAuthUid,
  subscribeManagementFaFirstLoginPending} from '../src/management-fa-first-login-state.js';

const audience = 'sahmt-first-login-client.apps.googleusercontent.com';
const uid = 'fa-user-001';
const claims = (overrides = {}) => ({issuer:'https://accounts.google.com', audience,
  issuedAtSeconds:1_800_000_000, expiresAtSeconds:1_800_000_900, nonce:'n'.repeat(32),
  sub:'google-sub-001', email:'professional@example.org', emailVerified:true, ...overrides});
function makeServer({enabled=true, verified=claims(), gatewayResult={status:'FIRST_LOGIN',uid,signedJwt:'header.payload.signature'}, gatewayError=false}={}) {
  const calls={gateway:0,profileWrites:0,authWrites:0};
  const broker=createManagementFaFirstLoginBroker({enabled,audience,clock:()=>1_800_000_100_000,
    googleVerifier:{verifyIdToken:async()=>verified},
    gateway:{authorizeAndSignFaFirstLogin:async request=>{calls.gateway++;
      assert.match(request.email,/^[^\s@]+@[^\s@]+\.[^\s@]+$/);assert.equal(request.googleSub,'google-sub-001');
      assert.match(request.nonceDigest,/^[a-f0-9]{64}$/);assert.equal(request.expiresAtSeconds-request.issuedAtSeconds,300);
      if(gatewayError)throw new Error('private-upstream-detail');
      if(request.email!=='professional@example.org')return {status:'DENIED',code:'FA_ACCOUNT_NOT_FOUND'};
      return gatewayResult;}},
    cryptoImpl:webcrypto});
  return {broker,calls};
}

test('server forwards only verified identity to the FA gateway and returns its short-lived token result',async()=>{
  const {broker,calls}=makeServer();
  const result=await broker.claim({googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)});
  assert.deepEqual(result,{status:'FIRST_LOGIN',uid,customToken:'header.payload.signature'});
  assert.deepEqual(calls,{gateway:1,profileWrites:0,authWrites:0});
});

test('disabled by default performs no adapter calls',async()=>{
  const {broker,calls}=makeServer({enabled:false});
  assert.deepEqual(await broker.claim({googleIdToken:'x',nonce:'n'.repeat(32)}),{status:'DENIED',code:'FIRST_LOGIN_DISABLED'});
  assert.equal(Object.values(calls).reduce((a,b)=>a+b,0),0);
});

test('server preserves safe Gateway denials for missing, duplicate, inactive, protected and conflicting accounts',async t=>{
  for (const code of ['FA_ACCOUNT_NOT_FOUND','FA_ACCOUNT_AMBIGUOUS','FA_PROFILE_NOT_AUTHORIZED','FA_ACCOUNT_NOT_IN_OPERATIONAL_COHORT','FA_PROVIDER_CONFLICT'])
    await t.test(code,async()=>{
    const {broker,calls}=makeServer({gatewayResult:{status:'DENIED',code}});
    assert.deepEqual(await broker.claim({googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)}),{status:'DENIED',code});
    assert.equal(calls.gateway,1);
    assert.equal(calls.profileWrites+calls.authWrites,0);
  });
});

test('rejects changed email, unverified Google email and invalid identity claims',async t=>{
  for (const [name,overrides] of [
    ['email mismatch',{email:'different@example.org'}], ['email not verified',{emailVerified:false}],
    ['nonce mismatch',{nonce:'x'.repeat(32)}], ['issuer mismatch',{issuer:'https://attacker.invalid'}],
    ['audience mismatch',{audience:'another-client'}], ['expired',{expiresAtSeconds:1_800_000_099}],
    ['missing subject',{sub:''}]
  ]) await t.test(name,async()=>{
    const {broker,calls}=makeServer({verified:claims(overrides)});
    const result=await broker.claim({googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)});
    assert.equal(result.status,'DENIED');
    assert.equal(calls.gateway,name==='email mismatch'?1:0);
  });
});

test('repeat login receives ALREADY_LINKED from FA and does not mint another token',async()=>{
  const {broker,calls}=makeServer({gatewayResult:{status:'ALREADY_LINKED',uid}});
  assert.deepEqual(await broker.claim({googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)}),{status:'ALREADY_LINKED',uid});
  assert.equal(calls.gateway,1);
});

test('provider conflicts are decided by FA Gateway; caller cannot choose a UID',async()=>{
  const {broker,calls}=makeServer({gatewayResult:{status:'DENIED',code:'FA_PROVIDER_CONFLICT'}});
  assert.deepEqual(await broker.claim({googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)}),{status:'DENIED',code:'FA_PROVIDER_CONFLICT'});
  assert.equal(calls.gateway,1);
});

test('Gateway/network errors are sanitized and never mutate auth/profile',async t=>{
  for(const options of [{gatewayError:true}]) await t.test(Object.keys(options)[0],async()=>{
    const {broker,calls}=makeServer(options);
    const result=await broker.claim({googleIdToken:'synthetic-google-id-token',nonce:'n'.repeat(32)});
    assert.equal(result.status,'DENIED');
    assert.equal(JSON.stringify(result).includes('private-upstream-detail'),false);
    assert.equal(calls.profileWrites+calls.authWrites,0);
  });
});

function makeBrowserFlow({response={status:'FIRST_LOGIN',uid,customToken:'synthetic-custom-token'},
  linkError=false, signInUid=uid, postLinkUid='google-sub-001', initialUser=null, claimHook=()=>{}}={}) {
  const calls=[]; const auth={currentUser:initialUser};
  const user={uid:signInUid,providerData:[]};
  const flow=createManagementFaFirstLoginFlow({enabled:true,auth,cryptoImpl:webcrypto,
    requestGoogleIdToken:async ({nonce})=>{calls.push(['google',nonce]); return 'synthetic-google-id-token';},
    claimFirstLogin:async request=>{calls.push(['claim',request.googleIdToken]); claimHook(auth); return response;},
    googleCredential:()=>({credential:{kind:'google-credential'},googleSub:'google-sub-001'}),
    signInWithCustomToken:async (_auth,token)=>{calls.push(['customToken',token]);auth.currentUser=user;return {user};},
    signInWithCredential:async (_auth,credential)=>{calls.push(['credentialSignIn',credential.kind]);auth.currentUser=user;user.providerData=[{providerId:'google.com',uid:postLinkUid}];return {user};},
    linkWithCredential:async (candidate,credential)=>{calls.push(['link',candidate.uid,credential.kind]);if(linkError)throw new Error('credential-already-in-use'); candidate.providerData=[{providerId:'google.com',uid:postLinkUid}];return {user:candidate};},
    reload:async()=>calls.push(['reload']),signOut:async()=>{calls.push(['signOut']);auth.currentUser=null;}});
  return {flow,calls,auth,user};
}

test('browser first link signs into broker-selected UID then links and verifies the Google provider',async()=>{
  const states=[];const unsubscribe=subscribeManagementFaFirstLoginPending(value=>states.push(value));
  const {flow,calls}=makeBrowserFlow();
  assert.deepEqual(await flow.signIn(),{ok:true,status:'FIRST_LOGIN_LINKED'});
  assert.deepEqual(calls.map(call=>call[0]),['google','claim','customToken','link','reload']);
  assert.equal(calls.find(call=>call[0]==='link')[1],uid);
  assert.deepEqual(states,[true,false]);assert.equal(isManagementFaFirstLoginPending(),false);unsubscribe();
});

test('existing linked users are returned to the unchanged signInWithPopup path',async()=>{
  const {flow,calls}=makeBrowserFlow({response:{status:'ALREADY_LINKED',uid}});
  assert.deepEqual(await flow.signIn(),{ok:false,code:'USE_EXISTING_SIGN_IN_GOOGLE_POPUP'});
  assert.deepEqual(calls.map(call=>call[0]),['google','claim']);
});

test('denied account never signs into Firebase',async()=>{
  const {flow,calls}=makeBrowserFlow({response:{status:'DENIED',code:'FA_PROFILE_NOT_AUTHORIZED'}});
  assert.deepEqual(await flow.signIn(),{ok:false,code:'FA_PROFILE_NOT_AUTHORIZED'});
  assert.deepEqual(calls.map(call=>call[0]),['google','claim']);
});

test('link failure signs out only the newly created matching session',async()=>{
  const {flow,calls,auth}=makeBrowserFlow({linkError:true});
  assert.deepEqual(await flow.signIn(),{ok:false,code:'FIRST_LOGIN_FAILED'});
  assert.equal(auth.currentUser,null);
  assert.deepEqual(calls.map(call=>call[0]),['google','claim','customToken','link','signOut']);
});

test('wrong UID or conflicting Google provider fails closed and cleans created session',async t=>{
  for(const options of [{signInUid:'other-uid'},{postLinkUid:'other-google-sub'}]) await t.test(JSON.stringify(options),async()=>{
    const {flow,calls,auth}=makeBrowserFlow(options);
    assert.equal((await flow.signIn()).ok,false);
    assert.equal(auth.currentUser,null);
    assert.equal(calls.at(-1)[0],'signOut');
  });
});

test('preexisting FA session and default-off mode make no auth changes',async t=>{
  const existing={uid:'already-signed-in'};
  const active=makeBrowserFlow({initialUser:existing});
  assert.deepEqual(await active.flow.signIn(),{ok:false,code:'FA_SESSION_ALREADY_PRESENT'});
  assert.deepEqual(active.calls,[]);
  const disabled=createManagementFaFirstLoginFlow({enabled:false});
  assert.deepEqual(await disabled.signIn(),{ok:false,code:'FIRST_LOGIN_DISABLED'});
});

test('a competing FA session during broker roundtrip is not replaced or signed out',async()=>{
  const other={uid:'other-session'};const {flow,calls,auth}=makeBrowserFlow({claimHook:state=>{state.currentUser=other;}});
  assert.deepEqual(await flow.signIn(),{ok:false,code:'FA_SESSION_CHANGED'});
  assert.equal(auth.currentUser,other);assert.deepEqual(calls.map(call=>call[0]),['google','claim']);
});

test('late Gateway response is discarded after an unrelated FA session appears and disappears',async()=>{
  const other={uid:'other-session'};
  const {flow,calls,auth}=makeBrowserFlow({claimHook:state=>{
    state.currentUser=other;observeManagementFaFirstLoginAuthUid(other.uid);
    state.currentUser=null;observeManagementFaFirstLoginAuthUid(null);
  }});
  assert.deepEqual(await flow.signIn(),{ok:false,code:'FA_SESSION_CHANGED'});
  assert.equal(auth.currentUser,null);assert.deepEqual(calls.map(call=>call[0]),['google','claim']);
});

test('concurrent clicks are serialized',async()=>{
  let resolveGoogle;const gate=new Promise(resolve=>resolveGoogle=resolve);const {flow}=makeBrowserFlow();
  flow.signIn();
  const other=await flow.signIn();assert.deepEqual(other,{ok:false,code:'FIRST_LOGIN_BUSY'});
  resolveGoogle('synthetic-google-id-token');
});

test('Google token verifier validates an actual synthetic RS256 signature and claims',async()=>{
  const pair=await webcrypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const jwk=await webcrypto.subtle.exportKey('jwk',pair.publicKey);Object.assign(jwk,{kid:'synthetic-key',alg:'RS256',use:'sig'});
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const now=1_800_000_100;
  const header=encode({alg:'RS256',kid:'synthetic-key',typ:'JWT'});
  const payload=encode({iss:'https://accounts.google.com',aud:audience,azp:audience,iat:now-10,exp:now+300,
    nonce:'n'.repeat(32),sub:'google-sub-001',email:'professional@example.org',email_verified:true});
  const signingInput=`${header}.${payload}`;
  const signature=Buffer.from(await webcrypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(signingInput))).toString('base64url');
  const idToken=`${signingInput}.${signature}`;
  const {createGoogleIdTokenVerifier}=await import('../scripts/lib/google-id-token-verifier.js');
  const jwks=JSON.stringify({keys:[jwk]});
  const fetchImpl=async(url,init)=>{
    assert.equal(url,'https://www.googleapis.com/oauth2/v3/certs');assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');
    return {status:200,url,redirected:false,headers:new Headers({'content-type':'application/json','content-length':String(new TextEncoder().encode(jwks).length),'cache-control':'public, max-age=300'}),
      body:new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(jwks));controller.close();}})};
  };
  const verifier=createGoogleIdTokenVerifier({fetchImpl,cryptoImpl:webcrypto,clock:()=>now*1000});
  const verified=await verifier.verifyIdToken(idToken,{audience,nonce:'n'.repeat(32),nowMs:now*1000});
  assert.equal(verified.sub,'google-sub-001');assert.equal(verified.emailVerified,true);
  await assert.rejects(verifier.verifyIdToken(`${header}.${payload}.${Buffer.from('tampered').toString('base64url')}`,{audience,nonce:'n'.repeat(32),nowMs:now*1000}),/GOOGLE_ID_TOKEN_SIGNATURE_INVALID/);
  let redirectedFetches=0;
  const redirects=createGoogleIdTokenVerifier({fetchImpl:async(url,init)=>{
    redirectedFetches++;assert.equal(init.redirect,'manual');
    return {status:302,url,redirected:false,headers:new Headers({location:'https://untrusted.example/keys'})};
  },cryptoImpl:webcrypto,clock:()=>now*1000});
  await assert.rejects(redirects.verifyIdToken(idToken,{audience,nonce:'n'.repeat(32),nowMs:now*1000}),/GOOGLE_ID_TOKEN_KEYS_UNAVAILABLE/);
  assert.equal(redirectedFetches,1);
});

test('Google Identity Services is loaded only on explicit request and receives nonce; token is not logged',async()=>{
  const appended=[];let configuration;let googleApi;const google={accounts:{id:{initialize:value=>configuration=value,prompt:()=>configuration.callback({credential:'synthetic-id-token'})}}};
  const requester=createGoogleIdentityTokenRequester({clientId:'1234567890-synthetic.apps.googleusercontent.com',documentImpl:{createElement:()=>({}),head:{appendChild:script=>{appended.push(script);googleApi=google;script.onload();}}},googleApi:()=>googleApi});
  assert.equal(await requester({nonce:'n'.repeat(32)}),'synthetic-id-token');
  assert.equal(appended.length,1);assert.equal(appended[0].src,'https://accounts.google.com/gsi/client');
  assert.equal(configuration.nonce,'n'.repeat(32));assert.equal(configuration.auto_select,false);
});

test('Firebase Google credential uses ID token and its sub only for post-link verification',()=>{
  const idToken=`a.${Buffer.from(JSON.stringify({sub:'google-sub-001',email:'untrusted@example.org'})).toString('base64url')}.c`;
  const credential={opaque:true};let supplied;
  const makeCredential=createGoogleCredentialFactory({credential:token=>(supplied=token,credential)});
  const result=makeCredential(idToken);
  assert.equal(result.googleSub,'google-sub-001');assert.equal(result.credential,credential);assert.equal(supplied,idToken);
  assert.equal(makeCredential('bad'),null);
});
