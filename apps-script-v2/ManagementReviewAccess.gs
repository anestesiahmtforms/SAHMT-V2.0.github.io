// Owner-only, bounded migration of existing editable files. No PDF/Form content writes.
function graConfig_(interactive) {
  if(typeof graTrustedConfig_!=='function')throw Error('REVIEW_ACCESS_CONFIG_MISSING');
  const cfg=graTrustedConfig_(),id=/^[A-Za-z0-9_-]{10,200}$/;
  if(!cfg||typeof cfg.operatorEmail!=='string'||!cfg.operatorEmail.includes('@')||!Array.isArray(cfg.sources)||!cfg.sources.length||cfg.sources.length>150||cfg.sources.some(function(s){return !s||!id.test(s.sourceId||'')||!id.test(s.folderId||'')||!id.test(s.sourceFolderId||'')||s.folderId===s.sourceFolderId||!s.stamp||!/^\d+$/.test(String(s.size));})||new Set(cfg.sources.map(function(s){return s.sourceId;})).size!==cfg.sources.length)throw Error('REVIEW_ACCESS_CONFIG_INVALID');
  if(cfg.parallelFiles!==undefined&&(!Number.isInteger(cfg.parallelFiles)||cfg.parallelFiles<1||cfg.parallelFiles>8)||cfg.statusFileId!==undefined&&(!id.test(cfg.statusFileId)||cfg.sources.some(function(s){return [s.sourceId,s.folderId,s.sourceFolderId].includes(cfg.statusFileId);})))throw Error('REVIEW_ACCESS_CONFIG_INVALID');
  if(cfg.deferPdfInstall!==undefined&&typeof cfg.deferPdfInstall!=='boolean')throw Error('REVIEW_ACCESS_CONFIG_INVALID');
  // Installed time triggers may not expose an active user; their effective owner is mandatory.
  if(String(Session.getEffectiveUser().getEmail()||'').toLowerCase()!==cfg.operatorEmail||interactive&&String(Session.getActiveUser().getEmail()||'').toLowerCase()!==cfg.operatorEmail)throw Error('REVIEW_ACCESS_OPERATOR_DENIED');
  return cfg;
}
function graPermissions_(id) {
  const entries=[];let page='';do{
    const result=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'/permissions?pageSize=100&fields=nextPageToken,permissions(id,type,role,emailAddress,domain,view,permissionDetails)'+(page?'&pageToken='+encodeURIComponent(page):''));
    if(!Array.isArray(result.permissions))throw Error('REVIEW_ACCESS_PERMISSIONS_INVALID');entries.push.apply(entries,result.permissions);page=result.nextPageToken||'';
    if(entries.length>1000)throw Error('REVIEW_ACCESS_PERMISSIONS_LIMIT');
  }while(page);return entries;
}
function graRemoveTrigger_() {ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='continuarProtecaoEditaveisGestaoV1';}).forEach(function(t){ScriptApp.deleteTrigger(t);});}
function graSave_(file,data) { file.setContent(JSON.stringify(data)); }
function graPrivateLedger_(id) {
  const file=DriveApp.getFileById(id);
  if(file.isTrashed()||file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('REVIEW_ACCESS_RECOVERY_NOT_PRIVATE');
  return file;
}
function graPrepare_(cfg,s,index,data) {
  const m=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+s.sourceId+'?fields=id,mimeType,parents,trashed,md5Checksum,size,version,modifiedTime,owners(emailAddress)');
  if(m.id!==s.sourceId||m.trashed||!(m.parents||[]).includes(s.sourceFolderId)||(m.parents||[]).includes(s.folderId)||!['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.google-apps.document'].includes(m.mimeType)||!m.owners||!m.owners.length||m.owners.some(function(o){return o.emailAddress!==cfg.operatorEmail;}))throw Error('REVIEW_ACCESS_SOURCE_CHANGED');
  if(gpdfStamp_(m)!==s.stamp||String(m.size||'')!==String(s.size))throw Error('REVIEW_ACCESS_SOURCE_EDITED');
  const folder=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+s.sourceFolderId+'?fields=id,mimeType,parents,trashed,inheritedPermissionsDisabled');
  if(folder.id!==s.sourceFolderId||folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||folder.inheritedPermissionsDisabled!==true||!(folder.parents||[]).includes(s.folderId))throw Error('REVIEW_ACCESS_FOLDER_INVALID');
  const folderPermissions=graPermissions_(s.sourceFolderId).filter(function(p){return p.view!=='metadata';});
  if(folderPermissions.some(function(p){return p.type!=='user'||!p.emailAddress||!['owner','writer'].includes(p.role);})||!folderPermissions.some(function(p){return p.emailAddress===cfg.operatorEmail&&p.role==='owner';}))throw Error('REVIEW_ACCESS_FOLDER_NOT_RESTRICTED');
  const allowed=folderPermissions.map(function(p){return p.emailAddress;}),before=graPermissions_(s.sourceId);
  const remove=before.filter(function(p){return p.view!=='metadata'&&p.role!=='owner'&&(p.type!=='user'||allowed.indexOf(p.emailAddress)===-1);});
  if(remove.some(function(p){return !p.id||p.role!=='reader'||p.permissionDetails&&p.permissionDetails.length&&p.permissionDetails.every(function(d){return d.inherited===true;});}))throw Error('REVIEW_ACCESS_UNEXPECTED_GRANT');
  let record=data.records[index];
  if(!record){if(index!==data.records.length)throw Error('REVIEW_ACCESS_RECOVERY_INVALID');record={sourceId:s.sourceId,reviewFolderId:s.sourceFolderId,before:before,removals:[],verified:false};data.records.push(record);}
  if(record.sourceId!==s.sourceId||record.reviewFolderId!==s.sourceFolderId||!Array.isArray(record.removals))throw Error('REVIEW_ACCESS_RECOVERY_INVALID');
  remove.forEach(function(p){if(!record.removals.some(function(x){return x.id===p.id;}))record.removals.push(p);});
  return {sourceId:s.sourceId,allowed:allowed,record:record,remove:remove,next:0};
}
function graDeleteRound_(steps) {
  if(!steps.length||steps.length>8||new Set(steps.map(function(s){return s.sourceId;})).size!==steps.length)throw Error('REVIEW_ACCESS_BATCH_INVALID');
  const urls=steps.map(function(s){if(!/^[A-Za-z0-9_-]{10,200}$/.test(s.sourceId)||!s.permissionId)throw Error('REVIEW_ACCESS_BATCH_INVALID');return 'https://www.googleapis.com/drive/v3/files/'+s.sourceId+'/permissions/'+encodeURIComponent(s.permissionId);});
  if(steps.length===1){gpdfHttp_(urls[0],{method:'delete'});return;}
  const token=ScriptApp.getOAuthToken();if(!token)throw Error('REVIEW_ACCESS_OAUTH_UNAVAILABLE');
  // Drive forbids concurrent permission mutations on the SAME file. Each round has distinct files.
  const responses=UrlFetchApp.fetchAll(urls.map(function(url){return {url:url,method:'delete',headers:{Authorization:'Bearer '+token},muteHttpExceptions:true,followRedirects:false};}));
  if(!Array.isArray(responses)||responses.length!==steps.length)throw Error('REVIEW_ACCESS_BATCH_UNCONFIRMED');
  responses.forEach(function(r){const status=r.getResponseCode();if(status<200||status>=300)throw Error('PDF_SYNC_DRIVE_HTTP_'+status);});
}
function graVerify_(item,file,data) {
  const after=graPermissions_(item.sourceId).filter(function(p){return p.view!=='metadata';});
  if(after.some(function(p){return p.type!=='user'||item.allowed.indexOf(p.emailAddress)===-1;}))throw Error('REVIEW_ACCESS_WRITE_UNCONFIRMED');
  if(item.allowed.some(function(email){return !after.some(function(p){return p.emailAddress===email&&['owner','writer'].includes(p.role);});}))throw Error('REVIEW_ACCESS_MANAGER_ACCESS_MISSING');
  item.record.verified=true;item.record.verifiedAt=new Date().toISOString();graSave_(file,data);
}
function protegerEditaveisGestaoV1() {graConfig_(true);return continuarProtecaoEditaveisGestaoV1();}
function continuarProtecaoEditaveisGestaoV1() {
  let state,result;const began=Date.now();
  // Never touch a ledger, trigger or remote file before validating the executing owner.
  const cfg=graConfig_(),props=gpdfProps_(),lock=LockService.getScriptLock();if(!lock.tryLock(1000))return {code:'REVIEW_ACCESS_BUSY'};
  let complete=false,readyAtStart=false;
  try{
    graRemoveTrigger_();const digest=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(cfg.sources)).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
    state=gpdfLoad_('SAHMT_REVIEW_ACCESS_JOB',null);
    if(state&&state.digest!==digest)throw Error('REVIEW_ACCESS_BINDINGS_CHANGED');
    if(!state){
      const file=DriveApp.createFile('SAHMT Recuperacao privada dos acessos de revisao.json',JSON.stringify({version:1,digest:digest,records:[]}),MimeType.PLAIN_TEXT);
      file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);state={digest:digest,fileId:file.getId(),completed:0};gpdfSave_('SAHMT_REVIEW_ACCESS_JOB',state);
    }
    const file=graPrivateLedger_(state.fileId),data=JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    if(data.digest!==digest||!Array.isArray(data.records)||data.records.length>cfg.sources.length||data.records.some(function(r,i){return r.sourceId!==cfg.sources[i].sourceId;}))throw Error('REVIEW_ACCESS_RECOVERY_INVALID');
    readyAtStart=data.records.length===cfg.sources.length&&data.records.every(function(r){return r.verified===true;});
    while(Date.now()-began<120000){
      const group=[];
      for(let index=0;index<cfg.sources.length&&group.length<(cfg.parallelFiles||1)&&Date.now()-began<120000;index++){
        if(data.records[index]&&data.records[index].verified===true)continue;
        group.push(graPrepare_(cfg,cfg.sources[index],index,data));
      }
      if(!group.length)break;
      // Persist restoration material for every file before sending any mutation in this group.
      graSave_(file,data);
      while(Date.now()-began<120000){
        const pending=group.filter(function(item){return item.next<item.remove.length;});if(!pending.length)break;
        graDeleteRound_(pending.map(function(item){return {sourceId:item.sourceId,permissionId:item.remove[item.next].id};}));
        pending.forEach(function(item){item.next++;});
      }
      group.filter(function(item){return item.next===item.remove.length;}).forEach(function(item){graVerify_(item,file,data);});
      state.completed=data.records.filter(function(r){return r.verified;}).length;gpdfSave_('SAHMT_REVIEW_ACCESS_JOB',state);
      if(group.some(function(item){return !item.record.verified;}))break;
    }
    complete=data.records.length===cfg.sources.length&&data.records.every(function(r){return r.verified===true;});
    state.completed=data.records.filter(function(r){return r.verified;}).length;gpdfSave_('SAHMT_REVIEW_ACCESS_JOB',state);
    result={code:complete?'REVIEW_ACCESS_PROTECTED':'REVIEW_ACCESS_PROGRESS',completed:state.completed,total:cfg.sources.length,privateRecoveryUrl:file.getUrl(),pdfWrites:0,formWrites:0,firestoreReads:0};
    if(!complete){ScriptApp.newTrigger('continuarProtecaoEditaveisGestaoV1').timeBased().after(60000).create();result.automaticContinuation=true;}
  }catch(e){complete=false;graRemoveTrigger_();result={code:'REVIEW_ACCESS_PAUSED',category:/^(?:REVIEW_ACCESS|PDF_SYNC)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'REVIEW_ACCESS_SERVICE_UNAVAILABLE',completed:state&&state.completed||0,total:cfg.sources.length,pdfWrites:0,formWrites:0};}
  finally{lock.releaseLock();}
  if(complete){
    try{
      if(cfg.deferPdfInstall&&!readyAtStart){ScriptApp.newTrigger('continuarProtecaoEditaveisGestaoV1').timeBased().after(60000).create();result.code='REVIEW_ACCESS_PROTECTED_SYNC_SCHEDULED';result.automaticContinuation=true;}
      else{const installed=configurarRevisaoProtegidaPdfsGestaoV1();result.code='REVIEW_ACCESS_AND_PDF_SYNC_READY';result.pdfSync=installed;}
    }catch(e){result.code='REVIEW_ACCESS_PROTECTED_SYNC_PENDING';result.category=/^(?:REVIEW_ACCESS|PDF_SYNC)_[A-Z0-9_]+$/.test(e.message||'')?e.message:'PDF_SYNC_SERVICE_ERROR';}
  }
  if(cfg.statusFileId){try{graSave_(graPrivateLedger_(cfg.statusFileId),{version:1,observedAt:new Date().toISOString(),result:result});}catch(_){result.statusReceiptSaved=false;}}
  console.log(JSON.stringify(result));return result;
}
