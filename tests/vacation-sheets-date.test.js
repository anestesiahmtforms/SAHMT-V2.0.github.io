import test from 'node:test';
import assert from 'node:assert/strict';
import {createVacationSheets} from '../worker-fe-vacations/google.js';

test('vacation sheet audit displays Brazilian dates and round-trips ISO milliseconds across DST', async () => {
  const stamps = ['2026-11-15T02:04:05.678Z', '2018-12-15T02:04:05.678Z'];
  const cells = [];
  const sheets = createVacationSheets({getAccessToken:async ()=>'synthetic',fetchImpl:async (_url, init)=>{
    if (init.body) { const body = JSON.parse(init.body); cells.push(body.requests[1].appendCells.rows[0].values); return Response.json({}); }
    return Response.json({values:[['timestamp'], ...cells.map(row=>row.map(cell=>cell.userEnteredValue.stringValue)), [stamps[0]]]});
  }});
  for (const at of stamps) await sheets.update({at,updates:[{slot:{row:2,column:3,month:'janeiro',week:0,slot:0},value:'AA',previousValue:'BB'}],actor:{uid:'synthetic',email:'a@example.invalid'},justification:'test',operationId:'synthetic'});
  assert.equal(cells[0][0].userEnteredValue.stringValue, '14/11/2026 23:04:05.678 -03:00');
  assert.equal(cells[1][0].userEnteredValue.stringValue, '15/12/2018 00:04:05.678 -02:00');
  assert.deepEqual((await sheets.audit()).map(row=>row.at), [stamps[0],stamps[1],stamps[0]]);
});
