export const DOSIMETRY_YEAR=2026;
export const DOSIMETRY_MONTHS=Object.freeze(['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']);
const codes=Object.freeze({ANR:'Leitura abaixo do nível de registro',LI:'Leitura impossível',ND:'Monitor não devolvido',NU:'Monitor não utilizado',EC:'Excedido o limite de certificação informado no documento',EX:'Monitor extraviado',OD:'Indicação OD no relatório'});
export function normalizeProfessionalName(value){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim().split(' ').filter(part=>!['DE','DA','DO','DAS','DOS','E'].includes(part)).join(' ');}
export function dosimetryValue(value){
 if(value===null)return {kind:'MISSING',display:'Não disponível',valueMsv:null};
 if(Object.hasOwn(codes,value))return {kind:'CODE',display:value,description:codes[value],valueMsv:null};
 if(typeof value!=='string'||!/^\d{1,5}(?:[.,]\d{1,3})?$/.test(value))throw Error('DOSIMETRY_INVALID_VALUE');
 const number=Number(value.replace(',','.'));if(!Number.isFinite(number)||number<0)throw Error('DOSIMETRY_INVALID_VALUE');
 return {kind:'MEASURED',display:value.replace('.',','),valueMsv:number};
}
export function dosimetryMonths(values){if(!Array.isArray(values)||values.length!==12)throw Error('DOSIMETRY_INVALID_MONTHS');return Array.from({length:12},(_,i)=>{if(!Object.hasOwn(values,i))throw Error('DOSIMETRY_INVALID_MONTHS');return {month:i+1,label:DOSIMETRY_MONTHS[i],...dosimetryValue(values[i])};});}
export function validateDosimetryRecord(record){
 const date=record?.issuedOn,dateValid=typeof date==='string'&&/^2026-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
 if(!record||record.schemaVersion!==1||record.status!=='VERIFIED'||record.year!==DOSIMETRY_YEAR||typeof record.uid!=='string'||typeof record.email!=='string'||typeof record.sourceName!=='string'||!record.sourceName.trim()||record.sourceName.length>200||record.unit!=='mSv'||record.quantity!=='Hp(10)'||record.monitorType!=='28'||!dateValid||!/^[a-f0-9]{64}$/.test(record.sourceFingerprint||'')||!/^[-A-Za-z0-9_]{10,200}$/.test(record.sourceFileId||''))throw Error('DOSIMETRY_INVALID_RECORD');
 return {...record,months:dosimetryMonths(record.values)};
}
