import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {getChecklistDayResponsible} from '../src/checklist-responsibility-projection.js';

const files = ['Config.gs', 'ChecklistValidation.gs', 'ChecklistProjection.gs', 'EvaluationLedger.gs'];
const source = files.map(file => readFileSync(new URL(`../apps-script-v2/${file}`, import.meta.url), 'utf8')).join('\n');
const plain = value => JSON.parse(JSON.stringify(value));
const profile = (uid, extra = {}) => ({uid, active:true, access:true, role:'usuario', permissions:{checklistSign:true}, displayName:`Pessoa ${uid}`, email:`${uid}@example.invalid`, ...extra});
const base = (extra = {}) => ({uid:'person-a', category:'PERFORMANCE', modality:'ACKNOWLEDGEMENT', creditScopeId:'matter', activityId:'form-fixture', areaId:'area-fixture', version:1, points:1, sourceFingerprint:'source-1', sourceType:'FORM_VERIFIED', sourceId:'response-fixture', ...extra});
function acceptedSignature(h,day,responsibleUid,signerUid) {
  const snapshot={date:day,responsibleUid,entries:[]},revision=h.ctx.sha256Hex_(JSON.stringify(snapshot)),id=`${day}_${revision}`;
  h.seed('checklistSignatures',id,{id,date:day,revision,declaration:true,signedAt:new Date(),responsibleUid,signerUid,snapshot});return id;
}

function harness({activated = true} = {}) {
  const store = new Map(), transactions = new Map(), commits = [], requests = [];
  let counter = 0, beforeCommit;
  const properties = new Map([['SAHMT_V2_EVALUATION_ALLOWED_EMAILS','operator@example.invalid']]);
  const ctx = vm.createContext({Date, Map, Set, JSON, Number, Object, Array, String, RegExp, Error, console,
    encodeURIComponent, Session:{getEffectiveUser:()=>({getEmail:()=> 'operator@example.invalid'})},
    Utilities:{DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},computeDigest:(_algorithm,text)=>Array.from(createHash('sha256').update(text).digest()),
      formatDate:()=>'2026-10-03'}, PropertiesService:{getScriptProperties:()=>({getProperty:key=>properties.get(key)||null})}});
  vm.runInContext(source, ctx);
  ctx.sahmtV2Properties_ = () => ({getProperty:key=>properties.get(key)||null});
  const name = (collection,id) => ctx.firestoreDocumentName_(collection,id);
  function seed(collection,id,data) { const doc = {name:name(collection,id), fields:plain(ctx.firestoreFieldsFromJs_(data)), updateTime:`v${++counter}`, createTime:`v${counter}`}; store.set(doc.name,doc); return doc; }
  function data(collection,id) { const item=store.get(name(collection,id)); return item ? plain(ctx.firestoreFieldsToJs_(item.fields)) : null; }
  function get(collection,id) { const doc=store.get(name(collection,id)); return doc ? ctx.evaluationDocument_(doc) : null; }
  function value(fields, field) { let result=ctx.firestoreFieldsToJs_(fields); for(const part of field.split('.')) result=result?.[part]; return result; }
  function queryFilter(doc, filter) {
    if (filter.compositeFilter) return filter.compositeFilter.filters.every(item=>queryFilter(doc,item));
    const field=filter.fieldFilter, current=value(doc.fields,field.field.fieldPath), target=ctx.firestoreValueToJs_(field.value);
    return field.op==='EQUAL' ? current===target : field.op==='LESS_THAN_OR_EQUAL' ? current<=target : field.op==='GREATER_THAN_OR_EQUAL' ? current>=target : false;
  }
  function track(tx,docName) { if(tx) transactions.get(tx).reads.set(docName,transactions.get(tx).snapshot.get(docName)?.updateTime || null); }
  ctx.firestoreRequest_ = (url, options={}) => {
    const body=options.payload ? JSON.parse(options.payload) : {}; requests.push({url,body});
    if (url.endsWith(':beginTransaction')) { const transaction=`tx${++counter}`; transactions.set(transaction,{snapshot:new Map(Array.from(store,([key,item])=>[key,plain(item)])),reads:new Map()}); return {transaction}; }
    if (url.endsWith(':rollback')) { transactions.delete(body.transaction); return {}; }
    if (url.endsWith(':batchGet')) return body.documents.map(docName=>{track(body.transaction,docName);const doc=transactions.get(body.transaction).snapshot.get(docName);return doc ? {found:plain(doc)} : {missing:docName};});
    if (url.endsWith(':runQuery')) {
      const query=body.structuredQuery, prefix=name(query.from[0].collectionId,'');
      const db=body.transaction ? transactions.get(body.transaction).snapshot : store;
      let docs=Array.from(db.values()).filter(doc=>doc.name.startsWith(prefix) && (!query.where || queryFilter(doc,query.where)));
      if(query.orderBy) docs.sort((a,b)=>{for(const order of query.orderBy) { const av=value(a.fields,order.field.fieldPath),bv=value(b.fields,order.field.fieldPath); const compare=av>bv?1:av<bv?-1:0;if(compare) return order.direction==='DESCENDING' ? -compare : compare; } return a.name.localeCompare(b.name);});
      docs=docs.slice(0,query.limit); docs.forEach(doc=>track(body.transaction,doc.name));
      return docs.map(doc=>({document:plain(doc)}));
    }
    if (url.endsWith(':commit')) {
      if(beforeCommit) {const callback=beforeCommit;beforeCommit=null;callback(body);}
      const tx=body.transaction && transactions.get(body.transaction);
      if(tx) for(const [docName,version] of tx.reads) if((store.get(docName)?.updateTime || null)!==version) throw Object.assign(new Error('ABORTED'),{status:409});
      for(const write of body.writes) { const current=store.get(write.update.name),condition=write.currentDocument;
        if(condition?.exists===false && current || condition?.updateTime && current?.updateTime!==condition.updateTime) throw Object.assign(new Error('CAS failed'),{status:409});
      }
      for(const write of body.writes) {
        const previous=store.get(write.update.name), fields=write.updateMask ? {...(previous?.fields||{})} : {};
        if(write.updateMask) for(const field of write.updateMask.fieldPaths) { if(write.update.fields[field])fields[field]=write.update.fields[field];else delete fields[field]; }
        else Object.assign(fields,write.update.fields);
        for(const transform of write.updateTransforms || []) fields[transform.fieldPath]={timestampValue:'2026-10-03T12:00:00.000Z'};
        store.set(write.update.name,{name:write.update.name,fields:plain(fields),updateTime:`v${++counter}`,createTime:previous?.createTime || `v${counter}`});
      }
      commits.push(body); transactions.delete(body.transaction); return {commitTime:'2026-10-03T12:00:00.000Z'};
    }
    const matched=/\/documents\/([^/?]+)\/([^/?]+)/.exec(url);
    if(matched) {const doc=store.get(name(decodeURIComponent(matched[1]),decodeURIComponent(matched[2])));if(!doc)throw Object.assign(new Error('missing'),{status:404});return plain(doc);}
    throw new Error(`Unexpected mock request ${url}`);
  };
  if (activated) {
    properties.set('SAHMT_V2_EVALUATION_ENABLED','true'); properties.set('SAHMT_V2_EVALUATION_HOMOLOGATED','true');
    seed('evaluationRuntime','state',{homologationVerified:true});
  }
  return {ctx,seed,data,get,store,commits,requests,properties,values:collection=>Array.from(store.values()).filter(doc=>doc.name.startsWith(name(collection,''))).map(doc=>plain(ctx.firestoreFieldsToJs_(doc.fields))),beforeCommit:callback=>{beforeCommit=callback;}};
}

test('modalidades têm regras fixas e categorias não podem ser trocadas', () => {
  const {ctx}=harness();
  for(const [category,modality,points] of [['PERFORMANCE','ACKNOWLEDGEMENT',1],['PERFORMANCE','SUGGESTION',2],['GOVERNANCE','MATERIAL',1],['GOVERNANCE','QUESTIONS',1]]) {
    const plan=ctx.evaluationPlanAward_(null,base({category,modality,points}));assert.equal(plan.ledger.points,points);
    assert.throws(()=>ctx.evaluationPlanAward_(null,base({category,modality,points:points+1})));
  }
  assert.throws(()=>ctx.evaluationPlanAward_(null,base({category:'GOVERNANCE',modality:'TEST'})));
  assert.throws(()=>ctx.evaluationPlanAward_(null,base({modality:'TEST',points:2,maxTestScore:1})));
  assert.throws(()=>ctx.evaluationPlanAward_(null,base({modality:'TEST',points:2})));
  const previous=ctx.evaluationPlanAward_(null,base()).award;
  assert.throws(()=>ctx.evaluationPlanAward_(previous,base({category:'GOVERNANCE',modality:'MATERIAL'})),/identidade/);
});

test('reruns geram um só crédito; ID canônico não depende de área/alias de Form', () => {
  const h=harness();h.seed('users','person-a',profile('person-a'));
  const first=h.ctx.applyEvaluationAwardDesired_(base());const again=h.ctx.applyEvaluationAwardDesired_(base({areaId:'another-area'}));
  assert.equal(first.status,'APPLIED');assert.equal(again.status,'DUPLICATE');assert.equal(h.values('evaluationLedger').length,1);
  assert.equal(h.ctx.evaluationAwardId_(base()),h.ctx.evaluationAwardId_(base({areaId:'other',activityId:'same-form-other-link'})));
  assert.notEqual(h.ctx.evaluationAwardId_(base()),h.ctx.evaluationAwardId_(base({version:2})));
});

test('correção zero preserva original, delta, versão e override contra reconciliação', () => {
  const h=harness();h.seed('users','person-a',profile('person-a'));h.seed('users','admin',profile('admin',{role:'administrador_app'}));
  const first=h.ctx.applyEvaluationAwardDesired_(base());
  h.seed('evaluationRequests','correction',{id:'correction',type:'CORRECT_SCORE',status:'PENDING',actorUid:'admin',payload:{awardId:first.awardId,category:'PERFORMANCE',expectedAwardVersion:1,correctedPoints:0,reason:'Correção de evidência fictícia'}});
  h.ctx.evaluationProcessScoreCorrection_({id:'correction'});
  const award=h.data('evaluationAwards',first.awardId); assert.equal(award.points,0);assert.equal(award.originalPoints,1);assert.equal(award.adminOverride,true);
  assert.deepEqual(h.values('evaluationLedger').map(entry=>entry.points),[1,-1]);
  assert.equal(h.ctx.applyEvaluationAwardDesired_(base()).status,'NEEDS_REVIEW');assert.equal(h.data('evaluationAwards',first.awardId).points,0);
  assert.equal(h.ctx.evaluationProcessScoreCorrection_({id:'correction'}).status,'DUPLICATE');
});

test('gestor comum, categoria divergente e versão antiga não corrigem', () => {
  for(const invalid of ['manager','category','version']) {
    const h=harness();h.seed('users','person-a',profile('person-a'));h.seed('users','actor',profile('actor',{role:invalid==='manager'?'gestor':'administrador_app',permissions:{managementManage:true}}));
    const first=h.ctx.applyEvaluationAwardDesired_(base());
    h.seed('evaluationRequests','bad',{id:'bad',type:'CORRECT_SCORE',status:'PENDING',actorUid:'actor',payload:{awardId:first.awardId,category:invalid==='category'?'GOVERNANCE':'PERFORMANCE',expectedAwardVersion:invalid==='version'?9:1,correctedPoints:0,reason:'Solicitação fictícia de correção'}});
    assert.throws(()=>h.ctx.evaluationProcessScoreCorrection_({id:'bad'}));assert.equal(h.values('evaluationLedger').length,1);
  }
});

test('própria assinatura aceita gera zero; substituto gera -1/+1 mesmo incompleto', () => {
  for(const own of [true,false]) {
    const h=harness();h.seed('users','person-a',profile('person-a'));h.seed('users','person-b',profile('person-b'));
    h.ctx.evaluationApplyChecklistTransfer_('2026-10-03','person-a',own?'person-a':'person-b','accepted-incomplete');
    assert.deepEqual(h.values('evaluationAwards').map(item=>item.points).sort(),own?[0]:[-1,1]);
    assert.equal(h.values('evaluationLedger').reduce((sum,row)=>sum+row.points,0),0);
    h.ctx.evaluationApplyChecklistTransfer_('2026-10-03','person-a','person-b','another-accepted-revision');
    assert.equal(h.values('evaluationLedger').length,own?1:2);
  }
});

test('correção Checklist é pareada, zero estorna ambos e reaplicação não duplica', () => {
  const h=harness();for(const uid of ['person-a','person-b'])h.seed('users',uid,profile(uid));h.seed('users','admin',profile('admin',{role:'administrador_app'}));
  h.ctx.evaluationApplyChecklistTransfer_('2026-10-03','person-a','person-b','signature-1');
  const credit=h.values('evaluationAwards').find(item=>item.leg==='CREDIT');
  h.seed('evaluationRequests','pair-zero',{id:'pair-zero',type:'CORRECT_SCORE',status:'PENDING',actorUid:'admin',payload:{awardId:credit.id,category:'PERFORMANCE',expectedAwardVersion:credit.awardVersion,correctedPoints:0,reason:'Estorno pareado autorizado fictício'}});
  h.ctx.evaluationProcessScoreCorrection_({id:'pair-zero'});
  assert.deepEqual(h.values('evaluationAwards').map(row=>row.points),[0,0]);assert.equal(h.values('evaluationLedger').length,4);
  assert.equal(h.values('evaluationLedger').reduce((sum,row)=>sum+row.points,0),0);
  assert.equal(h.ctx.evaluationApplyChecklistTransfer_('2026-10-03','person-a','person-b','signature-new').status,'DUPLICATE');
  assert.equal(h.values('evaluationLedger').length,4);
});

test('realocação responsável/assinatura estorna pessoas antigas e credita par novo', () => {
  const h=harness();for(const uid of ['person-a','person-b','person-c'])h.seed('users',uid,profile(uid));h.seed('users','admin',profile('admin',{role:'administrador_app'}));
  h.ctx.evaluationApplyChecklistTransfer_('2026-10-03','person-a','person-b','signature-1');
  const acceptedId=acceptedSignature(h,'2026-10-03','person-c','person-a');
  h.ctx.evaluationCorrectChecklistSignature_('2026-10-03',acceptedId,1,'Responsável revalidado por assinatura aceita','admin');
  const points=Object.fromEntries(h.values('evaluationAwards').map(row=>[row.uid,row.points]));
  assert.deepEqual(points,{'person-a':1,'person-b':0,'person-c':-1});assert.equal(h.values('evaluationLedger').reduce((sum,row)=>sum+row.points,0),0);
  assert.throws(()=>h.ctx.evaluationCorrectChecklistSignature_('2026-10-03',acceptedId,1,'Versão antiga deve falhar','admin'));
});

test('concessão/correção/estorno Governança nunca alteram Performance nem referência máxima', () => {
  const h=harness();h.seed('users','person-a',profile('person-a'));h.seed('users','admin',profile('admin',{role:'administrador_app'}));
  h.ctx.applyEvaluationAwardDesired_(base());h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');
  const beforeRef=h.data('evaluationReference','team'),beforeSummary=h.data('evaluationSummaries','person-a'),beforeRuntime=h.data('evaluationRuntime','state');
  const governance=base({category:'GOVERNANCE',modality:'MATERIAL',creditScopeId:'revision-fixture'}),grant=h.ctx.applyEvaluationAwardDesired_(governance);
  h.ctx.evaluationPublishCategorySummary_('GOVERNANCE');
  h.seed('evaluationRequests','gov-zero',{id:'gov-zero',type:'CORRECT_SCORE',status:'PENDING',actorUid:'admin',payload:{awardId:grant.awardId,category:'GOVERNANCE',expectedAwardVersion:1,correctedPoints:0,reason:'Revisão de governança sem evidência suficiente'}});
  h.ctx.evaluationProcessScoreCorrection_({id:'gov-zero'});h.ctx.evaluationPublishCategorySummary_('GOVERNANCE');
  const afterRef=h.data('evaluationReference','team'),afterSummary=h.data('evaluationSummaries','person-a'),afterRuntime=h.data('evaluationRuntime','state');
  for(const key of ['maxPerformance','eligibleCount','allZero','performanceRevision','performanceStatus'])assert.equal(afterRef[key],beforeRef[key],key);
  for(const key of ['performanceTotal','performanceCount','performanceRevision'])assert.equal(afterSummary[key],beforeSummary[key],key);
  for(const key of ['performanceRevision','performanceDirty'])assert.equal(afterRuntime[key],beforeRuntime[key],key);
  assert.equal(afterSummary.governanceTotal,0);
  const govWrites=h.commits.flatMap(commit=>commit.writes).filter(write=>write.updateMask?.fieldPaths.includes('governanceTotal'));
  assert.ok(govWrites.every(write=>!write.updateMask.fieldPaths.some(field=>field.startsWith('performance'))));
});

test('máximo usa somente elegíveis, saldos negativos preservados e legado não entra', () => {
  const h=harness();for(const uid of ['person-a','person-b','inactive'])h.seed('users',uid,profile(uid,{active:uid!=='inactive'}));
  h.seed('scores','historical',{uid:'person-a',points:900});h.seed('evaluationAwards','a',{uid:'person-a',category:'PERFORMANCE',points:-1});h.seed('evaluationAwards','b',{uid:'person-b',category:'PERFORMANCE',points:5});h.seed('evaluationAwards','c',{uid:'inactive',category:'PERFORMANCE',points:999});
  h.seed('evaluationRuntime','state',{performanceRevision:7,performanceDirty:true});h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');
  assert.equal(h.data('evaluationSummaries','person-a').performanceTotal,-1);assert.equal(h.data('evaluationReference','team').maxPerformance,5);
  assert.equal(h.data('evaluationReference','team').eligibleCount,2);assert.equal(h.data('scores','historical').points,900);
  assert.ok(!JSON.stringify(h.data('evaluationReference','team')).includes('person-'));
});

test('max sem referência positiva, zero verdadeiro e estado ausente são diferentes', () => {
  const {ctx}=harness();const people=[profile('a'),profile('b')];
  assert.equal(ctx.evaluationSummarizeCategory_('PERFORMANCE',people,[]).allZero,true);
  const negative=ctx.evaluationSummarizeCategory_('PERFORMANCE',people,[{uid:'a',category:'PERFORMANCE',points:-1},{uid:'b',category:'PERFORMANCE',points:-2}]);assert.equal(negative.maxPerformance,-1);assert.equal(negative.allZero,false);
  assert.equal(ctx.evaluationSummarizeCategory_('PERFORMANCE',[],[]).maxPerformance,null);
  assert.equal(Object.hasOwn(ctx.evaluationSummarizeCategory_('GOVERNANCE',people,[]),'maxPerformance'),false);
});

test('CAS reexecuta corrida sem duplicar; todos resumos/referência publicados no mesmo commit', () => {
  const h=harness();h.seed('users','person-a',profile('person-a'));h.seed('users','person-b',profile('person-b'));
  h.beforeCommit(()=>h.seed('users','person-a',profile('person-a',{displayName:'Nome atualizado fictício'})));
  h.ctx.applyEvaluationAwardDesired_(base());assert.equal(h.values('evaluationLedger').length,1);
  assert.ok(h.requests.filter(item=>item.url.endsWith(':beginTransaction')).length>=2);
  h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');const writes=h.commits.at(-1).writes;
  assert.equal(writes.filter(write=>write.update.name.includes('/evaluationSummaries/')).length,2);
  assert.equal(writes.filter(write=>write.update.name.endsWith('/evaluationReference/team')).length,1);
  assert.ok(writes.every(write=>write.currentDocument));assert.ok(writes.some(write=>write.updateTransforms?.some(transform=>transform.fieldPath==='confirmedAt')));
});

test('recálculo truncado permanece pendente, sem publicação parcial de resumos', () => {
  const h=harness();for(let index=0;index<401;index++)h.seed('users',`user-${index}`,profile(`user-${index}`));
  h.seed('evaluationRuntime','state',{performanceRevision:1});h.seed('evaluationReference','team',{performanceStatus:'CONFIRMED',maxPerformance:9});
  const result=h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');assert.equal(result.status,'PENDING');assert.equal(h.values('evaluationSummaries').length,0);
  assert.equal(h.data('evaluationReference','team').performanceStatus,'PENDING');assert.equal(h.data('evaluationReference','team').maxPerformance,9);
});

test('operador e instalação exigem allowlist/homologação; testes não ativam serviços', () => {
  const h=harness();h.properties.clear();assert.throws(()=>h.ctx.evaluationAssertOperator_(false),/autorizado/);
  h.properties.set('SAHMT_V2_EVALUATION_ALLOWED_EMAILS','operator@example.invalid');assert.throws(()=>h.ctx.evaluationAssertOperator_(true),/homologação/);
  h.properties.set('SAHMT_V2_EVALUATION_ENABLED','true');h.properties.set('SAHMT_V2_EVALUATION_HOMOLOGATED','true');h.seed('evaluationRuntime','state',{homologationVerified:true});
  assert.equal(h.ctx.evaluationAssertOperator_(true),'operator@example.invalid');
});

test('usuário comum lê somente projeção Spark confiável; ausente/pendente/dia divergente bloqueiam', async () => {
  const day='2026-10-03',projection={day,status:'CONFIRMED',fingerprint:'a'.repeat(64),revision:'b'.repeat(64),responsible:{uid:'person-a',name:'Pessoa fictícia',sigla:'AA',position:1}};
  const sources={responsibilityProjection:async()=>projection,listEventRecords:()=>{throw new Error('Eventos amplos proibidos');},remotePreview:()=>{throw new Error('Functions proibidas');}};
  assert.equal((await getChecklistDayResponsible({day,uid:'person-a'},sources)).responsibleUid,'person-a');
  for(const value of [null,{...projection,status:'NEEDS_REVIEW'},{...projection,day:'2026-10-02'},{...projection,fingerprint:''}])await assert.rejects(getChecklistDayResponsible({day,uid:'person-a'},{...sources,responsibilityProjection:async()=>value}));
  await assert.rejects(getChecklistDayResponsible({day:'2026-02-30',uid:'person-a'},sources));
  const reader=readFileSync(new URL('../src/checklist-responsibility-projection.js',import.meta.url),'utf8');assert.doesNotMatch(reader,/firebase\/functions|httpsCallable/);
});

function checklistFixture({complete=false,own=false,activated=true}={}) {
  const h=harness({activated}),day='2026-10-03',signerUid=own?'person-a':'person-b';
  h.seed('users','person-a',profile('person-a',{sigla:'AA'}));h.seed('users','person-b',profile('person-b',{sigla:'BB'}));
  h.seed('scheduleDays',day,{positions:['AA','BB']});
  h.seed('contacts','AA',{active:true,sigla:'AA',name:'Pessoa person-a',email:'person-a@example.invalid'});
  h.seed('contacts','BB',{active:true,sigla:'BB',name:'Pessoa person-b',email:'person-b@example.invalid'});
  h.seed('stations','station-fixture',{active:true,order:1,name:'Arsenal fictício'});
  if(complete)h.seed('checklists','response-fixture',{date:day,stationId:'station-fixture',condition:'SIM',occurrence:'',createdAt:new Date('2026-10-03T09:00:00Z')});
  const snapshot=h.ctx.readTrustedChecklistSnapshot_(day);
  const id=`${day}_${snapshot.fingerprint}_${signerUid}`;
  h.seed('checklistSignatureRequests',id,{id,day,revision:snapshot.fingerprint,signerUid,declaration:true,status:'PENDING_VALIDATION',justification:'Revisão fictícia controlada do Checklist',requestedAt:new Date('2026-10-03T10:00:00Z')});
  return {...h,day,id,signerUid,snapshot};
}

test('validador real aceita assinatura própria completa com zero e substituta incompleta com par', () => {
  for(const input of [{complete:true,own:true},{complete:false,own:false}]) {
    const h=checklistFixture(input);
    const result=h.ctx.validateChecklistSignatureRequest_(h.get('checklistSignatureRequests',h.id));assert.equal(result,'VALIDATED');
    assert.equal(h.values('checklistSignatures').length,1);assert.equal(h.values('scores').length,0);
    assert.equal(h.data('checklistSignatureRequests',h.id).pointsAwarded,input.own?0:1);
    assert.equal(h.data('checklistSignatures',`${h.day}_${h.snapshot.revision}`).missing,input.complete?0:1);
    assert.equal(h.data('checklistResponsibilities',h.day).responsible.uid,'person-a');
    const commit=h.commits.at(-1);
    for(const collection of ['checklistSignatures','checklistSignatureRequests','evaluationAwards','evaluationLedger','evaluationChecklistTransfers','checklistResponsibilities'])assert.ok(commit.writes.some(write=>write.update.name.includes(`/${collection}/`)),collection);
    assert.ok(commit.writes.filter(write=>write.update.name.includes('/checklistSignatures/')).every(write=>write.updateTransforms.some(transform=>transform.fieldPath==='signedAt')));
  }
});

test('pendente não pontua; pedido recusado/desatualizado não grava assinatura ou ledger', () => {
  for(const scenario of ['pending','revoked','stale','unknown-responsible']) {
    const h=checklistFixture();
    if(scenario==='pending') {assert.equal(h.values('evaluationLedger').length,0);continue;}
    if(scenario==='revoked')h.seed('users','person-b',profile('person-b',{sigla:'BB',active:false}));
    if(scenario==='stale')h.seed('checklists','late-response',{date:h.day,stationId:'station-fixture',condition:'NAO',occurrence:'Teste fictício',createdAt:new Date('2026-10-03T11:00:00Z')});
    if(scenario==='unknown-responsible')h.seed('users','ambiguous',profile('ambiguous',{sigla:'AA'}));
    const outcome=h.ctx.validateChecklistSignatureRequest_(h.get('checklistSignatureRequests',h.id));
    assert.equal(outcome,scenario==='revoked'?'REJECTED':scenario==='stale'?'STALE':'NEEDS_REVIEW');
    assert.equal(h.values('checklistSignatures').length,0);assert.equal(h.values('evaluationLedger').length,0);
  }
});

test('nova revisão aceita no mesmo dia não repete transferência de obrigação diária', () => {
  const h=checklistFixture();h.ctx.validateChecklistSignatureRequest_(h.get('checklistSignatureRequests',h.id));
  h.seed('checklists','second-response',{date:h.day,stationId:'station-fixture',condition:'SIM',occurrence:'',createdAt:new Date('2026-10-03T11:00:00Z')});
  const snapshot=h.ctx.readTrustedChecklistSnapshot_(h.day),id=`${h.day}_${snapshot.fingerprint}_person-a`;
  h.seed('checklistSignatureRequests',id,{id,day:h.day,revision:snapshot.fingerprint,signerUid:'person-a',declaration:true,status:'PENDING_VALIDATION',justification:'Segunda revisão fictícia aceita'});
  assert.equal(h.ctx.validateChecklistSignatureRequest_(h.get('checklistSignatureRequests',id)),'VALIDATED');
  assert.equal(h.values('checklistSignatures').length,2);assert.equal(h.values('evaluationLedger').length,2);
  assert.equal(h.data('checklistSignatureRequests',id).pointsAwarded,0);assert.equal(h.data('checklistSignatureRequests',id).evaluationStatus,'DUPLICATE');
});

test('revogação enquanto o validador trabalha aborta commit e revalida acesso atual', () => {
  const h=checklistFixture();h.beforeCommit(()=>h.seed('users','person-b',profile('person-b',{sigla:'BB',access:false})));
  assert.equal(h.ctx.validateChecklistSignatureRequest_(h.get('checklistSignatureRequests',h.id)),'REJECTED');
  assert.equal(h.values('evaluationLedger').length,0);assert.equal(h.values('checklistSignatures').length,0);
});

test('par inconsistente nunca produz novo crédito silencioso', () => {
  const h=checklistFixture();h.ctx.validateChecklistSignatureRequest_(h.get('checklistSignatureRequests',h.id));
  const credit=h.values('evaluationAwards').find(item=>item.leg==='CREDIT');h.seed('evaluationAwards',credit.id,{...credit,points:7});
  h.seed('checklists','new-response',{date:h.day,stationId:'station-fixture',condition:'SIM',occurrence:'',createdAt:new Date('2026-10-03T11:00:00Z')});
  const snapshot=h.ctx.readTrustedChecklistSnapshot_(h.day),id=`${h.day}_${snapshot.fingerprint}_person-a`;
  h.seed('checklistSignatureRequests',id,{id,day:h.day,revision:snapshot.fingerprint,signerUid:'person-a',declaration:true,status:'PENDING_VALIDATION',justification:'Estado inconsistente fictício'});
  assert.equal(h.ctx.validateChecklistSignatureRequest_(h.get('checklistSignatureRequests',id)),'NEEDS_REVIEW');assert.equal(h.values('evaluationLedger').length,2);
});

test('segundo componente de governança adiciona apenas ponto faltante', () => {
  const h=harness();h.seed('users','person-a',profile('person-a'));
  h.ctx.applyEvaluationAwardDesired_(base({category:'GOVERNANCE',modality:'MATERIAL',creditScopeId:'revision-1'}));
  h.ctx.evaluationApplyAwards_([base({category:'GOVERNANCE',modality:'MATERIAL',creditScopeId:'revision-1'}),base({category:'GOVERNANCE',modality:'QUESTIONS',creditScopeId:'revision-1'})]);
  assert.deepEqual(h.values('evaluationLedger').map(row=>row.points),[1,1]);
  h.ctx.evaluationPublishCategorySummary_('GOVERNANCE');assert.equal(h.data('evaluationSummaries','person-a').governanceTotal,2);
  assert.equal(Object.hasOwn(h.data('evaluationReference','team'),'maxPerformance'),false);
});

test('estorno administrativo conserva histórico de pessoa que perdeu acesso', () => {
  const h=harness();for(const uid of ['person-a','person-b','person-c'])h.seed('users',uid,profile(uid));h.seed('users','admin',profile('admin',{role:'administrador_app'}));
  h.ctx.evaluationApplyChecklistTransfer_('2026-10-03','person-a','person-b','signature-1');h.seed('users','person-b',profile('person-b',{active:false}));
  const acceptedId=acceptedSignature(h,'2026-10-03','person-c','person-a');
  h.ctx.evaluationCorrectChecklistSignature_('2026-10-03',acceptedId,1,'Correção preserva estorno histórico de pessoa inativa','admin');
  assert.equal(h.values('evaluationAwards').find(row=>row.uid==='person-b').points,0);assert.equal(h.values('evaluationLedger').reduce((sum,row)=>sum+row.points,0),0);
});

test('resumo inalterado não relê awards; mudança de elegibilidade recalcula referência', () => {
  const h=harness();for(const uid of ['person-a','person-b'])h.seed('users',uid,profile(uid));
  h.ctx.applyEvaluationAwardDesired_(base());h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');
  const start=h.requests.length;assert.equal(h.ctx.evaluationPublishCategorySummary_('PERFORMANCE').status,'DUPLICATE');
  assert.equal(h.requests.slice(start).filter(item=>item.body.structuredQuery?.from[0].collectionId==='evaluationAwards').length,0);
  assert.equal(h.commits.at(-1).writes.length,0);
  h.seed('users','person-a',profile('person-a',{active:false}));
  const changed=h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');assert.equal(changed.status,'CONFIRMED');
  assert.equal(changed.revision,2);assert.equal(h.data('evaluationReference','team').eligibleCount,1);assert.equal(h.data('evaluationReference','team').maxPerformance,0);
});

test('perfil UID incoerente deixa referência pendente em vez de inventar elegibilidade', () => {
  const h=harness();h.seed('users','person-a',profile('different-uid'));h.seed('evaluationRuntime','state',{performanceRevision:1});
  assert.equal(h.ctx.evaluationPublishCategorySummary_('PERFORMANCE').status,'PENDING');assert.equal(h.values('evaluationSummaries').length,0);
  assert.match(h.data('evaluationReference','team').performanceReason,/UID/);
});

test('preparação manual permitida gera projeção antes da primeira assinatura, sem ativar ledger', () => {
  const h=checklistFixture({activated:false});assert.equal(h.properties.has('SAHMT_V2_EVALUATION_ENABLED'),false);
  const result=h.ctx.reconcileChecklistResponsibilities();assert.equal(result.current.status,'CONFIRMED');
  assert.equal(h.data('checklistResponsibilities',h.day).responsible.uid,'person-a');
  for(const collection of ['evaluationLedger','evaluationAwards','checklistSignatures'])assert.equal(h.values(collection).length,0);
  assert.ok(h.commits.every(commit=>commit.writes.every(write=>write.update.name.includes('/checklistResponsibilities/'))));
});

test('categoria vazia inicializa após homologação e confirma zero somente após leitura completa', () => {
  const h=harness();h.seed('users','person-a',profile('person-a'));
  h.ctx.applyEvaluationAwardDesired_(base());h.ctx.evaluationPublishCategorySummary_('PERFORMANCE');
  const performance=h.data('evaluationReference','team');
  assert.equal(Object.hasOwn(h.data('evaluationRuntime','state'),'governanceRevision'),false);
  assert.equal(h.ctx.evaluationPublishCategorySummary_('GOVERNANCE').status,'PENDING');
  assert.equal(h.ctx.initializeEvaluationCategoryState_('GOVERNANCE').status,'PENDING');
  assert.equal(Object.hasOwn(h.data('evaluationSummaries','person-a'),'governanceTotal'),false);
  assert.equal(h.ctx.evaluationPublishCategorySummary_('GOVERNANCE').status,'CONFIRMED');
  assert.equal(h.data('evaluationSummaries','person-a').governanceTotal,0);
  assert.equal(h.data('evaluationReference','team').governanceStatus,'CONFIRMED');
  assert.equal(h.data('evaluationReference','team').maxPerformance,performance.maxPerformance);
  assert.equal(h.data('evaluationReference','team').performanceRevision,performance.performanceRevision);
  assert.equal(h.ctx.initializeEvaluationCategoryState_('GOVERNANCE').status,'DUPLICATE');
});

test('pré-homologação não inicializa categoria nem processa crédito, transferência ou correção', () => {
  const h=harness({activated:false});h.seed('users','person-a',profile('person-a'));
  for(const operation of [
    ()=>h.ctx.initializeEvaluationCategoryState_('PERFORMANCE'),
    ()=>h.ctx.applyEvaluationAwardDesired_(base()),
    ()=>h.ctx.evaluationApplyChecklistTransfer_('2026-10-03','person-a','person-b','signature-fixture'),
    ()=>h.ctx.evaluationProcessScoreCorrection_({id:'pending-correction'}),
    ()=>h.ctx.evaluationCorrectChecklistSignature_('2026-10-03','signature-fixture',1,'Correção fictícia autorizada','admin')
  ]) assert.throws(operation,/homologação/);
  assert.equal(h.commits.length,0);
  assert.equal(h.values('evaluationAwards').length,0);
  assert.equal(h.values('evaluationLedger').length,0);
});

test('snapshot lido com mapas ordenados pelo Firestore preserva revisão/ID e detecta alteração real', () => {
  const h=harness(),day='2026-10-03';
  const snapshot={date:day,responsibleUid:'person-a',responsibleName:'Pessoa fictícia',responsibleEmail:'person-a@example.invalid',position:1,sigla:'AA',entries:[{stationId:'station-fixture',stationName:'Arsenal fictício',condition:'SIM',occurrence:'',responseId:'response-fixture',responseAt:123456789}]};
  const sortMaps=value=>Array.isArray(value)?value.map(sortMaps):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sortMaps(value[key])])):value;
  const revision=h.ctx.sha256Hex_(JSON.stringify(snapshot)),stored=sortMaps(snapshot);
  assert.notEqual(h.ctx.sha256Hex_(JSON.stringify(stored)),revision);
  assert.equal(h.ctx.checklistStoredSnapshotRevision_(stored),revision);
  assert.equal(h.ctx.checklistStoredSnapshotRevision_({...stored,unexpected:'untrusted'}),null);
  assert.equal(h.ctx.checklistStoredSnapshotRevision_({...stored,entries:[null]}),null);
  for(const uid of ['person-a','person-b'])h.seed('users',uid,profile(uid));h.seed('users','admin',profile('admin',{role:'administrador_app'}));
  h.ctx.evaluationApplyChecklistTransfer_(day,'person-a','person-b','initial-signature');
  const id=`${day}_${revision}`;
  h.seed('checklistSignatures',id,{id,date:day,revision,declaration:true,signedAt:new Date(),responsibleUid:'person-a',signerUid:'person-a',snapshot:stored});
  assert.equal(h.ctx.evaluationCorrectChecklistSignature_(day,id,1,'Assinatura válida reordenada pelo servidor','admin').status,'APPLIED');
  assert.equal(h.values('evaluationAwards').reduce((sum,item)=>sum+item.points,0),0);
  stored.entries[0].condition='NAO';h.seed('checklistSignatures',id,{id,date:day,revision,declaration:true,signedAt:new Date(),responsibleUid:'person-a',signerUid:'person-a',snapshot:stored});
  assert.throws(()=>h.ctx.evaluationCorrectChecklistSignature_(day,id,2,'Snapshot adulterado não pode ser aceito','admin'),/snapshot confiável/);
});

test('projeção ausente/incoerente fica explicitamente NEEDS_REVIEW sem eleger pessoa inventada', () => {
  const h=checklistFixture();h.store.delete(h.ctx.firestoreDocumentName_('scheduleDays',h.day));
  const result=h.ctx.reconcileChecklistResponsibilities();assert.equal(result.current.status,'NEEDS_REVIEW');
  assert.equal(h.data('checklistResponsibilities',h.day).responsible,null);assert.equal(h.values('evaluationLedger').length,0);
});

test('rollout preserva leitor operacional até homologação e não conecta projeção vazia', () => {
  const reader=readFileSync(new URL('../src/checklist-responsibility-reader.js',import.meta.url),'utf8');
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(reader,/remotePreview/);assert.doesNotMatch(reader,/checklistResponsibilities/);
  assert.doesNotMatch(main,/checklist-responsibility-projection/);
});
