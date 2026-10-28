import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyInstitutionalGroup} from '../climate/participant-group.js';
import {sendSubmission,commitBody} from '../climate/transport.js';
import {VERSION,CYCLE} from '../climate-domain/schema.js';
const user=()=>({uid:'member',email:'member@example.invalid',emailVerified:true,providerData:[{providerId:'google.com',uid:'google-member'}],getIdToken:async()=> 'test-token'});
const payload={survey_version:VERSION,survey_cycle:CYCLE,submission_id:'a'.repeat(32),group:'team',answers:{Q01:4},comments:{O01:'Comment'}};
test('reuse app sessions without interaction; bind commits and reject account changes before retry',async()=>{
 const primary=user(),member=user(),source={currentUser:primary,authStateReady:async()=>{}},destination={currentUser:member,authStateReady:async()=>{}};
 const apps=[{name:'sahmt-v2',auth:source},{name:'sahmt-fe-direct',auth:destination}],sdk={getApps:()=>apps,getAuth:app=>app.auth};
 const original=globalThis.fetch;let commits=0;
 globalThis.fetch=async(url,options)=>{
   assert.equal(options.headers.Authorization,'Bearer test-token');
   if(url.endsWith('documents:commit')){commits++;return {ok:true};}
   return {ok:true,json:async()=>({fields:{schemaVersion:{integerValue:'1'},identityStatus:{stringValue:'LINKED'},uid:{stringValue:'member'},email:{stringValue:member.email},memberCategories:{arrayValue:{values:[{stringValue:'EFETIVO'}]}}}})};
 };
 try{
  const participant=await identifyInstitutionalGroup({sdk});assert.equal(participant.group,'team');
  const body=commitBody(payload,'b'.repeat(32),participant);
  for(const w of body.writes){assert.equal(w.update.fields.respondent_uid.stringValue,'member');assert.equal(w.update.fields.group.stringValue,'team');}
  await sendSubmission(payload,'b'.repeat(32),undefined,participant);assert.equal(commits,1);
  source.currentUser=user();await assert.rejects(sendSubmission(payload,'b'.repeat(32),undefined,participant),/SESSION_CHANGED/);assert.equal(commits,1);
  source.currentUser=null;await assert.rejects(identifyInstitutionalGroup({sdk}),/SESSION_REQUIRED/);
  source.currentUser={...primary,uid:'other'};await assert.rejects(identifyInstitutionalGroup({sdk}),/SESSION_REQUIRED/);
  source.currentUser=primary;destination.currentUser=null;await assert.rejects(identifyInstitutionalGroup({sdk}),/SESSION_REQUIRED/);
 }finally{globalThis.fetch=original;}
});
