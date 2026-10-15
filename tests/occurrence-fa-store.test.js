import test from 'node:test';import assert from 'node:assert/strict';
import {createOccurrenceRepository} from '../src/occurrence-data.js';
import {OCCURRENCE_CATALOG_SPECS} from '../src/occurrence-schema.js';
function setup(){
 const uid='synthetic-member',user={uid,getIdTokenResult:()=>{throw Error('Secondary-token checks are forbidden');}};
 const auth={currentUser:user},db={app:{options:{projectId:'sahmt-17a16'}}},reads=[];
 let profile={uid,active:true,access:true,role:'administrador_app',permissions:{}};
 const catalogs=Object.fromEntries(Object.entries(OCCURRENCE_CATALOG_SPECS).map(([name,s])=>[name,Array.from({length:s.count},(_,i)=>'Synthetic '+name+' '+i)]));
 const firestore={doc:(_,collection,id)=>({collection,id}),collection:(_,collection)=>({collection}),orderBy:()=>({}),limit:()=>({}),query:()=>({}),
  getDocFromServer:async ref=>{reads.push(ref.collection);return {exists:()=>ref.collection!=='users'||!!profile,data:()=>ref.collection==='users'?profile:{schemaVersion:1,catalogs}};},
  getDocsFromServer:async()=>({docs:[]})};
 const repository=createOccurrenceRepository({db,auth,firestore});
 return {uid,user,auth,db,reads,repository,setProfile:value=>profile=value};
}
test('existing FA Google session opens catalog without secondary auth or synthetic claims',async()=>{
 const h=setup();assert.equal((await h.repository.loadCatalog({uid:h.uid})).schemaVersion,1);assert.deepEqual(h.reads,['users','occurrenceCatalogs']);
});
test('all-active write policy does not confer read or audit privileges through the FA role',async()=>{
 const h=setup();await assert.rejects(h.repository.list({uid:h.uid}),/PERMISSION_DENIED/);await assert.rejects(h.repository.listAudit({uid:h.uid}),/PERMISSION_DENIED/);
 h.setProfile({uid:h.uid,active:true,access:true,permissions:{occurrencesRead:true}});
 assert.deepEqual(await h.repository.list({uid:h.uid}),[]);await assert.rejects(h.repository.listAudit({uid:h.uid}),/PERMISSION_DENIED/);
});
test('cached catalog never bypasses revocation, missing profiles, UID mismatch or wrong database',async()=>{
 const h=setup();await h.repository.loadCatalog({uid:h.uid});
 for(const profile of [null,{uid:h.uid,active:false,access:true},{uid:h.uid,active:true,access:false},{uid:'other',active:true,access:true}]){
  h.setProfile(profile);await assert.rejects(h.repository.loadCatalog({uid:h.uid}),/PERMISSION_DENIED/);
 }
 h.db.app.options.projectId='indicadores---sahmt';await assert.rejects(h.repository.loadCatalog({uid:h.uid}),/SESSION_INVALID/);
});
