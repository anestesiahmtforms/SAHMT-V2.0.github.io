import {readFile} from 'node:fs/promises';import {before,after,test} from 'node:test';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,query,limit,getDocFromServer,getDocsFromServer,setDoc} from 'firebase/firestore';
let env;const uid='retirement-synthetic-member';
before(async()=>{
 const [host,port]=process.env.FIRESTORE_EMULATOR_HOST.split(':');
 env=await initializeTestEnvironment({projectId:'demo-sahmt-fc-source-retired',firestore:{host,port:Number(port),rules:await readFile(process.env.SAHMT_FIRESTORE_RULES_FILE||new URL('../firestore.rules',import.meta.url),'utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'users',uid),{uid,active:true,access:true,role:'admin',permissions:{admin:true,peopleManage:true,occurrencesRead:true,occurrencesAuditRead:true}});
  for(const [root,id,data] of [['qmentumAccess',uid,{uid,active:true,role:'manager',units:['unit']}],['qmentumConfig','current',{enabled:true}],['occurrenceRuntime','faConsolidation',{status:'ACTIVE'}],['occurrenceCatalogs','current',{schemaVersion:1}],['occurrenceReports','record',{id:'record'}]])await setDoc(doc(db,root,id),data);
 });
});
after(async()=>env?.cleanup());
test('retired FA modules remain denied even to an active administrator while own profile remains accessible',async()=>{
 const db=env.authenticatedContext(uid,{email_verified:true,firebase:{sign_in_provider:'google.com'}}).firestore();
 await assertSucceeds(getDocFromServer(doc(db,'users',uid)));
 for(const [root,id] of [['qmentumAccess',uid],['qmentumConfig','current'],['occurrenceCatalogs','current'],['occurrenceReports','record']])await assertFails(getDocFromServer(doc(db,root,id)));
 for(const root of ['qmentumParticipations','qmentumWriteRequests','qmentumUnits','occurrenceReports','occurrenceAudit','occurrenceScoreClaims']){
  await assertFails(getDocsFromServer(query(collection(db,root),limit(1))));
  await assertFails(setDoc(doc(db,root,'new-record'),{uid}));
 }
});
