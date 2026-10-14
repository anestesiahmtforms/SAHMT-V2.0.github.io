function evaluationOccurrenceMac_(payload,secret) {
  return Utilities.computeHmacSha256Signature('SAHMT_OCCURRENCE_SCORE_V1\n'+payload,secret,Utilities.Charset.UTF_8)
    .map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
}
function evaluationOccurrenceReply_(nonce,code,secret) {
  const payload=Utilities.base64EncodeWebSafe(JSON.stringify({v:1,nonce:nonce,code:code}),Utilities.Charset.UTF_8).replace(/=+$/,'');
  return ospJson_({payload:payload,mac:evaluationOccurrenceMac_(payload,secret)});
}
function evaluationOccurrenceHttp_(event) {
  let request=null,secret=null,lock=null;
  try {
    if (!evaluationOccurrenceEnabled_()) return ospJson_({code:'OCCURRENCE_SCORING_DISABLED'});
    const props=sahmtV2Properties_();secret=props.getProperty('SAHMT_V2_OCCURRENCE_SCORING_HMAC_SECRET');
    if(!/^[A-Za-z0-9_-]{43}$/.test(secret||''))return ospJson_({code:'OCCURRENCE_SCORE_CONFIG_INVALID'});
    const raw=event&&event.postData&&event.postData.contents;if(typeof raw!=='string'||raw.length>2048)throw Error('INPUT');
    const envelope=JSON.parse(raw);
    if(typeof envelope.payload!=='string'||!/^[A-Za-z0-9_-]+$/.test(envelope.payload)||!ospEqual_(evaluationOccurrenceMac_(envelope.payload,secret),envelope.mac))throw Error('MAC');
    request=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(envelope.payload)).getDataAsString('UTF-8'));
    if(Object.keys(request).sort().join(',')!=='aud,expiresAt,id,issuedAt,nonce,uid,v'||request.v!==1||request.aud!=='sahmt-occurrence-score'||
      !/^[a-f0-9]{32}$/.test(request.nonce||'')||!/^[A-Fa-f0-9-]{36}$/.test(request.id||'')||typeof request.uid!=='string'||!/^[^/\s]{1,128}$/.test(request.uid)||
      !Number.isSafeInteger(request.issuedAt)||!Number.isSafeInteger(request.expiresAt)||request.expiresAt-request.issuedAt!==60000||request.issuedAt>Date.now()+5000||request.expiresAt<=Date.now())throw Error('EXPIRED');
    lock=LockService.getScriptLock();if(!lock.tryLock(1000)){lock=null;return evaluationOccurrenceReply_(request.nonce,'OCCURRENCE_SCORE_BUSY',secret);}
    if(request.expiresAt<=Date.now())throw Error('EXPIRED');
    const prefix='SAHMT_OCC_SCORE_NONCE_',all=props.getProperties(),now=Date.now();let count=0;
    Object.keys(all).filter(function(k){return k.indexOf(prefix)===0;}).forEach(function(k){if(Number(all[k])<=now)props.deleteProperty(k);else count++;});
    if(props.getProperty(prefix+request.nonce))return evaluationOccurrenceReply_(request.nonce,'OCCURRENCE_SCORE_REPLAY_DENIED',secret);
    if(count>=512)return evaluationOccurrenceReply_(request.nonce,'OCCURRENCE_SCORE_BUSY',secret);
    props.setProperty(prefix+request.nonce,String(request.expiresAt+5000));
    evaluationDeliverOccurrence_(request.id,request.uid);
    return evaluationOccurrenceReply_(request.nonce,'OCCURRENCE_SCORE_ACCEPTED',secret);
  } catch (_) {
    return request&&/^[a-f0-9]{32}$/.test(request.nonce||'')&&secret
      ? evaluationOccurrenceReply_(request.nonce,'OCCURRENCE_SCORE_PENDING',secret):ospJson_({code:'OCCURRENCE_SCORE_DENIED'});
  } finally {if(lock)lock.releaseLock();}
}
