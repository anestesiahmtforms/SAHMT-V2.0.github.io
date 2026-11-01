import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {monthlyChart} from '../src/qmentum-charts.js';

const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
const hasClass=(node,name)=>(attr(node,'class')||'').split(/\s+/).includes(name);
const findAll=(node,predicate)=>[...(predicate(node)?[node]:[]),...(node.childNodes||[]).flatMap(child=>findAll(child,predicate))];
const text=node=>node.nodeName==='#text'?node.value:(node.childNodes||[]).map(text).join('');
const render=(series,options)=>parseFragment(monthlyChart(series,options));
const rows=tree=>findAll(tree,node=>hasClass(node,'qm-monthly-row'));
const result=(patch={})=>({ratio:.25,N:1,D:4,status:'VALID',sourceMode:'COUNTS',definitionVersion:3,target:.9,...patch});

test('barras mensais apresentam os 12 meses em ordem com percentuais HTML legíveis',()=>{
 const tree=render([{month:3,result:result({ratio:1})},{month:1,result:result({ratio:0,N:0})},{month:2,result:result({ratio:.123456})}]);
 const monthlyRows=rows(tree);
 assert.equal(monthlyRows.length,12);
 assert.deepEqual(monthlyRows.map(row=>text(findAll(row,node=>hasClass(node,'qm-monthly-month'))[0])),['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']);
 assert.deepEqual(monthlyRows.slice(0,3).map(row=>text(findAll(row,node=>hasClass(node,'qm-monthly-value'))[0])),['0,00%','12,3456%','100,00%']);
 assert.equal(findAll(tree,node=>node.tagName==='svg').length,0);
 assert.equal(findAll(tree,node=>node.tagName==='ol').length,1);
 assert.equal(findAll(monthlyRows[1],node=>hasClass(node,'qm-monthly-fill')).map(node=>attr(node,'style')).join(''),'width:12.3456%');
});

test('zero conserva uma barra de largura zero e ausência continua sem barra nem percentual inventado',()=>{
 const tree=render([{month:1,result:result({ratio:0,N:0})},{month:2,result:null},{month:3,result:result({ratio:null,N:null,D:null,status:'PENDING'})}]);
 const [zero,absent,pending]=rows(tree);
 assert.ok(zero);
 assert.equal(attr(findAll(zero,node=>hasClass(node,'qm-monthly-fill'))[0],'style'),'width:0%');
 for(const row of [absent,pending]){
  assert.equal(findAll(row,node=>hasClass(node,'qm-monthly-fill')).length,0);
  assert.equal(text(findAll(row,node=>hasClass(node,'qm-monthly-value'))[0]),'—');
  assert.match(text(row),/Sem resultado/);
 }
 assert.match(text(pending),/Dados pendentes/);
 assert.equal(findAll(tree,node=>attr(node,'role')==='img').length,0);
 assert.ok(findAll(tree,node=>hasClass(node,'qm-monthly-legend')).some(node=>/Sem resultado/.test(text(node))));
});

test('estado informado ou provisório permanece visível e a tabela mantém a proveniência de cada mês',()=>{
 const tree=render([{month:1,result:result({status:'INFORMED',sourceMode:'INFORMED',N:null,D:null,definitionVersion:7})},{month:2,result:result({status:'PROVISIONAL',definitionVersion:8})}]);
 const monthlyRows=rows(tree);
 assert.equal(monthlyRows.length,12);
 assert.match(text(monthlyRows[0]),/Taxa informada \(sem contagens\)/);
 assert.match(text(monthlyRows[1]),/Definição pendente/);
 assert.ok(hasClass(monthlyRows[0],'qm-monthly-row--unreviewed'));
 assert.ok(hasClass(monthlyRows[1],'qm-monthly-row--unreviewed'));
 const table=findAll(tree,node=>node.tagName==='table')[0];
 const head=findAll(table,node=>node.tagName==='thead')[0];
 assert.deepEqual(findAll(head,node=>node.tagName==='th').map(text),['Mês','Resultado','N / D','Estado','Fonte','Definição','Meta']);
 const body=findAll(table,node=>node.tagName==='tbody')[0];
 assert.deepEqual(findAll(findAll(body,node=>node.tagName==='tr')[0],node=>node.tagName==='td'||node.tagName==='th').map(text),['Jan','25,00%','— / —','Taxa informada (sem contagens)','INFORMED','7','90,00%']);
 assert.equal(findAll(body,node=>node.tagName==='tr').length,12);
});

test('meta aparece em texto acessível e como marcador visual sem criar uma meta quando ausente',()=>{
 const tree=render([{month:1,result:result()}],{title:'Resultados mensais',target:.9});
 const targetLabel=findAll(tree,node=>hasClass(node,'qm-monthly-target'))[0];
 assert.ok(targetLabel);
 assert.equal(text(targetLabel),'Meta: 90,00%');
 assert.equal(findAll(tree,node=>hasClass(node,'qm-monthly-target-marker')).length,12);
 assert.equal(attr(findAll(tree,node=>hasClass(node,'qm-monthly-target-marker'))[0],'style'),'left:90%');
 assert.ok(findAll(tree,node=>hasClass(node,'qm-monthly-rail')).every(node=>attr(node,'aria-hidden')==='true'));
 const noTarget=render([]);
 assert.equal(findAll(noTarget,node=>hasClass(node,'qm-monthly-target')).length,0);
 assert.equal(findAll(noTarget,node=>hasClass(node,'qm-monthly-target-marker')).length,0);
});

test('título e proveniência são texto escapado e não podem inserir elementos HTML',()=>{
 const tree=render([{month:1,result:result({sourceMode:'<img src=x onerror=alert(1)>',definitionVersion:'<script>x</script>'})}],{title:'Mensal <img src=x>'});
 assert.equal(text(findAll(tree,node=>node.tagName==='figcaption')[0]),'Mensal <img src=x>');
 assert.equal(findAll(tree,node=>node.tagName==='img'||node.tagName==='script').length,0);
 assert.match(text(tree),/<script>x<\/script>/);
});
