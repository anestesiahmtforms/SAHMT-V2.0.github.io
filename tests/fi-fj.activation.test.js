import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
async function fixture(station, proof = {}) {
  const directory = new URL('../apps-script-' + station.toLowerCase() + '/', import.meta.url);
  const source = (await Promise.all(['Config.gs', 'Activation.gs'].map(file => readFile(new URL(file, directory), 'utf8')))).join('\n');
  const props = new Map([['FJ_SOURCE_SPREADSHEET_ID','synthetic-source-sheet']]), calls = [], triggers = [];
  const context = vm.createContext({console, Date, OSC: {sheetId:'synthetic-events-sheet'},
    oscOwner_:()=>{}, oscRun_:mode=>{assert.equal(mode,'PULL');return {received:3};}, ativarControleOperacionalV1:()=>({code:'CONTROLE_EDICOES_PLANILHA_ATIVO'}),
    Session:{getEffectiveUser:()=>({getEmail:()=> 'anestesiahmtforms10@gmail.com'})},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)})},
    ScriptApp:{getProjectTriggers:()=>[],newTrigger:name=>({timeBased(){return this;},everyMinutes(value){assert.equal(value,5);return this;},
      forSpreadsheet(){return this;},onOpen(){return this;},create(){triggers.push(name);return {getUniqueId:()=>name};}})},
    SpreadsheetApp:{openById:()=>({getSheetByName:()=>({})})}});
  vm.runInContext(source,context);
  context.sahmtV2RequirePrivateSpreadsheet_=()=>{}; context.firestoreFieldsToJs_=fields=>fields;
  context.firestoreRequest_=(url,options)=>{calls.push({url,options});return {fields:proof};};
  return {context,props,calls,triggers};
}
test('native activations cannot enable scripts before final data and projections are confirmed', async()=>{
  for(const station of ['FI','FJ'])for(const proof of [{}, {phase:'TARGETS_READY',finalDeltaVerified:true,moduleProjectionsReady:false}]){
    const f=await fixture(station,proof);
    assert.throws(()=>vm.runInContext(station==='FI'?'ativarOperacionalFI()':'ativarEscalaFJ()',f.context),/CORTE_NAO_CONFERIDO/);
    assert.equal(f.props.get(station+'_CUTOVER_ENABLED'),undefined);assert.equal(f.triggers.length,0);assert.equal(f.calls.length,1);
  }
});
test('FI and FJ activation receipts stay in their own database and expose independent publication modes', async()=>{
  const proof={phase:'TARGETS_READY',finalDeltaVerified:true,moduleProjectionsReady:true,
    targetProjects:{FI:'sahmt-operacional-fi',FJ:'sahmt-escala-fj'},finalDeltaSha256:'a'.repeat(64)};
  for(const station of ['FI','FJ']){
    const f=await fixture(station,proof);
    const result=vm.runInContext(station==='FI'?'ativarOperacionalFI()':'ativarEscalaFJ()',f.context);
    assert.equal(f.props.get(station+'_CUTOVER_ENABLED'),'YES');assert.equal(f.calls.length,2);
    assert.ok(f.calls.every(call=>call.url.includes('/projects/'+proof.targetProjects[station]+'/')));
    const receipt=JSON.parse(f.calls[1].options.payload).writes[0];assert.ok(receipt.update.name.endsWith('/migrationControl/apps-script-activation'));
    assert.equal(receipt.update.fields.station.stringValue,station);
    if(station==='FI'){assert.deepEqual(f.triggers,['receberEventosOperacionaisFI']);assert.equal(result.incrementalPullMinutes,5);}
    else {assert.deepEqual(f.triggers,['abrirMenuEscalaFJ']);assert.equal(result.firestoreScheduleWrites,0);}
  }
});
