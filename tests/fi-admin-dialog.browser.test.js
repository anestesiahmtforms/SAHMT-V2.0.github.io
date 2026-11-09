import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {renderFiAdminDialog} from '../src/fi-admin-dialog.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const action = main.slice(main.indexOf('function actionForm('), main.indexOf('function shellView()'));
const shell = main.slice(main.indexOf('function shellView()'), main.indexOf('async function loadHome()'));
const content = Array.from({length: 70}, (_, index) => `<article class="user-profile-row"><strong>Pessoa de conferência ${index + 1}</strong><p>Cadastro administrativo para conferir a rolagem.</p><button type="button" class="secondary-button">Editar</button></article>`).join('');

function fixture(route) {
  const markup = route === 'updates' ? '<main></main>' : vm.runInNewContext(
    (action + shell + '\nshellView();').replaceAll('import.meta.env.BASE_URL', "'/'"), {
      currentRoute: () => route, session: {status:'signed-in',user:{displayName:'Conferência de layout'},profile:{}},
      labels: {people:['Pessoas'],admin:['Administração']}, notice:'', can:() => true, renderFiAdminDialog
    });
  return `<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css?direct"><link rel="stylesheet" href="/src/app-updates-targeted.css?direct"><div id="app">${markup}</div><script type="module">
    import {mountFiAdminDialog} from '/src/fi-admin-dialog.js';
    import {openAppUpdatePanel} from '/src/app-updates-targeted-admin.js';
    let dispose=()=>{};const onExit=()=>{dispose();location.hash='#/fi-control';};
    const dialog=document.querySelector('[data-fi-admin-dialog]');
    if(dialog){document.querySelector('#module-content').innerHTML=${JSON.stringify(content)};dispose=mountFiAdminDialog(dialog,{onExit});}
    else dispose=await openAppUpdatePanel({actorUid:'fixture-admin',target:'FA',isCurrent:()=>true,onExit,readRelease:async()=>1,services:{
      listAppUpdateUsers:async()=>Array.from({length:30},(_,index)=>({uid:'user-'+index,displayName:'Pessoa de conferência '+(index+1),email:'fixture@example.invalid'})),
      readUserAppUpdates:async()=>({request:null,devices:[]})
    }});
    window.fixtureReady=true;
  </script></html>`;
}

test('the three FI panels scroll internally while the Back footer stays visible on desktop and phones', {timeout:60000}, async () => {
  const server = await createServer({configFile:false, appType:'custom', base:'/', cacheDir:'.local-preview/vite-fi-admin-dialog',
    optimizeDeps:{noDiscovery:true,entries:[]}, plugins:[{name:'fi-dialog-preview',configureServer(server){
      server.middlewares.use((req,res,next)=>{const url=new URL(req.url,'http://localhost');if(url.pathname!=='/fi-dialog-fixture')return next();
        res.setHeader('Content-Type','text/html');res.end(fixture(url.searchParams.get('route')));
      });
    }}], server:{host:'127.0.0.1',port:0}});
  let browser;
  try {
    await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
    browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:667,height:375}]) {
      await page.setViewportSize(viewport);
      for(const route of ['people','admin','updates']) {
        await page.goto(origin+'/fi-dialog-fixture?route='+route);await page.waitForFunction(()=>window.fixtureReady);
        const dialog=page.locator('.fi-admin-dialog[open]'),body=dialog.locator('.fi-admin-dialog__body'),back=dialog.locator('footer button');
        assert.equal(await dialog.count(),1);
        const before=await back.boundingBox();assert.ok(before.y>=0&&before.y+before.height<=viewport.height);
        await body.evaluate(node=>node.scrollTop=node.scrollHeight);
        await page.waitForFunction(()=>document.querySelector('.fi-admin-dialog__body').scrollTop>100);
        const after=await back.boundingBox();assert.ok(Math.abs(after.y-before.y)<1,'footer must not move with content');
        assert.equal(await page.evaluate(()=>document.scrollingElement.scrollTop),0);
        assert.equal(await dialog.evaluate(node=>node.scrollTop),0);
        assert.ok(await body.evaluate(node=>node.scrollWidth<=node.clientWidth+1),'no horizontal overflow');
        if(process.env.SAHMT_MODAL_SCREENSHOT_DIR&&viewport.width===390) {
          await mkdir(process.env.SAHMT_MODAL_SCREENSHOT_DIR,{recursive:true});
          await page.screenshot({path:join(process.env.SAHMT_MODAL_SCREENSHOT_DIR,'modal-'+route+'.jpg'),type:'jpeg'});
        }
        await back.click();await page.waitForFunction(()=>location.hash==='#/fi-control');assert.equal(await page.locator('.fi-admin-dialog[open]').count(),0);
        if(route!=='updates') {
          await page.goto(origin+'/fi-dialog-fixture?route='+route);await page.waitForFunction(()=>window.fixtureReady);
          await page.keyboard.press('Escape');await page.waitForFunction(()=>location.hash==='#/fi-control');
        }
      }
    }
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await server.close();}
});
