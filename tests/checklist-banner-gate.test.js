import test from 'node:test';
import assert from 'node:assert/strict';
import {createChecklistBannerGate} from '../src/checklist-banner-gate.js';

const context = {day: '2026-09-30', stationId: 'fictional-station-a', uid: 'fictional-user', route: 'checklist', dialogOpen: true};

test('resposta antiga não fecha o banner de outra estação nem reabre o relatório anterior', async () => {
  const gate = createChecklistBannerGate();
  let selected = {...context};
  const requestA = gate.begin(selected);
  let resolve;
  const responseA = new Promise((done) => { resolve = done; });
  const effects = [];
  const saveA = responseA.then(() => {
    if (gate.isCurrent(requestA, selected)) effects.push('close-new-banner', 'open-old-report');
  });
  selected = {...selected, stationId: 'fictional-station-b'};
  const requestB = gate.begin(selected);
  resolve();
  await saveA;
  assert.deepEqual(effects, []);
  assert.equal(gate.isCurrent(requestB, selected), true);
});

test('fechar banner, trocar data, estação, conta ou rota invalida o resultado', () => {
  for (const change of [{dialogOpen: false}, {day: '2026-10-01'}, {stationId: 'fictional-station-b'}, {uid: 'fictional-other-user'}, {route: 'events'}]) {
    const gate = createChecklistBannerGate();
    const request = gate.begin(context);
    assert.equal(gate.isCurrent(request, {...context, ...change}), false);
  }
});

test('reabrir a mesma estação cria outra geração e descarta a resposta anterior', () => {
  const gate = createChecklistBannerGate();
  const old = gate.begin(context);
  const reopened = gate.begin(context);
  assert.equal(gate.isCurrent(old, context), false);
  assert.equal(gate.isCurrent(reopened, context), true);
});
