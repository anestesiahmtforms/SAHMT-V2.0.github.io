import test from 'node:test';import assert from 'node:assert/strict';
import {harness} from './evaluation-fb-harness.js';
const ID='12345678-1234-1234-1234-123456789abc';
function setup({anonymous=false}={}) {
 const h=harness();h.properties.set('SAHMT_V2_OCCURRENCE_SCORING_ENABLED','true');const createdAt=new Date('2026-10-03T12:00:00Z');
 h.seed('evaluationRuntime','state',{homologationVerified:false,occurrenceScoringApproved:true,performanceRevision:0,performanceDirty:true});
 h.seed('users','fixture',{uid:'fixture',active:true,access:true});
 h.seed('occurrenceReports',ID,{schemaVersion:1,id:ID,formId:'F03',anonymous,pointsClaimed:2,pointsStatus:'PENDING_VALIDATION',createdAt,description:'NARRATIVE_NOT_TO_COPY'});
 h.seed('occurrenceAudit',ID,{schemaVersion:1,reportId:ID,uid:'fixture',formId:'F03',anonymous,createdAt});
 h.seed('occurrenceScoreClaims',ID,{schemaVersion:1,id:ID,source:'REGISTRO_OCORRENCIA',sourceId:ID,uid:'fixture',formId:'F03',points:2,status:'PENDING_VALIDATION',createdAt});return h;
}
test('FC produces exactly two points in FB and keeps original reports in FC',()=>{
 const h=setup();h.ctx.evaluationDeliverOccurrence_(ID,'fixture');h.ctx.evaluationDeliverOccurrence_(ID,'fixture');
 assert.deepEqual(h.values('evaluationLedger').map(x=>x.points),[2]);assert.equal(h.values('evaluationSourceReceipts').length,1);
 assert.equal(h.data('occurrenceScoreClaims',ID).status,'VALIDATED');assert.equal(h.data('occurrenceReports',ID).pointsStatus,'VALIDATED');
 assert.equal(h.data('evaluationSummaries','fixture').performanceTotal,2);
 assert.equal(h.data('evaluationReference','team').performanceStatus,'CONFIRMED');
 assert.equal(h.data('occurrenceReports',ID).description,'NARRATIVE_NOT_TO_COPY');
 assert.ok([...h.store].filter(([p])=>p.includes('/sahmt-gestao-5ae66/')).every(([,d])=>!JSON.stringify(d).includes('NARRATIVE_NOT_TO_COPY')));
 const reads=h.requests.filter(r=>r.body.documents?.some(p=>p.includes('/occurrenceReports/')));assert.ok(reads.every(r=>r.body.mask && !r.body.mask.fieldPaths.includes('description')));
});
test('anonymous occurrence retains its label/privacy and same private two-point credit',()=>{
 const h=setup({anonymous:true});h.ctx.evaluationDeliverOccurrence_(ID);assert.equal(h.values('evaluationAwards')[0].points,2);assert.equal(h.data('occurrenceReports',ID).anonymous,true);
 assert.equal('uid' in h.data('occurrenceReports',ID),false);
});
test('no scoring when flag is off',()=>{const h=setup();h.properties.delete('SAHMT_V2_OCCURRENCE_SCORING_ENABLED');const before=h.requests.length;assert.throws(()=>h.ctx.evaluationDeliverOccurrence_(ID),/DISABLED/);assert.equal(h.requests.length,before);});
test('occurrence approval is independent of general Forms activation and fails closed without marker',()=>{
 const h=setup();h.properties.delete('SAHMT_V2_EVALUATION_ENABLED');h.properties.delete('SAHMT_V2_EVALUATION_HOMOLOGATED');
 h.ctx.evaluationDeliverOccurrence_(ID);assert.equal(h.values('evaluationLedger').length,1);
 const denied=setup();denied.seed('evaluationRuntime','state',{homologationVerified:true,performanceRevision:0});
 assert.throws(()=>denied.ctx.evaluationDeliverOccurrence_(ID),/NOT_APPROVED/);assert.equal(denied.values('evaluationLedger').length,0);
});
test('forged amount, owner, pairing or timestamps cannot generate a credit',()=>{
 for(const [collection,patch] of [['occurrenceScoreClaims',{points:20}],['occurrenceAudit',{uid:'other'}],['occurrenceReports',{formId:'F10'}],['occurrenceAudit',{createdAt:new Date('2026-10-03T11:00:00Z')}],['users',{active:false}]]){
  const h=setup(),id=collection==='users'?'fixture':ID;h.seed(collection,id,{...h.get(collection,id),...patch});assert.throws(()=>h.ctx.evaluationDeliverOccurrence_(ID));assert.equal(h.values('evaluationLedger').length,0);
 }
});
test('notification cannot credit another author',()=>{const h=setup();assert.throws(()=>h.ctx.evaluationDeliverOccurrence_(ID,'other'),/AUTHOR_MISMATCH/);assert.equal(h.values('evaluationLedger').length,0);});
test('FC acknowledgement failure recovers from existing FB receipt',()=>{
 const h=setup(),original=h.ctx.firestoreRequest_;let failed=false;
 h.ctx.firestoreRequest_=(url,o)=>{const b=JSON.parse(o?.payload||'{}');if(!failed&&url.includes('/indicadores---sahmt/')&&url.endsWith(':commit')&&b.writes?.length){failed=true;throw Error('network');}return original(url,o);};
 assert.throws(()=>h.ctx.evaluationDeliverOccurrence_(ID));assert.equal(h.values('evaluationLedger').length,1);assert.equal(h.data('occurrenceScoreClaims',ID).status,'PENDING_VALIDATION');
 h.ctx.evaluationDeliverOccurrence_(ID);assert.equal(h.values('evaluationLedger').length,1);assert.equal(h.data('occurrenceScoreClaims',ID).status,'VALIDATED');
});
test('FA scoring outage never removes the FC occurrence or creates a confirmed claim',()=>{
 const h=setup(),original=h.ctx.firestoreRequest_;h.ctx.firestoreRequest_=(url,o)=>{if(url.includes('/sahmt-17a16/'))throw Error('unavailable');return original(url,o);};
 assert.throws(()=>h.ctx.evaluationDeliverOccurrence_(ID));assert.equal(h.data('occurrenceReports',ID).pointsStatus,'PENDING_VALIDATION');assert.equal(h.values('evaluationLedger').length,0);
});
test('recovery is bounded, only queries pending claims and does not scan reports',()=>{
 const h=setup();assert.equal(h.ctx.recuperarPontuacoesOcorrenciasFbV1().delivered,1);assert.equal(h.ctx.recuperarPontuacoesOcorrenciasFbV1().delivered,0);
 const queries=h.requests.filter(r=>r.body.structuredQuery && r.url.includes('/indicadores---sahmt/'));assert.ok(queries.every(r=>r.body.structuredQuery.from[0].collectionId==='occurrenceScoreClaims' && r.body.structuredQuery.limit===20));
});

test('failed summary publication leaves claim pending and retry never doubles the award',()=>{
 const h=setup(),publish=h.ctx.evaluationPublishCategorySummary_;h.ctx.evaluationPublishCategorySummary_=()=>{throw Error('unavailable');};
 assert.throws(()=>h.ctx.evaluationDeliverOccurrence_(ID));assert.equal(h.data('occurrenceScoreClaims',ID).status,'PENDING_VALIDATION');
 assert.equal(h.values('evaluationLedger').length,1);h.ctx.evaluationPublishCategorySummary_=publish;
 h.ctx.evaluationDeliverOccurrence_(ID);assert.equal(h.values('evaluationLedger').length,1);
 assert.equal(h.data('evaluationSummaries','fixture').performanceTotal,2);assert.equal(h.data('occurrenceScoreClaims',ID).status,'VALIDATED');
});
