import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

test('FB header keeps nonconfirmed sync status inside the card on phone widths',async()=>{
 const browser=await chromium.launch({headless:true,
  ...(process.env.SAHMT_TEST_BROWSER_PATH?{executablePath:process.env.SAHMT_TEST_BROWSER_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--no-zygote','--single-process']}:{}),
 });
 try{
  const page=await browser.newPage();
  const css=readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  for(const width of [360,390,440])for(const kind of ['management','training'])for(const status of ['VERIFICANDO CONEXÃO','OFFLINE — OPERANDO LOCALMENTE','SINCRONIZAÇÃO INDISPONÍVEL']){
   await page.setViewportSize({width,height:844});
   await page.setContent(`<style>${css}</style><div class="app-shell app-shell--${kind}"><header class="topbar"><div class="identity-card"><button class="brand"><span>SAHMT</span></button><div class="identity-card__user-row"><div class="identity-card__user">Francisco Albuquerque</div><div class="sync-pill"><button class="sync-status-button">${status}</button></div></div><h2 class="events-header-operational">GESTÃO</h2></div></header></div>`);
   const bounds=await page.evaluate(()=>{
    const button=document.querySelector('.sync-status-button'),card=document.querySelector('.identity-card');
    return {button:button.getBoundingClientRect().toJSON(),card:card.getBoundingClientRect().toJSON(),scroll:button.scrollWidth,client:button.clientWidth};
   });
   assert.ok(bounds.scroll<=bounds.client+1,`${kind}/${width}/${status}: text must wrap inside its button`);
   assert.ok(bounds.button.right<=bounds.card.right+1,`${kind}/${width}: status must remain within the header`);
  }
 }finally{await browser.close();}
});
