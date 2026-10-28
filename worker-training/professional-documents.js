import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {isVaccinationAdmin,VACCINATION_YEARS,VACCINES} from '../src/vaccination-domain.js';

export const DOCUMENT_CONTEXTS=Object.freeze({VACCINATION:'Vacinação',REGISTRATION:'Documentação cadastral',CERTIFICATES:'Certificados e cursos',PROFESSIONAL:'Documentação profissional'});
const C={profiles:'users',folders:'professionalDocumentFolders',uploads:'professionalDocumentUploads',limits:'professionalDocumentUploadLimits'};
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const keys=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('DOCUMENT_INPUT_INVALID');};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const publicDocument=row=>({id:row.requestId,name:row.name,mimeType:row.mimeType,size:row.size,year:row.year,subject:row.subject,status:row.status,uploadedAt:row.uploadedAt??null});
function selection(input,extra=[]){keys(input,['context','year',...extra]);if(!Object.hasOwn(DOCUMENT_CONTEXTS,input.context)||!VACCINATION_YEARS.includes(input.year))fail('DOCUMENT_INPUT_INVALID');}
export function validateDocumentBytes(mimeType,dataBase64){
 if(typeof dataBase64!=='string'||!dataBase64.length||dataBase64.length>Math.ceil(5*1024*1024/3)*4+4)fail('DOCUMENT_FILE_TOO_LARGE',413);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)||dataBase64.length%4!==0)fail('DOCUMENT_FILE_INVALID');
 const bytes=Buffer.from(dataBase64,'base64');if(bytes.toString('base64')!==dataBase64)fail('DOCUMENT_FILE_INVALID');
 if(mimeType==='application/pdf'){
  if(bytes.length>5*1024*1024)fail('DOCUMENT_FILE_TOO_LARGE',413);
  if(bytes.length<10||bytes.subarray(0,5).toString()!=='%PDF-'||!bytes.subarray(-2048).includes(Buffer.from('%%EOF')))fail('DOCUMENT_FILE_INVALID');
 }else if(mimeType==='image/jpeg'){
  if(bytes.length>2*1024*1024)fail('DOCUMENT_FILE_TOO_LARGE',413);
  if(bytes.length<20||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||bytes.at(-2)!==255||bytes.at(-1)!==217)fail('DOCUMENT_FILE_INVALID');
  let offset=2,dimensions;
  while(offset+4<bytes.length){
   if(bytes[offset++]!==255)fail('DOCUMENT_FILE_INVALID');let marker=bytes[offset++];while(marker===255)marker=bytes[offset++];
   if(marker===218||marker===217)break;if(marker===1||marker>=208&&marker<=215)continue;
   const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)fail('DOCUMENT_FILE_INVALID');
   if([192,193,194].includes(marker)){if(length<8)fail('DOCUMENT_FILE_INVALID');dimensions={height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)};break;}offset+=length;
  }
  if(!dimensions||dimensions.width<1||dimensions.height<1||Math.max(dimensions.width,dimensions.height)>1600)fail('DOCUMENT_IMAGE_DIMENSIONS_INVALID');
 }else fail('DOCUMENT_FILE_TYPE_INVALID');
 return bytes;
}
export function createProfessionalDocumentService({store,drive,now=Date.now}={}){
 const actor=async(identity,tx=store)=>{
  if(!identity||!identifier(identity.uid)||identity.provider!=='google.com'||identity.emailVerified!==true||typeof identity.email!=='string')fail('DOCUMENT_SESSION_INVALID',401);
  const p=await tx.get(C.profiles,identity.uid);
  if(!p||p.active!==true||p.access!==true||p.uid&&p.uid!==identity.uid||String(p.email||'').toLowerCase()!==identity.email.toLowerCase())fail('DOCUMENT_FORBIDDEN',403);
  return p;
 };
 async function folder(identity,context){
  const f=await store.get(C.folders,identity.uid);
  if(!f||f.active!==true||f.uid!==identity.uid||String(f.email).toLowerCase()!==identity.email.toLowerCase()||!identifier(f.rootFolderId)||!identifier(f.professionalFolderId)||!identifier(f.categories?.[context]))fail('DOCUMENT_FOLDER_NOT_CONFIGURED',403);
  return f;
 }
 async function finalize(identity,key,journal){
  return store.transaction(async tx=>{
   await actor(identity,tx);const current=await tx.get(C.uploads,key);
   if(!current||current.digest!==journal.digest||current.fileId!==journal.fileId)fail('DOCUMENT_UPLOAD_CONFLICT',409);
   const mapping=await tx.get(C.folders,identity.uid);if(mapping?.active!==true||mapping.uid!==identity.uid||mapping.email?.toLowerCase()!==identity.email.toLowerCase()||mapping.rootFolderId!==journal.rootFolderId||mapping.professionalFolderId!==journal.professionalFolderId||mapping.categories?.[journal.context]!==journal.folderId)fail('DOCUMENT_FOLDER_CHANGED',409);
   const saved={...current,status:'STORED',uploadedAt:current.uploadedAt||now()};tx.set(C.uploads,key,saved);return {document:publicDocument(saved)};
  });
 }
 return {async execute(action,input,identity){
  const profile=await actor(identity);
  if(action==='LIST_OWN'||action==='LIST_ADMIN'){
   selection(input,action==='LIST_ADMIN'?['uid']:[]);
   if(action==='LIST_ADMIN'&&!isVaccinationAdmin(profile))fail('DOCUMENT_FORBIDDEN',403);
   if(input.uid!==undefined&&!identifier(input.uid))fail('DOCUMENT_INPUT_INVALID');
   const uid=action==='LIST_OWN'?identity.uid:input.uid;
   const filters=[{field:'context',op:'EQUAL',value:input.context},{field:'year',op:'EQUAL',value:input.year},...(uid?[{field:'uid',op:'EQUAL',value:uid}]:[])];
   const rows=await store.list(C.uploads,filters,1000);
   const currentProfile=await actor(identity);if(action==='LIST_ADMIN'&&!isVaccinationAdmin(currentProfile))fail('DOCUMENT_FORBIDDEN',403);
   let folderConfigured=false;if(action==='LIST_OWN'){try{await folder(identity,input.context);folderConfigured=true;}catch(e){if(e.code!=='DOCUMENT_FOLDER_NOT_CONFIGURED')throw e;}}
   return {uploadsEnabled:drive?.ready===true,folderConfigured,documents:rows.filter(r=>r.status==='STORED').map(r=>({...publicDocument(r),...(action==='LIST_ADMIN'?{uid:r.uid,email:r.email,url:`https://drive.google.com/file/d/${r.fileId}/view`}:{})}))};
  }
  if(action!=='UPLOAD')fail('DOCUMENT_ACTION_INVALID');
  selection(input,['subject','requestId','mimeType','dataBase64']);
  if(!uuid(input.requestId)||(input.context==='VACCINATION'?!VACCINES.some(v=>v.id===input.subject):input.subject!=='document'))fail('DOCUMENT_INPUT_INVALID');
  if(drive?.ready!==true)fail('DOCUMENT_DRIVE_NOT_CONNECTED',503);
  const bytes=validateDocumentBytes(input.mimeType,input.dataBase64),f=await folder(identity,input.context);
  await drive.verifyDestination(f.categories[input.context],f.professionalFolderId,f.rootFolderId);
  const digest=createHash('sha256').update(JSON.stringify([identity.uid,input.context,input.year,input.subject,input.mimeType])).update(bytes).digest('hex');
  const key=identity.uid+'_'+input.requestId,previous=await store.get(C.uploads,key);
  const fileId=previous?.fileId||await drive.allocateId();if(!identifier(fileId))fail('DOCUMENT_DRIVE_UNAVAILABLE',503);
  const journal=await store.transaction(async tx=>{
   await actor(identity,tx);const mapping=await tx.get(C.folders,identity.uid);
   if(mapping?.active!==true||mapping.email?.toLowerCase()!==identity.email.toLowerCase()||mapping.rootFolderId!==f.rootFolderId||mapping.professionalFolderId!==f.professionalFolderId||mapping.categories?.[input.context]!==f.categories[input.context])fail('DOCUMENT_FOLDER_CHANGED',409);
   const old=await tx.get(C.uploads,key);
   if(old){if(old.folderId!==f.categories[input.context]||old.professionalFolderId!==f.professionalFolderId||old.rootFolderId!==f.rootFolderId)fail('DOCUMENT_FOLDER_CHANGED',409);if(old.uid!==identity.uid||old.digest!==digest)fail('DOCUMENT_UPLOAD_CONFLICT',409);return old;}
   const day=new Date(now()).toISOString().slice(0,10),limitId=identity.uid+'_'+day,limit=await tx.get(C.limits,limitId);
   if((limit?.count||0)>=30)fail('DOCUMENT_UPLOAD_LIMIT',429);
   const name=`${input.year}_${input.subject}_${input.requestId}.${input.mimeType==='application/pdf'?'pdf':'jpg'}`;
   const row={uid:identity.uid,email:identity.email.toLowerCase(),context:input.context,year:input.year,subject:input.subject,requestId:input.requestId,mimeType:input.mimeType,size:bytes.length,digest,fileId,folderId:f.categories[input.context],rootFolderId:f.rootFolderId,professionalFolderId:f.professionalFolderId,name,status:'PENDING',createdAt:now()};
   tx.set(C.limits,limitId,{uid:identity.uid,day,count:(limit?.count||0)+1});tx.create(C.uploads,key,row);return row;
  });
  if(journal.status==='STORED'){await actor(identity);return {document:publicDocument(journal)};}
  await actor(identity);
  const check=file=>file?.id===journal.fileId&&file.shared===false&&file.parents?.includes(journal.folderId)&&file.appProperties?.sahmtDigest===digest&&file.mimeType===input.mimeType&&Number(file.size)===bytes.length;
  let stored=await drive.getFile(journal.fileId);
  if(stored&&!check(stored))fail('DOCUMENT_UPLOAD_CONFLICT',409);
  if(!stored){
   try{stored=await drive.upload({id:journal.fileId,folderId:journal.folderId,name:journal.name,mimeType:input.mimeType,digest,bytes});}
   catch(error){stored=await drive.getFile(journal.fileId);if(!stored)throw error;}
  }
  if(!check(stored))fail('DOCUMENT_DRIVE_UNCONFIRMED',503);
  return finalize(identity,key,journal);
 }};
}
