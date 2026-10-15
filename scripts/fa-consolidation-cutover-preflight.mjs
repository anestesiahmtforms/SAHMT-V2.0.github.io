import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
try{
 const stamp=process.argv[2];if(!/^\d{17}$/.test(stamp||''))throw Error('CONSOLIDATION_PREFLIGHT_STAMP_INVALID');
 const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','fa-consolidation');await mkdir(directory,{recursive:true});
 const protector=await createPrivateJsonProtector(),report={code:'FA_CONSOLIDATION_CUTOVER_PREFLIGHT',remoteWrites:0,projects:{}};
 const tokens={FA:await firebaseCliAccountToken('anestesiahmtforms@gmail.com'),FB:await firebaseCliAccountToken('anestesiahmtforms2@gmail.com')};
 const privateData={markers:{},profiles:[]};
 const get=async(alias,project,path,optional=false)=>{
  const response=await fetch('https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents/'+path,{
   method:'GET',headers:{Authorization:'Bearer '+tokens[alias]},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(optional&&response.status===404)return null;
  if(!response.ok)throw Error('CONSOLIDATION_PREFLIGHT_'+alias+'_HTTP_'+response.status);return response.json();
 };
 for(const [alias,project]of [['FA','sahmt-17a16'],['FB','sahmt-gestao-5ae66']]){
  const marker=await get(alias,project,'managementRuntime/domainCutover',true);
  privateData.markers[alias]=marker;
  report.projects[alias]={markerExists:!!marker,retired:marker?.fields?.retired?.booleanValue===true,
   sourceWritesBlocked:marker?.fields?.sourceWritesBlocked?.booleanValue===true,
   managementEnabled:marker?.fields?.managementEnabled?.booleanValue===true,evaluationEnabled:marker?.fields?.evaluationEnabled?.booleanValue===true};
 }
 privateData.markers.consolidation=await get('FA','sahmt-17a16','managementRuntime/faConsolidation',true);
 const seen=new Set();let pageToken='';
 do{
  const params=new URLSearchParams({pageSize:'1000'});
  for(const field of ['uid','active','access'])params.append('mask.fieldPaths',field);
  if(pageToken)params.set('pageToken',pageToken);
  const data=await get('FA','sahmt-17a16','users?'+params);
  privateData.profiles.push(...data.documents||[]);pageToken=data.nextPageToken||'';
  if(pageToken&&(seen.has(pageToken)||seen.size>=5))throw Error('CONSOLIDATION_PREFLIGHT_PROFILE_PAGINATION');seen.add(pageToken);
 }while(pageToken);
 const profiles=new Map(privateData.profiles.map(row=>[row.name.split('/').at(-1),row.fields]));
 const source=await openPrivateJson(JSON.parse(await readFile(resolve(directory,stamp+'-FB.dpapi.json'),'utf8')));
 const references=new Set();
 const walk=(value,key='')=>{
  if(!value||typeof value!=='object')return;
  if(['uid','userUid','actorUid','subjectUid','managerUid','assignedUid'].includes(key)&&typeof value.stringValue==='string')references.add(value.stringValue);
  if(['managerUids','eligibleUids'].includes(key))for(const item of value.arrayValue?.values||[])if(item.stringValue)references.add(item.stringValue);
  for(const [name,item]of Object.entries(value))walk(item,name);
 };
 for(const row of source.snapshot.documents)walk(row.fields);
 report.identity={profiles:profiles.size,invalidUid:privateData.profiles.filter(row=>row.fields?.uid?.stringValue!==row.name.split('/').at(-1)).length,
  referencedUids:references.size,missingProfiles:[...references].filter(uid=>!profiles.has(uid)).length,
  inactiveReferencedProfiles:[...references].filter(uid=>profiles.has(uid)&&(profiles.get(uid).active?.booleanValue!==true||profiles.get(uid).access?.booleanValue!==true)).length};
 await writeFile(resolve(directory,'cutover-preflight-'+Date.now()+'.dpapi.json'),JSON.stringify(protector.seal(privateData)),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(report));
}catch(error){console.error(JSON.stringify({code:/^CONSOLIDATION_[A-Z0-9_]+$/.test(error.message||'')?error.message:'CONSOLIDATION_PREFLIGHT_FAILED',remoteWrites:0}));process.exitCode=1;}
