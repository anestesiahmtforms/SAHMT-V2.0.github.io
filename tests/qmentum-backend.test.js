import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const wrapper=readFileSync(new URL('../apps-script-v2/QmentumQuarterly.gs',import.meta.url),'utf8');
const core=readFileSync(new URL('../apps-script-v2/QmentumCore.gs',import.meta.url),'utf8');
test('Apps Script starts disabled, with no trigger or external call on file loading or disabled execution',()=>{
 let calls=0;const context=vm.createContext({Intl,URL,Date,Map,Set,TextEncoder,SAHMT_V2_CONFIG:{projectId:'sahmt-17a16',databaseId:'(default)'},sahmtV2Properties_:()=>({getProperty:()=>null}),UrlFetchApp:{fetch:()=>{calls++;throw Error('NO_NETWORK');}}});
 vm.runInContext(core+'\n'+wrapper,context);
 for(const name of ['reconciliarAnalisesQmentumV1','processarFilaQmentumV1','validarRevisoesQmentumV1','executarCicloQmentumV1'])assert.equal(context[name]().code,'QMENTUM_QUARTERLY_DISABLED');
 assert.equal(calls,0);
});
test('backend rejects a different Firebase project or database before any write',()=>{
 for(const config of [{projectId:'indicadores---sahmt',databaseId:'(default)'},{projectId:'sahmt-17a16',databaseId:'other'}]){
  const c=vm.createContext({SAHMT_V2_CONFIG:config});vm.runInContext(wrapper,c);assert.throws(()=>c.qmServerConfig_(),/FA_REQUIRED/);
 }
});
test('generated V8 core contains the same deterministic 18-indicator calculator',()=>{
 const c=vm.createContext({Intl,Date,Map,Set});vm.runInContext(core,c);assert.equal(typeof c.QmentumCore.calculateMonth,'function');assert.equal(typeof c.QmentumCore.quarterlyPlan,'function');
 assert.equal(c.QmentumCore.saoPauloPeriod(Date.parse('2027-01-01T01:00:00Z')).year,2026);
});
