import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createHtmlTrainingService} from '../worker-training/service.js';
import {verifyPreparedHtmlTrainings} from './prepare-html-trainings.mjs';

const verified=await verifyPreparedHtmlTrainings({workspaceRoot:process.cwd()});
const manifest=JSON.parse(await fs.readFile('.local-preview/html-training-import/manifest.private.json','utf8'));
const records=new Map(),allowed=new Set(['users','documentAccessEmails','htmlTrainings','htmlTrainingVersions','htmlTrainingContent','htmlTrainingSync']);
const copy=value=>value==null?null:structuredClone(value);
const store={
 async get(c,id){return copy(records.get(c+'/'+id));},
 async list(c,filters=[]){return [...records].filter(([key,value])=>key.startsWith(c+'/')&&filters.every(f=>value[f.field]===f.value)).map(([key,value])=>({...copy(value),id:key.slice(c.length+1)}));},
 async transaction(fn){
  const writes=[];
  const tx={get:store.get,getMany:(c,ids)=>Promise.all(ids.map(id=>store.get(c,id))),set:(c,id,data)=>writes.push({c,id,data}),create:(c,id,data)=>writes.push({c,id,data,create:true}),delete:()=>{throw Error('VALIDATION_DELETE_FORBIDDEN');}};
  const result=await fn(tx);
  for(const w of writes){if(!allowed.has(w.c)||w.create&&records.has(w.c+'/'+w.id))throw Error('VALIDATION_WRITE_SCOPE');}
  for(const w of writes)records.set(w.c+'/'+w.id,copy(w.data));
  return result;
 }
};
records.set('users/release-admin',{uid:'release-admin',active:true,access:true,role:'administrador_app'});
records.set('users/participant',{uid:'participant',active:true,access:true,role:'usuario'});
records.set('documentAccessEmails/participant@example.invalid',{email:'participant@example.invalid',active:true,groups:['GENERAL']});
const identity=uid=>({uid,email:uid+'@example.invalid',emailVerified:true,provider:'google.com'});
const service=createHtmlTrainingService({store});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let questions=0,audits=0,largestContentDocumentBytes=0;
for(const item of manifest.trainings){
 if(item.training.status!=='DRAFT'||item.training.managerUid!=='')throw Error('VALIDATION_INITIAL_PUBLICATION_FORBIDDEN');
 await service.execute('PUBLISH',{...item,expectedVersion:0},identity('release-admin'));
 const result=await service.execute('CONTENT',{trainingId:item.trainingId,version:1},identity('release-admin'));
 if(hash(result.sections)!==hash(item.sections))throw Error('VALIDATION_CONTENT_ROUNDTRIP');
 const opened=await service.execute('OPEN',{trainingId:item.trainingId},identity('release-admin'));
 if(opened.questions.length!==5||JSON.stringify(opened.questions).includes('correctOptionId'))throw Error('VALIDATION_PRIVATE_KEY_LEAK');
 questions+=item.bank.length;if(item.auditSchema)audits++;
}
for(const [key,value]of records)if(key.startsWith('htmlTrainingContent/'))largestContentDocumentBytes=Math.max(largestContentDocumentBytes,Buffer.byteLength(JSON.stringify(value)));
const visible=(await service.execute('LIST',{},identity('participant'))).trainings.length;
if(visible!==0||largestContentDocumentBytes>=800000)throw Error('VALIDATION_DRAFT_OR_SIZE');
const report={...verified,questions,auditSchemas:audits,contentRoundTrips:manifest.trainings.length,largestContentDocumentBytes,participantVisibleDrafts:visible,legacyWrites:0,remoteWrites:0,firestoreImported:false};
await fs.writeFile('.local-preview/html-training-package-validation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
