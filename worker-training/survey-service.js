import {validateEpidemiologicalSubmission,REGISTRATION_CYCLE} from '../src/registration-domain.js';
import {validateSubmission as climateInput,VERSION as climateVersion,CYCLE} from '../climate-domain/schema.js';
import {validateSubmission as stressInput,VERSION as stressVersion} from '../stress-domain/schema.js';
import {assignedInstitutionalGroup,institutionalAssignmentKey,researchGroup} from '../src/institutional-group.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const kinds={epidemiological:{cycleCollection:'epidemiologicalCycles',responseCollection:'epidemiologicalResponses',version:'1.0',validate:validateEpidemiologicalSubmission},climate:{cycleCollection:'climateCycles',responseCollection:'climateResponses',version:climateVersion,validate:climateInput},stress:{cycleCollection:'stressCycles',responseCollection:'stressResponses',version:stressVersion,validate:stressInput}};
export function createSurveyService({profileStore,responseStore,uuid=()=>crypto.randomUUID().replaceAll('-',''),reportReaderEmail}={}) {
  if(!profileStore?.get||!responseStore?.transaction)throw Error('SURVEY_STORE_REQUIRED');
  async function authorize(identity){
    if(!identity?.uid||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(identity.uid)||identity.emailVerified!==true||identity.provider!=='google.com'||typeof identity.email!=='string'||!identity.email.includes('@'))fail('SURVEY_UNAUTHENTICATED',401);
    const email=identity.email.trim().toLowerCase(),profile=await profileStore.get('users',identity.uid);
    if(!profile||profile.uid!==identity.uid||profile.email?.trim().toLowerCase()!==email||profile.active!==true||profile.access!==true||/^anestesiahmtforms(?:[2-5])?@gmail\.com$/i.test(email))fail('SURVEY_FORBIDDEN',403);
    const assignment=await profileStore.get('userCategories',await institutionalAssignmentKey(email));
    const group=assignedInstitutionalGroup(assignment,{uid:identity.uid,email});
    if(!group)fail('SURVEY_GROUP_UNAVAILABLE',403);
    return researchGroup(group);
  }
  async function execute(action,input,identity){
    if(action==='REPORT'&&exact(input,['survey','cycle'])&&input.survey==='epidemiological'&&input.cycle===CYCLE){if(!identity?.uid||identity.emailVerified!==true||identity.provider!=='google.com'||identity.email?.trim().toLowerCase()!==reportReaderEmail?.toLowerCase())fail('SURVEY_FORBIDDEN',403);const p=await profileStore.get('users',identity.uid);if(!p||p.uid!==identity.uid||p.email?.toLowerCase()!==identity.email.toLowerCase()||p.active!==true||p.access!==true||!(p.role==='administrador_app'||p.permissions?.admin===true))fail('SURVEY_FORBIDDEN',403);const cycle=await responseStore.get('epidemiologicalCycles',CYCLE);const report=cycle?.status==='closed'?await responseStore.get('epidemiologicalReports',CYCLE):null;const fresh=await profileStore.get('users',identity.uid);if(!fresh||fresh.uid!==identity.uid||fresh.email?.toLowerCase()!==identity.email.toLowerCase()||fresh.active!==true||fresh.access!==true||!(fresh.role==='administrador_app'||fresh.permissions?.admin===true))fail('SURVEY_FORBIDDEN',403);return {report:report?.grouping_version===2?report:null};}
    if(!['BOOTSTRAP','SUBMIT'].includes(action)||!exact(input,action==='BOOTSTRAP'?['survey','cycle']:['survey','cycle','response'])||!Object.hasOwn(kinds,input.survey)||input.cycle!==CYCLE)fail('SURVEY_INVALID_INPUT');
    const group=await authorize(identity),kind=kinds[input.survey],ledgerKey=`${identity.uid}_${input.survey}_${CYCLE}`;
    let response;
    if(action==='SUBMIT'){
      try {response=kind.validate({...input.response,group});}catch{fail('SURVEY_INVALID_INPUT');}
    }
    return responseStore.transaction(async tx=>{
      const cycle=await tx.get(kind.cycleCollection,CYCLE);
      if(cycle?.status!=='open'&&!(input.survey==='epidemiological'&&action==='BOOTSTRAP'&&cycle?.status==='closed'))fail('SURVEY_CYCLE_CLOSED',409);
      const participation=await tx.get('surveyParticipation',ledgerKey);
      if(participation&&!exact(participation,['uid','survey','cycle','completed']))fail('SURVEY_PARTICIPATION_INVALID',503);
      if(participation&&(participation.uid!==identity.uid||participation.survey!==input.survey||participation.cycle!==CYCLE||participation.completed!==true))fail('SURVEY_PARTICIPATION_INVALID',503);
      if(action==='BOOTSTRAP')return {group,alreadyResponded:!!participation,...(input.survey==='epidemiological'?{canReadReport:identity.email?.toLowerCase()===reportReaderEmail?.toLowerCase(),closed:cycle.status==='closed'}:{})};
      if(participation)return {accepted:true,alreadyResponded:true};
      if(await tx.get(kind.responseCollection,response.submission_id))fail('SURVEY_RESPONSE_ID_REUSED',409);
      const currentGroup=await authorize(identity);
      if(currentGroup!==group)fail('SURVEY_GROUP_CHANGED',409);
      // The ledger has no answer reference, group or explicit time. Firestore
      // commit metadata and infrastructure logs can still correlate the writes.
      tx.create('surveyParticipation',ledgerKey,{uid:identity.uid,survey:input.survey,cycle:CYCLE,completed:true});
      tx.create(kind.responseCollection,response.submission_id,{survey_cycle:CYCLE,survey_version:kind.version,group,answers:response.answers,...(response.stress_rating!==undefined?{stress_rating:response.stress_rating}:{})});
      if(input.survey==='climate'&&Object.keys(response.comments).length||input.survey==='epidemiological'&&response.comments){const id=uuid();if(!validId(id)||id===response.submission_id)fail('SURVEY_RANDOM_ID_INVALID',503);tx.create(input.survey==='climate'?'climateComments':'epidemiologicalComments',id,{survey_cycle:CYCLE,comments:response.comments});}
      return {accepted:true,alreadyResponded:false};
    });
  }
  return {execute};
}
