import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const path=new URL('../apps-script-v2/FiFjMigration.gs',import.meta.url);
const source=existsSync(path)?readFileSync(path,'utf8'):'';
function harness({retired=false,ready=false,publicationEpoch=0}={}) {
 const props=new Map(retired?[['SAHMT_FI_FJ_PRODUCERS_RETIRED','YES']]:[]), calls=[];
 const c={console,Date,SAHMT_V2_CONFIG:{projectId:'sahmt-17a16'},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),setProperty:(k,v)=>props.set(k,v)})},Session:{getEffectiveUser:()=>({getEmail:()=> 'anestesiahmtforms@gmail.com'})},ScriptApp:{getScriptId:()=> '1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD'},firestoreFieldsToJs_:f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,v.stringValue??v.booleanValue??Number(v.integerValue)])),faPerformanceFields_:f=>Object.fromEntries(Object.entries(f).map(([k,v])=>[k,v.timestampValue?Date.parse(v.timestampValue):v.stringValue])),sahmtFiFjOriginalGetFirestoreDocument_: (...a)=>a[0]==='migrationControl'?{phase:ready?'TARGETS_READY':'SOURCE_PRODUCERS_RETIRED',finalDeltaVerified:ready,moduleProjectionsReady:ready,targetProjects:{FI:'sahmt-operacional-fi',FJ:'sahmt-escala-fj'}}:({legacy:a}),sahmtFiFjOriginalFirestoreRequest_:(url,options)=>{calls.push({url,options});return [{readTime:'2026-11-06T00:00:00Z'}];}};
 c.faPerformanceIdentity_=()=>{};
 for(const name of ['QueryFirestore','EvaluationGet','EvaluationQuery','FaPerformanceRead','OcsFirestore']) c['sahmtFiFjOriginal'+name+'_']=(...a)=>({legacy:a});
 vm.createContext(c);vm.runInContext(source.replace('const SAHMT_FI_FJ_PUBLICATION_EPOCH = 0;','const SAHMT_FI_FJ_PUBLICATION_EPOCH = '+publicationEpoch+';'),c);return {c,props,calls,run:s=>vm.runInContext(s,c)};
}
test('migration template is present',()=>assert.ok(source.includes('function retirarEscalaEventosFA')));
test('inactive wrappers delegate unchanged and retirement alone keeps legacy reads',()=>{
 for(const retired of [false,true]) {const h=harness({retired});assert.equal(h.run("getFirestoreDocument_('events','a').legacy[0]"),'events');assert.equal(h.run("evaluationQuery_('scheduleDays',[],[],2,null,'fa-token').legacy[5]"),'fa-token');}
});
test('read activation requires complete target proof and becomes sticky',()=>{const h=harness({retired:true,ready:true});assert.equal(h.run('sahmtFiFjReadsActive_()'),true);assert.equal(h.props.get('SAHMT_FI_FJ_READS_ACTIVE'),'YES');});
test('target collection allowlist rejects inherited object keys',()=>{const h=harness({retired:true,ready:true});for(const collection of ['constructor','__proto__','toString'])assert.equal(h.c.sahmtFiFjTarget_(collection),null);});
test('every proof component gates activation without activating readers on retirement',()=>{for(const broken of [{phase:'SOURCE_PRODUCERS_RETIRED'},{finalDeltaVerified:false},{moduleProjectionsReady:false},{targetProjects:{FI:'wrong',FJ:'sahmt-escala-fj'}}]){const h=harness({retired:true,ready:true});const original=h.c.sahmtFiFjOriginalGetFirestoreDocument_;h.c.sahmtFiFjOriginalGetFirestoreDocument_=(...a)=>({...original(...a),...broken});assert.equal(h.run('sahmtFiFjReadsActive_()'),false);assert.equal(h.props.get('SAHMT_FI_FJ_READS_ACTIVE'),undefined);}});
test('cross-project query retains projection/cursor, drops FA transaction and never falls back',()=>{const h=harness({retired:true,ready:true});h.run("evaluationQuery_('scheduleDays',[],[],7,['date'],'fa-token',{values:[]})");const call=h.calls[0],b=JSON.parse(call.options.payload);assert.match(call.url,/sahmt-escala-fj/);assert.equal(b.transaction,undefined);assert.equal(b.structuredQuery.limit,7);assert.equal(b.structuredQuery.select.fields[0].fieldPath,'date');assert.ok(b.structuredQuery.startAt);h.c.sahmtFiFjOriginalFirestoreRequest_=()=>{throw Error('DENIED');};assert.throws(()=>h.run("getFirestoreDocument_('events','a')"),/DENIED/);});
test('source mutation guard covers direct and atomic writes but preserves unrelated writes and reads',()=>{const h=harness({retired:true});const base='https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents';for(const suffix of ['/events/a','/scheduleDays/a','/vacations/a','/eventCatalogs/a'])assert.throws(()=>h.c.firestoreRequest_(base+suffix,{method:'patch'}),/MOVED/);for(const write of [{update:{name:base.replace('https://firestore.googleapis.com/v1/','')+'/events/a'}},{delete:base.replace('https://firestore.googleapis.com/v1/','')+'/events/a'},{transform:{document:base.replace('https://firestore.googleapis.com/v1/','')+'/events/a'}}])assert.throws(()=>h.c.firestoreRequest_(base+':commit',{method:'post',payload:JSON.stringify({writes:[write]})}),/MOVED/);h.c.firestoreRequest_(base+'/labels/a',{method:'patch'});h.c.firestoreRequest_(base+':runQuery',{method:'post',payload:'{}'});h.c.firestoreRequest_(base.replace('sahmt-17a16','sahmt-operacional-fi')+'/events/a',{method:'patch'});assert.equal(h.calls.length,3);assert.throws(()=>h.c.ocsFirestore_('/events/a',{method:'delete'}),/MOVED/);});
test('native entrypoints reject wrong identity and publication epoch zero',()=>{const h=harness();h.c.Session.getEffectiveUser=()=>({getEmail:()=> 'wrong@example.com'});assert.throws(()=>h.run('prepararSeparacaoEscalaEventosFA()'),/OWNER/);h.c.Session.getEffectiveUser=()=>({getEmail:()=> 'anestesiahmtforms@gmail.com'});h.c.SAHMT_V2_CONFIG.projectId='wrong';assert.throws(()=>h.run('prepararSeparacaoEscalaEventosFA()'),/PROJECT/);h.c.SAHMT_V2_CONFIG.projectId='sahmt-17a16';assert.throws(()=>h.run('retirarEscalaEventosFA()'),/PUBLICATION/);});
test('retirement waits for old executions and writes only masked control metadata under lock',()=>{
 const young=harness({publicationEpoch:Date.now()-1000});assert.throws(()=>young.run('retirarEscalaEventosFA()'),/PUBLICATION/);
 const h=harness({publicationEpoch:Date.now()-360001});let held=false;const removed=[];
 h.c.LockService={getScriptLock:()=>({tryLock:()=>{held=true;return true;},releaseLock:()=>{held=false;}})};
 h.c.sahmtFiFjOriginalGetFirestoreDocument_=()=>({phase:'SOURCE_RULES_FROZEN',_updateTime:'version',targetProjects:{FI:'sahmt-operacional-fi',FJ:'sahmt-escala-fj'}});
 h.c.firestoreFieldsFromJs_=v=>v;h.c.ScriptApp.EventType={CLOCK:'CLOCK'};
 const triggers=[['publishScheduleSourceToFirestore','CLOCK'],['labelsHandler','CLOCK'],['publishScheduleSourceToFirestore','ON_EDIT']].map(([name,type])=>({getHandlerFunction:()=>name,getEventType:()=>type}));h.c.ScriptApp.getProjectTriggers=()=>triggers;h.c.ScriptApp.deleteTrigger=t=>{assert.ok(held);removed.push(t);};
 const result=h.run('retirarEscalaEventosFA()');assert.equal(result.readersActivated,false);assert.equal(held,false);assert.deepEqual(removed,[triggers[0]]);assert.equal(h.props.get('SAHMT_FI_FJ_PRODUCERS_RETIRED'),'YES');assert.equal(h.props.get('SAHMT_FI_FJ_READS_ACTIVE'),undefined);
 assert.equal(h.calls.length,5);const writes=JSON.parse(h.calls[4].options.payload).writes;assert.equal(writes.length,1);assert.match(writes[0].update.name,/migrationControl\/fi-fj-cutover$/);assert.equal(writes[0].update.fields.sourceProducersRetired,true);assert.equal(writes[0].currentDocument.updateTime,'version');assert.deepEqual(writes[0].updateMask.fieldPaths,Object.keys(writes[0].update.fields));
});
test('retirement rejects unfrozen state and readers reject wrong project response',()=>{
 const h=harness({publicationEpoch:Date.now()-360001});h.c.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})};assert.throws(()=>h.run('retirarEscalaEventosFA()'),/FREEZE/);assert.equal(h.props.get('SAHMT_FI_FJ_PRODUCERS_RETIRED'),undefined);
 const r=harness({retired:true,ready:true});r.c.sahmtFiFjOriginalFirestoreRequest_=()=>({name:'projects/sahmt-17a16/databases/(default)/documents/events/a',fields:{}});assert.throws(()=>r.run("getFirestoreDocument_('events','a')"),/SCOPE/);
});
test('performance uses numeric date decoder and consistent readTime',()=>{const h=harness({retired:true,ready:true});h.c.sahmtFiFjOriginalFirestoreRequest_=(url,options)=>{h.calls.push({url,options});return [{document:{name:'projects/sahmt-operacional-fi/databases/(default)/documents/events/a',fields:{createdAt:{timestampValue:'2026-11-01T00:00:00Z'}}},readTime:'2026-11-06T00:00:00Z'}];};const rows=h.run("faPerformanceRead_('events',10,{readTime:'2026-11-06T00:00:00Z'})");assert.equal(rows[0].createdAt,Date.parse('2026-11-01T00:00:00Z'));assert.equal(JSON.parse(h.calls[0].options.payload).readTime,'2026-11-06T00:00:00Z');});
test('performance preserves native executor guard before target read',()=>{const h=harness({retired:true,ready:true});h.c.faPerformanceIdentity_=()=>{throw Error('FA_EXECUTOR_MISMATCH');};assert.throws(()=>h.run("faPerformanceRead_('events',10,{})"),/FA_EXECUTOR_MISMATCH/);assert.equal(h.calls.length,0);});
test('source preparation preserves unrelated files and retires only event sheet table',async()=>{
 const modulePath=new URL('../scripts/lib/prepare-fi-fj-source.js',import.meta.url);
 assert.ok(existsSync(modulePath),'source preparation tool exists');
 const {prepareSourceCapture}=await import(modulePath);
 const names=['Config','ChecklistValidation','EvaluationLedger','FaPerformance','OperationalContinuitySync','OperationalSheetControl','OperationalSheetPush','SparkReportSync','ScheduleSourceSync'];
 const files=names.map(name=>({name,type:'SERVER_JS',source:readFileSync(new URL('../apps-script-v2/'+name+'.gs',import.meta.url),'utf8')}));
 files.push({name:'appsscript',type:'JSON',source:'{"oauthScopes":["preserve-exact"]}'},{name:'Other',type:'SERVER_JS',source:'function unrelated(){return 42;}\r\n'});
 const capture={station:'FA',scriptId:'1ReIZEXaVspXDYFP3u5g4pJNPKVOsrafNWACmsPVIbgq85Zav9sjkR4bD',ownerEmail:'anestesiahmtforms@gmail.com',files};
 const prepared=prepareSourceCapture(capture,source);
 for(const name of ['appsscript','Other'])assert.equal(prepared.files.find(f=>f.name===name).source,files.find(f=>f.name===name).source);
 const h=harness();vm.runInContext(prepared.files.find(f=>f.name==='OperationalSheetControl').source,h.c);
 assert.equal(h.run("OSC.tables.map(t=>t.collection).join(',')"),'events,labels,checklists');h.props.set('SAHMT_FI_FJ_PRODUCERS_RETIRED','YES');assert.equal(h.run("OSC.tables.map(t=>t.collection).join(',')"),'labels,checklists');
 const state=new Map([['events/old',{deleted:false,intent:'DELETE'}],['labels/a',{deleted:false}],['checklists/b',{deleted:false}]]),applied=[];
 const sheet={getRange:()=>({setValues(){},setNumberFormat(){}}),setColumnWidths(){}};
 Object.assign(h.c,{sahmtV2Properties_:()=>({getProperty:()=> 'YES'}),oscLocked_:f=>f(),oscBook_:()=>({getSheetByName:()=>sheet}),oscState_:()=>state,oscCatalog_:()=>({}),oscRows_:()=>({rows:new Map(),sheet}),oscSaveState_:()=>{},oscApply_:(book,t,key)=>{applied.push(key);return {updateTime:'now'};},oscSummary_:()=>{},oscResult_:(code,result)=>result});
 const sync=h.run("oscRun_('REMOVE_ROW',null)");assert.equal(sync.removed,2);assert.deepEqual(applied,['labels/a','checklists/b']);assert.equal(state.get('events/old').deleted,false);assert.equal(state.get('events/old').intent,'DELETE');
 vm.runInContext(prepared.files.find(f=>f.name==='OperationalSheetPush').source,h.c);assert.equal(h.run("ospReceive_({name:'projects/sahmt-17a16/databases/(default)/documents/events/old'})"),'CONTROLE_REGISTRO_MOVED');
 vm.runInContext(prepared.files.find(f=>f.name==='OperationalContinuitySync').source,h.c);
 h.props.set('SAHMT_CONTINUITY_SYNC_ENABLED','YES');
 const remoteCalls=[],ops=[{collection:'events',uid:'uid',requestId:'event'},{collection:'scheduleReleases',uid:'uid',requestId:'release'},{collection:'labels',uid:'uid',requestId:'label'},{collection:'checklists',uid:'uid',requestId:'checklist'}];
 Object.assign(h.c,{LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},ocsFlushSources_:()=>0,ocsGet_:()=>({data:{uid:'uid'}}),SahmtContinuity:{reconcileContinuityOperation:op=>({state:'confirmed',record:{id:op.requestId}})},ocsRemote_:body=>{remoteCalls.push(body);return body.action==='drain'?{code:'CONTINUITY_DRAIN',operations:ops}:body.action==='claim'?{code:'CONTINUITY_CLAIMED'}:{code:'CONTINUITY_OK'};}});
 const continuity=h.run('sincronizarCanalOperacionalRemotoV1()');assert.equal(continuity.confirmed,2);assert.equal(continuity.conflicts,2);assert.deepEqual(remoteCalls.filter(c=>c.action==='claim').map(c=>c.requestId),['label','checklist']);assert.deepEqual(remoteCalls.filter(c=>c.action==='complete').map(c=>c.requestId),['label','checklist']);assert.equal(h.props.get('SAHMT_CONTINUITY_PAUSE_UNTIL'),undefined);
 const osc=prepared.files.find(f=>f.name==='OperationalSheetControl').source;
 assert.match(osc,/views\[key.split\('\/'\)\[0\]\]&&/);
 assert.match(osc,/if\(s.deleted\|\|\(sahmtFiFjRetired_\(\)&&key.split\('\/'\)\[0\]==='events'\)\)return/);
 assert.throws(()=>prepareSourceCapture({...capture,ownerEmail:'wrong'},source),/IDENTITY/);
 assert.throws(()=>prepareSourceCapture({...capture,files:files.map(f=>f.name==='OperationalSheetControl'?{...f,source:f.source.replace('tables: [','tables: unavailable [')}:f)},source),/PATCH/);
});
