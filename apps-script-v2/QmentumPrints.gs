// Two-print input: manager-only FC previews, source fingerprints and CAS writes.
function qmPrintFail_(code){throw Error('QMENTUM_PRINT_'+code);}
function qmPrintMac_(payload,key){return Utilities.computeHmacSha256Signature('SAHMT_QMENTUM_PRINT_V1\n'+payload,key,Utilities.Charset.UTF_8).map(function(n){return('0'+((n+256)%256).toString(16)).slice(-2);}).join('');}
function qmPrintHex_(bytes){return bytes.map(function(n){return('0'+((n+256)%256).toString(16)).slice(-2);}).join('');}
function qmPrintBytesHash_(bytes){return qmPrintHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes));}
function qmPrintPlain_(value){return value&&typeof value==='object'&&!Array.isArray(value);}
function qmPrintQuotaGuard_(){if(typeof sahmtUrlFetchPause_==='function'&&sahmtUrlFetchPause_())qmPrintFail_('QUOTA_WAIT');}
function qmPrintKeys_(value,allowed){return qmPrintPlain_(value)&&Object.keys(value).every(function(k){return allowed.indexOf(k)>=0;});}
function qmPrintContext_(uid,unitId){
 qmWriteAssertFc_();qmPrintQuotaGuard_();if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid||'')||!/^[A-Za-z0-9_-]{1,80}$/.test(unitId||''))qmPrintFail_('PERMISSION_DENIED');
 const documents=new Map();['users/'+uid,'qmentumAccess/'+uid,'qmentumConfig/current','qmentumUnits/'+unitId].forEach(function(path){let d;try{d=qmServerGet_(path);}catch(e){qmPrintQuotaGuard_();throw e;}if(d)documents.set(path,d);});
 QmentumPrintCore.assertPrintAccess({documents:documents,uid:uid,unitId:unitId});return documents;
}
function qmPrintRead_(documents,path){if(!documents.has(path)){let d;try{d=qmServerGet_(path);}catch(e){qmPrintQuotaGuard_();throw e;}if(d)documents.set(path,d);}return documents.get(path)||null;}
function qmPrintConfig_(documents,unitId){
 const c=qmPrintRead_(documents,'qmentumUnits/'+unitId+'/printConfig/current');
 if(c?.enabled!==true||!Number.isInteger(c.sourceYear)||c.sourceYear<2026||c.sourceYear>2200||c.minPeriod!=='2026-07'||!c.folders||!['TECHNIQUES','INDICATORS'].every(function(k){return /^[A-Za-z0-9_-]{10,200}$/.test(c.folders[k]||'');})||c.folders.TECHNIQUES===c.folders.INDICATORS)qmPrintFail_('SOURCE_CONFIG_REQUIRED');return c;
}
function qmPrintDriveFetch_(url,options){
 if(!/^https:\/\/www\.googleapis\.com\/(?:upload\/)?drive\/v3\//.test(url))qmPrintFail_('DRIVE_ENDPOINT_DENIED');
 qmPrintQuotaGuard_();
 const opts=Object.assign({method:'get'},options||{});opts.headers=Object.assign({},opts.headers||{},{Authorization:'Bearer '+ScriptApp.getOAuthToken()});opts.muteHttpExceptions=true;opts.followRedirects=false;
 let response;try{const perform=function(){sahmtRequireFolders_(['registros/qmentum'],qmServerUrl_('/runtimePolicy/folders').replace(/\/runtimePolicy\/folders$/,''));return UrlFetchApp.fetch(url,opts);};response=typeof sahmtUrlFetchRun_==='function'?sahmtUrlFetchRun_(perform):perform();}catch(e){if(e.code==='SAHMT_URLFETCH_DAILY_QUOTA'||typeof sahmtUrlFetchDailyQuota_==='function'&&sahmtUrlFetchDailyQuota_(e))qmPrintFail_('QUOTA_WAIT');throw e;}const status=response.getResponseCode();if(status<200||status>=300)qmPrintFail_('DRIVE_UNAVAILABLE');return response;
}
function qmPrintDriveJson_(url,options){const text=qmPrintDriveFetch_(url,options).getContentText();if(text.length>250000)qmPrintFail_('DRIVE_RESPONSE_LIMIT');return JSON.parse(text||'{}');}
function qmPrintList_(config){
 const files=[];['TECHNIQUES','INDICATORS'].forEach(function(kind){
  const query="'"+config.folders[kind]+"' in parents and trashed = false",result=qmPrintDriveJson_('https://www.googleapis.com/drive/v3/files?q='+encodeURIComponent(query)+'&pageSize=100&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,version,md5Checksum,parents)');
  if(!Array.isArray(result.files)||result.nextPageToken)qmPrintFail_('SOURCE_LIMIT');
  result.files.forEach(function(f){files.push(Object.assign({},f,{kind:kind,checksum:f.md5Checksum||null}));});
 });return files;
}
function qmPrintMeta_(source,config){
 if(!/^[A-Za-z0-9_-]{1,200}$/.test(source.id||''))qmPrintFail_('SOURCE_INVALID');
 const meta=qmPrintDriveJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(source.id)+'?fields=id,name,mimeType,size,modifiedTime,version,md5Checksum,parents,trashed');
 if(meta.trashed||!Array.isArray(meta.parents)||meta.parents.indexOf(config.folders[source.kind])<0)qmPrintFail_('SOURCE_CHANGED');return Object.assign({},meta,{kind:source.kind,checksum:meta.md5Checksum||null});
}
function qmPrintImage_(source){
 if(!['image/png','image/jpeg'].includes(source.mimeType)||Number(source.size)>2097152)qmPrintFail_('IMAGE_LIMIT');
 const bytes=qmPrintDriveFetch_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(source.id)+'?alt=media').getBlob().getBytes();return qmPrintValidateImage_(Object.assign({},source,{bytes:bytes}));
}
function qmPrintValidateImage_(image){
 const bytes=image.bytes;if(!Array.isArray(bytes)||bytes.length<8||bytes.length>2097152)qmPrintFail_('IMAGE_LIMIT');const u=bytes.map(function(n){return(n+256)%256;});
 if(image.mimeType==='image/png'?![137,80,78,71,13,10,26,10].every(function(n,i){return u[i]===n;}):image.mimeType==='image/jpeg'?u[0]!==255||u[1]!==216||u[2]!==255:true)qmPrintFail_('IMAGE_INVALID');return image;
}
function qmPrintOcr_(image){
 qmPrintValidateImage_(image);const raster=QmentumPrintCore.preparePrintRaster(image.bytes,image.kind,image.mimeType),ocrBytes=raster.transformed?Array.from(raster.bytes,function(b){return b>127?b-256:b;}):image.bytes;
 const boundary='sahmt_'+Utilities.getUuid().replace(/-/g,''),metadata=JSON.stringify({name:'SAHMT OCR temporario '+Utilities.getUuid(),mimeType:'application/vnd.google-apps.document',appProperties:{sahmtPurpose:'qmentum-print-ocr'}});
 const payload='--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+metadata+'\r\n--'+boundary+'\r\nContent-Type: '+raster.mimeType+'\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Utilities.base64Encode(ocrBytes)+'\r\n--'+boundary+'--';let temporary=null;
 try{
  const created=qmPrintDriveJson_('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=pt&fields=id,shared',{method:'post',contentType:'multipart/related; boundary='+boundary,payload:payload});temporary=created.id;
  if(!/^[A-Za-z0-9_-]{1,200}$/.test(temporary||'')||created.shared===true)qmPrintFail_('OCR_TEMP_INVALID');
  const text=qmPrintDriveFetch_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(temporary)+'/export?mimeType=text%2Fplain').getContentText();if(typeof text!=='string'||!text.trim()||text.length>60000)qmPrintFail_('OCR_TEXT_INVALID');return text;
 }finally{if(temporary&&/^[A-Za-z0-9_-]{1,200}$/.test(temporary))qmPrintDriveJson_('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(temporary),{method:'patch',contentType:'application/json',payload:JSON.stringify({trashed:true})});}
}
function qmPrintCommit_(documents,plan){
 const changed=new Set(plan.writes.map(function(w){return w.path;})),writes=plan.writes.map(function(w){return qmServerWrite_(w.path,w.data,documents.get(w.path)||null);});
 Array.from(new Set(plan.checks||[])).filter(function(path){return !changed.has(path);}).forEach(function(path){const d=documents.get(path);writes.push({verify:'projects/indicadores---sahmt/databases/(default)/documents/'+path,currentDocument:d?{updateTime:d._updateTime}:{exists:false}});});
 try{qmServerCommit_(writes);}catch(e){if(e.status===409||e.status===412||e.message==='QMENTUM_VERSION_CONFLICT')throw Error('QMENTUM_VERSION_CONFLICT');qmPrintQuotaGuard_();throw Error('QMENTUM_PRINT_WRITE_UNAVAILABLE');}
}
function qmPrintPublicSources_(sources){return sources.map(function(source){const out={};['kind','id','name','version','modifiedTime','checksum','size','sha256'].forEach(function(key){if(source[key]!==undefined)out[key]=source[key];});if(source.id)out.url='https://drive.google.com/file/d/'+encodeURIComponent(source.id)+'/view';return out;});}
function qmPrintSameSource_(before,after){return QmentumPrintCore.qmentumCanonical(QmentumPrintCore.sourceMetadata(before))===QmentumPrintCore.qmentumCanonical(QmentumPrintCore.sourceMetadata(after));}
function qmPrintHandle_(uid,request){
 if(!qmPrintPlain_(request)||!['SCAN','PREVIEW','APPLY'].includes(request.operation))qmPrintFail_('INPUT_INVALID');const unitId=request.unitId,root='qmentumUnits/'+unitId,documents=qmPrintContext_(uid,unitId);
 if(request.operation==='SCAN'){
  if(!qmPrintKeys_(request,['operation','unitId','year']))qmPrintFail_('INPUT_INVALID');const config=qmPrintConfig_(documents,unitId),files=qmPrintList_(config),first=QmentumPrintCore.planPrintScan({files:files,baselines:{},year:request.year,sourceYear:config.sourceYear}),baselines={};
  first.candidates.forEach(function(c){const b=qmPrintRead_(documents,root+'/printSources/'+c.period);if(b)baselines[c.period]=b;});qmPrintContext_(uid,unitId);return{code:'QMENTUM_PRINT_SCAN',result:QmentumPrintCore.planPrintScan({files:files,baselines:baselines,year:request.year,sourceYear:config.sourceYear})};
 }
 QmentumPrintCore.validatePrintPeriod(request.period);const monthPath=root+'/months/'+request.period,current=qmPrintRead_(documents,monthPath),sourcePath=root+'/printSources/'+request.period,baseline=qmPrintRead_(documents,sourcePath);
 if(request.operation==='PREVIEW'){
  if(!qmPrintKeys_(request,['operation','unitId','period','source','files']))qmPrintFail_('INPUT_INVALID');let images,config=null;
  if(request.source==='DRIVE'){
   if(Object.hasOwnProperty.call(request,'files'))qmPrintFail_('INPUT_INVALID');config=qmPrintConfig_(documents,unitId);const scan=QmentumPrintCore.planPrintScan({files:qmPrintList_(config),baselines:{},year:Number(request.period.slice(0,4)),sourceYear:config.sourceYear}),candidate=scan.candidates.find(function(c){return c.period===request.period;});
   if(!candidate||candidate.status==='MISSING_PAIR')qmPrintFail_('MISSING_PAIR');if(candidate.status==='DUPLICATE')qmPrintFail_('DUPLICATE');images=candidate.sources.map(function(s){return qmPrintImage_(s);});
  }else if(request.source==='UPLOAD'){
   if(!Array.isArray(request.files)||request.files.length!==2||new Set(request.files.map(function(f){return f?.kind;})).size!==2)qmPrintFail_('IMAGE_INVALID');
   images=request.files.map(function(f){if(!qmPrintKeys_(f,['kind','name','mimeType','base64'])||!['TECHNIQUES','INDICATORS'].includes(f.kind)||typeof f.name!=='string'||f.name.length>200||typeof f.base64!=='string'||f.base64.length>2796204||!/^[A-Za-z0-9+/]+={0,2}$/.test(f.base64))qmPrintFail_('IMAGE_INVALID');return qmPrintValidateImage_({kind:f.kind,name:f.name,mimeType:f.mimeType,bytes:Utilities.base64Decode(f.base64)});});
  }else qmPrintFail_('SOURCE_INVALID');
  const texts={},sources=[];images.forEach(function(image){const meta={};Object.keys(image).filter(function(k){return k!=='bytes';}).forEach(function(k){meta[k]=image[k];});meta.sha256=qmPrintBytesHash_(image.bytes);sources.push(meta);});
  if(config&&!qmPrintSameSource_(sources,sources.map(function(s){return qmPrintMeta_(s,config);})))qmPrintFail_('SOURCE_CHANGED');
  const sourceHash=sha256Hex_(QmentumPrintCore.qmentumCanonical({unitId:unitId,period:request.period,parserVersion:QmentumPrintCore.PRINT_PARSER_VERSION,sources:sources.map(function(s){return{kind:s.kind,sha256:s.sha256};}).sort(function(a,b){return a.kind.localeCompare(b.kind);})}));
  if(baseline?.sourceHash===sourceHash&&baseline.parserVersion===QmentumPrintCore.PRINT_PARSER_VERSION){
   if(config){const next={};Object.keys(baseline).filter(function(k){return k[0]!=='_';}).forEach(function(k){next[k]=baseline[k];});next.sources=sources;next.checkedBy=uid;next.checkedAt=new Date();qmPrintCommit_(documents,{writes:[{path:sourcePath,data:next}],checks:['users/'+uid,'qmentumAccess/'+uid,'qmentumConfig/current',root,monthPath,sourcePath,root+'/printConfig/current']});}
   else qmPrintContext_(uid,unitId);return{code:'QMENTUM_PRINT_PREVIEW',result:{status:'UNCHANGED'}};
  }
  images.forEach(function(image){texts[image.kind]=qmPrintOcr_(image);});if(config&&!qmPrintSameSource_(sources,sources.map(function(s){return qmPrintMeta_(s,config);})))qmPrintFail_('SOURCE_CHANGED');
  const parsed=QmentumPrintCore.preparePrintPreview({period:request.period,techniquesText:texts.TECHNIQUES,indicatorsText:texts.INDICATORS}),merge=QmentumPrintCore.printMergeView({currentInputs:current?.inputs,baseline:baseline,counts:parsed.counts}),now=new Date(),id=sha256Hex_(uid+'\n'+sourceHash+'\n'+Utilities.getUuid());
  const preview={id:id,unitId:unitId,period:request.period,createdBy:uid,createdAt:now,expiresAt:now.getTime()+1800000,baseVersion:current?.version||0,source:request.source,sourceHash:sourceHash,parserVersion:QmentumPrintCore.PRINT_PARSER_VERSION,counts:parsed.counts,rows:parsed.rows,missingFields:parsed.missingFields,sources:sources,rawTexts:texts};
  const previewPath=root+'/printPreviews/'+id;qmPrintCommit_(documents,{writes:[{path:previewPath,data:preview}],checks:['users/'+uid,'qmentumAccess/'+uid,'qmentumConfig/current',root,monthPath,sourcePath].concat(config?[root+'/printConfig/current']:[])});
  return{code:'QMENTUM_PRINT_PREVIEW',result:{status:'PREVIEW',preview:{id:id,period:preview.period,counts:preview.counts,missingFields:preview.missingFields,changes:merge.changes,conflicts:merge.conflicts,baseVersion:preview.baseVersion,sourceLabel:request.source==='DRIVE'?'Prints das pastas de referência':'Imagens selecionadas',sources:qmPrintPublicSources_(sources)}}};
 }
 if(!qmPrintKeys_(request,['operation','unitId','period','previewId','baseVersion','corrections','resolutions'])||!/^[a-f0-9]{64}$/.test(request.previewId||''))qmPrintFail_('INPUT_INVALID');
 const previewPath=root+'/printPreviews/'+request.previewId,preview=qmPrintRead_(documents,previewPath);if(!preview)qmPrintFail_('PREVIEW_INVALID');
 [root+'/printReceipts/'+preview.id,root+'/imports/'+preview.sourceHash,'qmentumDefinitions/'+(current?.definitionVersion||documents.get('qmentumConfig/current').definitionVersion)].forEach(function(path){qmPrintRead_(documents,path);});
 let config=null;if(preview.source==='DRIVE'){config=qmPrintConfig_(documents,unitId);if(!qmPrintSameSource_(preview.sources,preview.sources.map(function(s){return qmPrintMeta_(s,config);})))qmPrintFail_('SOURCE_CHANGED');}
 const requestHash=sha256Hex_(QmentumPrintCore.qmentumCanonical({previewId:request.previewId,baseVersion:request.baseVersion,corrections:request.corrections,resolutions:request.resolutions})),plan=QmentumPrintCore.preparePrintMutation({uid:uid,unitId:unitId,period:request.period,preview:preview,baseVersion:request.baseVersion,corrections:request.corrections,resolutions:request.resolutions,requestHash:requestHash,documents:documents,now:new Date()});
 if(config)plan.checks.push(root+'/printConfig/current');qmPrintCommit_(documents,plan);return{code:'QMENTUM_PRINT_APPLIED',result:{status:plan.status,version:plan.version}};
}
function qmPrintsHttp_(event){
 let input=null,key=null,lock=null;const respond=function(code,result){const payload=Utilities.base64EncodeWebSafe(JSON.stringify({v:1,nonce:input.nonce,code:code,result:result||null}),Utilities.Charset.UTF_8).replace(/=+$/,'');return ospJson_({payload:payload,mac:qmPrintMac_(payload,key)});};
 try{
  const props=sahmtV2Properties_();if(props.getProperty('QMENTUM_WRITE_ENABLED')!=='true')return ospJson_({code:'QMENTUM_PRINT_DISABLED'});key=props.getProperty('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET');if(!/^[A-Za-z0-9_-]{43}$/.test(key||''))qmPrintFail_('CONFIG_REQUIRED');
  const raw=event?.postData?.contents;if(typeof raw!=='string'||raw.length>8388608)qmPrintFail_('INPUT_INVALID');const envelope=JSON.parse(raw);
  if(!qmPrintKeys_(envelope,['payload','mac'])||typeof envelope.payload!=='string'||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||!ospEqual_(qmPrintMac_(envelope.payload,key),envelope.mac))qmPrintFail_('REQUEST_DENIED');
  input=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(envelope.payload)).getDataAsString('UTF-8'));
  if(!qmPrintKeys_(input,['v','aud','uid','nonce','issuedAt','expiresAt','request'])||input.v!==1||input.aud!=='sahmt-qmentum-prints'||!/^[A-Za-z0-9_-]{1,128}$/.test(input.uid||'')||!/^[a-f0-9]{32}$/.test(input.nonce||'')||!Number.isSafeInteger(input.issuedAt)||!Number.isSafeInteger(input.expiresAt)||input.expiresAt-input.issuedAt!==60000||input.issuedAt>Date.now()+5000||input.expiresAt<=Date.now())qmPrintFail_('REQUEST_EXPIRED');
  lock=LockService.getScriptLock();if(!lock.tryLock(1000)){lock=null;return respond('QMENTUM_PRINT_BUSY');}
  const prefix='SAHMT_QM_PRINT_NONCE_',all=props.getProperties(),now=Date.now();let count=0;Object.keys(all).filter(function(k){return k.indexOf(prefix)===0;}).forEach(function(k){if(Number(all[k])<=now)props.deleteProperty(k);else count++;});
  if(props.getProperty(prefix+input.nonce))return respond('QMENTUM_PRINT_REPLAY_DENIED');if(count>=256)return respond('QMENTUM_PRINT_BUSY');props.setProperty(prefix+input.nonce,String(input.expiresAt+5000));
  lock.releaseLock();lock=null;const result=qmPrintHandle_(input.uid,input.request);if(input.expiresAt<=Date.now())qmPrintFail_('REQUEST_EXPIRED');return respond(result.code,result.result);
 }catch(e){const code=/^QMENTUM_[A-Z_]+$/.test(e.message||'')?e.message:'QMENTUM_PRINT_UNAVAILABLE';return input&&/^[a-f0-9]{32}$/.test(input.nonce||'')&&key?respond(code):ospJson_({code:'QMENTUM_PRINT_REQUEST_DENIED'});}
 finally{if(lock)lock.releaseLock();}
}
