import {createPrivateKey,sign} from 'node:crypto';
export const SPREADSHEET_ID='1NFR4jJUV2HRWD68hrh3zT8g6N1i3sGrQ5LXexf-Xm8w';
const fail=()=>Object.assign(Error('VACATIONS_SHEETS_UNAVAILABLE'),{code:'VACATIONS_SHEETS_UNAVAILABLE',status:503});
export function vacationServiceToken({credentials,fetchImpl=fetch,now=Date.now,includeSheets=false}){
 if(credentials?.project_id!=='outros-48120'||credentials.client_email!=='fe-survey-worker@outros-48120.iam.gserviceaccount.com')throw fail();
 const key=createPrivateKey(credentials.private_key);let cached,pending;const b=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
 return async()=>{
  if(cached?.until>now()+60000)return cached.token;
  if(!pending)pending=(async()=>{
   const iat=Math.floor(now()/1000),unsigned=b({alg:'RS256',typ:'JWT'})+'.'+b({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/datastore'+(includeSheets?' https://www.googleapis.com/auth/spreadsheets':''),aud:'https://oauth2.googleapis.com/token',iat,exp:iat+3600});
   const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),key).toString('base64url')}),redirect:'manual',signal:AbortSignal.timeout(15000)});
   if(!response.ok){await response.body?.cancel();throw fail();}const data=await response.json();
   if(typeof data.access_token!=='string'||!Number.isFinite(data.expires_in)||data.expires_in<120||data.expires_in>3600)throw fail();
   cached={token:data.access_token,until:now()+data.expires_in*1000};return cached.token;
  })().finally(()=>pending=null);
  return pending;
 };
}
async function boundedJson(response,max=512*1024){
 if(!response.ok){await response.body?.cancel();throw fail();}
 const reader=response.body.getReader(),chunks=[];let length=0;
 try{for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>max)throw fail();chunks.push(r.value);}}
 finally{await reader.cancel().catch(()=>{});}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createVacationSheets({getAccessToken,fetchImpl=fetch}){
 const base='https://sheets.googleapis.com/v4/spreadsheets/'+SPREADSHEET_ID;
 async function request(path,body){
  try{return await boundedJson(await fetchImpl(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getAccessToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)}));}catch{throw fail();}
 }
 return {
  async read(){const d=await request('/values:batchGet?'+new URLSearchParams([['ranges',"'FERIAS 2027'!A1:K52"],['ranges',"'REGRAS'!A1:F100"],['valueRenderOption','FORMATTED_VALUE']]));if(d.valueRanges?.length!==2)throw fail();return {values:d.valueRanges[0].values||[],rules:d.valueRanges[1].values||[]};},
  async audit(){const d=await request('/values/'+encodeURIComponent("'AUDITORIA_PWA'!A1:J2000")+'?valueRenderOption=FORMATTED_VALUE');return (d.values||[]).slice(1).filter(r=>r.some(Boolean)).slice(-200).reverse().map(r=>({at:String(r[0]||''),type:String(r[1]||''),sigla:String(r[2]||''),slot:String(r[3]||''),result:String(r[4]||''),justification:String(r[5]||''),actor:String(r[7]||''),previousValue:String(r[8]||''),operationId:String(r[9]||'')}));},
  async update({updates,justification,actor,operationId,at}){
   // One atomic Sheets batch: literal text (never formulas) plus the audit row.
   await request(':batchUpdate',{requests:updates.flatMap(({slot,value,previousValue})=>[
    {updateCells:{range:{sheetId:1610343798,startRowIndex:slot.row-1,endRowIndex:slot.row,startColumnIndex:slot.column-1,endColumnIndex:slot.column},rows:[{values:[{userEnteredValue:{stringValue:value}}]}],fields:'userEnteredValue'}},
    {appendCells:{sheetId:303176100,rows:[{values:[at,'fe_admin_override',value,`${slot.month}-${slot.week}-${slot.slot}`,'OK',justification,actor.uid,actor.email,previousValue,operationId].map(v=>({userEnteredValue:{stringValue:String(v)}}))}],fields:'userEnteredValue'}},
   ])});
  },
 };
}
