import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from 'playwright';

test('automatic FC restoration opens its module while FB remains unavailable',{timeout:60000},async()=>{
 const server=await createServer({configFile:false,server:{host:'127.0.0.1',port:0},plugins:[{
  name:'isolated-module-entry',configureServer(server){server.middlewares.use((req,res,next)=>{
   if(req.url!=='/session-entry')return next();res.setHeader('Content-Type','text/html');
   res.end('<!doctype html><meta charset="utf-8"><main id="module">Carregando módulo…</main>');
  });}
 }]});
 let browser;
 try{
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':undefined,headless:true});
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/session-entry');
  await page.evaluate(async()=>{
   const [{createGoogleProjectAuth},{waitForGoogleProjectSession},{waitForFcModuleSession}]=await Promise.all([
    import('/src/google-project-auth-core.js'),import('/src/google-project-session.js'),import('/src/fc-module-session.js')]);
   const user={uid:'isolated-session',providerData:[{providerId:'google.com',uid:'isolated-google'}]};
   let release;const restoringFc=new Promise(resolve=>release=resolve),auth={currentUser:null,authStateReady:async()=>{}};
   const controller=createGoogleProjectAuth({getPrimaryUser:()=>user,
    restoreTarget:target=>target==='FB'?new Promise(()=>{}):target==='FC'?restoringFc:Promise.resolve(user),signOutTarget:async()=>{}});
   void controller.restore();
   const host=document.querySelector('#module');let current=true,popups=0;
   const entering=waitForFcModuleSession(host,{auth,sourceUid:user.uid,title:'Registros',isCurrent:()=>current,
    restoreSession:()=>waitForGoogleProjectSession({auth,getSourceUser:()=>user,controller,target:'FC',isCurrent:()=>current}),
    authApi:{GoogleAuthProvider:class{},signOut:async()=>{},signInWithPopup:async()=>{popups++;throw Error('UNEXPECTED_POPUP');},onAuthStateChanged:()=>()=>{}}
   }).then(result=>{if(result)host.innerHTML='<label>Módulo aberto<textarea id="draft"></textarea></label>';return Boolean(result);});
   window.fixture={finish:()=>{auth.currentUser=user;release(user);return entering;},state:()=>controller.snapshot(),popups:()=>popups,
    cancel:()=>{current=false;}};
  });
  assert.equal(await page.locator('#module').textContent(),'Carregando módulo…');
  assert.equal(await page.evaluate(()=>window.fixture.finish()),true);
  await page.locator('#draft').fill('Rascunho mantido');
  const state=await page.evaluate(()=>window.fixture.state());
  assert.equal(state.busy,true);assert.equal(state.targets.FB.status,'restoring');assert.equal(state.targets.FC.status,'ready');
  assert.equal(state.targets.FD.status,'ready');assert.equal(state.targets.FE.status,'ready');
  assert.equal(await page.evaluate(()=>window.fixture.popups()),0);
  assert.equal(await page.locator('[data-fc-module-login]').count(),0);
  assert.equal(await page.locator('#draft').inputValue(),'Rascunho mantido');assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
