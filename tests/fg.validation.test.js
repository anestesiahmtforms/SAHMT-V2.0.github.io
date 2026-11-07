import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {planChecklistDailyPerformance} from '../fg-performance/daily-transfer.js';
const files=['Config.gs','PerformancePlan.gs','Firestore.gs','Performance.gs','ChecklistValidation.gs','ChecklistRotationCore.gs','Runtime.gs'];
const source=(await Promise.all(files.map(name=>readFile(new URL('../apps-script-fg/'+name,import.meta.url),'utf8')))).join('\n');
const plain=value=>JSON.parse(JSON.stringify(value));
const day='2026-11-07',signatureId=day+'_'+'b'.repeat(64);
function fixture({self=false,categories=['EFETIVO']}={}){
  const scheduled={id:'scheduled',uid:'scheduled',email:'scheduled@example.test',displayName:'Scheduled',active:true,access:true,permissions:{checklistSign:true},_updateTime:'synthetic-version'};
  const signer=self?scheduled:{...scheduled,id:'author',uid:'author',email:'author@example.test',displayName:'Author'};
  const assignment={schemaVersion:1,identityStatus:'LINKED',uid:signer.uid,email:signer.email,memberCategories:categories};
  const request={id:day,day,revision:'a'.repeat(64),signerUid:signer.uid,signerName:signer.displayName,signerSigla:'AA',declaration:true,justification:'Declaro que tomei ciência das informações deste relatório.',status:'PENDING_VALIDATION',recordKind:'ACKNOWLEDGEMENT',acknowledgedAt:new Date('2026-11-07T15:00:00Z'),rotationSigla:'BB',rotationPosition:1,_updateTime:'synthetic-version'};
  const snapshot={fingerprint:request.revision,revision:'b'.repeat(64),snapshot:{date:day},responsible:{responsibleUid:scheduled.uid,responsibleName:scheduled.displayName,responsibleEmail:scheduled.email,sigla:'BB',position:1},missing:0};
  const rows=new Map([['users/'+signer.uid,signer],['users/scheduled',scheduled],['checklistSignatureRequests/'+day,request],['checklistScienceRuntime/state',{enabled:true,release:'fg-checklist-independent-v1',activatedAt:new Date('2026-11-07T14:00:00Z') }]]);
  rows.set('userCategories/'+createHash('sha256').update(JSON.stringify(signer.email)).digest('hex'),assignment);
  const context=vm.createContext({console,Date,Map,Session:{getEffectiveUser:()=>({getEmail:()=> 'sahmtcheck@gmail.com'})},PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'YES'})},ScriptApp:{getScriptId:()=> '1Uz0wbYwRtuRPUVfFgN09S4HM9e5a7QM8D-M9bzZvCI04eRLu5RcDfLJF'},Utilities:{formatDate:()=>day,computeDigest:(_algorithm,text)=>[...createHash('sha256').update(text).digest()],DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'}}});
  vm.runInContext(source,context);context.oscOwner_=()=>{};
  context.evaluationGet_=(collection,id)=>rows.get(collection+'/'+id)||null;
  const realSnapshot=context.readTrustedChecklistSnapshot_;
  context.readTrustedChecklistSnapshot_=()=>snapshot;
  const runTransaction=context.checklistSourceTransaction_;
  const commits=[];context.checklistSourceTransaction_=fn=>{const result=fn('synthetic-transaction');commits.push(result.writes);return result.result;};
  return {context,commits,rows,signer,scheduled,assignment,request,snapshot,runTransaction,realSnapshot};
}
test('FG native planner remains equal to the tested domain planner for each scoring outcome',()=>{
  for(const input of [{},{self:true},{categories:['RESIDENTE_1']},{categories:['ADMINISTRADOR','EFETIVO']}]){
    const f=fixture(input),args={day,signatureId,signer:f.signer,scheduled:f.scheduled,assignment:f.assignment};
    assert.deepEqual(plain(f.context.planChecklistDailyPerformance(args)),plain(planChecklistDailyPerformance(args)));
  }
});
test('trusted FG acceptance commits signature, daily receipt, +1 and -1 together in one own-project batch',()=>{
  const f=fixture();assert.equal(f.context.validateChecklistSignatureRequest_({id:day},{scienceOnly:true}),'VALIDATED');assert.equal(f.commits.length,1);
  const writes=f.commits[0],decoded=plain(writes.map(w=>({path:w.update.name.split('/documents/')[1],data:f.context.firestoreFieldsToJs_(w.update.fields)})));
  assert.ok(writes.every(w=>w.update.name.startsWith('projects/sahmt-checklist-fg/databases/(default)/documents/')));
  assert.deepEqual(decoded.filter(w=>w.path.startsWith('fgPerformanceLedger/')).map(w=>[w.data.uid,w.data.points]),[['author',1],['scheduled',-1]]);
  assert.ok(decoded.some(w=>w.path==='checklistSignatures/'+signatureId&&w.data.snapshotValid===true));
  assert.ok(decoded.some(w=>w.path==='fgPerformanceReceipts/'+day));
  assert.ok(decoded.some(w=>w.path==='checklistSignatureRequests/'+day&&w.data.status==='VALIDATED'&&w.data.pointsAwarded===1&&w.data.responsibleAdjustment===-1));
});
test('scheduled authors and authors outside Equipe validate without awarding points',()=>{
  for(const input of [{self:true},{categories:['RESIDENTE_1']},{categories:['SUBSTITUTO']}]){
    const f=fixture(input);assert.equal(f.context.validateChecklistSignatureRequest_({id:day},{scienceOnly:true}),'VALIDATED');
    const paths=f.commits[0].map(w=>w.update.name.split('/documents/')[1]);assert.ok(paths.includes('fgPerformanceReceipts/'+day));assert.ok(!paths.some(p=>p.startsWith('fgPerformanceLedger/')));
  }
});
test('changed report or rotation, revoked authors and invalid membership cannot create points',()=>{
  for(const mutate of [f=>f.snapshot.fingerprint='c'.repeat(64),f=>f.snapshot.responsible.sigla='CC',f=>f.signer.active=false,f=>f.assignment.uid='foreign']){
    const f=fixture();mutate(f);const outcome=f.context.validateChecklistSignatureRequest_({id:day},{scienceOnly:true});assert.ok(['REJECTED','NEEDS_REVIEW'].includes(outcome));
    assert.ok(f.commits[0].every(w=>!w.update.name.includes('/fgPerformance')&&!w.update.name.includes('/checklistSignatures/')));
  }
});
test('settled daily requests and replays do not produce another ledger',()=>{
  const f=fixture();f.request.status='VALIDATED';assert.equal(f.context.validateChecklistSignatureRequest_({id:day},{scienceOnly:true}),'DUPLICATE');assert.equal(f.commits[0].length,0);
  assert.throws(()=>f.context.evaluationApplyChecklistTransfer_(day,'scheduled','author',signatureId,{}),/FG_PERFORMANCE_TRANSACTION_REQUIRED/);
});
test('native transaction rejects cross-project writes before committing',()=>{
  const f=fixture(),calls=[];f.context.checklistSourceTransaction_=f.runTransaction;
  f.context.firestoreRequest_=(url,options)=>{calls.push(url);return url.endsWith(':beginTransaction')?{transaction:'synthetic'}:{};};
  assert.throws(()=>f.context.checklistSourceTransaction_(()=>({writes:[{update:{name:'projects/sahmt-17a16/databases/(default)/documents/checklists/foreign',fields:{}}}],result:true})),/FG_TRANSACTION_WRITE_SCOPE/);
  assert.equal(calls.filter(url=>url.endsWith(':commit')).length,0);
});
test('changed FI/FJ inputs abort and retry instead of committing a stale local acceptance',()=>{
  const f=fixture(),calls=[];f.context.checklistSourceTransaction_=f.runTransaction;let reads=0;
  f.context.firestoreRequest_=(url,options)=>{calls.push(url);return url.endsWith(':beginTransaction')?{transaction:'synthetic'}:{};};
  f.context.fgExternalRequest_=()=>[{document:{name:'projects/sahmt-escala-fj/databases/(default)/documents/scheduleDays/'+day,updateTime:String(++reads),fields:{}}}];
  assert.throws(()=>f.context.checklistSourceTransaction_(tx=>{f.context.evaluationQuery_('scheduleDays',[],[],1,null,tx);return {writes:[],result:true};}),/FG_SOURCE_CHANGED/);
  assert.equal(reads,6);assert.equal(calls.filter(url=>url.endsWith(':rollback')).length,3);assert.equal(calls.filter(url=>url.endsWith(':commit')).length,0);
});
test('FG external transport forbids FI/FJ writes and foreign collections before any request',()=>{
  const f=fixture();f.context.UrlFetchApp={fetch:()=>assert.fail('Out-of-scope external operation reached network')};
  assert.throws(()=>f.context.fgExternalRequest_('events',':commit',{writes:[]}),/FG_EXTERNAL_READ_SCOPE/);
  assert.throws(()=>f.context.fgExternalRequest_('contacts',':runQuery',{structuredQuery:{from:[{collectionId:'users'}]}}),/FG_EXTERNAL_READ_SCOPE/);
});
function directoryFixture({conflict=false,ambiguous=false,fallback=false}={}){
  const f=fixture(),contact={id:'contact',sigla:'AA',active:true,name:'Scheduled',email:'scheduled@example.test'};
  f.rows.set('scheduleDays/'+day,{positions:[{position:1,sigla:'AA'}],highlights:{events:[]}});
  f.rows.set('contacts/contact',contact);
  f.context.evaluationQuery_=(collection,filters)=>{
    if(collection==='stations')return [{id:'station',name:'Synthetic',active:true,order:1}];
    if(collection==='contacts')return ambiguous?[contact,{...contact,id:'duplicate'}]:[contact];
    if(collection==='users'){
      if(fallback&&filters[0].field.fieldPath==='sigla')return [];
      return [{...f.scheduled,sigla:fallback?'':'AA',email:conflict?'wrong@example.test':contact.email}];
    }
    return [];
  };
  return f;
}
test('real snapshot reader rejects conflicting FI directory versus FG sigla identities and ambiguous contacts',()=>{
  for(const options of [{conflict:true},{ambiguous:true}]){
    const f=directoryFixture(options);assert.throws(()=>f.realSnapshot(day,'synthetic',{eventRotation:true}),/inconsistente|ambíguos/);
  }
});
test('real snapshot reader preserves consistent identity and the unique directory-email fallback',()=>{
  for(const fallback of [false,true]){
    const f=directoryFixture({fallback}),result=f.realSnapshot(day,'synthetic',{eventRotation:true});
    assert.equal(result.responsible.responsibleUid,'scheduled');assert.equal(result.responsible.responsibleEmail,'scheduled@example.test');assert.equal(result.responsible.sigla,'AA');
  }
});

function closingFixture(){
  const f=fixture();f.rows.delete('checklistSignatureRequests/'+day);
  f.rows.set('fgPerformanceRuntime/state',{status:'ACTIVE',projectId:'sahmt-checklist-fg',rule:'FG_DAILY_TEAM_ACKNOWLEDGEMENT_TRANSFER_V2',activatedAt:new Date('2026-11-07T14:00:00Z'),_updateTime:'runtime-version'});
  f.context.Utilities.formatDate=(date,zone,format)=>{
    assert.equal(zone,'America/Sao_Paulo');const local=new Date(date.getTime()-3*3600000).toISOString();return format==='yyyy-MM-dd'?local.slice(0,10):local.slice(0,19).replace('T',' ');
  };
  f.context.evaluationQuery_=(collection,filters)=>[...f.rows.entries()].filter(([key])=>key.startsWith(collection+'/')).map(([,row])=>row).filter(row=>row[filters[0].field.fieldPath]===filters[0].value.stringValue);
  f.apply=()=>{for(const write of f.commits.at(-1)){const path=write.update.name.split('/documents/')[1],data=f.context.firestoreFieldsToJs_(write.update.fields);f.rows.set(path,{...f.rows.get(path),...data,_updateTime:'new-version'});}};
  f.cutoff=new Date('2026-11-08T02:59:00Z');return f;
}
test('23:59 absence closes only the scheduled day with one atomic FG receipt, debit and summary',()=>{
  const f=closingFixture(),result=f.context.apurarDiaEncerradoChecklistFG_(day,f.cutoff);assert.equal(result.outcome,'NO_ACKNOWLEDGEMENT');
  const writes=f.commits[0],paths=writes.map(w=>w.update.name.split('/documents/')[1]);
  assert.deepEqual(plain(paths),['fgPerformanceReceipts/'+day,'fgPerformanceLedger/'+day+'_debit','fgPerformanceSummaries/scheduled']);
  const debit=f.context.firestoreFieldsToJs_(writes[1].update.fields);assert.equal(debit.points,-1);assert.equal(debit.uid,'scheduled');
  f.apply();f.context.apurarDiaEncerradoChecklistFG_(day,f.cutoff);assert.equal(f.commits[1].length,0);
  assert.throws(()=>f.context.apurarDiaEncerradoChecklistFG_('2026-11-06',f.cutoff),/FG_DAY_NOT_ELIGIBLE/);
});
test('23:58:59 stays open, while 23:59:00 closes using São Paulo rather than UTC',()=>{
  const f=closingFixture();assert.throws(()=>f.context.apurarDiaEncerradoChecklistFG_(day,new Date('2026-11-08T02:58:59.999Z')),/FG_DAY_NOT_ELIGIBLE/);
  assert.equal(f.context.apurarDiaEncerradoChecklistFG_(day,f.cutoff).outcome,'NO_ACKNOWLEDGEMENT');
});
test('pending on-time acknowledgement and settled transfer or zero receipt prevent another penalty',()=>{
  for(const previous of [null,{schemaVersion:1,day,outcome:'TRANSFER'},{schemaVersion:1,day,outcome:'SCHEDULED_USER_ACKNOWLEDGEMENT'}]){
    const f=closingFixture();if(previous)f.rows.set('fgPerformanceReceipts/'+day,previous);
    else f.rows.set('checklistSignatureRequests/'+day,{...f.request,acknowledgedAt:new Date('2026-11-08T02:58:59.999Z')});
    f.context.apurarDiaEncerradoChecklistFG_(day,f.cutoff);assert.equal(f.commits[0].length,0);
  }
});
test('unresolved scheduled identity produces review without penalty',()=>{
  const f=closingFixture();f.context.readTrustedChecklistSnapshot_=()=>{throw Error('INCONSISTENT_DIRECTORY');};
  assert.equal(f.context.apurarDiaEncerradoChecklistFG_(day,f.cutoff).outcome,'NEEDS_REVIEW');assert.equal(f.commits[0].length,0);
});
test('activation after the deadline cannot penalize an already closed day retroactively',()=>{
  const f=closingFixture();f.rows.get('checklistScienceRuntime/state').activatedAt=new Date('2026-11-08T02:59:00Z');
  assert.equal(f.context.apurarDiaEncerradoChecklistFG_(day,f.cutoff).outcome,'OUTSIDE_RELEASE');
  assert.equal(f.commits[0].length,0);
});
