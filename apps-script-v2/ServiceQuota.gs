// Executor-scoped availability guard. This is not an authorization cache and
// never changes the Firestore router, request, permissions or pending work.
function sahmtUrlFetchDailyQuota_(error) {
  return !!error && (error.code === 'SAHMT_URLFETCH_DAILY_QUOTA' ||
    /(?:Service invoked too many times for one day|Service called too many times in the same day|Servi[cç]o chamado muitas vezes no mesmo dia)\s*:\s*urlfetch\b/i.test(String(error.message || '')));
}
function sahmtUrlFetchPause_() {
  const key='SAHMT_URLFETCH_PAUSE_V1',cache=CacheService.getUserCache();
  let raw=cache.get(key);
  if(raw===null){raw=PropertiesService.getUserProperties().getProperty(key)||'0';cache.put(key,raw,30);}
  if(raw==='0')return null;
  let state;try{state=JSON.parse(raw);}catch(_){return null;}
  if(!state || state.v!==1 || !Number.isSafeInteger(state.observedAt) || !Number.isSafeInteger(state.retryAfter) ||
    state.retryAfter-state.observedAt!==3600000 || state.observedAt>Date.now() || state.retryAfter<=Date.now())return null;
  return state;
}
function sahmtUrlFetchQuotaError_(state) {
  const error=new Error('SAHMT_URLFETCH_DAILY_QUOTA');
  error.code='SAHMT_URLFETCH_DAILY_QUOTA';error.status=429;error.service='urlfetch';error.retryAfter=state.retryAfter;
  return error;
}
function sahmtUrlFetchRun_(operation) {
  const paused=sahmtUrlFetchPause_();if(paused)throw sahmtUrlFetchQuotaError_(paused);
  try{return operation();}
  catch(error){
    if(!sahmtUrlFetchDailyQuota_(error))throw error;
    const now=Date.now(),state={v:1,observedAt:now,retryAfter:now+3600000},raw=JSON.stringify(state),key='SAHMT_URLFETCH_PAUSE_V1';
    PropertiesService.getUserProperties().setProperty(key,raw);CacheService.getUserCache().put(key,raw,3600);
    console.warn(JSON.stringify({code:'URLFETCH_DAILY_QUOTA_PAUSED',retryAfter:state.retryAfter}));
    throw sahmtUrlFetchQuotaError_(state);
  }
}
// Manual owner-only diagnostic. One public certificate request, no identities,
// PDFs, Firestore documents or training changes. The pause is never bypassed.
function conferirServicoLeituraGestaoFbV1() {
  dgrOperator_();let code;
  try{
    const response=sahmtUrlFetchRun_(function(){return UrlFetchApp.fetch('https://www.googleapis.com/oauth2/v1/certs',{muteHttpExceptions:true,followRedirects:false});});
    code=response.getResponseCode()===200?'READING_SERVICE_AVAILABLE':'READING_SERVICE_PROBE_FAILED';
  }catch(error){code=sahmtUrlFetchDailyQuota_(error)?'READING_URLFETCH_QUOTA_WAIT':'READING_SERVICE_PROBE_FAILED';}
  const result={code:code,firestoreReads:0,firestoreWrites:0,formWrites:0};
  console.log(JSON.stringify(result));return result;
}
