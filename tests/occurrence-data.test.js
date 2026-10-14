import test from 'node:test';
import assert from 'node:assert/strict';
import {createOccurrenceRepository} from '../src/occurrence-data.js';
import {OCCURRENCE_CATALOG_SPECS} from '../src/occurrence-schema.js';

function harness({claims={}, failTransaction=false, failCatalogRead=false, current=true}={}) {
  const store = new Map(), calls=[];
  const db={projectId:'indicadores---sahmt'};
  const user={uid:'uid-synthetic',async getIdTokenResult(force){calls.push(['token',force]);return {claims:{firebase:{sign_in_provider:'custom'},sahmtFaSourceProjectId:'sahmt-17a16',...claims}};}};
  const auth={currentUser:user};
  const firestore={
    doc:(_db,collection,id)=>({path:`${collection}/${id}`,collection,id}),
    collection:(_db,name)=>({collection:name}),
    orderBy:(field,direction)=>({field,direction}), limit:value=>({limit:value}),
    query:(collection,...args)=>({collection,...Object.assign({},...args)}),
    serverTimestamp:()=>({syntheticServerTimestamp:true}),
    getDocFromServer:async ref=>{
      if(failCatalogRead)throw Object.assign(new Error('private Firestore response'),{code:'permission-denied'});
      return {exists:()=>store.has(ref.path),data:()=>store.get(ref.path)};
    },
    getDocsFromServer:async()=>({docs:[]}),
    runTransaction:async(_db,work)=>{
      if(failTransaction) throw Object.assign(new Error('private document content'),{code:'permission-denied'});
      const writes=[];
      const tx={get:async ref=>({exists:()=>store.has(ref.path),data:()=>store.get(ref.path)}),set:(ref,value)=>writes.push([ref.path,value])};
      const result=await work(tx); for(const [path,value] of writes) store.set(path,value); return result;
    }
  };
  const repository=createOccurrenceRepository({db,auth,firestore,isCurrent:()=>current,idGenerator:()=> 'unused'});
  return {repository,store,calls,auth,user,db};
}
const catalogs=Object.fromEntries(Object.entries(OCCURRENCE_CATALOG_SPECS).map(([key,spec])=>[key,Array.from({length:spec.count},(_,i)=>`Opção sintética ${i+1}`)]));
const input={uid:'uid-synthetic',displayName:'Profissional Sintético',anonymous:false,formId:'F01',recordId:'10000000-0000-4000-8000-000000000001',catalogs,
  values:{eventDate:'2026-10-12',occurrence:'Sintética',description:'Descrição sintética',attendance:'Atendimento sintético',
    causingSector:'Opção sintética 1',medicationName:'Medicamento sintético',lotNumber:'L-1',symptomAfterEvent:'Opção sintética 2',
    immediateAction:'Ação sintética',eventPeriod:'Opção sintética 1'}};
const allClaims={sahmtOccurrencesCatalogRead:true,sahmtOccurrencesWrite:true,sahmtOccurrencesRead:true};

test('consultas consecutivas no FC usam o token gerenciado pelo SDK sem renovação forçada', async()=>{
  const {repository,calls,store}=harness({claims:{...allClaims,sahmtOccurrencesAuditRead:true}});
  store.set('occurrenceCatalogs/current',{schemaVersion:1,catalogs});
  await repository.loadCatalog({uid:input.uid});
  await repository.loadCatalog({uid:input.uid});
  await repository.list({uid:input.uid});
  await repository.listAudit({uid:input.uid});
  assert.deepEqual(calls.filter(([name])=>name==='token').map(([,force])=>force),[false,false,false,false]);
});

test('nega catálogo e escrita sem claims emitidos pelo servidor para o FA e FC', async()=>{
  const {repository,calls}=harness();
  await assert.rejects(repository.loadCatalog({uid:input.uid}),{message:'OCCURRENCE_PERMISSION_DENIED'});
  await assert.rejects(repository.save(input),{message:'OCCURRENCE_PERMISSION_DENIED'});
  assert.equal(calls.filter(([name])=>name==='token').length,2);
});

test('falha de permissão no Firestore FC recebe código distinto de catálogo ausente',async()=>{
  const {repository}=harness({claims:allClaims,failCatalogRead:true});
  await assert.rejects(repository.loadCatalog({uid:input.uid}),{message:'OCCURRENCE_CATALOG_PERMISSION_DENIED'});
});

test('grava relatório anonimizado, auditoria restrita e claim pendente em um commit idempotente', async()=>{
  const {repository,store}=harness({claims:allClaims});
  const first=await repository.save({...input,anonymous:true,displayName:''});
  const retry=await repository.save({...input,anonymous:true,displayName:''});
  assert.equal(first.status,'saved'); assert.equal(retry.status,'already-saved');
  assert.equal(store.size,3);
  const report=store.get(`occurrenceReports/${input.recordId}`);
  assert.equal(report.authorLabel,'Anônimo'); assert.equal(report.anonymous,true);
  assert.equal(Object.hasOwn(report,'uid'),false); assert.equal(Object.hasOwn(report,'createdByUid'),false);
  assert.equal(store.get(`occurrenceAudit/${input.recordId}`).uid,input.uid);
  const score=store.get(`occurrenceScoreClaims/${input.recordId}`);
  assert.equal(score.points,2); assert.equal(score.status,'PENDING_VALIDATION');
});

test('preserva o autor quando não anônimo, mas não inclui e-mail nem uid no relatório', async()=>{
  const {repository,store}=harness({claims:allClaims});
  await repository.save(input);
  const report=store.get(`occurrenceReports/${input.recordId}`);
  assert.equal(report.authorLabel,'Profissional Sintético');
  assert.equal(Object.hasOwn(report,'email'),false); assert.equal(Object.hasOwn(report,'uid'),false);
});

test('não sobrescreve identidade divergente, não grava formulário inválido e falha sem conexão', async()=>{
  const {repository,store}=harness({claims:allClaims});
  await assert.rejects(repository.save({...input,uid:'uid-divergente'}),{message:'OCCURRENCE_SESSION_INVALID'});
  await assert.rejects(repository.save({...input,values:{...input.values,causingSector:'fora do catálogo'}}),{message:'OCCURRENCE_FORM_INVALID'});
  assert.equal(store.size,0);
  const failing=harness({claims:allClaims,failTransaction:true});
  await assert.rejects(failing.repository.save(input),{message:'OCCURRENCE_SAVE_FAILED'});
  assert.equal(failing.store.size,0);
});
