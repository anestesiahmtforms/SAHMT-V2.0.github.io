import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const source=readFileSync(new URL('../apps-script-v2/DiretrizesReading.gs',import.meta.url),'utf8');
function fixture(){
 const bytes=Array.from(Buffer.from('%PDF-1.7\n'+ 'material '.repeat(15000))),checksum=createHash('md5').update(Buffer.from(bytes)).digest('hex'),row={pdfId:'SyntheticPdf1234567',checksum},values=new Map();let downloads=0,metadataCalls=0,unavailable=false;
 const cache={get:k=>values.get(k)||null,getAll:keys=>Object.fromEntries(keys.filter(k=>values.has(k)).map(k=>[k,values.get(k)])),put:(k,v,ttl)=>{assert.equal(ttl,600);values.set(k,v);},putAll:(parts,ttl)=>{assert.equal(ttl,600);for(const [k,v]of Object.entries(parts)){assert.ok(Buffer.byteLength(v)<=100000);values.set(k,v);}}};
 const metadata={id:row.pdfId,mimeType:'application/pdf',size:String(bytes.length),md5Checksum:checksum,trashed:false};
 const ctx=vm.createContext({CacheService:{getScriptCache:()=>{if(unavailable)throw Error('cache unavailable');return cache;}},sha256Hex_:s=>createHash('sha256').update(s).digest('hex'),formsEvaluationGoogleRequest_:()=>{metadataCalls++;return metadata;},
  DriveApp:{getFileById:()=>({getBlob:()=>({getBytes:()=>{downloads++;return bytes;}})})},
  Utilities:{base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>Array.from(Buffer.from(s,'base64')),DigestAlgorithm:{MD5:'md5'},computeDigest:(_alg,b)=>Array.from(createHash('md5').update(Buffer.from(b)).digest())}});
 vm.runInContext(source,ctx);return {ctx,row,metadata,values,stats:()=>({downloads,metadataCalls}),failCache:()=>{unavailable=true;}};
}
test('warm PDF cache skips Drive download but always verifies current metadata',()=>{
 const f=fixture(),first=f.ctx.dgrPdf_(f.row,true),second=f.ctx.dgrPdf_(f.row,true);assert.equal(first.bytes,second.bytes);assert.deepEqual(f.stats(),{downloads:1,metadataCalls:2});
 f.metadata.md5Checksum='b'.repeat(32);assert.throws(()=>f.ctx.dgrPdf_(f.row,true),/READING_MATERIAL_CHANGED/);assert.equal(f.stats().downloads,1);
});
test('missing, corrupted shards and cache outage fall back to Drive',()=>{
 for(const mode of ['missing','corrupt','outage']){const f=fixture();f.ctx.dgrPdf_(f.row,true);const key=f.ctx.dgrPdfCacheKey_(f.row)+'_0';if(mode==='missing')f.values.delete(key);if(mode==='corrupt')f.values.set(key,'X'.repeat(f.values.get(key).length));if(mode==='outage')f.failCache();assert.match(f.ctx.dgrPdf_(f.row,true).bytes,/^JVBER/);assert.equal(f.stats().downloads,2);}
});
test('cache key includes source identity and checksum; metadata-only actions never download',()=>{
 const f=fixture();f.ctx.dgrPdf_(f.row,false);assert.equal(f.stats().downloads,0);assert.notEqual(f.ctx.dgrPdfCacheKey_(f.row),f.ctx.dgrPdfCacheKey_({...f.row,pdfId:'OtherPdf1234567'}));assert.notEqual(f.ctx.dgrPdfCacheKey_(f.row),f.ctx.dgrPdfCacheKey_({...f.row,checksum:'c'.repeat(32)}));
 assert.equal(f.ctx.dgrCachedPdf_(f.row,3*1024*1024),null);
});
