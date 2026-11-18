import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mountGoogleProjectAuthPanel} from '../src/google-project-auth-ui.js';

const auth=readFileSync(new URL('../src/auth.js',import.meta.url),'utf8');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');

const start=auth.indexOf('export async function signInGoogle()'),end=auth.indexOf('export async function signOutGlobal()',start);
function fixture({enabled=true,fail=false,target='FA'}={}){
 const calls=[],user={uid:'fixture'},credential={idToken:'ephemeral-google-credential'},result={user};
 class Provider{setCustomParameters(){} static credentialFromResult(value){assert.equal(value,result);return credential;}}
 const ctx=vm.createContext({deployment:{target,faBase:'/FA/',fbBase:'/FB/'},googleProjectAuthEnabled:enabled,managementFaFirstLoginConfig:{enabled:false},
  loadAuthApi:async()=>({auth:{},GoogleAuthProvider:Provider,browserPopupRedirectResolver:{},signInWithPopup:async()=>{calls.push('popup');return result;}}),
  directRuntime:async()=>({assertCanStartPrimarySignIn(){},connectGoogleProjectsFromSignIn:async(c,u)=>{assert.equal(c,credential);assert.equal(u,user);calls.push('connect-existing');if(fail)throw Error('transient');return {targets:{FB:{status:'ready'}}};}}),
  rememberManagementReturn:()=>calls.push('remember-route'),consumeManagementReturn:()=>null,rememberModuleNavigation(){},location:{assign:u=>calls.push(u)}});
 vm.runInContext(auth.slice(start,end).replace('export async function','async function'),ctx);return {run:()=>ctx.signInGoogle(),calls,result};
}
test('one normal Google login reuses its credential for existing project accounts',async()=>{
 const f=fixture();assert.equal(await f.run(),f.result);assert.deepEqual(f.calls,['popup','connect-existing']);
});
test('a destination failure preserves the successful primary login',async()=>{
 const f=fixture({fail:true});assert.equal(await f.run(),f.result);assert.deepEqual(f.calls,['popup','connect-existing']);
});
test('disabled coordination keeps the ordinary primary login',async()=>{
 const f=fixture({enabled:false});await f.run();assert.deepEqual(f.calls,['popup']);
});
test('missing FB session uses explicit Synchronization recovery and retains its return path',async()=>{
 const f=fixture({target:'FB'});await f.run();assert.deepEqual(f.calls,['remember-route','/FA/#/offline']);
});

test('sessão FK pendente na Home só mostra a confirmação quando o painel é aberto',async()=>{
 const element=()=>({dataset:{},setAttribute(){},append(){},replaceChildren(){},addEventListener(){}});
 const document={createElement:element,body:{append(){}},addEventListener(){}};
 const user={uid:'fixture'},state={uid:user.uid,complete:false,busy:false,targets:{FA:{status:'ready'},FK:{status:'pending',code:'AUTH_RESTORE_TIMEOUT'}}};
 const controller={snapshot:()=>state,subscribe:fn=>{fn(state);return()=>{};}};
 let panelNode,renders=0;
 const ui={mountGoogleProjectAuthPanel:options=>mountGoogleProjectAuthPanel({...options,document:{
  ...document,body:{append(node){panelNode=node;}}
 },now:()=>Date.parse('2026-11-18T12:00:00Z')})};
 const modules={
  './google-project-auth-runtime.js':{googleProjectAuth:controller},
  './google-project-auth-ui.js':ui,
  './google-project-auth-google-button.js':{createGoogleProjectAuthGoogleButton:()=>({render:async()=>{renders++;}})}
 };
 const ctx=vm.createContext({googleProjectAuthEnabled:true,deployment:{target:'FA'},session:{status:'signed-in',user},currentRoute:()=> 'home',
  load:async(specifier)=>modules[specifier]});
 const start=main.indexOf('let googleAccessPanel;'),end=main.indexOf('const deniedOperationalModules',start);
 vm.runInContext(main.slice(start,end).replaceAll('import(','load('),ctx);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(panelNode.hidden,true);
 assert.equal(renders,0);
 vm.runInContext('googleAccessPanel.open()',ctx);
 assert.equal(panelNode.hidden,false);
 assert.equal(renders,1);
});
