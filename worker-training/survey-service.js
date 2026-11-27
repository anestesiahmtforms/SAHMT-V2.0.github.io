import {awardFeParticipation,performanceActive} from '../worker-fe-surveys/performance-award.js';
import {validateCompleteEpidemiologicalSubmission} from '../src/registration-domain.js';
import {validateCompleteSubmission as climateInput,VERSION as climateVersion,CYCLE} from '../climate-domain/schema.js';
import {validateCompleteSubmission as stressInput,VERSION as stressVersion} from '../stress-domain/schema.js';
import {assignedInstitutionalGroup,institutionalAssignmentKey,researchGroup} from '../src/institutional-group.js';
import {functionalSurveyCharts} from '../src/functional-survey-charts.js';
import {registrationConvocationAffiliation,registrationConvocationScope} from '../communication/obligations.js';
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const validId=id=>typeof id==='string'&&/^[a-f0-9]{32}$/.test(id);
const validUid=uid=>typeof uid==='string'&&/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(uid);
const folders={climate:'consultas/pesquisas/clima',stress:'consultas/pesquisas/estresse',epidemiological:'consultas/epidemiologico'};
const kinds={epidemiological:{cycleCollection:'epidemiologicalCycles',responseCollection:'epidemiologicalResponses',version:'1.0',validate:validateCompleteEpidemiologicalSubmission},climate:{cycleCollection:'climateCycles',responseCollection:'climateResponses',version:climateVersion,validate:climateInput},stress:{cycleCollection:'stressCycles',responseCollection:'stressResponses',version:stressVersion,validate:stressInput}};
export function createSurveyService({profileStore,responseStore,performanceProfileStore=profileStore,uuid=()=>crypto.randomUUID().replaceAll('-',''),reportReaderEmail,performanceEnabled=false,checkPerformance=async()=>{},checkSurvey=async()=>{},verifyInvitation,now=Date.now}={}) {
  if(!profileStore?.get||!responseStore?.transaction)throw Error('SURVEY_STORE_REQUIRED');
  async function activeProfile(identity,registry=profileStore){
    if(!validUid(identity?.uid)||identity.emailVerified!==true||identity.provider!=='google.com'||typeof identity.email!=='string'||!identity.email.includes('@'))fail('SURVEY_UNAUTHENTICATED',401);
    const email=identity.email.trim().toLowerCase(),profile=await registry.get('users',identity.uid);
    if(!profile||profile.uid!==identity.uid||profile.email?.trim().toLowerCase()!==email||profile.active!==true||profile.access!==true)fail('SURVEY_FORBIDDEN',403);
    return {email,administrator:profile.role==='administrador_app'||profile.permissions?.admin===true};
  }
  async function authorize(identity,survey,registry=profileStore,invitationGroup=null){
    const {email,administrator}=await activeProfile(identity,registry);
    if(/^anestesiahmtforms(?:[2-5])?@gmail\.com$/i.test(email))fail('SURVEY_FORBIDDEN',403);
    const assignment=await registry.get('userCategories',await institutionalAssignmentKey(email));
    const group=assignedInstitutionalGroup(assignment,{uid:identity.uid,email});
    if(!group)fail('SURVEY_GROUP_UNAVAILABLE',403);
    if(survey&&group!=='team'&&!(survey==='epidemiological'&&group===invitationGroup))fail('SURVEY_FORBIDDEN',403);
    return {affiliation:group,group:researchGroup(group),administrator};
  }
  async function execute(action,input,identity){
    if(action==='ADMIN_PARTICIPATION'){
      const survey='epidemiological';
      if(!exact(input,['survey','cycle'])||input.survey!==survey||input.cycle!==CYCLE)fail('SURVEY_INVALID_INPUT');
      if(!(await activeProfile(identity)).administrator)fail('SURVEY_FORBIDDEN',403);
      const records=await responseStore.list('surveyParticipation',[
        {field:'survey',op:'EQUAL',value:survey},
        {field:'cycle',op:'EQUAL',value:CYCLE}
      ],1000);
      const completedUids=records.map(({id,...record})=>{
        if(!exact(record,['uid','survey','cycle','completed'])||!validUid(record.uid)||
          id!==`${record.uid}_${survey}_${CYCLE}`||record.survey!==survey||record.cycle!==CYCLE||record.completed!==true)
          fail('SURVEY_PARTICIPATION_INVALID',503);
        return record.uid;
      });
      if(!(await activeProfile(identity)).administrator)fail('SURVEY_FORBIDDEN',403);
      return {cycle:CYCLE,completedUids};
    }
    if(['OBLIGATION_CATALOG','OBLIGATION_ELIGIBILITY','OBLIGATION_STATUS'].includes(action)){
      const catalog=action==='OBLIGATION_CATALOG',eligibility=action==='OBLIGATION_ELIGIBILITY';
      const convokedGroup=!catalog&&input?.survey==='epidemiological'?registrationConvocationAffiliation(input):null;
      if(!exact(input,catalog?[]:['survey','cycle',...(eligibility?['recipients']:[]),...Object.keys(registrationConvocationScope(convokedGroup))])||!catalog&&(!Object.hasOwn(kinds,input.survey)||input.cycle!==CYCLE))fail('SURVEY_INVALID_INPUT');
      const access=await authorize(identity);
      if((catalog||eligibility)&&!access.administrator)fail('SURVEY_FORBIDDEN',403);
      const titles={climate:'Pesquisa de Clima Organizacional',stress:'Avaliação de Estresse e Fadiga',epidemiological:'Cadastro Epidemiológico SAHMT'};
      const participationValid=(p,uid,survey)=>!p||exact(p,['uid','survey','cycle','completed'])&&p.uid===uid&&p.survey===survey&&p.cycle===CYCLE&&p.completed===true;
      const availability=async(tx,survey)=>{
        try{await checkSurvey(folders[survey],tx);}catch(error){if(error.status===403)return 'SURVEY_FOLDER_DISABLED';throw error;}
        const cycle=await tx.get(kinds[survey].cycleCollection,CYCLE);
        return cycle?.status==='open'?null:'SURVEY_CYCLE_CLOSED';
      };
      return responseStore.transaction(async tx=>{
        if(catalog){
          const items=[];
          for(const survey of Object.keys(kinds))if(!await availability(tx,survey))items.push({kind:'SURVEY',id:survey,title:titles[survey],cycle:CYCLE});
          return {items};
        }
        if(!eligibility){
          // This ledger contains no response IDs or answers; old accepted participation
          // remains valid after cycle closure and subsequent folder deactivation.
          const p=await tx.get('surveyParticipation',`${identity.uid}_${input.survey}_${CYCLE}`);
          if(!participationValid(p,identity.uid,input.survey))fail('SURVEY_PARTICIPATION_INVALID',503);
          if(p)return {completed:true};
          if(access.affiliation!=='team'&&access.affiliation!==convokedGroup)return {completed:false,unavailable:true,reason:'SURVEY_FORBIDDEN'};
          const reason=await availability(tx,input.survey);
          return reason?{completed:false,unavailable:true,reason}:{completed:false};
        }
        if(!Array.isArray(input.recipients)||input.recipients.length>8||new Set(input.recipients.map(r=>r?.uid)).size!==input.recipients.length)fail('SURVEY_INVALID_INPUT');
        const eligibleUids=[],excluded=[],unavailable=await availability(tx,input.survey);
        for(const recipient of input.recipients){
          if(!exact(recipient,['uid','email'])||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(recipient.uid)||typeof recipient.email!=='string'||recipient.email.length>254||!recipient.email.includes('@'))fail('SURVEY_INVALID_INPUT');
          const email=recipient.email.trim().toLowerCase(),assignment=await profileStore.get('userCategories',await institutionalAssignmentKey(email));
          const uid=assignment?.uid;
          const profile=typeof uid==='string'&&/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(uid)?await profileStore.get('users',uid):null;
          const group=assignedInstitutionalGroup(assignment,{uid,email});
          let reason;
          if(!profile||profile.uid!==uid||profile.email?.trim().toLowerCase()!==email||profile.active!==true||profile.access!==true||!group||/^anestesiahmtforms(?:[2-5])?@gmail\.com$/i.test(email))reason='SOURCE_MEMBER_UNAVAILABLE';
          else{
            const p=await tx.get('surveyParticipation',`${uid}_${input.survey}_${CYCLE}`);
            if(!participationValid(p,uid,input.survey))fail('SURVEY_PARTICIPATION_INVALID',503);
            if(!p)reason=group==='team'||group===convokedGroup?unavailable:'SURVEY_FORBIDDEN';
          }
          if(reason)excluded.push({uid:recipient.uid,reason});else eligibleUids.push(recipient.uid);
        }
        return {eligibleUids,excluded};
      });
    }
    if(performanceEnabled&&action==='FK_AGGREGATE'&&exact(input,['survey','cycle'])&&
       Object.hasOwn(kinds,input.survey)&&input.cycle===CYCLE){
      const access=await authorize(identity);
      if(access.affiliation!=='team'&&!access.administrator)fail('SURVEY_FORBIDDEN',403);
      return responseStore.transaction(async tx=>{
        if(!access.administrator)await checkSurvey(folders[input.survey],tx);
        const cycle=await tx.get(kinds[input.survey].cycleCollection,CYCLE);
        if(cycle?.status!=='closed')return {status:'OPEN',groups:[]};
        const report=await tx.get(input.survey+'Reports',CYCLE);
        if(report?.survey_cycle!==CYCLE||report.grouping_version!==2||report.survey_version!==kinds[input.survey].version)
          return {status:'PENDING',groups:[]};
        return {status:'READY',groups:functionalSurveyCharts(input.survey,report)};
      });
    }
    if(performanceEnabled&&action==='GET_PERFORMANCE'&&exact(input,[])){
      if(!(await authorize(identity,undefined,performanceProfileStore)).administrator)await checkPerformance();
      const runtime=await responseStore.get('fePerformanceRuntime','current');
      if(!performanceActive(runtime,now()))return {status:'PREPARING',uid:identity.uid,summary:{uid:identity.uid,total:0},reference:{maxTotal:0},awards:[]};
      const byUid=[{field:'uid',op:'EQUAL',value:identity.uid}];
      const [summary,reference,awards,vaccinationAwards,vaccinationTotals]=await Promise.all([
        responseStore.get('fePerformanceSummaries',identity.uid),responseStore.get('fePerformanceReference','current'),
        responseStore.list('fePerformanceAwards',byUid,200),
        responseStore.list('feVaccinationUpdatedPerformanceAwards',byUid,200),responseStore.list('feVaccinationUpdatedPerformanceSummaries',[],1000)
      ]);
      if(!(await authorize(identity,undefined,performanceProfileStore)).administrator)await checkPerformance();
      const totals=vaccinationTotals.length?await responseStore.getMany('fePerformanceSummaries',vaccinationTotals.map(row=>row.uid)):[];
      const ownVaccinationTotal=vaccinationTotals.find(row=>row.uid===identity.uid)?.total||0;
      const maxTotal=Math.max(reference?.maxTotal||0,...vaccinationTotals.map((row,index)=>row.total+(totals[index]?.total||0)));
      return {status:'READY',uid:identity.uid,summary:{...summary,uid:identity.uid,total:(summary?.total||0)+ownVaccinationTotal},
        reference:{...reference,maxTotal},awards:[...awards,...vaccinationAwards].sort((a,b)=>b.createdAt-a.createdAt).slice(0,200)};
    }
    if(action==='REPORT'&&exact(input,['survey','cycle'])&&input.survey==='epidemiological'&&input.cycle===CYCLE){if(!identity?.uid||identity.emailVerified!==true||identity.provider!=='google.com'||identity.email?.trim().toLowerCase()!==reportReaderEmail?.toLowerCase())fail('SURVEY_FORBIDDEN',403);const p=await profileStore.get('users',identity.uid);if(!p||p.uid!==identity.uid||p.email?.toLowerCase()!==identity.email.toLowerCase()||p.active!==true||p.access!==true||!(p.role==='administrador_app'||p.permissions?.admin===true))fail('SURVEY_FORBIDDEN',403);const cycle=await responseStore.get('epidemiologicalCycles',CYCLE);const report=cycle?.status==='closed'?await responseStore.get('epidemiologicalReports',CYCLE):null;const fresh=await profileStore.get('users',identity.uid);if(!fresh||fresh.uid!==identity.uid||fresh.email?.toLowerCase()!==identity.email.toLowerCase()||fresh.active!==true||fresh.access!==true||!(fresh.role==='administrador_app'||fresh.permissions?.admin===true))fail('SURVEY_FORBIDDEN',403);return {report:report?.grouping_version===2?report:null};}
    const hasInvitation=input?.survey==='epidemiological'&&Object.hasOwn(input,'invitation');
    const fields=action==='BOOTSTRAP'?['survey','cycle']:['survey','cycle','response'];
    if(!['BOOTSTRAP','SUBMIT'].includes(action)||!exact(input,[...fields,...(hasInvitation?['invitation']:[])])||!Object.hasOwn(kinds,input.survey)||input.cycle!==CYCLE)fail('SURVEY_INVALID_INPUT');
    if(hasInvitation)await activeProfile(identity);
    const invitationGroup=hasInvitation?await verifyInvitation?.(input.invitation,{survey:input.survey,cycle:CYCLE,email:identity.email}):null;
    if(hasInvitation&&!invitationGroup)fail('SURVEY_FORBIDDEN',403);
    const actorGroup=await authorize(identity,input.survey,profileStore,invitationGroup),group=actorGroup.group,kind=kinds[input.survey],ledgerKey=`${identity.uid}_${input.survey}_${CYCLE}`;
    let response;
    if(action==='SUBMIT'){
      try {response=kind.validate({...input.response,group});}catch{fail('SURVEY_INVALID_INPUT');}
    }
    return responseStore.transaction(async tx=>{
      if(!actorGroup.administrator)await checkSurvey(folders[input.survey],tx);
      const cycle=await tx.get(kind.cycleCollection,CYCLE);
      if(cycle?.status!=='open'&&!(input.survey==='epidemiological'&&action==='BOOTSTRAP'&&cycle?.status==='closed'))fail('SURVEY_CYCLE_CLOSED',409);
      const participation=await tx.get('surveyParticipation',ledgerKey);
      if(participation&&!exact(participation,['uid','survey','cycle','completed']))fail('SURVEY_PARTICIPATION_INVALID',503);
      if(participation&&(participation.uid!==identity.uid||participation.survey!==input.survey||participation.cycle!==CYCLE||participation.completed!==true))fail('SURVEY_PARTICIPATION_INVALID',503);
      if(action==='BOOTSTRAP')return {group,alreadyResponded:!!participation,...(input.survey==='epidemiological'?{canReadReport:identity.email?.toLowerCase()===reportReaderEmail?.toLowerCase(),closed:cycle.status==='closed'}:{})};
      if(participation)return {accepted:true,alreadyResponded:true};
      if(await tx.get(kind.responseCollection,response.submission_id))fail('SURVEY_RESPONSE_ID_REUSED',409);
      const currentGroup=await authorize(identity,input.survey,profileStore,invitationGroup);
      if(currentGroup.group!==group||currentGroup.affiliation!==actorGroup.affiliation)fail('SURVEY_GROUP_CHANGED',409);
      if(actorGroup.administrator&&!currentGroup.administrator)await checkSurvey(folders[input.survey],tx);
      // The ledger has no answer reference, group or explicit time. Firestore
      // commit metadata and infrastructure logs can still correlate the writes.
      tx.create('surveyParticipation',ledgerKey,{uid:identity.uid,survey:input.survey,cycle:CYCLE,completed:true});
      tx.create(kind.responseCollection,response.submission_id,{survey_cycle:CYCLE,survey_version:kind.version,group,answers:response.answers,...(response.stress_rating!==undefined?{stress_rating:response.stress_rating}:{})});
      if(performanceEnabled&&actorGroup.affiliation==='team')await awardFeParticipation(tx,{uid:identity.uid,survey:input.survey,cycle:CYCLE,at:now()});
      if(input.survey==='climate'&&Object.keys(response.comments).length||input.survey==='epidemiological'&&response.comments){const id=uuid();if(!validId(id)||id===response.submission_id)fail('SURVEY_RANDOM_ID_INVALID',503);tx.create(input.survey==='climate'?'climateComments':'epidemiologicalComments',id,{survey_cycle:CYCLE,comments:response.comments});}
      return {accepted:true,alreadyResponded:false};
    });
  }
  return {execute};
}
