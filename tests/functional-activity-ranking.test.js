import test from 'node:test';
import assert from 'node:assert/strict';
import {loadActivityRanking, renderActivityRanking} from '../src/functional-activity-ranking.js';

test('ranks confirmed activities per person and edition across resends and archive pages', async () => {
  const survey = {id:'professional',kind:'SURVEY',cycle:'2026',title:'Cadastro'};
  const training = {id:'t',kind:'TRAINING',version:1,title:'Treinamento'};
  const messages = [survey, survey, training];
  const people = [
    {uid:'a',displayName:'Ana',memberCategories:['RESIDENTE_1']},
    {uid:'b',displayName:'Bia',institutionalGroup:'substitute'},
    {uid:'c',displayName:'Caio',institutionalGroup:'team'}
  ];
  const request = async (action,input) => {
    if(action==='DIRECTORY') return {items:people};
    if(action==='SENT_MESSAGES') {
      const ids=input.cursor?[1,2]:[0];
      return {items:ids.map(i=>({id:String(i),activity:messages[i]})),cursor:input.cursor?null:'archive:5'};
    }
    assert.equal(action,'SENT_DETAIL');
    return {message:{activity:messages[input.id]},recipients:[
      {uid:'a',status:'COMPLETED',completedAt:1},{uid:'b',status:'PENDING',readAt:1},{uid:'c',status:'COMPLETED',completedAt:1}
    ]};
  };
  const rows=await loadActivityRanking(request,()=>true);
  assert.deepEqual(rows.map(p=>[p.name,p.activities.size]),[['Ana',2],['Bia',0]]);
  assert.match(renderActivityRanking(rows),/2 pontos/);
});
