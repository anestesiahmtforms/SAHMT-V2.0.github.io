import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

// Exercise the production event wiring in a real browser, with synthetic
// sessions/reports. This test never contacts Firebase or a user's browser.
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const wiring=main.slice(main.indexOf('const connectionRecovery=createConnectionLifecycle('),main.indexOf('function refreshLivePending()'))
 .replace("await import('./google-project-auth-runtime.js')",'fixtureRuntime');
const harness=`
import {createConnectionLifecycle} from '/src/connection-lifecycle.js';
import {operationalBackend} from '/src/operational-backend.js';
const session={status:'signed-in',user:{uid:'synthetic-user'},offline:false};
let onlineValidationRequired=false,forced=false,suspendedReportScopes=[];
const calls=[],reports=new Map(['events','labels','checklist'].map(kind=>[kind,{kind,key:kind,uid:session.user.uid,warm:false}]));
const reportStates=new Map(),startupReports={clear(){}},fixtureRuntime={maintainGoogleProjectSessions:async()=>({status:'ready'})};
const isOfflineRuntimeForced=()=>forced,setOfflineRuntimeMode=value=>forced=value;
const cleanupCurrentModule={suspend(){calls.push('suspend');},resume(){calls.push('resume');}};
const revalidateOnlineSession=async()=>{session.offline=false;forced=false;};
const liveReports={get:kind=>reports.has(kind)?{snapshot:()=>({scope:reports.get(kind),state:'server'})}:null,
 setOnline(){},close:kind=>reports.delete(kind),open:(kind,scope)=>{reports.set(kind,scope);calls.push((scope.localOnly?'local:':'server:')+kind);},refresh(){}};
const closeReportLive=kind=>reports.delete(kind),reportScopeCurrent=scope=>scope.uid===session.user.uid;
function syncOutbox(){}function updateOutboxStatus(){}function updateReportSync(){}function invalidateChecklistSignature(){}
const currentRoute=()=> 'checklist',shouldRenderHashChange=()=>false;function render(){}
${wiring}
const pageId=crypto.randomUUID(),shows=[];
window.addEventListener('pageshow',event=>shows.push(event.persisted));
window.connectionFixture={snapshot:()=>({pageId,shows,calls,reports:[...reports.keys()],serverReports:[...reports.values()].filter(scope=>scope.localOnly===false).length,suspended:suspendedReportScopes.length,busy:connectionRecovery.snapshot().busy})};
document.querySelector('#ready').textContent='FA pronta';
`;

test('FA → FB → browser Back repeatedly resumes suspended reports without restarting',{timeout:60000},async()=>{
 const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','public, max-age=60');
  if(path==='/fa'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><p id="ready"></p><a href="/fb">Abrir FB</a><script type="module" src="/harness.js"></script>');}
  else if(path==='/fb'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><p>FB pronta</p>');}
  else if(path==='/harness.js'){res.setHeader('Content-Type','text/javascript');res.end(harness);}
  else if(['/src/async-deadline.js','/src/connection-lifecycle.js','/src/firebase-failure.js','/src/operational-backend.js','/src/deployment-context.js'].includes(path)){
   res.setHeader('Content-Type','text/javascript');res.end(readFileSync(new URL('..'+path,import.meta.url)));
  }else{res.statusCode=404;res.end();}
 });
 let browser;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'msedge',headless:true,ignoreDefaultArgs:['--disable-back-forward-cache']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/fa');await page.waitForSelector('#ready:text("FA pronta")');
  const id=await page.evaluate(()=>window.connectionFixture.snapshot().pageId);
  for(let cycle=1;cycle<=4;cycle++){
   await page.getByText('Abrir FB').click();await page.waitForURL('**/fb');await page.goBack({waitUntil:'commit'});
   await page.waitForFunction(()=>window.connectionFixture?.snapshot().serverReports===3&&!window.connectionFixture.snapshot().busy);
   const state=await page.evaluate(()=>window.connectionFixture.snapshot());
   assert.equal(state.pageId,id,'FA must resume its cached document, not restart');
   assert.equal(state.shows.at(-1),true);assert.equal(state.suspended,0);
   assert.equal(state.calls.filter(value=>value==='suspend').length,cycle);
   for(const kind of ['events','labels','checklist']){
    assert.equal(state.calls.filter(value=>value==='server:'+kind).length,cycle,'one confirmed server subscription per return');
    const firstLocal=state.calls.indexOf('local:'+kind),firstServer=state.calls.indexOf('server:'+kind);
    assert.ok(firstLocal>=0&&firstLocal<firstServer,'local content must be available before server confirmation');
   }
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
