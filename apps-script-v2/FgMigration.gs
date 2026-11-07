/** Stamped only by the source retirement publisher after release readiness. */
const SAHMT_FG_PUBLICATION_EPOCH = 0;
function sahmtFgRetired_(){return SAHMT_FG_PUBLICATION_EPOCH>0;}
function sahmtFgPath_(path){return /^(stations|checklists|checklistSignatures|checklistSignatureRequests|checklistResponsibilities|checklistScoreOutbox|checklistScienceRuntime)(?:\/|$)/.test(String(path));}
function sahmtFgSourcePath_(name){const root='projects/sahmt-17a16/databases/(default)/documents/';return String(name).startsWith(root)&&sahmtFgPath_(String(name).slice(root.length));}
function sahmtFgGuardWrite_(url,options){
  if(!sahmtFgRetired_())return;
  const method=String(options&&options.method||'get').toLowerCase();if(!['post','patch','put','delete'].includes(method))return;
  const path=decodeURIComponent(String(url).replace(/^https:\/\/firestore.googleapis.com\/v1\//,'').split('?')[0]);
  if(sahmtFgSourcePath_(path))throw Error('FG_SOURCE_MOVED');
  if(/:commit$|:batchWrite$/.test(path)){
    const body=JSON.parse(options&&options.payload||'{}');
    if((body.writes||[]).some(function(write){const name=write.update&&write.update.name||write.delete||write.transform&&write.transform.document;return sahmtFgSourcePath_(name)||String(name).startsWith('projects/sahmt-17a16/databases/(default)/documents/operationalSheetArchives/')&&/^checklists\//.test(String(write.update&&write.update.fields&&write.update.fields.sourceKey&&write.update.fields.sourceKey.stringValue||''));}))throw Error('FG_SOURCE_MOVED');
  }
}
