import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('inactive folders and global area remain browsable, direct links stay inactive until refreshed',{timeout:45000},async()=>{
 const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),optimizeDeps:{noDiscovery:true,entries:[]},define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FB'})},server:{host:'127.0.0.1',port:0}});
 server.middlewares.use('/inactive-fixture',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><div id="root"></div>');});
 await server.listen();let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.CI?{}:{channel:'msedge'})});
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.goto('http://127.0.0.1:'+server.httpServer.address().port+'/inactive-fixture');
  await page.evaluate(async()=>{
   const {mountHtmlTrainings}=await import('/src/html-training.js');
   const t={id:'visible',title:'Authorized training',category:'ROPs',folderPath:['ROPs','Recovery','Adults'],status:'PUBLISHED',version:1};
   let cleanup,access={version:1,disabled:[JSON.stringify(['ROPs'])]},areaInactive=false;
   window.calls=[];
   window.mountInactive=(global=false,direct=false,enabled=false,restricted=false)=>{
    cleanup?.();window.calls=[];areaInactive=global;
    access={version:access.version+1,disabled:enabled||global?[]:[JSON.stringify(['ROPs'])]};
    cleanup=mountHtmlTrainings(document.querySelector('#root'),{user:{uid:'participant'},initialTrainingId:direct?'visible':'',api:async(action,input)=>{
     window.calls.push(action);
     if(action==='LIST')return {trainings:enabled&&!global?[t]:[],inactiveTrainings:enabled&&!global?[]:[{id:t.id,title:t.title,folderPath:t.folderPath}],folderAccess:access,areaInactive,restrictedNavigationAllowed:restricted};
     if(action==='OPEN')return {training:t,state:{uid:'participant',attempts:[{}]},questions:[]};
     if(action==='CONTENT')return {sections:[{id:'text',html:'<p>Content enabled</p>'}]};
     throw new Error('Unexpected interaction '+action);
    }});
   };
   window.mountInactive();
  });
  await page.getByRole('button',{name:'Documentos administrativos',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Acesso restrito',exact:true}).count(),0);
  await page.evaluate(()=>window.mountInactive(true,false,false,true));
  await page.getByRole('button',{name:'Documentos administrativos',exact:true}).click();
  await page.getByRole('button',{name:'Acesso restrito',exact:true}).click();
  assert.equal(await page.locator('.ht-head h2').textContent(),'Acesso restrito');
  await page.evaluate(()=>window.mountInactive());
  const root=page.getByRole('button',{name:'ROPs',exact:true});
  await root.waitFor();assert.equal(await root.isEnabled(),true);
  await root.click();await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.getByRole('button',{name:'Adults',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Authorized training',exact:true}).isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.calls),['LIST']);
  for(const global of [false,true]){
   await page.evaluate(global=>window.mountInactive(global,true),global);
   await page.getByRole('button',{name:'Authorized training',exact:true}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Authorized training',exact:true}).isDisabled(),true);
   assert.match(await page.locator('#root').textContent(),/administrador/);
   assert.deepEqual(await page.evaluate(()=>window.calls),['LIST']);
  }
  await page.evaluate(()=>window.mountInactive(false,false,true));
  await page.getByRole('button',{name:'ROPs',exact:true}).click();
  await page.getByRole('button',{name:'Recovery',exact:true}).click();
  await page.getByRole('button',{name:'Adults',exact:true}).click();
  await page.getByRole('button',{name:'Authorized training',exact:true}).click();
  await page.locator('.ht-content-frame').waitFor();
  assert.equal(await page.evaluate(()=>window.calls.includes('CONTENT')),true);
 }finally{await browser?.close();await server.close();}
});
