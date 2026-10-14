/** Dedicated signed receiver. No Firestore reads; trusts only the private Worker HMAC. */
function doPost(event) {
  if (event && event.parameter && event.parameter.action === 'occurrence-score-v1') return evaluationOccurrenceHttp_(event);
  let request=null,secret=null;
  try {
    const props=sahmtV2Properties_();
    if(props.getProperty('SAHMT_OPERATIONAL_PUSH_ENABLED')!=='YES'||props.getProperty(OSC.enabled)!=='YES')
      return ospJson_({code:'CONTROLE_ENVIO_DESATIVADO'});
    secret=props.getProperty('SAHMT_OPERATIONAL_PUSH_HMAC_SECRET');
    if(!/^[A-Za-z0-9_-]{43}$/.test(secret||''))return ospJson_({code:'CONTROLE_CONFIGURACAO_AUSENTE'});
    const raw=event&&event.postData&&event.postData.contents;
    if(typeof raw!=='string'||raw.length>50000)throw Error('INPUT');
    const envelope=JSON.parse(raw);
    if(typeof envelope.payload!=='string'||! /^[A-Za-z0-9_-]+$/.test(envelope.payload)||
      !ospEqual_(ospMac_(envelope.payload,secret),envelope.mac))throw Error('MAC');
    request=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(envelope.payload)).getDataAsString('UTF-8'));
    if(request.v!==1||request.aud!=='sahmt-operational-sheet'||! /^[a-f0-9]{32}$/.test(request.nonce||'')||
      !Number.isSafeInteger(request.issuedAt)||!Number.isSafeInteger(request.expiresAt)||
      request.expiresAt-request.issuedAt!==60000||request.issuedAt>Date.now()+5000||request.expiresAt<=Date.now())throw Error('EXPIRED');
    const doc=request.document;
    if(!doc||typeof doc.name!=='string'||! /^projects\/sahmt-17a16\/databases\/\(default\)\/documents\/(events|labels|checklists)\/[A-Za-z0-9_-]{1,128}$/.test(doc.name)||
      !doc.fields||typeof doc.updateTime!=='string'||!Number.isFinite(Date.parse(doc.updateTime)))throw Error('DOCUMENT');
    const code=oscLocked_(function() {
      if(request.expiresAt<=Date.now())return 'CONTROLE_REQUISICAO_EXPIRADA';
      const prefix='SAHMT_SHEET_NONCE_',all=props.getProperties(),now=Date.now();let count=0;
      Object.keys(all).filter(function(k){return k.indexOf(prefix)===0;}).forEach(function(k){
        if(Number(all[k])<=now)props.deleteProperty(k);else count++;
      });
      if(props.getProperty(prefix+request.nonce))return 'CONTROLE_REPLAY_RECUSADO';
      if(count>=512)return 'CONTROLE_ADMISSAO_OCUPADA';
      props.setProperty(prefix+request.nonce,String(request.expiresAt+5000));
      return ospReceive_(doc);
    });
    return ospReply_(request.nonce,code,secret);
  } catch (_) {
    // Never log raw request, document, tokens, MACs or exception messages.
    return request&&/^[a-f0-9]{32}$/.test(request.nonce||'')&&secret
      ?ospReply_(request.nonce,'CONTROLE_RECEBIMENTO_RECUSADO',secret):ospJson_({code:'CONTROLE_REQUISICAO_RECUSADA'});
  }
}
function ospJson_(value) {return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function ospMac_(payload,secret) {
  return Utilities.computeHmacSha256Signature('SAHMT_SHEET_V1\n'+payload,secret,Utilities.Charset.UTF_8)
    .map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
}
function ospEqual_(expected,actual) {
  if(typeof actual!=='string'||!/^[a-f0-9]{64}$/.test(actual))return false;
  let different=0;for(let i=0;i<64;i++)different|=expected.charCodeAt(i)^actual.charCodeAt(i);return different===0;
}
function ospReply_(nonce,code,secret) {
  const payload=Utilities.base64EncodeWebSafe(JSON.stringify({v:1,nonce:nonce,code:code}),Utilities.Charset.UTF_8).replace(/=+$/,'');
  return ospJson_({payload:payload,mac:ospMac_(payload,secret)});
}
/** Called only inside the authenticated receiver's script lock. Existing rows are never overwritten. */
function ospReceive_(doc) {
  const key=oscDocKey_(doc),table=oscTable_(key.split('/')[0]);
  const book=oscBook_(),state=oscState_(book);
  if(state.has(key))return 'CONTROLE_REGISTRO_JA_RECEBIDO';
  const fields=firestoreFieldsToJs_(doc.fields);
  if(fields.sheetDeleted||fields.active===false)return 'CONTROLE_REGISTRO_REMOVIDO';
  const view=oscRows_(book,table),cells=oscRow_(table,doc,oscCatalog_(book,false));
  const existing=view.rows.get(key);
  // Recovery after a row write succeeded but ledger persistence failed.
  if(existing&&!oscEqual_(existing.cells,cells))return 'CONTROLE_CONFLITO_PLANILHA';
  if(!existing)oscSetRow_(view,table,key,cells);
  state.set(key,{updateTime:doc.updateTime,cells:oscCanonical_(cells),deleted:false});
  oscSaveState_(book,state);
  if(table.collection==='labels')oscSummary_(book,state);
  return 'CONTROLE_REGISTRO_RECEBIDO';
}
