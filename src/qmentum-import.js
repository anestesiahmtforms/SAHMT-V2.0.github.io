import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {emptyInputs,QMENTUM_IDS,initialDefinitions} from './qmentum-catalog.js';
import {calculateMonth,periodKey} from './qmentum-engine.js';

const array=value=>value===undefined?[]:Array.isArray(value)?value:[value];
const text=value=>value===undefined?'':typeof value==='object'?String(value['#text']??''):String(value);
const stringText=value=>text(value?.t)+array(value?.r).map(run=>text(run.t)).join('');
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,processEntities:true});
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
export async function fileHash(bytes){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}
export function parseQmentumWorkbook(bytes) {
 if(!(bytes instanceof Uint8Array))bytes=new Uint8Array(bytes);
 if(bytes.length>5*1024*1024||bytes.length<4)throw Error('QMENTUM_XLSX_SIZE');
 let expanded=0,files=0;
 const zip=unzipSync(bytes,{filter:file=>{files++;expanded+=file.originalSize;if(files>300||expanded>20*1024*1024||file.originalSize>4*1024*1024)throw Error('QMENTUM_XLSX_EXPANSION_LIMIT');if(/vbaProject|externalLinks/i.test(file.name))throw Error('QMENTUM_EXTERNAL_CONTENT');return /\.xml$|\.rels$/.test(file.name);}});
 const xml=name=>{if(!zip[name])throw Error('QMENTUM_XLSX_PART_MISSING');const raw=strFromU8(zip[name]);if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error('QMENTUM_XML_ENTITY_FORBIDDEN');return parser.parse(raw);};
 const workbook=xml('xl/workbook.xml').workbook;
 const relationships=array(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship);
 if(relationships.some(r=>r['@_TargetMode']==='External'))throw Error('QMENTUM_EXTERNAL_CONTENT');
 const shared=zip['xl/sharedStrings.xml']?array(xml('xl/sharedStrings.xml').sst?.si).map(stringText):[];
 const styles=zip['xl/styles.xml']?xml('xl/styles.xml').styleSheet:{};
 const formats=new Map(array(styles?.numFmts?.numFmt).map(f=>[f['@_numFmtId'],f['@_formatCode']]));
 const cellFormats=array(styles?.cellXfs?.xf);
 const sheets={};let totalCells=0;
 for(const sheet of array(workbook?.sheets?.sheet)){
  const name=sheet['@_name'],rel=relationships.find(r=>r['@_Id']===sheet['@_r:id']);
  if(!rel||!name||Object.hasOwn(sheets,name))throw Error('QMENTUM_SHEET_INVALID');
  let target=rel['@_Target'];if(target.startsWith('/'))target=target.slice(1);else target='xl/'+target.replace(/^\.\//,'');
  if(target.includes('..')||!target.startsWith('xl/worksheets/'))throw Error('QMENTUM_SHEET_PATH_INVALID');
  const data=xml(target).worksheet,cells={},sharedFormulas={};
  for(const row of array(data?.sheetData?.row))for(const cell of array(row.c)){
   if(++totalCells>20000)throw Error('QMENTUM_CELL_LIMIT');
   const address=cell['@_r'];if(!/^[A-Z]{1,3}[1-9]\d{0,5}$/.test(address)||cells[address])throw Error('QMENTUM_CELL_ADDRESS_INVALID');
   const type=cell['@_t']||'n',raw=Object.hasOwn(cell,'v')?text(cell.v):null;
   const formula=Object.hasOwn(cell,'f')?{text:text(cell.f),type:cell.f?.['@_t']||'normal',sharedIndex:cell.f?.['@_si']??null,range:cell.f?.['@_ref']??null}:null;
   let value=raw;
   if(type==='s')value=shared[Number(raw)]??null;
   else if(type==='inlineStr')value=stringText(cell.is);
   else if(type==='n'&&raw!==null&&raw!==''&&Number.isFinite(Number(raw)))value=Number(raw);
   else if(type==='b'&&raw!==null)value=raw==='1';
   const error=type==='e'||typeof value==='string'&&/^#(DIV\/0!|VALUE!|REF!|N\/A|NAME\?|NUM!|NULL!)/.test(value);
   const formatId=cellFormats[Number(cell['@_s']||0)]?.['@_numFmtId']||'0';
   cells[address]={sheet:name,address,type,raw,value,kind:error?'ERROR':formula?'FORMULA':value===null||value===''?'BLANK':typeof value==='number'?value===0?'ZERO':'NUMBER':/[%]/.test(String(value))?'TEXT_RATE':'TEXT',formula,numberFormat:formats.get(formatId)||({9:'0%',10:'0.00%'}[formatId]||formatId),cachedValue:formula?value:null};
   if(formula?.type==='shared'&&formula.text)sharedFormulas[formula.sharedIndex]={address,...formula};
  }
  for(const c of Object.values(cells))if(c.formula?.type==='shared')c.formula.sharedBase=sharedFormulas[c.formula.sharedIndex]||null;
  sheets[name]={name,cells};
 }
 for(const name of ['ANESTESIAS','TAXA ','OUTROS INDICADORES'])if(!sheets[name])throw Error('QMENTUM_REQUIRED_SHEET_MISSING');
 return {schemaVersion:1,sheets,totalCells,sourceFormat:'XLSX',year:null,unitId:null};
}
export function sourceCell(book,sheet,address){return book.sheets[sheet]?.cells[address]||{sheet,address,type:null,raw:null,value:null,kind:'BLANK',formula:null,numberFormat:null,cachedValue:null};}
export function sourceRatio(cell){const v=cell.value;if(cell.kind==='ERROR'||v===null||v==='')return null;if(typeof v==='number')return v>=0&&v<=1?v:null;if(typeof v==='string'&&/^\s*\d+(?:[.,]\d+)?\s*%\s*$/.test(v)){const n=Number(v.replace('%','').replace(',','.').trim())/100;return n<=1?n:null;}return null;}
export function prepareQmentumImport(book,{hash,year=null,unitId=null,definitions=initialDefinitions()}={}) {
 if(!/^[a-f0-9]{64}$/.test(hash||''))throw Error('QMENTUM_HASH_INVALID');
 // Only these original bytes carry the explicit historical year confirmation.
 if(hash==='d0857e203e2ea566debb7eb8dfea29b52e6d6115d2e0ac214c115f4285bd5fb1'){
  if(year!==null&&year!==2026)throw Error('QMENTUM_SOURCE_YEAR_MISMATCH');year=2026;
 }
 if(year!==null)periodKey(year,1);
 if(unitId!==null&&!/^[A-Za-z0-9_-]{1,80}$/.test(unitId))throw Error('QMENTUM_UNIT_INVALID');
 const production={general:11,sedation:12,regional:13,spinal:14,epidural:15,local:16,support:17,surgical:20,diabetes:23,toxicity:24};
 const numerators=['techniqueChanges','difficultAirway','effectiveToxicity','unplannedIcu','ponv','acutePain','effectiveGlucose','hypoglycemia','hypothermia','cardiacArrest','headache'];
 const otherRows={QM12:3,QM13:4,QM14:5,QM15:6,QM16:7,QM17:8,QM18:12};
 const months=[],divergences=[];
 for(let month=1;month<=12;month++){
  const inputs=emptyInputs(),col=String.fromCharCode(67+month),otherCol=String.fromCharCode(69+month),mapped=[];
  const count=(key,sheet,address)=>{const c=sourceCell(book,sheet,address);mapped.push(c);if(c.kind!=='ERROR'&&!c.formula&&Number.isSafeInteger(c.value)&&c.value>=0){inputs.counts[key]=c.value;inputs.origins[key]='IMPORTED';}};
  for(const [key,row] of Object.entries(production))count(key,'ANESTESIAS',col+row);
  numerators.forEach((key,index)=>count(key,'TAXA ',col+(index+4)));
  count('eventEpisodes','TAXA ',col+15);
  for(let i=0;i<11;i++){const id=QMENTUM_IDS[i],c=sourceCell(book,'TAXA ',col+(i+18));mapped.push(c);inputs.legacyRates[id]={value:sourceRatio(c),raw:c.raw,kind:c.kind,sheet:c.sheet,address:c.address,formula:c.formula};}
  for(const [id,row] of Object.entries(otherRows)){const c=sourceCell(book,'OUTROS INDICADORES',otherCol+row);mapped.push(c);inputs.legacyRates[id]={value:sourceRatio(c),raw:c.raw,kind:c.kind,sheet:c.sheet,address:c.address,formula:c.formula};if(id!=='QM14')inputs.informedRates[id]=sourceRatio(c);}
  const hasInput=Object.values(inputs.counts).some(v=>v!==null)||Object.values(inputs.informedRates).some(v=>v!==null);
  const results=calculateMonth(inputs,definitions);
  for(const id of QMENTUM_IDS){const old=inputs.legacyRates[id]?.value,newValue=results[id].ratio;if(old!==null&&old!==undefined&&(newValue===null||Math.abs(old-newValue)>1e-8))divergences.push({month,indicatorId:id,legacy:old,recalculated:newValue,status:results[id].status,reason:results[id].pending.join(',')||'ROUNDING_OR_FORMULA'});}
  months.push({month,hasInput,inputs,results,cells:mapped});
 }
 return {schemaVersion:1,hash,year,unitId,status:year===null||!unitId?'PENDING_ASSIGNMENT':'PREVIEW',months,divergences,excludedRows:['OUTROS INDICADORES!10','OUTROS INDICADORES!11'],sourceSheetNames:Object.keys(book.sheets),cellCount:book.totalCells};
}
export function reconcileImport(preview,existing=[]) {
 return preview.months.filter(m=>m.hasInput).map(row=>{const current=existing.find(d=>d.month===row.month&&d.year===preview.year);return {month:row.month,status:!preview.year||!preview.unitId?'PENDING_ASSIGNMENT':!current?'CREATE':current.importHash===preview.hash?'ALREADY_IMPORTED':'CONFLICT',version:current?.version||0};});
}
export function workbookBackup(book,hash){return {schemaVersion:1,hash,source:book,warning:'Arquivo de conferência exportável. Preserve também os bytes XLSX originais; não é uma competência oficial.'};}
