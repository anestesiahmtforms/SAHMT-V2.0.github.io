import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFile} from 'node:fs/promises';import {createHash,createHmac,randomUUID} from 'node:crypto';
import {initialDefinitions} from '../src/qmentum-catalog.js';
const code=(await readFile(new URL('../apps-script-v2/QmentumPrintCore.gs',import.meta.url),'utf8'))+'\n'+(await readFile(new URL('../apps-script-v2/QmentumPrints.gs',import.meta.url),'utf8'));
const uid='synthetic-manager',unitId='synthetic',root='qmentumUnits/'+unitId,key='S'.repeat(43),hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const documents=new Map([['users/'+uid,{uid,active:true,access:true}],['qmentumAccess/'+uid,{uid,active:true,role:'manager',units:[unitId]}],['qmentumConfig/current',{enabled:true,definitionVersion:1}],[root,{unitId,active:true}],['qmentumDefinitions/1',initialDefinitions()],[root+'/printConfig/current',{enabled:true,sourceYear:2026,minPeriod:'2026-07',folders:{TECHNIQUES:'tech-folder',INDICATORS:'event-folder'}}]]);
 const versions=new Map([...documents.keys()].map(k=>[k,'t1'])),properties=new Map([['QMENTUM_WRITE_ENABLED','true'],['SAHMT_OPERATIONAL_PUSH_HMAC_SECRET',key]]);let revision=1,reads=0,beforeCommit=null;
 const props={getProperty:k=>properties.get(k)||null,setProperty:(k,v)=>properties.set(k,v),deleteProperty:k=>properties.delete(k),getProperties:()=>Object.fromEntries(properties)};
 const context={Date,SAHMT_V2_CONFIG:{databaseId:'(default)'},sahmtV2Properties_:()=>props,sha256Hex_:hash,ospJson_:v=>v,ospEqual_:(a,b)=>a===b,qmWriteAssertFc_:()=>{if(context.SAHMT_V2_CONFIG.databaseId!=='(default)')throw Error('QMENTUM_FC_REQUIRED');},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  Utilities:{Charset:{UTF_8:'UTF-8'},DigestAlgorithm:{SHA_256:'sha256'},getUuid:randomUUID,computeDigest:(_,bytes)=>[...createHash('sha256').update(Buffer.from(bytes)).digest()],computeHmacSha256Signature:(value,secret)=>[...createHmac('sha256',secret).update(value).digest()],base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),base64Encode:value=>Buffer.from(value).toString('base64'),base64Decode:value=>[...Buffer.from(value,'base64')],base64DecodeWebSafe:value=>[...Buffer.from(value,'base64url')],newBlob:value=>({getDataAsString:()=>Buffer.from(value).toString('utf8'),getBytes:()=>[...Buffer.from(value)]})},
  qmServerGet_:path=>{reads++;const d=documents.get(path);return d?{...structuredClone(d),_name:path,_updateTime:versions.get(path)}:null;},
  qmServerWrite_:(path,data,old)=>({update:{path,data},currentDocument:old?{updateTime:old._updateTime}:{exists:false}}),
  qmServerCommit_:writes=>{beforeCommit?.();for(const w of writes){const path=(w.verify||w.update.path).replace(/^projects\/indicadores---sahmt\/databases\/\(default\)\/documents\//,'');if(w.currentDocument.exists===false?documents.has(path):versions.get(path)!==w.currentDocument.updateTime)throw Error('QMENTUM_VERSION_CONFLICT');}revision++;for(const w of writes)if(w.update){documents.set(w.update.path,structuredClone(w.update.data));versions.set(w.update.path,'t'+revision);}}
 };vm.createContext(context);vm.runInContext(code,context);
 const nativeOcr=context.qmPrintOcr_,sources=[{kind:'TECHNIQUES',id:'tech-image',name:'07.png',version:'1',modifiedTime:'2026-10-31T12:00:00Z',mimeType:'image/png',parents:['tech-folder']},{kind:'INDICATORS',id:'event-image',name:'07.png',version:'1',modifiedTime:'2026-10-31T12:00:00Z',mimeType:'image/png',parents:['event-folder']}];
 context.qmPrintList_=()=>structuredClone(sources);context.qmPrintMeta_=source=>structuredClone(sources.find(s=>s.id===source.id));
 context.qmPrintImage_=source=>({...source,bytes:[137,80,78,71,13,10,26,10,1,2,3,source.kind==='TECHNIQUES'?4:5]});
 context.qmPrintOcr_=image=>image.kind==='TECHNIQUES'?'Técnica anestésica | Quantidade\nGeral + Sedação | 8\nOutra Técnica | 2\nTotal geral | 10':'Total de registros: 20\nMudança de técnica anestésica: 1\nDM/hiperglicêmicos: 4';
 const call=(request,{nonce=randomUUID().replaceAll('-',''),tamper=false,expired=false}={})=>{
  const issuedAt=Date.now()-(expired?61000:0),payload=Buffer.from(JSON.stringify({v:1,aud:'sahmt-qmentum-prints',uid,nonce,issuedAt,expiresAt:issuedAt+60000,request})).toString('base64url');
  const result=context.qmPrintsHttp_({postData:{contents:JSON.stringify({payload,mac:tamper?'0'.repeat(64):createHmac('sha256',key).update('SAHMT_QMENTUM_PRINT_V1\n'+payload).digest('hex')})}});
  if(!result.payload)return result;assert.equal(result.mac,createHmac('sha256',key).update('SAHMT_QMENTUM_PRINT_V1\n'+result.payload).digest('hex'));return JSON.parse(Buffer.from(result.payload,'base64url'));
 };
 return{context,documents,versions,sources,properties,call,nativeOcr,reads:()=>reads,beforeCommit:fn=>beforeCommit=fn};
}
test('actual Apps Script scan and preview do not create months, and apply writes independent totals once',()=>{
 const f=fixture(),scan=f.call({operation:'SCAN',unitId,year:2026});assert.equal(scan.code,'QMENTUM_PRINT_SCAN');assert.equal(scan.result.candidates[0].status,'NEW');
 const response=f.call({operation:'PREVIEW',unitId,period:'2026-07',source:'DRIVE'});assert.equal(response.code,'QMENTUM_PRINT_PREVIEW');const p=response.result.preview;assert.equal(p.counts.anestheticProcedures,10);assert.equal(p.counts.surgical,20);assert.equal(f.documents.has(root+'/months/2026-07'),false);
 const request={operation:'APPLY',unitId,period:'2026-07',previewId:p.id,baseVersion:0,corrections:{},resolutions:{}};assert.equal(f.call(request).code,'QMENTUM_PRINT_APPLIED');assert.equal(f.documents.get(root+'/months/2026-07').inputs.counts.anestheticProcedures,10);assert.equal(f.documents.get(root+'/months/2026-07').inputs.counts.surgical,20);assert.equal(f.documents.get(root+'/months/2026-07').inputs.counts.effectiveGlucose,null);assert.equal(f.call(request).result.version,1);assert.equal([...f.documents.keys()].filter(k=>k.includes('/history/')).length,1);
});
test('bad signature, expiry, replay, inactive manager and historical scope cannot create a month',()=>{
 const f=fixture(),request={operation:'SCAN',unitId,year:2026};assert.match(f.call(request,{tamper:true}).code,/DENIED/);assert.equal(f.reads(),0);assert.match(f.call(request,{expired:true}).code,/EXPIRED|DENIED/);assert.equal(f.reads(),0);
 const nonce='a'.repeat(32);assert.equal(f.call(request,{nonce}).code,'QMENTUM_PRINT_SCAN');assert.match(f.call(request,{nonce}).code,/REPLAY/);f.documents.get('qmentumAccess/'+uid).active=false;assert.match(f.call(request).code,/PERMISSION/);assert.match(f.call({operation:'PREVIEW',unitId,period:'2026-06',source:'DRIVE'}).code,/SCOPE|PERMISSION/);assert.equal(f.documents.has(root+'/months/2026-07'),false);
});
test('a Drive edit after preview and manager revocation during the atomic commit prevent the import',()=>{
 const f=fixture(),p=f.call({operation:'PREVIEW',unitId,period:'2026-07',source:'DRIVE'}).result.preview,request={operation:'APPLY',unitId,period:'2026-07',previewId:p.id,baseVersion:0,corrections:{},resolutions:{}};
 f.sources[0].version='2';assert.match(f.call(request).code,/SOURCE_CHANGED/);assert.equal(f.documents.has(root+'/months/2026-07'),false);f.sources[0].version='1';
 f.beforeCommit(()=>{f.documents.get('qmentumAccess/'+uid).active=false;f.versions.set('qmentumAccess/'+uid,'t-new');});assert.match(f.call(request).code,/VERSION_CONFLICT/);assert.equal(f.documents.has(root+'/months/2026-07'),false);
});
test('metadata changes with identical image content skip OCR and create no month revision',()=>{
 const f=fixture(),p=f.call({operation:'PREVIEW',unitId,period:'2026-07',source:'DRIVE'}).result.preview;
 f.call({operation:'APPLY',unitId,period:'2026-07',previewId:p.id,baseVersion:0,corrections:{},resolutions:{}});f.sources[0].version='2';f.context.qmPrintOcr_=()=>{throw Error('OCR_MUST_NOT_RUN');};
 const next=f.call({operation:'PREVIEW',unitId,period:'2026-07',source:'DRIVE'});assert.equal(next.result.status,'UNCHANGED');assert.equal(f.documents.get(root+'/months/2026-07').version,1);assert.equal(f.call({operation:'SCAN',unitId,year:2026}).result.candidates[0].status,'UNCHANGED');
});
test('native OCR rejects invalid image bytes and trashes only its temporary document after extraction failure',()=>{
 const f=fixture(),calls=[];f.context.qmPrintDriveFetch_=(url,options={})=>{calls.push({url,options});if(url.includes('/export?'))throw Error('QMENTUM_PRINT_DRIVE_UNAVAILABLE');return{getContentText:()=>url.includes('/upload/')?JSON.stringify({id:'temporary-ocr-document',shared:false}):'{}'};};
 assert.throws(()=>f.nativeOcr({mimeType:'image/png',bytes:[1,2,3,4,5,6,7,8]}),/IMAGE_INVALID/);assert.equal(calls.length,0);
 assert.throws(()=>f.nativeOcr({mimeType:'image/png',bytes:[137,80,78,71,13,10,26,10]}),/DRIVE_UNAVAILABLE/);assert.equal(calls.length,3);assert.equal(calls.at(-1).options.method,'patch');assert.equal(calls.at(-1).url,'https://www.googleapis.com/drive/v3/files/temporary-ocr-document');assert.equal(JSON.parse(calls.at(-1).options.payload).trashed,true);
});
