import {feSurveyEndpoint} from './institutional-survey-client.js';
import {fcProfessionalRegistrationEnabled,fcProfessionalRegistrationEndpoint} from './fc-integration-config.js';
import {announceRegistrationChange} from './registration-refresh.js';

const legacyOrigin = 'https://sahmt-html-training.anestesiahmtforms.workers.dev';

export async function callRegistrationApi({uid,isCurrent,kind,action,input={},signal}={}) {
 const {auth} = await import('./firebase-auth.js');
 await auth?.authStateReady();
 const mainUser = auth?.currentUser;
 const current = () => isCurrent() && auth?.currentUser === mainUser && mainUser?.uid === uid;
 if (!current()) throw Error('Sua sessão mudou. Entre novamente.');

 let source = auth;
 const useFc = kind !== 'epidemiological' && fcProfessionalRegistrationEnabled;
 if (useFc) {
  const {getIndicatorsAuth,waitForIndicatorsSession} = await import('./fc-module-firebase.js');
  if (!await waitForIndicatorsSession({isCurrent:current})) throw Object.assign(Error('REGISTRATION_UNAUTHENTICATED'),{status:401});
  source = getIndicatorsAuth();
 }
 const user = source?.currentUser;
 const valid = () => current() && source.currentUser === user && user &&
  source.app?.options?.projectId === (useFc ? 'indicadores---sahmt' : 'sahmt-17a16');
 if (!valid()) throw Error('Sua sessão mudou. Entre novamente.');
 const token = await user.getIdToken();
 if (!valid()) throw Error('Sua sessão mudou. Entre novamente.');

 const path = kind === 'drive' ? '/v1/registration-drive' : '/v1/professional-registration';
 const endpoint = kind === 'epidemiological' ? feSurveyEndpoint : useFc ? fcProfessionalRegistrationEndpoint(path) : legacyOrigin + path;
 const payload = kind === 'epidemiological' ? {survey:'epidemiological',cycle:'2026',...(action === 'SUBMIT' ? {response:input} : {})} : input;
 const response = await fetch(endpoint,{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ' + token},
  body:JSON.stringify({action,input:payload}),credentials:'omit',referrerPolicy:'no-referrer',
  cache:'no-store',redirect:'error',signal:signal || AbortSignal.timeout(60000)
 });
 if (!valid()) throw Error('Sua sessão mudou. Entre novamente.');
 const data = await response.json();
 if (!valid()) throw Error('Sua sessão mudou. Entre novamente.');
 if (!response.ok) throw Object.assign(Error(data.code || 'UNAVAILABLE'),{code:data.code,status:response.status});
 if (kind === 'professional' && action === 'SAVE' && data.record?.uid === uid ||
     kind === 'drive' && action === 'UPLOAD' && data.file?.status === 'STORED') announceRegistrationChange();
 return data;
}
