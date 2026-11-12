import {doc,getDocFromServer} from 'firebase/firestore';
import {getFunctionalFirestore} from './functional-firebase.js';

const endpoint=import.meta.env.VITE_FK_SURVEY_ENDPOINT;
const cycle='2026';
const validSurvey=value=>['climate','stress','epidemiological'].includes(value);

export async function callFunctionalSurvey({uid,faAuth,survey,action,response,isCurrent=()=>true,fetchImpl=fetch}={}){
  const source=faAuth?.currentUser;
  if(!uid||!source||source.uid!==uid||!validSurvey(survey)||!['BOOTSTRAP','SUBMIT'].includes(action)||!isCurrent())
    throw Error('FK_SURVEY_SESSION_REQUIRED');
  if(action==='BOOTSTRAP'){
    const db=getFunctionalFirestore();
    if(!db)throw Error('FK_SURVEY_FIRESTORE_UNAVAILABLE');
    const participation=await getDocFromServer(doc(db,'surveyParticipation',uid+'_'+survey+'_'+cycle));
    if(!isCurrent()||faAuth.currentUser!==source)throw Error('FK_SURVEY_SESSION_CHANGED');
    return {group:'team',alreadyResponded:participation.exists(),closed:false};
  }
  if(!endpoint)throw Error('FK_SURVEY_UNAVAILABLE');
  const faIdToken=await source.getIdToken();
  if(!isCurrent()||faAuth.currentUser!==source)throw Error('FK_SURVEY_SESSION_CHANGED');
  const result=await fetchImpl(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({faIdToken,action,survey,cycle,response}),credentials:'omit',cache:'no-store',redirect:'manual',
    referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
  if(!isCurrent()||faAuth.currentUser!==source)throw Error('FK_SURVEY_SESSION_CHANGED');
  const data=await result.json().catch(()=>null);
  if(!result.ok||data?.uid!==uid||data.status!=='READY'||data.accepted!==true||typeof data.alreadyResponded!=='boolean')
    throw Error(data?.code||'FK_SURVEY_UNAVAILABLE');
  return data;
}
