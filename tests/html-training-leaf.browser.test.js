import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createServer} from 'vite';
import {chromium,webkit} from 'playwright';

const safari=process.env.SAHMT_BROWSER_ENGINE==='webkit';
const sahmt=['Acionamento do anestesiologista na SRPA','Alergia ao látex','Cefaleia pós-raquianestesia','Diabetes e hiperglicemia perioperatória','Dor perioperatória','Hipertermia maligna','Intoxicação sistêmica por anestésicos locais (ISAL)','Náuseas e vômitos pós-operatórios (NVPO)','Política institucional de gestão perioperatória','Via aérea difícil'];
const institution=['Posicionamento, contenção e transposição cirúrgica','Checklist para Cirurgia Segura','Antibioticoprofilaxia cirúrgica','Normotermia perioperatória','Prevenção de TEV','Jejum pré-operatório','Transporte intra/inter-hospitalar','Eventos hemorrágicos perioperatórios / ROTEM'];
const guidelines=['Acionamento imediato do anestesista na SRPA','Checklist de anestesiologia','Cuidados pós-anestésicos','Preparo e transporte do arsenal anestésico extrabloco','Plano de desastre e múltiplas vítimas','Plano de abandono','Transporte de pacientes instáveis','Atendimento pré-anestésico','Alta do paciente da SRPA','Diretriz médica da anestesiologia','Cuidado anestésico com pacientes graves','Procedimentos invasivos complexos'];
const communication=['Identificação do paciente','Lista de abreviações perigosas','Conciliação de medicamentos como prioridade estratégica','Conciliação medicamentosa nas transições de atendimento: Serviços de assistência aguda (pacientes internados)','Conciliação medicamentosa nas transições de atendimento: Serviços de atendimento ambulatorial','Lista de verificação para cirurgia segura','Transferência de informações nas transições de atendimento'];
const groups=[['Protocolos','Protocolos do SAHMT',sahmt],['Protocolos','Protocolos da Instituição',institution],['Diretrizes','',guidelines],['ROPs','Comunicação',communication]];

test('all final folders fit the banner without scrolling or pagination and keep one-line labels',{timeout:120000},async()=>{
 const server=await createServer({configFile:false,appType:'custom',root:process.cwd(),base:'/',optimizeDeps:{noDiscovery:true,entries:[]},define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FB'})},server:{host:'127.0.0.1',port:0}});
 server.middlewares.use('/leaf-fixture',(req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><div class="app-shell app-shell--management"><main class="main-content"><section class="module-view panel module-view--management"><div class="management-menu-scroll"><div class="module-content"><dialog class="management-area-dialog"><header class="management-area-dialog__header">Gestão</header><div class="management-area-dialog__body"><section id="root" class="management-area-detail"></section></div><footer class="management-area-dialog__footer"><form method="dialog"><button class="secondary-button">VOLTAR</button></form></footer></dialog></div></div></section></main></div><script>document.querySelector("dialog").showModal()</script><script type="module" src="/tests/html-training-ui.fixture.js"></script></html>');});
 await server.listen();const browser=await (safari?webkit:chromium).launch({headless:true,...(process.env.CI||safari?{}:{channel:'msedge'})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},...(safari?{isMobile:true,hasTouch:true}:{})});
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/leaf-fixture`);
  await page.getByRole('button',{name:'Protocolos',exact:true}).waitFor();
  await mkdir('.local-preview',{recursive:true});
  for(const role of ['participant','admin'])for(const [category,subcategory,titles] of groups){
   await page.evaluate(({role,category,subcategory,titles})=>window.setCatalog(titles.map((title,i)=>({id:'leaf-'+i,title,category,subcategory})),role),{role,category,subcategory,titles});
   await page.getByRole('button',{name:category,exact:true}).click();
   if(subcategory)await page.getByRole('button',{name:subcategory,exact:true}).click();
   assert.equal(await page.locator('.ht-document-folder').count(),titles.length,'every document is present on the same screen');
   for(const [width,height] of [[390,844],[320,568],[667,375],[1366,900]]){
    await page.setViewportSize({width,height});
    await page.waitForFunction(()=>[...document.querySelectorAll('.ht-document-title')].every(label=>label.scrollWidth<=label.clientWidth+1),null,{timeout:5000});
    const layout=await page.evaluate(()=>{
     const body=document.querySelector('.management-area-dialog__body'),panel=document.querySelector('.management-document-banner'),footer=panel.querySelector('footer'),rect=panel.getBoundingClientRect();
     return {height:rect.height,center:rect.y+rect.height/2,scrolls:body.scrollHeight>body.clientHeight+1,labels:[...document.querySelectorAll('.ht-document-title')].map(el=>({nowrap:getComputedStyle(el).whiteSpace,overflow:el.scrollWidth>el.clientWidth+1})),cards:[...document.querySelectorAll('.ht-document-folder')].map(el=>({top:el.getBoundingClientRect().top,bottom:el.getBoundingClientRect().bottom})),footerTop:footer.getBoundingClientRect().top,footerBottom:footer.getBoundingClientRect().bottom};
    });
    assert.equal(layout.scrolls,false,`${role} ${category}/${subcategory} ${width}: body never scrolls`);
    assert.ok(layout.height<=height*.9+2&&Math.abs(layout.center-height/2)<2,'panel stays bounded and centered');
    assert.ok(layout.cards.every(card=>card.top>=0&&card.bottom<=layout.footerTop),'all folders remain above the back button');
    assert.ok(layout.footerBottom<=height,'back button remains on screen');
    assert.ok(layout.labels.every(label=>label.nowrap==='nowrap'&&!label.overflow),`${role} ${category}/${subcategory} labels fit a single line at ${width}`);
    assert.equal(await page.locator('[data-ht="document-page"]').count(),0);
    assert.equal(await page.getByRole('button',{name:/^(Anterior|Próxima)$/}).count(),0);
    if(width===390)await page.screenshot({path:`.local-preview/html-training-leaf-${role}-${category}-${subcategory||'lista'}.png`,scale:'css'});
   }
   await page.setViewportSize({width:390,height:844});
   await page.getByRole('button',{name:titles[0],exact:true}).click();
   await page.frameLocator('.ht-content-frame').getByText('Texto do treinamento.').waitFor();
   assert.equal(await page.locator('.ht-head h2').textContent(),titles[0],'opening retains the complete official title');
  }
 }finally{await browser.close();await server.close();}
});
