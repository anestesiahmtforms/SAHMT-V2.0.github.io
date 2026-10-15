// Signed write processor. Reads stay directly in FA Firestore; no timer or AI.
function qmWriteAssertFa_() {
  if(SAHMT_V2_CONFIG.projectId!=='sahmt-17a16'||SAHMT_V2_CONFIG.databaseId!=='(default)')throw Error('QMENTUM_FA_REQUIRED');
}
function qmWriteMac_(payload,secret) {
  return Utilities.computeHmacSha256Signature('SAHMT_QMENTUM_WRITE_V1\n'+payload,secret,Utilities.Charset.UTF_8)
    .map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
}
function qmWriteReply_(nonce,code,version,secret) {
  const payload=Utilities.base64EncodeWebSafe(JSON.stringify({v:1,nonce:nonce,code:code,version:version||null}),Utilities.Charset.UTF_8).replace(/=+$/,'');
  return ospJson_({payload:payload,mac:qmWriteMac_(payload,secret)});
}
function qmWriteApply_(id,uid) {
  qmWriteAssertFa_();
  const request=qmServerGet_('qmentumWriteRequests/'+id);
  if(!request||request.actorUid!==uid||!['SAVE_MONTH','PUBLISH_DEFINITION'].includes(request.operation))throw Error('QMENTUM_PERMISSION_DENIED');
  const profile=qmServerGet_('users/'+uid),grant=qmServerGet_('qmentumAccess/'+uid),config=qmServerGet_('qmentumConfig/current');
  // Re-check current authorization even when returning an idempotent receipt.
  if(!profile||profile.uid!==uid||profile.active!==true||profile.access!==true||!grant||grant.uid!==uid||grant.active!==true||!['collector','reviewer','manager'].includes(grant.role)||!config||config.enabled!==true)throw Error('QMENTUM_PERMISSION_DENIED');
  const hash=sha256Hex_(QmentumCore.qmentumCanonical({operation:request.operation,payload:request.payload}));
  if(id!==uid+'_'+hash||request.payloadHash!==hash)throw Error('QMENTUM_INPUT_INVALID');
  if(request.status==='CONFIRMED')return request.confirmedVersion;
  if(request.status!=='PENDING')throw Error('QMENTUM_REQUEST_STATE_INVALID');
  const p=request.payload;let unit=null,current=null,definitions=null,importBatch=null,path;
  if(request.operation==='SAVE_MONTH'){
    if(!p||!/^[A-Za-z0-9_-]{1,80}$/.test(p.unitId||'')||!Array.isArray(grant.units)||grant.units.indexOf(p.unitId)<0)throw Error('QMENTUM_PERMISSION_DENIED');
    const period=QmentumCore.periodKey(p.year,p.month);path='qmentumUnits/'+p.unitId+'/months/'+period;
    unit=qmServerGet_('qmentumUnits/'+p.unitId);current=qmServerGet_(path);
    const version=p.action==='REBASE'?config.definitionVersion:current&&current.definitionVersion||p.definitionVersion||config.definitionVersion;
    if(!Number.isSafeInteger(version)||version<1)throw Error('QMENTUM_DEFINITION_INVALID');
    definitions=qmServerGet_('qmentumDefinitions/'+version);
    if(p.action==='IMPORT'){
      if(!/^[a-f0-9]{64}$/.test(p.importHash||''))throw Error('QMENTUM_IMPORT_NOT_STAGED');
      importBatch=qmServerGet_('qmentumUnits/'+p.unitId+'/imports/'+p.importHash);
    }
  }else{
    const version=p&&p.definitions&&p.definitions.version;
    if(!Number.isSafeInteger(version)||version<1)throw Error('QMENTUM_DEFINITION_INVALID');
    path='qmentumDefinitions/'+version;current=qmServerGet_(path);
  }
  const prepared=QmentumCore.prepareQmentumWrite({uid:uid,operation:request.operation,payload:p,profile:profile,grant:grant,config:config,unit:unit,current:current,definitions:definitions,importBatch:importBatch,now:new Date()});
  const clean=function(d){const value=qmServerClean_(d);delete value.id;return value;};
  const writes=[qmServerWrite_(path,prepared.data,current)];
  if(prepared.kind==='month')writes.push(qmServerWrite_(path+'/history/'+prepared.version,prepared.data,null));
  else writes.push(qmServerWrite_('qmentumConfig/current',Object.assign(clean(config),{definitionVersion:prepared.version}),config));
  const checked=[profile,grant,unit,definitions,importBatch];if(prepared.kind==='month')checked.push(config);
  checked.filter(Boolean).forEach(function(d){writes.push({verify:d._name,currentDocument:{updateTime:d._updateTime}});});
  writes.push(qmServerWrite_('qmentumWriteRequests/'+id,Object.assign(clean(request),{status:'CONFIRMED',confirmedVersion:prepared.version,confirmedAt:new Date()}),request));
  try{qmServerCommit_(writes);}catch(e){if(e.status===409||e.status===412)throw Error('QMENTUM_VERSION_CONFLICT');throw Error('QMENTUM_WRITE_UNAVAILABLE');}
  return prepared.version;
}
function qmWriteHttp_(event) {
  let request=null,secret=null,lock=null;
  try{
    const props=sahmtV2Properties_();if(props.getProperty('QMENTUM_WRITE_ENABLED')!=='true')return ospJson_({code:'QMENTUM_WRITE_DISABLED'});
    secret=props.getProperty('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET');if(!/^[A-Za-z0-9_-]{43}$/.test(secret||''))return ospJson_({code:'QMENTUM_WRITE_CONFIG_INVALID'});
    const raw=event&&event.postData&&event.postData.contents;if(typeof raw!=='string'||raw.length>4096)throw Error('QMENTUM_REQUEST_INVALID');
    const envelope=JSON.parse(raw);if(typeof envelope.payload!=='string'||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||!ospEqual_(qmWriteMac_(envelope.payload,secret),envelope.mac))throw Error('QMENTUM_REQUEST_DENIED');
    request=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(envelope.payload)).getDataAsString('UTF-8'));
    if(Object.keys(request).sort().join(',')!=='aud,expiresAt,id,issuedAt,nonce,uid,v'||request.v!==1||request.aud!=='sahmt-qmentum-write'||typeof request.uid!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(request.uid)||typeof request.id!=='string'||!new RegExp('^'+request.uid+'_[a-f0-9]{64}$').test(request.id)||!/^[a-f0-9]{32}$/.test(request.nonce||'')||!Number.isSafeInteger(request.issuedAt)||!Number.isSafeInteger(request.expiresAt)||request.expiresAt-request.issuedAt!==60000||request.issuedAt>Date.now()+5000||request.expiresAt<=Date.now())throw Error('QMENTUM_REQUEST_EXPIRED');
    lock=LockService.getScriptLock();if(!lock.tryLock(1000)){lock=null;return qmWriteReply_(request.nonce,'QMENTUM_WRITE_BUSY',null,secret);}
    if(request.expiresAt<=Date.now())throw Error('QMENTUM_REQUEST_EXPIRED');
    const prefix='SAHMT_QM_WRITE_NONCE_',now=Date.now(),all=props.getProperties();let count=0;
    Object.keys(all).filter(function(k){return k.indexOf(prefix)===0;}).forEach(function(k){if(Number(all[k])<=now)props.deleteProperty(k);else count++;});
    if(props.getProperty(prefix+request.nonce))return qmWriteReply_(request.nonce,'QMENTUM_REPLAY_DENIED',null,secret);
    if(count>=256)return qmWriteReply_(request.nonce,'QMENTUM_WRITE_BUSY',null,secret);
    props.setProperty(prefix+request.nonce,String(request.expiresAt+5000));
    return qmWriteReply_(request.nonce,'QMENTUM_WRITE_CONFIRMED',qmWriteApply_(request.id,request.uid),secret);
  }catch(e){const code=/^QMENTUM_[A-Z_]+$/.test(e.message||'')?e.message:'QMENTUM_WRITE_UNAVAILABLE';return request&&/^[a-f0-9]{32}$/.test(request.nonce||'')&&secret?qmWriteReply_(request.nonce,code,null,secret):ospJson_({code:'QMENTUM_REQUEST_DENIED'});}
  finally{if(lock)lock.releaseLock();}
}
// Operator capability: separate HMAC domain; user relay cannot sign this request.
// Can change only this transport gate. Enabling requires module still disabled.
function qmWriteConfigureHttp_(event) {
  let request=null,secret=null,lock=null;
  const mac=function(payload,key){return Utilities.computeHmacSha256Signature('SAHMT_QMENTUM_CONFIG_V1\n'+payload,key,Utilities.Charset.UTF_8).map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');};
  const reply=function(code){const payload=Utilities.base64EncodeWebSafe(JSON.stringify({v:1,nonce:request.nonce,code:code}),Utilities.Charset.UTF_8).replace(/=+$/,'');return ospJson_({payload:payload,mac:mac(payload,secret)});};
  try{
    qmWriteAssertFa_();
    const props=sahmtV2Properties_();secret=props.getProperty('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET');
    if(!/^[A-Za-z0-9_-]{43}$/.test(secret||''))throw Error('CONFIG');
    const raw=event&&event.postData&&event.postData.contents;if(typeof raw!=='string'||raw.length>2048)throw Error('INPUT');
    const envelope=JSON.parse(raw);if(typeof envelope.payload!=='string'||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||!ospEqual_(mac(envelope.payload,secret),envelope.mac))throw Error('MAC');
    request=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(envelope.payload)).getDataAsString('UTF-8'));
    if(Object.keys(request).sort().join(',')!=='aud,enabled,expiresAt,issuedAt,nonce,v'||request.v!==1||request.aud!=='sahmt-qmentum-config'||typeof request.enabled!=='boolean'||!/^[a-f0-9]{32}$/.test(request.nonce||'')||!Number.isSafeInteger(request.issuedAt)||!Number.isSafeInteger(request.expiresAt)||request.expiresAt-request.issuedAt!==60000||request.issuedAt>Date.now()+5000||request.expiresAt<=Date.now())throw Error('EXPIRED');
    lock=LockService.getScriptLock();if(!lock.tryLock(1000)){lock=null;throw Error('BUSY');}
    const prefix='SAHMT_QM_CONFIG_NONCE_',all=props.getProperties(),now=Date.now();let count=0;
    Object.keys(all).filter(function(k){return k.indexOf(prefix)===0;}).forEach(function(k){if(Number(all[k])<=now)props.deleteProperty(k);else count++;});
    if(props.getProperty(prefix+request.nonce)||count>=16||request.expiresAt<=Date.now())throw Error('REPLAY');
    if(request.enabled){const config=qmServerGet_('qmentumConfig/current');if(!config||config.enabled!==false)throw Error('GATE');qmServerCommit_([{verify:config._name,currentDocument:{updateTime:config._updateTime}}]);}
    props.setProperty(prefix+request.nonce,String(request.expiresAt+5000));props.setProperty('QMENTUM_WRITE_ENABLED',request.enabled?'true':'false');
    return reply(request.enabled?'QMENTUM_WRITE_TRANSPORT_ENABLED':'QMENTUM_WRITE_TRANSPORT_DISABLED');
  }catch(_){return request&&/^[a-f0-9]{32}$/.test(request.nonce||'')&&secret?reply('QMENTUM_CONFIG_DENIED'):ospJson_({code:'QMENTUM_CONFIG_DENIED'});}
  finally{if(lock)lock.releaseLock();}
}
