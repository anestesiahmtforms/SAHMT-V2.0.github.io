import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';
const engine=process.env.SAHMT_BROWSER_ENGINE==='webkit'?webkit:chromium;
test('iPhone/Android command panel targets all or one user and confirms two devices independently',{timeout:120000},async()=>{
  await mkdir('.local-preview',{recursive:true});
  const users=['member','other'].map(uid=>({uid,displayName:uid==='member'?'Pessoa de teste':'Outra pessoa',email:uid+'@example.invalid',sigla:'AB',active:true,access:true}));
  const requests=new Map(),devices=new Map();let counter=0,browser;
  const plugin={name:'targeted-updates-preview',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const path=req.url?.split('?')[0];
    if(path==='/targeted-fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px system-ui;margin:12px}button,input{min-height:44px;padding:8px;margin:6px 0}button{cursor:pointer}label{display:grid}</style><label>Rascunho<input id="draft"></label><button id="open-command">CONTROLE DE ATUALIZAÇÕES</button><script type="module" src="/tests/app-updates-targeted.fixture.js"></script></html>');return;}
    if(path!=='/__targeted-updates')return next();
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body),key=uid=>input.target+':'+uid;
    let value={};
    if(input.action==='users')value=users;
    if(input.action==='read')value={request:requests.get(key(input.uid))||null,devices:[...devices.values()].filter(device=>device.uid===input.uid&&device.target===input.target)};
    if(input.action==='record')devices.set(key(input.value.uid)+':'+input.value.deviceId,input.value);
    if(input.action==='request')for(const uid of input.uids)requests.set(key(uid),{id:'test-request-12345678-'+(++counter),target:input.target,minimumRelease:input.minimumRelease});
    if(input.action==='cancel')requests.delete(key(input.uid));
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
  });}};
  const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),base:'/',cacheDir:'.local-preview/vite-targeted-updates',optimizeDeps:{noDiscovery:true,entries:[]},plugins:[plugin],server:{host:'127.0.0.1',port:0,strictPort:false}});
  try {
    await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
    browser=await engine.launch({headless:true});
    for(const target of ['FA','FB']) {
      const contexts=[];const errors=[];
      try {
        const open=async(release,platform)=>{
          const context=await browser.newContext({viewport:{width:390,height:844},userAgent:platform==='Android'?'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',isMobile:true,hasTouch:true});contexts.push(context);
          const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
          await page.goto(origin+'/targeted-fixture?'+new URLSearchParams({target,release}));await page.waitForFunction(()=>window.targetedReady);return page;
        };
        const admin=await open(200,'Android');await admin.locator('#open-command').click();await admin.getByText('Pessoa de teste',{exact:true}).waitFor();
        await admin.locator('[data-panel-all]').click();await admin.locator('[data-all-send]:enabled').waitFor();
        assert.match(await admin.locator('[data-all-preview]').innerText(),/2 usuário/);
        await admin.locator('[data-all-send]').click();await admin.waitForFunction(()=>document.querySelector('[data-all-status]')?.textContent.includes('Exigência registrada para 2'));
        await admin.locator('[data-all-close]').click();
        assert.ok(requests.has(target+':member')&&requests.has(target+':other'));
        const old=await open(100,'Android');await old.locator('#draft').fill('Texto preservado');await old.evaluate(()=>{localStorage.setItem('auth-fixture','preserved');});
        await old.evaluate(()=>window.openSession('member'));await old.locator('.required-app-update[open]').waitFor();
        assert.equal(await old.locator('.required-app-update [data-update-later]').count(),0);
        assert.equal(await old.locator('#draft').inputValue(),'Texto preservado');
        await old.keyboard.press('Escape');assert.ok(await old.locator('.required-app-update').isVisible());
        await old.waitForFunction(()=>window.repairs.length===1);await old.reload();await old.waitForFunction(()=>window.targetedReady);await old.evaluate(()=>window.openSession('member'));await old.locator('.required-app-update[open]').waitFor();assert.equal(await old.evaluate(()=>window.repairs.length),0,'failed repair cannot auto-loop');
        // A fresh document carries the new embedded code release. Same installation ID.
        await old.goto(origin+'/targeted-fixture?'+new URLSearchParams({target,release:200}));await old.waitForFunction(()=>window.targetedReady);await old.evaluate(()=>window.openSession('member'));await old.waitForFunction(()=>window.savedDevice?.confirmedRequestId);
        await admin.locator('[data-panel-refresh]').click();await admin.getByText('Confirmado',{exact:true}).waitFor();
        assert.equal(await old.evaluate(()=>localStorage.getItem('auth-fixture')),'preserved');
        const iphone=await open(100,'iOS');await iphone.evaluate(()=>window.openSession('member'));await iphone.locator('.required-app-update[open]').waitFor();await iphone.waitForFunction(()=>window.savedDevice);
        await admin.locator('[data-panel-refresh]').click();await admin.getByText('Pendente',{exact:true}).waitFor();assert.equal(await admin.getByText('Confirmado',{exact:true}).count(),1);
        await admin.screenshot({path:'.local-preview/app-updates-targeted-'+engine.name()+'-'+target+'.png',fullPage:true});
        // Individual retry changes only this user's requirement; the other request is retained.
        const other=requests.get(target+':other').id;
        await admin.locator('[data-panel-user="member"]').click();await admin.locator('[data-request-update]:enabled').waitFor();await admin.locator('[data-request-update]').click();await admin.waitForFunction(()=>window.individualRequests===1);
        assert.equal(requests.get(target+':other').id,other);
        assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
      } finally {for(const context of contexts)await context.close();}
    }
  } finally {await browser?.close();await server.close();}
});
