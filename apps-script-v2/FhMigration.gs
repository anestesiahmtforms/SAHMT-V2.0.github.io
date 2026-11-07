/** FA label producer retirement. The publication tool stamps the reviewed
 * source and waits for existing executions to drain before its final copy. */
const SAHMT_FH_PUBLICATION_EPOCH = 0;
function sahmtFhRetired_() { return SAHMT_FH_PUBLICATION_EPOCH > 0; }
function sahmtFhPath_(path) { return /^labels(?:\/|$)/.test(String(path)) || path === 'appConfig/labelStaff'; }
function sahmtFhSourcePath_(name) {
 const prefix='projects/sahmt-17a16/databases/(default)/documents/';
 return String(name).startsWith(prefix) && sahmtFhPath_(String(name).slice(prefix.length));
}
function sahmtFhGuardWrite_(url,options) {
 if(!sahmtFhRetired_())return;
 const method=String(options&&options.method||'get').toLowerCase();
 if(!['post','patch','put','delete'].includes(method))return;
 const path=decodeURIComponent(String(url).replace(/^https:\/\/firestore.googleapis.com\/v1\//,'').split('?')[0]);
 if(sahmtFhSourcePath_(path))throw Error('FH_SOURCE_MOVED');
 if(/:commit$|:batchWrite$/.test(path)){
  const body=JSON.parse(options&&options.payload||'{}');
  if((body.writes||[]).some(function(write){
   return sahmtFhSourcePath_(write.update&&write.update.name||write.delete||write.transform&&write.transform.document)||
    (String(write.update&&write.update.name||'').startsWith('projects/sahmt-17a16/databases/(default)/documents/operationalSheetArchives/')&&/^labels\//.test(String(write.update.fields&&write.update.fields.sourceKey&&write.update.fields.sourceKey.stringValue||'')));
  }))throw Error('FH_SOURCE_MOVED');
 }
}
