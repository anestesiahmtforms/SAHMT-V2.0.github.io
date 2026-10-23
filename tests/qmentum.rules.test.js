import {readFile} from 'node:fs/promises';
import {before,after,beforeEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,writeBatch,serverTimestamp,updateDoc,deleteDoc,collection,query,where,limit,getDocs} from 'firebase/firestore';
import {initialDefinitions,emptyInputs} from '../src/qmentum-catalog.js';
import {calculateMonth} from '../src/qmentum-engine.js';
import * as sdk from 'firebase/firestore';
import {createQmentumRepository} from '../src/qmentum-data.js';
import {createQmentumCommandSender} from '../src/qmentum-command.js';
import {prepareQmentumWrite} from '../src/qmentum-write.js';
const claims={firebase:{sign_in_provider:'google.com'},aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt'};
let env;const defs=initialDefinitions();
before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:18493');env=await initializeTestEnvironment({projectId:'demo-sahmt-qmentum',firestore:{host:'127.0.0.1',port:18493,rules:await readFile(process.env.SAHMT_FIRESTORE_RULES_FILE||new URL('../firestore.qmentum.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await Promise.all([setDoc(doc(db,'qmentumConfig/current'),{enabled:true,definitionVersion:1}),setDoc(doc(db,'qmentumDefinitions/1'),defs),setDoc(doc(db,'qmentumUnits/unit-a'),{unitId:'unit-a',name:'Unidade sintética',active:true}),...['collector','reviewer','manager'].map(role=>setDoc(doc(db,'qmentumAccess',role),{uid:role,active:true,role,units:['unit-a']})),...['collector','reviewer','manager'].map(uid=>setDoc(doc(db,'users',uid),{uid,active:true,access:true,role:'usuario',permissions:{}}))]);});});
const dbFor=role=>env.authenticatedContext(role,claims).firestore();
function repository(role,isCurrent=()=>true){
 const real=dbFor(role),app={options:{projectId:'indicadores---sahmt'}},db={app,real};
 const auth={app,currentUser:{uid:role,getIdToken:async()=> 'synthetic-token',getIdTokenResult:async()=>({claims:{...claims,sub:role}})}};
 const api={...sdk,doc:(db,...s)=>sdk.doc(db.real,...s),collection:(db,...s)=>sdk.collection(db.real,...s),runTransaction:(db,callback)=>sdk.runTransaction(db.real,callback)};
 const writeCommand=createQmentumCommandSender({db,auth,uid:role,firestore:api,endpoint:'https://synthetic.local/endpoint',ensure:()=>{if(!isCurrent())throw Error('QMENTUM_SESSION_CHANGED');},fetchImpl:async(_url,options)=>{
  try{const id=JSON.parse(options.body).id;await assertSucceeds(getDoc(doc(real,'qmentumWriteRequests',id)));
   let version;await env.withSecurityRulesDisabled(async context=>{version=await sdk.runTransaction(context.firestore(),async tx=>{
    const backend=context.firestore(),rref=doc(backend,'qmentumWriteRequests',id),request=(await tx.get(rref)).data();
    const read=async(...p)=>{const snapshot=await tx.get(doc(backend,...p));return snapshot.exists()?snapshot.data():null;};
    const profile=await read('users',role),grant=await read('qmentumAccess',role),config=await read('qmentumConfig','current');
    if(request.status==='CONFIRMED')return request.confirmedVersion;
    const p=request.payload,unit=request.operation==='SAVE_MONTH'?await read('qmentumUnits',p.unitId):null;
    const period=request.operation==='SAVE_MONTH'?p.year+'-'+String(p.month).padStart(2,'0'):null;
    const path=request.operation==='SAVE_MONTH'?['qmentumUnits',p.unitId,'months',period]:['qmentumDefinitions',String(p.definitions.version)];
    const current=await read(...path),dv=p.action==='REBASE'?config.definitionVersion:current?.definitionVersion||p.definitionVersion||config.definitionVersion;
    const definitions=request.operation==='SAVE_MONTH'?await read('qmentumDefinitions',String(dv)):null;
    const importBatch=p.action==='IMPORT'?await read('qmentumUnits',p.unitId,'imports',p.importHash):null;
    const prepared=prepareQmentumWrite({uid:role,operation:request.operation,payload:p,profile,grant,config,unit,current,definitions,importBatch,now:new Date()});
    tx.set(doc(backend,...path),prepared.data);
    if(prepared.kind==='month')tx.set(doc(backend,...path,'history',String(prepared.version)),prepared.data);
    else tx.update(doc(backend,'qmentumConfig/current'),{definitionVersion:prepared.version});
    tx.update(rref,{status:'CONFIRMED',confirmedVersion:prepared.version});return prepared.version;
   });});return new Response(JSON.stringify({code:'QMENTUM_WRITE_CONFIRMED',version}),{status:200});
  }catch(error){return new Response(JSON.stringify({code:/^QMENTUM_[A-Z_]+$/.test(error.message)?error.message:'QMENTUM_WRITE_UNAVAILABLE'}),{status:409});}
 }});
 return createQmentumRepository({uid:role,isCurrent,db,auth,firestore:api,writeCommand});
}
const analysisId='a'.repeat(64),signature='b'.repeat(64);
async function seedAnalysis(){await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'qmentumUnits/unit-a/quarterlyAnalyses',analysisId),{id:analysisId,unitId:'unit-a',signature,reviewed:true,status:'REVIEWED'}));}
const participation=(uid,modality='ACKNOWLEDGEMENT')=>({unitId:'unit-a',analysisId,signature,actorUid:uid,modality,suggestion:modality==='SUGGESTION'?'Sugestão sintética para melhoria':'',status:'PENDING',createdAt:serverTimestamp()});
test('ciência e sugestão são pedidos independentes imutáveis; navegador não concede pontos',async()=>{
 await seedAnalysis();const db=dbFor('collector'),id=analysisId+'_collector_ACKNOWLEDGEMENT',p=participation('collector');
 await assertSucceeds(setDoc(doc(db,'qmentumParticipations',id),p));await assertFails(updateDoc(doc(db,'qmentumParticipations',id),{status:'CONFIRMED',confirmedPoints:1}));
 await assertFails(setDoc(doc(db,'qmentumParticipations',analysisId+'_collector_SUGGESTION'),{...participation('collector','SUGGESTION'),points:2}));
 await assertSucceeds(setDoc(doc(db,'qmentumParticipations',analysisId+'_collector_SUGGESTION'),participation('collector','SUGGESTION')));
 await assertFails(setDoc(doc(db,'evaluationAwards/forged'),{uid:'collector',points:100}));
});
test('bloqueia identidade divergente, análise não revisada e assinatura divergente',async()=>{
 await seedAnalysis();const db=dbFor('collector'),id=analysisId+'_collector_ACKNOWLEDGEMENT';
 await assertFails(setDoc(doc(db,'qmentumParticipations',id),participation('manager')));
 await assertFails(setDoc(doc(db,'qmentumParticipations',id),{...participation('collector'),signature:'c'.repeat(64)}));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'qmentumUnits/unit-a/quarterlyAnalyses',analysisId),{reviewed:false}));
 await assertFails(setDoc(doc(db,'qmentumParticipations',id),participation('collector')));
});
test('aprovação exige gestor diferente do autor, parecer e estado aguardando aprovação',async()=>{
 await seedAnalysis();const id=analysisId+'_collector_SUGGESTION';await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'qmentumParticipations',id),{...participation('collector','SUGGESTION'),createdAt:new Date(),status:'AWAITING_APPROVAL'}));
 const review={participationId:id,unitId:'unit-a',actorUid:'manager',decision:'APPROVE',reason:'Sugestão analisada e aprovada',status:'PENDING',createdAt:serverTimestamp()};
 await assertFails(setDoc(doc(dbFor('collector'),'qmentumParticipationReviews',id),{...review,actorUid:'collector'}));
 await assertSucceeds(setDoc(doc(dbFor('manager'),'qmentumParticipationReviews',id),review));
 await assertFails(updateDoc(doc(dbFor('manager'),'qmentumParticipationReviews',id),{decision:'REJECT'}));
});
test('consulta de participações é limitada e não revela solicitações de outras pessoas',async()=>{
 await seedAnalysis();await setDoc(doc(dbFor('collector'),'qmentumParticipations',analysisId+'_collector_ACKNOWLEDGEMENT'),participation('collector'));
 const filters=[where('unitId','==','unit-a'),where('analysisId','==',analysisId)];
 await assertSucceeds(getDocs(query(collection(dbFor('manager'),'qmentumParticipations'),...filters,limit(100))));
 await assertFails(getDocs(query(collection(dbFor('reviewer'),'qmentumParticipations'),...filters,limit(100))));
 await assertSucceeds(getDocs(query(collection(dbFor('collector'),'qmentumParticipations'),...filters,where('actorUid','==','collector'),limit(100))));
});
test('clientes não podem forjar análise IA, fila, evidência ou revisão concluída',async()=>{
 const db=dbFor('manager');for(const path of ['qmentumQuarterlyJobs/x','qmentumEvidence/QM01','qmentumUnits/unit-a/quarterlyAnalyses/x','qmentumImprovementActions/x'])await assertFails(setDoc(doc(db,path),{status:'REVIEWED'}));
 await assertFails(setDoc(doc(db,'qmentumAnalysisReviewRequests/x'),{status:'CONFIRMED'}));
});
test('revisão humana é somente pedido pendente autorizado para a mesma unidade',async()=>{
 const id='a'.repeat(64),signature='b'.repeat(64);
 await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'qmentumUnits/unit-a/quarterlyAnalyses/'+id),{id,signature,status:'GENERATED_PENDING_REVIEW'}));
 const input={unitId:'unit-a',analysisId:id,signature,reason:'Conferência sintética autorizada'};
 await assertSucceeds(repository('manager').requestAnalysisReview(input));
 await assert.rejects(repository('collector').requestAnalysisReview(input),/REVIEW_DENIED/);
 await assertFails(updateDoc(doc(dbFor('manager'),'qmentumUnits/unit-a/quarterlyAnalyses/'+id),{reviewed:true}));
});
test('browser cannot write authoritative months, history, definitions or configuration',async()=>{
 const db=dbFor('manager');
 for(const path of ['qmentumUnits/unit-a/months/2026-01','qmentumUnits/unit-a/months/2026-01/history/1','qmentumDefinitions/2','qmentumConfig/current'])await assertFails(setDoc(doc(db,path),{admin:true,results:{QM01:{ratio:1}}}));
});
test('write commands require own UID, valid grant, enabled unit and immutable pending envelope',async()=>{
 const db=dbFor('collector'),hash='a'.repeat(64),id='collector_'+hash;
 const value={actorUid:'collector',payloadHash:hash,operation:'SAVE_MONTH',payload:{unitId:'unit-a'},status:'PENDING',createdAt:serverTimestamp()};
 await assertFails(setDoc(doc(db,'qmentumWriteRequests',id),{...value,actorUid:'manager'}));
 await assertFails(setDoc(doc(db,'qmentumWriteRequests',id),{...value,status:'CONFIRMED'}));
 await assertFails(setDoc(doc(db,'qmentumWriteRequests',id),{...value,payload:{unitId:'other'}}));
 await assertSucceeds(setDoc(doc(db,'qmentumWriteRequests',id),value));
 await assertFails(updateDoc(doc(db,'qmentumWriteRequests',id),{status:'CONFIRMED'}));
 await assertFails(getDoc(doc(dbFor('reviewer'),'qmentumWriteRequests',id)));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'qmentumConfig/current'),{enabled:false}));
 await assertFails(setDoc(doc(db,'qmentumWriteRequests','collector_'+'b'.repeat(64)),{...value,payloadHash:'b'.repeat(64)}));
});
const completeInputs=()=>{const i=emptyInputs();for(const k of Object.keys(i.counts)){i.counts[k]=10;i.origins[k]='MANUAL';}i.counts.pending48=0;i.counts.pending30=0;i.attribution48=true;i.attribution30=true;i.uniqueEventProceduresConfirmed=true;return i;};
test('FC client → immutable command → trusted validation → month/history → reload and full lifecycle',async()=>{
 const approved=structuredClone(defs);Object.values(approved.items).forEach(d=>{d.approved=true;d.criterion='Critério institucional sintético';});await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'qmentumDefinitions/1'),approved));
 const repo=repository('manager'),input={unitId:'unit-a',year:2026,month:1,inputs:completeInputs(),referenceDate:'2026-01-20'};
 await repo.open();await repo.save(input);const first=await repo.month('unit-a',2026,1);assert.equal(first.version,1);assert.equal(first.results.QM11.ratio,0);
 await repo.save(input);assert.equal((await repo.history('unit-a',2026,1)).length,1,'same command is idempotent');
 await repo.save({...input,baseVersion:1,action:'REVIEW'});await repo.save({...input,baseVersion:2,action:'CLOSE'});
 await assert.rejects(repo.save({...input,baseVersion:3}),/MONTH_CLOSED/);
 await repo.save({...input,baseVersion:3,action:'REOPEN',reason:'Correção sintética justificada'});
 assert.equal((await repo.year('unit-a',2026)).length,1);assert.equal((await repo.history('unit-a',2026,1)).length,4);
 await assert.rejects(repo.save({...input,baseVersion:1,inputs:{...input.inputs,comment:'Changed after version moved'}}),/VERSION_CONFLICT/);
});
test('backend refuses forged inputs and profile revocation; draft remains unchanged',async()=>{
 const repo=repository('collector'),input={unitId:'unit-a',year:2026,month:1,inputs:emptyInputs(),referenceDate:'2026-01-01'};
 await repo.save(input);const malformed={...input.inputs,role:'administrador_app'};
 await assert.rejects(repo.save({...input,baseVersion:1,inputs:malformed}),/INPUT_INVALID/);
 assert.equal((await repo.month('unit-a',2026,1)).version,1);
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'users/collector'),{active:false}));
 await assert.rejects(repo.save({...input,baseVersion:1}),/PERMISSION_DENIED/);
});
test('definition publication is trusted, versioned and immutable to browser updates',async()=>{
 const repo=repository('manager'),next={...structuredClone(defs),version:2,validFrom:'2026-01',reason:'Critério institucional atualizado'};
 await repo.publishDefinition(next);assert.equal((await repo.definition(2)).version,2);
 await assertFails(updateDoc(doc(dbFor('manager'),'qmentumDefinitions/1'),{reason:'Untrusted change'}));
 await assert.rejects(repository('collector').publishDefinition({...next,version:3}),/PERMISSION_DENIED/);
});
test('historical import only stages immutable provenance until a trusted explicit monthly command',async()=>{
 const repo=repository('manager'),hash='a'.repeat(64),preview={unitId:'unit-a',year:2026,hash,sourceSheetNames:['Synthetic']};
 await repo.stageImport({preview,backupReference:'LOCAL_BACKUP_CONFIRMED',sourceCells:[{sheet:'Synthetic',address:'A1',value:1}]});
 assert.equal((await repo.year('unit-a',2026)).length,0);
 await repo.save({unitId:'unit-a',year:2026,month:1,inputs:emptyInputs(),referenceDate:'2026-01-01',action:'IMPORT',importHash:hash});
 assert.equal((await repo.month('unit-a',2026,1)).importHash,hash);
 await assertFails(updateDoc(doc(dbFor('manager'),'qmentumUnits/unit-a/imports',hash),{status:'OVERRIDE'}));
});
