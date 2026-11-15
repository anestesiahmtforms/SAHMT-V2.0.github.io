import {createHash} from 'node:crypto';
import {validateDocumentBytes} from '../worker-training/professional-documents.js';
import {isVaccinationAdmin,VACCINES,VACCINATION_YEARS} from '../src/vaccination-domain.js';

const PROOFS='feVaccinationProofs', CHUNKS='feVaccinationProofChunks', LIMITS='feVaccinationProofLimits';
const chunkLength=768*1024;
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const uid=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value)&&!['.','..'].includes(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const display=row=>({id:row.requestId,name:row.name,mimeType:row.mimeType,size:row.size,year:row.year,subject:row.subject,status:'STORED',uploadedAt:row.uploadedAt});
const fields={
 LIST_OWN:[],
 LIST_ADMIN:['uid'],
 GET:['uid','requestId'],
 UPLOAD:['subject','requestId','mimeType','dataBase64']
};

export function createVaccinationProofService({store,authorize,now=Date.now}){
 return {async execute(action,input,identity){
  if(!Object.hasOwn(fields,action)||input.context!=='VACCINATION'||!VACCINATION_YEARS.includes(input.year)||
     Object.keys(input).some(key=>!['context','year',...fields[action]].includes(key)))fail('DOCUMENT_INPUT_INVALID');
  if(!uid(identity?.uid))fail('DOCUMENT_SESSION_INVALID',401);
  if(input.uid!==undefined&&!uid(input.uid))fail('DOCUMENT_INPUT_INVALID');
  const target=input.uid||identity.uid;
  return store.transaction(async tx=>{
   const profile=await authorize(tx,identity);
   if((action==='LIST_ADMIN'||target!==identity.uid)&&!isVaccinationAdmin(profile))fail('DOCUMENT_FORBIDDEN',403);
   if(action==='LIST_OWN'||action==='LIST_ADMIN'){
    const filters=[{field:'year',op:'EQUAL',value:input.year}];
    if(action==='LIST_OWN'||input.uid)filters.push({field:'uid',op:'EQUAL',value:target});
    const rows=await tx.list(PROOFS,filters,1000);
    return {uploadsEnabled:true,folderConfigured:true,documents:rows.map(row=>({
     ...display(row),...(action==='LIST_ADMIN'?{uid:row.uid,email:row.email}:{})
    }))};
   }
   if(!uuid(input.requestId))fail('DOCUMENT_INPUT_INVALID');
   const key=target+'_'+input.requestId.toLowerCase(),prior=await tx.get(PROOFS,key);
   if(action==='GET'){
    if(!prior||prior.uid!==target||prior.year!==input.year)fail('DOCUMENT_NOT_FOUND',404);
    if(!Number.isInteger(prior.parts)||prior.parts<1||prior.parts>10)fail('DOCUMENT_UNAVAILABLE',503);
    const rowIds=Array.from({length:prior.parts},(_,i)=>key+'_'+i);
    const chunks=await tx.getMany(CHUNKS,rowIds);
    if(chunks.some(chunk=>typeof chunk?.data!=='string'))fail('DOCUMENT_UNAVAILABLE',503);
    return {document:display(prior),dataBase64:chunks.map(chunk=>chunk.data).join('')};
   }
   if(!VACCINES.some(v=>v.id===input.subject))fail('DOCUMENT_INPUT_INVALID');
   const bytes=validateDocumentBytes(input.mimeType,input.dataBase64);
   const digest=createHash('sha256').update(JSON.stringify([input.year,input.subject,input.mimeType])).update(bytes).digest('hex');
   if(prior){
    if(prior.digest!==digest||prior.uid!==target)fail('DOCUMENT_UPLOAD_CONFLICT',409);
    return {document:display(prior)};
   }
   const uploadedAt=now(),day=new Date(uploadedAt).toISOString().slice(0,10),limitKey=target+'_'+day;
   const daily=await tx.get(LIMITS,limitKey);
   if((daily?.count||0)>=30)fail('DOCUMENT_UPLOAD_LIMIT',429);
   const {year,subject,mimeType,requestId,dataBase64}=input;
   const parts=Math.ceil(dataBase64.length/chunkLength);
   const name=`${year}_${subject}_${requestId}.${mimeType==='application/pdf'?'pdf':'jpg'}`;
   const row={uid:target,email:identity.email,year,subject,mimeType,requestId,name,uploadedAt,size:bytes.length,digest,parts};
   for(let i=0;i<parts;i++)tx.create(CHUNKS,key+'_'+i,{data:dataBase64.slice(i*chunkLength,(i+1)*chunkLength)});
   tx.create(PROOFS,key,row);
   tx.set(LIMITS,limitKey,{count:(daily?.count||0)+1});
   return {document:display(row)};
  });
 }};
}