import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=(await Promise.all(['Entry','Setup','PrepareDrive'].map(name=>readFile(new URL('../apps-script-fc/'+name+'.gs',import.meta.url),'utf8')))).join('\n');
const email='anestesiahmtforms3@gmail.com',scriptId='synthetic_fc_script_identifier_2026',folderId='synthetic_private_ocr_folder_2026';
function fixture({effective=email,active=email,owner=email,enabled=true,storedId=scriptId,
 folderPermissions=[{type:'user',role:'owner',emailAddress:email}],permissionStatus=200}={}){
 const values=new Map([['FC_INTEGRATION_ENABLED',String(enabled)],['FC_EXPECTED_SCRIPT_ID',storedId],['FC_OCR_TEMP_FOLDER_ID',folderId]]),calls=[],logs=[],writes=[];
 const locks={attempts:0,releases:0};
 const props={getProperty:k=>values.get(k)||null,setProperties:object=>{writes.push(object);for(const [k,v]of Object.entries(object))values.set(k,v);}};
 const context={console:{log:value=>logs.push(value)},
  PropertiesService:{getScriptProperties:()=>props},sahmtV2Properties_:()=>props,ospJson_:value=>value,
  Session:{getEffectiveUser:()=>({getEmail:()=>effective}),getActiveUser:()=>({getEmail:()=>active})},
  ScriptApp:{getScriptId:()=>scriptId,getProjectTriggers:()=>[]},
  LockService:{getScriptLock:()=>({tryLock:()=>{locks.attempts++;return true;},releaseLock:()=>{locks.releases++;}})},
  DriveApp:{Access:{PRIVATE:'PRIVATE'},getFileById:()=>({getOwner:()=>({getEmail:()=>owner})}),getFolderById:()=>({getOwner:()=>({getEmail:()=>owner}),getSharingAccess:()=> 'PRIVATE'})},
  UrlFetchApp:{fetch:()=>({getResponseCode:()=>permissionStatus,getContentText:()=>JSON.stringify({permissions:folderPermissions})})},
  fcInstallBootstrap_:()=>({scriptId,ocrFolderId:folderId,operationalSecret:'O'.repeat(43),occurrenceSecret:'C'.repeat(43)}),
  qmWriteHttp_:event=>{calls.push(['write',event]);return{code:'WRITE_OK'};},
  qmPrintsHttp_:event=>{calls.push(['prints',event]);return{code:'PRINTS_OK'};},
  evaluationOccurrenceHttp_:event=>{calls.push(['occurrence',event]);return{code:'OCCURRENCE_OK'};}
 };
 context.ScriptApp.getOAuthToken=()=> 'synthetic-owner-token';
 vm.createContext(context);vm.runInContext(code,context);return{context,values,calls,logs,writes,locks};
}
test('FC Apps Script starts disabled and never calls a business handler',()=>{
 const f=fixture({enabled:false});assert.equal(f.context.doPost({parameter:{action:'qmentum-write-v1'}}).code,'FC_INTEGRATION_DISABLED');assert.equal(f.calls.length,0);
});
test('FC Apps Script preserves the three signed handler contracts',()=>{
 const f=fixture();for(const [action,code]of [['qmentum-write-v1','WRITE_OK'],['qmentum-prints-v1','PRINTS_OK'],['occurrence-score-v1','OCCURRENCE_OK']]){
  const event={parameter:{action},postData:{contents:'synthetic-signed-envelope'}};assert.equal(f.context.doPost(event).code,code);assert.equal(f.calls.at(-1)[1],event);
 }assert.equal(f.calls.length,3);
});
test('FC Apps Script refuses central, login, configuration and missing actions',()=>{
 const f=fixture();for(const action of [undefined,'diretrizes-reading-v1','operational-continuity-admin-v1','qmentum-write-config-v1','login']){
  assert.equal(f.context.doPost({parameter:{action}}).code,'FC_ROUTE_DENIED');
 }assert.equal(f.calls.length,0);
});
test('FC Apps Script rejects a deployment executed by another Google account',()=>{
 const f=fixture({effective:'anestesiahmtforms@gmail.com'});assert.equal(f.context.doPost({parameter:{action:'qmentum-write-v1'}}).code,'FC_EXECUTOR_MISMATCH');assert.equal(f.calls.length,0);
});
test('FC Apps Script rejects a different script ID even with the expected executor',()=>{
 const f=fixture({storedId:'different_script_identifier_2026'});assert.equal(f.context.doPost({parameter:{action:'qmentum-write-v1'}}).code,'FC_SCRIPT_MISMATCH');assert.equal(f.calls.length,0);
});
test('FC GET status has no installation action or secret disclosure',()=>{
 const f=fixture();const result=f.context.doGet({parameter:{action:'install'}});assert.equal(result.code,'FC_INTEGRATION_STATUS');assert.equal(f.writes.length,0);assert.doesNotMatch(JSON.stringify(result),/secret|token|@gmail/);
});
test('FC installation requires an interactive owner identity before writing properties',()=>{
 for(const settings of [{active:''},{active:'other@gmail.com'},{effective:'other@gmail.com'},{owner:'other@gmail.com'}]){
  const f=fixture({...settings,enabled:false});assert.throws(()=>f.context.prepararIntegracaoFcV1(),/FC_INSTALL_OWNER_REQUIRED/);assert.equal(f.writes.length,0);
 }
});
test('FC installation sets private configuration with every business route disabled',()=>{
 const f=fixture({enabled:false});const result=f.context.prepararIntegracaoFcV1();
 assert.equal(result.code,'FC_INTEGRATION_PREPARED');assert.equal(result.executor,email);assert.equal(result.triggers,0);
 assert.equal(f.values.get('FC_INTEGRATION_ENABLED'),'false');assert.equal(f.values.get('QMENTUM_WRITE_ENABLED'),'false');assert.equal(f.values.get('SAHMT_V2_OCCURRENCE_SCORING_ENABLED'),'false');
 assert.equal(f.values.get('SAHMT_V2_EVALUATION_ALLOWED_EMAILS'),email);assert.equal(f.values.get('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET'),'O'.repeat(43));
 assert.equal(f.values.get('SAHMT_V2_OCCURRENCE_SCORING_HMAC_SECRET'),'C'.repeat(43));assert.equal(f.values.get('FC_OCR_TEMP_FOLDER_ID'),folderId);
 assert.doesNotMatch(JSON.stringify([result,f.logs]),new RegExp('O{43}|C{43}'));
});
test('FC installation refuses to overwrite an existing secret or enabled environment',()=>{
 const conflict=fixture({enabled:false});conflict.values.set('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET','X'.repeat(43));assert.throws(()=>conflict.context.prepararIntegracaoFcV1(),/FC_INSTALL_CONFLICT/);assert.equal(conflict.writes.length,0);
 const active=fixture();assert.throws(()=>active.context.prepararIntegracaoFcV1(),/FC_INSTALL_ALREADY_ACTIVE/);assert.equal(active.writes.length,0);
});
test('FC OCR metadata requires its configured destination folder',()=>{
 const f=fixture();const metadata=f.context.fcPrintOcrMetadata_('synthetic-ocr-name');assert.equal(metadata.parents[0],folderId);assert.equal(metadata.mimeType,'application/vnd.google-apps.document');
 f.values.delete('FC_OCR_TEMP_FOLDER_ID');assert.throws(()=>f.context.fcPrintOcrMetadata_('synthetic-ocr-name'),/FC_OCR_FOLDER_REQUIRED/);
});
test('FC installation rejects named users, groups and domain access on the OCR folder',()=>{
 for(const permission of [{type:'user',role:'writer',emailAddress:'other@gmail.com'},{type:'group',role:'reader',emailAddress:'team@example.test'},
  {type:'domain',role:'reader'},{type:'anyone',role:'reader'}]){
  const f=fixture({enabled:false,folderPermissions:[{type:'user',role:'owner',emailAddress:email},permission]});
  assert.throws(()=>f.context.prepararIntegracaoFcV1(),/FC_INSTALL_PRIVATE_FOLDER_REQUIRED/);assert.equal(f.writes.length,0);
 }
});
test('FC installation accepts metadata-only inherited visibility and fails closed if permissions cannot be read',()=>{
 const metadataOnly=fixture({enabled:false,folderPermissions:[{type:'user',role:'owner',emailAddress:email},{type:'anyone',role:'reader',view:'metadata'}]});
 assert.equal(metadataOnly.context.prepararIntegracaoFcV1().code,'FC_INTEGRATION_PREPARED');
 const unavailable=fixture({enabled:false,permissionStatus:403});
 assert.throws(()=>unavailable.context.prepararIntegracaoFcV1(),/FC_INSTALL_PRIVATE_FOLDER_REQUIRED/);assert.equal(unavailable.writes.length,0);
});
function imagePlan(){return{scriptId,rootFolderId:'synthetic_root_folder_2026',privateFolderId:'synthetic_private_folder_2026',stagingFolderId:'synthetic_staging_folder_2026',
 folders:{TECHNIQUES:'synthetic_techniques_folder_2026',INDICATORS:'synthetic_indicators_folder_2026'},
 images:Array.from({length:20},(_,i)=>({sourceId:'synthetic_source_id_'+i,stagingId:'synthetic_staged_id_'+i,
  kind:i<10?'TECHNIQUES':'INDICATORS',name:String(i%10+1).padStart(2,'0')+'.png',size:100+i,md5Checksum:'a'.repeat(32)}))};}
test('FC image preparation validates all twenty identities and fingerprints before copying',()=>{
 const f=fixture(),valid=imagePlan();assert.equal(f.context.fcValidateImagePreparationPlan_(valid,scriptId),true);
 for(const mutate of [p=>p.images.pop(),p=>p.images[1].sourceId=p.images[0].sourceId,p=>p.images[1].stagingId=p.images[0].stagingId,
  p=>p.images[0].md5Checksum='bad',p=>p.images[0].kind='FA',p=>p.images[0].name='../01.png',p=>p.scriptId='another-script']){
  const invalid=imagePlan();mutate(invalid);assert.throws(()=>f.context.fcValidateImagePreparationPlan_(invalid,scriptId),/FC_DRIVE_PLAN_INVALID/);
 }
});
test('FC image preparation refuses a background or different-user invocation before any Drive mutation',()=>{
 for(const settings of [{active:''},{active:'other@gmail.com'},{effective:'other@gmail.com'},{owner:'other@gmail.com'}]){
  const f=fixture(settings);f.context.fcPreparationBootstrap_=imagePlan;
  assert.throws(()=>f.context.organizarRecursosFcV1(),/FC_INSTALL_OWNER_REQUIRED/);assert.equal(f.writes.length,0);
 }
});
function drivePreparationFixture(){
 const f=fixture({enabled:false}),plan=imagePlan(),files=new Map(),reports=[];let copies=0,moves=0;
 const owner=[{emailAddress:email}];
 for(const [id,parent]of [[plan.privateFolderId,plan.rootFolderId],[plan.stagingFolderId,plan.privateFolderId],
  [plan.folders.TECHNIQUES,plan.privateFolderId],[plan.folders.INDICATORS,plan.privateFolderId]]){
  files.set(id,{id,mimeType:'application/vnd.google-apps.folder',parents:[parent],ownedByMe:true,owners:owner});
 }
 files.set(scriptId,{id:scriptId,parents:['synthetic_my_drive_root_2026'],ownedByMe:true,owners:owner});
 for(const image of plan.images)files.set(image.stagingId,{id:image.stagingId,mimeType:'image/png',size:String(image.size),md5Checksum:image.md5Checksum,parents:[plan.stagingFolderId]});
 f.context.fcPreparationBootstrap_=()=>plan;
 f.context.DriveApp.getFileById=()=>({getOwner:()=>({getEmail:()=>email}),moveTo:folder=>{files.get(scriptId).parents=[folder.id];moves++;}});
 f.context.DriveApp.getFolderById=id=>({id,getOwner:()=>({getEmail:()=>email}),getSharingAccess:()=> 'PRIVATE',
  createFile:(_name,text)=>{reports.push(JSON.parse(text));return{getId:()=> 'synthetic_migration_receipt_2026'};}});
 f.context.UrlFetchApp.fetch=(raw,options)=>{
  const url=new URL(raw),segments=url.pathname.split('/').filter(Boolean);assert.equal(url.origin,'https://www.googleapis.com');
  assert.equal(options.headers.Authorization,'Bearer synthetic-owner-token');assert.equal(options.followRedirects,false);
  let body;
  if(segments.at(-1)==='permissions')body={permissions:[{type:'user',role:'owner',emailAddress:email}]};
  else if(url.searchParams.has('q')){
   assert.equal(url.pathname,'/drive/v3/files');const q=url.searchParams.get('q'),parent=q.match(/^'([^']+)'/)[1],source=q.match(/value='([^']+)'/)[1];
   body={files:[...files.values()].filter(file=>file.parents?.includes(parent)&&file.appProperties?.sahmtSourceId===source)};
  }else if(segments.at(-1)==='copy'){
   assert.equal(options.method,'post');const data=JSON.parse(options.payload),previous=files.get(segments.at(-2)),id='synthetic_final_copy_'+(++copies);
   body={...previous,...data,id,ownedByMe:true,owners:owner};files.set(id,body);
  }else{assert.equal(options.method,'get');body=files.get(segments.at(-1));assert.ok(body,'unexpected file request');}
  return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(body)};
 };
 return{...f,plan,files,reports,counts:()=>({copies,moves})};
}
test('FC owner preparation verifies final copies, moves only its new script and reuses files on retry',()=>{
 const f=drivePreparationFixture();const result=f.context.organizarRecursosFcV1();assert.equal(result.verifiedCopies,20);assert.equal(result.firestoreWrites,0);
 assert.deepEqual(f.counts(),{copies:20,moves:1});assert.equal(f.reports.length,1);
 assert.ok(result.copied.every(file=>file.owner===email&&file.md5Checksum==='a'.repeat(32)));
 assert.equal(f.context.organizarRecursosFcV1().verifiedCopies,20);assert.deepEqual(f.counts(),{copies:20,moves:1});
});
test('FC owner preparation verifies every staging fingerprint before creating copies or moving the script',()=>{
 const f=drivePreparationFixture();f.files.get(f.plan.images.at(-1).stagingId).md5Checksum='b'.repeat(32);
 assert.throws(()=>f.context.organizarRecursosFcV1(),/FC_DRIVE_STAGING_CHANGED/);assert.deepEqual(f.counts(),{copies:0,moves:0});assert.equal(f.reports.length,0);
});
test('FC owner preparation refuses a concurrent start before creating copies or moving files',()=>{
 const f=drivePreparationFixture();f.context.LockService.getScriptLock=()=>({tryLock:()=>false,releaseLock:()=>{throw Error('unowned lock released');}});
 assert.throws(()=>f.context.organizarRecursosFcV1(),/FC_DRIVE_PREPARATION_BUSY/);assert.deepEqual(f.counts(),{copies:0,moves:0});
});
test('FC owner preparation releases its exclusive lock after success and failure',()=>{
 const success=drivePreparationFixture();success.context.organizarRecursosFcV1();assert.deepEqual(success.locks,{attempts:1,releases:1});
 const failure=drivePreparationFixture();failure.files.get(failure.plan.images.at(-1).stagingId).md5Checksum='b'.repeat(32);
 assert.throws(()=>failure.context.organizarRecursosFcV1(),/FC_DRIVE_STAGING_CHANGED/);assert.deepEqual(failure.locks,{attempts:1,releases:1});
});
