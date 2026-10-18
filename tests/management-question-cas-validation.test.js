import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../apps-script-v2/ManagementQuestionCasValidation.gs',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const ids=Object.fromEntries(['root','content','review','workspace','questions','status'].map(k=>[k,k+'Fixture123456789']));
 let now=Date.parse('2026-10-18T10:00:00Z'),available=true;
 class Clock extends Date { static now(){return now;} }
 const cfg={enabled:true,runId:'synthetic-run-1234',operatorEmail:'owner@example.test',expiresAt:new Date(now+25*60000).toISOString(),ids};
 const props=new Map(),triggers=[],reports=[],calls={reads:0,locks:0,unlocks:0,exercise:0,logs:0},metadata={};
 const parent={content:ids.root,review:ids.content,workspace:ids.root,questions:ids.review,status:ids.workspace};
 for(const [role,id] of Object.entries(ids))metadata[id]={id,trashed:false,mimeType:['questions','status'].includes(role)?role==='questions'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/json':'application/vnd.google-apps.folder',parents:parent[role]?[parent[role]]:[],properties:{sahmtCasRun:cfg.runId,sahmtCasRole:role},owners:[{emailAddress:cfg.operatorEmail}],inheritedPermissionsDisabled:role==='review'};
 const ctx=vm.createContext({Date:Clock,console:{log:()=>calls.logs++},Session:{getEffectiveUser:()=>({getEmail:()=>cfg.operatorEmail})},gqcTrustedConfig_:()=>cfg,
  gqpHash_:x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),gqpConfig_:x=>x,gqpTrustedConfig_:()=>({bindings:[]}),gpdfConfig_:()=>({pairs:[]}),
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},
  LockService:{getScriptLock:()=>({tryLock:()=>{calls.locks++;return available;},releaseLock:()=>calls.unlocks++})},
  ScriptApp:{getProjectTriggers:()=>triggers.slice(),deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),newTrigger:handler=>({timeBased:()=>({after:delay=>({create:()=>{assert.ok([1000,60000].includes(delay));triggers.push({getHandlerFunction:()=>handler,delay});}})})})},
  gpdfJson_:url=>{calls.reads++;const id=url.match(/files\/([^?]+)/)[1];return clone(metadata[id]);},
  graPermissions_:()=>[{type:'user',role:'owner',emailAddress:cfg.operatorEmail}],gqpPrivateFile_:()=>({setContent:text=>reports.push(JSON.parse(text))})
 });
 vm.runInContext(source,ctx);
 const nativeExercise=ctx.gqcExercise_;ctx.gqcExercise_=()=>{calls.exercise++;return {code:'QUESTION_CAS_VALIDATION_PASSED',productionWrites:0,firestoreReads:0,automaticContinuation:false};};
 return {ctx,cfg,props,triggers,reports,calls,metadata,nativeExercise,busy:value=>{available=!value;},advance:ms=>{now+=ms;},arm:()=>ctx.gqcArmFromMaintenance_(),run:()=>ctx.validarPublicacaoQuestoesIsoladaV1()};
}
test('CAS harness compiles and never calls Firestore, production activation, deletions or native item mutation',()=>{
 assert.doesNotThrow(()=>new vm.Script(source));
 assert.doesNotMatch(source,/evaluationGet_|firestoreRequest_|deleteAllResponses|deleteItem|setTitle\(next|setChoices\(next|gvrConfig_|gvrFile_/);
 assert.match(source,/apiQuotaProjectId:'sahmt-17a16'/);assert.match(source,/requiredRevisionId:baseline\.revisionId/);
 assert.match(source,/gqpPublish_\(fixtureCfg,approval,ports\)/);
});
test('absent private configuration makes the temporary maintenance hook inert',()=>{const f=fixture();delete f.ctx.gqcTrustedConfig_;assert.equal(f.arm().code,'QUESTION_CAS_VALIDATION_DISABLED');assert.equal(f.calls.reads,0);assert.equal(f.props.size,0);});
test('disabled configuration makes both entry points inert without remote reads or locks',()=>{const f=fixture();f.cfg.enabled=false;assert.equal(f.arm().code,'QUESTION_CAS_VALIDATION_DISABLED');assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_DISABLED');assert.equal(f.calls.reads,0);assert.equal(f.calls.locks,0);assert.equal(f.props.size,0);});
test('only effective owner may arm or execute, before touching Drive or script state',()=>{const f=fixture();f.ctx.Session.getEffectiveUser=()=>({getEmail:()=> 'other@example.test'});assert.throws(f.arm,/OWNER_DENIED/);assert.throws(f.run,/OWNER_DENIED/);assert.equal(f.calls.reads,0);assert.equal(f.calls.locks,0);});
test('invalid IDs, duplicate IDs, stale or overly long fixture permission windows are blocked',()=>{
 for(const mutate of [f=>{f.cfg.ids.questions='wrong';},f=>{f.cfg.ids.status=f.cfg.ids.questions;},f=>{f.cfg.expiresAt='invalid';},f=>f.advance(25*60000),f=>{f.cfg.expiresAt='2026-10-18T11:00:00Z';}]){const f=fixture();mutate(f);assert.throws(f.arm,/CONFIG_INVALID|CONFIG_EXPIRED/);assert.equal(f.triggers.length,0);assert.equal(f.calls.exercise,0);}
});
test('arm installs exactly one disposable trigger and cannot rearm the same run',()=>{const f=fixture();assert.equal(f.arm().code,'QUESTION_CAS_VALIDATION_ARMED');assert.equal(f.triggers.length,1);assert.equal(f.props.size,1);assert.equal(f.arm().code,'QUESTION_CAS_VALIDATION_ALREADY_ARMED');assert.equal(f.triggers.length,1);assert.equal(f.calls.unlocks,2);});
test('unrelated maintenance triggers remain intact while only the CAS trigger is removed',()=>{const f=fixture(),other={getHandlerFunction:()=> 'sincronizarPdfsGestaoV1'};f.triggers.push(other);f.arm();f.run();assert.equal(f.triggers.length,1);assert.equal(f.triggers[0],other);});
test('completed proof persists sanitized receipt and cannot run or arm a second time',()=>{const f=fixture();f.arm();assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_PASSED');assert.equal(f.calls.exercise,1);assert.equal(f.triggers.length,0);assert.equal(f.reports.length,3);assert.deepEqual(f.reports.map(r=>r.result.code),['QUESTION_CAS_VALIDATION_ARMED','QUESTION_CAS_VALIDATION_RUNNING','QUESTION_CAS_VALIDATION_PASSED']);assert.equal(f.reports[0].result.firestoreReads,0);assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_PASSED');assert.equal(f.calls.exercise,1);assert.equal(f.arm().code,'QUESTION_CAS_VALIDATION_ALREADY_ARMED');});
test('a direct manual run without the armed private marker cannot create a fixture Form',()=>{const f=fixture();assert.throws(f.run,/NOT_ARMED/);assert.equal(f.calls.exercise,0);});
test('concurrent invocation never reenters a proof that already claimed its running state',()=>{const f=fixture();f.arm();const key=[...f.props.keys()][0],state=JSON.parse(f.props.get(key));state.phase='RUNNING';f.props.set(key,JSON.stringify(state));assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_ALREADY_RUNNING');assert.equal(f.calls.exercise,0);});
test('progress is attempted once per phase and never publishes stage or fixture contents',()=>{const f=fixture(),state={runId:f.cfg.runId,phase:'ARMED'};f.ctx.gqcSave_(f.cfg,state);f.ctx.gqcSave_(f.cfg,state);state.phase='RUNNING';f.ctx.gqcSave_(f.cfg,state);f.ctx.gqcSave_(f.cfg,state);state.stage='FORM_CREATE';f.ctx.gqcSave_(f.cfg,state);assert.equal(f.reports.length,2);assert.doesNotMatch(JSON.stringify(f.reports),/FORM_CREATE|synthetic-run|owner@example/);});
test('a failed optional progress receipt does not prevent arming or executing',()=>{const f=fixture(),status=f.ctx.gqcStatus_;let attempts=0;f.ctx.gqcStatus_=(c,r)=>{if(/_(ARMED|RUNNING)$/.test(r.code)){attempts++;throw Error('optional private report failure');}return status(c,r);};assert.equal(f.arm().code,'QUESTION_CAS_VALIDATION_ARMED');assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_PASSED');assert.equal(attempts,2);assert.equal(f.calls.exercise,1);});
test('a busy armed handler defers only its own trigger for 60 seconds',()=>{const f=fixture(),other={getHandlerFunction:()=> 'sincronizarPdfsGestaoV1'};f.triggers.push(other);f.arm();f.busy(true);assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_BUSY');assert.equal(f.triggers.length,2);assert.equal(f.triggers[0],other);assert.equal(f.triggers[1].delay,60000);assert.equal(f.calls.exercise,0);});
test('busy running or terminal markers never schedule another validation',()=>{for(const phase of ['RUNNING','DONE','FAILED']){const f=fixture();f.arm();const key=[...f.props.keys()][0],state=JSON.parse(f.props.get(key));state.phase=phase;f.props.set(key,JSON.stringify(state));f.triggers.splice(0);f.busy(true);assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_BUSY');assert.equal(f.triggers.length,0);assert.equal(f.calls.exercise,0);}});
test('a busy armed handler near expiry does not schedule beyond its authorization window',()=>{const f=fixture();f.arm();f.triggers.splice(0);f.advance(24*60000+1000);f.busy(true);assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_BUSY');assert.equal(f.triggers.length,0);});
test('every exact fixture ID is checked against production question and PDF bindings',()=>{
 for(const role of ['root','content','review','workspace','questions','status']){
  const f=fixture();f.ctx.gqpTrustedConfig_=()=>({bindings:[{formId:f.cfg.ids[role]}]});assert.throws(f.arm,/PRODUCTION_COLLISION/);assert.equal(f.props.size,0);assert.equal(f.triggers.length,0);
 }
 const f=fixture();f.ctx.gpdfConfig_=()=>({pairs:[{sourceId:f.cfg.ids.questions}]});assert.throws(f.arm,/PRODUCTION_COLLISION/);assert.equal(f.triggers.length,0);
});
test('private markers, ownership, parent folders and limited review inheritance are mandatory',()=>{
 for(const mutate of [f=>{f.metadata[f.cfg.ids.questions].properties.sahmtCasRun='other';},f=>{f.metadata[f.cfg.ids.root].properties.sahmtCasRole='other';},f=>{f.metadata[f.cfg.ids.review].parents=['OtherFixture12345'];},f=>{f.metadata[f.cfg.ids.status].owners=[{emailAddress:'other@example.test'}];},f=>{f.metadata[f.cfg.ids.review].inheritedPermissionsDisabled=false;},f=>{f.metadata[f.cfg.ids.root].trashed=true;}]){const f=fixture();mutate(f);assert.throws(f.arm,/FIXTURE_CHANGED|REVIEW_FOLDER_INVALID/);assert.equal(f.triggers.length,0);assert.equal(f.props.size,0);}
});
test('public or extraneous editor grants block arming rather than being removed',()=>{const f=fixture();f.ctx.graPermissions_=()=>[{type:'user',role:'owner',emailAddress:f.cfg.operatorEmail},{type:'anyone',role:'reader'}];assert.throws(f.arm,/FIXTURE_NOT_PRIVATE/);assert.equal(f.props.size,0);});
test('fixture preflight failure after arming becomes a terminal receipt before creating a Form',()=>{const f=fixture();f.arm();f.metadata[f.cfg.ids.root].trashed=true;const r=f.run();assert.equal(r.code,'QUESTION_CAS_VALIDATION_PARTIAL');assert.equal(r.stage,'FIXTURE_PREFLIGHT');assert.equal(r.category,'QUESTION_CAS_VALIDATION_FIXTURE_CHANGED');assert.equal(f.calls.exercise,0);assert.equal(f.triggers.length,0);assert.equal(f.reports.at(-1).result.category,r.category);assert.equal(f.run().category,r.category);});
test('an invalid status fixture prevents receipt writes but still returns a terminal safe preflight result',()=>{const f=fixture();f.arm();const count=f.reports.length;f.metadata[f.cfg.ids.status].trashed=true;const r=f.run();assert.equal(r.stage,'FIXTURE_PREFLIGHT');assert.equal(r.code,'QUESTION_CAS_VALIDATION_PARTIAL');assert.equal(f.reports.length,count);assert.equal(f.calls.exercise,0);assert.equal(f.run().category,r.category);assert.equal(f.triggers.length,0);});
test('proof failure is terminal without retries and strips confidential service exception text',()=>{const f=fixture();f.ctx.gqcExercise_=()=>{f.calls.exercise++;throw Error('Bearer-secret private@email.test URL confidential');};f.arm();const r=f.run();assert.equal(r.code,'QUESTION_CAS_VALIDATION_PARTIAL');assert.equal(r.category,'QUESTION_CAS_VALIDATION_SERVICE_ERROR');assert.doesNotMatch(JSON.stringify(f.reports),/Bearer|private@email|confidential/);assert.equal(f.triggers.length,0);assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_PARTIAL');assert.equal(f.calls.exercise,1);});
test('safe HTTP and CAS failure codes remain observable without response content',()=>{const f=fixture();f.ctx.gqcExercise_=()=>{throw Error('QUESTION_PUBLICATION_FORMS_HTTP_403');};f.arm();assert.equal(f.run().category,'QUESTION_PUBLICATION_FORMS_HTTP_403');assert.equal(f.triggers.length,0);});
test('a real publication acquires its own lock after the harness releases the claim lock',()=>{const f=fixture();f.ctx.gqcExercise_=()=>{assert.equal(f.calls.locks,f.calls.unlocks);return {code:'QUESTION_CAS_VALIDATION_PASSED'};};f.arm();assert.equal(f.run().code,'QUESTION_CAS_VALIDATION_PASSED');});
test('DOCX binding replaces each synthetic placeholder once and does not use old validation configuration',()=>{
 const f=fixture(),writes=[],blob={copyBlob(){return this;},setContentType(){return this;}},xml='<w:doc>__Q1__ __Q2__</w:doc>';
 f.ctx.gpdfHttp_=(url,options)=>{if(options){writes.push(options);return {};}return {getBlob:()=>blob};};
 f.ctx.Utilities={unzip:()=>[{getName:()=> 'word/document.xml',getDataAsString:()=>xml}],newBlob:(text,mime,name)=>({text,mime,name}),zip:parts=>({getContentType:()=> 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',setContentType(){return this;},getBytes:()=>parts[0].text})};
 f.ctx.gqcBindDoc_(f.cfg,['apiQ1','apiQ2']);assert.equal(writes.length,1);assert.equal(writes[0].payload,'<w:doc>apiQ1 apiQ2</w:doc>');assert.equal(writes[0].method,'patch');
 assert.throws(()=>f.ctx.gqcBindDoc_(f.cfg,['invalid<&','apiQ2']),/QUESTION_MARKER_INVALID/);assert.equal(writes.length,1);
});
test('closure explicitly confirms neither publication nor responses are left open',()=>{const f=fixture();let published=true,accepting=true;const form={setAcceptingResponses:v=>{accepting=v;},isPublished:()=>published,setPublished:v=>{published=v;},isAcceptingResponses:()=>accepting};f.ctx.gqcClose_(form);assert.equal(published,false);assert.equal(accepting,false);assert.throws(()=>f.ctx.gqcClose_({...form,isPublished:()=>true}),/FORM_NOT_CLOSED/);});
test('real-shaped recovery retains its text/plain MIME across metadata marking, setContent and replay',()=>{
 const f=fixture(),id='RecoveryFixture123456789',state={runId:f.cfg.runId,phase:'RUNNING',stage:'CAS_APPLY_LOST_RESPONSE'},counts={creates:0,patches:0,writes:0};let content='{}';
 const get=f.ctx.gpdfJson_;f.ctx.gpdfJson_=(url,options)=>{if(options){counts.patches++;const body=JSON.parse(options.payload);assert.equal(body.mimeType,undefined);f.metadata[id].properties=body.properties;return {id};}return get(url);};
 f.ctx.gqpPorts_=()=>({});f.ctx.MimeType={PLAIN_TEXT:'text/plain'};
 f.ctx.DriveApp={Access:{PRIVATE:'private'},Permission:{NONE:'none'},getFolderById:value=>({id:value}),createFile:(name,text,mime)=>{
  counts.creates++;assert.equal(mime,'text/plain');content=text;f.metadata[id]={id,mimeType:mime,parents:[],owners:[{emailAddress:f.cfg.operatorEmail}]};
  return {getId:()=>id,setSharing:()=>{},moveTo:folder=>{f.metadata[id].parents=[folder.id];}};
 }};
 f.ctx.gqpPrivateFile_=value=>{assert.equal(value,id);return {setContent:text=>{counts.writes++;content=text;},getBlob:()=>({getDataAsString:()=>content})};};
 const ports=f.ctx.gqcRecoveryPorts_(f.cfg,state,{});ports.save('approval-key',{status:'PREPARED'});
 assert.equal(ports.load('approval-key').status,'PREPARED');ports.save('approval-key',{status:'DONE'});assert.equal(ports.load('approval-key').status,'DONE');
 assert.equal(f.metadata[id].mimeType,'text/plain');assert.equal(f.metadata[id].properties.sahmtCasRole,'recovery');assert.deepEqual(counts,{creates:1,patches:1,writes:2});
});
function exerciseFixture(){
 const f=fixture(),state={runId:f.cfg.runId,phase:'RUNNING'},items=[],history=[],transport={batches:0,publications:0,reads:0};let published=false,accepting=false,applied=false;
 const form={getId:()=> 'DisposableFormFixture123',setIsQuiz:()=>{},setAcceptingResponses:v=>{accepting=v;},isAcceptingResponses:()=>accepting,setPublished:v=>{published=v;},isPublished:()=>published,getItems:()=>items,
  addMultipleChoiceItem:()=>{const item={setTitle(){return this;},setHelpText(){return this;},setPoints(){return this;},setRequired(){return this;},setChoices(){return this;},createChoice:(text,correct)=>({text,correct}),createResponse:answer=>({answer}),asMultipleChoiceItem(){return this;}};items.push(item);return item;},
  createResponse:()=>{const response={withItemResponse(){return this;},submit:()=>{history.push({id:'synthetic-response',score:4});return {getId:()=> 'synthetic-response'};}};return response;}
 };
 f.ctx.FormApp={create:()=>form,openById:()=>form};
 f.ctx.DriveApp={Access:{PRIVATE:'private'},Permission:{NONE:'none'},getFileById:()=>({setSharing:()=>{},moveTo:()=>{}}),getFolderById:id=>({id})};
 f.ctx.gpdfJson_=()=>({});f.ctx.gqcFixtures_=()=>{};f.ctx.gqcResponses_=()=>clone(history);
 f.ctx.formsEvaluationSyncResponders_=(value,emails)=>{assert.equal(value,form);assert.deepEqual([...emails],[f.cfg.operatorEmail]);transport.publications++;published=true;accepting=true;return true;};
 const question=n=>({questionId:'api_q'+n,itemId:'api_i'+n,points:2,required:true,options:[{correct:n===1&&applied},{correct:!(n===1&&applied)}]});
 const model=()=>({questions:[question(1),question(2)]});
 f.ctx.gqpModel_=model;f.ctx.gqcBindDoc_=()=>({getBytes:()=>[1]});f.ctx.gqrRows_=()=>[];f.ctx.gqrParse_=()=>({});f.ctx.gqpPlan_=()=>({requests:[{}]});f.ctx.gqpBytesHash_=()=> 'a'.repeat(64);f.ctx.gqpContent_=x=>x;
 const ports={form:()=>{transport.reads++;return {formId:form.getId(),revisionId:applied?'new-revision':'old-revision',items:[{title:applied?'Revised':'Original'}]};},batch:(id,body)=>{
  if(body.writeControl.requiredRevisionId==='old-revision')throw Error('QUESTION_PUBLICATION_FORMS_HTTP_400');
  transport.batches++;applied=true;return {};
 }};
 f.ctx.gqcRecoveryPorts_=()=>ports;
 let runs=0;f.ctx.gqpPublish_=(cfg,approval,p)=>{runs++;assert.equal(cfg.apiQuotaProjectId,'sahmt-17a16');if(runs===1)return p.batch(cfg.bindings[0].formId,{writeControl:{requiredRevisionId:'current-before-write'}});return {code:runs===2?'QUESTION_PUBLICATION_RECOVERED':'QUESTION_PUBLICATION_UNCHANGED',formWrites:0};};
 return {...f,state,form,ports,transport,exercise:()=>f.nativeExercise(f.cfg,state)};
}
test('complete harness control flow exercises lost response, recovery, zero-write replay and stale CAS rejection',()=>{
 const f=exerciseFixture(),result=f.exercise();assert.equal(result.code,'QUESTION_CAS_VALIDATION_PASSED');assert.equal(result.actualBatches,1);assert.equal(result.staleRevisionHttpStatus,400);assert.equal(result.responseLossRecovered,true);assert.equal(result.historicalResponsesPreserved,true);assert.equal(result.repeatWrites,0);assert.equal(f.transport.batches,1);assert.equal(f.transport.publications,1);assert.equal(f.form.isPublished(),false);assert.equal(f.form.isAcceptingResponses(),false);
});
test('an actual transport rejection after synthetic submission always closes the disposable Form',()=>{
 const f=exerciseFixture();f.ports.form=()=>{throw Error('QUESTION_PUBLICATION_FORMS_HTTP_403');};assert.throws(f.exercise,/FORMS_HTTP_403/);assert.equal(f.state.stage,'FORMS_API_BASELINE');assert.equal(f.transport.batches,0);assert.equal(f.form.isPublished(),false);assert.equal(f.form.isAcceptingResponses(),false);
});
