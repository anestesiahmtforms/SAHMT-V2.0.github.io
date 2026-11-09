import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {sealPrivateJson,openPrivateJson} from './lib/windows-protected-json.js';
import {planFiControlMigration} from './lib/fi-control-migration.js';
import {createFiStore,FI_PROJECTS} from '../worker-fi-control/store.js';
import {encodeFields} from '../worker-training/firestore.js';
const mode=process.argv[2],directory=resolve('.local-preview/fi-control'),project=FI_PROJECTS.FI;
const owners={FA:'anestesiahmtforms@gmail.com',FI:'anestesiahmtforms9@gmail.com',FJ:'anestesiahmtforms10@gmail.com'};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const requireValue=(v,code)=>{if(!v)throw Error(code);};
async function api(url,token,body,method=body===undefined?'GET':'POST',allowDenied=false){const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(30000)});const data=await r.json().catch(()=>({}));if(!r.ok&&!allowDenied)throw Error('FI_RELEASE_HTTP_'+r.status);return {status:r.status,data};}
async function tokenStore(alias,collections){const token=await firebaseCliAccountToken(owners[alias]);return {token,store:createFiStore({projectId:FI_PROJECTS[alias],getAccessToken:async()=>token,allowedCollections:collections})};}
async function accounts(token,alias,users,field){const result=[];for(let n=0;n<users.length;n+=40){const values=users.slice(n,n+40).map(u=>field==='email'?u.email:u.id);const r=await api(`https://identitytoolkit.googleapis.com/v1/projects/${FI_PROJECTS[alias]}/accounts:lookup`,token,{[field]:values});for(const a of r.data.users||[])result.push({localId:a.localId,email:a.email,emailVerified:a.emailVerified===true,disabled:a.disabled===true});}return result;}
async function saveReport(name,value){await writeFile('docs/superpowers/reports/'+name,JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));}
try{
 requireValue(['--capture','--apply-import','--check-drift'].includes(mode),'FI_RELEASE_MODE_INVALID');await mkdir(directory,{recursive:true});
 const FI=await tokenStore('FI',['users','contacts','eventMembers','memberCategoryAssignments','appConfig','fiAdminUsers','fiAdminIdentityLinks','fiControlConfig','fiControlMigrations']);
 const meta=await api('https://cloudresourcemanager.googleapis.com/v1/projects/'+project,FI.token);requireValue(meta.data.projectId===project,'FI_RELEASE_TARGET_MISMATCH');
 const root=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 if(mode==='--capture'){
  const [dbs,roots,indexes,releases,script,deployments]=await Promise.all([
   api(`https://firestore.googleapis.com/v1/projects/${project}/databases`,FI.token),api(root+':listCollectionIds',FI.token,{pageSize:1000}),
   api(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/collectionGroups/-/indexes`,FI.token,undefined,'GET',true),
   api(`https://firebaserules.googleapis.com/v1/projects/${project}/releases`,FI.token,undefined,'GET',true),
   api('https://script.googleapis.com/v1/projects/1r1Dd7nSA_y5txuFpUSvIHdBhB2OD9SUivqreuIFBg-XXuxEUZf4felAK/content',FI.token,undefined,'GET',true),
   api('https://script.googleapis.com/v1/projects/1r1Dd7nSA_y5txuFpUSvIHdBhB2OD9SUivqreuIFBg-XXuxEUZf4felAK/deployments',FI.token,undefined,'GET',true)
  ]);
  requireValue(!roots.data.nextPageToken,'FI_COLLECTION_PAGINATION_REQUIRED');requireValue(!(roots.data.collectionIds||[]).length,'FI_DESTINATION_NOT_EMPTY');
  requireValue(dbs.data.databases?.every(d=>d.name===`projects/${project}/databases/(default)`),'FI_NAMED_DATABASE_REVIEW_REQUIRED');
  const FA=await tokenStore('FA',['users','userCategories','appConfig']),FJ=await tokenStore('FJ',['contacts']);
  const [users,contacts,categories,appConfig]=await Promise.all([FA.store.list('users',[],1001),FJ.store.list('contacts',[],401),FA.store.list('userCategories',[],1001),FA.store.get('appConfig','app')]);
  const [faAccounts,fiAccounts]=await Promise.all([accounts(FA.token,'FA',users,'localId'),accounts(FI.token,'FI',users,'email')]);
  const snapshot={projectId:project,users,contacts,categories,appConfig,faAccounts,fiAccounts,existing:[]};const plan=planFiControlMigration(snapshot);
  const backup={capturedAt:new Date().toISOString(),snapshot,plan,configuration:{databases:dbs.data,indexes:indexes.data,releases:releases.data,script:script.status===200?script.data:null,deployments:deployments.status===200?deployments.data:null}};
  const envelope=await sealPrivateJson(backup);await writeFile(resolve(directory,'migration-capture.dpapi.json'),JSON.stringify(envelope));const verified=await openPrivateJson(JSON.parse(await readFile(resolve(directory,'migration-capture.dpapi.json'),'utf8')));requireValue(digest(verified)===digest(backup),'FI_BACKUP_VERIFICATION_FAILED');
  await saveReport('2026-11-09-fi-migration-preview.json',{code:'FI_MIGRATION_PREVIEW',projectId:project,counts:plan.counts,sourceDeletes:0,cloudMutations:0,backupVerified:true,snapshotDigest:digest(snapshot),databases:dbs.data.databases.map(d=>({name:d.name,locationId:d.locationId})),oldIndexes:indexes.data.indexes?.length??null,moreIndexes:!!indexes.data.nextPageToken,appsScriptStatus:script.status,appsScriptDeploymentsStatus:deployments.status,capturedAt:backup.capturedAt});
 }else if(mode==='--check-drift'){
  const saved=await openPrivateJson(JSON.parse(await readFile(resolve(directory,'migration-capture.dpapi.json'),'utf8')));
  const marker=await FI.store.get('fiControlMigrations','initial');
  requireValue(marker?.snapshotDigest===digest(saved.snapshot),'FI_MIGRATION_MARKER_MISMATCH');
  const [FA,FJ]=await Promise.all([tokenStore('FA',['users','userCategories','appConfig']),tokenStore('FJ',['contacts'])]);
  const [users,contacts,categories,appConfig]=await Promise.all([FA.store.list('users',[],1001),FJ.store.list('contacts',[],401),FA.store.list('userCategories',[],1001),FA.store.get('appConfig','app')]);
  const compare=(original,current)=>{
   const old=new Map(original.map(row=>[row.id,digest(row)]));
   const latest=new Map(current.map(row=>[row.id,digest(row)]));
   return {added:[...latest.keys()].filter(id=>!old.has(id)).length,removed:[...old.keys()].filter(id=>!latest.has(id)).length,modified:[...latest].filter(([id,hash])=>old.has(id)&&old.get(id)!==hash).length};
  };
  const changes={users:compare(saved.snapshot.users,users),contacts:compare(saved.snapshot.contacts,contacts),categories:compare(saved.snapshot.categories,categories),appConfig:digest(appConfig)!==digest(saved.snapshot.appConfig)};
  const drift=changes.appConfig||[changes.users,changes.contacts,changes.categories].some(group=>Object.values(group).some(Boolean));
  console.log(JSON.stringify({code:drift?'FI_SOURCE_DRIFT':'FI_SOURCE_UNCHANGED',changes}));
  if(drift)process.exitCode=2;
 }else{
  const saved=await openPrivateJson(JSON.parse(await readFile(resolve(directory,'migration-capture.dpapi.json'),'utf8'))),plan=planFiControlMigration(saved.snapshot);
  requireValue(Date.now()-Date.parse(saved.capturedAt)<3600000,'FI_CAPTURE_STALE');requireValue(plan.documents.length<449,'FI_ATOMIC_IMPORT_LIMIT');
  const marker=await FI.store.get('fiControlMigrations','initial');if(marker){requireValue(marker.snapshotDigest===digest(saved.snapshot),'FI_MIGRATION_ALREADY_CHANGED');console.log(JSON.stringify({code:'FI_ALREADY_IMPORTED',counts:marker.counts}));process.exit(0);}
  const roots=await api(root+':listCollectionIds',FI.token,{pageSize:1000});requireValue(!roots.data.nextPageToken&&!(roots.data.collectionIds||[]).length,'FI_DESTINATION_NOT_EMPTY');
  const FA=await tokenStore('FA',['users','userCategories','appConfig']),FJ=await tokenStore('FJ',['contacts']);
  const [users,contacts,categories,appConfig]=await Promise.all([FA.store.list('users',[],1001),FJ.store.list('contacts',[],401),FA.store.list('userCategories',[],1001),FA.store.get('appConfig','app')]);
  requireValue(digest({users,contacts,categories,appConfig})===digest({users:saved.snapshot.users,contacts:saved.snapshot.contacts,categories:saved.snapshot.categories,appConfig:saved.snapshot.appConfig}),'FI_SOURCE_CHANGED');
  const writes=plan.documents.map(d=>({update:{name:`projects/${project}/databases/(default)/documents/${d.path}`,fields:encodeFields(d.data)},currentDocument:{exists:false}}));
  writes.push({update:{name:`projects/${project}/databases/(default)/documents/fiControlMigrations/initial`,fields:encodeFields({schemaVersion:1,snapshotDigest:digest(saved.snapshot),counts:plan.counts,sourceDeletes:0,createdAt:Date.now()})},currentDocument:{exists:false}});
  await api(root+':commit',FI.token,{writes});
  for(const d of plan.documents){const parts=d.path.split('/');requireValue(digest(await FI.store.get(parts[0],parts[1]))===digest(d.data),'FI_IMPORT_READBACK_FAILED');}
  await saveReport('2026-11-09-fi-migration-applied.json',{code:'FI_MIGRATION_IMPORTED_AND_VERIFIED',projectId:project,counts:plan.counts,documentsWritten:writes.length,sourceDeletes:0,authChanges:0,readbackVerified:true,at:new Date().toISOString()});
 }
}catch(error){console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'FI_RELEASE_FAILED'}));process.exitCode=1;}
