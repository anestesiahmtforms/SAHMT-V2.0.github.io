import test from 'node:test';import assert from 'node:assert/strict';
import {faPerformanceMarkup} from '../src/fa-performance-ui.js';
test('FA renders negative balances, administrator selector, bounded audit and automatic edit explanation',()=>{
 const html=faPerformanceMarkup({summary:{uid:'a',total:-.5},team:[{uid:'a',displayName:'<script>'}],awards:[],ledger:[],reference:{maxPerformance:0},effectiveFrom:'2026-11-02T12:00:00Z'});
 assert.match(html,/-0,5/);assert.match(html,/&lt;script&gt;/);assert.match(html,/data-fa-subject/);assert.match(html,/15 minutos/);assert.doesNotMatch(html,/<script>/);
});
