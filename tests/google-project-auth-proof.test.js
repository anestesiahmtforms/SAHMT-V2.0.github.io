import test from 'node:test';
import assert from 'node:assert/strict';
import {authProofReport} from './fixtures/five-project-google-auth-report.js';
const user=(uid,googleUid='google-identity')=>({uid,email:'private@example.test',accessToken:'private-token',providerData:[{providerId:'google.com',uid:googleUid}]});
test('prova distingue UID divergente, vínculo Google divergente e sessão ausente',()=>{
  const report=authProofReport({users:{FA:user('pilot'),FB:user('other'),FC:user('pilot','other-google'),FD:user('pilot')},expectedUid:'pilot'});
  assert.equal(report.pilotIdentityMatches,true);
  assert.equal(report.projects.FB.uidMatchesFa,false);
  assert.equal(report.projects.FC.googleIdentityMatchesFa,false);
  assert.equal(report.projects.FD.uidMatchesFa,true);
  assert.equal(report.projects.FE.status,'disconnected');
});
test('relatório não expõe UID, e-mail, tokens nem mensagens externas',()=>{
  const report=authProofReport({users:{FA:user('private-uid')},expectedUid:'private-uid',evidence:{confirmations:Infinity,
    code:'secret-server-message',logout:{status:'complete',token:'secret'},exchanges:{FB:{status:'failed',code:'secret-error',idToken:'secret'}}}});
  const text=JSON.stringify(report);
  for(const value of ['private-uid','private@example.test','private-token','secret-server-message','secret-error','idToken'])assert.equal(text.includes(value),false);
  assert.equal(report.googleConfirmations,0);assert.equal(report.resultCode,'AUTH_UNAVAILABLE');
  assert.equal(report.projects.FB.code,'AUTH_UNAVAILABLE');assert.equal(report.logout,'complete');
});
test('sessões prontas restauradas não são apresentadas como troca de credencial comprovada',()=>{
  const report=authProofReport({users:{FA:user('pilot'),FB:user('pilot')},expectedUid:'pilot'});
  assert.equal(report.projects.FB.status,'connected');assert.equal(report.projects.FB.exchange,'not_attempted');
  assert.equal(report.reauthenticated,false);
});
