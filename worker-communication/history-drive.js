import {fail} from '../communication/domain.js';
import {HISTORY_FOLDER,HISTORY_HEADERS,parseHistoryMessage,parseHistoryRecipient} from '../communication/history.js';
import {boundedJson} from './google.js';
const FILES='https://www.googleapis.com/drive/v3/files/',SHEETS='https://sheets.googleapis.com/v4/spreadsheets/';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{10,200}$/.test(v);
const ends={Mensagens:'Q',Destinatarios:'K',Eventos:'F',Controle:'B'};
const permittedReaders=new Set([
 'anestesiahmtforms6@gmail.com','anestesiahmtforms@gmail.com','wx2064@gmail.com',
 'communication-worker@sahmt-comunicacao-ff.iam.gserviceaccount.com'
]);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
export function createCommunicationHistoryDrive({getToken,fetchImpl=fetch,spreadsheetId,folderId=HISTORY_FOLDER}={}){
 if(typeof getToken!=='function'||!id(spreadsheetId)||folderId!==HISTORY_FOLDER)throw fail('COMM_HISTORY_CONFIG_REQUIRED',503);
 const root=SHEETS+spreadsheetId;
 async function request(url,body){
  try{
   const response=await fetchImpl(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
   if(!response.ok){await response.body?.cancel();throw fail(response.status===403?'COMM_HISTORY_FORBIDDEN':response.status===429?'COMM_PROVIDER_QUOTA_EXHAUSTED':'COMM_HISTORY_UNAVAILABLE',response.status===429?429:503);}
   return await boundedJson(response);
  }catch(e){if(/^COMM_/.test(e.code||''))throw e;throw fail('COMM_HISTORY_UNAVAILABLE',503);}
 }
 async function verify(){
  const meta=await request(FILES+spreadsheetId+'?fields='+encodeURIComponent('id,mimeType,parents,trashed,permissions(type,role,emailAddress)'));
  if(meta.id!==spreadsheetId||meta.mimeType!=='application/vnd.google-apps.spreadsheet'||meta.trashed!==false||
     meta.parents?.length!==1||meta.parents[0]!==HISTORY_FOLDER||!Array.isArray(meta.permissions)||
     !meta.permissions.length||meta.permissions.some(p=>p.type!=='user'||!permittedReaders.has(p.emailAddress?.toLowerCase())))throw fail('COMM_HISTORY_DESTINATION_INVALID',503);
  const params=new URLSearchParams();for(const [name,end]of Object.entries(ends))params.append('ranges',`${name}!A1:${end}1`);
  const headers=await request(root+'/values:batchGet?'+params);
  if(headers.valueRanges?.length!==4||Object.values(HISTORY_HEADERS).some((row,i)=>JSON.stringify(headers.valueRanges[i]?.values?.[0])!==JSON.stringify(row)))throw fail('COMM_HISTORY_SCHEMA_INVALID',503);
  return {verified:true,spreadsheetId,folderId};
 }
 function checkedData(data){
  if(!Array.isArray(data)||data.length<1||data.length>40)throw fail('COMM_INVALID_INPUT');
  let cells=0;
  for(const item of data){
   const match=typeof item?.range==='string'&&/^(Mensagens|Destinatarios|Eventos)!A([1-9]\d{0,6}):([A-Z]+)([1-9]\d{0,6})$/.exec(item.range);
   if(!match||match[3]!==ends[match[1]]||Number(match[2])<2||Number(match[4])<Number(match[2])||Number(match[4])>200000||!Array.isArray(item.values)||item.values.length!==Number(match[4])-Number(match[2])+1||item.values.length>200)throw fail('COMM_INVALID_INPUT');
   const width=HISTORY_HEADERS[match[1]].length;
   for(const row of item.values){if(!Array.isArray(row)||row.length!==width||row.some(v=>typeof v==='string'?v.length>20000:typeof v==='number'?!Number.isFinite(v):typeof v!=='boolean'))throw fail('COMM_INVALID_INPUT');cells+=row.length;}
  }
  if(cells>10000||JSON.stringify(data).length>200000)throw fail('COMM_INVALID_INPUT');return data;
 }
 async function read(range){await verify();const result=await request(root+'/values/'+encodeURIComponent(range)+'?valueRenderOption=UNFORMATTED_VALUE');if(result.values!==undefined&&!Array.isArray(result.values))throw fail('COMM_HISTORY_SCHEMA_INVALID',503);return result.values||[];}
 async function ensureRows(data){
  const needed=new Map();
  for(const item of data){
   const [name]=item.range.split('!');
   const row=Number(item.range.match(/\d+$/)[0]);
   needed.set(name,Math.max(row,needed.get(name)||0));
  }
  if(Math.max(...needed.values())<=1000)return;
  const meta=await request(root+'?fields=sheets(properties(sheetId,title,gridProperties(rowCount)))');
  const requests=[];
  for(const [name,row] of needed){
   const properties=meta.sheets?.find(sheet=>sheet.properties?.title===name)?.properties;
   if(!properties||!Number.isInteger(properties.gridProperties?.rowCount))throw fail('COMM_HISTORY_SCHEMA_INVALID',503);
   if(row>properties.gridProperties.rowCount)requests.push({appendDimension:{sheetId:properties.sheetId,dimension:'ROWS',length:Math.min(200000,Math.ceil(row/1000)*1000)-properties.gridProperties.rowCount}});
  }
  if(requests.length)await request(root+':batchUpdate',{requests});
 }
 return {verify,
  async write(data){checkedData(data);await verify();await ensureRows(data);await request(root+'/values:batchUpdate',{valueInputOption:'RAW',data});return {saved:true};},
  async readMessages({before,limit=20,filters={}}={}){
   if(!integer(before,2,200001)||!integer(limit,1,50)||!filters||Array.isArray(filters)||Object.keys(filters).some(k=>!['from','to','kind','audience','recipient','search'].includes(k)))throw fail('COMM_INVALID_INPUT');
   if(before===2)return {items:[],cursor:null};
   const end=before-1,start=Math.max(2,end-limit+1),rows=await read(`Mensagens!A${start}:Q${end}`);
   const items=rows.map((r,i)=>({...parseHistoryMessage(r),historyRow:start+i})).filter(r=>r.id).reverse().filter(m=>(!filters.from||m.publishAt>=Number(filters.from))&&(!filters.to||m.publishAt<=Number(filters.to))&&(!filters.kind||filters.kind===(m.activity?.kind||'MESSAGE'))&&(!filters.audience||filters.audience===m.audienceValue||filters.audience===m.audienceType)&&(!filters.search||[m.title,m.message,m.senderEmail].some(t=>t.toLocaleLowerCase('pt-BR').includes(String(filters.search).toLocaleLowerCase('pt-BR')))));
   return {items,cursor:start>2?start:null};
  },
  async readMessage({row}={}){if(!integer(row,2,200000))throw fail('COMM_INVALID_INPUT');const rows=await read(`Mensagens!A${row}:Q${row}`);return rows.length?{...parseHistoryMessage(rows[0]),historyRow:row}:null;},
  async readRecipients({start,count}={}){if(!integer(start,2,200000)||!integer(count,0,200)||start+count>200001)throw fail('COMM_INVALID_INPUT');if(!count)return [];return (await read(`Destinatarios!A${start}:K${start+count-1}`)).filter(r=>r[0]).map(parseHistoryRecipient);}
 };
}
