import {decodeFields} from './store.js';
export const PROJECTS=Object.freeze({FA:'sahmt-17a16',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt',FE:'outros-48120',FD:'rotinas-8a617'});
const flags=['active','sheetDeleted','pendingSync','syncFailed','syncConflict','stale'];
export const SOURCE_MANIFEST=Object.freeze({
 management:[
  ['FB','activities',['status','dueAt','completedAt','managementAreaId',...flags]],['FB','actionPlans',['status','dueAt','completedAt','managementAreaId',...flags]],['FB','actionPlanItems',['status','dueAt','completedAt','managementAreaId',...flags]],['FB','maintenanceRecords',['status','dueAt','completedAt','managementAreaId',...flags]],
  ['FB','indicatorMeasurements',['indicatorId','period','value','target','status','createdAt']],['FB','trainingProgress',['uid','trainingId','startedAt','createdAt','status','completedAt']],['FB','htmlTrainingStates',['uid','trainingId','run.stage','run.startedAt','run.completedAt']],['FB','professionalRegistrations',['createdAt']],['FB','occupationalVaccinations',['year','uid','version','states']]
 ],
 records:[['FC','occurrenceReports',['createdAt',...flags]],['FC','qmentumMonths',['year','month','status','inputs.counts','inputs.origins','inputs.informedRates','inputs.legacyRates','inputs.notApplicable','inputs.attribution48','inputs.attribution30','inputs.uniqueEventProceduresConfirmed','inputs.techniqueUniverseConfirmed','definitionVersion','unitId'],{collection:'months',allDescendants:true}],['FC','qmentumDefinitions',['version','validFrom','reason','referenceVersion','items']]],
 operations:[['FA','checklists',['date','stationId','condition','createdAt','updatedAt','version',...flags]],['FA','labels',['date',...flags]],['FA','events',['date',...flags]]],
 surveys:[['FE','climateReports',['survey_cycle','survey_version','grouping_version','groups']],['FE','stressReports',['survey_cycle','survey_version','grouping_version','groups']],['FE','epidemiologicalReports',['survey_cycle','survey_version','grouping_version','groups']]]
});
export function createIndicatorSources({getAccessToken,fetchImpl=fetch,maxReads=6000,pageSize=200,maxCollection=3000}){
 let reads=0;
 async function call(project,path,body){const r=await fetchImpl('https://firestore.googleapis.com/v1/projects/'+PROJECTS[project]+'/databases/(default)/documents'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getAccessToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)});if(r.status===404&&!body)return null;if(!r.ok){await r.body?.cancel();throw Error('SOURCE_UNAVAILABLE');}return r.json();}
 async function profile(project,uid){if(!['FA','FD'].includes(project)||!/^[-A-Za-z0-9_.@+:%]{1,128}$/.test(uid))throw Error('SOURCE_PATH_INVALID');const d=await call(project,'/users/'+encodeURIComponent(uid)+'?'+new URLSearchParams([['mask.fieldPaths','uid'],['mask.fieldPaths','email'],['mask.fieldPaths','active'],['mask.fieldPaths','access'],['mask.fieldPaths','role'],['mask.fieldPaths','permissions']]).toString());return d?decodeFields(d.fields||{}):null;}
 async function load(platform,year){if(!Object.hasOwn(SOURCE_MANIFEST,platform)||!Number.isInteger(year)||year<2020||year>2200)throw Error('SOURCE_INPUT_INVALID');reads=0;const sources={},connectionStatus=[];
 for(const [project,key,fields,options={}]of SOURCE_MANIFEST[platform]){sources[project]??={};let envelope;
 try{let rows=[];
 if(project==='FE'){const p=await call(project,'/'+key+'/'+year+'?'+new URLSearchParams(fields.map(f=>['mask.fieldPaths',f])).toString());reads++;if(p)rows=[decodeFields(p.fields||{})];}
 else{let cursor=null;for(;;){if(reads>=maxReads)throw Error('SOURCE_READ_BUDGET');const take=Math.min(pageSize,maxReads-reads,maxCollection-rows.length);if(take<1)throw Error('SOURCE_TRUNCATED');const q={select:{fields:fields.map(fieldPath=>({fieldPath}))},from:[{collectionId:options.collection||key,...(options.allDescendants?{allDescendants:true}:{})}],orderBy:[{field:{fieldPath:'__name__'},direction:'ASCENDING'}],limit:take,...(cursor?{startAt:{values:[{referenceValue:cursor}],before:false}}:{})};const d=await call(project,':runQuery',{structuredQuery:q}),docs=(d||[]).filter(r=>r.document).map(r=>r.document);reads+=Math.max(1,docs.length);for(const doc of docs){if(options.allDescendants&&!/^projects\/indicadores---sahmt\/databases\/\(default\)\/documents\/qmentumUnits\/[^/]+\/months\/\d{4}-\d{2}$/.test(doc.name))continue;const row=decodeFields(doc.fields||{});if(key==='qmentumMonths'&&row.inputs)row.inputs.comment='';rows.push(row);}if(docs.length<take)break;cursor=docs.at(-1).name;if(rows.length>=maxCollection)throw Error('SOURCE_TRUNCATED');}}
 envelope={status:'ok',rows};connectionStatus.push({platform,process:key,status:rows.length?'AVAILABLE':'EMPTY',checkedAt:new Date().toISOString()});
 }catch{envelope={status:'unavailable',rows:[]};connectionStatus.push({platform,process:key,status:'UNAVAILABLE',checkedAt:new Date().toISOString()});}
 sources[project][key]=envelope;
 }
 if(platform==='management'){const old=sources.FB.trainingProgress,html=sources.FB.htmlTrainingStates;if(old.status!=='ok'||html.status!=='ok')sources.FB.trainingProgress={status:'unavailable',rows:[]};else old.rows.push(...html.rows.filter(r=>r.run&&['READING','ACK','QUIZ','SUGGESTIONS','COMPLETED'].includes(r.run.stage)).map(r=>({uid:r.uid,trainingId:r.trainingId,status:r.run.stage==='COMPLETED'?'COMPLETED':'IN_PROGRESS',startedAt:r.run.startedAt,completedAt:r.run.completedAt})));}
 return {sources,connectionStatus,reads};
 }
 return {profile,load};
}
