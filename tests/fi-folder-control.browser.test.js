import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createFiControlWorker} from '../worker-fi-control/worker.js';

test('the FI panel publishes independent parent and child settings through the Worker', async () => {
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:390,height:680}});
  const origin='https://anestesiahmtforms.github.io';
  const host='https://fi-local.test';
  const records=new Map();
  let actor={uid:'admin-fa',fiUid:'admin-fi',profile:{active:true,access:true,role:'administrador_app'}};
  const worker=createFiControlWorker({
   verifyActor:async()=>actor,
   buildServices:()=>assert.fail('unexpected service'),
   buildFolderPublisher:()=>({
    read:async station=>records.get(station)??null,
    write:async(station,value,version)=>{
     assert.equal(records.get(station)?.version??null,version);
     const next={value,version:String(Number(version)+1)};
     records.set(station,next);
     return next;
    }
   })
  });
  const env={FI_CONTROL_ENABLED:'true',FI_FOLDER_MANAGEMENT_ENABLED:'true'};
  await page.route(host+'/**',async route=>{
   const request=route.request();
   const pathname=new URL(request.url()).pathname;
   if(pathname==='/v1/control'){
    const response=await worker.fetch(new Request(request.url(),{method:'POST',
     headers:{Origin:origin,'Content-Type':'application/json'},body:request.postData()}),env);
    return route.fulfill({status:response.status,body:await response.text(),contentType:'application/json'});
   }
   if(pathname==='/runtime'){
    return route.fulfill({json:records.get('FA')?.value??{schemaVersion:1,revision:0,disabled:[]}});
   }
   if(pathname==='/src/operational-folder-runtime.js'){
    return route.fulfill({contentType:'text/javascript',body:`
     export const subscribeOperationalFolderPolicy = callback => {
      window.receivePolicy = callback;
      void fetch('/runtime').then(r=>r.json()).then(callback);
      return ()=>{};
     };
    `});
   }
   if(/^\/(src|server)\/[a-z-]+\.js$/.test(pathname)){
    const body=await readFile(new URL('..'+pathname,import.meta.url),'utf8');
    return route.fulfill({contentType:'text/javascript',body});
   }
   if(pathname==='/src/fi-control.css')return route.fulfill({contentType:'text/css',body:await readFile(new URL('../src/fi-control.css',import.meta.url),'utf8')});
   return route.fulfill({contentType:'text/html',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/fi-control.css"><style>*{box-sizing:border-box}body{margin:0;font:16px system-ui,sans-serif}</style><main class="fi-control-stage"><div id="fi"></div></main><script type="module">
    import {mountFiControl} from '/src/fi-control-ui.js';
    import {mountOperationalFolderAdmin} from '/src/operational-folder-admin.js';
    window.command=async(action,input)=>{
     const response=await fetch('/v1/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input})});
     const result=await response.json();
     if(!response.ok)throw Object.assign(new Error(result.code),{status:response.status});
     if(action==='folders.publish')window.receivePolicy(await fetch('/runtime').then(r=>r.json()));
     return result;
    };
    const dispose=mountFiControl(document.querySelector('#fi'),{request:window.command,profile:{permissions:{admin:true}},folderAdmin:mountOperationalFolderAdmin,onNavigate:route=>{window.destination=route;dispose();}});
   </script>`});
  });
  await page.goto(host);
  assert.equal(await page.getByRole('button',{name:'Voltar à Home'}).count(),0);
  const center=page.locator('.fi-control--center');
  const box=await center.boundingBox();
  assert.ok(box.height<500&&Math.abs(box.y+box.height/2-340)<2);
  assert.equal(await center.locator('.fi-control-center-footer button').innerText(),'Voltar');
  assert.equal(await center.locator('.fi-control-navigation [data-fi-nav="management-hub"]').count(),0);
  await page.locator('[data-fi-folder-open]').click();
  const dialog=page.getByRole('dialog',{name:'Controle de pastas'});
  await dialog.waitFor();
  const clickAndWait=async selector=>{
   await page.locator(selector).click();
   await page.getByText('Atualização confirmada pelos serviços.',{exact:true}).waitFor();
  };
  await clickAndWait('[data-operational-folder-initialize]');
  const filter=dialog.getByRole('searchbox',{name:'Buscar pasta'});
  await filter.fill('ferias');
  assert.equal(await dialog.getByRole('button',{name:'Desativar Férias da escala diária',exact:true}).count(),1);
  assert.equal(await dialog.getByRole('button',{name:'Desativar Etiquetas',exact:true}).count(),0);
  await filter.clear();
  await dialog.locator('[data-folder-group="operacao"] > summary').click();
  const scroller=dialog.locator('.fi-folder-scroll');
  const footer=dialog.getByRole('button',{name:'Voltar',exact:true});
  const footerTop=(await footer.boundingBox()).y;
  const scrollTop=await scroller.evaluate(element=>{element.scrollTop=element.scrollHeight;return element.scrollTop;});
  assert.ok(scrollTop>0);
  assert.equal((await footer.boundingBox()).y,footerTop);
  const child='operacao/escala/ferias',parent='operacao/escala',sibling='operacao/eventos';
  const toggle=id=>`[data-operational-folder="${id}"]`;
  await clickAndWait(toggle(parent));
  assert.equal(await dialog.getByText('Desativada pela pasta principal',{exact:true}).count(),1);
  assert.equal(await page.locator(toggle(child)).textContent(),'Desativar também');
  await clickAndWait(toggle(child));
  assert.equal(await page.locator(toggle(child)).textContent(),'Ativar');
  await clickAndWait(toggle(parent));
  for(const record of records.values())assert.deepEqual(record.value.disabled,[child]);
  assert.equal(records.size,10);
  assert.equal(await page.locator(toggle(sibling)).textContent(),'Desativar');
  actor={uid:'member',profile:{active:true,access:true}};
  const status=await page.evaluate(()=>window.command('folders.publish',{id:'operacao/escala/ferias',enabled:true,revision:4}).catch(error=>error.status));
  assert.equal(status,403);
  assert.deepEqual(records.get('FA').value.disabled,[child]);
  await footer.click();
  assert.equal(await page.evaluate(()=>window.destination),'management-hub');
  assert.equal(await page.locator('dialog[open]').count(),0);
  await page.reload();
  await page.locator('.fi-control-center-footer button').click();
  assert.equal(await page.evaluate(()=>window.destination),'management-hub');
 } finally {
  await browser.close();
 }
});
