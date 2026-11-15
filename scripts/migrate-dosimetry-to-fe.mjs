import {firebaseCliAccountToken} from './lib/firebase-cli-account-token.js';
import {validateDosimetryRecord} from '../src/dosimetry-domain.js';
import {decodeFields} from '../worker-training/firestore.js';
import {isDeepStrictEqual} from 'node:util';

const source='sahmt-gestao-5ae66',destination='outros-48120',collection='occupationalDosimetry';
const args=process.argv.slice(2);
if(args.some(arg=>arg!=='--apply')||args.length>1)throw Error('DOSIMETRY_MIGRATION_FLAGS_INVALID');

const [fbToken,feToken]=await Promise.all([
 firebaseCliAccountToken('anestesiahmtforms2@gmail.com'),
 firebaseCliAccountToken('anestesiahmtforms5@gmail.com')
]);
const firestore='https://firestore.googleapis.com/v1/';
const root=project=>`projects/${project}/databases/(default)/documents`;
async function fetchJson(url,token,body){
 const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});
 if(!response.ok){await response.body?.cancel();throw Error('DOSIMETRY_MIGRATION_HTTP_'+response.status);}
 return response.json();
}
async function list(project,token,name,fields=[]){
 const result=[];
 let cursor;
 do {
  const params=new URLSearchParams({pageSize:'200',...(cursor?{pageToken:cursor}:{})});
  for(const field of fields)params.append('mask.fieldPaths',field);
  const page=await fetchJson(firestore+root(project)+'/'+name+'?'+params,token);
  if((page.documents||[]).some(row=>!row.name?.startsWith(root(project)+'/'+name+'/')))throw Error('DOSIMETRY_MIGRATION_WRONG_SOURCE');
  result.push(...(page.documents||[]));
  cursor=page.nextPageToken;
 }while(cursor);
 return result;
}
const id=row=>row.name.split('/').at(-1);
const [before,existing,users,billing]=await Promise.all([
 list(source,fbToken,collection),list(destination,feToken,collection),
 list(destination,feToken,'users',['email','uid']),
 fetchJson('https://cloudbilling.googleapis.com/v1/projects/'+destination+'/billingInfo',feToken)
]);
if(billing.billingEnabled!==false)throw Error('DOSIMETRY_MIGRATION_REQUIRES_SPARK');
const profiles=new Map(users.map(row=>[id(row),decodeFields(row.fields||{})]));
const destinationRows=new Map(existing.map(row=>[id(row),row]));
const writes=[];
for(const row of before){
 const record=validateDosimetryRecord(decodeFields(row.fields||{}));
 const expected=record.uid+'_'+record.year,profile=profiles.get(record.uid);
 if(id(row)!==expected||profile?.uid!==record.uid||profile.email?.trim().toLowerCase()!==record.email.trim().toLowerCase())
  throw Error('DOSIMETRY_MIGRATION_IDENTITY_MISMATCH');
 const current=destinationRows.get(expected);
 if(current){
  if(!isDeepStrictEqual(current.fields,row.fields))throw Error('DOSIMETRY_MIGRATION_DESTINATION_CONFLICT');
 }else writes.push({update:{name:root(destination)+'/'+collection+'/'+expected,fields:row.fields},currentDocument:{exists:false}});
}
if(!before.length||writes.length>200)throw Error('DOSIMETRY_MIGRATION_REVIEW_REQUIRED');
if(args.length&&writes.length){
 await fetchJson(firestore+root(destination)+':commit',feToken,{writes});
 const confirmed=new Map((await list(destination,feToken,collection)).map(row=>[id(row),row.fields]));
 if(before.some(row=>!isDeepStrictEqual(row.fields,confirmed.get(id(row)))))throw Error('DOSIMETRY_MIGRATION_VERIFICATION_FAILED');
}
console.log(JSON.stringify({source,destination,recordsVerified:before.length,recordsPending:writes.length,recordsCopied:args.length?writes.length:0}));