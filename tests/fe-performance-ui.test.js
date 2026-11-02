import test from 'node:test';import assert from 'node:assert/strict';
import {fePerformanceMarkup} from '../src/fe-performance-ui.js';
test('FE screen shows only the participant balance and survey type without response content',()=>{
 const html=fePerformanceMarkup({status:'READY',uid:'u1',summary:{uid:'u1',total:1},reference:{maxTotal:2},awards:[{uid:'u1',category:'PERFORMANCE',points:1,survey:'climate',cycle:'2026',createdAt:Date.parse('2026-10-01T00:00:00Z'),answers:{Q01:'secret'}}]});
 assert.match(html,/Meus pontos FE/);assert.match(html,/Pesquisa de clima/);assert.doesNotMatch(html,/secret|answers|responseId/);
});
