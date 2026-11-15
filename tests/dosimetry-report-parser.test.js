import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDosimetryReport} from '../src/dosimetry-report-parser.js';

const item=(str,x,y,w=12,extra={})=>({str,x,y,w,h:7,...extra});
function fixture(){return [item('RELATÓRIO DE DOSES NO ANO DE 2025 - Hp(10)',100,750),item('Impresso em: 23/01/2026',30,720),item('Cód.',39,650),item('Nome',65,650),item('monitor',170,642),item('Nro.',518,654),item('3',518,628),...['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'].map((s,i)=>item(s,202+i*26,650)),item('001',39,628),item('PESSOA',65,632),item('SINTÉTICA',65,624),item('28',170,628),item('ANR',202,628),item('0,2',228,628),item('ND',254,628)];}
test('year comes from report title; wraps names; preserves decimal and missing cells',()=>{
 const report=parseDosimetryReport([fixture()]);assert.equal(report.year,2025);assert.equal(report.issuedOn,'2026-01-23');assert.equal(report.rows[0].name,'PESSOA SINTÉTICA');assert.deepEqual(report.rows[0].values,['ANR','0,2','ND',...Array(9).fill(null)]);
});
test('ignores legend-only pages',()=>assert.equal(parseDosimetryReport([fixture(),[item('ANR = LEITURA ABAIXO DO NÍVEL DE REGISTRO',20,400)]]).rows.length,1));
test('rejects invalid and ambiguous values rather than converting to zero',()=>{
 assert.throws(()=>parseDosimetryReport([[...fixture(),item('QNR',280,628)]]),/valor não reconhecido/);
 assert.throws(()=>parseDosimetryReport([[...fixture(),item('0,1',202,628)]]),/mais de um valor/);
});
test('rejects incomplete headers, unsupported monitor, duplicate identifiers and uncertain OCR',()=>{
 assert.throws(()=>parseDosimetryReport([fixture().filter(i=>i.str!=='Dez')]),/cabeçalho/);
 assert.throws(()=>parseDosimetryReport([fixture().map(i=>i.str==='28'?{...i,str:'29'}:i)]),/monitor/);
 assert.throws(()=>parseDosimetryReport([fixture(),fixture()]),/repetido/);
 assert.throws(()=>parseDosimetryReport([fixture().map(i=>i.str==='ANR'?{...i,confidence:40}:i)]),/incerta/);
});
test('tolerates coordinate translation and scaling',()=>{
 const data=fixture().map(i=>({...i,x:i.x*1.1+10,w:i.w*1.1,y:i.y+20}));assert.equal(parseDosimetryReport([data]).rows.length,1);
});
test('keeps an internal blank and checks declared number of measured months',()=>{
 const data=fixture().filter(i=>i.str!=='0,2').map(i=>i.x===518&&i.str==='3'?{...i,str:'2'}:i);
 assert.deepEqual(parseDosimetryReport([data]).rows[0].values.slice(0,3),['ANR',null,'ND']);
 assert.throws(()=>parseDosimetryReport([data.map(i=>i.x===518&&i.str==='2'?{...i,str:'3'}:i)]),/quantidade de meses/);
});
test('extracts all thirty synthetic rows without mixing adjacent wrapped names',()=>{
 const data=fixture(),headers=data.filter(i=>i.y>640),body=data.filter(i=>i.y<640);
 const rows=Array.from({length:30},(_,r)=>body.map(i=>({...i,y:i.y-r*18,str:i.str==='001'?String(r+1).padStart(3,'0'):i.str}))).flat();
 const report=parseDosimetryReport([[...headers,...rows]]);assert.equal(report.rows.length,30);assert.equal(report.rows[29].code,'030');assert.ok(report.rows.every(r=>r.name==='PESSOA SINTÉTICA'));
});

