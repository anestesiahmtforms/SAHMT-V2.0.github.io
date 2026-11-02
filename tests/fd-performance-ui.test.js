import test from 'node:test';import assert from 'node:assert/strict';
import {fdPerformanceMarkup} from '../src/fd-performance-ui.js';
test('FD screen shows the caller balance, indicator actions and approval queue with escaped text',()=>{
 const html=fdPerformanceMarkup({status:'READY',uid:'u1',summary:{uid:'u1',total:3},reference:{maxTotal:5},awards:[],suggestions:[],pendingSuggestions:[{id:'s1',uid:'u2',metricId:'m1',text:'<b>Texto</b>',status:'PENDING'}],indicators:[{id:'m1',year:2026,name:'Indicador 1'}]});
 assert.match(html,/Meus pontos FD/);assert.match(html,/Reconheço este indicador/);assert.match(html,/Aprovar/);assert.doesNotMatch(html,/<b>Texto<\/b>/);assert.match(html,/&lt;b&gt;Texto&lt;\/b&gt;/);
});
