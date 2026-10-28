import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {extname, resolve} from 'node:path';
import {chromium} from 'playwright';
import {surveyTestBuild} from './helpers/survey-test-build.js';
test('responsive survey: conditional modules, privacy payload, XSS text, retry, consent and thanks', async () => {
  const root=await surveyTestBuild('climate');
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.includes('..')) { res.writeHead(403).end(); return; }
    try { const file = resolve(root, '.' + (path === '/' ? '/index.html' : path)); const data = await readFile(file); res.setHeader('Content-Type', {'.html':'text/html', '.js':'text/javascript', '.css':'text/css'}[extname(file)] || 'text/plain'); res.end(data); } catch { res.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({channel:'msedge',headless: true});
  try {
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({viewport: {width, height: 900}}), page = await context.newPage(), errors = [], requests = [], received = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(); requests.push(request);
        if (request.url().includes('firestore.googleapis.com/') && request.url().endsWith('documents:commit')) {
          received.push({data: request.postDataJSON(), headers: request.headers()});
          await route.fulfill({status: received.length === 1 ? 503 : 200, contentType: 'application/json', body: JSON.stringify(received.length === 1 ? {error: 'UNAVAILABLE'} : {writeResults: []})}); return;
        }
        if (new URL(request.url()).origin !== origin) { await route.abort(); return; }
        await route.continue();
      });
      if(width===320){await page.goto(origin+'/?testGroup=invalid');await page.getByText(/Não foi possível carregar sua sessão/).waitFor();assert.equal(await page.locator('form').isVisible(),false);assert.equal(received.length,0);}
      const assignedGroup=width===390?'resident':width===768?'team':'substitute';
      await page.goto(origin+'/?testGroup='+assignedGroup);
      if (process.env.CLIMATE_SCREENSHOTS && [390,1440].includes(width)) {
        await mkdir(process.env.CLIMATE_SCREENSHOTS, {recursive:true});
        await page.screenshot({path: resolve(process.env.CLIMATE_SCREENSHOTS, `pesquisa-${width}.png`)});
      }
      assert.equal(await page.locator('[name=module]').count(),0);
      assert.match(await page.locator('.notice').innerText(),/autenticação do app/);

      await page.locator('form').waitFor({state:'visible'});assert.equal(await page.locator('fieldset').count(),assignedGroup==='substitute'?32:37);assert.equal(await page.locator('#module').isVisible(),assignedGroup!=='substitute');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.check('[name=Q01][value="4"]');
      assert.equal(await page.locator('[name=consent]').count(),0); await page.fill('[name=O01]', '<script>alert("text only")</script>');
      await page.locator('[type=submit]').click(); await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Não foi possível'));
      assert.equal(await page.locator('[name=Q01][value="4"]').isDisabled(), true);
      await page.getByRole('button', {name: 'Tentar reenviar'}).click(); await page.getByRole('heading', {name: /Suas respostas foram recebidas/}).waitFor();
      assert.equal(received.length, 2);assert.equal(received[0].headers.authorization,'Bearer synthetic-token'); assert.deepEqual(received[0].data, received[1].data);
      assert.deepEqual(Object.keys(received[0].data), ['writes']);
      const writes=received[0].data.writes;
      assert.deepEqual(Object.keys(writes[0].update.fields).sort(),['answers','category_key','group','respondent_uid','survey_cycle','survey_version']);
      assert.equal(writes[0].update.fields.group.stringValue,assignedGroup);
      assert.deepEqual(writes[0].update.fields.answers.mapValue.fields,{Q01:{integerValue:'4'}});
      assert.notEqual(writes[0].update.name.split('/').at(-1),writes[1].update.name.split('/').at(-1));
      for (const h of ['cookie','referer']) assert.equal(received[0].headers[h], undefined);
      assert.equal(requests.some(req => new URL(req.url()).origin !== origin && !req.url().includes('firestore.googleapis.com/')), false);
      assert.deepEqual(await page.evaluate(() => ({local: localStorage.length, session: sessionStorage.length})), {local:0, session:0});
      assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
});
