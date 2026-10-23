import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

/** Private input: entries[{documentId,formId|null,pdfId,filePath,version,category?,audienceGroup?,pdfDocumentId?,sourceFileId?}], pilotUids[]. */
export async function prepareReadingPolicy(input,{loadPdf}={}){
 if(!Array.isArray(input?.entries)||!input.entries.length||input.entries.length>1000||!Array.isArray(input.pilotUids)||!input.pilotUids.length||input.pilotUids.length>1000||
  input.pilotUids.some(uid=>typeof uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(uid)))throw Error('READING_PREPARATION_INPUT_INVALID');
 const documents=Object.create(null),forms=new Set();let pageCount=0,maxBytes=0;
 const parser=loadPdf||((await import('pdfjs-dist/legacy/build/pdf.mjs')).getDocument);
 for(const entry of input.entries){
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(entry.documentId||'')||(entry.formId!=null && entry.documentId!=='evaluation_'+entry.formId)||
   (entry.formId!=null && !/^[A-Za-z0-9_-]{10,200}$/.test(entry.formId))||!/^[A-Za-z0-9_-]{10,200}$/.test(entry.pdfId||'')||
   !Number.isSafeInteger(entry.version)||entry.version<1||typeof entry.filePath!=='string'||!isAbsolute(entry.filePath)||Object.hasOwn(documents,entry.documentId)||(entry.formId!=null && forms.has(entry.formId))||!['GENERAL','RESTRICTED'].includes(entry.audienceGroup||'GENERAL')||!['DIRETRIZES','PROTOCOLOS','ROPS','DOCUMENTOS ADMINISTRATIVOS','ORGANOGRAMA'].includes(String(entry.category||'DIRETRIZES').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase())||(entry.sourceFileId!==undefined&&!/^[A-Za-z0-9_-]{10,200}$/.test(entry.sourceFileId))||(entry.pdfDocumentId!==undefined&&!/^[A-Za-z0-9_-]{1,200}$/.test(entry.pdfDocumentId)))throw Error('READING_PREPARATION_INPUT_INVALID');
  if(entry.formId)forms.add(entry.formId);const bytes=await readFile(entry.filePath);
  if(bytes.length>8*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw Error('READING_PREPARATION_PDF_INVALID');
  const task=parser({data:new Uint8Array(bytes),isEvalSupported:false,stopAtErrors:true});let pdf;
  try{pdf=await task.promise;
   if(!Number.isSafeInteger(pdf.numPages)||pdf.numPages<1||pdf.numPages>300)throw Error('READING_PREPARATION_PAGE_LIMIT');
   const checksum=createHash('md5').update(bytes).digest('hex');
   if(entry.expectedChecksum&&entry.expectedChecksum!==checksum)throw Error('READING_PREPARATION_CHECKSUM_CHANGED');
   documents[entry.documentId]={formId:entry.formId||null,...(entry.category?{category:entry.category}:{}),...(entry.audienceGroup?{audienceGroup:entry.audienceGroup}:{}),...(entry.sourceFileId?{sourceFileId:entry.sourceFileId}:{}),...(entry.pdfDocumentId?{pdfDocumentId:entry.pdfDocumentId}:{}),pdfId:entry.pdfId,checksum,pages:pdf.numPages,version:entry.version,enforced:false};
   pageCount+=pdf.numPages;maxBytes=Math.max(maxBytes,bytes.length);
  }finally{await task.destroy();}
 }
 const policy={version:1,pilotUids:[...new Set(input.pilotUids)],documents};
 const properties=readingPolicyProperties(policy);
 return {policy,properties,report:{code:'READING_PRIVATE_PACKAGE_READY',documents:Object.keys(documents).length,pages:pageCount,maxPdfBytes:maxBytes,enabled:false,remoteWrites:0}};
}
export function readingPolicyProperties(policy){
 const raw=JSON.stringify(policy);
 if(Buffer.byteLength(raw,'utf8')<=8000)return {SAHMT_READING_POLICY_JSON:raw};
 const sha256=createHash('sha256').update(raw).digest('hex'),parts=[];let part='',size=0;
 for(const char of raw){const bytes=Buffer.byteLength(char,'utf8');if(size+bytes>7000){parts.push(part);part='';size=0;}part+=char;size+=bytes;}if(part)parts.push(part);
 if(parts.length>64)throw Error('READING_PREPARATION_PROPERTY_LIMIT');
 return {...Object.fromEntries(parts.map((value,index)=>['SAHMT_READING_POLICY_'+sha256+'_'+index,value])),SAHMT_READING_POLICY_JSON:JSON.stringify({storageVersion:2,count:parts.length,sha256})};
}
async function main(){
 const args=process.argv.slice(2);if(args.length!==2)throw Error('READING_PREPARATION_ARGUMENTS_REQUIRED');
 const repo=await realpath(fileURLToPath(new URL('..',import.meta.url))),target=resolve(args[1]);
 const parent=await realpath(dirname(target)),inside=relative(repo,parent);
 if(!inside||(!inside.startsWith('..')&&!isAbsolute(inside)))throw Error('READING_PRIVATE_OUTPUT_REQUIRED');
 const input=JSON.parse(await readFile(resolve(args[0]),'utf8'));
 const result=await prepareReadingPolicy(input);
 await writeFile(target,JSON.stringify({policy:result.policy,properties:result.properties}),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result.report));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('READING_PRIVATE_PREPARATION_FAILED');process.exitCode=1;});
