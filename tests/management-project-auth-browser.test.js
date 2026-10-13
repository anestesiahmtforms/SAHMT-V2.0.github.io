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

test('browser composes real FB/FC module exports and authenticates both with one FA proof',async()=>{
  const h=harness();const result=await h.instance.connect();
  assert.equal(result.status,'ready');assert.deepEqual(h.calls.signIn.sort(),['FB','FC']);
  assert.equal(h.calls.fetch,1);assert.equal(h.calls.fbApp,1);assert.equal(h.calls.fcAuth,1);
  assert.deepEqual(h.calls.budgets,[90000,90000]);assert.deepEqual(h.calls.registered,['FB','FC']);
  assert.deepEqual(h.calls.reports,['ready']);assert.equal(h.auths.FA.currentUser.uid,'synthetic-pilot-uid');
  h.instance.dispose();
});

test('browser honors FB-only and FC-only module contracts without initializing the other target',async()=>{
  for(const alias of ['FB','FC']) {
    const h=harness({targetNames:[alias]});const result=await h.instance.connect();
    assert.equal(result.status,'ready');assert.deepEqual(h.calls.signIn,[alias]);
    assert.equal(h.calls.fbApp,alias==='FB'?1:0);assert.equal(h.calls.fcAuth,alias==='FC'?1:0);h.instance.dispose();
  }
});

test('browser stays disabled without importing SDKs or sending requests',async()=>{
  const h=harness({enabled:false});assert.equal((await h.instance.connect()).status,'disabled');
  assert.equal(h.calls.imports.length,0);assert.equal(h.calls.fetch,0);
});

test('null app/auth fails closed before broker while the existing FB Auth fallback remains supported',async()=>{
  for(const alias of ['FB','FC']) {
    const h=harness({targetNames:[alias],appMissing:alias});
    const result = await h.instance.connect();
    assert.equal(result.status,'blocked');assert.equal(result.targets[alias].code,'TARGET_AUTH_UNAVAILABLE');assert.equal(h.calls.fetch,0);
    assert.equal(h.calls.initialize.length,0);h.instance.dispose();
  }
  const existing=harness({targetNames:['FB'],existingFb:true});
  assert.equal((await existing.instance.connect()).status,'ready');assert.equal(existing.calls.fallback,1);existing.instance.dispose();
});

test('target import, getter and SDK failures preserve the other destination and do not request failed target tokens',async()=>{
  for(const failure of ['FB_IMPORT','FC_IMPORT','FB_GETTER','FC_GETTER','FB_SDK']) {
    const h=harness({failure}), faUser=h.auths.FA.currentUser;
    const unavailable=failure.startsWith('FB')?'FB':'FC', available=unavailable==='FB'?'FC':'FB';
    const result=await h.instance.connect();
    assert.equal(result.status,'partial',failure);
    assert.equal(result.targets[unavailable].code,'TARGET_AUTH_UNAVAILABLE',failure);
    assert.equal(result.targets[available].status,'ready',failure);
    assert.deepEqual(h.calls.requested,[[available]],failure);
    assert.deepEqual(h.calls.signIn,[available],failure);
    assert.equal(h.auths.FA.currentUser,faUser,failure);
    assert.equal(JSON.stringify(result).includes('private'),false,failure);h.instance.dispose();
  }
});

test('two unavailable targets fail closed without token retrieval or HTTP',async()=>{
  const h=harness({bothMissing:true});
  h.auths.FA.currentUser.getIdToken=async()=>{throw Error('must not request FA token');};
  const result=await h.instance.connect();
  assert.equal(result.status,'blocked');assert.equal(result.targets.FB.code,'TARGET_AUTH_UNAVAILABLE');
  assert.equal(result.targets.FC.code,'TARGET_AUTH_UNAVAILABLE');assert.equal(h.calls.fetch,0);
  assert.equal(h.calls.budgets.length,0);h.instance.dispose();
});
