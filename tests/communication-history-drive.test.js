import test from 'node:test';
import assert from 'node:assert/strict';
import {HISTORY_HEADERS,HISTORY_FOLDER} from '../communication/history.js';
let api={};try{api=await import('../worker-communication/history-drive.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const sheetId='verified_sheet_id_2026';
function fixture({parent=HISTORY_FOLDER,failWrite=false}={}){
 const writes=[],cells=new Map();let failed=false;
 const fetchImpl=async(url,options={})=>{
  const u=new URL(url);
  assert.equal(options.headers.Authorization,'Bearer synthetic');
  assert.equal(options.redirect,'manual');
  if(u.hostname==='www.googleapis.com')return Response.json({id:sheetId,mimeType:'application/vnd.google-apps.spreadsheet',parents:[parent],trashed:false,permissions:[{type:'user',role:'owner',emailAddress:'anestesiahmtforms6@gmail.com'},{type:'user',role:'writer',emailAddress:'communication-worker@sahmt-comunicacao-ff.iam.gserviceaccount.com'}]});
  if(u.pathname.endsWith('/values:batchGet'))return Response.json({valueRanges:Object.values(HISTORY_HEADERS).map(headers=>({values:[headers]}))});
  if(u.pathname.endsWith('/values:batchUpdate')){
   const body=JSON.parse(options.body);writes.push(body);for(const data of body.data)cells.set(data.range,data.values);
   if(failWrite&&!failed){failed=true;throw Error('response lost');}
   return Response.json({totalUpdatedRows:body.data.length});
  }
  if(u.pathname.includes('/values/'))return Response.json({values:[]});
  throw Error('UNEXPECTED_REQUEST '+u.pathname);
 };
 return {writes,cells,create:()=>api.createCommunicationHistoryDrive({getToken:async()=> 'synthetic',fetchImpl,spreadsheetId:sheetId,folderId:HISTORY_FOLDER})};
}
test('archive adapter refuses a file outside the exact authorized folder before writing',async()=>{
 assert.equal(typeof api.createCommunicationHistoryDrive,'function');
 const f=fixture({parent:'another-folder'});await assert.rejects(f.create().write([{range:'Mensagens!A2:Q2',values:[Array(17).fill('')]}]),{code:'COMM_HISTORY_DESTINATION_INVALID'});assert.equal(f.writes.length,0);
});
test('archive adapter rejects a provider redirect without forwarding credentials',async()=>{
 const calls=[];
 const drive=api.createCommunicationHistoryDrive({spreadsheetId:sheetId,getToken:async()=> 'synthetic',fetchImpl:async(url,{redirect})=>{
  calls.push(new URL(url).hostname);
  assert.equal(redirect,'manual');
  return Response.redirect('https://example.com',307);
 }});
 await assert.rejects(drive.verify(),{code:'COMM_HISTORY_UNAVAILABLE',archiveApi:'DRIVE',archiveHttpStatus:307});
 assert.deepEqual(calls,['www.googleapis.com']);
});
test('archive fixed-range retry preserves literal text and cannot duplicate events',async()=>{
 assert.equal(typeof api.createCommunicationHistoryDrive,'function');
 const f=fixture({failWrite:true}),drive=f.create(),values=[['event-1','message-1','uid-1','READ','2026-11-15T12:00:00.000Z','=FORMULA()']],data=[{range:'Eventos!A2:F2',values}];
 await assert.rejects(drive.write(data),{code:'COMM_HISTORY_UNAVAILABLE'});await drive.write(data);
 assert.equal(f.cells.size,1);assert.equal(f.writes.length,2);assert.equal(f.writes[1].valueInputOption,'RAW');assert.equal(f.cells.get('Eventos!A2:F2')[0][5],'=FORMULA()');
});
test('archive rejects arbitrary ranges, oversized reads and formula objects',async()=>{
 assert.equal(typeof api.createCommunicationHistoryDrive,'function');const drive=fixture().create();
 for(const data of [[{range:'Other!A2:F2',values:[['x']]}],[{range:'Eventos!A0:F0',values:[Array(6).fill('')]}],[{range:'Eventos!A2:F2',values:[[{formula:'=1'},'','','','','']]}]])await assert.rejects(drive.write(data),{code:'COMM_INVALID_INPUT'});
 await assert.rejects(drive.readMessages({before:100,limit:10000}),{code:'COMM_INVALID_INPUT'});
});
