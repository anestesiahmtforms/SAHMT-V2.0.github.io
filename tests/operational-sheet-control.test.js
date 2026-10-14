import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const src=readFileSync(new URL('../apps-script-v2/OperationalSheetControl.gs',import.meta.url),'utf8');
const config=readFileSync(new URL('../apps-script-v2/Config.gs',import.meta.url),'utf8');
const now=new Date('2026-10-13T18:20:00Z');
function env(extra={}) {
  const properties=new Map(),logs=[];
  const c=vm.createContext({Date,Map,Set,JSON,console:{log:s=>logs.push(s)},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k)})},
    Utilities:{parseDate:s=>new Date(s+'T03:00:00Z'),formatDate:(d,_tz,format)=>format==='yyyy-MM-dd'?new Date(d.getTime()-3*3600000).toISOString().slice(0,10):new Date(d.getTime()-3*3600000).toISOString().slice(5,7)+'/'+d.getUTCFullYear(),getUuid:()=> 'synthetic-archive'},...extra});
  vm.runInContext(config,c);vm.runInContext(src,c);
  return {c,properties,logs};
}
function doc(c,type,fields={}) {
  const common={id:'synthetic',active:true,date:'2026-10-13',createdByUid:'synthetic-author',createdByName:'Autor sintético',createdAt:now,updatedAt:now,version:1,role:'unchanged'};
  const data=type==='labels'?{patientName:'Sintético',encounterCode:'00015',procedureCode:'00123',insurance:'Convênio de teste',type:'Particular',creditor:'Caixa',amount:12.5,staffSiglas:[],status:'CONFIRMED'}:
    type==='events'?{memberStatus:'Sintético',eventType:'Pessoal',description:'',delayMultiple:null,substitute:'Teste',shift:'Integral',payer:'Teste',creditor:'Teste',amountToPay:2000,scheduleSigla:'AA',memberSigla:'BB',status:'OPEN'}:
    {stationId:'synthetic-station',condition:'SIM',occurrence:'',status:'COMPLETED'};
  return {name:c.oscFullName_(type+'/synthetic'),fields:c.firestoreFieldsFromJs_({...common,...data,...fields}),updateTime:now.toISOString()};
}
const plain=v=>JSON.parse(JSON.stringify(v));

test('syntax, bounded resources and original input headings',()=>{
  const {c}=env();const tables=vm.runInContext('OSC.tables',c);
  assert.deepEqual(Array.from(tables,t=>t.collection),['events','labels','checklists']);
  assert.deepEqual(Array.from(tables[1].columns,t=>t[1]),['Data da leitura','Nome do Paciente','Convênio','Atendimento','Cirurgia','Tipo','Credor','Valor em Real · opcional','PLANTONISTAS']);
  assert.deepEqual(Array.from(tables[2].columns,t=>t[1]),['Data','Arsenal','Condição','Ocorrência']);
  assert.deepEqual(Array.from(tables[0].columns,t=>t[1]),['Data do Evento','MEMBRO AUSENTE/ATRASADO','Tipo de Evento','Descrição do evento','Múltiplo do atraso','Substituto','Turno','Pagador','Credor','Valor a pagar']);
  assert.equal(src.includes('firebaseauth.googleapis.com'),false);
  assert(src.includes('function instalarControleOperacionalCompletoV1()'));
});
for(const type of ['events','labels','checklists']) {
  test(type+': real dates, text identifiers and baseline round trip',()=>{
    const {c}=env(),table=c.oscTable_(type),record=doc(c,type),row=c.oscRow_(table,record,{'synthetic-station':'Arsenal de teste'});
    assert(row[0] instanceof Date);assert.equal(row[0].toISOString(),'2026-10-13T03:00:00.000Z');
    assert.equal(Object.keys(c.oscEditedFields_(table,row,{cells:c.oscCanonical_(row)},{})).length,0);
    if(type==='labels')assert.equal(row[3],'00015');
  });
  test(type+': archival and reversible tombstone in ONE atomic commit; source ID survives',()=>{
    const {c}=env(),record=doc(c,type),table=c.oscTable_(type);
    const plan=c.oscPlanMutation_(table,record,{updateTime:record.updateTime},{},true,'archive',now);
    assert.equal(plan.writes.length,2);assert.equal(plan.writes[1].currentDocument.updateTime,record.updateTime);
    assert.equal(plan.writes[0].currentDocument.exists,false);
    assert.equal(plan.after.active,false);assert.equal(plan.after.sheetDeleted,true);
    for(const indexed of ['date','stationId','createdAt'])assert.equal(Object.hasOwn(plan.after,indexed),false);
    assert.equal(plan.writes[1].update.name,record.name);
    const archive=c.firestoreFieldsToJs_(plan.writes[0].update.fields);
    assert.deepEqual(JSON.parse(archive.snapshotJson),plain(record));
  });
  test(type+': concurrent app update blocks before mutation',()=>{
    const {c}=env();assert.throws(()=>c.oscPlanMutation_(c.oscTable_(type),doc(c,type),{updateTime:'old'},{},true,'archive',now),/CONTROLE_CONFLITO_COM_APP/);
  });
  test(type+': author, timestamp, UID and privileges are not editable',()=>{
    const {c}=env(),table=c.oscTable_(type),record=doc(c,type),row=c.oscRow_(table,record,{}),baseline={cells:c.oscCanonical_(row)};
    row[table.columns.length]='Outro autor';
    assert.throws(()=>c.oscEditedFields_(table,row,baseline,{}),/CONTROLE_COLUNA_TECNICA_ALTERADA/);
  });
}
test('Brazilian dates validate real calendar and preserve Sao Paulo timezone',()=>{
  const {c}=env();assert.equal(c.oscParseDate_('13/10/2026'),'2026-10-13');
  assert.equal(c.oscParseDate_(new Date('2026-10-14T01:15:00Z')),'2026-10-13');
  for(const bad of ['31/02/2026','01/13/2026','not a date'])assert.throws(()=>c.oscParseDate_(bad),/CONTROLE_DATA_INVALIDA/);
});
test('all display date formats are Brazilian; input dates are not converted to plain text',()=>{
  const {c}=env(),formats=[];
  const range={setFontWeight(){return this;},setFontColor(){return this;},setBackground(){return this;},setWrap(){return this;},setNumberFormat(x){formats.push(x);return this;},setNotes(){return this;},setVerticalAlignment(){return this;},createFilter(){}};
  const sheet={setFrozenRows(){},getRange:()=>range,setRowHeight(){},getFilter:()=>null,getMaxRows:()=>1000,setColumnWidth(){},setColumnWidths(){},hideColumns(){},getLastRow:()=>2};
  c.oscFormat_(sheet,c.oscTable_('labels'));assert(formats.includes('dd/MM/yyyy'));assert(formats.includes('dd/MM/yyyy HH:mm'));assert(formats.includes('@'));
});
test('formula text is escaped without endless round-trip differences',()=>{
  const {c}=env();assert.equal(c.oscSafeText_('=IMPORTXML("invalid")'),'\'=IMPORTXML("invalid")');
  assert(c.oscEqual_([c.oscSafeText_('=fake')],['=fake']));
});
test('edits cannot supply admin flags or overwrite source identity',()=>{
  const {c}=env(),record=doc(c,'labels'),table=c.oscTable_('labels');
  const plan=c.oscPlanMutation_(table,record,{updateTime:record.updateTime},{amount:22},false,'archive',now);
  assert.equal(plan.after.createdByUid,'synthetic-author');assert.equal(plan.after.role,'unchanged');assert.equal(plan.after.amount,22);assert.equal(plan.after.version,2);
  assert.equal(c.oscHeaders_(table).includes('role'),false);
});
test('condition and occurrence remain consistent; no responsibility imputation',()=>{
  const {c}=env(),record=doc(c,'checklists'),table=c.oscTable_('checklists');
  assert.throws(()=>c.oscPlanMutation_(table,record,{updateTime:record.updateTime},{condition:'NAO',occurrence:''},false,'a',now),/OCORRENCIA_OBRIGATORIA/);
  const p=c.oscPlanMutation_(table,record,{updateTime:record.updateTime},{condition:'NAO',occurrence:'Pendência sintética'},false,'a',now);
  assert.equal(p.after.status,'MAINTENANCE');assert.equal(Object.hasOwn(p.after,'responsibleUid'),false);
});
test('invalid enum, money, plantonistas, station or formula are rejected',()=>{
  const {c}=env(),table=c.oscTable_('labels'),record=doc(c,'labels'),data=c.firestoreFieldsToJs_(record.fields);
  for(const fields of [{type:'invalid'},{amount:-1},{staffSiglas:['A']},{creditor:'unknown'}])assert.throws(()=>c.oscValidate_(table,{...data,...fields}),/CONTROLE_/);
  const row=c.oscRow_(table,record,{}),baseline={cells:c.oscCanonical_(row)};row[1]='=FORMULA';
  assert.throws(()=>c.oscEditedFields_(table,row,baseline,{}),/FORMULA_NAO_PERMITIDA/);
});
test('pagination preserves all historical records and blocks repeated tokens',()=>{
  const {c}=env(),urls=[];let n=0;c.firestoreRequest_=(url,opts)=>{urls.push(url);assert.equal(opts.method,'get');return ++n===1?{documents:[{id:1}],nextPageToken:'second'}:{documents:[{id:2}]};};
  assert.equal(c.oscList_('labels').length,2);assert(urls[1].includes('pageToken=second'));
  c.firestoreRequest_=()=>({nextPageToken:'repeat'});assert.throws(()=>c.oscList_('labels'),/PAGINACAO_INVALIDA/);
});
test('incremental cursor breaks ties by document name with exact timestamp precision',()=>{
  const {c}=env(),cursor={timestamp:'2026-10-13T18:00:00.123456Z',name:c.oscFullName_('labels/synthetic')};
  const q=c.oscIncrementalQuery_(c.oscTable_('labels'),cursor).structuredQuery;
  assert.equal(q.startAt.before,false);assert.equal(q.startAt.values[0].timestampValue,cursor.timestamp);
  assert.equal(q.orderBy[1].field.fieldPath,'__name__');assert.equal(q.limit,200);
});
test('event removal updates only its marker and preserves other schedule fields',()=>{
  const {c}=env(),before=c.firestoreFieldsToJs_(doc(c,'events').fields);
  c.oscGet_=()=>({name:c.oscFullName_('scheduleDays/2026-10-13'),updateTime:'schedule-version',fields:c.firestoreFieldsFromJs_({version:3,highlights:{events:['EVENTO:AA:BB:synthetic','EVENTO:CC:DD:other'],notes:['keep']},unchanged:'keep'})});
  const writes=c.oscScheduleWrites_('events/synthetic',before,{sheetDeleted:true},now);
  assert.equal(writes.length,1);const changed=c.firestoreFieldsToJs_(writes[0].update.fields);
  assert.deepEqual(plain(changed.highlights.events),['EVENTO:CC:DD:other']);assert.equal(changed.unchanged,'keep');assert.equal(writes[0].currentDocument.updateTime,'schedule-version');
});
test('mutations use commit with archival precondition and never destructive DELETE',()=>{
  const {c}=env(),record=doc(c,'labels'),requests=[];
  c.oscGet_=()=>record;c.firestoreRequest_=(url,options)=>{requests.push({url,options});return {writeResults:[{updateTime:'one'},{updateTime:'two'}]};};
  const result=c.oscApply_({},c.oscTable_('labels'),'labels/synthetic',{updateTime:record.updateTime},{},true);
  assert.equal(result.updateTime,'two');assert.equal(requests.length,1);assert(requests[0].url.endsWith(':commit'));assert.equal(requests[0].options.method,'post');
  assert.equal(JSON.parse(requests[0].options.payload).writes.length,2);
});
test('failures return only safe codes, never raw error contents',()=>{
  const {c}=env();assert.equal(c.oscErrorCode_(new Error('sensitive email token response')),'CONTROLE_FALHA_SEGURA');assert.equal(c.oscErrorCode_({status:403,message:'sensitive'}),'CONTROLE_HTTP_403');
});
test('unknown trigger, wrong spreadsheet or disabled control cannot apply edits',()=>{
  const {c,properties}=env();properties.set('SAHMT_OPERATIONAL_SHEETS_ENABLED','YES');properties.set('SAHMT_OPERATIONAL_TRIGGER_IDS','["trusted"]');
  for(const e of [null,{triggerUid:'unknown',source:{getId:()=>vm.runInContext('OSC.sheetId',c)}},{triggerUid:'trusted',source:{getId:()=> 'wrong'}}])assert.equal(Boolean(c.oscTrigger_(e)),false);
  assert.equal(c.oscTrigger_({triggerUid:'trusted',source:{getId:()=>vm.runInContext('OSC.sheetId',c)}}),true);
});
test('initial load contains NO commit, activation does not infer removal, timer cannot authorize absent rows',()=>{
  const preparation=src.slice(src.indexOf('function prepararControleOperacionalV1()'),src.indexOf('function ativarControleOperacionalV1()'));
  assert.equal(preparation.includes('oscApply_'),false);assert.equal(preparation.includes(':commit'),false);
  assert(src.includes("if(mode==='REMOVE_ROW')"));assert(src.includes("if(!row && s.intent!=='DELETE')return"));
  assert(src.includes("event.changeType!=='REMOVE_ROW'"));
});

function runHarness() {
  const {c,properties,logs}=env(),state=new Map(),views={},calls=[],records=new Map();
  const tables=vm.runInContext('OSC.tables',c);
  const blankRange={setValues(){return this;},setNumberFormat(){return this;}};
  const status={getRange:()=>blankRange,setColumnWidths(){}};
  for(const t of tables){
    const record=doc(c,t.collection),cells=c.oscRow_(t,record,{}),key=t.collection+'/synthetic';
    records.set(key,record);state.set(key,{updateTime:record.updateTime,cells:c.oscCanonical_(cells),deleted:false});
    const rows=new Map([[key,{number:2,cells}]]);
    const sheet={getRange(number,_column,_count,width){
      const item=Array.from(rows.values()).find(r=>r.number===number);
      return {getValues:()=>[item?.cells||[]],getFormulas:()=>[Array(width||1).fill('')],setValue(){},setValues(values){if(item)item.cells=values[0];},clearContent(){}};
    },getLastRow:()=>2,getMaxRows:()=>1000};
    views[t.collection]={sheet,rows};
    properties.set('SAHMT_OPERATIONAL_CURSOR_'+t.collection,JSON.stringify({timestamp:now.toISOString()}));
  }
  properties.set('SAHMT_OPERATIONAL_SHEETS_ENABLED','YES');
  c.oscLocked_=fn=>fn();c.oscBook_=()=>({getSheetByName:()=>status});c.oscState_=()=>state;c.oscSaveState_=()=>{};c.oscCatalog_=()=>({});c.oscSummary_=()=>{};
  c.oscRows_=(_book,table)=>views[table.collection];c.oscGet_=key=>records.get(key)||null;
  c.firestoreRequest_=(url,options)=>{
    calls.push({url,options});
    if(url.endsWith(':runQuery'))return [];
    const writes=JSON.parse(options.payload).writes;
    for(const w of writes) records.set(w.update.name.split('/documents/')[1],{...w.update,updateTime:'2026-10-13T18:21:00Z'});
    return {writeResults:writes.map(()=>({updateTime:'2026-10-13T18:21:00Z'}))};
  };
  return {c,state,views,calls,records,properties,logs};
}
test('integrated timer with missing rows NEVER removes Firestore records',()=>{
  const h=runHarness();h.views.labels.rows.clear();
  const result=h.c.oscRun_('PULL',null);assert.equal(result.removed,0);assert.equal(h.calls.filter(c=>c.url.endsWith(':commit')).length,0);
});
test('integrated explicit row deletion archives one record and is idempotent',()=>{
  const h=runHarness();h.views.labels.rows.clear();
  const result=h.c.oscRun_('REMOVE_ROW',{});assert.equal(result.removed,1);
  assert.equal(h.state.get('labels/synthetic').deleted,true);assert.equal(h.calls.filter(c=>c.url.endsWith(':commit')).length,1);
  h.c.oscRun_('REMOVE_ROW',{});assert.equal(h.calls.filter(c=>c.url.endsWith(':commit')).length,1);
  assert(h.records.get('labels/synthetic').fields.sheetDeleted.booleanValue);
});
test('integrated edit preserves UID, updates baseline, and next timer does not repeat it',()=>{
  const h=runHarness();h.views.labels.rows.get('labels/synthetic').cells[7]=99;
  const result=h.c.oscRun_('EDIT',{});assert.equal(result.updated,1);
  assert.equal(h.records.get('labels/synthetic').fields.createdByUid.stringValue,'synthetic-author');
  h.c.oscRun_('PULL',null);assert.equal(h.calls.filter(c=>c.url.endsWith(':commit')).length,1);
});
test('integrated concurrent conflict preserves both spreadsheet edit and source record',()=>{
  const h=runHarness();h.views.labels.rows.get('labels/synthetic').cells[7]=99;h.records.get('labels/synthetic').updateTime='newer';
  const result=h.c.oscRun_('EDIT',{});assert.equal(result.conflicts,1);assert.equal(result.updated,0);assert.equal(h.views.labels.rows.get('labels/synthetic').cells[7],99);
  assert.equal(h.calls.filter(c=>c.url.endsWith(':commit')).length,0);
});
test('integrated failure retains explicit removal intent for controlled retry',()=>{
  const h=runHarness();h.views.labels.rows.clear();h.c.firestoreRequest_=()=>{throw {status:403};};
  const result=h.c.oscRun_('REMOVE_ROW',{});assert.equal(result.removed,0);assert.equal(h.state.get('labels/synthetic').intent,'DELETE');assert.equal(h.state.get('labels/synthetic').deleted,false);
  assert.equal(h.records.get('labels/synthetic').fields.active.booleanValue,true);
});
test('raw error and personal source fields never enter aggregate run logs',()=>{
  const h=runHarness();h.c.oscRun_('PULL',null);
  for(const forbidden of ['synthetic-author','Nome do Paciente','snapshotJson','Bearer'])assert.equal(h.logs.join('').includes(forbidden),false);
});
