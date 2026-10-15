import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector} from './lib/windows-protected-json.js';
import {firestoreQuotaDayStart} from './lib/management-read-budget.js';
try{
 const dir=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');await mkdir(dir,{recursive:true});
 const protector=await createPrivateJsonProtector(),report={code:'FA_CONSOLIDATION_QUOTA_AND_INDEX_AUDIT',observedAt:new Date().toISOString(),quotaDayStart:firestoreQuotaDayStart(Date.now()),projects:{},remoteChanges:0};
 for(const [alias,id,email]of [['FA','sahmt-17a16','anestesiahmtforms@gmail.com'],['FB','sahmt-gestao-5ae66','anestesiahmtforms2@gmail.com']]){
  const token=await firebaseCliAccountToken(email),raw={},result={};
  const get=async key=>{
   const r=await fetch(key,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!r.ok)return {httpStatus:r.status};return {httpStatus:r.status,data:await r.json()};
  };
  const indexes=[],seen=new Set();let pageToken='';
  do{
   const response=await get('https://firestore.googleapis.com/v1/projects/'+id+'/databases/(default)/collectionGroups/-/indexes'+(pageToken?'?pageToken='+encodeURIComponent(pageToken):''));
   if(!response.data){result.indexes={httpStatus:response.httpStatus,complete:false};break;}
   indexes.push(...response.data.indexes||[]);pageToken=response.data.nextPageToken||'';
   if(pageToken&&seen.has(pageToken))throw Error('CONSOLIDATION_INDEX_PAGINATION_REPEATED');seen.add(pageToken);
   if(seen.size>20)throw Error('CONSOLIDATION_INDEX_PAGE_LIMIT');
   result.indexes={httpStatus:200,count:indexes.length,complete:!pageToken,notReady:indexes.filter(x=>x.state!=='READY').length};
  }while(pageToken);
  raw.indexes=indexes;
  for(const kind of ['read','write','delete','storage']){
   const storage=kind==='storage',metric=storage?'storage/data_and_index_storage_bytes':'document/'+kind+'_ops_count';
   const query=new URLSearchParams({filter:'metric.type="firestore.googleapis.com/'+metric+'" AND resource.type="firestore.googleapis.com/Database" AND resource.labels.database_id="(default)"',
    'interval.startTime':storage?new Date(Date.now()-86400000).toISOString():report.quotaDayStart,'interval.endTime':report.observedAt,
    'aggregation.alignmentPeriod':storage?'3600s':'60s','aggregation.perSeriesAligner':storage?'ALIGN_MAX':'ALIGN_SUM',view:'FULL',pageSize:'100000'});
   const response=await get('https://monitoring.googleapis.com/v3/projects/'+id+'/timeSeries?'+query);raw[kind]=response.data;
   result[kind]={httpStatus:response.httpStatus,complete:Boolean(response.data)&&!response.data.nextPageToken};
   if(response.data){const series=response.data.timeSeries||[];
    result[kind].value=series.reduce((sum,s)=>sum+(storage?(s.points||[]).slice(0,1):(s.points||[])).reduce((n,p)=>n+Number(p.value?.int64Value||p.value?.doubleValue||0),0),0);
    result[kind].series=series.length;result[kind].latestPoint=series.flatMap(s=>(s.points||[]).map(p=>p.interval.endTime)).sort().at(-1)||null;
   }
  }
  await writeFile(resolve(dir,'usage-index-'+alias+'-'+Date.now()+'.dpapi.json'),JSON.stringify(protector.seal(raw)),{flag:'wx',mode:0o600});report.projects[alias]=result;
 }
 await writeFile(resolve(dir,'usage-index-report-'+Date.now()+'.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
}catch{console.error(JSON.stringify({code:'CONSOLIDATION_USAGE_AUDIT_FAILED',remoteChanges:0}));process.exitCode=1;}
