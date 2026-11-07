const FG_SCIENCE_SECRET_PROPERTY='FG_SCIENCE_HMAC_SECRET';

function configurarRecepcaoCienciaFG_(){
  fgNativeOwner_();
  const config=getFirestoreDocument_('migrationControl','fg-scoring-webhook');
  if(config?.projectId!=='sahmt-checklist-fg'||!/^[A-Za-z0-9_-]{43}$/.test(config.secret||''))throw Error('FG_SCIENCE_WEBHOOK_CONFIG_REQUIRED');
  sahmtV2Properties_().setProperty(FG_SCIENCE_SECRET_PROPERTY,config.secret);
}

function fgScienceHttp_(event){
  const secret=sahmtV2Properties_().getProperty(FG_SCIENCE_SECRET_PROPERTY);
  const raw=event?.postData?.contents;
  if(!/^[A-Za-z0-9_-]{43}$/.test(secret||'')||typeof raw!=='string'||raw.length>2048)return ospJson_({code:'FG_WEBHOOK_DENIED'});
  let request;
  try{
    const envelope=JSON.parse(raw);
    if(!/^[A-Za-z0-9_-]{1,1500}$/.test(envelope?.payload||'')||!ospEqual_(ospMac_(envelope.payload,secret),envelope.mac))throw Error('FG_WEBHOOK_MAC');
    request=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(envelope.payload)).getDataAsString('UTF-8'));
    const now=Date.now();
    if(request.v!==1||request.aud!=='fg-science'||!/^[a-f0-9]{32}$/.test(request.nonce||'')||
        !Number.isSafeInteger(request.issuedAt)||request.issuedAt>now+5000||request.issuedAt<=now-60000)throw Error('FG_WEBHOOK_WINDOW');
  }catch(_){return ospJson_({code:'FG_WEBHOOK_DENIED'});}
  try{
    fgNativeOwner_();
    if(request.action==='probe')return ospReply_(request.nonce,'FG_WEBHOOK_READY',secret);
    if(request.action!=='settle'||!isValidDateKey(request.day)||!/^[^/\s\x00-\x1f]{1,128}$/.test(request.uid||''))throw Error('FG_WEBHOOK_SCOPE');
    const activation=checklistScienceAssertOperator_();
    const day=request.day;
    if(day!==checklistSaoPauloDay_())return ospReply_(request.nonce,'OUTSIDE_RELEASE',secret);
    const cutoff=Utilities.parseDate(day+' 23:59:00','America/Sao_Paulo','yyyy-MM-dd HH:mm:ss');
    const acknowledgement=evaluationGet_('checklistSignatureRequests',day);
    if(!fgAcknowledgementOnTime_(acknowledgement,day,cutoff)||acknowledgement.signerUid!==request.uid||
        acknowledgement.acknowledgedAt<activation.activatedAt)return ospReply_(request.nonce,'FG_WEBHOOK_DENIED',secret);
    const result=acknowledgement.status==='PENDING_VALIDATION'
      ?validateChecklistSignatureRequest_(acknowledgement,{scienceOnly:true}):acknowledgement.status;
    return ospReply_(request.nonce,result,secret);
  }catch(_){return ospReply_(request.nonce,'FG_WEBHOOK_RETRY',secret);}
}
