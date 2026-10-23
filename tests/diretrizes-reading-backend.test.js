import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,createHmac,randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../apps-script-v2/DiretrizesReading.gs',import.meta.url),'utf8');
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
test('deployed receiver forwards the reading action before other handlers',()=>{
 const event={parameter:{action:'diretrizes-reading-v1'}},calls=[];
 const c=vm.createContext({diretrizesReadingHttp_:e=>{calls.push(e);return 'READING_HANDLER';}});
 vm.runInContext(readFileSync(new URL('../apps-script-v2/OperationalSheetPush.gs',import.meta.url),'utf8'),c);
 assert.equal(c.doPost(event),'READING_HANDLER');assert.equal(calls.length,1);assert.equal(calls[0],event);
});
test('ROP release refuses a receiver without its reading dispatch',()=>{
 const c=vm.createContext({doPost:()=>{},ropsOwner_:()=>{throw Error('OWNER_CHECK_REACHED');}});
 vm.runInContext(readFileSync(new URL('../apps-script-v2/RopsReadingRelease.gs',import.meta.url),'utf8'),c);
 assert.throws(()=>c.ropsReleaseLoad_(),/ROPS_READING_DISPATCH_MISSING/);
 c.doPost=function(){return 'diretrizes-reading-v1';};
 assert.throws(()=>c.ropsReleaseLoad_(),/OWNER_CHECK_REACHED/);
});
function fixture() {
 const data=new Map(),props=new Map(),grants=[];
 const policy={version:1,pilotUids:['reader'],documents:{doc:{formId:'FormFixture123456',pdfId:'PdfFixture1234567',checksum:'a'.repeat(32),pages:2,version:1,enforced:true}}};
 props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(policy));
 props.set('SAHMT_READING_ENABLED','YES');
 props.set('SAHMT_READING_HMAC_SECRET','k'.repeat(43));
 props.set('SAHMT_READING_CUTOVER_SHA256',sha(JSON.stringify(policy.documents)));
 data.set('users/reader',{uid:'reader',email:'reader@example.test',active:true,access:true,permissions:{managementRead:true}});
 data.set('documentAccessEmails/reader@example.test',{id:'reader@example.test',email:'reader@example.test',active:true,groups:['GENERAL']});
 data.set('scopedDocuments/doc',{id:'doc',driveFileId:'FormFixture123456',category:'DIRETRIZES',audienceGroup:'GENERAL',managementAreaId:'area-gestao-de-documentos',active:true});
 data.set('scopedDocuments/pdf_doc',{id:'pdf_doc',driveFileId:'PdfFixture1234567',driveUrl:'https://drive.google.com/file/d/PdfFixture1234567/view',category:'DIRETRIZES',audienceGroup:'GENERAL',managementAreaId:'area-gestao-de-documentos',active:true});
 data.set('managementAreas/area-gestao-de-documentos',{active:true});
 const ctx=vm.createContext({Date,Math,JSON,Set,Map,Number,Object,Array,String,Error,RegExp,
  sahmtV2Properties_:()=>({getProperty:k=>props.get(k)||null}),
  sha256Hex_:sha,formsEvaluationHash_:value=>sha(JSON.stringify(value)),evaluationClean_:value=>structuredClone(value),ospEqual_:(a,b)=>a===b,
  Utilities:{getUuid:randomUUID,Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(value,key)=>Array.from(createHmac('sha256',key).update(value).digest()),base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),base64DecodeWebSafe:value=>Buffer.from(value,'base64url'),newBlob:value=>({getDataAsString:()=>Buffer.from(value).toString('utf8')})},
  evaluationGet_:(c,id)=>structuredClone(data.get(c+'/'+id)||null),
  evaluationCollectionProject_:()=> 'sahmt-gestao-5ae66',
  evaluationDocumentsUrl_:()=> 'https://firestore.invalid/batchGet',
  evaluationDocument_:doc=>structuredClone(doc.fields),
  firestoreRequest_:(_url,options)=>JSON.parse(options.payload).documents.map(name=>{const key=name.split('/documents/')[1],fields=data.get(key);return fields?{found:{name,fields}}:{missing:name};}),
  evaluationWrite_:(c,id,changes)=>({c,id,changes}),
  evaluationRunTransaction_:fn=>{const out=fn('tx');for(const w of out.writes)data.set(w.c+'/'+w.id,structuredClone(w.changes));return out.result;}
 });
 vm.runInContext(source,ctx);
 const nativeGrant=ctx.dgrGrant_;
 ctx.dgrPdf_=()=>({bytes:'JVBERi0=',checksum:'a'.repeat(32)});
 ctx.dgrGrant_=(_p,email)=>{grants.push(email);return 'https://docs.google.com/forms/d/e/PublicFixture12345/viewform';};
 const send=(action,extra={})=>ctx.dgrHandle_({uid:'reader',email:'reader@example.test',action,documentId:'doc',...extra});
 return {ctx,send,data,props,policy,grants,nativeGrant};
}

test('backend diagnostics distinguish quota, backoff and permissions without exposing error text',()=>{
 const f=fixture();
 for(const [error,expected] of [[{status:429,retryAfter:Date.now()+60000},'READING_FIRESTORE_BACKOFF'],[{status:429},'READING_FIRESTORE_QUOTA_WAIT'],[{status:403},'READING_FIRESTORE_FORBIDDEN'],[{status:403,service:'drive'},'READING_GOOGLE_FORBIDDEN'],[{status:401},'READING_BACKEND_UNAUTHORIZED'],[{status:503},'READING_BACKEND_UPSTREAM_FAILED']])assert.equal(f.ctx.dgrFailureCode_({...error,message:'private contents'}),expected);
});
test('first read, coverage and idempotent completion retain identity without scoring',()=>{
 const f=fixture(),s=f.send('start');assert.equal(s.code,'READING_STARTED');
 assert.throws(()=>f.send('complete',{sessionId:s.sessionId,pages:[1]}),/READING_INCOMPLETE/);
 const r=f.send('complete',{sessionId:s.sessionId,pages:[1,2]});assert.equal(r.code,'READING_RELEASED');
 assert.equal(f.send('complete',{sessionId:s.sessionId,pages:[1,2]}).code,'READING_RELEASED');
 assert.equal(f.grants.length,2);assert.deepEqual(f.grants,['reader@example.test','reader@example.test']);
 assert.ok([...f.data.keys()].every(k=>!k.startsWith('evaluationAwards/')));
});

test('authorized PDF delivery precedes receipt writes and ticket start reuses the same authorization',()=>{
 const f=fixture(),before=f.data.size;let batches=0;const native=f.ctx.firestoreRequest_;f.ctx.firestoreRequest_=(...args)=>{batches++;return native(...args);};
 const material=f.send('open');assert.equal(material.code,'READING_PREPARED');assert.equal(f.data.size,before);assert.equal(batches,1);assert.equal(f.grants.length,0);
 assert.throws(()=>f.send('complete',{sessionId:'a'.repeat(32),pages:[1,2]}),/READING_SESSION_INVALID/);
 const start=f.send('start',{openTicket:material.openTicket});assert.equal(start.code,'READING_STARTED');assert.equal(start.pdfBase64,undefined);assert.equal(batches,2);
 assert.throws(()=>f.send('complete',{sessionId:start.sessionId,pages:[1]}),/READING_INCOMPLETE/);
 f.data.get('users/reader').active=false;
 assert.throws(()=>f.send('complete',{sessionId:start.sessionId,pages:[1,2]}),/READING_ACCESS_DENIED/);assert.equal(f.grants.length,0);
});

test('short handoff rejects tampering, expiry, identity and document policy changes',()=>{
 for(const kind of ['mac','email','expiry','policy']){
  const f=fixture(),material=f.send('open');let ticket=material.openTicket;
  if(kind==='mac')ticket=ticket.slice(0,-1)+(ticket.endsWith('0')?'1':'0');
  if(kind==='email')ticket=f.ctx.dgrOpenTicket_({uid:'reader',email:'other@example.test',documentId:'doc'},f.policy.documents.doc,f.policy);
  if(kind==='expiry'){const now=Date.now();f.ctx.Date={now:()=>now+46000};}
  if(kind==='policy'){f.policy.documents.doc.version++;f.props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(f.policy));f.props.set('SAHMT_READING_CUTOVER_SHA256',sha(JSON.stringify(f.policy.documents)));}
  assert.throws(()=>f.send('start',{openTicket:ticket}),/READING_SESSION_INVALID/);assert.equal(f.grants.length,0);
 }
});

test('training revision during PDF delivery blocks ticket receipt creation',()=>{
 const f=fixture(),id=f.policy.documents.doc.formId;
 f.data.set('evaluationFormConfigs/'+id,{status:'READY',version:1,repeatPolicy:'FIRST_RESPONSE_PER_VERSION'});
 const material=f.send('open');f.data.get('evaluationFormConfigs/'+id).version=2;
 assert.throws(()=>f.send('start',{openTicket:material.openTicket}),/READING_CUTOVER_REQUIRED/);
});

test('preflight batches fresh project-routed reads, deduplicates and rejects incomplete replies',()=>{
 const f=fixture(),requests=[],original=f.ctx.firestoreRequest_;
 f.ctx.firestoreRequest_=(url,options)=>{requests.push(JSON.parse(options.payload));return original(url,options);};
 f.send('start');assert.equal(requests.length,1);assert.equal(requests[0].documents.length,6);
 f.data.get('users/reader').active=false;assert.throws(()=>f.send('start'),/READING_ACCESS_DENIED/);
 assert.equal(requests.length,2);
 f.ctx.firestoreRequest_=()=>[];assert.throws(()=>f.send('start'),/READING_PREFLIGHT_INVALID/);
 f.ctx.firestoreRequest_=original;
 const read=f.ctx.dgrPreflight_({uid:'reader',email:'reader@example.test',documentId:'doc'},{pdfId:'PdfFixture1234567',formId:null});
 assert.ok(read('scopedDocuments','doc'));assert.throws(()=>read('users','other'),/READING_PREFLIGHT_INVALID/);
});
for(const [label,mutate] of [
 ['disabled',f=>f.props.delete('SAHMT_READING_ENABLED')],
 ['inactive',f=>f.data.get('users/reader').active=false],
 ['email mismatch',f=>f.data.get('users/reader').email='other@example.test'],
 ['no audience',f=>f.data.get('documentAccessEmails/reader@example.test').groups=[]],
 ['pilot denied',f=>{f.policy.pilotUids=['other'];f.props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(f.policy));}],
 ['cutover absent',f=>{f.policy.documents.doc.enforced=false;f.props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(f.policy));}]
])test(label+' fails closed',()=>{const f=fixture();mutate(f);assert.throws(()=>f.send('start'));assert.equal(f.grants.length,0);});
test('user swap, expired sessions and page forgery denied',()=>{
 const f=fixture(),s=f.send('start');
 assert.throws(()=>f.send('complete',{sessionId:'f'.repeat(32),pages:[1,2]}));
 assert.throws(()=>f.send('complete',{sessionId:s.sessionId,pages:[1,2,3]}));
 const row=[...f.data.values()].find(r=>r.sessionId===s.sessionId);row.expiresAt=0;
 assert.throws(()=>f.send('complete',{sessionId:s.sessionId,pages:[1,2]}));
});
test('changed PDF checksum and version cannot reuse completion',()=>{
 const f=fixture(),s=f.send('start');f.ctx.dgrPdf_=()=>{throw Error('READING_MATERIAL_CHANGED');};
 assert.throws(()=>f.send('complete',{sessionId:s.sessionId,pages:[1,2]}),/READING_MATERIAL_CHANGED/);
 assert.equal(f.grants.length,0);
});
test('grant failure preserves completion for explicit retry',()=>{
 const f=fixture(),s=f.send('start');f.ctx.dgrGrant_=()=>{throw Error('READING_GRANT_PENDING');};
 assert.throws(()=>f.send('complete',{sessionId:s.sessionId,pages:[1,2]}),/READING_GRANT_PENDING/);
 assert.equal([...f.data.values()].find(r=>r.sessionId===s.sessionId).status,'COMPLETED');
});
test('batched progress survives restart and only own receipt is resumed',()=>{
 const f=fixture(),s=f.send('start');
 assert.equal(f.send('progress',{sessionId:s.sessionId,pages:[1]}).code,'READING_PROGRESS_SAVED');
 const resumed=f.send('start');assert.equal(resumed.sessionId,s.sessionId);assert.deepEqual(Array.from(resumed.visited),[1]);
 assert.equal(f.send('complete',{sessionId:s.sessionId,pages:[2]}).code,'READING_RELEASED');
});
test('expired session renewal retains server-confirmed pages for the same version',()=>{
 const f=fixture(),s=f.send('start');f.send('progress',{sessionId:s.sessionId,pages:[1]});
 const state=[...f.data.values()].find(r=>r.sessionId===s.sessionId);state.expiresAt=0;
 const renewed=f.send('start');assert.notEqual(renewed.sessionId,s.sessionId);assert.deepEqual(Array.from(renewed.visited),[1]);
});
test('legacy finalizer skips gated forms without touching READY evaluation configuration',()=>{
 const f=fixture();vm.runInContext(readFileSync(new URL('../apps-script-v2/FormsEvaluation.gs',import.meta.url),'utf8'),f.ctx);
 let reads=0;f.ctx.dgrManagedForm_=()=>true;f.ctx.evaluationGet_=()=>{reads++;return null;};
 assert.equal(f.ctx.formsEvaluationFinalizePublication_('FormFixture123456').status,'READING_MANAGED');assert.equal(reads,0);
});
for(const stage of ['permissions','final identity'])test('transient '+stage+' failure preserves an open form and retries successfully',()=>{
 const f=fixture(),row=f.policy.documents.doc;let failure=true,closed=false,permissions=[];
 f.ctx.FormApp={openById:()=>({supportsAdvancedResponderPermissions:()=>true,isPublished:()=>!closed,isAcceptingResponses:()=>!closed,getPublishedUrl:()=> 'https://docs.google.com/forms/d/e/PublicFixture12345/viewform'})};
 f.ctx.formsEvaluationPublishedPermissions_=()=>{if(failure&&stage==='permissions')throw Error('network');return permissions;};
 const identity=f.ctx.dgrIdentity_;f.ctx.dgrIdentity_=(...args)=>{if(failure&&stage==='final identity')throw Error('network');return identity(...args);};
 f.ctx.formsEvaluationExpectedOwners_=()=>[];f.ctx.formsEvaluationCloseForm_=()=>{closed=true;};
 f.ctx.formsEvaluationGoogleRequest_=(_url,options)=>{permissions.push({...JSON.parse(options.payload),id:'granted'});};
 f.data.set('documentReadingReceipts/'+f.ctx.dgrReceiptId_('reader','doc',row),{uid:'reader',email:'reader@example.test',status:'COMPLETED',materialVersion:1,checksum:row.checksum});
 assert.throws(()=>f.nativeGrant(row,'reader@example.test','doc',f.policy,'reader'),/READING_GRANT_PENDING/);assert.equal(closed,false);
 failure=false;assert.match(f.nativeGrant(row,'reader@example.test','doc',f.policy,'reader'),/viewform$/);
});
test('real grant helper is idempotent and closes on audience drift',()=>{
 const f=fixture();let permissions=[],created=0,closed=0;
 f.ctx.FormApp={openById:()=>({supportsAdvancedResponderPermissions:()=>true,isPublished:()=>true,isAcceptingResponses:()=>true,getPublishedUrl:()=> 'https://docs.google.com/forms/d/e/PublicFixture12345/viewform'})};
 f.ctx.formsEvaluationPublishedPermissions_=()=>permissions;
 f.ctx.formsEvaluationExpectedOwners_=()=>[];
 f.ctx.formsEvaluationCloseForm_=()=>{closed++;};
 f.ctx.evaluationQuery_=()=>[{status:'COMPLETED',uid:'reader',email:'reader@example.test',checksum:'a'.repeat(32),materialVersion:1}];
 f.ctx.firestoreFilter_=()=>({});
 f.ctx.formsEvaluationGoogleRequest_=(_url,options)=>{created++;permissions.push({...JSON.parse(options.payload),id:'grant'});};
 f.ctx.dgrGrant_=f.nativeGrant;
 const row=f.policy.documents.doc;
 f.data.set('documentReadingReceipts/'+f.ctx.dgrReceiptId_('reader','doc',row),{uid:'reader',email:'reader@example.test',status:'COMPLETED',materialVersion:1,checksum:row.checksum});
 assert.match(f.nativeGrant(row,'reader@example.test','doc',f.policy,'reader'),/viewform$/);
 f.nativeGrant(row,'reader@example.test','doc',f.policy,'reader');assert.equal(created,1);
 permissions.push({id:'broad',type:'anyone',role:'reader',view:'published'});
 assert.throws(()=>f.nativeGrant(row,'reader@example.test','doc',f.policy,'reader'),/READING_GRANT_PENDING/);
 assert.equal(closed,1);
});
test('legacy publication guard persists with feature disabled and broken policy',()=>{
 const f=fixture();f.props.delete('SAHMT_READING_ENABLED');
 assert.equal(f.ctx.dgrManagedForm_('FormFixture123456'),true);
 f.props.set('SAHMT_READING_POLICY_JSON','invalid');assert.equal(f.ctx.dgrManagedForm_('unrelated'),true);
});
test('receiver authenticates HMAC, rejects replay/expiry/tampering before work',async()=>{
 const {createHmac}=await import('node:crypto');const f=fixture(),key='k'.repeat(43),props=f.props;
 props.set('SAHMT_READING_HMAC_SECRET',key);
 f.ctx.sahmtV2Properties_=()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)});
 f.ctx.Utilities={...f.ctx.Utilities,Charset:{UTF_8:'utf8'},computeHmacSha256Signature:(value,secret)=>Array.from(createHmac('sha256',secret).update(value).digest()),base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),base64DecodeWebSafe:value=>Buffer.from(value,'base64url'),newBlob:value=>({getDataAsString:()=>Buffer.from(value).toString('utf8')})};
 f.ctx.ospEqual_=(a,b)=>a===b;f.ctx.ospJson_=x=>x;f.ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
 let calls=0;f.ctx.dgrHandle_=()=>{calls++;return {code:'READING_STARTED'};};
 const now=Date.now(),input={v:1,aud:'sahmt-diretrizes-reading',nonce:'f'.repeat(32),issuedAt:now,expiresAt:now+60000,uid:'reader',email:'reader@example.test',action:'start',documentId:'doc'};
 const send=(data,tamper=false)=>{const payload=Buffer.from(JSON.stringify(data)).toString('base64url'),mac=createHmac('sha256',key).update('SAHMT_READING_V1\n'+payload).digest('hex');const r=f.ctx.diretrizesReadingHttp_({postData:{contents:JSON.stringify({payload,mac:tamper?'a'.repeat(64):mac})}});return r.payload?JSON.parse(Buffer.from(r.payload,'base64url').toString()):r;};
 assert.equal(send(input,true).code,'READING_DENIED');assert.equal(calls,0);
 assert.equal(send(input).code,'READING_STARTED');assert.equal(calls,1);
 assert.equal(send(input).code,'READING_REPLAY_DENIED');assert.equal(calls,1);
 assert.equal(send({...input,nonce:'e'.repeat(32),issuedAt:now-120000,expiresAt:now-60000}).code,'READING_INPUT_INVALID');assert.equal(calls,1);
 f.ctx.dgrHandle_=()=>{throw new ReferenceError('private-helper is not defined');};
 const failed=send({...input,nonce:'d'.repeat(32)});assert.equal(failed.code,'READING_BACKEND_REFERENCE_FAILED');assert.ok(!JSON.stringify(failed).includes('private-helper'));
});
test('Apps Script setup is valid V8 syntax',()=>{
 assert.doesNotThrow(()=>new vm.Script(readFileSync(new URL('../apps-script-v2/DiretrizesReadingSetup.gs',import.meta.url),'utf8')));
});
function setupFixture(){
 const f=fixture();vm.runInContext(readFileSync(new URL('../apps-script-v2/DiretrizesReadingSetup.gs',import.meta.url),'utf8'),f.ctx);
 f.policy.documents.doc.enforced=false;f.props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(f.policy));f.props.set('SAHMT_READING_ENABLED','NO');f.props.delete('SAHMT_READING_CUTOVER_SHA256');
 f.props.set('SAHMT_READING_OPERATOR_EMAIL','operator@example.test');
 f.ctx.sahmtV2Properties_=()=>({getProperty:k=>f.props.get(k)||null,setProperty:(k,v)=>f.props.set(k,v),deleteProperty:k=>f.props.delete(k),getProperties:()=>Object.fromEntries(f.props)});
 f.ctx.Session={getEffectiveUser:()=>({getEmail:()=> 'operator@example.test'}),getActiveUser:()=>({getEmail:()=> 'operator@example.test'})};
 f.ctx.ScriptApp={getScriptId:()=> 'synthetic-script'};f.ctx.console={log:()=>{}};
 f.ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})};
 const fileContents=new Map();f.ctx.DriveApp={Access:{PRIVATE:'private'},Permission:{NONE:'none'},createFile:(_name,content)=>{fileContents.set('PrivateBackup123456',content);return {getId:()=> 'PrivateBackup123456',setSharing:()=>{}};},getFileById:id=>({getBlob:()=>({getDataAsString:()=>fileContents.get(id)})})};
 let permissions=[{id:'owner',type:'user',role:'owner',emailAddress:'operator@example.test'},{id:'reader',type:'user',role:'reader',view:'published',emailAddress:'reader@example.test'}],writes=0;
 const form={published:true,accepting:true,supportsAdvancedResponderPermissions:()=>true,isPublished:()=>form.published,isAcceptingResponses:()=>form.accepting,setPublished:value=>{writes++;form.published=value;},setAcceptingResponses:value=>{writes++;form.accepting=value;}};
 f.ctx.FormApp={openById:()=>form};f.ctx.formsEvaluationPublishedPermissions_=()=>structuredClone(permissions);
 f.ctx.formsEvaluationCloseForm_=()=>{writes++;form.published=false;form.accepting=false;};
 f.ctx.formsEvaluationGoogleRequest_=(url,options)=>{writes++;if(options.method==='delete')permissions=permissions.filter(p=>p.id!==url.match(/permissions\/([^?]+)/)[1]);else permissions.push({...JSON.parse(options.payload),id:'restored-reader'});return {};};
 return {...f,form,permissions:()=>permissions,writes:()=>writes};
}
test('cutover preparation is read-only for Forms; installation preserves editors; repeat is no-op and rollback restores audience',()=>{
 const f=setupFixture();assert.equal(f.ctx.prepararBloqueioIndividualDiretrizesV1().code,'READING_RECOVERY_PREPARED');assert.equal(f.writes(),0);
 assert.equal(f.ctx.instalarBloqueioIndividualDiretrizesV1().code,'READING_CUTOVER_VERIFIED');
 assert.equal(f.permissions().filter(p=>p.view==='published').length,0);assert.equal(f.permissions()[0].role,'owner');
 const writes=f.writes();assert.equal(f.ctx.instalarBloqueioIndividualDiretrizesV1().code,'READING_CUTOVER_ALREADY_VERIFIED');assert.equal(f.writes(),writes);
 assert.equal(f.props.get('SAHMT_READING_ENABLED'),'NO');
 assert.equal(f.ctx.reverterBloqueioIndividualDiretrizesV1().code,'READING_ROLLBACK_VERIFIED');
 assert.equal(f.permissions().filter(p=>p.view==='published').length,1);assert.equal(f.permissions()[0].role,'owner');
 assert.equal(f.form.published,true);assert.equal(f.form.accepting,true);
});
test('operator mismatch and absent recovery never change permissions',()=>{
 const f=setupFixture();assert.throws(()=>f.ctx.instalarBloqueioIndividualDiretrizesV1());assert.equal(f.writes(),0);
 f.ctx.Session.getActiveUser=()=>({getEmail:()=> 'another@example.test'});
 assert.throws(()=>f.ctx.prepararBloqueioIndividualDiretrizesV1(),/READING_OPERATOR_DENIED/);assert.equal(f.writes(),0);
});

function bindPolicy(f){f.props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(f.policy));f.props.set('SAHMT_READING_CUTOVER_SHA256',sha(JSON.stringify(f.policy.documents)));}
for(const category of ['Protocolos','ROPs','Diretrizes','Documentos administrativos','Organograma'])for(const audienceGroup of ['GENERAL','RESTRICTED'])test(category+' respects exact '+audienceGroup+' authorization',()=>{
 const f=fixture();Object.assign(f.policy.documents.doc,{category,audienceGroup});
 for(const id of ['doc','pdf_doc'])Object.assign(f.data.get('scopedDocuments/'+id),{category,audienceGroup});bindPolicy(f);
 f.data.get('documentAccessEmails/reader@example.test').groups=[audienceGroup];assert.equal(f.send('start').code,'READING_STARTED');
 f.data.get('documentAccessEmails/reader@example.test').groups=[audienceGroup==='GENERAL'?'RESTRICTED':'GENERAL'];
 f.data.get('users/reader').role='administrador_app';assert.throws(()=>f.send('start'),/READING_ACCESS_DENIED/);assert.equal(f.grants.length,0);
});
test('category or audience drift in either catalog record denies reading',()=>{
 for(const field of ['category','audienceGroup'])for(const id of ['doc','pdf_doc']){
 const f=fixture();f.data.get('scopedDocuments/'+id)[field]='CHANGED';assert.throws(()=>f.send('start'),/READING_CATALOG_CHANGED/);}
});
test('reader-only records complete without requesting Form permission or inventing a URL',()=>{
 const f=fixture();Object.assign(f.policy.documents.doc,{formId:null,pdfDocumentId:'pdf_doc',sourceFileId:'OriginalFixture12345'});f.data.get('scopedDocuments/doc').driveFileId='OriginalFixture12345';bindPolicy(f);
 const start=f.send('start');assert.equal(start.hasForm,false);const answer=f.send('complete',{sessionId:start.sessionId,pages:[1,2]});
 assert.equal(answer.code,'READING_COMPLETED');assert.equal(answer.formUrl,undefined);assert.equal(f.grants.length,0);
});
test('growing policy shards round trip and invalid, missing or reordered shards fail closed',async()=>{
 const {readingPolicyProperties}=await import('../scripts/prepare-diretrizes-reading.mjs');const f=fixture();
 f.policy.pilotUids=Array.from({length:300},(_,i)=>'reader_'+i+'x'.repeat(50));
 for(let i=0;i<43;i++)f.policy.documents['doc_'+i]={...f.policy.documents.doc,formId:'UniqueFixtureForm'+i,category:'Documentos administrativos',audienceGroup:'RESTRICTED'};
 const properties=readingPolicyProperties(f.policy);assert.ok(Object.keys(properties).length>2);
 for(const [key,value] of Object.entries(properties)){assert.ok(Buffer.byteLength(value)<=8000);f.props.set(key,value);}
 assert.equal(Object.keys(f.ctx.dgrPolicy_().documents).length,44);
 const shardKeys=Object.keys(properties).filter(k=>k!=='SAHMT_READING_POLICY_JSON'),key=shardKeys[0];f.props.set(key,properties[shardKeys[1]]);f.props.set(shardKeys[1],properties[key]);assert.throws(()=>f.ctx.dgrPolicy_(),/READING_CONFIG_INVALID/);for(const k of shardKeys)f.props.set(k,properties[k]);f.props.set(key,'x'.repeat(8001));assert.throws(()=>f.ctx.dgrPolicy_(),/READING_CONFIG_INVALID/);f.props.set(key,properties[key]+' ');assert.throws(()=>f.ctx.dgrPolicy_(),/READING_CONFIG_INVALID/);
 f.props.delete(key);assert.throws(()=>f.ctx.dgrPolicy_(),/READING_CONFIG_INVALID/);assert.equal(f.ctx.dgrManagedForm_('unregistered'),true);
});
test('setup and rollback preserve bounded sharded policy for reader-only records',()=>{
 const f=setupFixture();Object.assign(f.policy.documents.doc,{formId:null,pdfDocumentId:'pdf_doc'});f.data.get('scopedDocuments/doc').driveFileId=f.policy.documents.doc.pdfId;
 f.policy.pilotUids=Array.from({length:250},(_,i)=>'reader_'+i+'x'.repeat(50));
 f.ctx.dgrStorePolicy_(f.policy);assert.equal(JSON.parse(f.props.get('SAHMT_READING_POLICY_JSON')).storageVersion,2);
 assert.equal(f.ctx.prepararBloqueioIndividualDiretrizesV1().forms,0);assert.equal(f.ctx.instalarBloqueioIndividualDiretrizesV1().code,'READING_CUTOVER_VERIFIED');
 assert.equal(f.ctx.dgrPolicy_().documents.doc.enforced,true);assert.equal(f.ctx.reverterBloqueioIndividualDiretrizesV1().code,'READING_ROLLBACK_VERIFIED');
 assert.equal(f.ctx.dgrPolicy_().documents.doc.enforced,false);assert.equal(f.writes(),0);
 for(const value of f.props.values())assert.ok(Buffer.byteLength(value)<=8000);
});

test('questions-only revision also requires fresh reading for the new training version',()=>{
 const f=fixture(),cfg={formId:'FormFixture123456',creditScopeId:'matter',version:1,status:'READY',repeatPolicy:'FIRST_RESPONSE_PER_VERSION',maxTestScore:10};
 f.data.set('evaluationFormConfigs/'+cfg.formId,cfg);
 const first=f.send('start');f.send('complete',{sessionId:first.sessionId,pages:[1,2]});
 const old=f.data.get('evaluationParticipations/reading-'+f.ctx.dgrReceiptId_('reader','doc',{...f.policy.documents.doc,trainingVersion:1}));
 assert.equal(old.training.readingComplete,true);assert.equal('email' in old,false);assert.equal('sessionId' in old,false);
 cfg.version=2;f.data.set('evaluationFormConfigs/'+cfg.formId,cfg);
 const next=f.send('start');assert.deepEqual([...next.visited],[]);assert.notEqual(next.sessionId,first.sessionId);
 assert.throws(()=>f.send('complete',{sessionId:first.sessionId,pages:[1,2]}),/READING_SESSION_INVALID/);
});
