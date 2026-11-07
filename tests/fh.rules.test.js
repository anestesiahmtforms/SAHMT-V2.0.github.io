import {before,beforeEach,after,test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,writeBatch,serverTimestamp,deleteDoc} from 'firebase/firestore';
let env;
const member={uid:'member',email:'member@example.test',displayName:'Member',sigla:'AA',role:'anestesiologista',active:true,access:true,permissions:{labelsRead:true,labelsWrite:true}};
const db=(uid='member',claims={})=>env.authenticatedContext(uid,{aud:'sahmt-etiquetas-fh',sourceProjectId:'sahmt-17a16',moduleStation:'FH',moduleLeaseExpiresAt:Math.floor(Date.now()/1000)+300,firebase:{sign_in_provider:'custom'},...claims}).firestore();
const seed=(path,data)=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),data));
const label=()=>({id:'l1',clientMutationId:'l1',date:'2026-11-06',patientName:'Synthetic',procedureCode:'',encounterCode:'123',type:'Particular',amount:null,insurance:'',creditor:'Caixa',staffSiglas:[],consultation:false,status:'CONFIRMED',active:true,createdByUid:'member',updatedByUid:'member',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),version:1});
before(async()=>{if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8493')throw Error('FH_LOCAL_EMULATOR_REQUIRED');env=await initializeTestEnvironment({projectId:'sahmt-etiquetas-fh',firestore:{host:'127.0.0.1',port:8493,rules:await readFile(new URL('../firestore.fh.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>{await env.clearFirestore();await seed('users/member',member);await seed('users/other',{...member,uid:'other'});await seed('users/admin',{...member,uid:'admin',permissions:{admin:true}});await seed('labels/l1',label());});
after(async()=>{await env?.cleanup();});
test('FH requires its own live lease, central source, module and custom provider',async()=>{
 await assertSucceeds(getDoc(doc(db(),'labels/l1')));
 for(const claims of [{aud:'sahmt-17a16'},{sourceProjectId:'foreign'},{moduleStation:'FI'},{moduleLeaseExpiresAt:1},{firebase:{sign_in_provider:'google.com'}}])await assertFails(getDoc(doc(db('member',claims),'labels/l1')));
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'labels/l1')));
});
test('FH permits own label creation and rejects foreign records, profiles and other modules',async()=>{
 await assertSucceeds(setDoc(doc(db(),'labels/l2'),{...label(),id:'l2',clientMutationId:'l2'}));
 await assertFails(getDoc(doc(db('other'),'labels/l1')));await assertSucceeds(getDoc(doc(db('admin'),'labels/l1')));
 await assertFails(updateDoc(doc(db(),'users/member'),{permissions:{admin:true}}));await assertFails(getDoc(doc(db(),'events/e1')));await assertFails(deleteDoc(doc(db(),'labels/l1')));
});
test('FH catalog is managed locally and does not grant access to an events-only profile',async()=>{
 const catalog={id:'labelStaff',siglas:['AA'],active:true,createdByUid:'admin',updatedByUid:'admin',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),version:1};
 await assertSucceeds(setDoc(doc(db('admin'),'appConfig/labelStaff'),catalog));await assertSucceeds(getDoc(doc(db(),'appConfig/labelStaff')));
 await assertFails(updateDoc(doc(db(),'appConfig/labelStaff'),{siglas:['BB']}));await seed('users/events',{...member,uid:'events',permissions:{eventsRead:true}});await assertFails(getDoc(doc(db('events'),'appConfig/labelStaff')));
});
test('FH edits require a matching immutable history entry in the same commit',async()=>{
 const database=db(),updates={patientName:'Changed',updatedByUid:'member',updatedAt:serverTimestamp(),version:2};
 await assertFails(updateDoc(doc(database,'labels/l1'),updates));
 const commit=(before='Synthetic')=>{const batch=writeBatch(database);batch.update(doc(database,'labels/l1'),updates);batch.set(doc(database,'labels/l1/history/2'),{id:'2',labelId:'l1',version:2,actorUid:'member',actorName:'Member',changedFields:['patientName'],before:{patientName:before},after:{patientName:'Changed'},createdAt:serverTimestamp()});return batch.commit();};
 await assertFails(commit('Forged'));await assertSucceeds(commit());await assertSucceeds(getDoc(doc(database,'labels/l1/history/2')));await assertFails(updateDoc(doc(database,'labels/l1/history/2'),{actorUid:'admin'}));await assertFails(deleteDoc(doc(database,'labels/l1/history/2')));
});
