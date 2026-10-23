import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../apps-script-v2/ManagementEbookSetup.gs',import.meta.url),'utf8');
function context(extra={}){const ctx=vm.createContext({console:{log(){}},...extra});vm.runInContext(source,ctx);return ctx;}
const grant=i=>({id:'grant'+i,view:'published',type:'user',role:'reader'});
test('parallel responder removal validates the entire batch and inspects every response',()=>{
  let calls=0,requests;
  const ctx=context({formsEvaluationId_:()=>true,ScriptApp:{getOAuthToken:()=> 'synthetic-token'},UrlFetchApp:{fetchAll:r=>{calls++;requests=r;return r.map(()=>({getResponseCode:()=>204}));}},formsEvaluationGoogleError_:status=>Error('HTTP_'+status)});
  ctx.mgeRemovePublishedBatch_('SyntheticForm12345',Array.from({length:20},(_,i)=>grant(i)));
  assert.equal(calls,1);assert.equal(requests.length,20);assert.ok(requests.every(r=>r.method==='delete'&&r.followRedirects===false));
  for(const unsafe of [{...grant(1),role:'owner'},{...grant(1),view:undefined},{...grant(1),permissionDetails:[{inherited:true}]}])assert.throws(()=>ctx.mgeRemovePublishedBatch_('SyntheticForm12345',[grant(0),unsafe]),/READING_CUTOVER_DENIED/);
  assert.equal(calls,1);
  ctx.UrlFetchApp.fetchAll=()=>[{getResponseCode:()=>204},{getResponseCode:()=>403,getContentText:()=>''}];
  assert.throws(()=>ctx.mgeRemovePublishedBatch_('SyntheticForm12345',[grant(0),grant(1)]),/HTTP_403/);
  ctx.UrlFetchApp.fetchAll=()=>[{getResponseCode:()=>404}];assert.doesNotThrow(()=>ctx.mgeRemovePublishedBatch_('SyntheticForm12345',[grant(0)]));
});
test('59 responder grants are removed in bounded batches and checkpointed before finalization',()=>{
  const row={formId:'SyntheticForm12345',bankFileId:'SyntheticBank12345'},proof={formId:row.formId,manifestDigest:'manifest',version:2,materialFingerprint:'material',questionFingerprint:'questions',bankSha256:'bank'};
  const state={index:8,manifestDigest:'manifest',backups:[{formId:row.formId,normalFingerprint:'owner'}],pending:{formId:row.formId,proof,itemHash:'items',configVersion:3,phase:'RESPONDER_ACCESS'}};
  let grants=Array.from({length:59},(_,i)=>grant(i)),saved=[],batches=[];
  const ctx=context({FormApp:{openById:()=>({isPublished:()=>false,isAcceptingResponses:()=>false,supportsAdvancedResponderPermissions:()=>true,hasLimitOneResponsePerUser:()=>false,canEditResponse:()=>false})},formsEvaluationMetadata_:()=>({items:[]}),evaluationGet_:()=>({configVersion:3,managementEbookManifestDigest:'manifest',version:2,materialFingerprint:'material'}),formsEvaluationHash_:()=> 'items',formsEvaluationSavedQuestionFingerprint_:()=> 'questions',DriveApp:{getFileById:()=>({getBlob:()=>({getBytes:()=>[]})})},gqpBytesHash_:()=> 'bank',formsEvaluationPublishedPermissions_:()=>[{role:'owner'},...grants],dgrNormalFingerprint_:()=> 'owner'});
  ctx.mgeRemovePublishedBatch_=(_id,batch)=>{batches.push(batch.length);grants=grants.filter(p=>!batch.some(b=>b.id===p.id));};
  const result=ctx.mgeContinuePrepared_({items:Array(42)},row,state,{setContent:v=>saved.push(JSON.parse(v))});
  assert.equal(result.pending,true);assert.deepEqual(batches,[20,20,19]);assert.equal(state.pending.phase,'FINALIZE');assert.deepEqual(saved.slice(0,3).map(s=>s.pending.remainingGrants),[39,19,0]);assert.equal(state.index,8);
});
function runner(){
  const state={manifestDigest:'manifest',createdAt:new Date().toISOString(),index:8,runs:6,complete:false,backups:[],results:[],originalPolicy:{documents:{rop:{}}}};
  let disk=JSON.stringify(state),events=[];
  const ctx=context({ropsOwner_:()=>{},evaluationAssertOperator_:()=>{},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>events.push('unlock')})},gpdfProps_:()=>({getProperty:()=> 'Recovery12345'}),formsEvaluationHash_:()=> 'manifest',FormApp:{openById:()=>({})},evaluationProject_:()=> 'sahmt-gestao-5ae66'});
  ctx.mgeManifest_=()=>({items:Array.from({length:42},(_,i)=>({formId:'form'+i}))});ctx.mgeContext_=()=>{};ctx.mgePrivate_=()=>({getBlob:()=>({getDataAsString:()=>disk}),setContent:v=>{disk=v;},getUrl:()=> 'private-recovery'});ctx.mgeArm_=delay=>events.push(delay||60000);ctx.mgeStopTrigger_=()=>events.push('stop');ctx.formsEvaluationCloseForm_=()=>events.push('close');
  return {ctx,events,disk:()=>JSON.parse(disk)};
}
test('one stage per invocation saves progress and arms timeout recovery before external work',()=>{
  const f=runner();let calls=0;f.ctx.mgePrepareOne_=(_m,row,state)=>{calls++;assert.ok(f.events.includes(420000));assert.equal(row.formId,'form8');state.pending={phase:'RESPONDER_ACCESS'};return {pending:true};};
  const result=f.ctx.continuarLeituraDocumentosGestaoFbV1();assert.equal(calls,1);assert.equal(result.completed,8);assert.equal(result.phase,'RESPONDER_ACCESS');assert.equal(f.disk().runs,7);assert.equal(f.events.at(-2),60000);
});
test('completion advances once; ordinary failures close the Form and disarm automatic retry',()=>{
  const f=runner();f.ctx.mgePrepareOne_=()=>({pending:false});assert.equal(f.ctx.continuarLeituraDocumentosGestaoFbV1().completed,9);assert.equal(f.disk().index,9);
  f.ctx.mgePrepareOne_=()=>{throw Error('MANAGEMENT_EBOOK_TEST_FAILURE');};assert.throws(()=>f.ctx.continuarLeituraDocumentosGestaoFbV1(),/MANAGEMENT_EBOOK_TEST_FAILURE/);assert.equal(f.disk().index,9);assert.equal(f.disk().lastError.code,'MANAGEMENT_EBOOK_TEST_FAILURE');assert.deepEqual(f.events.slice(-3),['stop','close','unlock']);
});
test('repeated timeouts at the same checkpoint stop after four attempts',()=>{
  const f=runner();let calls=0;f.ctx.mgePrepareOne_=()=>{calls++;return {pending:true};};for(let i=0;i<4;i++)f.ctx.continuarLeituraDocumentosGestaoFbV1();assert.throws(()=>f.ctx.continuarLeituraDocumentosGestaoFbV1(),/MANAGEMENT_EBOOK_REPEATED_TIMEOUT/);assert.equal(calls,4);assert.equal(f.disk().lastError.code,'MANAGEMENT_EBOOK_REPEATED_TIMEOUT');
});
