export const FB_PROJECT='sahmt-gestao-5ae66';
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1000000;
const millis=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
const forbidden=new Set(['CHECKLIST','OCCURRENCE']);
const expectedLegacy={MANAGEMENT_TASK:['MANAGEMENT_TASK_COMPLETION','management-task-completion-v1'],TRAINING_ACCESS:['trainingStart','training-access-v1'],TRAINING_COMPLETION:['trainingCompletion','training-completion-v1']};
const participationKey=p=>JSON.stringify([p.uid,p.activityId,p.creditScopeId,p.version,p.responseId]);
// Caller supplies only records read by the executor from the fixed FB database.
// Project location alone is not evidence: external awards are also stored in FB.
export function nativeFbAward(award,{configs,scores,participations,formParticipations,firstLedger,effectiveFrom=Infinity}={}){
 if(!award||award.category!=='PERFORMANCE'||forbidden.has(award.modality)||typeof award.points!=='number'||!Number.isFinite(award.points)||Math.abs(award.points)>1000000||!award.uid||!award.id)return null;
 const original=award.sourceType==='ADMIN_CORRECTION'?firstLedger.get(award.id):award;
 if(!original||original.uid!==award.uid||original.modality!==award.modality)return null;
 if(original.evidence?.sourceProjectId&&original.evidence.sourceProjectId!==FB_PROJECT)return null;
 let verified=false;
 if(original.sourceType==='GOOGLE_FORM'&&['ACKNOWLEDGEMENT','TEST'].includes(award.modality)){
  const cfg=configs.get(original.activityId);
  const key=participationKey({...award,activityId:original.activityId,responseId:original.sourceId});
  const participation=formParticipations?.get(key)||[...participations.values()].find(p=>participationKey(p)===key);
  verified=!!cfg&&cfg.creditScopeId===award.creditScopeId&&Number.isSafeInteger(cfg.version)&&Number.isSafeInteger(award.version)&&cfg.version>=award.version&&original.evidence?.formId===original.activityId&&original.evidence?.responseId===original.sourceId&&millis(participation?.submittedAt)>=effectiveFrom;
 }else if(original.sourceType==='SUGGESTION_REVIEW'&&award.modality==='SUGGESTION'){
  const p=participations.get(original.sourceId),cfg=p&&configs.get(p.activityId);
  verified=!!p&&!!cfg&&p.uid===award.uid&&p.activityId===award.activityId&&p.creditScopeId===award.creditScopeId&&p.version===award.version&&['APPROVED','CONFIRMED'].includes(p.status)&&!!original.approvedByUid&&original.approvedByUid!==award.uid&&millis(p.submittedAt)>=effectiveFrom;
 }else if(original.sourceType==='VALIDATED_FB_SCORE'&&expectedLegacy[award.modality]){
  const score=scores.get(original.sourceId),[type,rule]=expectedLegacy[award.modality];
  verified=!!score&&score.originProjectId===FB_PROJECT&&score.uid===award.uid&&score.sourceType===type&&score.ruleId===rule&&number(score.points)&&original.evidence?.sourceProjectId===FB_PROJECT&&original.evidence?.scoreId===original.sourceId&&millis(score.createdAt)>=effectiveFrom;
 }
 if(!verified)return null;
 // Preserve the existing evaluation UI contract. Never copy raw responses.
 const fields=['id','uid','category','modality','points','originalPoints','awardVersion','lastLedgerId','creditScopeId','activityId','areaId','version','updatedAt'];
 return {...Object.fromEntries(fields.filter(k=>award[k]!==undefined).map(k=>[k,award[k]])),sourceProjectId:FB_PROJECT};
}
export function projectFbPerformance({awards,configs,scores,participations,ledger,profiles,htmlStates=[],htmlTrainings=[],effectiveFrom}){
 if(!Number.isFinite(effectiveFrom)||effectiveFrom<=0)throw Error('FB_PERFORMANCE_ACTIVATION_REQUIRED');
 const maps=rows=>new Map(rows.map(row=>[row.id,row]));
 const firstLedger=new Map(ledger.filter(l=>l.awardVersion===1).map(l=>[l.awardId,l]));
 const evidence={configs:maps(configs),scores:maps(scores),participations:maps(participations),formParticipations:new Map(participations.map(p=>[participationKey(p),p])),firstLedger,effectiveFrom};
 const admitted=awards.filter(a=>millis(firstLedger.get(a.id)?.createdAt)>=effectiveFrom).map(a=>nativeFbAward(a,evidence)).filter(Boolean);
 const trainingIds=new Set(htmlTrainings.map(t=>t.id)),htmlLedger=[];
 for(const state of htmlStates){
  if(!state.uid||!trainingIds.has(state.trainingId)||!Array.isArray(state.attempts))continue;
  const attempts=state.attempts.filter(a=>millis(a.completedAt)>=effectiveFrom&&millis(a.acknowledgedAt)>=effectiveFrom&&number(a.score));
  if(!attempts.length)continue;
  const at=Math.max(...attempts.map(a=>millis(a.completedAt))),decision=state.suggestionDecision;
  const reviewedSuggestion=decision&&millis(decision.decidedAt)>=effectiveFrom&&number(decision.points)&&decision.points<=2&&!!decision.decidedByUid&&decision.decidedByUid!==state.uid&&attempts.some(a=>typeof a.suggestion==='string'&&a.suggestion.trim()&&millis(a.completedAt)<=millis(decision.decidedAt));
  const parts=[['ACKNOWLEDGEMENT',1],['TEST',Math.max(...attempts.map(a=>a.score))],['SUGGESTION',reviewedSuggestion?decision.points:0]];
  for(const [modality,points]of parts){
   if(points===0)continue;
   const id='html_'+state.trainingId+'_'+state.uid+'_'+modality;
   const award={id,uid:state.uid,category:'PERFORMANCE',modality,points,originalPoints:points,awardVersion:state.version,lastLedgerId:id+'_current',creditScopeId:'html_'+state.trainingId,activityId:state.trainingId,version:1,sourceProjectId:FB_PROJECT,updatedAt:at,correctionSupported:false};
   admitted.push(award);htmlLedger.push({id:award.lastLedgerId,awardId:id,uid:state.uid,category:'PERFORMANCE',modality,creditScopeId:award.creditScopeId,activityId:state.trainingId,version:1,points,originalPoints:points,correctedPoints:points,pointsBefore:0,awardVersion:state.version,correctsId:'',createdAt:at});
  }
 }
 const ids=new Set(admitted.map(a=>a.id));
 const eligible=profiles.filter(p=>p.uid===p.id&&p.active===true&&p.access===true);
 const totals=Object.fromEntries(eligible.map(p=>[p.uid,0]));
 for(const award of admitted)if(Object.hasOwn(totals,award.uid))totals[award.uid]+=award.points;
 const safeLedger=ledger.filter(row=>ids.has(row.awardId)&&row.category==='PERFORMANCE').map(row=>Object.fromEntries(['id','awardId','uid','category','modality','creditScopeId','activityId','version','points','originalPoints','correctedPoints','pointsBefore','awardVersion','correctsId','createdAt'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
 return {awards:admitted,ledger:[...safeLedger,...htmlLedger],totals,maxPerformance:Math.max(0,...Object.values(totals)),eligibleCount:eligible.length,excluded:awards.length-(admitted.length-htmlLedger.length)};
}
