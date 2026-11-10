import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf('function ' + name + '(');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start, name);
  return (source.slice(start - 6, start) === 'async ' ? 'async ' : '') + source.slice(start, end);
}
const eventFormSource = readFileSync(new URL('../src/event-form.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/m, '').replaceAll('export function ', 'function ');
const reportMarkup = source.slice(source.indexOf('  const eventReport ='), source.indexOf('\n  const eventSchedule ='));
const helpers = ['canManageScheduleEvents', 'canEditScheduleEvents', 'canReadScheduleEvents', 'actionForm', 'eventPanelsMarkup',
  'showSchedulePanel', 'openScheduleEventReport', 'bindScheduleEventPanels', 'chooseScheduleEventMember',
  'showScheduleContacts', 'launchEventSupport', 'launchEventFromSchedule', 'chooseEventScheduleMember',
  'setEventTypeContext', 'resetEventEditor', 'beginEventEdit', 'reportScopeCurrent', 'finishScheduleEventSave',
  'updateEventSubmitState', 'updateEventEntryFields', 'normalizeEventOption', 'findEventCatalogValue', 'findEventPersonCatalogValue',
  'applyEventSelectAutofill', 'applyEventAmountAutofill', 'bindModuleForm'].map(fn).join('\n').replaceAll("await import('./data.js')", 'mockData');

test('daily event cards retain the original design and separate labels from long values inside Escala', async () => {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    const page = await browser.newPage();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({width, height:844});
      await page.setContent('<!doctype html><meta charset="utf-8"><style>'+css+'</style><main class="app-shell--events" id="frame"><dialog open id="schedule-contact-dialog" data-panel="event-report-dialog"><section open id="event-report-dialog" class="event-report event-report-dialog" data-schedule-panel><header class="event-report-dialog__header"><h2>RELATÓRIO DIÁRIO</h2></header><div id="event-report-results" class="module-content"></div></section></dialog></main>');
      await page.addScriptTag({content:`(()=>{
        let eventReportMode='daily',eventReportStale=false,eventReportCursor=null,loadedEventReportRecords=[];
        const eventReportSourceRecords=[{id:'preview',version:1,date:'2026-11-08',memberStatus:'Profissional de demonstração com nome extenso',eventType:'Pessoal',description:'Descrição de demonstração com detalhes suficientes para ocupar várias linhas no cartão.',shift:'Integral',substitute:'Profissional substituto de demonstração',payer:'Pagador de demonstração',creditor:'Credor de demonstração',amountToPay:2000,createdByName:'Responsável de demonstração com nome extenso'}];
        const canEditScheduleEvents=()=>true,escapeHtml=s=>String(s??''),formatRecordDate=s=>s,interactionDateTime=()=>'',todayInputValue=()=> '2026-11-08';
        const confirmedLiveReportRecords=r=>r,liveReports={get:()=>({snapshot:()=>({scope:{}})})},reportScopeCurrent=()=>true;
        const reconcileReportMarkup=(el,html)=>el.innerHTML=html;
        ${fn('renderEventReportRecords')}
        renderEventReportRecords();})();
      `});
      const design = () => page.locator('.event-daily-record').evaluate(card => {
        const style=getComputedStyle(card),field=getComputedStyle(card.querySelector('.label-record-field'));
        return {display:style.display,padding:style.padding,borderRadius:style.borderRadius,background:style.backgroundImage,fieldDisplay:field.display,fieldGap:field.gap,labelFont:getComputedStyle(card.querySelector('.label-record-field>span')).fontSize,valueFont:getComputedStyle(card.querySelector('.label-record-field>strong')).fontSize,indexPosition:getComputedStyle(card.querySelector('.label-record-index')).position};
      });
      const original = await design();
      await page.locator('#frame').evaluate(el=>el.className='app-shell--schedule');
      assert.deepEqual(await design(), original, 'Escala must retain the previous daily-card design at '+width+'px');
      const overlapping = await page.locator('.label-record-field,.label-record-responsible').evaluateAll(rows=>rows.some(row=>{
        const label=row.querySelector('span').getBoundingClientRect(),value=row.querySelector('strong').getBoundingClientRect();
        return label.right>value.left+1 || label.bottom>row.getBoundingClientRect().bottom+1 || value.bottom>row.getBoundingClientRect().bottom+1;
      }));
      assert.equal(overlapping, false, 'daily-card text must not overlap at '+width+'px');
      if(process.env.EVENT_DAILY_PREVIEW_PATH&&width===390)await page.screenshot({path:process.env.EVENT_DAILY_PREVIEW_PATH});
    }
  } finally {await browser.close();}
});

test('Escala keeps contact, member choice, entry and reports inside one accessible modal', {timeout: 45000}, async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><meta charset="utf-8"><style>' + css + '</style><main class="app-shell--schedule"><button id="open">Sigla AB/CD</button><input id="schedule-date" value="2026-11-08"><dialog id="schedule-contact-dialog" class="schedule-contact-dialog"><div id="schedule-contact-details" data-schedule-panel></div><form method="dialog" data-schedule-close><button>Fechar</button></form></dialog></main>');
    await page.addScriptTag({content: `
      let session={status:'signed-in',user:{uid:'one',email:'marcio.henrique82@gmail.com',emailVerified:true},profile:{role:'gestor',permissions:{eventsRead:true,eventsWrite:true,eventsManage:true}}};
      let appFeatures={},route='schedule',eventReportOpen=false,eventReportMode='daily',scheduleEventContext={},scheduleMemberChoice=null;
      let loadedEventMembers=[{sigla:'AB',name:'Ana'},{sigla:'CD',name:'Carlos'}];
      let reads=0,closes=0;const todayInputValue=()=> '2026-11-08', currentRoute=()=>route;
      const can=p=>session.profile.role==='administrador_app'||session.profile.permissions[p]===true;
      const featureEnabledForRoute=()=>true,escapeHtml=String,contactActionLinks=()=>({phone:'5511999999999',email:'test@example.invalid',whatsApp:'https://example.invalid'});
      const closeReportLive=()=>closes++,loadEventReport=async()=>{reads++;return true},shareReportPdf=()=>{};
      const scheduleReleaseIdentity=(profile,user)=>profile.role==='administrador_app'||user.email==='marcio.henrique82@gmail.com';
      const loadedEventCatalog={payers:['Ana'],creditors:['CAIXA DA EQUIPE']};
      const bindEventCatalogForm=()=>{},operationalDrafts={},isValidDateKey=()=>true;
      let notice='',labelEntryGeneration=0;
      const saves=[];
      const mockData={updateEventRecord:async(id,record)=>{saves.push([id,record]);return {}},createOperationalRecord:async(_,record)=>{saves.push(['new',record]);return {}}};
      ${eventFormSource}
      const reportAllowed=()=>true,reportPermissionKey=()=> 'allowed';
      ${helpers}
      ${reportMarkup}
      const dialog=document.querySelector('#schedule-contact-dialog');
      dialog.querySelector('[data-schedule-close]').insertAdjacentHTML('beforebegin',eventPanelsMarkup(actionForm('events'),eventReport));
      bindScheduleEventPanels();
      const entryForm=document.querySelector('[data-module-form="events"]');
      for(const [name,values] of Object.entries(loadedEventCatalog)) entryForm.elements[name==='payers'?'payer':'creditor'].add(new Option(values[0],values[0]));
      entryForm.dataset.eventCatalogReady='true';
      updateEventSubmitState(entryForm);
      void bindModuleForm('events');
      document.querySelector('#open').onclick=()=>showScheduleContacts([{sigla:'AB',name:'Ana'}],{sigla:'AB/CD',date:'2026-10-14',position:{sigla:'AB/CD',siglas:['AB','CD']}});
      window.fixture={support:()=>launchEventSupport('2026-10-14'),reads:()=>reads,closes:()=>closes,
        common:()=>{session.user.email='outro-gestor@example.test';},
        operator:()=>{session.user.email='marcio.henrique82@gmail.com';},
        saves:()=>saves,canManage:()=>canManageScheduleEvents(),edit:()=>beginEventEdit({id:'event-1',date:'2026-10-14',eventType:'ATRASO',memberSigla:'AB',memberStatus:'Ana',delayMultiple:1,payer:'Ana',creditor:'CAIXA DA EQUIPE',amountToPay:200,version:1}),
        scopeCurrent:()=>reportScopeCurrent({kind:'events',uid:'one',permissionKey:'allowed',mode:eventReportMode,day:document.querySelector('#event-report-day').value,month:document.querySelector('#event-report-month').value,targetNode:document.querySelector('#event-report-results')})};
    `});
    await page.locator('#open').click();
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.getByRole('link', {name: 'Ligar', exact: true}).waitFor();
    await page.getByRole('button', {name: 'Lançar evento de escala'}).click();
    await page.getByRole('button', {name: 'Ana · AB', exact: true}).click();
    assert.equal(await page.locator('dialog').count(), 1);
    assert.equal(await page.locator('[name="memberSigla"]').inputValue(), 'AB');
    assert.equal(await page.locator('[name="eventDate"]').inputValue(), '2026-10-14');
    await page.locator('#event-launch-back').click();
    await page.getByRole('button', {name: 'Relatório diário', exact: true}).click();
    assert.equal(await page.locator('#event-report-day').inputValue(), '2026-10-14');
    assert.equal(await page.evaluate(() => fixture.scopeCurrent()), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.equal(await page.evaluate(() => fixture.scopeCurrent()), false);
    await page.getByRole('button', {name: 'Relatório mensal', exact: true}).click();
    assert.equal(await page.locator('#event-report-month').inputValue(), '2026-10');
    await page.locator('#share-events-pdf').waitFor({state: 'visible'});
    await page.keyboard.press('Escape');
    await page.evaluate(() => fixture.support());
    assert.equal(await page.locator('[name="eventType"]').inputValue(), 'Suporte');
    assert.equal(await page.locator('[name="scheduleSigla"]').inputValue(), 'SUPORTE');
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.locator('#event-launch-back').click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => fixture.common());
    await page.locator('#open').click();
    assert.equal(await page.getByRole('button', {name: 'Lançar evento de escala'}).count(), 0);
    assert.equal(await page.evaluate(() => fixture.canManage()), false);
    await page.getByRole('button', {name: 'Relatório diário', exact: true}).click();
    await page.evaluate(() => { fixture.operator(); fixture.edit(); });
    assert.equal(await page.locator('[name="editEventId"]').inputValue(), 'event-1');
    await page.locator('#event-edit-cancel').click();
    assert.equal(await page.locator('#event-report-dialog').isVisible(), true);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.locator('#open').click();
    await page.getByRole('button', {name: 'Relatório diário', exact: true}).click();
    await page.evaluate(() => fixture.edit());
    const editedAmount = page.locator('[name="amountToPay"]');
    assert.equal(await editedAmount.inputValue(), '200');
    await editedAmount.fill('75.25');
    await page.getByRole('button', {name: 'Atualizar evento'}).click();
    await page.locator('#event-report-dialog').waitFor({state: 'visible'});
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: 'Lançar evento de escala'}).click();
    await page.getByRole('button', {name: 'Ana · AB', exact: true}).click();
    assert.equal(await page.locator('[name="editEventId"]').inputValue(), '');
    await page.locator('[name="eventType"]').selectOption('ATRASO');
    assert.equal(await page.locator('[name="delayMultiple"] option[value="0"]').count(), 0);
    const amount = page.locator('[name="amountToPay"]');
    await page.locator('[name="delayMultiple"]').selectOption('1');
    assert.equal(await amount.inputValue(), '');
    assert.equal(await amount.evaluate(input => input.required), false);
    await amount.fill('73.50');
    await page.locator('[name="delayMultiple"]').selectOption('2');
    assert.equal(await amount.inputValue(), '73.50');
    await amount.fill('');
    await page.getByRole('button', {name: 'Salvar evento', exact: true}).click();
    await page.waitForFunction(() => fixture.saves().length === 2);
    const saves = await page.evaluate(() => fixture.saves().map(([id, record]) => [id, record.delayMultiple, record.amountToPay]));
    assert.deepEqual(saves, [['event-1', 1, 75.25], ['new', 2, null]]);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
