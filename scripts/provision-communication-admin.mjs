// Explicitly authorized account only. No IAM, billing, password or provider configuration changes.
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {createPrivateJsonProtector,openPrivateJson} from './lib/windows-protected-json.js';
const email='anestesiahmtforms6@gmail.com';
const projects=['sahmt-17a16','sahmt-gestao-5ae66','indicadores---sahmt','rotinas-8a617','outros-48120','sahmt-comunicacao-ff'];
const permissions=['checklistRead','checklistWrite','checklistSign','checklistManage','labelsRead','labelsWrite','labelsManage','eventsRead','eventsWrite','eventsCatalogManage','scheduleRead','scheduleWrite','trainingsRead','trainingsManage','managementModuleEnabled','performanceModuleEnabled','managementRead','managementManage','managementActivityWrite','managementIndicatorsRead','managementIndicatorsWrite','managementPlansManage','documentsManage','qualityManage','equipmentManage','peopleManage','financeRead','financeWrite','financeManage','notificationsRead','notificationsManage','occurrencesRead','occurrencesWrite','occurrencesAuditRead','usersManage','admin'];
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const root=i=>`projects/${projects[i]}/databases/${i===5?'comunicacao':'(default)'}/documents`;
const decode=v=>v?.mapValue?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):v?.arrayValue?(v.arrayValue.values||[]).map(decode):v?.stringValue??v?.booleanValue??(v?.integerValue!==undefined?Number(v.integerValue):v?.timestampValue??null);
const fields=f=>decode({mapValue:{fields:f||{}}});
const encode=v=>Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:v===null?{nullValue:null}:typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:v};
async function api(token,url,method='GET',body,missing=false){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(30000)});
 if(missing&&r.status===404)return null;
 if(!r.ok){await r.body?.cancel();throw Error('ADMIN_HTTP_'+r.status);}
 return r.json();
}
try{
 const mode=process.argv[2]||'preview';demand(['preview','apply','verify'].includes(mode),'ADMIN_MODE_INVALID');
 const tokens=[];for(let i=0;i<6;i++)tokens.push(await firebaseCliAccountToken(`anestesiahmtforms${i?i+1:''}@gmail.com`));
 const google=await api(tokens[5],'https://www.googleapis.com/oauth2/v2/userinfo');
 demand(google.email===email&&google.verified_email===true&&/^\d+$/.test(google.id),'ADMIN_GOOGLE_IDENTITY_INVALID');
 const accounts=[];
 for(let i=0;i<6;i++){
  const result=await api(tokens[i],`https://identitytoolkit.googleapis.com/v1/projects/${projects[i]}/accounts:lookup`,'POST',{email:[email],federatedUserId:[{providerId:'google.com',rawId:google.id}]});
  demand((result.users||[]).length<=1,'ADMIN_AUTH_AMBIGUOUS');const a=result.users?.[0]||null;
  if(a)demand(a.email===email&&a.providerUserInfo?.some(p=>p.providerId==='google.com'&&p.rawId===google.id),'ADMIN_AUTH_IDENTITY_CONFLICT');
  accounts.push(a);
 }
 const uid=accounts[0]?.localId||accounts.slice(1,5).find(Boolean)?.localId||'google_'+createHash('sha256').update(google.id).digest('hex').slice(0,28);
 demand(accounts.slice(0,5).every(a=>!a||a.localId===uid),'ADMIN_EXISTING_UID_CONFLICT');
 const rows=[],writes=[];
 for(let i=0;i<6;i++){
  const localId=accounts[i]?.localId||uid,documents=[];
  if(!accounts[i]){
   const collision=await api(tokens[i],`https://identitytoolkit.googleapis.com/v1/projects/${projects[i]}/accounts:lookup`,'POST',{localId:[localId]});
   demand(!collision.users?.length,'ADMIN_UID_ALREADY_USED');
  }
  const paths=[`users/${localId}`,...(i<5?[`documentAccessEmails/${email}`]:[]),...(i===2?[`qmentumAccess/${localId}`]:[])];
  for(const path of paths)documents.push({path,document:await api(tokens[i],`https://firestore.googleapis.com/v1/${root(i)}/${path}`,'GET',null,true)});
  const get=path=>documents.find(d=>d.path===path)?.document;
  const add=(path,data,timestamps=[])=>{
   const previous=get(path),old=fields(previous?.fields);
   if(Object.keys(data).every(k=>JSON.stringify(data[k])===JSON.stringify(old[k])))return;
   writes.push({i,update:{name:root(i)+'/'+path,fields:encode(data).mapValue.fields},updateMask:{fieldPaths:Object.keys(data)},currentDocument:previous?{updateTime:previous.updateTime}:{exists:false},...(timestamps.length?{updateTransforms:timestamps.map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))}:{})});
  };
  const previous=get(`users/${localId}`),old=fields(previous?.fields);
  demand((!old.uid||old.uid===localId)&&(!old.email||old.email.toLowerCase()===email),'ADMIN_PROFILE_CONFLICT');
  add(`users/${localId}`,{uid:localId,email,displayName:old.displayName||google.name||email.split('@')[0],sigla:old.sigla||'',phone:old.phone||'',active:true,access:true,role:'administrador_app',permissions:{...old.permissions,...Object.fromEntries(permissions.map(k=>[k,true]))}},previous?['updatedAt']:['createdAt','updatedAt']);
  if(i<5){
   const access=get(`documentAccessEmails/${email}`),p=fields(access?.fields);
   if(p.active!==true||p.id!==email||p.email!==email||!['GENERAL','RESTRICTED'].every(g=>p.groups?.includes(g)))add(`documentAccessEmails/${email}`,{id:email,email,active:true,groups:[...new Set([...(p.groups||[]),'GENERAL','RESTRICTED'])],version:(Number(p.version)||0)+1,createdByUid:p.createdByUid||localId,updatedByUid:localId},p.createdAt?['updatedAt']:['createdAt','updatedAt']);
  }
  if(i===2){const result=await api(tokens[i],`https://firestore.googleapis.com/v1/${root(i)}/qmentumUnits?pageSize=20`);demand(!result.nextPageToken,'ADMIN_QMENTUM_UNITS_PAGINATION_REQUIRED');const units=(result.documents||[]).filter(d=>fields(d.fields).active===true).map(d=>d.name.split('/').at(-1)).sort();demand(units.length>0,'ADMIN_QMENTUM_UNITS_REQUIRED');add(`qmentumAccess/${localId}`,{uid:localId,active:true,role:'manager',units});}
  rows.push({alias:'F'+'ABCDEF'[i],localId,account:accounts[i]?{localId:accounts[i].localId,email,disabled:accounts[i].disabled===true,emailVerified:accounts[i].emailVerified===true}:null,documents});
 }
 if(mode==='apply'){
  const directory=resolve(process.env.LOCALAPPDATA,'SAHMT','communication-admin');await mkdir(directory,{recursive:true});
  const protector=await createPrivateJsonProtector(),backup=resolve(directory,`admin-${Date.now()}.dpapi.json`);
  await writeFile(backup,JSON.stringify(protector.seal({email,rows,writes,at:new Date().toISOString()})),{flag:'wx'});
  demand((await openPrivateJson(JSON.parse(await readFile(backup,'utf8')))).rows.length===6,'ADMIN_BACKUP_INVALID');
  for(let i=0;i<6;i++){
   if(!accounts[i]){
    const result=await api(tokens[i],`https://identitytoolkit.googleapis.com/v1/projects/${projects[i]}/accounts:batchCreate`,'POST',{hashAlgorithm:'BCRYPT',sanityCheck:true,allowOverwrite:false,users:[{localId:rows[i].localId,email,emailVerified:true,disabled:false,displayName:google.name||email.split('@')[0],providerUserInfo:[{providerId:'google.com',rawId:google.id,email}]}]});
    demand(!(result.error?.length||result.errors?.length||result.failureCount),'ADMIN_IMPORT_PARTIAL_STOP');
   }else if(accounts[i].disabled||!accounts[i].emailVerified)await api(tokens[i],`https://identitytoolkit.googleapis.com/v1/projects/${projects[i]}/accounts:update`,'POST',{localId:rows[i].localId,disableUser:false,emailVerified:true});
   const changes=writes.filter(w=>w.i===i).map(({i,...w})=>w);if(changes.length)await api(tokens[i],`https://firestore.googleapis.com/v1/${root(i)}:commit`,'POST',{writes:changes});
   const result=await api(tokens[i],`https://identitytoolkit.googleapis.com/v1/projects/${projects[i]}/accounts:lookup`,'POST',{localId:[rows[i].localId]});const a=result.users?.[0];
   demand(a?.localId===rows[i].localId&&a.email===email&&a.emailVerified===true&&!a.disabled&&a.providerUserInfo?.some(p=>p.providerId==='google.com'&&p.rawId===google.id),'ADMIN_READBACK_AUTH_FAILED');
   const p=fields((await api(tokens[i],`https://firestore.googleapis.com/v1/${root(i)}/users/${rows[i].localId}`)).fields);
   demand(p.uid===a.localId&&p.email===email&&p.active&&p.access&&p.role==='administrador_app'&&permissions.every(k=>p.permissions?.[k]===true),'ADMIN_READBACK_PROFILE_FAILED');
   console.log(JSON.stringify({project:rows[i].alias,code:'ADMIN_AUTH_AND_PROFILE_VERIFIED',created:!accounts[i],documentsWritten:changes.length}));
  }
  console.log(JSON.stringify({code:'ADMIN_PROVISIONED',email,backup,billingChanges:0,iamChanges:0}));
 }else{
  const pending=accounts.some(a=>!a||a.disabled||!a.emailVerified)||writes.length>0;
  console.log(JSON.stringify({code:pending?'ADMIN_CHANGES_REQUIRED':'ADMIN_VERIFIED',email,projects:rows.map((r,i)=>({project:r.alias,authExists:!!r.account,active:!!r.account&&!r.account.disabled&&r.account.emailVerified,plannedDocuments:writes.filter(w=>w.i===i).length})),plannedDocuments:writes.length}));
  if(mode==='verify'&&pending)process.exitCode=1;
 }
}catch(e){console.error(JSON.stringify({code:'ADMIN_PROVISION_STOPPED',reason:/^[A-Z_0-9]+$/.test(e.message)?e.message:'ADMIN_UNEXPECTED_ERROR'}));process.exitCode=1;}
