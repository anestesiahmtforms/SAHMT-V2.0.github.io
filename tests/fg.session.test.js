import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {DOMAIN_PROJECTS,canEnterModule,serviceIdentity} from '../worker-operational-domain/identity.js';
import {createOperationalDomainWorker} from '../worker-operational-domain/worker.js';
import {createOperationalModuleSession} from '../src/operational-module-session.js';

const actor={uid:'synthetic-member',email:'member@example.test',authTime:1800000000};
const profile={...actor,active:true,access:true,permissions:{checklistRead:true}};
test('FG entry uses Checklist permissions and refuses other-module grants or revoked access',()=>{
  assert.equal(DOMAIN_PROJECTS.FG,'sahmt-checklist-fg');
  assert.equal(canEnterModule(profile,actor,'FG'),true);
  for(const override of [{permissions:{labelsRead:true}},{active:false},{access:false},{uid:'other'}])
    assert.equal(canEnterModule({...profile,...override},actor,'FG'),false);
});
test('FG signs the same UID for its own project and never accepts a swapped service account',()=>{
  const keys=generateKeyPairSync('rsa',{modulusLength:2048});
  const credentials={project_id:'sahmt-checklist-fg',client_email:'fg-module-worker@sahmt-checklist-fg.iam.gserviceaccount.com',private_key:keys.privateKey.export({type:'pkcs8',format:'pem'})};
  const token=serviceIdentity(credentials,'FG',{now:()=>1800000000000}).customToken(actor).split('.');
  assert.equal(verify('RSA-SHA256',Buffer.from(token.slice(0,2).join('.')),keys.publicKey,Buffer.from(token[2],'base64url')),true);
  const claims=JSON.parse(Buffer.from(token[1],'base64url'));
  assert.equal(claims.uid,actor.uid);assert.equal(claims.claims.moduleStation,'FG');assert.equal(claims.claims.sourceProjectId,'sahmt-17a16');
  assert.throws(()=>serviceIdentity({...credentials,project_id:'sahmt-17a16'},'FG'),/DOMAIN_CONFIG_REQUIRED/);
});
test('FG exchanges a verified central session using its own profile and performs no event projection work',async()=>{
  const urls=[],worker=createOperationalDomainWorker({verify:async()=>actor,createService:()=>({accessToken:async()=>'synthetic',customToken:()=>'synthetic-custom'}),fetchImpl:async url=>{urls.push(url);return Response.json({name:url.replace('https://firestore.googleapis.com/v1/',''),fields:{uid:{stringValue:actor.uid},email:{stringValue:actor.email},active:{booleanValue:true},access:{booleanValue:true},permissions:{mapValue:{fields:{checklistRead:{booleanValue:true}}}}}});},createStore:()=>assert.fail('FG does not process FI/FJ projection queues')});
  const env={MODULE_STATION:'FG',MODULE_PROJECT_ID:'sahmt-checklist-fg',MODULE_CUTOVER_ACTIVE:'true',ALLOWED_ORIGINS:'https://example.test',MODULE_SERVICE_ACCOUNT_JSON:'{}'};
  const response=await worker.fetch(new Request('https://worker.test/v1/session',{method:'POST',headers:{Origin:'https://example.test',Authorization:'Bearer synthetic','Content-Type':'application/json'},body:'{}'}),env);
  assert.equal(response.status,200);assert.equal((await response.json()).uid,actor.uid);
  assert.equal(urls[1],'https://firestore.googleapis.com/v1/projects/sahmt-checklist-fg/databases/(default)/documents/users/'+actor.uid);
  await worker.scheduled({},env,{waitUntil:()=>assert.fail('FG session service has no scheduler')});
});
test('FG client keeps its lease in memory and signs out with FA',async()=>{
  const now=1800000000000,source={uid:actor.uid,getIdToken:async()=>'synthetic'};
  const faAuth={currentUser:source},targetAuth={app:{options:{projectId:'sahmt-checklist-fg'}},currentUser:null};let listener,exchanges=0;
  const session=createOperationalModuleSession({station:'FG',faAuth,targetAuth,subscribeSource:fn=>{listener=fn;return()=>{};},exchange:async()=>{exchanges++;return {uid:actor.uid,customToken:'synthetic',expiresIn:300};},signIn:async()=>{targetAuth.currentUser={uid:actor.uid,getIdTokenResult:async()=>({claims:{aud:'sahmt-checklist-fg',sub:actor.uid,sourceProjectId:'sahmt-17a16',moduleStation:'FG',moduleLeaseExpiresAt:now/1000+300,firebase:{sign_in_provider:'custom'}}})};return {user:targetAuth.currentUser};},signOut:async()=>{targetAuth.currentUser=null;},now:()=>now,setTimer:()=>0,clearTimer:()=>{}});
  await session.ensure(actor.uid);await session.ensure(actor.uid);assert.equal(exchanges,1);
  faAuth.currentUser=null;listener();await assert.rejects(session.ensure(actor.uid),/MODULE_SOURCE_SESSION_REQUIRED/);await session.dispose();assert.equal(targetAuth.currentUser,null);
});
