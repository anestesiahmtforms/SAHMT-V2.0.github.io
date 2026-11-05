// One-time import explicitly authorized on 2026-11-04. Normal runtime never imports.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
import {encodeFields,decodeFields} from '../worker-communication/store.js';
import {buildCommunicationDirectoryImport as build} from './lib/communication-directory-import.js';
const projects={FA:'sahmt-17a16',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt',FD:'rotinas-8a617',FE:'outros-48120',FF:'sahmt-comunicacao-ff'};
const emails=Object.fromEntries(Object.keys(projects).map((key,i)=>[key,`anestesiahmtforms${i?i+1:''}@gmail.com`]));
const principal='serviceAccount:communication-worker@sahmt-comunicacao-ff.iam.gserviceaccount.com';
const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','ff-isolation-2026-11-04'),snapshotFile=resolve(directory,'capture.dpapi.json'),partialFile=resolve(directory,'partial.dpapi.json');
const base=alias=>`projects/${projects[alias]}/databases/${alias==='FF'?'comunicacao':'(default)'}/documents`;
const check=(value,code)=>{if(!value)throw Error(code);};
async function api(token,url,body,method=body?'POST':'GET'){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 const data=await r.json();if(!r.ok)throw Error('FF_ISOLATION_HTTP_'+r.status);return data;
}
async function list(token,alias,collection,fields){
 console.log(JSON.stringify({readingOnce:alias,collection}));
 let pageToken='',rows=[];
 do{const q=new URLSearchParams({pageSize:'1000',...(pageToken?{pageToken}:{})});for(const field of fields||[])q.append('mask.fieldPaths',field);
 const result=await api(token,'https://firestore.googleapis.com/v1/'+base(alias)+'/'+collection+'?'+q);
 rows.push(...(result.documents||[]).map(d=>({id:d.name.split('/').at(-1),updateTime:d.updateTime,...decodeFields(d.fields||{})})));pageToken=result.nextPageToken||'';
 check(rows.length<=3000,'FF_IMPORT_DOCUMENT_LIMIT');}while(pageToken);return rows;
}

try{
 await mkdir(directory,{recursive:true});
 if(process.argv.includes('--capture')){
  try{await readFile(snapshotFile);throw Error('FF_CAPTURE_EXISTS_REUSE_ONLY');}catch(e){if(e.code!=='ENOENT')throw e;}
  const fa=await firebaseCliAccountToken(emails.FA),fb=await firebaseCliAccountToken(emails.FB),ff=await firebaseCliAccountToken(emails.FF);
  let capture;try{capture=await openPrivateJson(JSON.parse(await readFile(partialFile,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;capture={at:new Date().toISOString()};}
  const protector=await createPrivateJsonProtector();
  const checkpoint=()=>writeFile(partialFile,JSON.stringify(protector.seal(capture)));
  const groupSource=process.argv.includes('--groups-from-fa')?'FA':'FB';
  if(capture.groupSource&&capture.groupSource!==groupSource)check(!capture.fbUsers&&!capture.categories&&!capture.areas,'FF_CAPTURE_GROUP_SOURCE_CHANGED');
  capture.groupSource=groupSource;
  if(groupSource==='FA'&&!capture.fbUsers)capture.fbUsers=capture.faUsers;
  await checkpoint();
  for(const [key,alias,collection,fields]of [
   ['faUsers','FA','users',['uid','email','displayName','sigla','active','access','role','permissions']],
   ['fbUsers',groupSource,'users',['uid','email']],
   ['categories',groupSource,'userCategories',['schemaVersion','identityStatus','uid','email','memberCategories']],
   ['areas',groupSource,'managementAreas',['name','title','active','memberUids','managerUids']],
   ['ffUsers','FF','users'],['devices','FF','communicationDevices'],['recipients','FF','communicationRecipients'],['messages','FF','communicationMessages']]){
   if(capture[key])continue;capture[key]=await list({FA:fa,FB:fb,FF:ff}[alias],alias,collection,fields);await checkpoint();
  }
  if(!capture.authUsers){const auth=await api(ff,`https://identitytoolkit.googleapis.com/v1/projects/${projects.FF}/accounts:batchGet?maxResults=1000`);check(!auth.nextPageToken,'FF_AUTH_PAGE_LIMIT');capture.authUsers=(auth.users||[]).map(u=>({localId:u.localId,email:u.email,disabled:u.disabled}));await checkpoint();}
  await writeFile(snapshotFile,JSON.stringify(protector.seal(capture)),{flag:'wx'});
  const plan=build(capture);console.log(JSON.stringify({captured:true,...plan.summary,remoteWrites:0}));
 }else if(process.argv.includes('--resolve-memberships')){
  const snapshot=await openPrivateJson(JSON.parse(await readFile(snapshotFile,'utf8'))),source=snapshot.groupSource;
  check(['FA','FB'].includes(source),'FF_CAPTURE_GROUP_SOURCE_INVALID');
  const known=new Set(snapshot.fbUsers.map(u=>u.uid)),verified=new Set((snapshot.absentMemberships||[]).filter(p=>p.source===source&&p.reason==='SOURCE_AUTH_ACCOUNT_ABSENT').map(p=>p.uid));
  const missing=[...new Set(snapshot.areas.flatMap(a=>[...(a.memberUids||[]),...(a.managerUids||[])]))].filter(uid=>!known.has(uid)&&!verified.has(uid)&&uid!=='EVUyLGKSjPZa5mvVI6evXLROern1');
  check(missing.length<=100,'FF_MEMBERSHIP_LOOKUP_LIMIT');
  if(missing.length){
   const token=await firebaseCliAccountToken(emails[source]),result=await api(token,`https://identitytoolkit.googleapis.com/v1/projects/${projects[source]}/accounts:lookup`,{localId:missing});
   check(!(result.users||[]).length,'FF_MEMBERSHIP_ACCOUNT_REQUIRES_REVIEW');
   await writeFile(resolve(directory,'capture-before-memberships-'+Date.now()+'.dpapi.json'),await readFile(snapshotFile),{flag:'wx'});
   snapshot.absentMemberships=[...(snapshot.absentMemberships||[]),...missing.map(uid=>({uid,source,reason:'SOURCE_AUTH_ACCOUNT_ABSENT',verifiedAt:new Date().toISOString()}))];
   const protector=await createPrivateJsonProtector();await writeFile(snapshotFile,JSON.stringify(protector.seal(snapshot)));
  }
  const plan=build(snapshot);console.log(JSON.stringify({resolvedAbsentMemberships:missing.length,...plan.summary,remoteWrites:0}));
 }else if(process.argv.includes('--refresh-ff')){
  const snapshot=await openPrivateJson(JSON.parse(await readFile(snapshotFile,'utf8'))),ff=await firebaseCliAccountToken(emails.FF);
  let state;try{state=await api(ff,'https://firestore.googleapis.com/v1/'+base('FF')+'/communicationDirectoryState/local-v1');}catch(e){if(e.message!=='FF_ISOLATION_HTTP_404')throw e;}
  check(!state,'FF_DIRECTORY_ALREADY_IMPORTED');
  await writeFile(resolve(directory,'capture-before-refresh-'+Date.now()+'.dpapi.json'),await readFile(snapshotFile),{flag:'wx'});
  for(const [key,collection]of [['ffUsers','users'],['devices','communicationDevices'],['recipients','communicationRecipients'],['messages','communicationMessages']])snapshot[key]=await list(ff,'FF',collection);
  const auth=await api(ff,`https://identitytoolkit.googleapis.com/v1/projects/${projects.FF}/accounts:batchGet?maxResults=1000`);check(!auth.nextPageToken,'FF_AUTH_PAGE_LIMIT');snapshot.authUsers=(auth.users||[]).map(u=>({localId:u.localId,email:u.email,disabled:u.disabled}));
  const plan=build(snapshot),protector=await createPrivateJsonProtector();await writeFile(snapshotFile,JSON.stringify(protector.seal(snapshot)));console.log(JSON.stringify({refreshedFfOnly:true,...plan.summary}));
 }else if(process.argv.includes('--apply')){
  const snapshot=await openPrivateJson(JSON.parse(await readFile(snapshotFile,'utf8'))),plan=build(snapshot),token=await firebaseCliAccountToken(emails.FF);
  const billing=await api(token,`https://cloudbilling.googleapis.com/v1/projects/${projects.FF}/billingInfo`);check(billing.billingEnabled===false&&!billing.billingAccountName,'FF_FREE_REQUIRED');
  const marker=base('FF')+'/communicationDirectoryState/local-v1';
  const snapshotSha256=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  let existing;try{existing=decodeFields((await api(token,'https://firestore.googleapis.com/v1/'+marker)).fields||{});}catch(e){if(e.message!=='FF_ISOLATION_HTTP_404')throw e;}
  if(existing){check(existing.status==='READY'&&existing.snapshotSha256===snapshotSha256,'FF_DIRECTORY_ALREADY_IMPORTED');console.log(JSON.stringify({alreadyImported:true,remoteWrites:0}));process.exit(0);}
  // Directory, old-device rebinding and READY marker commit atomically, or none do.
  await api(token,'https://firestore.googleapis.com/v1/'+base('FF')+':commit',{writes:[...plan.writes,{update:{name:marker,fields:encodeFields({status:'READY',sourceMode:'FF_ONLY',permissionsIsolated:false,importedAt:snapshot.at,completedAt:new Date().toISOString(),snapshotSha256,...plan.summary})},currentDocument:{exists:false}}]});
  console.log(JSON.stringify({imported:true,...plan.summary,recurringSynchronization:false}));
 }else if(process.argv.includes('--revoke')){
  const ff=await firebaseCliAccountToken(emails.FF),marker=base('FF')+'/communicationDirectoryState/local-v1';
  const markerDocument=await api(ff,'https://firestore.googleapis.com/v1/'+marker),state=decodeFields(markerDocument.fields||{});
  check(state.status==='READY'&&state.sourceMode==='FF_ONLY','FF_LOCAL_DIRECTORY_NOT_READY');
  const backups=[],report=[];
  for(const alias of ['FA','FB','FC','FD','FE']){
   const token=await firebaseCliAccountToken(emails[alias]),project=projects[alias],url=`https://cloudresourcemanager.googleapis.com/v1/projects/${project}`;
   const policy=await api(token,url+':getIamPolicy',{options:{requestedPolicyVersion:3}});backups.push({project,policy:structuredClone(policy)});
   if(alias==='FA'){
    const role=`projects/${project}/roles/ffCommunicationFaReleaseReader`;
    let existing;try{existing=await api(token,'https://iam.googleapis.com/v1/'+role);}catch(e){if(e.message!=='FF_ISOLATION_HTTP_404')throw e;}
    if(!existing)existing=await api(token,`https://iam.googleapis.com/v1/projects/${project}/roles`,{roleId:'ffCommunicationFaReleaseReader',role:{title:'FF explicit FA release reader',stage:'GA',includedPermissions:['datastore.entities.get']}});
    check(JSON.stringify(existing.includedPermissions)==='["datastore.entities.get"]','FA_RELEASE_ROLE_TOO_BROAD');
    policy.bindings=(policy.bindings||[]).map(b=>({...b,members:b.members.filter(m=>m!==principal)})).filter(b=>b.members.length);
    const binding=policy.bindings.find(b=>b.role===role&&!b.condition);if(binding)binding.members.push(principal);else policy.bindings.push({role,members:[principal]});
   }else policy.bindings=(policy.bindings||[]).map(b=>({...b,members:b.members.filter(m=>m!==principal)})).filter(b=>b.members.length);
   // Persist pre-change evidence before each policy mutation.
   const protector=await createPrivateJsonProtector();await writeFile(resolve(directory,'iam-before-'+alias+'-'+Date.now()+'.dpapi.json'),JSON.stringify(protector.seal({project,policy:backups.at(-1).policy})),{flag:'wx'});
   await api(token,url+':setIamPolicy',{policy});
   const verified=await api(token,url+':getIamPolicy',{options:{requestedPolicyVersion:3}}),roles=(verified.bindings||[]).filter(b=>b.members.includes(principal)).map(b=>b.role);
   check(alias==='FA'?roles.length===1&&roles[0]===`projects/${project}/roles/ffCommunicationFaReleaseReader`:roles.length===0,'FF_SOURCE_PERMISSION_REMAINS');report.push({alias,roles});
  }
  await api(ff,'https://firestore.googleapis.com/v1/'+base('FF')+':commit',{writes:[{update:{name:marker,fields:encodeFields({permissionsIsolated:true,isolationVerifiedAt:new Date().toISOString()})},updateMask:{fieldPaths:['permissionsIsolated','isolationVerifiedAt']},currentDocument:{updateTime:markerDocument.updateTime}}]});
  console.log(JSON.stringify({isolated:true,projects:report}));
 }else throw Error('FF_CAPTURE_APPLY_OR_REVOKE_REQUIRED');
}catch(e){console.error(/^[A-Z_0-9]+$/.test(e.message)?e.message:'FF_ISOLATION_FAILED');process.exitCode=1;}
