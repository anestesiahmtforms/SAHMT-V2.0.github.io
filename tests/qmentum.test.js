import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {QMENTUM_IDS,QMENTUM_INDICATORS,COUNT_KEYS,emptyInputs,initialDefinitions} from '../src/qmentum-catalog.js';
import {calculateMonth,calculateIndicator,validateInputs,validateDefinitions,aggregateResults,monthlySeries,productionTotals,canClose,compareResults,periodKey} from '../src/qmentum-engine.js';
import {parseQmentumWorkbook,prepareQmentumImport,reconcileImport,fileHash,sourceRatio} from '../src/qmentum-import.js';
import {transitionMonth,createDraftStore,createQmentumRepository} from '../src/qmentum-data.js';
import {monthlyChart,performanceChart,exportQmentumCsv} from '../src/qmentum-charts.js';
import {analysisFor} from '../src/qmentum-references.js';
const approved=()=>{const d=initialDefinitions();Object.values(d.items).forEach(x=>{x.approved=true;x.criterion='Critério sintético aprovado';});return d;};
const calc=(id,counts={},patch={},defs=approved())=>calculateMonth({...emptyInputs(),...patch,counts:{...emptyInputs().counts,...counts}},defs)[id];
test('catálogo contém exatamente os 18 IDs e exclui linhas fora do escopo',()=>{assert.equal(QMENTUM_IDS.length,18);assert.equal(new Set(QMENTUM_IDS).size,18);assert.equal(QMENTUM_IDS.at(-1),'QM18');assert.equal(QMENTUM_INDICATORS.some(d=>/Folha de sala|Cancelamento|Suspensão/.test(d.name)),false);});
for(const d of QMENTUM_INDICATORS)test(`${d.id}: fórmula, zero, vazio, N>D e sem casos`,()=>{
 const patch={uniqueEventProceduresConfirmed:true,attribution48:true,attribution30:true};const counts={[d.numerator]:2,[d.denominator]:10,followed48:10,pending48:0,followed30:10,pending30:0};
 assert.equal(calc(d.id,counts,patch).ratio,d.rule==='complement'?.8:.2);
 assert.equal(calc(d.id,{...counts,[d.numerator]:0},patch).ratio,d.rule==='complement'?1:0);
 assert.equal(calc(d.id,{...counts,[d.numerator]:null},patch).ratio,null);
 assert.equal(calc(d.id,{...counts,[d.numerator]:11},patch).status,'INCONSISTENT');
 assert.equal(calc(d.id,{[d.numerator]:0,[d.denominator]:0},patch).ratio,null);
 assert.equal(calc(d.id,{[d.numerator]:0,[d.denominator]:0},patch).status,'NOT_APPLICABLE');
});
test('conferências históricas janeiro, abril e maio não inventam ano',()=>{
 const c={general:596,sedation:1186,regional:237,spinal:349,epidural:23,local:72,support:10};assert.deepEqual(productionTotals(c),{anestheticTotal:2473,legacyBlocks:332});
 assert.equal(calc('QM01',{techniqueChanges:2,surgical:1792}).ratio,2/1792);assert.equal(calc('QM02',{difficultAirway:9,general:596}).ratio,9/596);
 assert.equal(calc('QM03',{effectiveToxicity:2,toxicity:2}).ratio,1);assert.equal(calc('QM03',{effectiveToxicity:0,toxicity:0}).ratio,null);
 assert.equal(calc('QM11',{headache:1,spinal:364}).ratio,1-1/364);
});
test('seguimento pendente não vira mortalidade zero',()=>{assert.equal(calc('QM15',{deaths48:0,eligible48:10,followed48:8,pending48:2},{attribution48:true}).status,'FOLLOWUP_PENDING');assert.equal(calc('QM16',{deaths30:0,eligible30:10,followed30:9,pending30:0},{attribution30:true}).status,'INCONSISTENT');});
test('QM14 exige procedimentos únicos e não usa episódios',()=>{assert.equal(calc('QM14',{eventEpisodes:14,surgical:1792}).ratio,null);assert.equal(calc('QM14',{eventProcedures:14,surgical:1792}).ratio,null);});
test('definição não aprovada e taxa apenas informada ficam identificadas',()=>{assert.equal(calc('QM01',{techniqueChanges:1,surgical:10},{},initialDefinitions()).status,'PROVISIONAL');const input=emptyInputs();input.informedRates.QM12=.9974;assert.equal(calculateMonth(input,approved()).QM12.status,'INFORMED');});
test('ponderação soma N/D, rejeita faltantes, taxas informadas e versões distintas',()=>{const a=calc('QM01',{techniqueChanges:1,surgical:10}),b=calc('QM01',{techniqueChanges:1,surgical:100});assert.equal(aggregateResults([a,b]).ratio,2/110);assert.equal(aggregateResults([a,{...b,definitionVersion:2}]).ratio,null);assert.equal(aggregateResults([a,{...b,sourceMode:'INFORMED'}]).ratio,null);assert.equal(aggregateResults([a,{indicatorId:'QM01',status:'PENDING'}]).ratio,null);});
test('campos negativos, frações, NaN, campos extras e estados inconsistentes são rejeitados',()=>{for(const value of [-1,.5,NaN,10000001]){const i=emptyInputs();i.counts.surgical=value;assert.throws(()=>validateInputs(i));}const i=emptyInputs();i.counts.extra=1;assert.throws(()=>validateInputs(i));const j=emptyInputs();j.notApplicable=['surgical'];j.counts.surgical=0;assert.throws(()=>validateInputs(j));});
test('fechamento, reabertura e atualização de definição exigem estado/perfil/motivo',()=>{const r=calculateMonth(emptyInputs(),approved());assert.equal(canClose(r),false);assert.throws(()=>transitionMonth({status:'REVIEWED'},'CLOSE','reviewer','',r));assert.throws(()=>transitionMonth({status:'CLOSED'},'SAVE','manager','',r));assert.throws(()=>transitionMonth({status:'CLOSED'},'REOPEN','collector','Motivo válido',r));assert.equal(transitionMonth({status:'CLOSED'},'REOPEN','manager','Motivo válido',r),'DRAFT');assert.throws(()=>transitionMonth({status:'DRAFT'},'REBASE','collector','Motivo válido',r));});
test('rascunhos separados por usuário, unidade e competência',()=>{const m=new Map(),store=createDraftStore({getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}),scope={uid:'synthetic',unitId:'unit-a',period:'2025-01'};store.save(scope,{baseVersion:1});assert.equal(store.read(scope).baseVersion,1);assert.equal(store.read({...scope,uid:'other'}),null);assert.equal(store.read({...scope,unitId:'unit-b'}),null);store.remove(scope);assert.equal(store.read(scope),null);});
test('repositório permite somente FC, rejeita FA/FB antes da leitura e impede troca de sessão',async()=>{
 let reads=0;const fake={doc:(_db,collection,id)=>({collection,id}),getDocFromServer:async()=>{reads++;return{exists:()=>false};}};
 for(const projectId of ['sahmt-17a16','sahmt-gestao-5ae66']){const app={options:{projectId}};await assert.rejects(createQmentumRepository({db:{app},auth:{app,currentUser:{uid:'x'}},uid:'x',firestore:fake}).open(),/QMENTUM_FC_REQUIRED/);}
 assert.equal(reads,0);const app={options:{projectId:'indicadores---sahmt'}},auth={app,currentUser:{uid:'x'},};auth.currentUser.getIdTokenResult=async()=>({claims:{aud:'indicadores---sahmt',iss:'https://securetoken.google.com/indicadores---sahmt',sub:'x'}});
 await assert.rejects(createQmentumRepository({db:{app},auth,uid:'x',firestore:fake}).open(),/QMENTUM_PERMISSION_DENIED/);assert.equal(reads,1);
 await assert.rejects(createQmentumRepository({db:{app},auth:{app,currentUser:{uid:'other'}},uid:'x',firestore:fake}).open(),/QMENTUM_SESSION_CHANGED/);
});
test('calendário não cria outra competência ao selecionar outro dia',()=>{assert.equal(periodKey(2025,1),'2025-01');assert.throws(()=>periodKey(2025,13));assert.throws(()=>periodKey(null,1));});
test('gráficos mantêm lacunas, sem meta fictícia; análise contém só dois parágrafos',()=>{const r=calc('QM01',{techniqueChanges:1,surgical:100});const series=monthlySeries([{year:2025,month:1,results:{QM01:r}}],'QM01',2025);assert.equal(series.length,12);assert.equal(series[1].result,null);assert.equal((monthlyChart(series).match(/<circle/g)||[]).length,1);assert.match(performanceChart(r,null),/Sem comparação válida/);assert.equal(compareResults(r,{...r,definitionVersion:2}),null);assert.equal(analysisFor(r).paragraphs.length,2);assert.ok(analysisFor(r).references[0].url.startsWith('https://'));});
test('metas iniciais são apenas as duas da planilha e não validadas',()=>{const d=initialDefinitions();validateDefinitions(d);assert.deepEqual(Object.entries(d.items).filter(([,x])=>x.target!==null).map(([id])=>id),['QM17','QM18']);assert.equal(d.items.QM17.targetValidated,false);});

export function syntheticWorkbook(extra='') {
 const names=['ANESTESIAS','TAXA ','OUTROS INDICADORES'],files={};
 files['xl/workbook.xml']=strToU8(`<workbook><sheets>${names.map((name,i)=>`<sheet name="${name}" r:id="r${i}"/>`).join('')}</sheets></workbook>`);
 files['xl/_rels/workbook.xml.rels']=strToU8(`<Relationships>${names.map((_,i)=>`<Relationship Id="r${i}" Target="worksheets/sheet${i}.xml"/>`).join('')}</Relationships>`);
 files['xl/worksheets/sheet0.xml']=strToU8('<worksheet><sheetData><row><c r="D20"><v>1792</v></c><c r="D24"><v>0</v></c></row></sheetData></worksheet>');
 files['xl/worksheets/sheet1.xml']=strToU8(`<worksheet><sheetData><row><c r="D4"><v>2</v></c><c r="D6"><v>0</v></c><c r="D20" t="str"><f>IFERROR(D6/ANESTESIAS!D24,"100,00%")</f><v>100,00%</v></c><c r="H28"><f t="shared" si="1" ref="H28:I28">1-H14/ANESTESIAS!H14</f><v>0.99725274725275</v></c><c r="I28"><f t="shared" si="1"/><v>1</v></c>${extra}</row></sheetData></worksheet>`);
 files['xl/worksheets/sheet2.xml']=strToU8('<worksheet><sheetData><row><c r="F3"><v>0.9974</v></c><c r="L3" t="str"><f>0/0</f><v>#DIV/0!</v></c><c r="F10"><v>0.99</v></c><c r="F11"><v>0.05</v></c></row></sheetData></worksheet>');return zipSync(files);
}
test('XLSX preserva fórmula, cache textual, erro, compartilhamento e células excluídas só no backup',async()=>{const bytes=syntheticWorkbook(),book=parseQmentumWorkbook(bytes),hash=await fileHash(bytes),p=prepareQmentumImport(book,{hash});assert.equal(p.year,null);assert.equal(p.unitId,null);assert.equal(p.months[6].hasInput,false);assert.equal(book.sheets['TAXA '].cells.I28.formula.sharedBase.address,'H28');assert.equal(book.sheets['OUTROS INDICADORES'].cells.L3.kind,'ERROR');assert.equal(p.months[0].inputs.legacyRates.QM03.value,1);assert.equal(p.months[0].results.QM03.ratio,null);assert.equal(p.months[0].results.QM12.sourceMode,'INFORMED');assert.equal(p.months[0].cells.some(c=>c.sheet==='OUTROS INDICADORES'&&['F10','F11'].includes(c.address)),false);assert.equal(book.sheets['OUTROS INDICADORES'].cells.F10.value,.99);assert.equal(book.sheets['TAXA '].cells.D20.cachedValue,'100,00%');});
test('reimportação idempotente e dados manuais nunca sobrescritos',async()=>{const b=syntheticWorkbook(),p=prepareQmentumImport(parseQmentumWorkbook(b),{hash:await fileHash(b),unitId:'unit-a',year:2025});assert.equal(reconcileImport(p)[0].status,'CREATE');assert.equal(reconcileImport(p,[{year:2025,month:1,version:1,importHash:p.hash}])[0].status,'ALREADY_IMPORTED');assert.equal(reconcileImport(p,[{year:2025,month:1,version:1,importHash:null}])[0].status,'CONFLICT');});
test('não executa fórmulas nem aceita entidade XML, macro, arquivo enorme ou taxa >100%',()=>{assert.throws(()=>parseQmentumWorkbook(new Uint8Array(6*1024*1024)));assert.throws(()=>parseQmentumWorkbook(zipSync({'xl/vbaProject.bin':strToU8('macro')})));assert.throws(()=>parseQmentumWorkbook(syntheticWorkbook('<!ENTITY evil "value">')));assert.equal(sourceRatio({kind:'TEXT_RATE',value:'100,00%'}),1);assert.equal(sourceRatio({kind:'TEXT_RATE',value:'120%'}),null);});
test('CSV neutraliza fórmula em nome e mantém 18 indicadores com proveniência',()=>{const data={year:2025,month:1,version:1,inputs:emptyInputs(),results:calculateMonth(emptyInputs(),approved())};const csv=exportQmentumCsv([data],'=synthetic');assert.equal(csv.split('\r\n').length,19);assert.ok(csv.includes("'=synthetic"));});
