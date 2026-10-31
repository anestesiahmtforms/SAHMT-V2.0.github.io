import {decodeFields,encodeFields} from '../../worker-training/firestore.js';
import {validateYearEndChoices,yearEndParticipation} from '../../src/year-end-schedule.js';
import {emptyYearEndTotals,changeYearEndTotals,readYearEndTotals} from '../../src/year-end-schedule-totals.js';

const base='yearEndSchedules/2026-2027',policyPath=base+'/policy/participation',totalsPath=base+'/summary/totals',counterPath=base+'/control/order';
const decode=d=>d?{name:d.name,data:decodeFields(d.fields||{}),updateTime:d.updateTime}:null;
export async function readYearEndTotalsSource(request,transaction){
  const suffix=transaction?'?transaction='+encodeURIComponent(transaction):'';
  const [policy,summary,counter,rows]=await Promise.all([
    request('/'+policyPath+suffix),request('/'+totalsPath+suffix),request('/'+counterPath+suffix),
    request('/'+base+':runQuery',{structuredQuery:{from:[{collectionId:'registrations'}],limit:101},...(transaction?{transaction}:{})})
  ]);
  const records=(rows||[]).filter(r=>r.document).map(r=>decode(r.document));
  if(records.length>100)throw Error('REGISTRATION_PAGE_LIMIT');
  return {policy:decode(policy),summary:decode(summary),counter:decode(counter),records};
}
export function prepareYearEndTotals(source){
  const {policy,summary,counter,records}=source;
  if(policy?.data.schemaVersion!==1||policy.data.cycle!=='2026-2027')throw Error('POLICY_REQUIRED');
  if(policy.data.summaryVersion===0&&policy.data.resetId)throw Error('YEAR_END_RESET_REQUIRES_ACTIVATION');
  let totals=emptyYearEndTotals();const positions=new Set();
  for(const {name,data} of records){
    const uid=name.split('/').at(-1),participation=yearEndParticipation(policy.data,uid);
    if(data.uid!==uid||data.sigla!==participation.sigla||!Number.isSafeInteger(data.position)||data.position<1||positions.has(data.position)||'displayName' in data)throw Error('REGISTRATION_REVIEW_REQUIRED');
    positions.add(data.position);validateYearEndChoices({plantao:data.plantao,grupo:data.grupo},participation);
    totals=changeYearEndTotals(totals,null,data);
  }
  if(records.length&&Math.max(...positions)!==records.length)throw Error('NONCONTIGUOUS_POSITIONS');
  const active=[1,2].includes(policy.data.summaryVersion);
  if(!active&&((counter&&counter.data.lastPosition!==records.length)||(!counter&&records.length)))throw Error('LEGACY_COUNTER_REVIEW_REQUIRED');
  if(active&&(!summary||JSON.stringify(readYearEndTotals(summary.data))!==JSON.stringify(totals)))throw Error('ACTIVE_SUMMARY_MISMATCH');
  return {registrations:records.length,totals,alreadyActive:active,choicesChanged:0};
}
export async function migrateYearEndTotals({request,projectId,apply=false,onPlan=async()=>{}}){
  if(projectId!=='outros-48120'&&projectId!=='demo-sahmt-year-end')throw Error('FE_PROJECT_REQUIRED');
  for(let attempt=0;attempt<3;attempt++){
    let transaction;
    try{
      const opened=await request(':beginTransaction',{options:apply?{readWrite:{}}:{readOnly:{}}});
      transaction=opened?.transaction;if(!transaction)throw Error('TRANSACTION_REQUIRED');
      const source=await readYearEndTotalsSource(request,transaction),report=prepareYearEndTotals(source);
      await onPlan({...source,report});
      if(!apply||report.alreadyActive)return {...report,applied:apply};
  const {policy,summary,counter}=source,name=path=>`projects/${projectId}/databases/(default)/documents/${path}`;
  const writes=[
    {update:{name:name(totalsPath),fields:encodeFields(report.totals)},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:summary?{updateTime:summary.updateTime}:{exists:false}},
    {update:{name:policy.name,fields:encodeFields({summaryVersion:1})},updateMask:{fieldPaths:['summaryVersion']},currentDocument:{updateTime:policy.updateTime}},
    ...Object.entries(policy.data.siglasByUid).filter(([uid])=>!policy.data.excludedUids?.includes(uid)).map(([uid,sigla])=>({update:{name:name(base+'/participation/'+uid),fields:encodeFields({schemaVersion:1,cycle:'2026-2027',sigla})}}))
  ];
  if(counter)writes.push({update:{name:counter.name,fields:encodeFields({retired:true})},updateMask:{fieldPaths:['retired']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{updateTime:counter.updateTime}});
      await request(':commit',{writes,transaction});transaction=null;
      // Verify source records and totals in one fresh snapshot, including any new valid confirmations.
      const verified=await migrateYearEndTotals({request,projectId,apply:false});
      if(!verified.alreadyActive)throw Error('MIGRATION_VERIFICATION_FAILED');
      return {...verified,applied:true};
    }catch(error){if(error.code!=='ABORTED'||attempt===2)throw error;}
    finally{if(transaction)await request(':rollback',{transaction}).catch(()=>{});}
  }
}
