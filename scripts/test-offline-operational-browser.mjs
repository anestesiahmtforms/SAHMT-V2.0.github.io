import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url)), base = '/SAHMT-V2.0.github.io/';
const expireAttestation = process.argv.includes('--expired-app-check');
const config = await readFile(path.join(root, 'src/firebase-config.js'), 'utf8');
const apiKey = config.match(/apiKey:\s*['"]([^'"]+)/)?.[1];
assert.ok(apiKey, 'Configuração Web necessária para a simulação local.');
const manifest = JSON.parse(await readFile(path.join(root, 'dist/assets-manifest.json'), 'utf8'));
const report = {schemaVersion: 1, code: 'OFFLINE_BROWSER_RUNNING', productionReads: 0, productionWrites: 0, scenarios: {}, timingsMs: {}};
const mime = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2'};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.endsWith('__fixture_seed')) {response.writeHead(200, {'Content-Type': 'text/html'}); response.end('<!doctype html><title>Fixture local</title>'); return;}
    const relative = pathname.startsWith(base) ? pathname.slice(base.length) || 'index.html' : '';
    const target = path.resolve(root, 'dist', relative);
    if (!relative || !target.startsWith(path.join(root, 'dist') + path.sep)) throw new Error('LOCAL_ROUTE_INVALID');
    const data = await readFile(target); response.writeHead(200, {'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store'}); response.end(data);
  } catch {response.writeHead(404); response.end('LOCAL_NOT_FOUND');}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let executablePath = chromium.executablePath();
if (!existsSync(executablePath)) {
  const directory = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
  for (const entry of await readdir(directory)) {
    const candidate = path.join(directory, entry, 'chrome-win64', 'chrome.exe');
    if (entry.startsWith('chromium-') && existsSync(candidate)) {executablePath = candidate; break;}
  }
}
let browser, pageForDebug, stage = 'launch', offline = false;
const browserErrors = [];
try {
  browser = await chromium.launch({executablePath, headless: true});
  const context = await browser.newContext({viewport: {width: 390, height: 844}, timezoneId: 'America/Sao_Paulo'});
  let firestoreRequests = 0, outsideRequests = 0;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (offline) return route.abort('internetdisconnected');
    if (url.hostname === 'firebaseappcheck.googleapis.com') return route.fulfill({json: {token: 'synthetic-app-check-token', ttl: '3600s'}});
    if (url.hostname === 'identitytoolkit.googleapis.com') return route.fulfill({json: {users: [{localId: 'offline-browser-fixture', email: 'offline.fixture@example.invalid', emailVerified: true, displayName: 'Pessoa de teste offline', providerUserInfo: [{providerId: 'google.com', rawId: 'offline-browser-fixture', email: 'offline.fixture@example.invalid', displayName: 'Pessoa de teste offline'}], createdAt: '1', lastLoginAt: '1'}]}});
    if (url.hostname === 'firestore.googleapis.com') {firestoreRequests++; return route.fulfill({status: 429, json: {error: {code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Synthetic quota test'}}});}
    outsideRequests++; return route.abort('blockedbyclient');
  });
  await context.addInitScript(({apiKey, expireAttestation}) => {
    // Only external attestation is mocked. The Firebase SDK, application and
    // persistence still run from the actual production-configured build.
    const captcha = {ready: callback => callback(), render: () => 1, execute: async () => 'synthetic-recaptcha-token'};
    if (!expireAttestation || !localStorage.getItem('fixture-expired-appcheck')) globalThis.grecaptcha = {...captcha, enterprise: captcha};
    globalThis.__fixtureSessionStates = []; addEventListener('sahmt-session-status', event => globalThis.__fixtureSessionStates.push(event.detail));
    if (localStorage.getItem('offline-fixture-seeded')) return;
    const uid = 'offline-browser-fixture', now = Date.now(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo'}).format(new Date());
    const profile = {uid, displayName: 'Pessoa de teste offline', email: 'offline.fixture@example.invalid', sigla: 'AA', role: 'administrador_app', active: true, access: true, cachedAt: now, permissions: {admin: true, eventsRead: true, eventsWrite: true, scheduleRead: true, labelsRead: true, labelsWrite: true, labelsManage: true, checklistRead: true, checklistWrite: true, checklistSign: true, checklistManage: true}};
    const jwt = value => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const token = `${jwt({alg: 'RS256', typ: 'JWT'})}.${jwt({sub: uid, user_id: uid, aud: 'sahmt-17a16', iss: 'https://securetoken.google.com/sahmt-17a16', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600, auth_time: Math.floor(now / 1000), firebase: {sign_in_provider: 'google.com'}})}.synthetic`;
    localStorage.setItem(`firebase:authUser:${apiKey}:sahmt-v2`, JSON.stringify({uid, email: profile.email, displayName: profile.displayName, emailVerified: true, isAnonymous: false, providerData: [{providerId: 'google.com', uid, email: profile.email, displayName: profile.displayName}], stsTokenManager: {refreshToken: 'synthetic-only', accessToken: token, expirationTime: now + 3600000}, apiKey, appName: 'sahmt-v2', createdAt: '1', lastLoginAt: '1'}));
    globalThis.__fixtureSeedReady = new Promise((resolve, reject) => {
      const open = indexedDB.open('sahmt-v2-local', 4);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('profiles', {keyPath: 'uid'});
        const cache = db.createObjectStore('cache', {keyPath: 'key'}); cache.createIndex('uid', 'uid');
        const outbox = db.createObjectStore('outbox', {keyPath: 'requestId'}); outbox.createIndex('uid', 'uid'); outbox.createIndex('uidStatus', ['uid', 'status']);
        const drafts = db.createObjectStore('operationalDrafts', {keyPath: 'key'}); drafts.createIndex('uid', 'uid');
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction(['profiles', 'cache'], 'readwrite');
        tx.objectStore('profiles').put(profile);
        const put = (kind, id, data) => tx.objectStore('cache').put({key: `${uid}::${kind}::${id}`, uid, kind, id, data, cachedAt: now});
        const stations = Array.from({length: 28}, (_, i) => ({id: String(100170001 + i), qrCode: String(100170001 + i), name: `Arsenal de teste ${i + 1}`, active: i < 25, order: i + 1, maintenance: {}}));
        const records = stations.filter(item => item.active).map(item => ({id: 'answer-' + item.id, stationId: item.id, date: day, condition: 'SIM', occurrence: '', createdByUid: uid, createdByName: profile.displayName, createdAt: new Date(now), active: true, version: 1}));
        put('appConfig', 'app', {features: {events: true, labels: true, checklist: true, management: true, trainings: true, notifications: true}});
        put('stations', 'all', stations); put('checklists', day, {records, stationIds: stations.map(item => item.id).sort(), priorRecords: [], truncated: false});
        put('checklists', 'month:' + day.slice(0, 7), {records, stationIds: stations.map(item => item.id).sort(), priorRecords: [], truncated: false});
        put('scheduleDays', day, {id: day, date: day, siglas: ['AA', 'BB'], positions: [{position: 1, sigla: 'AA'}, {position: 2, sigla: 'BB'}], highlights: {siglas: [], events: []}, version: 1});
        put('contacts', 'active', [{id: 'AA', sigla: 'AA', name: 'Pessoa sintética', active: true}]); put('vacations', day, []);
        put('labelStaff', 'all', ['AA', 'BB']); put('eventMembers', 'all', [{id: 'AA', sigla: 'AA', name: 'Pessoa sintética', active: true}]);
        put('eventCatalogs', 'operational', {payers: ['Exemplo'], creditors: ['Pessoa sintética'], version: 1});
        for (const visibility of ['admin', 'AA']) {
          put('events', `report:${day}:${day}:${visibility}:100`, {records: [], hasMore: false});
          put('labels', `report:${day}:${day}:${visibility}:50`, {records: [], hasMore: false});
          const month = day.slice(0, 7), [year, number] = month.split('-').map(Number), end = `${month}-${new Date(year, number, 0).getDate()}`;
          put('events', `report:${month}-01:${end}:${visibility}:100`, {records: [], hasMore: false});
          put('labels', `report:${month}-01:${end}:${visibility}:50`, {records: [], hasMore: false});
        }
        tx.oncomplete = () => {db.close(); localStorage.setItem('offline-fixture-seeded', 'yes'); resolve();}; tx.onerror = () => reject(tx.error);
      };
    });
  }, {apiKey, expireAttestation});
  const page = await context.newPage(), errors = [];
  pageForDebug = page;
  page.on('pageerror', error => {errors.push(error.message); browserErrors.push(error.message);});
  stage = 'seed'; await page.goto(origin + base + '__fixture_seed'); await page.evaluate(() => globalThis.__fixtureSeedReady);
  stage = 'online-backend-quota'; await page.goto(origin + base + '#/labels');
  await page.locator('#label-manual-open').waitFor({timeout: 20000});
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {timeout: 20000});
  await page.locator('#label-manual-open').click();
  await page.locator('[name=patientName]').fill('Rascunho fictício');
  await page.waitForTimeout(100);
  report.scenarios.backendUnavailableWithInternet = 'passed';
  stage = 'offline-reopen';
  if (expireAttestation) await page.evaluate(async () => {
    localStorage.setItem('fixture-expired-appcheck', 'yes');
    for (const {name} of await indexedDB.databases()) if (name?.includes('app-check')) await new Promise(resolve => {
      const request = indexedDB.open(name); request.onsuccess = () => {
        const db = request.result, stores = [...db.objectStoreNames]; if (!stores.length) {db.close(); resolve(); return;}
        const transaction = db.transaction(stores, 'readwrite'); for (const store of stores) transaction.objectStore(store).clear();
        transaction.oncomplete = () => {db.close(); resolve();};
      };
    });
  });
  offline = true; await context.setOffline(true); const reopenStarted = Date.now(); await page.reload();
  await page.locator('#label-manual-open').waitFor({timeout: 15000}); report.timingsMs.offlineReopenToLabels = Date.now() - reopenStarted; await page.locator('#label-manual-open').click();
  await page.waitForFunction(() => document.querySelector('[name=patientName]')?.value === 'Rascunho fictício');
  report.scenarios.offlineReopenAndDraft = 'passed';
  stage = 'manual-label'; await page.locator('[name=encounterCode]').fill('12345678'); await page.locator('[name=type]').selectOption({label: 'Consulta Pré-anestésica'});
  await page.locator('form[data-module-form=labels] [type=submit]').click();
  await page.waitForTimeout(200);
  const operations = async () => page.evaluate(() => new Promise(resolve => {const open = indexedDB.open('sahmt-v2-local'); open.onsuccess = () => {const db = open.result, get = db.transaction('outbox').objectStore('outbox').getAll(); get.onsuccess = () => {db.close(); resolve(get.result.map(({type, status, requestId}) => ({type, status, requestId})));};};}));
  assert.ok((await operations()).some(item => item.type === 'labels' && item.status === 'awaiting-confirmation'));
  report.scenarios.manualLabelDurable = 'passed';
  if (await page.locator('#label-entry-close').isVisible()) await page.locator('#label-entry-close').click();
  await page.locator('[data-label-report-launch=daily]').click();
  await page.locator('#label-report-dialog').waitFor({state: 'visible'});
  assert.ok(await page.locator('#label-report-results').innerText()); report.scenarios.labelsDailyReport = 'passed';
  await page.locator('#label-report-dialog form[method=dialog] button').click();
  await page.locator('[data-label-report-launch=monthly]').click();
  await page.waitForFunction(() => document.querySelector('#label-report-results')?.textContent.includes('etiqueta') || document.querySelector('#label-report-results [data-label-record]'));
  report.scenarios.labelsMonthlyReport = 'passed'; await page.locator('#label-report-dialog form[method=dialog] button').click();
  stage = 'events'; const eventsStarted = Date.now(); await page.evaluate(() => {location.hash = '#/events';});
  await page.locator('[data-event-support]').waitFor(); await page.locator('[data-event-support]').click();
  await page.locator('#event-launch-dialog').waitFor({state: 'visible'});
  report.scenarios.eventsForm = 'passed'; report.timingsMs.offlineEventsForm = Date.now() - eventsStarted;
  await page.locator('#event-launch-back').click(); await page.locator('[data-event-report-launch=daily]').click();
  await page.locator('#event-report-dialog').waitFor({state: 'visible'}); report.scenarios.eventsDailyReport = 'passed';
  await page.locator('#event-report-dialog form[method=dialog] button').click(); await page.locator('[data-event-report-launch=monthly]').click();
  await page.waitForFunction(() => document.querySelector('#event-report-results')?.textContent.includes('evento'));
  report.scenarios.eventsMonthlyReport = 'passed';
  stage = 'checklist'; const checklistStarted = Date.now(); await page.evaluate(() => {location.hash = '#/checklist';});
  await page.locator('[data-checklist-report-launch=daily]').click(); await page.locator('[data-checklist-station]').first().waitFor();
  assert.equal(await page.locator('[data-checklist-station]').count(), 28);
  report.timingsMs.offlineChecklistReport = Date.now() - checklistStarted;
  stage = 'local-conference';
  await page.waitForFunction(() => document.querySelector('#checklist-signature-prepare')?.disabled === false);
  await page.locator('#checklist-signature-prepare').click(); await page.locator('[data-local-conference-confirm]').click();
  await page.waitForFunction(() => document.querySelector('#checklist-signature-prepare')?.disabled === true && document.querySelector('#checklist-conference-signer')?.textContent.includes('revalidação'));
  const localConference = await page.evaluate(() => new Promise(resolve => {const open = indexedDB.open('sahmt-v2-local'); open.onsuccess = () => {const db = open.result, get = db.transaction('operationalDrafts').objectStore('operationalDrafts').getAll(); get.onsuccess = () => {db.close(); resolve(get.result.some(item => item.id.startsWith('conference:') && item.fields.reportDigest?.length === 64));};};}));
  assert.equal(localConference, true); report.scenarios.localConferenceWithoutRemoteScoring = 'passed';
  stage = 'checklist-write';
  await page.locator('[data-checklist-station="100170001"]').click(); await page.locator('[data-checklist-banner-answer=SIM]').click();
  await page.waitForTimeout(200); assert.ok((await operations()).some(item => item.type === 'checklists'));
  report.scenarios.checklist28StationsAndWrite = 'passed';
  stage = 'persistence'; const before = await operations(); await page.reload(); await page.locator('[data-checklist-report-launch=daily]').waitFor();
  const after = await operations(); assert.deepEqual(after, before); report.scenarios.pendingSurvivesRestart = 'passed';
  stage = 'monthly-checklist'; await page.locator('[data-checklist-report-launch=monthly]').click();
  await page.locator('[data-checklist-open-day]').first().waitFor(); report.scenarios.checklistMonthlyReport = 'passed';
  assert.equal(errors.length, 0, errors.join(' | '));
  assert.ok(firestoreRequests <= 2, 'A simulação não deve gerar um loop de consultas.');
  report.firestoreRequestsIntercepted = firestoreRequests; report.otherExternalRequestsBlocked = outsideRequests; report.browser = await browser.version(); report.code = 'OFFLINE_BROWSER_PASSED';
} catch (error) {
  report.code = 'OFFLINE_BROWSER_FAILED'; report.stage = stage; report.error = error.message; report.browserErrors = browserErrors;
  report.fixturePageText = await pageForDebug?.locator('body').innerText().catch(() => 'PAGE_UNAVAILABLE');
  report.sessionStates = await pageForDebug?.evaluate(() => globalThis.__fixtureSessionStates).catch(() => []);
  report.localProfileCheck = await pageForDebug?.evaluate(async authPath => {
    const current = (await import(authPath)).auth.currentUser;
    const profile = await new Promise(resolve => {const open = indexedDB.open('sahmt-v2-local'); open.onsuccess = () => {const db = open.result, get = db.transaction('profiles').objectStore('profiles').get('offline-browser-fixture'); get.onsuccess = () => {db.close(); resolve(get.result);};};});
    return {firebaseUserRestored: Boolean(current), uidMatchesFixture: current?.uid === 'offline-browser-fixture', cacheExists: Boolean(profile), cacheUidMatches: profile?.uid === current?.uid, cacheAgeMs: Date.now() - profile?.cachedAt, online: navigator.onLine};
  }, origin + base + manifest['src/firebase-auth.js'].file).catch(() => ({code: 'LOCAL_PROFILE_CHECK_UNAVAILABLE'}));
  process.exitCode = 1;
}
finally {await browser?.close(); await new Promise(resolve => server.close(resolve)); await mkdir(path.join(root, '.local-preview'), {recursive: true}); await writeFile(path.join(root, '.local-preview/' + (expireAttestation ? 'offline-expired-appcheck-report.json' : 'offline-browser-report.json')), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));}
