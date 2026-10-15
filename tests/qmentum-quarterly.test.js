import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {quarterFacts,quarterlyPlan,analysisInputSignature,aiPayload,validateAiText,evidenceUsable,saoPauloPeriod} from '../src/qmentum-quarterly.js';
import {processQuarterlyJob,geminiProvider} from '../server/qmentum-quarterly-worker.js';
import {calculateMonth} from '../src/qmentum-engine.js';import {initialDefinitions,emptyInputs} from '../src/qmentum-catalog.js';
const now=Date.parse('2026-10-15T16:00:00Z'),hash=x=>createHash('sha256').update(x).digest('hex');
const row=(month,year=2026)=>{const defs=initialDefinitions();for(const d of Object.values(defs.items)){d.approved=true;d.criterion='Synthetic approved criterion';}const inputs=emptyInputs();inputs.counts.techniqueChanges=1;inputs.counts.surgical=100;return {year,month,version:1,results:calculateMonth(inputs,defs,{inputVersion:1})};};
const rows=[row(1),row(2),row(3),row(4),row(5),row(6)],facts=quarterFacts({rows,indicatorId:'QM01',year:2026,quarter:1,now});
const evidence={status:'VERIFIED',version:'synthetic-v1',validUntil:'2027-01-01',sources:[{url:'https://www.who.int/synthetic',title:'Synthetic verified evidence',summary:'Synthetic institutional context only',consultedAt:'2026-10-15'}]};
test('civil quarters respect São Paulo midnight and never request a future quarter',()=>{
 assert.equal(saoPauloPeriod(Date.parse('2027-01-01T01:00:00Z')).year,2026);
 assert.equal(facts.aggregate.ratio,.01);assert.equal(facts.coverage,3);assert.equal(facts.previous,null);
 assert.throws(()=>quarterFacts({rows,indicatorId:'QM01',year:2026,quarter:4,now}),/NOT_ENDED/);
 const q2=quarterFacts({rows,indicatorId:'QM01',year:2026,quarter:2,now});assert.equal(q2.comparison,0);
 const q1=quarterFacts({rows:[row(10,2026),row(11,2026),row(12,2026),row(1,2027)],indicatorId:'QM01',year:2027,quarter:1,now:Date.parse('2027-04-02')});assert.equal(q1.previous.year,2026);
});
test('partial and informed-only rates never become averaged quarterly rates',()=>{
 const partial=quarterFacts({rows:[row(1)],indicatorId:'QM01',year:2026,quarter:1,now});assert.equal(partial.status,'PARTIAL');assert.equal(partial.aggregate.ratio,null);
 const informed=rows.slice(0,3).map(r=>({...r,results:{QM12:{indicatorId:'QM12',status:'INFORMED',ratio:.98,N:null,D:null,sourceMode:'INFORMED',definitionVersion:1}}}));
 assert.equal(quarterFacts({rows:informed,indicatorId:'QM12',year:2026,quarter:1,now}).aggregate.ratio,null);
 assert.equal(quarterFacts({rows,indicatorId:'QM15',year:2026,quarter:1,now}).status,'NO_DATA');
});
test('source timestamps do not change the factual signature or mark current analysis stale',()=>{
 const changed=rows.map(r=>({...r,results:{...r.results,QM01:{...r.results.QM01,calculatedAt:'2026-10-15T00:00:00Z'}}}));
 assert.equal(analysisInputSignature(quarterFacts({rows:changed,indicatorId:'QM01',year:2026,quarter:1,now}),hash),analysisInputSignature(facts,hash));
});
test('changing an unrelated field/version does not regenerate all indicators',()=>{
 const changed=structuredClone(rows);changed[0].version++;for(const r of Object.values(changed[0].results))r.inputVersion++;
 changed[0].results.QM02.N=9;
 const next=quarterFacts({rows:changed,indicatorId:'QM01',year:2026,quarter:1,now});assert.equal(analysisInputSignature(next,hash),analysisInputSignature(facts,hash));
 changed[0].results.QM01.D=200;assert.notEqual(analysisInputSignature(quarterFacts({rows:changed,indicatorId:'QM01',year:2026,quarter:1,now}),hash),analysisInputSignature(facts,hash));
});
test('plan includes both past quarters and all 18 indicators, keeps no-data jobs without AI',()=>{
 const jobs=quarterlyPlan({unitId:'synthetic-unit',rows,now,hash});assert.equal(jobs.length,36);assert.equal(new Set(jobs.map(j=>j.id)).size,36);
 assert.ok(jobs.some(j=>j.status==='NO_DATA'));assert.deepEqual(jobs,quarterlyPlan({unitId:'synthetic-unit',rows,now,hash}));
 const changed=structuredClone(rows);changed[0].results.QM01.N=2;assert.notEqual(quarterlyPlan({unitId:'synthetic-unit',rows:changed,now,hash})[0].id,jobs[0].id);
});
test('AI receives aggregates only and strict evidence/text validation fails closed',()=>{
 assert.equal(evidenceUsable(evidence,now),true);assert.equal(evidenceUsable({...evidence,validUntil:'2020-01-01'},now),false);
 const p=aiPayload({...facts,uid:'private',unitId:'private',comment:'private'},evidence);assert.ok(!JSON.stringify(p).includes('private'));
 assert.deepEqual(validateAiText({analysis:'Dados agregados disponíveis para revisão institucional.',action:'Responsável pela qualidade: revisar a coleta no próximo trimestre.'},p).length,2);
 for(const text of ['texto com taxa 99,99 não confirmada','Texto com\nnovo parágrafo','x'.repeat(341),'Texto com https://example.invalid'])assert.throws(()=>validateAiText({analysis:text,action:'Revisar os dados no próximo trimestre.'},p));
});
function fixture(patch={}){
 let calls=0,published=0,deferred=[],obsolete=0;const job={id:'job',unitId:'synthetic-unit',signature:analysisInputSignature(facts,hash),status:'QUEUED',nextAt:0,lockUntil:0,attempts:0};
 const store={getJob:async()=>job,currentFacts:async()=>facts,evidence:async()=>evidence,claimAndReserve:async()=>({id:'lease'}),freeTierProof:async()=>({projectId:'sahmt-17a16',billingEnabled:false,termsAccepted:true,accountModelVerified:true,expiresAt:now+10000}),publish:async()=>published++,defer:async(_j,c)=>deferred.push(c),obsolete:async()=>obsolete++,...patch};
 const provider={name:'synthetic',model:'synthetic',generate:async()=>{calls++;return {analysis:'Dados agregados disponíveis para revisão institucional.',action:'Responsável pela qualidade: revisar a coleta no próximo trimestre.'};}};
 return {job,store,provider,get calls(){return calls;},get published(){return published;},deferred,get obsolete(){return obsolete;}};
}
test('dry-run sends nothing; generated result persists once and skips completed work',async()=>{
 const f=fixture();assert.equal((await processQuarterlyJob({...f,id:'job',now,hash,dryRun:true})).code,'QMENTUM_QUARTER_DRY_RUN');assert.equal(f.calls,0);
 assert.equal((await processQuarterlyJob({...f,id:'job',now,hash})).code,'QMENTUM_AI_GENERATED_PENDING_REVIEW');assert.equal(f.published,1);
 f.job.status='GENERATED';await processQuarterlyJob({...f,id:'job',now,hash});assert.equal(f.calls,1);
});
test('quota, concurrent leases, missing evidence and no-billing proof block external calls',async()=>{
 for(const patch of [{claimAndReserve:async()=>null},{evidence:async()=>null},{freeTierProof:async()=>({billingEnabled:true})}]){
  const f=fixture(patch);await processQuarterlyJob({...f,id:'job',now,hash});assert.equal(f.calls,0);assert.equal(f.published,0);
 }
 const f=fixture();f.provider.generate=async()=>{throw Error('QMENTUM_AI_QUOTA');};await processQuarterlyJob({...f,id:'job',now,hash});assert.ok(f.deferred.includes('QMENTUM_AI_QUOTA'));assert.equal(f.published,0);
});
test('revoked or changed input during generation never publishes obsolete analysis',async()=>{
 let n=0;const f=fixture({currentFacts:async()=>++n===1?facts:{...facts,coverage:1}});await processQuarterlyJob({...f,id:'job',now,hash});assert.equal(f.published,0);assert.equal(f.obsolete,1);
});
test('provider is configurable, sends no paid tools, validates model proof and handles exhausted free quota',async()=>{
 let body;const p=geminiProvider({apiKey:'synthetic-only',model:'gemini-synthetic',request:async(_url,options)=>{body=JSON.parse(options.body);return {status:429};}});
 await assert.rejects(p.generate({}, {proof:{model:'other'},maxOutputTokens:600}),/FREE_TIER/);
 await assert.rejects(p.generate({}, {proof:{model:'gemini-synthetic'},maxOutputTokens:600}),/AI_QUOTA/);assert.equal(body.tools,undefined);
});
