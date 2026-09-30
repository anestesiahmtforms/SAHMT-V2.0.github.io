import test from 'node:test';
import assert from 'node:assert/strict';
import {createChecklistReportGate} from '../src/checklist-report-gate.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return {promise, resolve};
}

const baseContext = {
  route: 'checklist',
  uid: 'fictional-user',
  mode: 'daily',
  day: '2026-09-28',
  reportOpen: true
};

test('dia A não pode substituir B quando a resposta atrasada de A chega por último', async () => {
  const gate = createChecklistReportGate();
  let selected = {...baseContext};
  const responseA = deferred();
  const responseB = deferred();
  const committed = [];
  const renderWhenCurrent = (context, response) => {
    const request = gate.begin(context);
    return response.promise.then((value) => {
      if (gate.isCurrent(request, selected)) committed.push(value);
    });
  };

  const loadA = renderWhenCurrent(selected, responseA);
  selected = {...selected, day: '2026-09-29'};
  const loadB = renderWhenCurrent(selected, responseB);
  responseB.resolve('relatório B');
  await loadB;
  responseA.resolve('relatório A');
  await loadA;

  assert.deepEqual(committed, ['relatório B']);
});

test('invalida resposta quando data, rota, sessão, período ou modal mudam', () => {
  for (const change of [
    {day: '2026-09-30'},
    {route: 'events'},
    {uid: 'another-fictional-user'},
    {mode: 'monthly'},
    {reportOpen: false}
  ]) {
    const gate = createChecklistReportGate();
    const request = gate.begin(baseContext);
    assert.equal(gate.isCurrent(request, {...baseContext, ...change}), false);
  }
});

test('invalidar o relatório fecha também uma solicitação ainda em andamento', () => {
  const gate = createChecklistReportGate();
  const request = gate.begin(baseContext);
  gate.invalidate();
  assert.equal(gate.isCurrent(request, baseContext), false);
});
