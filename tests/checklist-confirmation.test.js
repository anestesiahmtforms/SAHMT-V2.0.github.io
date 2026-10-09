import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getChecklistDayResponsible} from '../src/checklist-responsibility-reader.js';

const day = '2026-09-22';
const contacts = [
 {sigla:'AD',name:'Ana Dias',active:true}, {sigla:'CR',name:'Caio Ramos',active:true},
 {sigla:'LH',name:'Lia Horta',active:true}, {sigla:'MG',name:'Marta Gomes',active:true}
];
function sources(overrides = {}) {
 return {
  readSchedule: async () => ({positions:['AD','CR','LH','MG']}),
  listVacationsForDate: async () => [],
  listContactCatalog: async () => contacts,
  listEventRecords: async () => ({records:[],nextCursor:null,stale:false}),
  remotePreview: async () => ({responsible:{name:'Ana Dias',uid:'u-ad'}}),
  ...overrides
 };
}
test('nome segue posição 1 e pula férias e substituições até a próxima posição', async () => {
 const a = await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources());
 assert.equal(a.name,'Ana Dias'); assert.equal(a.position,1);
 const b = await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listVacationsForDate: async () => [{active:true,start:day,end:day,siglas:['AD']}],
  listEventRecords: async () => ({records:[{date:day,active:true,eventType:'Pessoal',memberStatus:'Caio Ramos',substitute:'Lia Horta'}],nextCursor:null})
 }));
 assert.equal(b.name,'Lia Horta'); assert.equal(b.position,3);
 const c = await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listVacationsForDate: async () => [{active:true,start:day,end:day,siglas:['AD','CR']}],
  listEventRecords: async () => ({records:[{date:day,active:true,eventType:'Outros',memberStatus:'Lia Horta',substitute:'Marta Gomes'}],nextCursor:null})
 }));
 assert.equal(c.name,'Marta Gomes'); assert.equal(c.position,4);
});
test('confere todas as páginas de eventos e não usa operações locais pendentes', async () => {
 const calls=[];
 const result=await getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listEventRecords: async (input) => {
   calls.push(input);
   return input.cursor ? {records:[{date:day,active:true,eventType:'Pessoal',memberStatus:'Ana Dias',substitute:'Caio Ramos'}],nextCursor:null}
    : {records:[],nextCursor:'next'};
  }
 }));
 assert.equal(result.name,'Caio Ramos');assert.equal(calls.length,2);
 assert.equal(calls[0].includePending,false);
});
test('não administradores usam consulta autorizada sem tentar ler todos os eventos', async () => {
 const result=await getChecklistDayResponsible({day,uid:'eligible'},sources({
  readSchedule: async () => {throw new Error('Não deve consultar como admin');},
  listEventRecords: async () => {throw new Error('Não deve consultar como admin');}
 }));
 assert.equal(result.name,'Ana Dias');
});
test('não inventa responsável quando escala ou eventos estão incompletos/sem conexão', async () => {
 await assert.rejects(getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  readSchedule: async () => ({positions:['AD'],stale:true})
 })),/online/);
 await assert.rejects(getChecklistDayResponsible({day,uid:'admin',isAdmin:true},sources({
  listEventRecords: async () => ({records:[],stale:true})
 })),/online/);
 await assert.rejects(getChecklistDayResponsible({day,uid:'eligible'},sources({
  remotePreview: async () => ({responsible:null})
 })),/não confirmado/);
});
test('rodapé separa rodízio da escala do botão de confirmação, e revisão fica em modal separado', () => {
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const footer=source.match(/<footer class="checklist-confirmation-footer">([\s\S]*?)<\/footer>/)?.[1];
 assert.ok(footer);
 assert.equal((footer.match(/<button\b/g)||[]).length,1);
 assert.match(footer,/<div class="checklist-rotation-summary"><span>Rodízio da escala<\/span><strong id="checklist-rotation-name"[^>]*>[^<]*<\/strong><\/div><button\b[^>]*id="checklist-signature-prepare"[^>]*><span>Confirmação do Checklist<\/span><\/button>/);
 assert.doesNotMatch(footer,/checklist-signature-status|checklist-signature-preview|Revisar e assinar|Assinatura do responsável/);
 assert.match(source,/confirmationDialog\.showModal\(\)/);
 assert.match(source,/if \(scope\.isAdmin\)/);
 assert.match(source,/watchChecklistResponsibility\(scope, acceptResponsibility/);
 assert.match(source,/getChecklistDayResponsible\(scope\)/);
 assert.match(source,/checklistSignatureCurrent\(scope,/);
 assert.match(source,/checklistResponsibilityLive\?\.confirmed === true/);
});

test('relatório diário tem Voltar no final do modal, sem botão de fechar no cabeçalho', () => {
 const source=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
 const dialog=source.slice(source.indexOf('const checklistReportDialog ='),source.indexOf('  const labelReport =',source.indexOf('const checklistReportDialog =')));
 const header=dialog.match(/<header class="checklist-report-dialog__header">([\s\S]*?)<\/header>/)?.[1];
 assert.ok(header);
 assert.doesNotMatch(header,/<button/);
 assert.match(dialog,/<footer class="checklist-report-footer"><form method="dialog"><button class="secondary-button" type="submit">Voltar<\/button><\/form><\/footer><\/dialog>/);
 assert.ok(dialog.indexOf('class="checklist-report-footer"') > dialog.indexOf('class="module-content checklist-report-content"'));
});
