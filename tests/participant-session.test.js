import test from 'node:test';import assert from 'node:assert/strict';
import {participantAccess,callParticipantSurvey} from '../climate/participant-session.js';
import {SURVEY_APP_ORIGIN,SURVEY_FE_ORIGIN} from '../src/survey-session-bridge.js';
const path='/SAHMT-V2.0.github.io/enquetes/';
test('legacy standalone FE links go to the fixed app origin, without forwarding query or identity parameters',async()=>{
 for(const origin of [SURVEY_FE_ORIGIN,'https://outros-48120.firebaseapp.com']){
  const location={origin,pathname:'/stress.html',search:'?uid=forbidden&group=team',replace(url){this.redirected=url;}},appWindow={location};appWindow.parent=appWindow;
  assert.deepEqual(participantAccess(location,false),{mode:'redirect',url:SURVEY_APP_ORIGIN+'/SAHMT-V2.0.github.io/tools/enquetes/stress.html'});
  await assert.rejects(callParticipantSurvey({action:'BOOTSTRAP'},{appWindow,loadSession:()=>assert.fail('No FA token may be read on the FE origin')}),/NAVIGATING_TO_APP/);
  assert.equal(location.redirected,SURVEY_APP_ORIGIN+'/SAHMT-V2.0.github.io/tools/enquetes/stress.html');assert.ok(!location.redirected.includes('?'));
 }
});
test('standalone app-origin surveys reuse the current account; embedded FE still uses the origin-pinned bridge',async()=>{
 const appWindow={location:{origin:SURVEY_APP_ORIGIN,pathname:path+'stress.html'}};appWindow.parent=appWindow;
 const calls=[],auth={currentUser:{uid:'synthetic'}};
 const result=await callParticipantSurvey({action:'BOOTSTRAP'},{appWindow,loadSession:async()=>({uid:'synthetic',auth,callInstitutionalSurvey:async options=>{calls.push(options);return {group:'team',alreadyResponded:false};}})});
 assert.deepEqual(result,{group:'team',alreadyResponded:false});assert.equal(calls[0].survey,'stress');assert.equal(calls[0].isCurrent(),true);auth.currentUser=null;assert.equal(calls[0].isCurrent(),false);
 const embedded={location:{origin:SURVEY_FE_ORIGIN,pathname:'/'},parent:{}};
 assert.equal(await callParticipantSurvey({action:'BOOTSTRAP'},{appWindow:embedded,loadSession:()=>assert.fail('No participant auth in FE frame'),bridge:async()=> 'bridge'}),'bridge');
 assert.equal(participantAccess({origin:'https://evil.invalid',pathname:path},false).mode,'blocked');assert.equal(participantAccess({origin:SURVEY_APP_ORIGIN,pathname:'/other'},false).mode,'blocked');
});
