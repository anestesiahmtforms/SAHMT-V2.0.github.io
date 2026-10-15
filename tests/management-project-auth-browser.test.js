import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createFirebaseProjectAuthOptIn} from '../src/firebase-project-auth-optin.js';
import {createFirebaseProjectAuthCoordinator} from '../src/firebase-project-auth.js';
import {createFirebaseProjectBrokerTransport} from '../src/firebase-project-broker-transport.js';

const endpoint = 'https://broker.example.invalid/v1/management/session';
const projects = {FA:'sahmt-17a16',FB:'sahmt-gestao-5ae66',FC:'indicadores---sahmt'};
const source = readFileSync(new URL('../src/firebase-project-auth-browser.js',import.meta.url),'utf8');
const read = relative => readFileSync(new URL(relative,import.meta.url),'utf8');
const exportedFunctions = file => [...read(file).matchAll(/export function (\w+)/g)].map(match => match[1]).sort();

function harness({enabled = true, targetNames = ['FB','FC'], appMissing, existingFb = false, failure, bothMissing = false} = {}) {
  const calls = {imports:[],fbApp:0,fcAuth:0,initialize:[],fallback:0,fetch:0,requested:[],signIn:[],reports:[],registered:[],budgets:[]};
  const apps = Object.fromEntries(['FA','FB','FC'].map(alias => [alias,{name:alias,options:{projectId:projects[alias]}}]));
  const auths = Object.fromEntries(['FA','FB','FC'].map(alias => [alias,{app:apps[alias],currentUser:null}]));
  auths.FA.currentUser = {uid:'synthetic-pilot-uid',getIdToken:async()=> 'synthetic-fa-token'};
  // These public module contracts deliberately do not export their imported configuration flags.
  const fb = {getManagementApp() {calls.fbApp++; if(failure === 'FB_GETTER') throw Error('private initialization detail');
    return appMissing === 'FB' || bothMissing ? null : apps.FB;}, getManagementFirestore() {return null;}};
  const fc = {getIndicatorsApp() {return appMissing === 'FC' ? null : apps.FC;},
    getIndicatorsFirestore() {return null;},
    getIndicatorsAuth() {calls.fcAuth++; if(failure === 'FC_GETTER') throw Error('private initialization detail');
      return appMissing === 'FC' || bothMissing ? null : auths.FC;}};
  assert.deepEqual(Object.keys(fb).sort(),exportedFunctions('../src/management-firebase-app.js'));
  assert.deepEqual(Object.keys(fc).sort(),exportedFunctions('../src/indicators-firebase-app.js'));
  const authSdk = {inMemoryPersistence:{kind:'memory'},
    initializeAuth(app, options) {
      assert.ok(app, 'SDK must not receive an unavailable app');
      calls.initialize.push({projectId:app.options.projectId,persistence:options.persistence});
      if (failure === 'FB_SDK') throw Error('private SDK detail');
      if (existingFb) throw Object.assign(Error('already initialized'),{code:'auth/already-initialized'});
      return auths.FB;
    },getAuth(app) {calls.fallback++; assert.equal(app,apps.FB);return auths.FB;},
    onAuthStateChanged(_auth, callback) {callback(_auth.currentUser);return()=>{};},
    signOut:async auth=>{auth.currentUser=null;},
    signInWithCustomToken:async(auth,token)=>{
      const alias = auth.app.options.projectId === projects.FB ? 'FB' : 'FC';
      assert.equal(token,'synthetic-custom-' + alias);calls.signIn.push(alias);
      const user = {uid:'synthetic-pilot-uid'};auth.currentUser=user;return {user};
    }};
  const modules = {'./firebase-auth.js':{auth:auths.FA},'firebase/auth':authSdk,'firebase/app':{},
    './management-firebase-app.js':fb,'./indicators-firebase-app.js':fc,
    './firebase-project-auth.js':{createFirebaseProjectAuthCoordinator(options){calls.budgets.push(options.timeoutMs);return createFirebaseProjectAuthCoordinator(options);}},
    './firebase-project-broker-transport.js':{createFirebaseProjectBrokerTransport(options){calls.budgets.push(options.timeoutMs);return createFirebaseProjectBrokerTransport(options);}}};
  const env = {VITE_FIREBASE_PROJECT_AUTH_ENABLED:String(enabled),
    VITE_MANAGEMENT_FIREBASE_ENABLED:String(targetNames.includes('FB')),
    VITE_INDICATORS_FIREBASE_ENABLED:String(targetNames.includes('FC')),
    VITE_FIREBASE_PROJECT_AUTH_ENDPOINT:endpoint,VITE_FIREBASE_PROJECT_AUTH_ALLOWED_ORIGIN:new URL(endpoint).origin,
    VITE_MANAGEMENT_AUTH_PILOT_DIAGNOSTICS:'true'};
  const transformed = source.replace(/^import .*?;\r?\n/gm,'').replaceAll('import.meta','mockImportMeta')
    .replace(/\bimport\(/g,'mockImport(').replace('export function getFirebaseProjectAuthOptIn','function getFirebaseProjectAuthOptIn');
  const context = vm.createContext({mockImportMeta:{env},URL,createFirebaseProjectAuthOptIn,
    registerManagementPilotAuth:alias=>calls.registered.push(alias),beginManagementPilotConnect:()=>({}),
    finishManagementPilotConnect:(_attempt,result)=>calls.reports.push(result.status),
    mockImport:async name=>{calls.imports.push(name);assert.ok(modules[name], 'unexpected dependency');
      if(name === './management-firebase-app.js' && failure === 'FB_IMPORT'
        || name === './indicators-firebase-app.js' && failure === 'FC_IMPORT') throw Error('private import detail');
      return modules[name];},
    fetch:async(url,options)=>{
      calls.fetch++;assert.equal(url,endpoint);
      const request=JSON.parse(options.body);assert.equal(request.faIdToken,'synthetic-fa-token');
      calls.requested.push(Object.keys(request.targetProjectIds));
      const response=new Response(JSON.stringify({schemaVersion:1,sourceProjectId:projects.FA,faUid:'synthetic-pilot-uid',
        targets:Object.fromEntries(Object.keys(request.targetProjectIds).map(alias=>[alias,{projectId:projects[alias],
          status:'READY',uid:'synthetic-pilot-uid',customToken:'synthetic-custom-'+alias}]))}),
        {status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
      Object.defineProperty(response,'url',{value:endpoint});return response;
    }});
  vm.runInContext(transformed,context,{filename:'firebase-project-auth-browser.js'});
  return {calls,auths,instance:context.getFirebaseProjectAuthOptIn()};
}

for(const [name,configuration]of [['stale enabled flags',{}],['FB only',{targetNames:['FB']}],['FC only',{targetNames:['FC']}],['disabled flags',{enabled:false}],['missing secondary apps',{bothMissing:true}],['secondary import failure',{failure:'FC_IMPORT'}]]){
 test('FA-only browser never initializes secondary auth: '+name,async()=>{
  const h=harness(configuration),user=h.auths.FA.currentUser;
  assert.equal((await h.instance.connect()).status,'disabled');
  assert.deepEqual(h.calls.imports,[]);assert.equal(h.calls.fetch,0);assert.deepEqual(h.calls.signIn,[]);
  assert.equal(h.auths.FA.currentUser,user);h.instance.dispose();
 });
}