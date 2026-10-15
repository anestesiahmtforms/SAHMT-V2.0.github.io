import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector} from './lib/windows-protected-json.js';
import {snapshotDigest} from './lib/management-split-plan.js';
const targets=[['FA','sahmt-17a16','anestesiahmtforms@gmail.com'],['FB','sahmt-gestao-5ae66','anestesiahmtforms2@gmail.com']];
try{
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');await mkdir(directory,{recursive:true});
 const protector=await createPrivateJsonProtector(),result={code:'FA_CONSOLIDATION_CONFIGURATION_AUDIT',projects:{},remoteChanges:0};
 for(const [alias,projectId,email]of targets){
  const token=await firebaseCliAccountToken(email),privateData={},report={projectId};
  const get=async(key,url)=>{
   let response;try{response=await fetch(url,{method:'GET',headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});}
   catch{report[key]={code:'NETWORK_ERROR'};return null;}
   report[key]={httpStatus:response.status};if(!response.ok)return null;
   try{const value=await response.json();privateData[key]=value;return value;}catch{report[key].code='RESPONSE_INVALID';return null;}
  };
  const billing=await get('billing','https://cloudbilling.googleapis.com/v1/projects/'+projectId+'/billingInfo');
  if(billing)report.billing.billingEnabled=billing.billingEnabled===true;
  const database=await get('database','https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)');
  if(database)report.database={...report.database,locationId:database.locationId,type:database.type};
  const release=await get('release','https://firebaserules.googleapis.com/v1/projects/'+projectId+'/releases/cloud.firestore');
  if(release?.rulesetName&&/^projects\/[a-z0-9-]+\/rulesets\/[A-Za-z0-9_-]+$/.test(release.rulesetName)){
   const rules=await get('rules','https://firebaserules.googleapis.com/v1/'+release.rulesetName);
   if(rules){report.rules.sha256=snapshotDigest(rules.source);report.rules.files=rules.source?.files?.length||0;}
  }
  const indexes=await get('indexes','https://firestore.googleapis.com/v1/projects/'+projectId+'/databases/(default)/collectionGroups/-/indexes?pageSize=200');
  if(indexes)report.indexes={...report.indexes,count:indexes.indexes?.length||0,complete:!indexes.nextPageToken};
  const end=new Date(),start=new Date(end.getTime()-86400000);
  for(const metric of ['read','write','delete']){
   const query=new URLSearchParams({filter:'metric.type="firestore.googleapis.com/document/'+metric+'_ops_count"',
    'interval.startTime':start.toISOString(),'interval.endTime':end.toISOString(),'aggregation.alignmentPeriod':'86400s',
    'aggregation.perSeriesAligner':'ALIGN_SUM',view:'FULL',pageSize:'100'});
   const data=await get(metric+'Usage','https://monitoring.googleapis.com/v3/projects/'+projectId+'/timeSeries?'+query);
   if(data)report[metric+'Usage']={...report[metric+'Usage'],last24Hours:(data.timeSeries||[]).reduce((sum,series)=>sum+(series.points||[]).reduce((n,p)=>n+Number(p.value?.int64Value||p.value?.doubleValue||0),0),0),complete:!data.nextPageToken,windowEnd:end.toISOString()};
  }
  await writeFile(resolve(directory,'configuration-'+alias+'-'+Date.now()+'.dpapi.json'),JSON.stringify(protector.seal(privateData)),{flag:'wx',mode:0o600});
  result.projects[alias]=report;
 }
 await writeFile(resolve(directory,'configuration-report-'+Date.now()+'.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result));
}catch{console.error(JSON.stringify({code:'CONSOLIDATION_CONFIG_AUDIT_FAILED',remoteChanges:0}));process.exitCode=1;}
