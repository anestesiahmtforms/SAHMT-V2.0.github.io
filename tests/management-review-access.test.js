import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const source=readFileSync(new URL('../apps-script-v2/ManagementReviewAccess.gs',import.meta.url),'utf8');
function fixture(count=1){
 const operator='owner@example.test',manager='manager@example.test',outsider='reader@example.test';
 const cfg={operatorEmail:operator,sources:Array.from({length:count},(_,i)=>({sourceId:'SourceFixture12345'+i,folderId:'FolderFixture12345'+i,sourceFolderId:'ReviewFixture12345'+i,stamp:'binary:'+'a'.repeat(32),size:'42'}))};
 const props=new Map(),ledgers=new Map(),permissions=new Map(),metadata=new Map(),events=[],logs=[],triggers=[];
 let effective=operator,active=operator,clock=0,deleteCost=0,failAfterDelete=false,syncError=null,installed=0;
 const own={id:'owner-id',type:'user',role:'owner',emailAddress:operator},manage={id:'manager-id',type:'user',role:'writer',emailAddress:manager};
 for(const s of cfg.sources){
  metadata.set(s.sourceId,{id:s.sourceId,mimeType:'application/msword',parents:[s.sourceFolderId],owners:[{emailAddress:operator}],md5Checksum:'a'.repeat(32),size:'42'});
  metadata.set(s.sourceFolderId,{id:s.sourceFolderId,mimeType:'application/vnd.google-apps.folder',parents:[s.folderId],inheritedPermissionsDisabled:true});
  permissions.set(s.sourceFolderId,[{...own},{...manage},{type:'user',role:'reader',view:'metadata',emailAddress:outsider}]);
  permissions.set(s.sourceId,[{...own},{...manage},{id:'reader-id',type:'user',role:'reader',emailAddress:outsider}]);
 }
 const context=vm.createContext({Date:class extends Date {static now(){return clock;}},console:{log:s=>logs.push(s)},
  graTrustedConfig_:()=>cfg,
  Session:{getEffectiveUser:()=>({getEmail:()=>effective}),getActiveUser:()=>({getEmail:()=>active})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(alg,s)=>Array.from(createHash(alg).update(s).digest())},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>events.push('unlock')})},
  gpdfProps_:()=>({}),gpdfLoad_:(key,fallback)=>props.has(key)?structuredClone(props.get(key)):fallback,gpdfSave_:(key,value)=>props.set(key,structuredClone(value)),
  gpdfStamp_:m=>'binary:'+m.md5Checksum,
  gpdfJson_:url=>{
   events.push('read');const id=new URL(url).pathname.split('/')[4];
   return url.includes('/permissions?')?{permissions:structuredClone(permissions.get(id))}:structuredClone(metadata.get(id));
  },
  gpdfHttp_:(url,options)=>{
   assert.equal(options.method,'delete');const parts=new URL(url).pathname.split('/'),id=parts[4],pid=parts[6];
   const ledger=JSON.parse([...ledgers.values()][0].text);assert.ok(ledger.records.some(r=>r.sourceId===id&&r.removals.some(p=>p.id===pid)),'backup must precede DELETE');
   permissions.set(id,permissions.get(id).filter(p=>p.id!==pid));events.push('delete:'+id+':'+pid);clock+=deleteCost;
   if(failAfterDelete){failAfterDelete=false;throw Error('private HTTP body secret token');}
  },
  MimeType:{PLAIN_TEXT:'text/plain'},
  DriveApp:{Access:{PRIVATE:'private'},Permission:{NONE:'none'},
   createFile:(name,text)=>{const id='LedgerFixture123456';const ledger={text,private:true,editors:[],viewers:[],getId:()=>id,getUrl:()=> 'https://example.test/private-recovery',setContent(value){this.text=value;events.push('save');return this;},setSharing(access,role){assert.equal(access,'private');assert.equal(role,'none');return this;},isTrashed:()=>false,getSharingAccess(){return this.private?'private':'anyone';},getEditors(){return this.editors;},getViewers(){return this.viewers;},getBlob(){return {getDataAsString:()=>this.text};}};ledgers.set(id,ledger);return ledger;},
   getFileById:id=>ledgers.get(id)},
  ScriptApp:{getProjectTriggers:()=>triggers,deleteTrigger:t=>triggers.splice(triggers.indexOf(t),1),newTrigger:handler=>({timeBased:()=>({after:delay=>({create:()=>{assert.equal(delay,60000);triggers.push({getHandlerFunction:()=>handler});}})})})},
  configurarRevisaoProtegidaPdfsGestaoV1:()=>{assert.ok(JSON.parse([...ledgers.values()][0].text).records.every(r=>r.verified));assert.equal(events.at(-1),'unlock');if(syncError)throw Error(syncError);installed++;return {code:'PDF_REVIEW_SYNC_INSTALLED'};}
 });vm.runInContext(source,context);
 return {context,cfg,props,permissions,metadata,events,logs,triggers,ledgers,operator,manager,outsider,
  run:()=>context.protegerEditaveisGestaoV1(),resume:()=>context.continuarProtecaoEditaveisGestaoV1(),
  setIdentity:(e,a)=>{effective=e;active=a;},setDeleteCost:n=>{deleteCost=n;},resetClock:()=>{clock=0;},crashDelete:()=>{failAfterDelete=true;},syncFailure:s=>{syncError=s;},installed:()=>installed};
}

test('V8 syntax and no PDF, Form, Firebase or IAM content mutations',()=>{
 assert.doesNotThrow(()=>new vm.Script(source));assert.doesNotMatch(source,/FormApp|Firestore|firestoreRequest_|setValues|setDescription|\/upload\/|accounts:|iamcredentials/);
});
test('effective owner and interactive identity are checked before all remote actions',()=>{
 for(const identities of [['wrong@example.test','owner@example.test'],['owner@example.test','wrong@example.test']]){
  const f=fixture();f.setIdentity(...identities);assert.throws(f.run,/OPERATOR_DENIED/);assert.equal(f.events.length,0);assert.equal(f.ledgers.size,0);
 }
});
test('automatic continuation accepts empty active identity but never a different effective owner',()=>{
 const f=fixture();f.setIdentity(f.operator,'');assert.equal(f.resume().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');
 const other=fixture();other.setIdentity('wrong@example.test','');assert.throws(other.resume,/OPERATOR_DENIED/);assert.equal(other.events.length,0);
});
test('missing, invalid and duplicate bindings fail before any ACL or ledger operation',()=>{
 for(const mutate of [f=>{f.context.graTrustedConfig_=undefined;},f=>{f.cfg.sources[0]=null;},f=>{f.cfg.sources.push({...f.cfg.sources[0]});},f=>{f.cfg.sources[0].sourceFolderId=f.cfg.sources[0].folderId;}]){
  const f=fixture();mutate(f);assert.throws(f.run,/CONFIG_/);assert.equal(f.events.length,0);
 }
});
test('backs up ACLs before deleting only old readers and preserves owner and manager',()=>{
 const f=fixture(),r=f.run();assert.equal(r.code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.equal(r.completed,1);assert.equal(f.installed(),1);
 assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,1);assert.deepEqual(f.permissions.get(f.cfg.sources[0].sourceId).map(x=>x.emailAddress),[f.operator,f.manager]);
 const record=JSON.parse([...f.ledgers.values()][0].text).records[0];assert.equal(record.before.length,3);assert.equal(record.removals.length,1);assert.equal(record.verified,true);
 assert.equal(r.pdfWrites,0);assert.equal(r.formWrites,0);assert.equal(r.firestoreReads,0);assert.doesNotMatch(f.logs.join(''),/reader@example|owner@example|SourceFixture|secret token/);
});
test('a designated future reviewer is retained when listed as writer in the protected folder',()=>{
 const f=fixture(),s=f.cfg.sources[0],grant={id:'future-manager',type:'user',role:'writer',emailAddress:'reviewer@example.test'};
 f.permissions.get(s.sourceFolderId).push(grant);f.permissions.get(s.sourceId).push(grant);assert.equal(f.run().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.ok(f.permissions.get(s.sourceId).some(x=>x.id===grant.id));
});
test('unexpected writers or inherited content grants are never removed',()=>{
 for(const mutate of [p=>{p.role='writer';},p=>{p.permissionDetails=[{inherited:true}];}]){
  const f=fixture();mutate(f.permissions.get(f.cfg.sources[0].sourceId).at(-1));assert.equal(f.run().category,'REVIEW_ACCESS_UNEXPECTED_GRANT');assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,0);
 }
});
test('folder policy drift, edited source, wrong parent and owner drift pause without deleting grants',()=>{
 for(const [mutate,category] of [
  [f=>{f.metadata.get(f.cfg.sources[0].sourceFolderId).inheritedPermissionsDisabled=false;},'REVIEW_ACCESS_FOLDER_INVALID'],
  [f=>{f.permissions.get(f.cfg.sources[0].sourceFolderId).push({type:'anyone',role:'reader'});},'REVIEW_ACCESS_FOLDER_NOT_RESTRICTED'],
  [f=>{f.metadata.get(f.cfg.sources[0].sourceId).md5Checksum='b'.repeat(32);},'REVIEW_ACCESS_SOURCE_EDITED'],
  [f=>{f.metadata.get(f.cfg.sources[0].sourceId).parents=[f.cfg.sources[0].folderId];},'REVIEW_ACCESS_SOURCE_CHANGED'],
  [f=>{f.metadata.get(f.cfg.sources[0].sourceId).owners=[];},'REVIEW_ACCESS_SOURCE_CHANGED']]){
  const f=fixture();mutate(f);assert.equal(f.run().category,category);assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,0);assert.equal(f.installed(),0);
 }
});
test('crash after an acknowledged remote DELETE resumes without deleting it again',()=>{
 const f=fixture();f.crashDelete();assert.equal(f.run().code,'REVIEW_ACCESS_PAUSED');assert.equal(f.run().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,1);
});
test('bounded work persists progress and uses one dedicated continuation trigger',()=>{
 const f=fixture(2);f.setDeleteCost(120001);const first=f.run();assert.equal(first.code,'REVIEW_ACCESS_PROGRESS');assert.equal(first.completed,1);assert.equal(f.triggers.length,1);assert.equal(f.installed(),0);
 f.resetClock();assert.equal(f.resume().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,2);assert.equal(f.triggers.length,0);
});
test('partially cleaned permissions within a source are safely resumed in another batch',()=>{
 const f=fixture(),s=f.cfg.sources[0];f.permissions.get(s.sourceId).push({id:'second-reader',type:'user',role:'reader',emailAddress:'second@example.test'});f.setDeleteCost(120001);
 assert.equal(f.run().completed,0);f.resetClock();assert.equal(f.resume().completed,1);assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,2);
});
test('shared recovery ledger is rejected before continuing ACL changes',()=>{
 const f=fixture();f.crashDelete();f.run();[...f.ledgers.values()][0].private=false;const before=f.events.length;assert.equal(f.run().category,'REVIEW_ACCESS_RECOVERY_NOT_PRIVATE');assert.equal(f.events.slice(before).filter(x=>x.startsWith('delete:')).length,0);
});
test('changed bindings or corrupted recovery cannot silently reuse an earlier approval',()=>{
 const f=fixture();f.crashDelete();f.run();f.cfg.sources[0].size='43';assert.equal(f.run().category,'REVIEW_ACCESS_BINDINGS_CHANGED');
 const g=fixture();g.crashDelete();g.run();const ledger=[...g.ledgers.values()][0],data=JSON.parse(ledger.text);data.records[0].sourceId='wrong';ledger.text=JSON.stringify(data);assert.equal(g.run().category,'REVIEW_ACCESS_RECOVERY_INVALID');
});
test('PDF installation failure leaves protected ACLs and reports only a safe code',()=>{
 const f=fixture();f.syncFailure('private body token manager@example.test');const r=f.run();assert.equal(r.code,'REVIEW_ACCESS_PROTECTED_SYNC_PENDING');assert.equal(r.category,'PDF_SYNC_SERVICE_ERROR');assert.doesNotMatch(f.logs.join(''),/private body|token|manager@example/);
});
test('failure saving the completion receipt never starts PDF installation',()=>{
 const f=fixture(),save=f.context.gpdfSave_;let writes=0;
 f.context.gpdfSave_=(...args)=>{if(++writes===3)throw Error('private persistence error');return save(...args);};
 assert.equal(f.run().code,'REVIEW_ACCESS_PAUSED');assert.equal(f.installed(),0);
 assert.equal(f.resume().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,1);
});
function enableBatch(f){
 const rounds=[];f.context.ScriptApp.getOAuthToken=()=> 'private-oauth-token';
 f.context.UrlFetchApp={fetchAll:requests=>{
  rounds.push(requests);assert.ok(requests.length<=8);assert.equal(new Set(requests.map(r=>new URL(r.url).pathname.split('/')[4])).size,requests.length);
  return requests.map(r=>{assert.equal(r.headers.Authorization,'Bearer private-oauth-token');assert.equal(r.muteHttpExceptions,true);assert.equal(r.followRedirects,false);f.context.gpdfHttp_(r.url,r);return {getResponseCode:()=>204};});
 }};return rounds;
}
test('parallel rounds touch distinct files only and preserve backups for all files before DELETE',()=>{
 const f=fixture(9);f.cfg.parallelFiles=8;const rounds=enableBatch(f);assert.equal(f.run().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');
 assert.equal(rounds.length,1);assert.equal(rounds[0].length,8);assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,9);assert.doesNotMatch(f.logs.join(''),/private-oauth-token/);
});
test('partial parallel groups resume verified records even when completion is not a contiguous prefix',()=>{
 const f=fixture(2),s=f.cfg.sources[0];f.cfg.parallelFiles=2;enableBatch(f);f.permissions.get(s.sourceId).push({id:'extra-reader',type:'user',role:'reader',emailAddress:'extra@example.test'});f.setDeleteCost(120001);
 assert.equal(f.run().completed,1);const data=JSON.parse([...f.ledgers.values()][0].text);assert.equal(data.records[0].verified,false);assert.equal(data.records[1].verified,true);
 f.resetClock();assert.equal(f.resume().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,3);
});
test('parallel HTTP failure pauses safely and never reads or logs response bodies',()=>{
 const f=fixture(2);f.cfg.parallelFiles=2;f.context.ScriptApp.getOAuthToken=()=> 'private-token';f.context.UrlFetchApp={fetchAll:()=>[{getResponseCode:()=>204,getContentText:()=>{throw Error('must not read');}},{getResponseCode:()=>403,getContentText:()=>{throw Error('must not read');}}]};
 assert.equal(f.run().category,'PDF_SYNC_DRIVE_HTTP_403');assert.equal(f.installed(),0);assert.equal(f.triggers.length,0);assert.doesNotMatch(f.logs.join(''),/private-token|must not read/);
});
test('batch rejects same-file concurrency, oversized rounds and missing OAuth before dispatch',()=>{
 const f=fixture();let dispatched=0;f.context.UrlFetchApp={fetchAll:()=>{dispatched++;}};f.context.ScriptApp.getOAuthToken=()=> '';
 const step={sourceId:f.cfg.sources[0].sourceId,permissionId:'one'};
 assert.throws(()=>f.context.graDeleteRound_([step,{...step,permissionId:'two'}]),/BATCH_INVALID/);
 assert.throws(()=>f.context.graDeleteRound_(Array.from({length:9},(_,i)=>({...step,sourceId:'SourceFixture'+i+'123456'}))),/BATCH_INVALID/);
 assert.throws(()=>f.context.graDeleteRound_([step,{sourceId:'OtherFixture123456',permissionId:'one'}]),/OAUTH_UNAVAILABLE/);assert.equal(dispatched,0);
});
test('optional private status receipt contains result counts and excludes all backed-up ACLs',()=>{
 const f=fixture();assert.equal(f.run().code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');const recovery=[...f.ledgers.values()][0];
 f.cfg.statusFileId='StatusFixture123456';f.ledgers.set(f.cfg.statusFileId,{...recovery,text:'{}'});
 f.resume();const receipt=JSON.parse(f.ledgers.get(f.cfg.statusFileId).text);assert.equal(receipt.result.code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.equal(receipt.result.completed,1);assert.equal(receipt.records,undefined);assert.doesNotMatch(JSON.stringify(receipt),/reader@example|manager@example|permissions|removals/);
});
test('invalid optional concurrency and status target fail before touching records',()=>{
 for(const mutate of [f=>{f.cfg.parallelFiles=9;},f=>{f.cfg.parallelFiles=0;},f=>{f.cfg.parallelFiles=1.5;},f=>{f.cfg.statusFileId=f.cfg.sources[0].sourceId;},f=>{f.cfg.deferPdfInstall='yes';}]){
  const f=fixture();mutate(f);assert.throws(f.run,/CONFIG_INVALID/);assert.equal(f.events.length,0);
 }
});
test('PDF installation can run in a fresh continuation after all ACL work without user intervention',()=>{
 const f=fixture();f.cfg.deferPdfInstall=true;const r=f.run();assert.equal(r.code,'REVIEW_ACCESS_PROTECTED_SYNC_SCHEDULED');assert.equal(r.completed,1);assert.equal(r.automaticContinuation,true);assert.equal(f.installed(),0);assert.equal(f.triggers.length,1);
 const resumed=f.resume();assert.equal(resumed.code,'REVIEW_ACCESS_AND_PDF_SYNC_READY');assert.equal(f.installed(),1);assert.equal(f.triggers.length,0);assert.equal(f.events.filter(x=>x.startsWith('delete:')).length,1);
});
