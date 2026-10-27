import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {aggregate} from '../climate-domain/aggregate.js';
import {actionIndicators} from '../climate-domain/actions.js';
import {CYCLE,VERSION} from '../climate-domain/schema.js';
const require=createRequire(import.meta.url),auth=require('firebase-tools/lib/auth.js'),api=require('firebase-tools/lib/api.js');
const [command,file]=process.argv.slice(2);
if(!['open','close','publish','actions','status'].includes(command))throw Error('COMMAND_REQUIRED');
api.setScopes(['https://www.googleapis.com/auth/cloud-platform']);
const account=auth.findAccountByEmail('anestesiahmtforms5@gmail.com');
if(!account)throw Error('FE_ACCOUNT_REQUIRED');
const token=await auth.getAccessToken(account.tokens.refresh_token,api.getScopes());
const base='https://firestore.googleapis.com/v1/projects/outros-48120/databases/(default)/documents';
async function call(url,body,method=body?'POST':'GET'){
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw Error(`FE_OPERATION_FAILED_${r.status}_${data.error?.status||''}`);return data;
}
const encode=v=>v===null?{nullValue:null}:Array.isArray(v)?{arrayValue:{values:v.map(encode)}}:typeof v==='object'?{mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}}:typeof v==='number'?Number.isInteger(v)?{integerValue:String(v)}:{doubleValue:v}:typeof v==='boolean'?{booleanValue:v}:{stringValue:v};
const decode=v=>'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):'arrayValue'in v?(v.arrayValue.values||[]).map(decode):'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'booleanValue'in v?v.booleanValue:'nullValue'in v?null:v.stringValue;
const cyclePath=`climateCycles/${CYCLE}`;
async function write(path,data,createOnly=false){return call(base+':commit',{writes:[{update:{name:base.slice('https://firestore.googleapis.com/v1/'.length)+'/'+path,fields:encode(data).mapValue.fields},currentDocument:{exists:!createOnly}}]});}
if(command==='open')await write(cyclePath,{status:'open',survey_version:VERSION},true);
else if(command==='close')await write(cyclePath,{status:'closed',survey_version:VERSION});
else if(command==='status'){const d=await call(base+'/'+cyclePath);console.log(JSON.stringify({cycle:CYCLE,...decode({mapValue:{fields:d.fields}})}));}
else if(command==='actions'){
 const counts=actionIndicators(JSON.parse(await readFile(file,'utf8')));
 await call(base+':commit',{writes:[{update:{name:`projects/outros-48120/databases/(default)/documents/climateActionReports/${CYCLE}`,fields:encode({survey_cycle:CYCLE,...counts}).mapValue.fields}}]});
}else{
 const d=await call(base+'/'+cyclePath);if(decode({mapValue:{fields:d.fields}}).status!=='closed')throw Error('CYCLE_MUST_BE_CLOSED');
 const rows=[];let next='';
 do{const data=await call(base+'/climateResponses?pageSize=100'+(next?'&pageToken='+encodeURIComponent(next):''));for(const doc of data.documents||[]){const row=decode({mapValue:{fields:doc.fields}});if(row.survey_cycle===CYCLE)rows.push(row);}next=data.nextPageToken||'';}while(next);
 await write(`climateReports/${CYCLE}`,aggregate(rows),true);
}
console.log('Operação concluída no FE; nenhum dado individual exibido.');
