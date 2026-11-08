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
const reportMarkup = source.slice(source.indexOf('  const eventReport ='), source.indexOf('\n  const eventSchedule ='));
const helpers = ['canManageScheduleEvents', 'canReadScheduleEvents', 'actionForm', 'eventPanelsMarkup',
  'showSchedulePanel', 'openScheduleEventReport', 'bindScheduleEventPanels', 'chooseScheduleEventMember',
  'showScheduleContacts', 'launchEventSupport', 'launchEventFromSchedule', 'chooseEventScheduleMember',
  'setEventTypeContext', 'resetEventEditor', 'beginEventEdit', 'reportScopeCurrent'].map(fn).join('\n');

test('Escala keeps contact, member choice, entry and reports inside one accessible modal', {timeout: 45000}, async () => {
  const browser = await chromium.launch({channel: 'msedge', headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 390, height: 844}});
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><meta charset="utf-8"><style>' + css + '</style><main class="app-shell--schedule"><button id="open">Sigla AB/CD</button><input id="schedule-date" value="2026-11-08"><dialog id="schedule-contact-dialog" class="schedule-contact-dialog"><div id="schedule-contact-details" data-schedule-panel></div><form method="dialog" data-schedule-close><button>Fechar</button></form></dialog></main>');
    await page.addScriptTag({content: `
      let session={status:'signed-in',user:{uid:'one'},profile:{role:'gestor',permissions:{eventsRead:true,eventsWrite:true}}};
      let appFeatures={},route='schedule',eventReportOpen=false,eventReportMode='daily',scheduleEventContext={},scheduleMemberChoice=null;
      let loadedEventMembers=[{sigla:'AB',name:'Ana'},{sigla:'CD',name:'Carlos'}];
      let reads=0,closes=0;const todayInputValue=()=> '2026-11-08', currentRoute=()=>route;
      const can=p=>session.profile.role==='administrador_app'||session.profile.permissions[p]===true;
      const featureEnabledForRoute=()=>true,escapeHtml=String,contactActionLinks=()=>({phone:'5511999999999',email:'test@example.invalid',whatsApp:'https://example.invalid'});
      const closeReportLive=()=>closes++,loadEventReport=async()=>{reads++;return true},shareReportPdf=()=>{},updateEventEntryFields=()=>{};
      const reportAllowed=()=>true,reportPermissionKey=()=> 'allowed';
      ${helpers}
      ${reportMarkup}
      const dialog=document.querySelector('#schedule-contact-dialog');
      dialog.querySelector('[data-schedule-close]').insertAdjacentHTML('beforebegin',eventPanelsMarkup(actionForm('events'),eventReport));
      bindScheduleEventPanels();
      document.querySelector('#open').onclick=()=>showScheduleContacts([{sigla:'AB',name:'Ana'}],{sigla:'AB/CD',date:'2026-10-14',position:{sigla:'AB/CD',siglas:['AB','CD']}});
      window.fixture={support:()=>launchEventSupport('2026-10-14'),reads:()=>reads,closes:()=>closes,
        common:()=>{session.profile={role:'anestesiologista',permissions:{eventsRead:true,eventsWrite:true}};},
        administrator:()=>{session.profile={role:'administrador_app',permissions:{}};},
        canManage:()=>canManageScheduleEvents(),edit:()=>beginEventEdit({id:'event-1',date:'2026-10-14',eventType:'Pessoal',memberSigla:'AB',memberStatus:'Ana',version:1}),
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
    await page.evaluate(() => { fixture.administrator(); fixture.edit(); });
    assert.equal(await page.locator('[name="editEventId"]').inputValue(), 'event-1');
    await page.locator('#event-edit-cancel').click();
    assert.equal(await page.locator('#event-report-dialog').isVisible(), true);
    assert.equal(await page.locator('dialog[open]').count(), 1);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
