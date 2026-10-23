// Completes the initial editable conversion. Reading PDFs and scoring versions do not change.
let ROPS_EDITABLE_REPAIR_MANIFEST_;
function ropsEditableRepairManifest_() {
  if(ROPS_EDITABLE_REPAIR_MANIFEST_)return ROPS_EDITABLE_REPAIR_MANIFEST_;
  const cfg=ropsEditableRepairConfig_(),file=DriveApp.getFileById(cfg.manifestId);ropsOwner_();
  if(file.isTrashed()||file.getSharingAccess()!==DriveApp.Access.PRIVATE||file.getEditors().length||file.getViewers().length)throw Error('ROPS_EDITABLE_MANIFEST_NOT_PRIVATE');
  const raw=file.getBlob().getDataAsString('UTF-8');if(gvrDigest_(Utilities.newBlob(raw).getBytes())!==cfg.manifestSha256)throw Error('ROPS_EDITABLE_MANIFEST_CHANGED');
  const manifest=JSON.parse(raw);if(manifest.code!=='ROPS_EDITABLE_FIGURE_COMPLETION'||!Array.isArray(manifest.items)||manifest.items.length>20)throw Error('ROPS_EDITABLE_MANIFEST_INVALID');
  ROPS_EDITABLE_REPAIR_MANIFEST_=manifest;return manifest;
}
function ropsRepairEditable_(formId,state,recovery) {
  if(typeof ropsEditableRepairConfig_!=='function')return;
  const row=ropsEditableRepairManifest_().items.find(function(item){return item.formId===formId;});if(!row)return;
  const material=ropsMaterialManifest_().items.find(function(item){return item.formId===formId;});
  if(!material||row.sourceId!==material.sourceId||row.beforeSha256!==material.sourceSha256||!/^[a-f0-9]{64}$/.test(row.afterSha256)||!/^[a-f0-9]{32}$/.test(row.afterMd5))throw Error('ROPS_EDITABLE_BINDING_CHANGED');
  const cfg=gpdfConfig_(),drive=gpdfDrive_(cfg),pair=cfg.pairs.find(function(p){return p.sourceId===row.sourceId;}),current=gpdfPair_(pair,drive),baseline=gpdfLoad_(gpdfStateKey_(pair),null);
  if(!baseline||baseline.pending||baseline.pdfMd5!==material.pdfMd5||current.pdf.md5Checksum!==material.pdfMd5)throw Error('ROPS_EDITABLE_CONCURRENT_REVISION');
  const digest=gvrDigest_(DriveApp.getFileById(row.sourceId).getBlob().getBytes());state.editableRepairs=state.editableRepairs||[];let record=state.editableRepairs.find(function(r){return r.formId===formId;});
  const intentKey='SAHMT_ROPS_EDITABLE_REPAIR_'+row.sourceId;
  if(record&&record.status==='COMPLETE'){
    if(digest!==row.afterSha256||baseline.sourceStamp!==gpdfStamp_(current.source))throw Error('ROPS_EDITABLE_CHANGED_AFTER_REPAIR');gpdfProps_().deleteProperty(intentKey);return;
  }
  if(digest!==row.beforeSha256&&digest!==row.afterSha256)throw Error('ROPS_EDITABLE_REVIEW_IN_PROGRESS');
  if(!record){
    if(digest!==row.beforeSha256)throw Error('ROPS_EDITABLE_REPAIR_INTENT_MISSING');drive.workspace();
    const backup=gpdfJson_('https://www.googleapis.com/drive/v3/files/'+row.sourceId+'/copy?fields=id',{method:'post',contentType:'application/json',payload:JSON.stringify({name:'ROPs — recuperação do material editável.docx',parents:[cfg.workspaceFolderId]})});
    record={formId:formId,sourceId:row.sourceId,beforeSha256:row.beforeSha256,afterSha256:row.afterSha256,backupId:backup.id,status:'PENDING'};state.editableRepairs.push(record);recovery.setContent(JSON.stringify(state));
  }
  if(digest===row.beforeSha256){
    gpdfProps_().setProperty(intentKey,row.afterSha256);
    const bytes=DriveApp.getFileById(row.replacementId).getBlob().getBytes();if(bytes.length>20*1024*1024||gvrDigest_(bytes)!==row.afterSha256)throw Error('ROPS_EDITABLE_REPLACEMENT_CHANGED');
    const fresh=gpdfPair_(pair,drive);if(fresh.source.md5Checksum!==current.source.md5Checksum||!fresh.source.etag||fresh.pdf.md5Checksum!==material.pdfMd5)throw Error('ROPS_EDITABLE_CONCURRENT_REVISION');
    gpdfHttp_('https://www.googleapis.com/upload/drive/v2/files/'+row.sourceId+'?uploadType=media',{method:'put',headers:{'If-Match':fresh.source.etag},contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',payload:bytes});
  }
  const after=gpdfPair_(pair,drive);if(after.source.md5Checksum!==row.afterMd5||after.pdf.md5Checksum!==material.pdfMd5)throw Error('ROPS_EDITABLE_REPAIR_POSTCHECK');
  // This is the initial conversion of the same material, not a published revision.
  // Its unchanged full PDF remains the authoritative reading version.
  baseline.sourceStamp=gpdfStamp_(after.source);gpdfSave_(gpdfStateKey_(pair),baseline);record.status='COMPLETE';recovery.setContent(JSON.stringify(state));gpdfProps_().deleteProperty(intentKey);
}
