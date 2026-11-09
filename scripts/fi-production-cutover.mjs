import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {openPrivateJson,sealPrivateJson} from './lib/windows-protected-json.js';
import {addFiCutoverRules} from './lib/fi-cutover-rules.js';
import {createFiStore,FI_PROJECTS} from '../worker-fi-control/store.js';

const owners={FA:'anestesiahmtforms@gmail.com',FJ:'anestesiahmtforms10@gmail.com',FI:'anestesiahmtforms9@gmail.com'};
const stages=['FA','FJ'],directory='.local-preview/fi-control',marker='fiAdministrativeCutover',mode=process.argv[2];
const budget=2000000,quota=5;
const demand=(v,c)=>{if(!v)throw Error(c);};
const normalize=value=>value.replaceAll('\r\n','\n').trim();
async function api(token,resource,method='GET',body){
 const res=await fetch('https://firebaserules.googleapis.com/v1/'+resource,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!res.ok)throw Error('FI_RULES_HTTP_'+res.status);
 return res.json();
}
function verifyDrift(){
 try{execFileSync(process.execPath,['scripts/fi-control-release.mjs','--check-drift'],{windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:45000});}
 catch{throw Error('FI_CUTOVER_SOURCE_DRIFT_OR_UNAVAILABLE');}
}
async function openStation(station){
 const token=await firebaseCliAccountToken(owners[station]),project=FI_PROJECTS[station];
 return {project,token,store:createFiStore({projectId:project,getAccessToken:async()=>token,...(station==='FI'?{}:{allowedCollections:[marker]})})};
}
async function rules(station,{token,project},publish){
 const releaseName=`projects/${project}/releases/cloud.firestore`;
 const release=await api(token,releaseName),live=await api(token,release.rulesetName);
 demand(release.name===releaseName&&release.rulesetName.startsWith(`projects/${project}/rulesets/`)&&live.source?.files?.length===1,'FI_RULES_RESOURCE_MISMATCH');
 const path=`${directory}/cutover-rules-${station}.dpapi.json`;
 if(publish)await writeFile(path,JSON.stringify(await sealPrivateJson({release,rules:live})),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 const backup=await openPrivateJson(JSON.parse(await readFile(path,'utf8')));
 demand(backup.release.name===releaseName&&backup.rules.source?.files?.length===1,'FI_RULES_BACKUP_MISMATCH');
 const original=backup.rules.source.files[0],content=addFiCutoverRules(original.content,station);
 if(normalize(live.source.files[0].content)===normalize(content))return release.rulesetName;
 demand(publish&&release.rulesetName===backup.release.rulesetName&&normalize(live.source.files[0].content)===normalize(original.content),'FI_RULES_LIVE_DRIFT');
 const created=await api(token,`projects/${project}/rulesets`,'POST',{source:{files:[{name:original.name,content}]}});
 demand(created.name.startsWith(`projects/${project}/rulesets/`),'FI_RULES_CREATED_TARGET_INVALID');
 const latest=await api(token,releaseName);
 demand(latest.rulesetName===release.rulesetName&&latest.updateTime===release.updateTime,'FI_RULES_RELEASE_DRIFT');
 await api(token,releaseName,'PATCH',{release:{name:releaseName,rulesetName:created.name},updateMask:'rulesetName'});
 const after=await api(token,releaseName);
 demand(after.rulesetName===created.name,'FI_RULES_POSTCHECK');
 return after.rulesetName;
}
async function setMarker(store,active){
 await store.transaction(async tx=>{
  const old=await tx.get(marker,'current');
  if(old&&old.schemaVersion!==1)throw Error('FI_CUTOVER_MARKER_MISMATCH');
  if(old?.active!==active)tx.set(marker,'current',{schemaVersion:1,active,updatedAt:Date.now()});
 });
 demand((await store.get(marker,'current'))?.active===active,'FI_CUTOVER_MARKER_POSTCHECK');
}
try{
 demand(['--rules','--freeze','--activate','--thaw'].includes(mode),'FI_CUTOVER_MODE');
 const entries=await Promise.all([...stages,'FI'].map(async station=>[station,await openStation(station)]));
 const stores=Object.fromEntries(entries),fi=stores.FI.store;
 const runtime=await fi.get('fiControlConfig','runtime');
 demand(runtime?.schemaVersion===1&&runtime.enabled===true&&runtime.adminWritesEnabled!==true,'FI_CUTOVER_RUNTIME_ALREADY_ACTIVE');
 if(mode==='--rules'){
  verifyDrift();
  for(const station of stages)await rules(station,stores[station],true);
 }else if(mode==='--freeze'){
  verifyDrift();
  await Promise.all(stages.map(station=>rules(station,stores[station],false)));
  try{
   for(const station of stages)await setMarker(stores[station].store,true);
   verifyDrift();
  }catch(error){
   const rollback=await Promise.allSettled(stages.map(station=>setMarker(stores[station].store,false)));
   demand(rollback.every(result=>result.status==='fulfilled'),'FI_CUTOVER_MARKER_ROLLBACK_FAILED');
   throw error;
  }
 }else if(mode==='--thaw'){
  for(const station of stages)await setMarker(stores[station].store,false);
 }else{
  const reports=await Promise.all(stages.map(station=>rules(station,stores[station],false)));
  const flags=await Promise.all(stages.map(station=>stores[station].store.get(marker,'current')));
  demand(flags.every(flag=>flag?.active===true),'FI_CUTOVER_MARKER_REQUIRED');
  verifyDrift();
  await fi.transaction(async tx=>{
   const old=await tx.get('fiControlConfig','runtime');
   demand(old?.enabled===true&&old.adminWritesEnabled!==true&&old.monthlyBudgetMicros===0,'FI_CUTOVER_RUNTIME_DRIFT');
   tx.set('fiControlConfig','runtime',{...old,monthlyBudgetMicros:budget,dailyUserLimit:quota,adminWritesEnabled:true,productionAt:Date.now(),legacyRuleReleases:reports});
  });
  const check=await fi.get('fiControlConfig','runtime');
  demand(check?.adminWritesEnabled===true&&check.monthlyBudgetMicros===budget&&check.dailyUserLimit===quota,'FI_CUTOVER_RUNTIME_POSTCHECK');
 }
 console.log(JSON.stringify({mode,verified:true,...(mode==='--activate'?{budgetUsd:budget/1000000,dailyModelCallsPerUser:quota}:{})}));
}catch(e){console.error(JSON.stringify({mode,code:/^[A-Z0-9_]+$/.test(e.message||'')?e.message:'FI_CUTOVER_FAILED'}));process.exitCode=1;}
