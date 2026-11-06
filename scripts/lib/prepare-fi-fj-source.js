import vm from 'node:vm';
import {createHash} from 'node:crypto';
const scriptId='1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD';
const sort = value => Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
/** Pure transformation. The CLI never uses an OAuth credential or remote API. */
export function prepareSourceCapture(capture,template) {
 if(capture.station!=='FA'||capture.scriptId!==scriptId||capture.ownerEmail!=='anestesiahmtforms@gmail.com')throw Error('SOURCE_PREP_IDENTITY_MISMATCH');
 if(!Array.isArray(capture.files)||new Set(capture.files.map(f=>f.name)).size!==capture.files.length||capture.files.some(f=>f.name==='FiFjMigration'))throw Error('SOURCE_PREP_FILES_INVALID');
 const files=capture.files.map(f=>({...f}));
 const patch=(name,pattern,replacement)=>{
  const f=files.find(f=>f.name===name);if(!f)throw Error('SOURCE_PREP_FILE_MISSING_'+name);
  const re=typeof pattern==='string'?null:new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g');
  const count=re?[...f.source.matchAll(re)].length:f.source.split(pattern).length-1;
  if(count!==1)throw Error('SOURCE_PREP_PATCH_MISMATCH_'+name);
  f.source=f.source.replace(pattern,replacement);
 };
 for(const [file,name,original] of [
  ['Config','firestoreRequest_','FirestoreRequest'],['ChecklistValidation','getFirestoreDocument_','GetFirestoreDocument'],['ChecklistValidation','queryFirestore_','QueryFirestore'],
  ['EvaluationLedger','evaluationGet_','EvaluationGet'],['EvaluationLedger','evaluationQuery_','EvaluationQuery'],['FaPerformance','faPerformanceRead_','FaPerformanceRead'],['OperationalContinuitySync','ocsFirestore_','OcsFirestore']
 ])patch(file,new RegExp('function '+name+'\\('),'function sahmtFiFjOriginal'+original+'_(');
 patch('ScheduleSourceSync','function publishScheduleSourceToFirestore() {',"function publishScheduleSourceToFirestore() {\n  if (sahmtFiFjRetired_()) throw Error('FI_FJ_SOURCE_MOVED');");
 patch('OperationalSheetControl','  tables: [','  get tables() { return [');
 patch('OperationalSheetControl',/  \]\r?\n\}\);/,"  ].filter(function(t) { return !sahmtFiFjRetired_() || t.collection !== 'events'; }); }\n});");
 patch('OperationalSheetControl',"if(!s.deleted&&!views[key.split('/')[0]].rows.has(key))","if(!s.deleted&&views[key.split('/')[0]]&&!views[key.split('/')[0]].rows.has(key))");
 patch('OperationalSheetControl',"if(s.deleted)return;","if(s.deleted||(sahmtFiFjRetired_()&&key.split('/')[0]==='events'))return;");
 patch('OperationalSheetPush','function ospReceive_(doc) {',"function ospReceive_(doc) {\n  if (sahmtFiFjRetired_() && /^projects\\/sahmt-17a16\\/databases\\/\\(default\\)\\/documents\\/events\\//.test(String(doc && doc.name))) return 'CONTROLE_REGISTRO_MOVED';");
 patch('SparkReportSync','function listSparkReportChanges_(config, limit) {',"function listSparkReportChanges_(config, limit) {\n  if (sahmtFiFjRetired_() && config.type === 'events') return [];");
 // Leave retired operations unclaimed and unconfirmed for the final reconciliation.
 patch('OperationalContinuitySync',"const remote=ocsRemote_({schemaVersion:1,action:'drain'});","const remote=ocsRemote_({schemaVersion:1,action:'drain',excludeMigratedModules:sahmtFiFjRetired_()});");
 patch('OperationalContinuitySync','for(const operation of remote.operations){',"for(const operation of remote.operations){\n      if(sahmtFiFjRetired_()&&['events','scheduleReleases','scheduleDays','vacations','eventCatalogs'].includes(operation.collection)){conflicts++;continue;}");
 // Filter before the batch limit: pending module keys must not starve labels/checklists.
 patch('OperationalContinuitySync',"return key.indexOf('SAHMT_CONTINUITY_DIRTY_')===0;","return key.indexOf('SAHMT_CONTINUITY_DIRTY_')===0 && (!sahmtFiFjRetired_() || !sahmtFiFjTarget_(String(JSON.parse(all[key]).path).split('/')[0]));");
 patch('OperationalContinuitySync',"const path=document.name.slice(prefix.length);","const path=document.name.slice(prefix.length);\n  if(sahmtFiFjRetired_()&&sahmtFiFjTarget_(path.split('/')[0]))return;");
 patch('OperationalContinuitySync',"const path=name.slice(prefix.length);if(!/", "const path=name.slice(prefix.length);if(sahmtFiFjRetired_()&&sahmtFiFjTarget_(path.split('/')[0]))continue;if(!/");
 patch('OperationalContinuitySync',"const docs=function(name,max,where){","const docs=function(name,max,where){\n  if(sahmtFiFjRetired_()&&sahmtFiFjTarget_(name))return [];");
 patch('OperationalContinuitySync',"put('eventCatalogs','operational',read('eventCatalogs/operational'));","if(!sahmtFiFjRetired_())put('eventCatalogs','operational',read('eventCatalogs/operational'));");
 patch('OperationalContinuitySync',"const schedule=read('scheduleDays/'+day);put('scheduleDays',day,Object.assign({id:day},schedule));","if(!sahmtFiFjRetired_()){const schedule=read('scheduleDays/'+day);put('scheduleDays',day,Object.assign({id:day},schedule));}");
 patch('OperationalContinuitySync',"for(const kind of ['events','labels','checklists']){","for(const kind of ['events','labels','checklists']){\n  if(sahmtFiFjRetired_()&&kind==='events')continue;");
 patch('OperationalContinuitySync','function ocsPublishSeed_(profiles,resources){',"function ocsPublishSeed_(profiles,resources){\n if(sahmtFiFjRetired_())resources=resources.filter(function(resource){return !sahmtFiFjTarget_(resource.kind);});");
 if(!template.includes('const SAHMT_FI_FJ_PUBLICATION_EPOCH = 0;'))throw Error('SOURCE_PREP_PUBLICATION_EPOCH_REQUIRED');
 files.push({name:'FiFjMigration',type:'SERVER_JS',source:template});
 for(const f of files.filter(f=>f.type==='SERVER_JS'))new vm.Script(f.source,{filename:f.name});
 // Also reject duplicate lexical declarations across files before publication.
 new vm.Script(files.filter(f=>f.type==='SERVER_JS').map(f=>f.source).join('\n'));
 return {...capture,files,preparedAt:new Date().toISOString(),sourceSha256:digest(capture.files),publicationEpoch:0};
}
