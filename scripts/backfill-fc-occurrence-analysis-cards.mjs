import {isDeepStrictEqual} from 'node:util';
import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';

const project='indicadores---sahmt';
const database='projects/'+project+'/databases/(default)';
const api='https://firestore.googleapis.com/v1/'+database+'/documents';
const masks='mask.fieldPaths='+['id','origin','formId','sequence','analysisStarted','responsesClosedAt',
  'analysisClosed','preparedDescription'].join('&mask.fieldPaths=');
const apply=process.argv.includes('--apply');
const booleanValue=value=>({booleanValue:value});
const stringValue=value=>({stringValue:value});

async function main(){
  const token=await firebaseCliAccountToken('anestesiahmtforms3@gmail.com');
  async function request(url,body,allowMissing=false){
    const response=await fetch(url,{headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{method:'POST',body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
    if(allowMissing&&response.status===404)return null;
    if(!response.ok)throw Error('FC_OCCURRENCE_CARDS_HTTP_'+response.status);
    return response.json();
  }
  const billing=await request('https://cloudbilling.googleapis.com/v1/projects/'+project+'/billingInfo');
  if(billing.billingEnabled!==false)throw Error('FC_OCCURRENCE_CARDS_BILLING_ENABLED');
  const ids=[];
  let tokenPage='';
  do {
    const query='pageSize=100&mask.fieldPaths=id&mask.fieldPaths=origin'+(tokenPage?'&pageToken='+encodeURIComponent(tokenPage):'');
    const page=await request(api+'/occurrenceFollowups?'+query);
    for(const row of page.documents??[]){
      if(row.fields?.origin?.stringValue!=='app')continue;
      const id=row.fields.id?.stringValue;
      if(!/^[A-Fa-f0-9-]{36}$/.test(id)||!row.name.endsWith('/'+id))throw Error('FC_OCCURRENCE_CARDS_INVALID_ID');
      ids.push(id);
    }
    tokenPage=page.nextPageToken;
  }while(tokenPage);

  async function copy(id){
    const source='/occurrenceFollowups/'+id,destination='/occurrenceAnalysisCards/'+id;
    const transaction=apply?(await request(api+':beginTransaction',{options:{readWrite:{}}})).transaction:'';
    const query=transaction?'transaction='+encodeURIComponent(transaction)+'&':'';
    let committed=false;
    try {
      const entry=(await request(api+source+'?'+query+masks)).fields;
      if(entry.origin?.stringValue!=='app'||entry.id?.stringValue!==id||!/^F(?:0[1-9]|10)$/.test(entry.formId?.stringValue)||
        !/^[1-9]\d*$/.test(entry.sequence?.integerValue))throw Error('FC_OCCURRENCE_CARDS_INVALID_SOURCE');
      const opened=entry.analysisStarted?.booleanValue===true,published=entry.analysisClosed?.booleanValue===true;
      const fields={id:entry.id,origin:entry.origin,formId:entry.formId,sequence:entry.sequence,
        analysisStarted:booleanValue(opened),analysisClosed:booleanValue(published),
        responsesClosedAt:booleanValue(Boolean(entry.responsesClosedAt?.timestampValue)),
        preparedDescription:stringValue(opened?entry.preparedDescription?.stringValue??'':'')};
      if(published){
        const result=await request(api+source+'/ethicalPollResult/current?'+query+'mask.fieldPaths=updatedAt');
        if(!result.fields?.updatedAt?.timestampValue)throw Error('FC_OCCURRENCE_CARDS_INVALID_PUBLICATION');
        fields.resultAt=result.fields.updatedAt;
      }
      const current=await request(api+destination+(transaction?'?transaction='+encodeURIComponent(transaction):''),undefined,true);
      if(current){
        if(!isDeepStrictEqual(current.fields,fields))throw Error('FC_OCCURRENCE_CARDS_EXISTING_MISMATCH');
        return false;
      }
      if(apply){
        await request(api+':commit',{transaction,writes:[{
          update:{name:database+'/documents'+destination,fields},currentDocument:{exists:false}
        }]});
        committed=true;
      }
      return true;
    } finally {
      if(transaction&&!committed)await request(api+':rollback',{transaction});
    }
  }

  let missing=0;
  for(const id of ids)if(await copy(id))missing++;
  console.log(JSON.stringify({code:apply?'FC_OCCURRENCE_CARDS_BACKFILLED':'FC_OCCURRENCE_CARDS_PREVIEW',
    records:ids.length,existing:ids.length-missing,created:apply?missing:0,missing:apply?0:missing,billingEnabled:false}));
}
main().catch(error=>{
  console.error(/^FC_OCCURRENCE_CARDS_/.test(error.message)?error.message:'FC_OCCURRENCE_CARDS_FAILED');
  process.exitCode=1;
});
