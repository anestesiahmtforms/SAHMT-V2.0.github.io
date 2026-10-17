import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../apps-script-v2/DiretrizesReading.gs',import.meta.url),'utf8');
const sha=x=>createHash('sha256').update(String(x)).digest('hex');
function fixture() {
 const data=new Map(),props=new Map(),grants=[];
 const policy={version:1,pilotUids:['reader'],documents:{doc:{formId:'FormFixture123456',pdfId:'PdfFixture1234567',checksum:'a'.repeat(32),pages:2,version:1,enforced:true}}};
 props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(policy));
 props.set('SAHMT_READING_ENABLED','YES');
 props.set('SAHMT_READING_CUTOVER_SHA256',sha(JSON.stringify(policy.documents)));
 data.set('users/reader',{uid:'reader',email:'reader@example.test',active:true,access:true,permissions:{managementRead:true}});
 data.set('documentAccessEmails/reader@example.test',{id:'reader@example.test',email:'reader@example.test',active:true,groups:['GENERAL']});
 data.set('scopedDocuments/doc',{id:'doc',driveFileId:'FormFixture123456',category:'DIRETRIZES',audienceGroup:'GENERAL',managementAreaId:'area-gestao-de-documentos',active:true});
 data.set('scopedDocuments/pdf_doc',{id:'pdf_doc',driveFileId:'PdfFixture1234567',driveUrl:'https://drive.google.com/file/d/PdfFixture1234567/view',category:'DIRETRIZES',audienceGroup:'GENERAL',managementAreaId:'area-gestao-de-documentos',active:true});
 data.set('managementAreas/area-gestao-de-documentos',{active:true});
 const ctx=vm.createContext({Date,Math,JSON,Set,Map,Number,Object,Array,String,Error,RegExp,
  sahmtV2Properties_:()=>({getProperty:k=>props.get(k)||null}),
  sha256Hex_:sha,formsEvaluationHash_:value=>sha(JSON.stringify(value)),evaluationClean_:value=>structuredClone(value),Utilities:{getUuid:randomUUID},
  evaluationGet_:(c,id)=>structuredClone(data.get(c+'/'+id)||null),
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
test('first read, coverage and idempotent completion retain identity without scoring',()=>{
 const f=fixture(),s=f.send('start');assert.equal(s.code,'READING_STARTED');
 assert.throws(()=>f.send('complete',{sessionId:s.sessionId,pages:[1]}),/READING_INCOMPLETE/);
 const r=f.send('complete',{sessionId:s.sessionId,pages:[1,2]});assert.equal(r.code,'READING_RELEASED');
 assert.equal(f.send('complete',{sessionId:s.sessionId,pages:[1,2]}).code,'READING_RELEASED');
 assert.equal(f.grants.length,2);assert.deepEqual(f.grants,['reader@example.test','reader@example.test']);
 assert.ok([...f.data.keys()].every(k=>!k.startsWith('evaluationAwards/')));
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
 assert.equal(send({...input,nonce:'e'.repeat(32),issuedAt:now-120000,expiresAt:now-60000}).code,'READING_UNAVAILABLE');assert.equal(calls,1);
});
test('Apps Script setup is valid V8 syntax',()=>{
 assert.doesNotThrow(()=>new vm.Script(readFileSync(new URL('../apps-script-v2/DiretrizesReadingSetup.gs',import.meta.url),'utf8')));
});
function setupFixture(){
 const f=fixture();vm.runInContext(readFileSync(new URL('../apps-script-v2/DiretrizesReadingSetup.gs',import.meta.url),'utf8'),f.ctx);
 f.policy.documents.doc.enforced=false;f.props.set('SAHMT_READING_POLICY_JSON',JSON.stringify(f.policy));f.props.set('SAHMT_READING_ENABLED','NO');f.props.delete('SAHMT_READING_CUTOVER_SHA256');
 f.props.set('SAHMT_READING_OPERATOR_EMAIL','operator@example.test');
 f.ctx.sahmtV2Properties_=()=>({getProperty:k=>f.props.get(k)||null,setProperty:(k,v)=>f.props.set(k,v),deleteProperty:k=>f.props.delete(k)});
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
