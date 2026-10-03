import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateEmulatorTarget,validateReplayCapture,createEmulatorReplay,fictionalReplayCapture,HOMOLOGATION_PROJECT} from '../scripts/evaluation-homologation.js';

const fixture=()=>{const replay=createEmulatorReplay({projectId:HOMOLOGATION_PROJECT,emulatorHost:'127.0.0.1:8080'});return fictionalReplayCapture(replay);};
test('homologation target accepts loopback demo emulator only',()=>{
  for(const host of ['127.0.0.1:8080','localhost:8080','[::1]:8080']) assert.equal(validateEmulatorTarget(HOMOLOGATION_PROJECT,host).projectId,HOMOLOGATION_PROJECT);
  for(const project of ['sahmt-17a16','demo-other',undefined,'demo-sahmt-v2/../sahmt-17a16']) assert.throws(()=>validateEmulatorTarget(project,'127.0.0.1:8080'));
  for(const host of [undefined,'firestore.googleapis.com:443','192.168.1.20:8080','localhost.attacker.invalid:8080','localhost:8080@attacker.invalid','https://localhost:8080','localhost:65536','localhost:0','localhost:8080/path','user:password@localhost:8080']) assert.throws(()=>validateEmulatorTarget(HOMOLOGATION_PROJECT,host));
});
test('capture excludes protected original and unpublished model',()=>{
  for(const formId of ['1NFqJHXOiHInHtQlmZMOTKHgjgmeYB4TxJ9s2p8xRTmc','1z-T7EL_FN1blDQa9Cn8SybHV_pJOr1dnVObVtHXtcmc']) {const capture=fixture();capture.formId=formId;capture.metadata.formId=formId;assert.throws(()=>validateReplayCapture(capture),/Protected/);}
});
test('capture requires three active independent approved roles and verified identities',()=>{
  assert.equal(validateReplayCapture(fixture()).profiles.length,3);
  for(const mutate of [c=>c.roles.reviewerUid=c.roles.managerUid,c=>c.profiles[0].active=false,c=>c.profiles[0].access=false,c=>c.profiles[2].role='usuario',c=>c.profiles[0].role='administrador_app',c=>c.profiles[1].email=c.profiles[0].email,c=>c.metadata.settings.emailCollectionType='RESPONDER_INPUT',c=>c.metadata.info.title='Original sem homologação',c=>c.profiles[0].id='wrong']) {const capture=fixture();mutate(capture);assert.throws(()=>validateReplayCapture(capture));}
});
test('capture requires READY configuration/current assignment and restricted response budget',()=>{
  for(const mutate of [c=>c.config.status='PENDING',c=>c.activity.active=false,c=>c.area.active=false,c=>c.assignment.uid=c.roles.reviewerUid,c=>c.config.eligibleUids.push('outsider'),c=>c.responses[0].respondentEmail='unapproved@example.invalid',c=>c.responses[0].formId='OtherForm',c=>c.responses.push(c.responses[0]),c=>c.responses=Array.from({length:26},(_,i)=>({...c.responses[0],responseId:`r${i}`}))]) {const capture=fixture();mutate(capture);assert.throws(()=>validateReplayCapture(capture));}
});
test('pending grade survives capture without a synthetic zero',()=>{const capture=fixture();assert.equal(Object.hasOwn(capture.responses[0],'totalScore'),false);assert.equal(validateReplayCapture(capture).responses.length,1);});
test('constructor compiles unchanged GS source without contacting any service or enabling gates',()=>{
  const replay=createEmulatorReplay({projectId:HOMOLOGATION_PROJECT,emulatorHost:'127.0.0.1:8080'});
  assert.equal(replay.requests.length,0);assert.equal(replay.properties.has('SAHMT_V2_EVALUATION_ENABLED'),false);assert.equal(replay.properties.has('SAHMT_V2_EVALUATION_HOMOLOGATED'),false);
  replay.properties.clear();assert.throws(()=>replay.ctx.evaluationAssertOperator_(true),/autorizado/);assert.equal(replay.requests.length,0);
  assert.throws(()=>replay.ctx.ScriptApp.getOAuthToken(),/No OAuth/);assert.throws(()=>replay.ctx.ScriptApp.newTrigger(),/prohibited/);assert.throws(()=>replay.ctx.FormApp.openById('any'),/prohibited/);
});
test('external/production requests are rejected before transport',()=>{
  const replay=createEmulatorReplay({projectId:HOMOLOGATION_PROJECT,emulatorHost:'127.0.0.1:8080'});
  for(const url of ['https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents/users/person','http://192.168.1.20:8080/v1/projects/demo-sahmt-v2/databases/(default)/documents','http://127.0.0.1:8080/v1/projects/sahmt-17a16/databases/(default)/documents']) assert.throws(()=>replay.transport(url),/rejected/);
  assert.throws(()=>replay.transport(replay.target.documents+':commit',{method:'POST',payload:JSON.stringify({writes:[{update:{name:'projects/sahmt-17a16/databases/(default)/documents/users/person'}}]})}),/Production resource/);
  assert.equal(replay.requests.length,0);assert.throws(()=>replay.ctx.formsEvaluationGoogleRequest_('https://forms.googleapis.com/v1/forms/Original'),/no captured fixture/);
});
test('harness replaces providers only and never bypasses financial planners or production guards',()=>{
  const source=readFileSync(new URL('../scripts/evaluation-homologation.js',import.meta.url),'utf8');
  for(const forbidden of ['ctx.evaluationAssertOperator_ =','ctx.evaluationApplyAwards_ =','ctx.evaluationRunTransaction_ =','ctx.evaluationProcessScoreCorrection_ =','ctx.formsEvaluationProcessResponse_ =','ctx.validateChecklistSignatureRequest_ =']) assert.equal(source.includes(forbidden),false,forbidden);
  assert.match(source,/windowsHide:true/);assert.match(source,/redirect:'error'/);assert.match(source,/Bearer owner/);
});
