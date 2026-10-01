import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import {createRequire} from 'node:module';

// Local rendering only: no Firebase, authentication, service worker or remote writes.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.env.MOBILE_LAYOUT_OUTPUT || path.join(root, '.local-preview', 'mobile-layout'));
// Install Playwright in the environment, or point to the bundled runtime module.
const playwrightModule = process.env.PLAYWRIGHT_MODULE_PATH || path.join(root, 'package.json');
fs.mkdirSync(output, {recursive: true});
const requireRuntime = createRequire(playwrightModule);
const {chromium} = requireRuntime('playwright');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8').replace(/\r\n/g, '\n');
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const cut = (from, to) => main.slice(main.indexOf(from), main.indexOf(to)).replaceAll('import.meta.env.BASE_URL', "'/'");
const renderCode = [
  cut('const labels = {', 'const userRoles = ['),
  cut('function escapeHtml(', 'function loadReportPdfModule('),
  cut('function moduleCards(', 'function vacationRankMarkup('),
  cut('function vacationRankMarkup(', 'function actionForm('),
  cut('function actionForm(', 'function shellView('),
  cut('function shellView(', 'async function loadHome(')
].join('\n');
const checklistDisplay = await import('../src/checklist-display.js');
const extractExpression = (start, end) => {
  const from=main.indexOf(start);
  assert.ok(from>=0, 'Native Checklist markup must exist');
  const to=main.indexOf(end,from);
  assert.ok(to>from, 'Native Checklist markup must end');
  return main.slice(from+start.length,to);
};
const cardStart=main.indexOf('return '+String.fromCharCode(96)+'<article class="checklist-station checklist-station-');
const cardEnd=main.indexOf(";\n    }).join('');",cardStart);
assert.ok(cardStart>=0&&cardEnd>cardStart,'Native Arsenal card must exist');
const cardExpression=main.slice(cardStart+7,cardEnd);
const signatureExpression=extractExpression('const signatureMarkup = ', ';\n    content.innerHTML');
function checklistContent(ctx) {
  Object.assign(ctx,checklistDisplay,{recordedAt:'',note:'',pending:'',action:'',signatureUnavailableReason:''});
  const stations=Array.from({length:28},(_,index)=>({id:'100170'+String(index===27?30:index+1).padStart(3,'0'),name:'Arsenal 100170'+String(index===27?30:index+1).padStart(3,'0'),active:index<23}));
  const ordered=checklistDisplay.sortChecklistStationsForDisplay(stations,()=>null).sort((a,b)=>Number(b.active)-Number(a.active));
  const cards=ordered.map(station=>{Object.assign(ctx,{station,stationStateClass:station.active?'complete':'inactive'});return vm.runInContext(cardExpression,ctx);}).join('');
  return '<div class="checklist-daily-layout"><div class="checklist-daily-notices"></div><section class="checklist-station-grid" aria-label="Estações do Checklist">'+cards+'</section>'+vm.runInContext(signatureExpression,ctx)+'</div>';
}
const profiles = {
  admin: {role: 'administrador_app', displayName: 'Administrador de Teste', sigla: 'TA', permissions: {admin: true}},
  comum: {role: 'anestesiologista', displayName: 'Profissional de Teste', sigla: 'TA', permissions: {scheduleRead: true, eventsRead: true, eventsWrite: true, labelsRead: true, labelsWrite: true, checklistRead: true, checklistWrite: true, checklistSign: true, managementRead: true, trainingsRead: true, notificationsRead: true}}
};
function fixture(route, kind) {
  const ctx = vm.createContext({
    session: {status: 'signed-in', profile: profiles[kind], user: {uid: `fixture-${kind}`, displayName: profiles[kind].displayName}},
    currentRoute: () => route, selectedManagementAreaId: '', appFeatures: {},
    featureEnabledForRoute: () => true, todayInputValue: () => '2026-09-30',
    labelManualConfirmation: {uid: '', status: ''}, labelAiEnabled: false, notice: '', eventReportMode: 'daily', eventReportOpen: false,
    labelReportMode: 'daily', labelReportOpen: false, checklistReportMode: 'daily',
  });
  vm.runInContext(renderCode, ctx);
  const reportFixture=route==='checklist'?checklistContent(ctx):'';
  const siglas = Array.from({length: 17}, (_, i) => `T${String.fromCharCode(65 + i)}`);
  const grid = ctx.renderSchedulePositionGrid({
    vacationPositions: {TA: 1, TB: 2},
    positions: siglas.map((sigla, index) => ({
      sigla: index === 0 ? 'TA/TB' : index === 16 ? 'DC' : sigla, siglas: index === 0 ? ['TA', 'TB'] : index === 16 ? ['TN', 'TP', 'TQ'] : [sigla],
      vacationParts: index < 2 ? (index === 0 ? ['TA', 'TB'] : ['TB']) : [],
      vacationPositions: {TA: 1, TB: 2}, contacts: [{sigla}], position: index + 1
    }))
  }, {mode: route === 'events' ? 'events' : 'home', schedule: {}, eventsWritable: true});
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>${css}</style></head><body><div id="app">${ctx.shellView()}</div><script>
    document.querySelector('#schedule-content')?.replaceChildren();
    const grid = ${JSON.stringify(grid)};
    const gridHost = document.querySelector('#schedule-content,#event-schedule-content');
    if(gridHost) gridHost.innerHTML = grid;
    if(document.querySelector('.app-shell--events')) document.querySelector('#module-content')?.remove();
    const sync = document.querySelector('#outbox-status');
    if(sync) sync.innerHTML = '<button class="sync-status-button sync-status-button--synced" type="button" aria-label="Sincronizado"><span class="sync-status-icon">✓</span></button>';
    document.querySelector('#schedule-date')?.setAttribute('value','2026-09-30');
    window.__checklistReportFixture=${JSON.stringify(reportFixture)};
    window.__fixtureClicks=[];
    document.querySelectorAll('.schedule-siglas-grid>button.sigla-item').forEach(button=>button.addEventListener('click',event=>window.__fixtureClicks.push({index:button.dataset.schedulePositionIndex,support:button.hasAttribute('data-event-support'),target:event.target.className})));
  </script></body></html>`;
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if(url.pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(fixture(url.searchParams.get('route') || 'home', url.searchParams.get('profile') || 'comum')); return; }
  const asset = path.resolve(root, 'public', '.' + decodeURIComponent(url.pathname));
  if(!asset.startsWith(path.join(root, 'public') + path.sep) || !fs.existsSync(asset)) { res.statusCode=404; res.end(); return; }
  res.setHeader('Content-Type', /\.svg$/.test(asset) ? 'image/svg+xml' : /\.png$/.test(asset) ? 'image/png' : 'image/jpeg');
  res.end(fs.readFileSync(asset));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless: true, ...(process.env.CHROME_EXECUTABLE_PATH ? {executablePath:process.env.CHROME_EXECUTABLE_PATH} : {})});
const results = [];
const checklistModals = [];
try {
  for (const viewport of [{width:320,height:568},{width:375,height:667},{width:390,height:844},{width:844,height:390},{width:568,height:320},{width:667,height:375},{width:768,height:1024}]) {
    const context = await browser.newContext({viewport, deviceScaleFactor:1, isMobile:true, hasTouch:true, serviceWorkers:'block'});
    const page = await context.newPage();
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    for (const profile of Object.keys(profiles)) for (const module of ['home','events','labels','checklist','management']) {
      await page.goto(`${origin}/?route=${module}&profile=${profile}`, {waitUntil:'load'});
      await page.locator('.module-title-chip').waitFor();
      await page.evaluate(async()=>{ await Promise.all([...document.images].map(img=>img.complete ? Promise.resolve() : new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;}))); });
      const measurement = await page.evaluate(() => {
        const rect = node => { const r=node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; };
        const title=document.querySelector('.module-title-chip'), card=document.querySelector('.identity-card'), image=document.querySelector('.checklist-visual img'), figure=document.querySelector('.checklist-visual'),frame=document.querySelector('.checklist-visual-frame');
        const visibleHeadings=[...document.querySelectorAll('h1,h2,h3')].filter(e=>e.getClientRects().length && !e.closest('dialog:not([open])'));
        const clippedByAncestor = (e,r=e.getBoundingClientRect()) => { for(let parent=e;parent;parent=parent.parentElement) {const p=parent.getBoundingClientRect(),s=getComputedStyle(parent);if(/hidden|clip/.test(s.overflowX)&&(r.left<p.left-1||r.right>p.right+1))return true;if(/hidden|clip/.test(s.overflowY)&&(r.top<p.top-1||r.bottom>p.bottom+1))return true;}return false; };
        const elements=[...document.querySelectorAll('.identity-card,.module-title-chip,.checklist-visual-frame,.checklist-visual,.checklist-visual img,.checklist-qr-launcher,.checklist-report-launchers,.checklist-home-button,.schedule-content,.events-home-button,.labels-home-button')].map(e=>({class:e.className,rect:rect(e),clipped:clippedByAncestor(e)}));
        const targets=[...document.querySelectorAll('.schedule-siglas-grid>button.sigla-item')];
        const targetRects=targets.map(rect);
        const hitChecks=targets.flatMap((button,index)=>{const r=button.getBoundingClientRect();return [[r.left+1,r.bottom-1],[r.left+r.width/2,r.top+r.height/2],[r.left+r.width/2,r.bottom-2]].map(([x,y])=>({index,x,y,hit:document.elementFromPoint(x,y)?.closest('button.sigla-item')?.dataset.schedulePositionIndex,expected:button.dataset.schedulePositionIndex}));});
        const targetOverlaps=targetRects.flatMap((a,i)=>targetRects.slice(i+1).filter(b=>a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1));
        const contents=[...document.querySelectorAll('.schedule-siglas-grid .sigla-index,.schedule-siglas-grid .sigla-token>strong,.schedule-siglas-grid .sigla-token__aliases,.schedule-siglas-grid .sigla-token__vacation-rank,.schedule-siglas-grid .sigla-token__vacation-number')].filter(e=>e.textContent.trim()).map(e=>{const range=document.createRange();range.selectNodeContents(e);const glyph=range.getBoundingClientRect();const r={x:glyph.x,y:glyph.y,right:glyph.right,bottom:glyph.bottom,width:glyph.width,height:glyph.height},owner=rect(e.closest('button.sigla-item'));return {text:e.textContent,rect:r,clipped:clippedByAncestor(e,r),outsideOwner:r.x<owner.x-1||r.right>owner.right+1||r.y<owner.y-1||r.bottom>owner.bottom+1};});
        const tokens=[...document.querySelectorAll(".schedule-siglas-grid .sigla-token")].map(rect); const tokenOverlaps=tokens.flatMap((a,i)=>tokens.slice(i+1).filter(b=>a.x<b.right-1&&a.right>b.x+1&&a.y<b.bottom-1&&a.bottom>b.y+1)); const controls=[...document.querySelectorAll('button,input,select,textarea')].filter(e=>e.getClientRects().length&&!e.closest('dialog:not([open])')&&!e.classList.contains('sr-only')).map(e=>({text:e.textContent.trim().slice(0,40)||e.getAttribute('aria-label')||e.name,rect:rect(e),clipped:clippedByAncestor(e),overflow:e.scrollWidth>e.clientWidth+1}));
        return {touch:{hitChecks,count:targets.length,minHeight:targets.length?Math.min(...targetRects.map(r=>r.height)):null,minWidth:targets.length?Math.min(...targetRects.map(r=>r.width)):null,overlaps:targetOverlaps.length,clipped:contents.filter(c=>c.clipped||c.outsideOwner),indices:document.querySelectorAll('.schedule-siglas-grid [data-schedule-position-index] .sigla-index').length,vacationRanks:[...document.querySelectorAll('.schedule-siglas-grid .sigla-token__vacation-rank')].map(e=>e.textContent)},viewport:{width:innerWidth,height:innerHeight},docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight,title:{text:title.textContent,font:getComputedStyle(title).fontSize,rect:rect(title),card:rect(card),count:visibleHeadings.filter(h=>h.textContent.trim()===title.textContent.trim()).length},image:image?{naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,rect:rect(image),figure:rect(figure),frame:frame?rect(frame):null,objectFit:getComputedStyle(image).objectFit}:null,elements,gridCells:[...document.querySelectorAll(".schedule-siglas-grid .sigla-item:first-child,.schedule-siglas-grid .sigla-item:first-child>*")].map(e=>({class:e.className,rect:rect(e),rows:getComputedStyle(e).gridTemplateRows,minH:getComputedStyle(e).minHeight,line:getComputedStyle(e).lineHeight,padding:getComputedStyle(e).padding})),tokenOverlaps:tokenOverlaps.length,clippedControls:controls.filter(c=>c.clipped||c.overflow),controlsOutside:controls.filter(c=>c.rect.x < -1 || c.rect.right > innerWidth+1 || c.rect.y < -1 || c.rect.bottom > innerHeight+1)};
      });
      const key=`${module}-${profile}-${viewport.width}x${viewport.height}`;
      if(module==='home'||module==='events') {
        const buttons=page.locator('.schedule-siglas-grid>button.sigla-item');
        const first=buttons.first();
        const firstBox=await first.boundingBox();
        await page.touchscreen.tap(firstBox.x+1,firstBox.y+firstBox.height-1);
        const idx=await first.locator('.sigla-index').boundingBox();
        await page.touchscreen.tap(idx.x+idx.width/2,idx.y+idx.height/2);
        const rank=await first.locator('.sigla-token__vacation-rank').first().boundingBox();
        await page.touchscreen.tap(rank.x+rank.width/2,rank.y+rank.height/2);
        await first.focus();
        await page.keyboard.press('Enter');
        if(module==='events') await buttons.last().click();
        measurement.touch.clicks=await page.evaluate(()=>window.__fixtureClicks);
      }
      await page.screenshot({path:path.join(output,`${key}.png`),fullPage:true});
      const failures=[];
      if(measurement.docWidth>viewport.width+1) failures.push('horizontal scroll');
      if(module!=='management'&&measurement.docHeight>viewport.height+1) failures.push('fixed module vertical scroll');
      if(measurement.title.count!==1) failures.push('duplicate title');
      if(measurement.elements.some(e=>e.clipped)) failures.push('clipped critical element');
      if(module!=='management'&&measurement.controlsOutside.length) failures.push('control outside viewport');
      if(measurement.clippedControls.length) failures.push('clipped control');
      if(measurement.image && (measurement.image.naturalWidth!==1536 || measurement.image.naturalHeight!==1024 || Math.abs(measurement.image.rect.width/measurement.image.rect.height-1.5)>.01)) failures.push('Arsenal photo proportion');
      if(module==='home'||module==='events') {
        if(measurement.docHeight>viewport.height+1) failures.push('vertical scroll');
        if(measurement.touch.count!==(module==='home'?17:18)||measurement.touch.indices!==17) failures.push('missing position/index/support');
        if(measurement.touch.minHeight<31.99||measurement.touch.minWidth<31.99) failures.push('target below 32px');
        if(measurement.touch.overlaps||measurement.tokenOverlaps) failures.push('overlapping targets/tokens');
        if(measurement.touch.clipped.length) failures.push('clipped sigla/index/vacation');
        if(measurement.touch.hitChecks.some(c=>c.hit!==c.expected)) failures.push('cell points to another button');
        if(measurement.touch.clicks.length!==(module==='events'?5:4)||measurement.touch.clicks.slice(0,4).some(c=>c.index!=='0'||c.support)||module==='events'&&!measurement.touch.clicks.at(-1).support) failures.push('native touch/index/vacation/keyboard/support destination');
      }
      measurement.failures=failures;
      results.push({key,...measurement});
      console.log(JSON.stringify({key,doc:measurement.docWidth+'x'+measurement.docHeight,title:measurement.title.text+' '+measurement.title.font,titleWidth:Math.round(measurement.title.rect.width),cardWidth:Math.round(measurement.title.card.width),headingCount:measurement.title.count,criticalClip:measurement.elements.filter(e=>e.clipped).map(e=>e.class),controlsOutside:measurement.controlsOutside.length,clippedControls:measurement.clippedControls.map(c=>c.text),tokenOverlaps:measurement.tokenOverlaps,touch:{count:measurement.touch.count,minHeight:measurement.touch.minHeight,minWidth:measurement.touch.minWidth,overlaps:measurement.touch.overlaps,clipped:measurement.touch.clipped,clicks:measurement.touch.clicks},failures:measurement.failures,image:measurement.image?{box:Math.round(measurement.image.rect.width)+'x'+Math.round(measurement.image.rect.height),figure:Math.round(measurement.image.figure.width)+'x'+Math.round(measurement.image.figure.height),natural:measurement.image.naturalWidth+'x'+measurement.image.naturalHeight}:null}));

      if(module==='checklist') {
        for(const mode of ['report','confirmation','qr']) {
          await page.evaluate(mode=>{
            document.querySelectorAll('dialog[open]').forEach(d=>d.close());
            if(mode==='qr') {
              const dialog=document.querySelector('#checklist-qr-dialog');
              document.querySelector('#checklist-qr-video').hidden=false;
              document.querySelector('#checklist-qr-focus').hidden=false;
              dialog.showModal();document.querySelector('#checklist-qr-close').focus({preventScroll:true});
            } else {
              const report=document.querySelector('#checklist-report-dialog');
              report.querySelector('.checklist-report-content').innerHTML=window.__checklistReportFixture;
              report.showModal();
              const name=document.querySelector('#checklist-responsible-name');name.textContent='Responsável de Teste Maria Silva de Albuquerque';
              const prepare=document.querySelector('#checklist-signature-prepare');prepare.disabled=false;
              if(mode==='confirmation') {
                document.querySelector('#checklist-confirmation-dialog').showModal();
                document.querySelector('#checklist-confirmation-title').focus({preventScroll:true});
              } else report.querySelector('[data-checklist-select]').focus({preventScroll:true});
            }
          },mode);
          const detail=await page.evaluate(mode=>{
            const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
            const clip=(e,r=e.getBoundingClientRect())=>{for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p),q=p.getBoundingClientRect();if(/hidden|clip/.test(s.overflowX)&&(r.left<q.left-1||r.right>q.right+1))return true;if(/hidden|clip/.test(s.overflowY)&&(r.top<q.top-1||r.bottom>q.bottom+1))return true;}return false;};
            const dialog=document.querySelector(mode==='qr'?'#checklist-qr-dialog':mode==='confirmation'?'#checklist-confirmation-dialog':'#checklist-report-dialog');
            const controls=[...dialog.querySelectorAll('button,input,textarea')].filter(e=>e.getClientRects().length&&!e.closest('dialog:not([open])'));
            const cutControls=controls.filter(e=>clip(e)||e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().right>innerWidth+1||e.getBoundingClientRect().bottom>innerHeight+1).map(e=>e.id||e.textContent.trim());
            const texts=[...dialog.querySelectorAll('.checklist-station-select>span,.checklist-confirmation-button>span,.checklist-confirmation-button>small')].filter(e=>e.getClientRects().length&&e.textContent.trim());
            const cutText=texts.filter(e=>{const range=document.createRange();range.selectNodeContents(e);return clip(e,range.getBoundingClientRect());}).map(e=>e.textContent);
            const buttons=[...dialog.querySelectorAll('.checklist-station-select')];
            const badHits=buttons.filter(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.checklist-station-select')!==e;}).map(e=>e.dataset.checklistSelect);
            const video=document.querySelector('#checklist-qr-video'),focus=document.querySelector('#checklist-qr-focus'),container=document.querySelector('.checklist-qr-container');
            return {mode,dialog:box(dialog),docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight,cutControls,cutText,focusId:document.activeElement?.id||document.activeElement?.dataset?.checklistSelect,arsenalCount:buttons.length,inactiveCount:dialog.querySelectorAll('.checklist-station-inactive').length,functionCount:dialog.querySelectorAll('.checklist-arsenal-function').length,minArsenalHeight:buttons.length?Math.min(...buttons.map(e=>e.getBoundingClientRect().height)):null,badHits,confirmationButton:mode==='report'?box(dialog.querySelector('#checklist-signature-prepare')):null,qr:mode==='qr'?{video:box(video),focus:box(focus),container:box(container),clipPath:getComputedStyle(video).clipPath,objectFit:getComputedStyle(video).objectFit,close:box(document.querySelector('#checklist-qr-close'))}:null};
          },mode);
          const modalKey=key+'-'+mode;
          await page.screenshot({path:path.join(output,modalKey+'.png'),fullPage:true});
          detail.key=modalKey;detail.failures=[];
          if(detail.cutControls.length||detail.cutText.length) detail.failures.push('clipped modal control/text');
          if(mode==='report'&&(detail.arsenalCount!==28||detail.inactiveCount!==5||detail.functionCount!==6||detail.badHits.length)) detail.failures.push('Arsenal count/function/hit');
          if(mode==='confirmation'&&detail.focusId!=='checklist-confirmation-title') detail.failures.push('confirmation focus');
          if(mode==='qr'&&(detail.focusId!=='checklist-qr-close'||detail.qr.close.height<32||detail.qr.clipPath!=='none'||Math.abs(detail.qr.video.width-detail.qr.focus.width)>1||Math.abs(detail.qr.video.height-detail.qr.focus.height)>1||Math.abs(detail.qr.video.y-detail.qr.focus.y)>1)) detail.failures.push('QR focus/crop/return target');
          checklistModals.push(detail);
          console.log(JSON.stringify({modalKey,...detail}));
        }
        await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));
      }
    }
    await context.close();
  }
  fs.writeFileSync(path.join(output,'measurements.json'),JSON.stringify(results,null,2));
  fs.writeFileSync(path.join(output,'checklist-modal-measurements.json'),JSON.stringify(checklistModals,null,2));
  assert.deepEqual(checklistModals.filter(r=>r.failures.length).map(r=>({key:r.key,failures:r.failures,cutControls:r.cutControls,cutText:r.cutText})),[], 'Checklist modal layout regressions');
  const failures=results.filter(r=>r.failures.length).map(r=>({key:r.key,failures:r.failures,touch:r.touch?.clipped}));
  assert.deepEqual(failures,[], 'Mobile layout and native touch regressions');
  console.log(JSON.stringify({passed:results.length,scheduleLayouts:results.filter(r=>r.touch.count).length,minTargetHeight:Math.min(...results.filter(r=>r.touch.count).map(r=>r.touch.minHeight)),minTargetWidth:Math.min(...results.filter(r=>r.touch.count).map(r=>r.touch.minWidth)),output}));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
