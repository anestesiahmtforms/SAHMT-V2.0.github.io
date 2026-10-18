// Drive-only incremental publication. No Firestore scan, Auth, IAM or sharing changes.
// Pairs retain folderId for the reading PDF; optional sourceFolderId is a protected child folder.
function gpdfProps_() { return PropertiesService.getScriptProperties(); }
function gpdfError_(code) { throw new Error(code); }
function gpdfConfig_() {
  let cfg;try{cfg=JSON.parse(gpdfProps_().getProperty('SAHMT_DOCUMENT_PDF_SYNC_CONFIG')||'null');}catch(_){gpdfError_('PDF_SYNC_CONFIG_INVALID');}
  const id=/^[A-Za-z0-9_-]{10,200}$/;
  if(!cfg||cfg.version!==1||!id.test(cfg.workspaceFolderId||'')||typeof cfg.operatorEmail!=='string'||!cfg.operatorEmail.includes('@')||!Array.isArray(cfg.pairs)||!cfg.pairs.length||cfg.pairs.length>100)gpdfError_('PDF_SYNC_CONFIG_INVALID');
  if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!==cfg.operatorEmail.toLowerCase())gpdfError_('PDF_SYNC_OPERATOR_DENIED');
  // This optional server-only resolver accepts exact, previously verified bindings, never browser input.
  if(typeof gpdfTrustedReviewLayout_==='function')cfg=Object.assign({},cfg,{pairs:gpdfTrustedReviewLayout_(cfg.pairs)});
  if(!Array.isArray(cfg.pairs)||!cfg.pairs.length||cfg.pairs.length>100)gpdfError_('PDF_SYNC_CONFIG_INVALID');
  const sources=new Set(),pdfs=new Set();
  cfg.pairs.forEach(function(p){if(!p||!id.test(p.sourceId||'')||!id.test(p.pdfId||'')||!id.test(p.folderId||'')||p.sourceId===p.pdfId||p.folderId===cfg.workspaceFolderId||sources.has(p.sourceId)||pdfs.has(p.pdfId))gpdfError_('PDF_SYNC_CONFIG_INVALID');
    if(p.sourceFolderId!==undefined&&(!id.test(p.sourceFolderId)||p.sourceFolderId===cfg.workspaceFolderId||p.sourceFolderId===p.folderId))gpdfError_('PDF_SYNC_CONFIG_INVALID');
    if(p.allowLegacySourceFolder!==undefined&&(p.allowLegacySourceFolder!==true||!p.sourceFolderId||typeof gpdfTrustedReviewLayout_!=='function'))gpdfError_('PDF_SYNC_CONFIG_INVALID');
    sources.add(p.sourceId);pdfs.add(p.pdfId);});
  if(cfg.pairs.some(function(p){return pdfs.has(p.sourceId);}))gpdfError_('PDF_SYNC_CONFIG_INVALID');
  return cfg;
}
function gpdfStamp_(metadata) {
  if(metadata.mimeType==='application/vnd.google-apps.document'){
    if(!/^\d+$/.test(String(metadata.version||''))||!Number.isFinite(Date.parse(metadata.modifiedTime)))gpdfError_('PDF_SYNC_SOURCE_INVALID');
    return 'native:'+metadata.version+':'+metadata.modifiedTime;
  }
  if(!['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(metadata.mimeType)||!/^[a-f0-9]{32}$/.test(metadata.md5Checksum||''))gpdfError_('PDF_SYNC_SOURCE_INVALID');
  return 'binary:'+metadata.md5Checksum;
}
function gpdfPair_(pair,drive) {
  const source=drive.metadata(pair.sourceId),pdf=drive.metadata(pair.pdfId);
  const sourceFolder=pair.sourceFolderId||pair.folderId;
  const sourceMatches=(source.parents||[]).includes(sourceFolder)||(pair.allowLegacySourceFolder===true&&(source.parents||[]).includes(pair.folderId));
  if(source.trashed||pdf.trashed||!sourceMatches||!(pdf.parents||[]).includes(pair.folderId)||pdf.mimeType!=='application/pdf'||!/^[a-f0-9]{32}$/.test(pdf.md5Checksum||''))gpdfError_('PDF_SYNC_BINDING_CHANGED');
  if(pair.sourceFolderId){if(typeof drive.reviewFolder!=='function')gpdfError_('PDF_SYNC_REVIEW_GUARD_MISSING');drive.reviewFolder(pair.sourceFolderId,pair.folderId);}
  gpdfStamp_(source);return {source:source,pdf:pdf};
}
function gpdfStateKey_(pair) { return 'SAHMT_DOCUMENT_PDF_STATE_'+pair.pdfId; }
function gpdfLoad_(key,fallback) { const raw=gpdfProps_().getProperty(key);try{return raw?JSON.parse(raw):fallback;}catch(_){gpdfError_('PDF_SYNC_STATE_INVALID');} }
function gpdfSave_(key,value) { const raw=JSON.stringify(value);if(Utilities.newBlob(raw).getBytes().length>8000)gpdfError_('PDF_SYNC_STATE_LIMIT');gpdfProps_().setProperty(key,raw); }
function gpdfPauseReading_(pdfId) {
  // A changed PDF must not retain a Form release justified by another material version.
  if(!gpdfProps_().getProperty('SAHMT_READING_POLICY_JSON'))return false;
  if(typeof dgrPolicy_!=='function'||typeof formsEvaluationCloseForm_!=='function')gpdfError_('PDF_SYNC_READING_GUARD_MISSING');
  const policy=dgrPolicy_();let paused=false;
  Object.keys(policy.documents).forEach(function(id){const row=policy.documents[id];if(row.pdfId===pdfId&&row.formId){
    if(typeof trainingRepeatInvalidate_==='function')trainingRepeatInvalidate_(row.formId,'MATERIAL');
    formsEvaluationCloseForm_(FormApp.openById(row.formId));paused=true;}});
  return paused;
}
function gpdfSyncPair_(pair,drive,now) {
  const key=gpdfStateKey_(pair),state=gpdfLoad_(key,null),current=gpdfPair_(pair,drive),stamp=gpdfStamp_(current.source);
  if(!state||state.sourceId!==pair.sourceId)gpdfError_('PDF_SYNC_BASELINE_REQUIRED');
  // Recover a completed media upload whose process ended before saving its acknowledgement.
  if(state.pending&&current.pdf.md5Checksum===state.pending.nextPdfMd5){
    state.sourceStamp=state.pending.sourceStamp;state.pdfMd5=current.pdf.md5Checksum;state.lastPublishedAt=state.pending.at;
    state.lastBackupId=state.pending.backupId;state.readingRevalidationRequired=state.pending.readingPaused;state.pending=null;gpdfSave_(key,state);
  }
  if(current.pdf.md5Checksum!==state.pdfMd5)gpdfError_('PDF_SYNC_PDF_CHANGED_EXTERNALLY');
  if(stamp===state.sourceStamp)return {code:'PDF_SYNC_UNCHANGED',changed:false};
  if(now-Date.parse(current.source.modifiedTime)<120000)return {code:'PDF_SYNC_EDIT_IN_PROGRESS',retry:true};
  const converted=drive.convert(current.source),bytes=converted.getBytes();
  if(bytes.length<5||bytes.length>10*1024*1024||bytes.slice(0,5).map(function(b){return String.fromCharCode((b+256)%256);}).join('')!=='%PDF-')gpdfError_('PDF_SYNC_CONVERSION_INVALID');
  const nextMd5=drive.digest(bytes),fresh=gpdfPair_(pair,drive);
  if(gpdfStamp_(fresh.source)!==stamp)return {code:'PDF_SYNC_SOURCE_CHANGED_DURING_EXPORT',retry:true};
  if(fresh.pdf.md5Checksum!==state.pdfMd5)gpdfError_('PDF_SYNC_PDF_CHANGED_EXTERNALLY');
  if(!fresh.pdf.etag)gpdfError_('PDF_SYNC_PRECONDITION_MISSING');
  if(!state.pending||state.pending.sourceStamp!==stamp)state.pending={sourceStamp:stamp,nextPdfMd5:nextMd5,backupId:drive.backup(pair.pdfId),at:new Date(now).toISOString(),readingPaused:false};
  if(state.pending.nextPdfMd5!==nextMd5){state.pending.nextPdfMd5=nextMd5;}
  gpdfSave_(key,state); // Recovery is durable before any Form or PDF mutation.
  state.pending.readingPaused=gpdfPauseReading_(pair.pdfId);gpdfSave_(key,state);
  const last=gpdfPair_(pair,drive);
  if(gpdfStamp_(last.source)!==stamp)return {code:'PDF_SYNC_SOURCE_CHANGED_DURING_EXPORT',retry:true};
  if(last.pdf.md5Checksum!==state.pdfMd5||!last.pdf.etag)gpdfError_('PDF_SYNC_PDF_CHANGED_EXTERNALLY');
  drive.replace(pair.pdfId,converted,last.pdf.etag);
  const after=gpdfPair_(pair,drive);
  if(after.pdf.md5Checksum!==nextMd5)gpdfError_('PDF_SYNC_WRITE_UNCONFIRMED');
  state.sourceStamp=stamp;state.pdfMd5=nextMd5;state.lastPublishedAt=state.pending.at;state.lastBackupId=state.pending.backupId;
  state.readingRevalidationRequired=state.pending.readingPaused;state.pending=null;gpdfSave_(key,state);
  return {code:state.readingRevalidationRequired?'PDF_SYNC_UPDATED_READING_REVALIDATION_REQUIRED':'PDF_SYNC_UPDATED',changed:true,retry:gpdfStamp_(after.source)!==stamp};
}
function gpdfHttp_(url,options) {
  if(!/^https:\/\/www\.googleapis\.com\/(?:upload\/)?drive\/v[23]\//.test(url))gpdfError_('PDF_SYNC_ENDPOINT_INVALID');
  const opts=Object.assign({method:'get'},options||{});opts.headers=Object.assign({Authorization:'Bearer '+ScriptApp.getOAuthToken()},opts.headers||{});
  opts.muteHttpExceptions=true;opts.followRedirects=false;
  const r=UrlFetchApp.fetch(url,opts),status=r.getResponseCode();
  if(status<200||status>=300)gpdfError_('PDF_SYNC_DRIVE_HTTP_'+status);
  return r;
}
function gpdfJson_(url,options) { const r=gpdfHttp_(url,options);return JSON.parse(r.getContentText()||'{}'); }
function gpdfDrive_(cfg) {
  const base='https://www.googleapis.com/drive/v3/',upload='https://www.googleapis.com/upload/drive/v3/';
  const reviewCache={};
  function metadata(id){
    // v2 still exposes the ETag together with the checksum in a single metadata snapshot.
    const m=gpdfJson_('https://www.googleapis.com/drive/v2/files/'+encodeURIComponent(id)+'?fields=id,etag,mimeType,parents(id),labels(trashed),md5Checksum,version,modifiedDate,fileSize');
    if(m.id!==id)gpdfError_('PDF_SYNC_IDENTITY_MISMATCH');
    return {id:m.id,etag:m.etag,mimeType:m.mimeType,parents:(m.parents||[]).map(function(p){return p.id;}),trashed:Boolean(m.labels&&m.labels.trashed),md5Checksum:m.md5Checksum,version:m.version,modifiedTime:m.modifiedDate,size:m.fileSize};
  }
  function workspace(){
    const meta=metadata(cfg.workspaceFolderId);if(meta.trashed||meta.mimeType!=='application/vnd.google-apps.folder')gpdfError_('PDF_SYNC_WORKSPACE_INVALID');
    let page='';do{
      const p=gpdfJson_(base+'files/'+cfg.workspaceFolderId+'/permissions?pageSize=100&fields=nextPageToken,permissions(role,type)'+(page?'&pageToken='+encodeURIComponent(page):''));
      if((p.permissions||[]).some(function(x){return x.type!=='user'||x.role!=='owner';}))gpdfError_('PDF_SYNC_WORKSPACE_NOT_PRIVATE');page=p.nextPageToken||'';
    }while(page);
  }
  function removeTemp(id){gpdfHttp_(base+'files/'+encodeURIComponent(id),{method:'delete'});}
  return {
    metadata:metadata,workspace:workspace,
    reviewFolder:function(id,parentId){
      if(reviewCache[id]===parentId)return;
      const m=gpdfJson_(base+'files/'+encodeURIComponent(id)+'?fields=id,mimeType,parents,trashed,inheritedPermissionsDisabled');
      if(m.id!==id||m.trashed||m.mimeType!=='application/vnd.google-apps.folder'||m.inheritedPermissionsDisabled!==true||!(m.parents||[]).includes(parentId))gpdfError_('PDF_SYNC_REVIEW_FOLDER_INVALID');
      let page='';do{const p=gpdfJson_(base+'files/'+encodeURIComponent(id)+'/permissions?pageSize=100&fields=nextPageToken,permissions(type,role,view)'+(page?'&pageToken='+encodeURIComponent(page):''));
        if(!Array.isArray(p.permissions)||p.permissions.filter(function(x){return x.view!=='metadata';}).some(function(x){return x.type!=='user'||!['owner','writer'].includes(x.role);}))gpdfError_('PDF_SYNC_REVIEW_ACCESS_INVALID');page=p.nextPageToken||'';
      }while(page);reviewCache[id]=parentId;
    },
    digest:function(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,bytes).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');},
    start:function(){return gpdfJson_(base+'changes/startPageToken').startPageToken;},
    changes:function(token){return gpdfJson_(base+'changes?pageSize=1000&includeRemoved=true&fields=nextPageToken,newStartPageToken,changes(fileId,removed)&pageToken='+encodeURIComponent(token));},
    backup:function(id){const copy=gpdfJson_(base+'files/'+encodeURIComponent(id)+'/copy?fields=id',{method:'post',contentType:'application/json',payload:JSON.stringify({name:'PDF-recuperacao-'+Utilities.getUuid()+'.pdf',parents:[cfg.workspaceFolderId]})});if(!copy.id)gpdfError_('PDF_SYNC_BACKUP_FAILED');return copy.id;},
    replace:function(id,blob,etag){gpdfHttp_('https://www.googleapis.com/upload/drive/v2/files/'+encodeURIComponent(id)+'?uploadType=media',{method:'put',headers:{'If-Match':etag},contentType:'application/pdf',payload:blob.getBytes()});},
    convert:function(source){
      let id=source.id,temp=null;
      try{
        if(source.mimeType!=='application/vnd.google-apps.document'){
          if(!Number.isFinite(Number(source.size))||Number(source.size)>20*1024*1024)gpdfError_('PDF_SYNC_SOURCE_TOO_LARGE');
          const body=gpdfHttp_(base+'files/'+source.id+'?alt=media').getBlob().getBytes();
          if(body.length!==Number(source.size))gpdfError_('PDF_SYNC_SOURCE_DOWNLOAD_INVALID');
          const boundary='sahmt_'+Utilities.getUuid(),head='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify({name:'SAHMT-conversao-temporaria',mimeType:'application/vnd.google-apps.document',parents:[cfg.workspaceFolderId]})+'\r\n--'+boundary+'\r\nContent-Type: '+source.mimeType+'\r\n\r\n';
          const payload=Utilities.newBlob(head).getBytes().concat(body,Utilities.newBlob('\r\n--'+boundary+'--\r\n').getBytes());
          const created=gpdfJson_(upload+'files?uploadType=multipart&fields=id',{method:'post',contentType:'multipart/related; boundary='+boundary,payload:payload});
          if(!/^[A-Za-z0-9_-]{10,200}$/.test(created.id||''))gpdfError_('PDF_SYNC_CONVERSION_FAILED');
          id=temp=created.id;gpdfProps_().setProperty('SAHMT_DOCUMENT_PDF_TEMP_'+id,'1');
        }
        return gpdfHttp_(base+'files/'+id+'/export?mimeType=application%2Fpdf').getBlob();
      }finally{if(temp){try{removeTemp(temp);gpdfProps_().deleteProperty('SAHMT_DOCUMENT_PDF_TEMP_'+temp);}catch(_){/* Cleanup retries the exact recorded temporary ID. */}}}
    },
    cleanup:function(){const props=gpdfProps_();Object.keys(props.getProperties()).filter(function(k){return /^SAHMT_DOCUMENT_PDF_TEMP_[A-Za-z0-9_-]{10,200}$/.test(k);}).slice(0,5).forEach(function(k){const id=k.slice('SAHMT_DOCUMENT_PDF_TEMP_'.length);try{removeTemp(id);props.deleteProperty(k);}catch(_){}});}
  };
}
function instalarAtualizacaoAutomaticaPdfsGestaoV1() {
  const cfg=gpdfConfig_(),props=gpdfProps_(),lock=LockService.getScriptLock();if(!lock.tryLock(1000))gpdfError_('PDF_SYNC_BUSY');
  try{
    const drive=gpdfDrive_(cfg);drive.workspace();
    if(!props.getProperty('SAHMT_DOCUMENT_PDF_INSTALL_STARTED_AT'))props.setProperty('SAHMT_DOCUMENT_PDF_INSTALL_STARTED_AT',String(Date.now()));
    const began=Number(props.getProperty('SAHMT_DOCUMENT_PDF_INSTALL_STARTED_AT'));
    // Save the change cursor before the baseline so edits during installation are not lost.
    if(!props.getProperty('SAHMT_DOCUMENT_PDF_CURSOR'))props.setProperty('SAHMT_DOCUMENT_PDF_CURSOR',drive.start());
    cfg.pairs.forEach(function(pair){const current=gpdfPair_(pair,drive),key=gpdfStateKey_(pair),state=gpdfLoad_(key,null);if(state){if(state.sourceId!==pair.sourceId)gpdfError_('PDF_SYNC_BINDING_CHANGED');return;}gpdfSave_(key,{sourceId:pair.sourceId,sourceStamp:Date.parse(current.source.modifiedTime)>=began?null:gpdfStamp_(current.source),pdfMd5:current.pdf.md5Checksum,pending:null});});
    const existing=ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='atualizarPdfsGestaoAlteradosV1';});
    if(!existing.length)ScriptApp.newTrigger('atualizarPdfsGestaoAlteradosV1').timeBased().everyMinutes(5).create();
    existing.slice(1).forEach(function(t){ScriptApp.deleteTrigger(t);});props.setProperty('SAHMT_DOCUMENT_PDF_SYNC_ENABLED','YES');
    props.deleteProperty('SAHMT_DOCUMENT_PDF_INSTALL_STARTED_AT');
    const result={code:'PDF_SYNC_INSTALLED',documents:cfg.pairs.length,intervalMinutes:5,firestoreReads:0,pdfWrites:0};console.log(JSON.stringify(result));return result;
  }finally{lock.releaseLock();}
}
function atualizarPdfsGestaoAlteradosV1() {
  if(gpdfProps_().getProperty('SAHMT_DOCUMENT_PDF_SYNC_ENABLED')!=='YES')return {code:'PDF_SYNC_DISABLED'};
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'PDF_SYNC_BUSY'};
  const result={code:'PDF_SYNC_CHECKED',updated:0,pending:0,failures:0,readingRevalidationRequired:0,firestoreReads:0};
  try{
    const cfg=gpdfConfig_(),drive=gpdfDrive_(cfg);drive.workspace();drive.cleanup();
    let queue=gpdfLoad_('SAHMT_DOCUMENT_PDF_QUEUE',[]),token=gpdfProps_().getProperty('SAHMT_DOCUMENT_PDF_CURSOR');
    if(!token||!Array.isArray(queue)||queue.some(function(id){return !cfg.pairs.some(function(p){return p.sourceId===id;});}))gpdfError_('PDF_SYNC_STATE_INVALID');
    for(let i=0;i<3;i++){
      const page=drive.changes(token);if(!Array.isArray(page.changes)||!page.nextPageToken&&!page.newStartPageToken)gpdfError_('PDF_SYNC_CHANGE_FEED_INVALID');
      page.changes.forEach(function(change){if(cfg.pairs.some(function(p){return p.sourceId===change.fileId;})&&!queue.includes(change.fileId))queue.push(change.fileId);});
      gpdfSave_('SAHMT_DOCUMENT_PDF_QUEUE',queue);token=page.nextPageToken||page.newStartPageToken;gpdfProps_().setProperty('SAHMT_DOCUMENT_PDF_CURSOR',token);if(!page.nextPageToken)break;
    }
    const began=Date.now();for(let n=0,limit=Math.min(3,queue.length);n<limit&&Date.now()-began<180000;n++){
      const id=queue[0],pair=cfg.pairs.find(function(p){return p.sourceId===id;});
      try{const answer=gpdfSyncPair_(pair,drive,Date.now());queue.shift();if(answer.retry)queue.push(id);if(answer.changed)result.updated++;if(answer.code==='PDF_SYNC_UPDATED_READING_REVALIDATION_REQUIRED')result.readingRevalidationRequired++;}
      catch(error){queue.push(queue.shift());result.failures++;result.lastError=/^PDF_SYNC_[A-Z0-9_]+$/.test(error.message||'')?error.message:'PDF_SYNC_SERVICE_ERROR';}
      gpdfSave_('SAHMT_DOCUMENT_PDF_QUEUE',queue);
    }
    result.pending=queue.length;console.log(JSON.stringify(result));return result;
  }catch(error){result.code=/^PDF_SYNC_[A-Z0-9_]+$/.test(error.message||'')?error.message:'PDF_SYNC_SERVICE_ERROR';console.log(JSON.stringify(result));return result;}
  finally{lock.releaseLock();}
}
function desativarAtualizacaoAutomaticaPdfsGestaoV1() {
  gpdfConfig_();gpdfProps_().setProperty('SAHMT_DOCUMENT_PDF_SYNC_ENABLED','NO');
  ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='atualizarPdfsGestaoAlteradosV1';}).forEach(function(t){ScriptApp.deleteTrigger(t);});
  return {code:'PDF_SYNC_DISABLED',pdfWrites:0,firestoreReads:0};
}
function verificarAtualizacaoAutomaticaPdfsGestaoV1() {
  const cfg=gpdfConfig_(),props=gpdfProps_();
  return {code:'PDF_SYNC_STATUS',enabled:props.getProperty('SAHMT_DOCUMENT_PDF_SYNC_ENABLED')==='YES',documents:cfg.pairs.length,protectedSources:cfg.pairs.filter(function(p){return Boolean(p.sourceFolderId);}).length,baselines:cfg.pairs.filter(function(p){return Boolean(props.getProperty(gpdfStateKey_(p)));}).length,triggers:ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='atualizarPdfsGestaoAlteradosV1';}).length,firestoreReads:0};
}
