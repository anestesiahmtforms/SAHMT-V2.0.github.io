import {COUNT_KEYS} from './qmentum-catalog.js';
import {validateInputs} from './qmentum-engine.js';

const TECHNIQUES = ['general','sedation','regional','spinal','epidural','local','support'];
const PRINT_COUNT_KEYS = [...new Set([...COUNT_KEYS,'anestheticProcedures'])];
const MAX_COUNT = 10000000;
const fail = code => {throw Error('QMENTUM_PRINT_'+code);};
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[()/:|]/g,' ').replace(/\s+/g,' ').trim();
const dictionary = entries => new Map(entries.flatMap(([key,labels])=>labels.map(label=>[normalize(label),key])));
const techniqueAliases = dictionary([
 ['general',['Geral','Anestesia geral']],
 ['sedation',['Sedação','Sedacao','Anestesia por sedação']],
 ['regional',['Regional','Bloqueio','Bloqueio regional','Bloqueio periférico','Bloqueio de nervos periféricos']],
 ['spinal',['Raqui','Raquianestesia','Anestesia raquidiana','Anestesia espinhal']],
 ['epidural',['Peridural','Epidural','Peridural analgésica','Anestesia peridural','Anestesia epidural']],
 ['local',['Local','Anestesia local']],
 ['support',['Suporte','Suporte anestésico']],
 ['other',['Outra técnica']],
 ['systemicAnalgesia',['Analgesia sistêmica']]
]);
const indicatorAliases = dictionary([
 ['techniqueChanges',['Mudança de técnica','Mudanças de técnica','Mudança de técnica anestésica','Mudanças de técnica anestésica','Taxa de mudança de técnica anestésica']],
 ['difficultAirway',['Via aérea difícil','Via aérea difícil identificada no intraoperatório','Incidência de via aérea difícil identificada no intraoperatório']],
 ['toxicity',['Intoxicação por anestésicos locais','Intoxicações por anestésicos locais','Intoxicação por anestésico local','Toxicidade por anestésicos locais','Toxicidade por anestésico local','Toxicidade']],
 ['unplannedIcu',['UTI não planejada','Encaminhamento à UTI não planejado','Encaminhamentos à UTI não planejados','Encaminhamento à UTI não planejado por eventos anestésicos','Encaminhamentos não planejados por eventos anestésicos','Incidência de encaminhamento à UTI não planejado por eventos anestésicos']],
 ['ponv',['Náuseas e vômitos','Náuseas ou vômitos','Náuseas e vômitos do intraoperatório até a alta anestésica','Incidência de náuseas e vômitos do intraoperatório até a alta anestésica','PONV','NVPO']],
 ['acutePain',['Dor aguda','Dor aguda do intraoperatório até a alta anestésica','Incidência de dor aguda do intraoperatório até a alta anestésica']],
 ['diabetes',['DM','DM/hiperglicêmicos','DM/hiperglicemia','Diabéticos/hiperglicêmicos','Pacientes diabéticos/hiperglicêmicos','Pacientes com DM','Diabetes','Diabéticos']],
 ['hypoglycemia',['Hipoglicemia','Hipoglicemia perioperatória','Evento de hipoglicemia perioperatória']],
 ['hypothermia',['Hipotermia','Hipotermia não intencional','Hipotermia não intencional do intraoperatório até a alta anestésica','Incidência de hipotermia não intencional do intraoperatório até a alta anestésica']],
 ['cardiacArrest',['PCR','Parada cardiorrespiratória','Parada cardiorrespiratória do intraoperatório até a alta anestésica','PCR do intraoperatório até a alta anestésica','Incidência de PCR do intraoperatório até a alta anestésica']],
 ['ignoredRecords',['Total de registros']]
]);
const commonHeaders = ['Quantidade','Quantidades','Qtd','Qtde','Total'];
const techniqueHeaders = new Set([...commonHeaders,'Técnica','Técnicas','Técnica anestésica','Técnicas anestésicas','Tipo de anestesia','Técnica anestésica Quantidade','Técnicas anestésicas Quantidade','Técnica Quantidade','Técnica Qtd','Técnica Qtde'].map(normalize));
const indicatorHeaders = new Set([...commonHeaders,'Indicadores','Indicadores anestésicos','Eventos','Indicador','Indicador Quantidade','Indicadores Quantidade','Evento Quantidade','Eventos Quantidade'].map(normalize));
techniqueAliases.set(normalize('Raquianestesia Analgésica'),'spinal');
const reportCodes={'1':'techniqueChanges','2':'difficultAirway','3':'toxicity','4':'unplannedIcu','5':'ponv','6':'acutePain','7A':'diabetes','7B':'hypoglycemia','8':'hypothermia','9':'cardiacArrest'};
for(const [field,labels]of [
 ['techniqueChanges',['Mudança técnica anestésica']],['toxicity',['Evento de Intoxicação','Evento Intoxicação']],['unplannedIcu',['Transferência UTI','Transferência para UTI']],['ponv',['Episódios de náusea ou vômitos','Episódios de náuseas ou vômitos']],['diabetes',['Paciente com DM ou hiperglicêmico','Pacientes com DM ou hiperglicêmicos']],['hypoglycemia',['Evento de hipoglicemia']],['hypothermia',['Evento de hipotermia']],['cardiacArrest',['Evento PCR']]
])for(const label of labels)indicatorAliases.set(normalize(label),field);
for(const header of ['FILTROS','Período (Data registro)'])indicatorHeaders.add(normalize(header));

function ocrLines(text) {
 if(typeof text!=='string'||!text.trim())fail('TEXT_INVALID');
 if(text.length>50000)fail('TEXT_LIMIT');
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))fail('TEXT_INVALID');
 const lines=text.replace(/\r\n?/g,'\n').replace(/[\u00a0\u202f]/g,' ').split('\n');
 if(lines.length>500||lines.some(line=>line.length>2048))fail('TEXT_LIMIT');
 return lines.map(line=>line.trim().replace(/^\|\s*|\s*\|$/g,'').trim()).filter(Boolean);
}

function countFromText(value) {
 // A single OCR letter O in a verified numeric cell is the zero glyph.
 // Mixed letter/digit strings remain invalid and require manual review.
 const text=/^[Oo]$/.test(value.trim())?'0':value.trim();
 if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+)$/.test(text))fail('COUNT_INVALID');
 const count=Number(text.replace(/[. ]/g,''));
 if(!Number.isSafeInteger(count)||count>MAX_COUNT)fail('COUNT_INVALID');
 return count;
}

function techniqueLabel(label) {
 if(normalize(label)==='total geral')return {id:'total',fields:[]};
 const parts=label.split(/\s*(?:\+|&|\/)\s*|\s+e\s+/i);
 const tokens=parts.map(part=>techniqueAliases.get(normalize(part)));
 if(tokens.some(token=>!token))fail('TECHNIQUE_UNKNOWN');
 if(new Set(tokens).size!==tokens.length)fail('ROW_DUPLICATE');
 if(tokens.includes('systemicAnalgesia')&&!tokens.includes('general'))fail('TECHNIQUE_UNKNOWN');
 const fields=[...new Set(tokens.flatMap(token=>token==='other'?['sedation','regional']:token==='systemicAnalgesia'?[]:[token]))];
 return {id:tokens.slice().sort().join('+'),fields};
}

function indicatorLabel(label) {
 const prefix=/^(0?[1-9]|7[AB])(?:\s*[-–—.:]\s*|\s+)(.+)$/i.exec(label),code=prefix?prefix[1].toUpperCase().replace(/^0/,''):null;
 const field=indicatorAliases.get(normalize(prefix?prefix[2]:label));
 if(!field)fail('INDICATOR_UNKNOWN');
 if(code&&reportCodes[code]!==field)fail('INDICATOR_CODE_MISMATCH');
 return {id:field,fields:field==='ignoredRecords'?[]:[field]};
}

// Only row-oriented OCR is accepted: one label/value line or an adjacent
// label line and value line. Column-major text has no reliable pairing.
function parseRows(text,headers,resolveLabel) {
 const lines=ocrLines(text),rows=[],seen=new Set();
 for(let index=0;index<lines.length;index++){
  const line=lines[index];
  if(headers.has(normalize(line))||/^(?:[|:\-\s]+|_{3,})$/.test(line))continue;
  const inline=line.match(/^(.+?)(?:\s*[:|=]\s*|\s+)([0-9][0-9., \t]*|[Oo])$/);
  let label,quantity;
  if(inline){label=inline[1].trim();quantity=countFromText(inline[2]);}
  else{
   label=line.replace(/\s*[:|=]\s*$/,'').trim();
   resolveLabel(label);
   if(index+1>=lines.length||!/^(?:[0-9][0-9., \t]*|[Oo])$/.test(lines[index+1]))fail('ROW_INCOMPLETE');
   quantity=countFromText(lines[++index]);
  }
  const resolved=resolveLabel(label);
  if(seen.has(resolved.id))fail('ROW_DUPLICATE');
  seen.add(resolved.id);rows.push({label,quantity,...resolved});
  if(rows.length>128)fail('ROW_LIMIT');
 }
 if(!rows.length)fail('ROWS_MISSING');
 return rows;
}

export function parseTechniquePrint(text) {
 const parsed=parseRows(text,techniqueHeaders,techniqueLabel);
 const total=parsed.find(row=>row.id==='total');
 if(!total)fail('TOTAL_MISSING');
 const rows=parsed.filter(row=>row.id!=='total').map(({label,quantity,fields})=>({label,quantity,fields}));
 const tableTotal=rows.reduce((sum,row)=>sum+row.quantity,0);
 if(tableTotal!==total.quantity)fail('TOTAL_MISMATCH');
 // Absence means zero only after all original rows reconcile to Total geral.
 const counts=Object.fromEntries(TECHNIQUES.map(field=>[field,0]));
 for(const row of rows)for(const field of row.fields)counts[field]+=row.quantity;
 counts.anestheticProcedures=TECHNIQUES.reduce((sum,field)=>sum+counts[field],0);
 if(counts.anestheticProcedures>MAX_COUNT)fail('COUNT_INVALID');
 counts.surgical=total.quantity;
 return {rows,counts,anestheticProcedures:counts.anestheticProcedures,tableTotal};
}

export function parseIndicatorPrint(text) {
 const rows=parseRows(text,indicatorHeaders,indicatorLabel);
 return {counts:Object.fromEntries(rows.filter(row=>row.id!=='ignoredRecords').map(row=>[row.id,row.quantity]))};
}

export function preparePrintPreview({period,techniquesText,indicatorsText}={}) {
 if(typeof period!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)||period<'2026-07'||period>'2200-12')fail('PERIOD_INVALID');
 const techniques=parseTechniquePrint(techniquesText),indicators=parseIndicatorPrint(indicatorsText);
 const counts={...techniques.counts,...indicators.counts};
 return {period,counts,rows:techniques.rows,missingFields:PRINT_COUNT_KEYS.filter(field=>!Object.hasOwn(counts,field))};
}

const plainObject = value => value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function validateCountMap(map) {
 if(!plainObject(map))fail('COUNTS_INVALID');
 for(const [field,value] of Object.entries(map))if(!PRINT_COUNT_KEYS.includes(field)||value!==null&&(!Number.isSafeInteger(value)||value<0||value>MAX_COUNT))fail('COUNT_INVALID');
 return map;
}

/**
 * Baseline: {sourceCounts, appliedCounts}. sourceCounts is the last confirmed
 * sparse source snapshot; appliedCounts is the resulting month counts after
 * its explicit resolutions. Persist both only after a successful atomic save.
 * Merge these snapshots with older baseline fields when a source omits them.
 * Divergent source/applied counts retain manual ownership on later imports;
 * USE_SOURCE is required to hand the field back to imported ownership.
 * changes: {field,from,to}[]; conflicts: {field,current,source,
 * baselineSource,baselineApplied}[]. No caller input is mutated.
 */
export function reconcilePrintImport({currentInputs,baseline=null,sourceCounts,resolutions={}}={}) {
 validateInputs(currentInputs);validateCountMap(sourceCounts);
 if(baseline!==null){
  if(!plainObject(baseline)||Object.keys(baseline).sort().join()!=='appliedCounts,sourceCounts')fail('BASELINE_INVALID');
  validateCountMap(baseline.sourceCounts);validateCountMap(baseline.appliedCounts);
 }
 if(!plainObject(resolutions)||Object.entries(resolutions).some(([field,value])=>!PRINT_COUNT_KEYS.includes(field)||!['KEEP_MANUAL','USE_SOURCE'].includes(value)))fail('RESOLUTION_INVALID');
 const inputs=JSON.parse(JSON.stringify(currentInputs)),changes=[],conflicts=[];
 for(const [field,source] of Object.entries(sourceCounts)){
  if(source===null)continue; // Missing/deleted source data never clears a month.
  const current=currentInputs.counts[field]??null;
  const hasSource=baseline!==null&&Object.hasOwn(baseline.sourceCounts,field)&&baseline.sourceCounts[field]!==null;
  const hasApplied=baseline!==null&&Object.hasOwn(baseline.appliedCounts,field);
  const baselineSource=hasSource?baseline.sourceCounts[field]:null;
  const baselineApplied=hasApplied?baseline.appliedCounts[field]:null;
  if(current===source||hasSource&&source===baselineSource)continue;
  const declaredNotApplicable=currentInputs.notApplicable.includes(field);
  const manuallyOwned=currentInputs.origins[field]==='MANUAL'||hasSource&&hasApplied&&baselineApplied!==baselineSource;
  const canApply=!declaredNotApplicable&&!manuallyOwned&&(hasSource&&hasApplied?current===baselineApplied:current===null);
  if(!canApply){
   if(resolutions[field]==='KEEP_MANUAL')continue;
   if(resolutions[field]!=='USE_SOURCE'){
    conflicts.push({field,current,source,baselineSource,baselineApplied});continue;
   }
  }
  inputs.counts[field]=source;inputs.origins[field]='IMPORTED';
  inputs.notApplicable=inputs.notApplicable.filter(key=>key!==field);
  changes.push({field,from:current,to:source});
 }
 return {inputs,changes,conflicts,changed:changes.length>0};
}
