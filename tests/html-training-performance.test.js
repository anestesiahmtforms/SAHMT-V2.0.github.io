import test from 'node:test';
import assert from 'node:assert/strict';
import {trainingScoreView,renderTrainingScore} from '../src/html-training-performance.js';
test('training performance preserves zero and rejects inconsistent or foreign totals',()=>{
 const score={uid:'u',acknowledgement:0,test:0,suggestion:0,total:0,version:0};
 assert.equal(trainingScoreView({score,trainings:[]},'u').confirmed,true);
 assert.equal(trainingScoreView({score,trainings:[]},'u').total,0);
 assert.equal(trainingScoreView({score:{...score,test:3,total:4}},'u').confirmed,false);
 assert.equal(trainingScoreView({score:{...score,uid:'other'}},'u').confirmed,false);
 assert.equal(trainingScoreView(null,'u').confirmed,false);
});
test('training score output escapes titles and separates manual suggestion points',()=>{
 const payload={score:{uid:'u',acknowledgement:1,test:5,suggestion:2,total:8,version:3},trainings:[{trainingId:'t',title:'<img src=x onerror=alert(1)>',acknowledgement:1,test:5,suggestion:2,total:8}]};
 const html=renderTrainingScore(payload,'u');assert.ok(html.includes('8 pontos'));assert.ok(html.includes('&lt;img'));assert.equal(html.includes('<img'),false);assert.ok(html.includes('Sugestões'));assert.ok(html.includes('Maior nota'));
});
