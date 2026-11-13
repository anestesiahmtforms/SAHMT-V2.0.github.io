import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

const engine=process.env.SAHMT_BROWSER_ENGINE==='webkit'?webkit:chromium;
const base='/SAHMT-V2.0.github.io/';

test('legacy FB update entry reads FA receipts and returns to the FI Central',{timeout:60000},async()=>{
 const [main,router,prefix]=await Promise.all(['src/main.js','src/router.js','tests/app-updates-control.fixture.js'].map(path=>readFile(path,'utf8')));
 const render=main.slice(main.indexOf('async function render() {'),main.indexOf('function renderOnlineGate()'));
 const click=main.slice(main.lastIndexOf("document.addEventListener('click',async event=>{"),main.indexOf('const targetedAppUpdates='));
 const runtime=prefix+'\n'+router.replace(/^import .*;\r?\n/gm,'').replaceAll('export ','')+'\n'+render+'\n'+click+
  "\nwindow.addEventListener('hashchange',()=>render());await render();window.controlFixture.ready=true;";
 const reads=[],requests=[],errors=[];
 const people=[
  ['member','Álvaro FA','z-fixture','EFETIVO'], ['other','Beatriz FA','a-fixture','EFETIVO'],
  ['r1','Residente A','r1','RESIDENTE_1'], ['r2','Residente B','r2','RESIDENTE_2'],
  ['r3','Residente C','r3','RESIDENTE_3'], ['sub','Substituta','sub','SUBSTITUTO'],
  ['uncategorized','Conta administrativa','admin','ADMINISTRADOR'],
  ...Array.from({length:18},(_,i)=>['staff-'+i,'Pessoa '+i,'staff-'+i,'EFETIVO']),
 ].reverse();
 const users=people.map(([uid,displayName,email])=>({uid,displayName,email:email+'@example.invalid',active:true,access:true}));
 const assignments=people.map(([uid,,email,category])=>({schemaVersion:1,identityStatus:'LINKED',uid,email:email+'@example.invalid',memberCategories:[category]}));
 const plugin={name:'control-route-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{
  const path=req.url?.split('?')[0];
  if(path===base||path===base+'gestao/'){
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/app-updates-targeted.css?direct"><div id="app"></div><script type="module" src="/__control-runtime.js"></script></html>');return;
  }
  if(path==='/__control-runtime.js'){
   const source=runtime.replaceAll("import('./management-entry-session.js')",'fixtureManagementSession()')
    .replaceAll("await import('./app-updates-targeted-admin.js')",'await fixturePanel()')
    .replaceAll("import('./fi-control-","import('/src/fi-control-").replaceAll("import('./fi-control.css')","import('/src/fi-control.css')").replaceAll('import.meta.env.BASE_URL',"'/'");
   res.setHeader('Content-Type','text/javascript');res.end(source);return;
  }
  if(path!=='/__control-updates')return next();
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);let value={};
  if(input.action==='users'){reads.push(input);value=users;}
  if(input.action==='categories'){reads.push(input);value=assignments;}
  if(input.action==='read'){reads.push(input);value={request:null,devices:input.target==='FA'&&input.uid==='member'?[
   {uid:'member',deviceId:'00000001-0000-4000-8000-000000000001',target:'FA',platform:'Android',displayMode:'standalone',appVersion:'V2.2',loadedRelease:200,confirmedRequestId:'',lastSeenAt:Date.parse('2026-11-13T12:30:00Z')},
   {uid:'member',deviceId:'00000002-0000-4000-8000-000000000002',target:'FA',platform:'iOS',displayMode:'browser',appVersion:'V2.1',loadedRelease:190,confirmedRequestId:'',lastSeenAt:Date.parse('2026-11-12T15:00:00Z')},
  ]:[]};}
  if(input.action==='request')requests.push(input);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
 });}};
 const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),base:'/',cacheDir:'.local-preview/vite-control-route',optimizeDeps:{noDiscovery:true,entries:[]},plugins:[plugin],server:{host:'127.0.0.1',port:0,strictPort:false}});
 let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await engine.launch({headless:true,...(process.env.CI||process.env.SAHMT_BROWSER_ENGINE==='webkit'?{}:{channel:'msedge'})});const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+base+'gestao/#/management');await page.waitForFunction(()=>window.controlFixture?.ready);
  assert.deepEqual(await page.evaluate(()=>({target:window.controlFixture.target,cutover:window.controlFixture.cutover})),{target:'FB',cutover:true});
  await page.locator('[data-app-update-panel]').click();await page.waitForURL(origin+base+'#/app-updates-control');
  await page.getByText('Atualizado',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.controlFixture.target),'FA');
  assert.match(await page.locator('[data-panel-list]').innerText(),/Android.*App instalado/s);
  const list=page.locator('[data-panel-list]'), modal=page.locator('.app-updates-command');
  assert.deepEqual(await list.getByRole('heading').allTextContents(),['Efetivos','Residentes R1','Residentes R2','Residentes R3','Substitutos','Sem grupo funcional']);
  assert.equal(await list.locator('[data-update-user]').count(),25);
  assert.deepEqual((await list.locator('[data-update-group]').first().locator('article > strong').allTextContents()).slice(0,2),['Álvaro FA','Beatriz FA']);
  assert.equal(await modal.getByRole('button',{name:/anteriores|próximos/i}).count(),0);
  const lastAccess=modal.locator('[data-user-devices="member"] > p').first();
  assert.match(await lastAccess.innerText(),/Último acesso:.*13.11.2026.*09:30/);
  const footer=modal.getByRole('button',{name:'VOLTAR',exact:true});
  const beforeScroll=await footer.boundingBox();
  const scrolled=await list.evaluate(node=>{node.scrollTop=node.scrollHeight;return node.scrollTop;});
  assert.ok(scrolled>0);
  assert.deepEqual(await footer.boundingBox(),beforeScroll);
  await modal.getByRole('searchbox').fill('alvaro');
  assert.deepEqual(await list.getByRole('heading').allTextContents(),['Efetivos']);
  assert.equal(await list.locator('[data-update-user]:visible').count(),1);
  await modal.getByRole('searchbox').clear();
  assert.ok(reads.length>0);assert.ok(reads.every(read=>read.target==='FA'),'principal app receipts must never query FB');
  await page.locator('[data-panel-user="member"]').click();await page.locator('[data-request-update]:enabled').waitFor();
  const saved=page.waitForResponse(response=>response.url().endsWith('/__control-updates')&&response.request().postDataJSON()?.action==='request');
  await page.locator('[data-request-update]').click();await saved;await page.getByText('Consulta confirmada no servidor.',{exact:true}).waitFor();
  assert.equal(requests.length,1);assert.equal(requests[0].target,'FA');assert.deepEqual(requests[0].uids,['member']);
  await page.locator('[data-close-updates]').click();await page.locator('[data-panel-close]').click();
  await page.waitForURL(origin+base+'#/fi-control');assert.equal(await page.locator('.app-updates-command').count(),0);
  const before=reads.length;await page.evaluate(()=>sessionStorage.setItem('control-fixture-role','anestesiologista'));
  await page.goto(origin+base+'?fixture=denied#/app-updates-control');await page.waitForURL(origin+base+'?fixture=denied#/home');
  assert.equal(await page.locator('.app-updates-command').count(),0);assert.equal(reads.length,before);
  assert.deepEqual(errors,[]);await context.close();
 }finally{await browser?.close();await server.close();}
});
