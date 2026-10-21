export function continuityBootstrapSource({secret,endpoint,notBefore=0}){
 if(!/^[A-Za-z0-9_-]{43}$/.test(secret)||endpoint!=='https://sahmt-operational-channel.anestesiahmtforms.workers.dev/v1/operational-continuity/import'||!Number.isSafeInteger(notBefore))throw Error('CONTINUITY_BOOTSTRAP_CONFIG_INVALID');
 return `// Private installer. Generated outside Git; never log request or key.
function ocsAdminHttp_(event){
 try{
 const expectedSecret=${JSON.stringify(secret)},input=JSON.parse(event.postData.contents),time=String(input.time||''),nonce=input.nonce||'',payload=input.payload;
 if(!/^\\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>300000||!/^[a-f0-9]{32}$/.test(nonce)||typeof payload!=='string'||payload.length>1000)throw Error('INPUT');
 const hex=bytes=>bytes.map(n=>('0'+((n+256)%256).toString(16)).slice(-2)).join('');
 const digest=hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,payload,Utilities.Charset.UTF_8));
 const mac=hex(Utilities.computeHmacSha256Signature(time+'\\n'+nonce+'\\n'+digest,expectedSecret,Utilities.Charset.UTF_8));
 if(!ospEqual_(mac,input.signature))throw Error('SIGNATURE');
 if(String(Session.getEffectiveUser().getEmail()).toLowerCase()!=='anestesiahmtforms@gmail.com')throw Error('OWNER');
 const body=JSON.parse(payload),p=PropertiesService.getScriptProperties();
 if(body.action==='status')return ospJson_({code:'CONTINUITY_PRIVATE_STATUS',enabled:p.getProperty('SAHMT_CONTINUITY_SYNC_ENABLED')==='YES',seedReady:!!p.getProperty('SAHMT_CONTINUITY_SEED_READY'),seedPending:p.getProperty('SAHMT_CONTINUITY_SEED_PENDING')==='YES',triggers:ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='sincronizarCanalOperacionalRemotoV1').length});
 if(body.action!=='install')throw Error('ACTION');
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return ospJson_({code:'CONTINUITY_PRIVATE_BUSY'});
 try{
  if(p.getProperty('SAHMT_CONTINUITY_BOOTSTRAP_USED')==='YES')return ospJson_({code:'CONTINUITY_ALREADY_INSTALLED'});
  p.setProperty('SAHMT_CONTINUITY_ENDPOINT',${JSON.stringify(endpoint)});p.setProperty('SAHMT_CONTINUITY_IMPORT_SECRET',expectedSecret);
  p.setProperty('SAHMT_CONTINUITY_SEED_PENDING','YES');p.setProperty('SAHMT_CONTINUITY_PAUSE_UNTIL',String(${notBefore}));
  instalarSincronizadorCanalRemotoV1();p.setProperty('SAHMT_CONTINUITY_BOOTSTRAP_USED','YES');
  return ospJson_({code:'CONTINUITY_INSTALLED_SEED_PENDING',firestoreReads:0});
 }finally{lock.releaseLock();}
 }catch(_){return ospJson_({code:'CONTINUITY_PRIVATE_DENIED'});}
}
`;
}
