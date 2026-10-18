import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../apps-script-v2/ManagementPdfSync.gs',import.meta.url),'utf8');
const md5=bytes=>createHash('md5').update(Buffer.from(bytes)).digest('hex');
function fixture(){
 const props=new Map(),logs=[],now=Date.now(),pair={sourceId:'SourceFixture123456',pdfId:'PdfFixture123456789',folderId:'FolderFixture123456'};
 const cfg={version:1,operatorEmail:'operator@example.test',workspaceFolderId:'PrivateFixture123456',pairs:[pair]};props.set('SAHMT_DOCUMENT_PDF_SYNC_CONFIG',JSON.stringify(cfg));
 const context=vm.createContext({console:{log:s=>logs.push(s)},Date,PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props)})},Session:{getEffectiveUser:()=>({getEmail:()=>cfg.operatorEmail})},Utilities:{newBlob:s=>({getBytes:()=>Array.from(Buffer.from(s))})},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})}});
 vm.runInContext(source,context);
 let currentSource={id:pair.sourceId,mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',parents:[pair.folderId],md5Checksum:'a'.repeat(32),version:'1',modifiedTime:new Date(now-180000).toISOString()},pdf={id:pair.pdfId,mimeType:'application/pdf',parents:[pair.folderId],md5Checksum:'b'.repeat(32),etag:'"version-1"'};
 const bytes=Array.from(Buffer.from('%PDF-1.7 synthetic complete replacement')),blob={getBytes:()=>bytes};let converts=0,writes=0,backups=0,converting=()=>{},afterWrite=()=>{};
 const drive={metadata:id=>structuredClone(id===pair.sourceId?currentSource:pdf),convert:()=>{converts++;converting();return blob;},digest:md5,backup:()=>{backups++;return 'BackupFixture123456';},replace:(id,value,etag)=>{assert.equal(id,pair.pdfId);assert.equal(etag,pdf.etag);writes++;pdf.md5Checksum=md5(value.getBytes());afterWrite();}};
 const save=state=>props.set(context.gpdfStateKey_(pair),JSON.stringify({sourceId:pair.sourceId,sourceStamp:context.gpdfStamp_(currentSource),pdfMd5:pdf.md5Checksum,pending:null,...state}));save({});
 return {context,props,logs,pair,cfg,now,drive,source:currentSource,pdf,bytes,blob,save,setDuringConversion:fn=>{converting=fn;},setAfterWrite:fn=>{afterWrite=fn;},counts:()=>({converts,writes,backups}),state:()=>JSON.parse(props.get(context.gpdfStateKey_(pair))),run:()=>context.gpdfSyncPair_(pair,drive,now)};
}
test('Apps Script V8 syntax and no Firestore, token logging or user administration',()=>{
 assert.doesNotThrow(()=>new vm.Script(source));assert.doesNotMatch(source,/firestoreRequest_|evaluationGet_|evaluationQuery_|accounts:|setSharing\(/);
});
test('unchanged document does not export, back up or write PDF',()=>{
 const f=fixture();assert.equal(f.run().code,'PDF_SYNC_UNCHANGED');assert.deepEqual(f.counts(),{converts:0,writes:0,backups:0});
});
test('complete text replacement regenerates bytes once at exactly the same PDF ID',()=>{
 const f=fixture();f.source.md5Checksum='c'.repeat(32);const result=f.run();assert.equal(result.code,'PDF_SYNC_UPDATED');assert.equal(f.state().pdfMd5,md5(f.bytes));assert.equal(f.state().pending,null);
 assert.equal(f.run().code,'PDF_SYNC_UNCHANGED');assert.deepEqual(f.counts(),{converts:1,writes:1,backups:1});
});
test('Google Docs native version changes are detected without a binary checksum',()=>{
 const f=fixture();f.source.mimeType='application/vnd.google-apps.document';delete f.source.md5Checksum;f.save({});f.source.version='2';assert.equal(f.run().changed,true);
});
test('actively edited source is debounced without export or write',()=>{
 const f=fixture();f.source.md5Checksum='c'.repeat(32);f.source.modifiedTime=new Date(f.now-30000).toISOString();assert.equal(f.run().code,'PDF_SYNC_EDIT_IN_PROGRESS');assert.equal(f.counts().writes,0);
});
test('editing during conversion preserves the official PDF and retries the latest document',()=>{
 const f=fixture();f.source.md5Checksum='c'.repeat(32);f.setDuringConversion(()=>{f.source.md5Checksum='d'.repeat(32);});assert.equal(f.run().retry,true);assert.equal(f.counts().writes,0);
});
test('download or conversion failure never replaces the PDF and does not confirm the source',()=>{
 const f=fixture();f.source.md5Checksum='c'.repeat(32);f.drive.convert=()=>{throw Error('private token body');};assert.throws(()=>f.run());assert.equal(f.counts().writes,0);assert.equal(f.state().sourceStamp,'binary:'+'a'.repeat(32));
});
test('invalid PDF output, missing ETag and external PDF edits fail closed',()=>{
 for(const mode of ['invalid','etag','external']){
  const f=fixture();f.source.md5Checksum='c'.repeat(32);
  if(mode==='invalid')f.drive.convert=()=>({getBytes:()=>Array.from(Buffer.from('not a PDF'))});
  if(mode==='etag')delete f.pdf.etag;if(mode==='external')f.pdf.md5Checksum='d'.repeat(32);
  assert.throws(()=>f.run(),/PDF_SYNC_/);assert.equal(f.counts().writes,0);
 }
});
test('wrong folder, source MIME and disabled/deleted source cannot overwrite a PDF',()=>{
 for(const mutate of [f=>{f.source.parents=['different'];},f=>{f.source.mimeType='application/pdf';},f=>{f.source.trashed=true;}]){
  const f=fixture();mutate(f);assert.throws(()=>f.run(),/PDF_SYNC_/);assert.equal(f.counts().writes,0);
 }
});
test('crash after upload resumes from the recorded checksum without another conversion or write',()=>{
 const f=fixture();f.source.md5Checksum='c'.repeat(32);f.setAfterWrite(()=>{throw Error('interrupted');});assert.throws(()=>f.run());assert.ok(f.state().pending);
 f.setAfterWrite(()=>{});assert.equal(f.run().code,'PDF_SYNC_UNCHANGED');assert.deepEqual(f.counts(),{converts:1,writes:1,backups:1});
});
test('known reading Forms are closed before replacing a changed material',()=>{
 const f=fixture();f.source.md5Checksum='c'.repeat(32);f.props.set('SAHMT_READING_POLICY_JSON','configured');const events=[];
 f.context.dgrPolicy_=()=>({documents:{one:{pdfId:f.pair.pdfId,formId:'FormFixture123456'},other:{pdfId:'OtherPdfFixture1234',formId:'OtherFormFixture1234'}}});
 f.context.FormApp={openById:id=>id};f.context.formsEvaluationCloseForm_=id=>events.push('close:'+id);const replace=f.drive.replace;f.drive.replace=(...args)=>{events.push('replace');replace(...args);};
 assert.equal(f.run().code,'PDF_SYNC_UPDATED_READING_REVALIDATION_REQUIRED');assert.deepEqual(events,['close:FormFixture123456','replace']);
});
test('absent reading guard blocks a managed PDF before any bytes are replaced',()=>{
 const f=fixture();f.source.md5Checksum='c'.repeat(32);f.props.set('SAHMT_READING_POLICY_JSON','configured');assert.throws(()=>f.run(),/READING_GUARD/);assert.equal(f.counts().writes,0);
});
test('default off does not call external APIs',()=>{
 const f=fixture();assert.equal(f.context.atualizarPdfsGestaoAlteradosV1().code,'PDF_SYNC_DISABLED');assert.equal(f.logs.length,0);
});
test('duplicate PDF or source identity configuration is rejected',()=>{
 const f=fixture();f.cfg.pairs.push({...f.pair});f.props.set('SAHMT_DOCUMENT_PDF_SYNC_CONFIG',JSON.stringify(f.cfg));assert.throws(()=>f.context.gpdfConfig_(),/CONFIG_INVALID/);
});
test('change feed queues only known IDs, persists queue before cursor and sanitizes exceptions',()=>{
 const f=fixture();f.props.set('SAHMT_DOCUMENT_PDF_SYNC_ENABLED','YES');f.props.set('SAHMT_DOCUMENT_PDF_CURSOR','before');
 f.context.gpdfDrive_=()=>({workspace:()=>{},cleanup:()=>{},changes:()=>({changes:[{fileId:'UnrelatedFixture123'},{fileId:f.pair.sourceId}],newStartPageToken:'after'})});
 f.context.gpdfSyncPair_=()=>{throw Error('secret@example.test https://private/ token');};
 const r=f.context.atualizarPdfsGestaoAlteradosV1();assert.equal(r.failures,1);assert.equal(r.lastError,'PDF_SYNC_SERVICE_ERROR');assert.equal(r.pending,1);
 assert.equal(f.props.get('SAHMT_DOCUMENT_PDF_CURSOR'),'after');assert.equal(JSON.parse(f.props.get('SAHMT_DOCUMENT_PDF_QUEUE')).length,1);assert.doesNotMatch(f.logs.join(''),/secret|private|token|SourceFixture/);
});

test('Drive adapter uses a v2 ETag snapshot and conditional content update without changing permissions',()=>{
 const f=fixture(),calls=[];
 f.context.ScriptApp={getOAuthToken:()=> 'private-token'};
 f.context.UrlFetchApp={fetch:(url,options)=>{calls.push({url,options});return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({id:f.pair.pdfId,etag:'"revision-1"',mimeType:'application/pdf',parents:[{id:f.pair.folderId}],md5Checksum:'b'.repeat(32),version:'1',modifiedDate:new Date(f.now).toISOString(),fileSize:'123'} )};}};
 const d=f.context.gpdfDrive_(f.cfg),m=d.metadata(f.pair.pdfId);assert.equal(m.etag,'"revision-1"');assert.equal(m.parents[0],f.pair.folderId);
 d.replace(f.pair.pdfId,f.blob,m.etag);assert.match(calls[0].url,/drive\/v2\/files\//);assert.match(calls[1].url,/upload\/drive\/v2\/files\/PdfFixture123456789\?uploadType=media$/);
 assert.equal(calls[1].options.method,'put');assert.equal(calls[1].options.headers['If-Match'],'"revision-1"');assert.deepEqual(calls[1].options.payload,f.bytes);assert.equal(calls[1].options.followRedirects,false);
});
test('Drive conditional conflict is sanitized and never falls back to an unconditional upload',()=>{
 const f=fixture();let calls=0;f.context.ScriptApp={getOAuthToken:()=> 'private-token'};
 f.context.UrlFetchApp={fetch:()=>{calls++;return {getResponseCode:()=>412,getContentText:()=> 'secret HTTP body'};}};
 assert.throws(()=>f.context.gpdfDrive_(f.cfg).replace(f.pair.pdfId,f.blob,'etag'),/PDF_SYNC_DRIVE_HTTP_412/);assert.equal(calls,1);
});
test('reinstallation preserves baselines and creates only the one dedicated Drive trigger',()=>{
 const f=fixture();let created=0;const triggers=[];
 f.context.gpdfDrive_=()=>({...f.drive,workspace:()=>{},start:()=> 'cursor'});
 f.context.ScriptApp={getProjectTriggers:()=>triggers,newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{assert.equal(minutes,5);created++;triggers.push({getHandlerFunction:()=>handler});}})})}),deleteTrigger:()=>{}};
 assert.equal(f.context.instalarAtualizacaoAutomaticaPdfsGestaoV1().pdfWrites,0);const before=f.state();
 f.context.instalarAtualizacaoAutomaticaPdfsGestaoV1();assert.equal(created,1);assert.deepEqual(f.state(),before);assert.equal(f.context.verificarAtualizacaoAutomaticaPdfsGestaoV1().baselines,1);
});

test('protected source folder keeps the public PDF ID and supports a complete text replacement',()=>{
 const f=fixture(),review='ReviewFixture123456';f.pair.sourceFolderId=review;f.source.parents=[review];let guards=0;f.drive.reviewFolder=(id,parent)=>{assert.equal(id,review);assert.equal(parent,f.pair.folderId);guards++;};
 f.source.md5Checksum='c'.repeat(32);assert.equal(f.run().code,'PDF_SYNC_UPDATED');assert.equal(f.run().code,'PDF_SYNC_UNCHANGED');assert.equal(f.pdf.id,f.pair.pdfId);assert.ok(guards>=2);assert.equal(f.counts().writes,1);
});
test('missing protected-folder guard and source in the former folder fail closed',()=>{
 for(const kind of ['guard','former']){const f=fixture();f.pair.sourceFolderId='ReviewFixture123456';if(kind==='guard')f.source.parents=[f.pair.sourceFolderId];else f.drive.reviewFolder=()=>{};assert.throws(()=>f.run(),/PDF_SYNC_/);assert.equal(f.counts().writes,0);}
});
test('bounded transition accepts only the two verified source parents while keeping the PDF parent fixed',()=>{
 const f=fixture();f.pair.sourceFolderId='ReviewFixture123456';f.pair.allowLegacySourceFolder=true;f.drive.reviewFolder=()=>{};
 assert.equal(f.run().code,'PDF_SYNC_UNCHANGED');f.source.parents=[f.pair.sourceFolderId];assert.equal(f.run().code,'PDF_SYNC_UNCHANGED');f.source.parents=['UnrelatedFixture123'];assert.throws(()=>f.run(),/BINDING_CHANGED/);
});
test('configuration rejects untrusted transition flags and invalid protected folder identities',()=>{
 for(const mutate of [p=>p.sourceFolderId='bad',p=>p.sourceFolderId=p.folderId,p=>{p.sourceFolderId='ReviewFixture123456';p.allowLegacySourceFolder=true;}]){const f=fixture();mutate(f.cfg.pairs[0]);f.props.set('SAHMT_DOCUMENT_PDF_SYNC_CONFIG',JSON.stringify(f.cfg));assert.throws(()=>f.context.gpdfConfig_(),/CONFIG_INVALID/);}
});
test('trusted server layout resolver does not rewrite cursor, queue or baselines',()=>{
 const f=fixture(),before=f.state();f.props.set('SAHMT_DOCUMENT_PDF_CURSOR','preserved');f.props.set('SAHMT_DOCUMENT_PDF_QUEUE','[]');f.context.gpdfTrustedReviewLayout_=pairs=>pairs.map(p=>({...p,sourceFolderId:'ReviewFixture123456'}));
 assert.equal(f.context.gpdfConfig_().pairs[0].sourceFolderId,'ReviewFixture123456');assert.equal(f.props.get('SAHMT_DOCUMENT_PDF_CURSOR'),'preserved');assert.deepEqual(f.state(),before);assert.equal(f.props.get('SAHMT_DOCUMENT_PDF_QUEUE'),'[]');
});
test('review folder adapter requires limited inheritance and user-only writer access',()=>{
 for(const mode of ['valid','public','unlimited','wrongParent']){const f=fixture();let calls=0;f.context.ScriptApp={getOAuthToken:()=> 'private-token'};
  f.context.UrlFetchApp={fetch:url=>{calls++;const permissions=url.includes('/permissions?');const value=permissions?{permissions:[{type:mode==='public'?'anyone':'user',role:'writer'},{type:'user',role:'reader',view:'metadata'}]}:{id:'ReviewFixture123456',mimeType:'application/vnd.google-apps.folder',parents:[mode==='wrongParent'?'DifferentFixture1234':f.pair.folderId],inheritedPermissionsDisabled:mode!=='unlimited'};return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(value)};}};
  const drive=f.context.gpdfDrive_(f.cfg);if(mode==='valid'){drive.reviewFolder('ReviewFixture123456',f.pair.folderId);drive.reviewFolder('ReviewFixture123456',f.pair.folderId);assert.equal(calls,2);}else assert.throws(()=>drive.reviewFolder('ReviewFixture123456',f.pair.folderId),/PDF_SYNC_REVIEW_/);
 }
});
