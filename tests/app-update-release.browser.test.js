import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const root='/SAHMT-V2.0.github.io/';
const safari=process.env.SAHMT_BROWSER_ENGINE==='webkit';
const engine=safari?webkit:chromium;
const launch={headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})};

test('accepted update replaces HTTP-cached old HTML and styles in both installed apps',{timeout:120000},async()=>{
 let release=1,browser;
 const source=await readFile('public/service-worker.js','utf8');
 const repair=await readFile('public/tools/refresh-app.html','utf8');
 const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  const base=path.startsWith(root+'gestao/')?root+'gestao/':root;
  res.setHeader('Cache-Control','max-age=600');
  if(path===root+'tools/refresh-app.html'||path===root+'gestao/tools/refresh-app.html'){
   res.setHeader('Content-Type','text/html');res.end(repair);
  }else if(path===base+'service-worker.js'){
   let worker=source.replace(/const CACHE = '[^']+';/,`const CACHE = 'sahmt-v2-shell-v${release}';`);
   if(base!==root)worker=worker.replaceAll(root,base).replaceAll('sahmt-v2-','sahmt-fb-v2-');
   res.setHeader('Content-Type','text/javascript');res.setHeader('Cache-Control','no-store');res.end(worker);
  }else if(path===base+'assets-manifest.json'){
   res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({'index.html':{isEntry:true,src:'index.html',file:`assets/release-${release}.js`,css:[`assets/release-${release}.css`]},release}));
  }else if(path.endsWith('.css')){
   const version=path.includes('release-2.css')?2:1;
   res.setHeader('Content-Type','text/css');
   res.end(`body{margin:0;background:#10334d}dialog{box-sizing:border-box;position:fixed;inset:5vh 5vw;margin:auto;width:90vw;height:${version===2?'fit-content':'90vh'};padding:16px}button{display:block;margin:12px;width:90%;height:44px}`);
  }else if(path.endsWith('.js')){
   res.setHeader('Content-Type','text/javascript');res.end('// immutable release asset');
  }else{
   res.setHeader('Content-Type','text/html');
   res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${base}assets/release-${release}.css"><body data-release="${release}"><dialog><h2>GESTÃO DE DOCUMENTOS</h2><button>Protocolos</button><button>Diretrizes</button><button>ROPs</button><button>Documentos administrativos</button><button>VOLTAR</button></dialog><script>document.querySelector('dialog').showModal()</script>`);
  }
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await engine.launch(launch);
  for(const target of ['FA','FB']){
   release=1;
   const context=await browser.newContext({viewport:{width:390,height:844},...(safari?{isMobile:true,hasTouch:true}:{})});
   try{
    const page=await context.newPage();await page.goto(origin+'/outside');
    // Prime the normal HTTP cache before installing either worker. Keep this
    // cache enabled: Playwright routing would hide the original failure.
    await page.evaluate(async root=>{
     for(const base of [root,root+'gestao/']){
      await fetch(base);await fetch(base+'assets-manifest.json');
      const registration=await navigator.serviceWorker.register(base+'service-worker.js',{scope:base,updateViaCache:'none'});
      const worker=registration.installing||registration.waiting||registration.active;
      await new Promise((resolve,reject)=>{
       const timer=setTimeout(()=>reject(Error('install timeout')),30000);
       const check=()=>{if(worker.state==='activated'){clearTimeout(timer);resolve();}else if(worker.state==='redundant'){clearTimeout(timer);reject(Error('install failed'));}};
       worker.addEventListener('statechange',check);check();
      });
     }
    },root);
    const base=target==='FB'?root+'gestao/':root;
    const draft=await context.newPage();await draft.goto(origin+base);
    await draft.evaluate(()=>{localStorage.setItem('update-regression','preserved');const input=document.createElement('textarea');input.id='draft';input.value='Texto em andamento';document.body.append(input);});
    await page.goto(origin+base);assert.equal(await page.locator('body').getAttribute('data-release'),'1');
    release=2;
    await page.goto(origin+base+'tools/refresh-app.html?'+new URLSearchParams({target,route:'#/management'}));
    await page.waitForURL(url=>url.pathname===base&&url.hash==='#/management',{timeout:70000});
    assert.equal(await page.locator('body').getAttribute('data-release'),'2','accepted update must load the new HTML');
    const installed=await page.evaluate(async()=>{
     const result=[];
     for(const name of ['sahmt-v2-shell-v2','sahmt-fb-v2-shell-v2']){
      const base=name.includes('-fb-')?'/SAHMT-V2.0.github.io/gestao/':'/SAHMT-V2.0.github.io/';
      const cache=await caches.open(name);result.push((await (await cache.match(base+'assets-manifest.json')).json()).release);
     }
     return result;
    });
    assert.deepEqual(installed,[2,2],'both workers install the current asset graph');
    assert.equal(await draft.locator('#draft').inputValue(),'Texto em andamento','other open pages retain their draft');
    assert.equal(await page.evaluate(()=>localStorage.getItem('update-regression')),'preserved');
    await context.setOffline(true);await page.reload();
    assert.equal(await page.locator('body').getAttribute('data-release'),'2','reopening the installed app cannot restore the old HTML');
    const banner=await page.locator('dialog').boundingBox();
    assert.ok(banner.height<844*.7&&Math.abs(banner.y+banner.height/2-422)<2,'installed CSS has the compact centered banner');
   }finally{await context.close();}
  }
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
