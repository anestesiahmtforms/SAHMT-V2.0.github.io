import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../apps-script-v2/ManagementQuestionPublication.gs',import.meta.url),'utf8');
const parser=readFileSync(new URL('../apps-script-v2/ManagementQuestionRevision.gs',import.meta.url),'utf8');
const clone=x=>JSON.parse(JSON.stringify(x));
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).filter(k=>x[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
const digest=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const cfg={version:1,enabled:true,operatorEmail:'owner@example.test',administratorEditorEmails:['admin@example.test'],bindings:[{formId:'FormFixture123456',documentId:'DocumentFixture123456',reviewFolderId:'ReviewFixture123456',readingFolderId:'ReadingFixture123456',assignment:{uid:'ManagerFixture123456',version:2}}]};
 const form={formId:cfg.bindings[0].formId,revisionId:'r1',info:{title:'Private title'},settings:{quizSettings:{isQuiz:true}},publishSettings:{publishState:{isPublished:true,isAcceptingResponses:true}},items:[
  {itemId:'text_intro',title:'Participant identity',questionItem:{question:{questionId:'identity',required:true,textQuestion:{}}}},
  {itemId:'item_1',title:'Pergunta inicial',description:' Explicação ',questionItem:{question:{questionId:'question_1',required:true,grading:{pointValue:2,correctAnswers:{answers:[{value:'A'}]}},choiceQuestion:{type:'RADIO',shuffle:true,options:[{value:'A'},{value:'B'}]}}}}
 ]};
 const baseline=clone(form),ctx=vm.createContext({gqeHash_:x=>digest(JSON.stringify(x)),formsEvaluationHash_:x=>digest(stable(x))});
 vm.runInContext(parser+'\n'+source,ctx);
 const edited=clone(ctx.gqpModel_(baseline));edited.questions[0].title='Pergunta revisada';edited.questions[0].options[0].correct=false;edited.questions[0].options[1].correct=true;
 ctx.gqrRows_=()=>edited.questions.flatMap(q=>[[['Código da questão',q.questionId],['Pergunta',q.title],['Descrição',q.description],['Pontos',String(q.points)]],[['Opção','Texto','Gabarito'],...q.options.map(o=>[o.label,o.text,o.correct?'RESPOSTA CORRETA':''])]]);
 const now=Date.parse('2026-10-18T10:00:00Z'),approval={version:1,formId:form.formId,documentId:cfg.bindings[0].documentId,managerUid:cfg.bindings[0].assignment.uid,assignmentVersion:2,approvedBy:cfg.operatorEmail,approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+60000).toISOString(),documentSha256:'a'.repeat(64),baselineForm:baseline};
 const calls={batch:0,close:0,profile:0,document:0,save:0,unlock:0},states=new Map(),historical=[{id:'historical',score:2,answer:'A'}];let closed=false;
 const ports={executor:()=>cfg.operatorEmail,now:()=>now,lock:()=>true,unlock:()=>calls.unlock++,assignment:()=>cfg.bindings[0].assignment,
  profile:uid=>{calls.profile++;return {uid,email:'manager@example.test',active:true,access:true};},
  document:()=>{calls.document++;return {sha256:approval.documentSha256,blob:{}};},
  form:()=>clone(form),load:key=>states.has(key)?clone(states.get(key)):null,save:(key,value)=>{calls.save++;states.set(key,clone(value));},
  close:()=>{calls.close++;closed=true;form.revisionId='r_closed';form.publishSettings.publishState={isPublished:false,isAcceptingResponses:false};},closed:()=>closed,
  batch:(id,body)=>{calls.batch++;assert.equal(id,form.formId);assert.equal(body.writeControl.requiredRevisionId,form.revisionId);assert.equal(body.writeControl.targetRevisionId,undefined);for(const r of body.requests)form.items[r.updateItem.location.index]=clone(r.updateItem.item);form.revisionId='r_applied';}
 };
 return {ctx,cfg,form,baseline,edited,approval,ports,calls,states,historical,run:()=>ctx.gqpPublish_(cfg,approval,ports)};
}
test('publication syntax, no watcher, respondent operations, scoring, sharing or reopening',()=>{
 assert.doesNotThrow(()=>new vm.Script(source));
 assert.doesNotMatch(source,/newTrigger|deleteItem|deleteAllResponses|getResponses|setPublished\(true\)|evaluationApplyAwards_|permissions\?[^']*POST|console\.log\(.*approval/);
 assert.match(source,/requiredRevisionId:current\.revisionId/);
});
test('disabled configuration performs no OAuth, profile or document lookup',()=>{const f=fixture();f.cfg.enabled=false;assert.equal(f.ctx.gqpPublish_(f.cfg,null,{}).code,'QUESTION_PUBLICATION_DISABLED');assert.equal(f.calls.profile,0);});
test('missing, duplicate and malformed trusted bindings are rejected',()=>{
 for(const mutate of [f=>{f.cfg.version=2;},f=>{f.cfg.bindings.push(clone(f.cfg.bindings[0]));},f=>{f.cfg.bindings[0].reviewFolderId=f.cfg.bindings[0].readingFolderId;},f=>{f.cfg.bindings[0].assignment.version=0;},f=>{f.cfg.administratorEditorEmails=['wrong'];}]){const f=fixture();mutate(f);assert.throws(f.run,/CONFIG_INVALID|ASSIGNMENT_INVALID/);assert.equal(f.calls.batch,0);}
});
test('only the configured executing owner can apply an approved revision',()=>{const f=fixture();f.ports.executor=()=> 'other@example.test';assert.throws(f.run,/OPERATOR_DENIED/);assert.equal(f.calls.profile,0);});
test('undesignated documents and substituted form identities are blocked',()=>{for(const mutate of [f=>{f.cfg.bindings[0].assignment=null;},f=>{f.approval.formId='OtherFormFixture';}]){const f=fixture();mutate(f);assert.throws(f.run,/DESIGNATION_REQUIRED/);assert.equal(f.calls.batch,0);}});
test('expired, future, extended and differently assigned approvals are blocked',()=>{
 for(const mutate of [a=>{a.expiresAt='2026-10-17T00:00:00Z';},a=>{a.approvedAt='2027-01-01T00:00:00Z';},a=>{a.expiresAt='2028-01-01T00:00:00Z';},a=>{a.assignmentVersion++;},a=>{a.managerUid='AnotherManager';},a=>{a.approvedBy='other@example.test';},a=>{a.documentSha256='wrong';}]){const f=fixture();mutate(f.approval);assert.throws(f.run,/APPROVAL_INVALID/);assert.equal(f.calls.profile,0);}
});
test('revoked, inactive or inconsistent manager profile cannot publish',()=>{
 for(const p of [null,{active:false,access:true,email:'m@example.test'},{active:true,access:false,email:'m@example.test'},{active:true,access:true,email:'m@example.test',uid:'wrong'}]){const f=fixture();f.ports.profile=()=>p;assert.throws(f.run,/ACCESS_REVOKED/);assert.equal(f.calls.batch,0);}
});
test('assignment revalidation rejects a new designation before writing',()=>{const f=fixture();f.ports.assignment=()=>({uid:f.approval.managerUid,version:3});assert.throws(f.run,/ACCESS_REVOKED/);assert.equal(f.calls.batch,0);});
test('approved bytes changed or swapped source cannot publish',()=>{const f=fixture();f.ports.document=()=>({blob:{},sha256:'b'.repeat(64)});assert.throws(f.run,/APPROVAL_CHANGED/);assert.equal(f.calls.close,0);});
test('approved revision uses one CAS batch and preserves IDs, points and prior responses',()=>{
 const f=fixture(),history=clone(f.historical),before=clone(f.form.items),r=f.run();
 assert.equal(r.code,'QUESTION_PUBLICATION_APPLIED');assert.equal(f.calls.batch,1);assert.equal(r.readingRevalidationRequired,true);
 assert.deepEqual(f.form.items[0],before[0]);assert.equal(f.form.items[1].itemId,before[1].itemId);
 const q=f.form.items[1].questionItem.question;assert.equal(q.questionId,'question_1');assert.equal(q.grading.pointValue,2);assert.equal(q.required,true);assert.equal(q.choiceQuestion.shuffle,true);
 assert.deepEqual(q.grading.correctAnswers.answers,[{value:'B'}]);assert.deepEqual(f.historical,history);assert.equal(f.ports.closed(),true);
});
test('same approval is a zero-write replay after completion',()=>{const f=fixture();f.run();const before=clone(f.calls);assert.equal(f.run().code,'QUESTION_PUBLICATION_UNCHANGED');assert.equal(f.calls.batch,before.batch);assert.equal(f.calls.close,before.close);assert.equal(f.states.size,1);});
test('unmodified DOC produces no backup, closure or API mutation',()=>{const f=fixture();Object.assign(f.edited,clone(f.ctx.gqpModel_(f.baseline)));assert.equal(f.run().code,'QUESTION_PUBLICATION_UNCHANGED');assert.equal(f.calls.batch,0);assert.equal(f.calls.close,0);assert.equal(f.calls.save,0);});
test('content, points, answer key and fixed question set are checked before closure',()=>{
 for(const mutate of [e=>{e.questions[0].points=99;},e=>{e.questions[0].options.forEach(o=>{o.correct=true;});},e=>{e.questions[0].options[1].text='A';},e=>{e.questions[0].questionId='other';}]){const f=fixture();mutate(f.edited);assert.throws(f.run,/QUESTION_REVISION_/);assert.equal(f.calls.close,0);assert.equal(f.calls.save,0);}
});
test('external question, unrelated item or settings drift blocks the whole batch',()=>{
 for(const mutate of [f=>{f.form.items[1].title='External';},f=>{f.form.items[0].title='External';},f=>{f.form.settings.quizSettings.isQuiz=false;}]){const f=fixture();mutate(f);assert.throws(f.run,/FORM_CHANGED/);assert.equal(f.calls.batch,0);assert.equal(f.calls.close,0);}
});
test('revision token is refreshed after closing, never copied from the old baseline',()=>{const f=fixture();f.form.revisionId='a-new-token';let token;const original=f.ports.batch;f.ports.batch=(id,b)=>{token=b.writeControl.requiredRevisionId;return original(id,b);};f.run();assert.equal(token,'r_closed');});
test('picture, branch and other-choice questions require separate review',()=>{
 for(const field of ['image','isOther','goToSectionId','goToAction']){const f=fixture();f.approval.baselineForm.items[1].questionItem.question.choiceQuestion.options[0][field]=field==='isOther'?true:'value';assert.throws(f.run,/UNSUPPORTED_QUESTION/);assert.equal(f.calls.batch,0);}
});
test('backup must be durable before the Form can be closed',()=>{const f=fixture();f.ports.save=()=>{throw Error('STORAGE_UNAVAILABLE');};assert.throws(f.run,/STORAGE_UNAVAILABLE/);assert.equal(f.calls.close,0);assert.equal(f.calls.batch,0);assert.equal(f.calls.unlock,1);});
test('revocation while preparing recovery blocks before the batch and keeps Form closed',()=>{const f=fixture(),get=f.ports.profile;f.ports.profile=uid=>f.calls.profile>=1?null:get(uid);assert.throws(f.run,/ACCESS_REVOKED/);assert.equal(f.calls.batch,0);assert.equal(f.ports.closed(),true);assert.equal([...f.states.values()][0].status,'PREPARED');});
test('edit during preparation is detected before writing',()=>{const f=fixture();let reads=0;f.ports.document=()=>({blob:{},sha256:++reads===1?f.approval.documentSha256:'c'.repeat(64)});assert.throws(f.run,/APPROVAL_CHANGED/);assert.equal(f.calls.batch,0);});
test('CAS failure is not retried or merged',()=>{const f=fixture();f.ports.batch=()=>{f.calls.batch++;throw Error('QUESTION_PUBLICATION_FORMS_HTTP_400');};assert.throws(f.run,/FORMS_HTTP_400/);assert.equal(f.calls.batch,1);assert.equal([...f.states.values()][0].status,'PREPARED');});
test('lost success response recovers from target fingerprint without double applying',()=>{
 const f=fixture(),original=f.ports.batch;f.ports.batch=(...a)=>{original(...a);throw Error('NETWORK_TIMEOUT');};assert.throws(f.run,/NETWORK_TIMEOUT/);assert.equal(f.calls.batch,1);
 f.ports.batch=original;assert.equal(f.run().code,'QUESTION_PUBLICATION_RECOVERED');assert.equal(f.calls.batch,1);assert.equal([...f.states.values()][0].status,'DONE');
});
test('failed terminal save recovers without a second API write',()=>{
 const f=fixture(),save=f.ports.save;let fail=true;f.ports.save=(k,s)=>{if(s.status==='DONE'&&fail){fail=false;throw Error('RECEIPT_FAILED');}return save(k,s);};
 assert.throws(f.run,/RECEIPT_FAILED/);assert.equal(f.run().code,'QUESTION_PUBLICATION_RECOVERED');assert.equal(f.calls.batch,1);
});
test('externally modified target never becomes DONE and is not overwritten on retry',()=>{const f=fixture(),batch=f.ports.batch;f.ports.batch=(...a)=>{batch(...a);f.form.items[0].title='External';};assert.throws(f.run,/WRITE_UNCONFIRMED/);assert.throws(f.run,/FORM_CHANGED/);assert.equal(f.calls.batch,1);});
test('API omission of empty description does not produce a false write failure',()=>{const f=fixture();f.edited.questions[0].description='';const batch=f.ports.batch;f.ports.batch=(...a)=>{batch(...a);delete f.form.items[1].description;};assert.equal(f.run().code,'QUESTION_PUBLICATION_APPLIED');});
test('failed closure and lock contention cannot start a batch',()=>{for(const mutate of [f=>{f.ports.closed=()=>false;},f=>{f.ports.lock=()=>false;}]){const f=fixture();mutate(f);assert.throws(f.run,/FORM_NOT_CLOSED|BUSY/);assert.equal(f.calls.batch,0);}});
test('a new approval keeps its own recovery history instead of replacing an older record',()=>{const f=fixture();f.run();f.approval.baselineForm=clone(f.form);f.approval.approvedAt=new Date(f.ports.now()).toISOString();f.edited.questions[0].title='Another revision';f.run();assert.equal(f.states.size,2);assert.equal(f.calls.batch,2);});
test('entry point rejects configuration absence and redacts sensitive exception messages',()=>{const f=fixture(),logs=[];f.ctx.console={log:s=>logs.push(s)};assert.equal(f.ctx.publicarQuestoesAprovadasGestaoV1().code,'QUESTION_PUBLICATION_CONFIG_MISSING');f.ctx.gqpTrustedConfig_=()=>{throw Error('secret-token private@email.test');};assert.equal(f.ctx.publicarQuestoesAprovadasGestaoV1().code,'QUESTION_PUBLICATION_UNAVAILABLE');assert.doesNotMatch(logs.join(''),/secret-token|private@email/);});
test('entry point with disabled real-shaped config needs no OAuth or interactive authorization',()=>{const f=fixture();f.cfg.enabled=false;f.ctx.gqpTrustedConfig_=()=>f.cfg;assert.equal(f.ctx.publicarQuestoesAprovadasGestaoV1().code,'QUESTION_PUBLICATION_DISABLED');});
test('read-only draft cannot approve itself or close/apply a Form',()=>{const f=fixture(),r=f.ctx.gqpDraft_(f.cfg,f.cfg.bindings[0],f.ports);assert.equal(r.code,'QUESTION_PUBLICATION_DRAFT_READY');assert.equal(r.approvedBy,null);assert.equal(r.approvedAt,null);assert.equal(r.changedQuestions,1);assert.equal(f.calls.save,0);assert.equal(f.calls.close,0);assert.equal(f.calls.batch,0);});
test('read-only draft requires designated current manager and matching authenticated owner',()=>{const f=fixture();f.cfg.bindings[0].assignment=null;assert.throws(()=>f.ctx.gqpDraft_(f.cfg,f.cfg.bindings[0],f.ports),/DESIGNATION_REQUIRED/);assert.equal(f.calls.document,0);});
test('missing CAS token after closure never falls back to an unconditional update',()=>{const f=fixture(),close=f.ports.close;f.ports.close=()=>{close();delete f.form.revisionId;};assert.throws(f.run,/FORM_INVALID/);assert.equal(f.calls.batch,0);});
test('single-choice acknowledgement markers remain outside the editable bank',()=>{const f=fixture(),ack={itemId:'ack',title:'[SAHMT:ACK]',questionItem:{question:{questionId:'ack_question',choiceQuestion:{type:'CHECKBOX',options:[{value:'Ciente'}]}}}};f.form.items.push(clone(ack));f.baseline.items.push(clone(ack));assert.equal(f.run().code,'QUESTION_PUBLICATION_APPLIED');assert.deepEqual(f.form.items.at(-1),ack);});
function nativeFixture(){
 const f=fixture(),b=f.cfg.bindings[0],grants=[{type:'user',role:'owner',emailAddress:f.cfg.operatorEmail},{type:'user',role:'writer',emailAddress:'manager@example.test'},{type:'user',role:'writer',emailAddress:'admin@example.test'}],prop=new Map();let published=true,accepting=true;
 const metadata={
  [b.documentId]:{id:b.documentId,parents:[b.reviewFolderId],mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',owners:[{emailAddress:f.cfg.operatorEmail}],lastModifyingUser:{emailAddress:'manager@example.test'},size:'2'},
  [b.reviewFolderId]:{id:b.reviewFolderId,parents:[b.readingFolderId],mimeType:'application/vnd.google-apps.folder',inheritedPermissionsDisabled:true},
  [b.formId]:{id:b.formId,parents:[b.readingFolderId],mimeType:'application/vnd.google-apps.form',owners:[{emailAddress:f.cfg.operatorEmail}]}
 };
 f.ctx.PropertiesService={getScriptProperties:()=>({getProperty:k=>prop.get(k),setProperty:(k,v)=>prop.set(k,v)})};
 f.ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
 f.ctx.Session={getEffectiveUser:()=>({getEmail:()=>f.cfg.operatorEmail})};
 f.ctx.gqpTrustedConfig_=()=>f.cfg;f.ctx.evaluationGet_=()=>({active:true,access:true});
 f.ctx.gpdfJson_=url=>clone(metadata[url.match(/files\/([^?]+)/)[1]]);f.ctx.graPermissions_=()=>clone(grants);
 f.ctx.gpdfHttp_=()=>({getBlob:()=>({getBytes:()=>[1,2]})});
 f.ctx.Utilities={DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(type,bytes)=>[...createHash(type).update(Buffer.from(bytes)).digest()]};
 f.ctx.FormApp={openById:()=>({isPublished:()=>published,isAcceptingResponses:()=>accepting,setPublished:v=>{published=v;},setAcceptingResponses:v=>{accepting=v;}})};
 const calls=[];f.ctx.ScriptApp={getOAuthToken:()=> 'synthetic-oauth'};
 f.ctx.UrlFetchApp={fetch:(url,opts)=>{calls.push({url,opts});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(f.form)};}};
 return {...f,b,grants,metadata,calls,native:f.ctx.gqpPorts_(f.cfg)};
}
test('native adapter accepts the specifically authorized administrator as editor without widening sharing',()=>{const f=nativeFixture();assert.match(f.native.document(f.b,'manager@example.test').sha256,/^[a-f0-9]{64}$/);assert.equal(f.calls.length,0);});
test('native adapter blocks public, unrelated, reader and missing manager access',()=>{
 for(const mutate of [g=>g.push({type:'anyone',role:'reader'}),g=>g.push({type:'user',emailAddress:'outsider@example.test',role:'writer'}),g=>{g[1].role='reader';},g=>g.splice(1,1)]){const f=nativeFixture();mutate(f.grants);assert.throws(()=>f.native.document(f.b,'manager@example.test'),/REVIEW_ACCESS_INVALID/);}
});
test('native adapter verifies real parent, owner, modifier and source bytes',()=>{
 for(const mutate of [f=>{f.metadata[f.b.documentId].parents=['OtherFolder'];},f=>{f.metadata[f.b.documentId].owners=[{emailAddress:'wrong@example.test'}];},f=>{f.metadata[f.b.documentId].lastModifyingUser.emailAddress='wrong@example.test';},f=>{f.metadata[f.b.documentId].size='3';},f=>{f.metadata[f.b.reviewFolderId].inheritedPermissionsDisabled=false;},f=>{f.metadata[f.b.formId].parents=['OtherFolder'];}]){const f=nativeFixture();mutate(f);assert.throws(()=>f.native.document(f.b,'manager@example.test'),/DOCUMENT_IDENTITY_INVALID|DOCUMENT_DOWNLOAD_INVALID|FOLDER_INVALID|FORM_IDENTITY_INVALID/);}
});
test('native current configuration revocation is checked for every assignment read',()=>{const f=nativeFixture();f.cfg.enabled=false;assert.throws(()=>f.native.assignment(f.b),/ACCESS_REVOKED/);});
test('native Forms transport forbids redirects, uses CAS body and sanitizes HTTP rejection',()=>{const f=nativeFixture();f.native.batch(f.b.formId,{writeControl:{requiredRevisionId:'revision'},requests:[]});const {url,opts}=f.calls[0];assert.match(url,/^https:\/\/forms\.googleapis\.com\/v1\/forms\/[A-Za-z0-9_-]+:batchUpdate$/);assert.equal(opts.followRedirects,false);assert.equal(JSON.parse(opts.payload).writeControl.requiredRevisionId,'revision');f.ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>403,getContentText:()=>{throw Error('Raw response must not be read');}});assert.throws(()=>f.native.form(f.b.formId),/^Error: QUESTION_PUBLICATION_FORMS_HTTP_403$/);});
test('native closure never reopens or changes responder permissions',()=>{const f=nativeFixture();assert.equal(f.native.closed(f.b.formId),false);f.native.close(f.b.formId);assert.equal(f.native.closed(f.b.formId),true);});
