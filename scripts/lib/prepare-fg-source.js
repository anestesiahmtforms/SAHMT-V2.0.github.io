import vm from 'node:vm';
export function prepareFgSourceFiles(original,template){
  if(!Array.isArray(original)||original.some(f=>f.name==='FgMigration')||!template.includes('const SAHMT_FG_PUBLICATION_EPOCH = 0;'))throw Error('FG_SOURCE_PREP_INPUT');
  const files=original.map(file=>({...file,source:file.source.replace(/\r\n/g,'\n')}));
  const patch=(name,from,to)=>{const file=files.find(f=>f.name===name);if(!file||file.source.split(from).length!==2)throw Error('FG_SOURCE_PATCH_'+name.toUpperCase());file.source=file.source.replace(from,to);};
  patch('FiFjMigration','function firestoreRequest_(url,options) {','function firestoreRequest_(url,options) { sahmtFgGuardWrite_(url,options);');
  patch('FiFjMigration','function ocsFirestore_(suffix,options) {',"function ocsFirestore_(suffix,options) { sahmtFgGuardWrite_('https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents'+suffix,options);");
  patch('FiFjMigration','function faPerformanceRead_(collection,maximum,snapshot) {',"function faPerformanceRead_(collection,maximum,snapshot) {\n  if(sahmtFgRetired_()&&['checklistSignatures','checklistSignatureRequests'].includes(collection))return [];");
  for(const [file,names]of [
    ['ChecklistValidation',['validatePendingChecklistSignatureRequests','installChecklistValidationTrigger']],
    ['ChecklistScienceRelease',['instalarCienciaChecklistV1','validatePendingChecklistScienceRequests']],
    ['ChecklistProjection',['refreshChecklistResponsibilityProjection','reconcileChecklistResponsibilities','installChecklistResponsibilityTrigger']]
  ])for(const name of names)patch(file,'function '+name+'() {','function '+name+"() {\n  if(sahmtFgRetired_())return {code:'FG_SOURCE_MOVED',firestoreWrites:0};");
  patch('ChecklistValidation','function validateChecklistSignatureRequest_(request, options) {',"function validateChecklistSignatureRequest_(request, options) {\n  if(sahmtFgRetired_())return 'FG_SOURCE_MOVED';");
  patch('ChecklistProjection','function writeCurrentChecklistResponsibilityProjection_() {',"function writeCurrentChecklistResponsibilityProjection_() {\n  if(sahmtFgRetired_())return {code:'FG_SOURCE_MOVED',firestoreWrites:0};");
  patch('OperationalSheetControl','function oscRun_(mode,event) {',"function oscRun_(mode,event) {\n  if(sahmtFgRetired_())return {code:'FG_SOURCE_MOVED',updated:0,removed:0,received:0,conflicts:0};");
  patch('OperationalSheetPush','function ospReceive_(doc) {',"function ospReceive_(doc) {\n  if(sahmtFgRetired_()&&sahmtFgSourcePath_(doc&&doc.name))return 'FG_SOURCE_MOVED';");
  patch('OperationalContinuitySync','excludeFhLabels:sahmtFhRetired_()', 'excludeFhLabels:sahmtFhRetired_(),excludeFgChecklist:sahmtFgRetired_()');
  patch('OperationalContinuitySync','for(const operation of remote.operations){',"for(const operation of remote.operations){\n      if(sahmtFgRetired_()&&operation.collection==='checklists'){conflicts++;continue;}");
  patch('OperationalContinuitySync','const path=document.name.slice(prefix.length);',"const path=document.name.slice(prefix.length);if(sahmtFgRetired_()&&sahmtFgPath_(path))return;");
  patch('OperationalContinuitySync','const path=name.slice(prefix.length);',"const path=name.slice(prefix.length);if(sahmtFgRetired_()&&sahmtFgPath_(path))continue;");
  patch('OperationalContinuitySync',"return key.indexOf('SAHMT_CONTINUITY_DIRTY_')===0 &&", "return key.indexOf('SAHMT_CONTINUITY_DIRTY_')===0 && (!sahmtFgRetired_() || !sahmtFgPath_(String(JSON.parse(all[key]).path))) &&");
  patch('OperationalContinuitySync',"if((sahmtFiFjRetired_()&&kind==='events')||(sahmtFhRetired_()&&kind==='labels'))continue;", "if((sahmtFiFjRetired_()&&kind==='events')||(sahmtFhRetired_()&&kind==='labels')||(sahmtFgRetired_()&&kind==='checklists'))continue;");
  patch('OperationalContinuitySync','function ocsPublishSeed_(profiles,resources){',"function ocsPublishSeed_(profiles,resources){\n if(sahmtFgRetired_())resources=resources.filter(function(resource){return !['checklists','stations'].includes(resource.kind);});");
  files.push({name:'FgMigration',type:'SERVER_JS',source:template});
  new vm.Script(files.filter(f=>f.type==='SERVER_JS').map(f=>f.source).join('\n'));
  if(files.find(f=>f.name==='appsscript')?.source!==original.find(f=>f.name==='appsscript')?.source.replace(/\r\n/g,'\n'))throw Error('FG_SOURCE_MANIFEST_CHANGED');
  return files;
}
