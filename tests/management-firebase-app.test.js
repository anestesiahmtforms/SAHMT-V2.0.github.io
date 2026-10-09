import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/management-firebase-app.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export function getManagementApp','function getManagementApp');
const config={valid:true,projectId:'sahmt-gestao-5ae66',appId:'synthetic-fb-app',authDomain:'sahmt-gestao-5ae66.firebaseapp.com'};
function load(apps=[]){const calls=[];const context=vm.createContext({managementFirebaseConfig:config,managementFirebaseEnabled:false,
  getApps:()=>apps,initializeApp:(value,name)=>{calls.push(name);return {name,options:value};}});
  vm.runInContext(source,context);return {get:context.getManagementApp,calls};}
test('disabled management app never initializes another project',()=>{const h=load();assert.equal(h.get(),null);assert.equal(h.calls.length,0);});
test('reuse exact FB project/app/authDomain',()=>{const app={name:'sahmt-management',options:{...config}},h=load([app]);assert.equal(h.get({enabled:true}),app);assert.equal(h.calls.length,0);});
test('reject named FB instance that belongs to another project, app or Auth domain',async t=>{
  for(const key of ['projectId','appId','authDomain'])await t.test(key,()=>{const h=load([{name:'sahmt-management',options:{...config,[key]:'synthetic-wrong'}}]);assert.throws(()=>h.get({enabled:true}),/instância Firebase de Gestão/);assert.equal(h.calls.length,0);});
});
test('initialize approved named app only when no matching instance exists',()=>{const h=load([{name:'sahmt-v2',options:{projectId:'sahmt-17a16'}}]);const result=h.get({enabled:true});assert.equal(result.name,'sahmt-management');assert.equal(result.options.projectId,config.projectId);assert.equal(h.calls.length,1);});
