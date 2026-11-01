import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyInputs} from '../src/qmentum-catalog.js';
import {parseTechniquePrint,parseIndicatorPrint,preparePrintPreview,reconcilePrintImport} from '../src/qmentum-print-import.js';

test('numbered labels from the institutional event panel map by meaning and report code',()=>{
 const text='FILTROS\nPeríodo (Data registro)\nTotal de registros: 300\n01 - Mudança técnica anestésica: 1\n02 - Via aérea difícil: 2\n03 - Evento de Intoxicação: 3\n04 - Transferência UTI: 4\n05 - Episódios de náusea ou vômitos: 5\n06 - Dor aguda: 6\n7A - Paciente com DM ou hiperglicêmico: 40\n7B - Evento de hipoglicemia: 7\n08 - Evento de hipotermia: 8\n09 - Evento PCR: 9';
 const {counts}=parseIndicatorPrint(text);assert.deepEqual(counts,{techniqueChanges:1,difficultAirway:2,toxicity:3,unplannedIcu:4,ponv:5,acutePain:6,diabetes:40,hypoglycemia:7,hypothermia:8,cardiacArrest:9});
 assert.throws(()=>parseIndicatorPrint('03 - Via aérea difícil: 2\nTotal de registros: 300'),/INDICATOR/);
 const tech=parseTechniquePrint('Técnica anestésica | Quantidade\nGeral + Raquianestesia Analgésica | 3\nTotal geral | 3');assert.equal(tech.counts.spinal,3);assert.equal(tech.anestheticProcedures,6);
});

// Entirely synthetic OCR; none of these values describe clinical records.
const techniques = `Técnica anestésica | Quantidade
Geral + Sedação | 8
Geral + Analgesia Sistêmica | 3
Raquianestesia + Peridural Analgésica | 4
Outra Técnica | 2
Local | 1
Suporte anestésico | 0
Total geral | 18`;
const indicators = `Indicadores
Mudança de técnica anestésica: 1
Via aérea difícil: 2
Intoxicação por anestésicos locais: 0
Encaminhamento à UTI não planejado: 3
Náuseas e vômitos: 4
Dor aguda: 5
DM/hiperglicêmicos: 6
Hipoglicemia: 0
Hipotermia não intencional: 7
Parada cardiorrespiratória: 0
Total de registros: 40`;

test('associations contribute individually and their sum supplies the anesthetic total',()=>{
 const result=parseTechniquePrint(techniques);
 assert.deepEqual(result.counts,{general:11,sedation:10,regional:2,spinal:4,epidural:4,local:1,support:0,anestheticProcedures:32,surgical:18});
 assert.equal(result.anestheticProcedures,32);
 assert.equal(result.tableTotal,18);
 assert.equal(result.rows.length,6);
 assert.deepEqual(result.rows[3],{label:'Outra Técnica',quantity:2,fields:['sedation','regional']});
});

test('a complete table establishes absent techniques as zero including an empty explicit zero table',()=>{
 assert.deepEqual(parseTechniquePrint('Geral: 0\nTotal geral: 0').counts,{general:0,sedation:0,regional:0,spinal:0,epidural:0,local:0,support:0,anestheticProcedures:0,surgical:0});
 assert.equal(parseTechniquePrint('Total geral: 0').anestheticProcedures,0);
 assert.equal(parseTechniquePrint('Sedação\n1.234\nTotal geral\n1.234').counts.sedation,1234);
 assert.equal(parseTechniquePrint('Sedação | 1 234\nTotal geral | 1 234').tableTotal,1234);
});

test('Portuguese aliases normalize without inventing systemic analgesia as a modality',()=>{
 const result=parseTechniquePrint('Anestesia Geral e Analgesia Sistêmica: 2\nRaqui: 3\nPeridural Analgésica: 4\nBloqueio Regional: 5\nTotal geral: 14');
 assert.equal(result.counts.general,2);
 assert.equal(result.counts.spinal,3);
 assert.equal(result.counts.epidural,4);
 assert.equal(result.counts.regional,5);
 assert.equal(result.counts.sedation,0);
});

test('unknown, ambiguous, duplicate, incomplete and mismatching technique rows are rejected',()=>{
 for(const text of [
  'Técnica desconhecida: 2\nTotal geral: 2',
  'Geral Sedação 2\nTotal geral: 2',
  'Geral\nSedação\n2\n3\nTotal geral: 5',
  'Geral: 1 2\nTotal geral: 12',
  'Geral: 2\nAnestesia geral: 3\nTotal geral: 5',
  'Geral: 2\nSedação\nTotal geral: 2',
  'Geral: 2\nTotal geral: 3',
  'Geral: 2',
  'Analgesia Sistêmica: 2\nTotal geral: 2',
  'Geral + Geral: 2\nTotal geral: 2',
  'Geral: 0,5\nTotal geral: 0,5',
  'Geral: -1\nTotal geral: -1',
  'Geral: 2\nTotal geral: 2\nTotal geral: 2'
 ])assert.throws(()=>parseTechniquePrint(text),/QMENTUM_PRINT_/);
});

test('event panel maps counts without claiming effective management, control, headache or unique procedures',()=>{
 assert.deepEqual(parseIndicatorPrint(indicators).counts,{techniqueChanges:1,difficultAirway:2,toxicity:0,unplannedIcu:3,ponv:4,acutePain:5,diabetes:6,hypoglycemia:0,hypothermia:7,cardiacArrest:0});
 const result=parseIndicatorPrint('DM: 0\nPCR: 0\nTotal de registros: 2.345');
 assert.deepEqual(result.counts,{diabetes:0,cardiacArrest:0});
});

test('event OCR rejects mixed or unknown rows and duplicate aliases rather than pairing columns',()=>{
 for(const text of ['Dor aguda\nHipotermia\n1\n2','Dor aguda: 1\nEvento não reconhecido: 0','DM: 1\nDiabéticos/hiperglicêmicos: 2','Hipotermia: 1 2','Hipoglicemia:','Total de registros: 1\nTotal de registros: 1'])assert.throws(()=>parseIndicatorPrint(text),/QMENTUM_PRINT_/);
 assert.deepEqual(parseIndicatorPrint('DM\n0\nTotal de registros\n0').counts,{diabetes:0});
});

test('preview validates explicit period scope and keeps independent totals and missing outcomes visible',()=>{
 const result=preparePrintPreview({period:'2026-07',techniquesText:techniques,indicatorsText:indicators});
 assert.equal(result.period,'2026-07');
 assert.equal(result.counts.anestheticProcedures,32);
 assert.equal(result.counts.surgical,18);
 for(const key of ['effectiveToxicity','effectiveGlucose','headache','eventProcedures'])assert.ok(result.missingFields.includes(key));
 assert.equal(result.rows.length,6);
 for(const period of ['2026-06','2026-00','2026-13','2026-7',undefined,'2201-01'])assert.throws(()=>preparePrintPreview({period,techniquesText:techniques,indicatorsText:indicators}),/QMENTUM_PRINT_PERIOD/);
 assert.equal(preparePrintPreview({period:'2027-01',techniquesText:'Total geral: 0',indicatorsText:'DM: 0'}).missingFields.includes('surgical'),false);
});

test('surgical total comes exclusively from the technique table and event record totals are ignored',()=>{
 for(const records of [0,7,999]){
  const result=preparePrintPreview({period:'2026-07',techniquesText:techniques,indicatorsText:'Dor aguda: 2\nTotal de registros: '+records});
  assert.equal(result.counts.surgical,18);assert.equal(result.counts.acutePain,2);
 }
 assert.equal(Object.hasOwn(parseIndicatorPrint('Total de registros: 9').counts,'surgical'),false);
});

test('general with spinal is one of each, and Outra Técnica contributes one sedation and one regional',()=>{
 const result=parseTechniquePrint('Geral + Raquianestesia: 1\nOutra Técnica: 1\nTotal geral: 2');
 assert.deepEqual(result.counts,{general:1,sedation:1,regional:1,spinal:1,epidural:0,local:0,support:0,anestheticProcedures:4,surgical:2});
 assert.equal(result.tableTotal,2);
 assert.equal(result.anestheticProcedures,4);
});

test('Google Docs OCR artifacts and report codes without a dash retain strict label/value pairing',()=>{
 assert.equal(parseTechniquePrint('________________\r\n\r\nSedação 3\r\nTotal geral 3').tableTotal,3);
 assert.deepEqual(parseIndicatorPrint('________________\n01 Mudança técnica anestésica 2\n-\n02 Via aérea dificil 3\n04 - Transferência UTI O\n09 Evento PCR 0').counts,{techniqueChanges:2,difficultAirway:3,unplannedIcu:0,cardiacArrest:0});
 for(const text of ['03 Via aérea difícil 2','04 - Transferência UTI 1O','04 - Transferência UTI OO','04 - Transferência UTI o2','__Sedação 3__'])assert.throws(()=>parseIndicatorPrint(text),/QMENTUM_PRINT_/);
});

test('bounded OCR input rejects non-text, control characters, oversize lines and excessive rows',()=>{
 for(const text of [null,42,'a'.repeat(50001),'Geral: 0\u0000\nTotal geral: 0','x'.repeat(2049)])assert.throws(()=>parseTechniquePrint(text),/QMENTUM_PRINT_/);
 assert.throws(()=>parseIndicatorPrint(Array(502).fill('Indicadores').join('\n')),/QMENTUM_PRINT_/);
});

const current=(counts={},origins={})=>{const inputs=emptyInputs();Object.assign(inputs.counts,counts);Object.assign(inputs.origins,origins);return inputs;};
test('first import fills null fields with imported origin and preserves absent manual outcomes and input metadata',()=>{
 const inputs=current({headache:2},{headache:'MANUAL'});inputs.comment='Synthetic note';inputs.informedRates.QM12=.5;inputs.notApplicable=['electiveEligible'];
 const result=reconcilePrintImport({currentInputs:inputs,sourceCounts:{general:4,toxicity:0,anestheticProcedures:3}});
 assert.equal(result.changed,true);
 assert.equal(result.inputs.counts.general,4);
 assert.equal(result.inputs.counts.toxicity,0);
 assert.equal(result.inputs.origins.general,'IMPORTED');
 assert.equal(result.inputs.counts.headache,2);
 assert.equal(result.inputs.comment,'Synthetic note');
 assert.equal(result.inputs.informedRates.QM12,.5);
 assert.deepEqual(result.inputs.notApplicable,['electiveEligible']);
 assert.equal(result.changes.length,3);
 assert.deepEqual(result.conflicts,[]);
 assert.equal(inputs.counts.general,null);
 assert.deepEqual(inputs.notApplicable,['electiveEligible']);
});

test('without a baseline a different existing count requires an explicit resolution',()=>{
 const inputs=current({general:7},{general:'MANUAL'});
 const result=reconcilePrintImport({currentInputs:inputs,sourceCounts:{general:8}});
 assert.equal(result.changed,false);
 assert.equal(result.inputs.counts.general,7);
 assert.equal(result.conflicts.length,1);
 assert.equal(result.conflicts[0].field,'general');
 assert.equal(result.conflicts[0].current,7);
 assert.equal(result.conflicts[0].source,8);
 assert.deepEqual(reconcilePrintImport({currentInputs:inputs,sourceCounts:{general:7}}).conflicts,[]);
});

test('unchanged source preserves manual edits while changed source updates untouched applied fields',()=>{
 const baseline={sourceCounts:{general:4,sedation:5},appliedCounts:{general:4,sedation:5}};
 const inputs=current({general:9,sedation:5},{general:'MANUAL',sedation:'IMPORTED'});
 const result=reconcilePrintImport({currentInputs:inputs,baseline,sourceCounts:{general:4,sedation:6}});
 assert.equal(result.inputs.counts.general,9);
 assert.equal(result.inputs.origins.general,'MANUAL');
 assert.equal(result.inputs.counts.sedation,6);
 assert.deepEqual(result.conflicts,[]);
 assert.equal(result.changes.length,1);
});

test('concurrent manual/source edits require KEEP_MANUAL or USE_SOURCE and last applied baseline handles retained manual data',()=>{
 const inputs=current({general:9},{general:'MANUAL'}),baseline={sourceCounts:{general:4},appliedCounts:{general:4}},sourceCounts={general:6};
 assert.equal(reconcilePrintImport({currentInputs:inputs,baseline,sourceCounts}).conflicts.length,1);
 const kept=reconcilePrintImport({currentInputs:inputs,baseline,sourceCounts,resolutions:{general:'KEEP_MANUAL'}});
 assert.equal(kept.changed,false);assert.deepEqual(kept.conflicts,[]);assert.equal(kept.inputs.counts.general,9);
 const accepted=reconcilePrintImport({currentInputs:inputs,baseline,sourceCounts,resolutions:{general:'USE_SOURCE'}});
 assert.equal(accepted.changed,true);assert.deepEqual(accepted.conflicts,[]);assert.equal(accepted.inputs.counts.general,6);
 assert.equal(accepted.inputs.origins.general,'IMPORTED');
 const later=reconcilePrintImport({currentInputs:kept.inputs,baseline:{sourceCounts:{general:6},appliedCounts:{general:9}},sourceCounts:{general:7}});
 assert.equal(later.inputs.counts.general,9);assert.equal(later.conflicts.length,1);
});

test('KEEP_MANUAL and manual OCR corrections retain ownership when later source counts change',()=>{
 const inputs=current({general:8},{general:'MANUAL'});
 const retained={sourceCounts:{general:5},appliedCounts:{general:8}};
 const conflict=reconcilePrintImport({currentInputs:inputs,baseline:retained,sourceCounts:{general:6}});
 assert.equal(conflict.inputs.counts.general,8);assert.equal(conflict.conflicts.length,1);assert.equal(conflict.changed,false);
 const retainedWithoutOrigin=current({general:8},{general:'IMPORTED'});
 assert.equal(reconcilePrintImport({currentInputs:retainedWithoutOrigin,baseline:retained,sourceCounts:{general:6}}).conflicts.length,1);
 // Even the same applied/source count can be an explicit manual correction.
 const corrected={sourceCounts:{general:8},appliedCounts:{general:8}};
 assert.equal(reconcilePrintImport({currentInputs:inputs,baseline:corrected,sourceCounts:{general:6}}).conflicts.length,1);
 const adopted=reconcilePrintImport({currentInputs:inputs,baseline:retained,sourceCounts:{general:6},resolutions:{general:'USE_SOURCE'}});
 assert.equal(adopted.inputs.origins.general,'IMPORTED');assert.equal(adopted.inputs.counts.general,6);
 const next=reconcilePrintImport({currentInputs:adopted.inputs,baseline:{sourceCounts:{general:6},appliedCounts:{general:6}},sourceCounts:{general:7}});
 assert.equal(next.inputs.counts.general,7);assert.deepEqual(next.conflicts,[]);
});

test('duplicate counts, source omission and source changes converging with manual values are no-op revisions',()=>{
 const inputs=current({general:6,headache:2},{general:'MANUAL',headache:'MANUAL'}),baseline={sourceCounts:{general:4},appliedCounts:{general:4}};
 for(const sourceCounts of [{general:6},{}, {general:null}]){
  const result=reconcilePrintImport({currentInputs:inputs,baseline,sourceCounts});
  assert.equal(result.changed,false);assert.deepEqual(result.changes,[]);assert.deepEqual(result.conflicts,[]);
  assert.equal(result.inputs.counts.headache,2);assert.equal(result.inputs.origins.general,'MANUAL');
 }
 const duplicate=reconcilePrintImport({currentInputs:current({general:4},{general:'IMPORTED'}),baseline,sourceCounts:{general:4}});
 assert.equal(duplicate.changed,false);
});

test('manual clearing and not-applicable declarations conflict with a changed source',()=>{
 const baseline={sourceCounts:{general:4},appliedCounts:{general:4}};
 const cleared=current();
 assert.equal(reconcilePrintImport({currentInputs:cleared,baseline,sourceCounts:{general:6}}).conflicts.length,1);
 const inputs=current();inputs.notApplicable=['general'];
 assert.equal(reconcilePrintImport({currentInputs:inputs,sourceCounts:{general:0}}).conflicts.length,1);
 const resolved=reconcilePrintImport({currentInputs:inputs,sourceCounts:{general:0},resolutions:{general:'USE_SOURCE'}});
 assert.equal(resolved.inputs.counts.general,0);
 assert.deepEqual(resolved.inputs.notApplicable,[]);
 assert.deepEqual(inputs.notApplicable,['general']);
});

test('legacy month inputs acquire the optional explicit total without rebuilding unrelated fields',()=>{
 const inputs=current({headache:1},{headache:'MANUAL'});
 delete inputs.counts.anestheticProcedures;delete inputs.origins.anestheticProcedures;
 const result=reconcilePrintImport({currentInputs:inputs,sourceCounts:{anestheticProcedures:0}});
 assert.equal(result.inputs.counts.anestheticProcedures,0);
 assert.equal(result.inputs.origins.anestheticProcedures,'IMPORTED');
 assert.equal(result.inputs.counts.headache,1);
 assert.equal(Object.hasOwn(inputs.counts,'anestheticProcedures'),false);
});

test('merge validates source/baseline/resolution fields and count boundaries',()=>{
 for(const sourceCounts of [{unknown:1},{general:-1},{general:.5},{general:10000001},{general:'1'},Object.create({general:1})])assert.throws(()=>reconcilePrintImport({currentInputs:current(),sourceCounts}),/QMENTUM_PRINT_/);
 for(const baseline of [{general:2},{sourceCounts:{general:2}},{sourceCounts:{general:-2},appliedCounts:{general:2}}])assert.throws(()=>reconcilePrintImport({currentInputs:current(),sourceCounts:{general:2},baseline}),/QMENTUM_PRINT_/);
 for(const resolutions of [{general:'OVERWRITE'},{unknown:'KEEP_MANUAL'}])assert.throws(()=>reconcilePrintImport({currentInputs:current(),sourceCounts:{general:2},resolutions}),/QMENTUM_PRINT_/);
});
