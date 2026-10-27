import test from 'node:test';import assert from 'node:assert/strict';
import {renderStressReport} from '../climate/stress-report-view.js';import {aggregate} from '../stress-domain/aggregate.js';import {QUESTIONS} from '../stress-domain/schema.js';
class Element{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.own='';}set textContent(t){this.own=t;}get textContent(){return this.own+this.children.map(c=>typeof c==='string'?c:c.textContent).join('');}append(...c){this.children.push(...c);}setAttribute(k,v){this[k]=v;}}
const document={createElement:tag=>new Element(tag)};
test('dashboard displays general chart + four group cards, opportunities and no protected hidden scores',()=>{
 const rows=[...Array.from({length:10},()=>({group:'team'})),...Array.from({length:6},()=>({group:'resident'})),...Array.from({length:5},()=>({group:'substitute'})),...Array.from({length:2},()=>({group:'secretaries'}))].map(r=>({...r,survey_cycle:'2026',survey_version:'1.0',answers:Object.fromEntries(QUESTIONS.map(q=>[q.id,3]))}));
 const report=aggregate(rows),view=renderStressReport(document,report),cards=view.children.filter(c=>c.dataset?.stressGroup);
 assert.deepEqual(cards.map(c=>c.dataset.stressGroup),['team','resident','secretaries','substitute']);assert.match(view.textContent,/Resultado geral/);assert.match(view.textContent,/Comparação das médias/);assert.match(view.textContent,/Oportunidades de melhoria/);assert.doesNotMatch(cards[2].textContent,/Pontuação média|respondentes|envios válidos/);assert.doesNotMatch(cards[3].textContent,/Pontuação média/);
 assert.ok(view.children.some(c=>c.tag==='section'));
});
