import {requestSurveySession,SURVEY_APP_ORIGIN,SURVEY_FE_ORIGIN} from '../src/survey-session-bridge.js';
const appBase='/SAHMT-V2.0.github.io/';
const legacyBase=appBase+'tools/enquetes/';
export function participantAccess(location,embedded){
  const survey=location.pathname.endsWith('/stress.html')?'stress':'climate';
  if(embedded)return {mode:'bridge',survey};
  if([SURVEY_FE_ORIGIN,'https://outros-48120.firebaseapp.com'].includes(location.origin))return {mode:'redirect',url:SURVEY_APP_ORIGIN+legacyBase+(survey==='stress'?'stress.html':'')};
  if(location.origin===SURVEY_APP_ORIGIN&&[appBase+'enquetes/',appBase+'enquetes/index.html',appBase+'enquetes/stress.html',legacyBase,legacyBase+'index.html',legacyBase+'stress.html'].includes(location.pathname))return {mode:'session',survey};
  return {mode:'blocked'};
}
let standalone;
async function standaloneSession(){
  if(!standalone)standalone=(async()=>{
    const [{auth},{callInstitutionalSurvey}]=await Promise.all([import('../src/firebase-auth.js'),import('../src/institutional-survey-client.js')]);
    await auth?.authStateReady();
    const uid=auth?.currentUser?.uid;
    if(!uid||auth.app?.options?.projectId!=='sahmt-17a16')throw Error('APP_SESSION_REQUIRED');
    return {uid,auth,callInstitutionalSurvey};
  })();
  return standalone;
}
export async function callParticipantSurvey({action,input=null,signal}={}, {appWindow=window,loadSession=standaloneSession,bridge=requestSurveySession}={}){
  const access=participantAccess(appWindow.location,appWindow.parent!==appWindow);
  if(access.mode==='bridge')return bridge({action,input,signal});
  if(access.mode==='redirect'){
    appWindow.location.replace(access.url);
    throw Error('NAVIGATING_TO_APP');
  }
  if(access.mode!=='session')throw Error('OPEN_FROM_APP');
  const session=await loadSession();
  return session.callInstitutionalSurvey({uid:session.uid,isCurrent:()=>session.auth.currentUser?.uid===session.uid,survey:access.survey,action,response:input});
}
