import test from 'node:test';import assert from 'node:assert/strict';
import {renderReport} from '../climate/report-view.js';
import {aggregate} from '../climate-domain/aggregate.js';import {COMMON} from '../climate-domain/schema.js';
class Element{constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.ownText='';}set textContent(t){this.ownText=t;}get textContent(){return this.ownText+this.children.map(c=>typeof c==='string'?c:c.textContent).join('');}append(...children){this.children.push(...children);}}
const document={createElement:tag=>new Element(tag),createTextNode:value=>value};
test('dashboard renders three active categories and never secretary or pooled scores',()=>{
 const rows=['resident','team'].flatMap(group=>Array.from({length:5},()=>({group,answers:Object.fromEntries(COMMON.map(q=>[q.id,group==='resident'?5:1]))})));
 const data=aggregate(rows);data.general={favorable:777};data.groups.secretaries={general:{favorable:999},suppressed:false};
 const view=renderReport(document,data),cards=view.children.filter(child=>child?.dataset?.resultGroup);
 assert.deepEqual(cards.map(c=>c.dataset.resultGroup),['team','resident','substitute']);assert.match(cards[1].textContent,/100%/);assert.match(cards[0].textContent,/0%/);assert.doesNotMatch(cards[2].textContent,/%/);assert.doesNotMatch(view.textContent,/777|999/);
 assert.doesNotMatch(view.textContent,/Secretárias|duas secretárias/);assert.match(view.textContent,/Adesão: Não divulgada/);
});
test('older ungrouped snapshots are not displayed as grouped or pooled scores',()=>{
 const view=renderReport(document,{survey_cycle:'old',general:{favorable:777}});assert.doesNotMatch(view.textContent,/777/);assert.match(view.textContent,/não possui classificação por grupo/);
});
