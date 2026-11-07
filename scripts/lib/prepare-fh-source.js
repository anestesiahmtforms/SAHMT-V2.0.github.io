import vm from 'node:vm';
export function prepareFhSourceFiles(original,template){
 if(!Array.isArray(original)||original.some(x=>x.name==='FhMigration')||!template.includes('const SAHMT_FH_PUBLICATION_EPOCH = 0;'))throw Error('FH_SOURCE_PREP_INPUT');
 const files=original.map(x=>({...x,source:x.source.replace(/\r\n/g,'\n')}));
 let ordinal=0;const patch=(name,from,to)=>{ordinal++;const f=files.find(x=>x.name===name);if(!f||f.source.split(from).length!==2)throw Error('FH_SOURCE_PATCH_'+name.toUpperCase()+'_'+ordinal);f.source=f.source.replace(from,to);};
 patch('FiFjMigration','function firestoreRequest_(url,options) { sahmtFiFjGuardWrite_', 'function firestoreRequest_(url,options) { sahmtFhGuardWrite_(url,options); sahmtFiFjGuardWrite_');
 patch('FiFjMigration',"function ocsFirestore_(suffix,options) { sahmtFiFjGuardWrite_", "function ocsFirestore_(suffix,options) { sahmtFhGuardWrite_('https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents'+suffix,options); sahmtFiFjGuardWrite_");
 patch('OperationalSheetControl',"return !sahmtFiFjRetired_() || t.collection !== 'events';", "return (!sahmtFiFjRetired_() || t.collection !== 'events') && (!sahmtFhRetired_() || t.collection !== 'labels');");
 patch('OperationalSheetControl',"if(s.deleted||(sahmtFiFjRetired_()&&key.split('/')[0]==='events'))return;", "if(s.deleted||(sahmtFiFjRetired_()&&key.split('/')[0]==='events')||(sahmtFhRetired_()&&key.split('/')[0]==='labels'))return;");
 patch('OperationalSheetControl','function oscSummary_(book,state) {','function oscSummary_(book,state) {\n  if(sahmtFhRetired_())return;');
 patch('OperationalSheetPush','function ospReceive_(doc) {','function ospReceive_(doc) {\n  if(sahmtFhRetired_()&&sahmtFhSourcePath_(doc&&doc.name))return \'FH_SOURCE_MOVED\';');
 patch('OperationalContinuitySync',"excludeMigratedModules:sahmtFiFjRetired_()", "excludeMigratedModules:sahmtFiFjRetired_(),excludeFhLabels:sahmtFhRetired_()");
 patch('OperationalContinuitySync','for(const operation of remote.operations){',"for(const operation of remote.operations){\n      if(sahmtFhRetired_()&&operation.collection==='labels'){conflicts++;continue;}");
 patch('OperationalContinuitySync','const path=document.name.slice(prefix.length);',"const path=document.name.slice(prefix.length);if(sahmtFhRetired_()&&sahmtFhPath_(path))return;");
 patch('OperationalContinuitySync','const path=name.slice(prefix.length);',"const path=name.slice(prefix.length);if(sahmtFhRetired_()&&sahmtFhPath_(path))continue;");
 patch('OperationalContinuitySync',"return key.indexOf('SAHMT_CONTINUITY_DIRTY_')===0 &&", "return key.indexOf('SAHMT_CONTINUITY_DIRTY_')===0 && (!sahmtFhRetired_() || !sahmtFhPath_(String(JSON.parse(all[key]).path))) &&");
 patch('OperationalContinuitySync',"const staff=read('appConfig/labelStaff');put('labelStaff','all',staff.active===true&&Array.isArray(staff.siglas)?staff.siglas:[]);", "if(!sahmtFhRetired_()){const staff=read('appConfig/labelStaff');put('labelStaff','all',staff.active===true&&Array.isArray(staff.siglas)?staff.siglas:[]);}");
 patch('OperationalContinuitySync',"if(sahmtFiFjRetired_()&&kind==='events')continue;", "if((sahmtFiFjRetired_()&&kind==='events')||(sahmtFhRetired_()&&kind==='labels'))continue;");
 patch('OperationalContinuitySync','function ocsPublishSeed_(profiles,resources){',"function ocsPublishSeed_(profiles,resources){\n if(sahmtFhRetired_())resources=resources.filter(function(r){return r.kind!=='labels'&&r.kind!=='labelStaff';});");
 files.push({name:'FhMigration',type:'SERVER_JS',source:template});
 new vm.Script(files.filter(x=>x.type==='SERVER_JS').map(x=>x.source).join('\n'));
 if(files.find(x=>x.name==='appsscript')?.source!==original.find(x=>x.name==='appsscript')?.source.replace(/\r\n/g,'\n'))throw Error('FH_SOURCE_MANIFEST_CHANGED');
 return files;
}
