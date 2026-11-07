import {before,beforeEach,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,deleteDoc,serverTimestamp} from 'firebase/firestore';
let env;
const day=()=>new Date(Date.now()-3*3600000).toISOString().slice(0,10);
const profile={uid:'member',email:'member@example.test',displayName:'Member',sigla:'AA',role:'anestesiologista',active:true,access:true,permissions:{checklistRead:true,checklistWrite:true,checklistSign:true}};
const db=(uid='member',claims={})=>env.authenticatedContext(uid,{email:uid+'@example.test',email_verified:true,aud:'sahmt-checklist-fg',sourceProjectId:'sahmt-17a16',moduleStation:'FG',moduleLeaseExpiresAt:Math.floor(Date.now()/1000)+300,firebase:{sign_in_provider:'custom'},...claims}).firestore();
const seed=(path,data)=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),data));
before(async()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8494')throw Error('FG_LOCAL_EMULATOR_REQUIRED');env=await initializeTestEnvironment({projectId:'demo-sahmt-fg',firestore:{host:'127.0.0.1',port:8494,rules:await readFile(new URL('../firestore.fg.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>{await env.clearFirestore();await seed('users/member',profile);await seed('users/other',{...profile,uid:'other',email:'other@example.test',displayName:'Other',sigla:'BB'});await seed('stations/s',{id:'s',name:'Synthetic arsenal',qrCode:'synthetic',order:1,active:true});});
after(async()=>{await env?.cleanup();});
const record=()=>({id:'r',clientMutationId:'r',stationId:'s',date:day(),condition:'SIM',status:'COMPLETED',occurrence:'',responsibleUid:null,responsibleName:null,responsibleEmail:null,active:true,version:1,createdByUid:'member',updatedByUid:'member',createdByName:'Member',createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
test('FG denies foreign projects, modules, expired leases, direct login and revoked profiles',async()=>{
  await assertSucceeds(getDoc(doc(db(),'stations/s')));
  for(const claims of [{aud:'sahmt-17a16'},{sourceProjectId:'foreign'},{moduleStation:'FH'},{moduleLeaseExpiresAt:1},{firebase:{sign_in_provider:'google.com'}}])await assertFails(getDoc(doc(db('member',claims),'stations/s')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'stations/s')));
  await seed('users/member',{...profile,active:false});await assertFails(getDoc(doc(db(),'stations/s')));
});
test('FG creates immutable valid Checklist records and refuses forged names, dates and responsibility',async()=>{
  await assertSucceeds(setDoc(doc(db(),'checklists/r'),record()));
  await assertFails(updateDoc(doc(db(),'checklists/r'),{occurrence:'changed'}));await assertFails(deleteDoc(doc(db(),'checklists/r')));
  for(const changes of [{createdByName:'Someone else'},{responsibleUid:'other'},{date:'2020-01-01'},{stationId:'missing'}])await assertFails(setDoc(doc(db(),'checklists/invalid'),{...record(),id:'invalid',clientMutationId:'invalid',...changes}));
  await assertFails(updateDoc(doc(db(),'users/member'),{permissions:{admin:true}}));await assertFails(getDoc(doc(db(),'labels/l')));
});
test('a shared daily acknowledgement uses trusted identity fields and cannot be replaced by another user',async()=>{
  const request={id:day(),day:day(),revision:'a'.repeat(64),signerUid:'member',signerName:'Member',signerSigla:'AA',declaration:true,justification:'Declaro que tomei ciência das informações deste relatório.',status:'PENDING_VALIDATION',recordKind:'ACKNOWLEDGEMENT',acknowledgedAt:serverTimestamp(),rotationSigla:'BB',rotationPosition:1};
  await assertSucceeds(setDoc(doc(db(),'checklistSignatureRequests/'+day()),request));
  await assertSucceeds(getDoc(doc(db('other'),'checklistSignatureRequests/'+day())));
  await assertFails(setDoc(doc(db('other'),'checklistSignatureRequests/'+day()),{...request,signerUid:'other',signerName:'Other',signerSigla:'BB'}));
  await assertFails(setDoc(doc(db(),'checklistSignatureRequests/private-id'),{...request,id:'private-id'}));
  await assertFails(updateDoc(doc(db(),'checklistSignatureRequests/'+day()),{status:'VALIDATED',pointsAwarded:1}));
});
test('clients cannot forge signatures, performance receipts, points, summaries or group assignments',async()=>{
  for(const path of ['checklistSignatures/s','checklistResponsibilities/'+day(),'fgPerformanceReceipts/'+day(),'fgPerformanceLedger/credit','fgPerformanceSummaries/member','fgPerformanceRuntime/state','userCategories/assignment'])await assertFails(setDoc(doc(db(),path),{uid:'member',points:1}));
  await seed('fgPerformanceLedger/own',{uid:'member',points:1});await seed('fgPerformanceLedger/other',{uid:'other',points:-1});
  await assertSucceeds(getDoc(doc(db(),'fgPerformanceLedger/own')));await assertFails(getDoc(doc(db(),'fgPerformanceLedger/other')));
});
test('FG administrators change only another users Checklist permissions, preserving identity and all other grants',async()=>{
  await seed('users/admin',{...profile,uid:'admin',email:'admin@example.test',role:'administrador_app',permissions:{admin:true}});
  const grants={checklistRead:true,checklistWrite:false,checklistSign:true,checklistManage:false};
  await assertSucceeds(updateDoc(doc(db('admin'),'users/other'),{permissions:grants,updatedAt:serverTimestamp()}));
  for(const changes of [{permissions:{...grants,admin:true},updatedAt:serverTimestamp()},{email:'changed@example.test',updatedAt:serverTimestamp()},{active:false,updatedAt:serverTimestamp()},{permissions:{...grants,labelsWrite:true},updatedAt:serverTimestamp()}])await assertFails(updateDoc(doc(db('admin'),'users/other'),changes));
  await assertFails(updateDoc(doc(db('admin'),'users/admin'),{permissions:grants,updatedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(db(),'users/other'),{permissions:grants,updatedAt:serverTimestamp()}));
});
