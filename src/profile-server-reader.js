import {withinDeadline} from './async-deadline.js';

const failure = code => Object.assign(new Error('Não foi possível confirmar o perfil no servidor.'), {code});
function decode(value, depth=0) {
  if (!value || typeof value!=='object' || depth>20) throw failure('data-loss');
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value || 'doubleValue' in value) return Number(value.integerValue ?? value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('geoPointValue' in value) return {...value.geoPointValue};
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(item=>decode(item,depth+1));
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key,item])=>[key,decode(item,depth+1)]));
  throw failure('data-loss');
}

// Firebase ID tokens use the same Firestore Security Rules as the Web SDK.
// Only the signed-in user's profile/access request in the fixed primary project
// is readable here. No administrative credentials or writes are involved.
export function createProfileServerReader({projectId,getCurrentUser,getAppCheckToken=async()=>null,fetchImpl=globalThis.fetch,
  timeoutMs=6000,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId || '')) throw failure('invalid-argument');
  return async function readOwnDocument(user,{collection='users',isCurrent=()=>true,signal}={}) {
    if (!['users','accessRequests'].includes(collection) || !user?.uid || typeof user.uid!=='string') throw failure('invalid-argument');
    const controller=new AbortController();
    const cancel=()=>controller.abort(failure('cancelled'));
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
    const current=()=>!controller.signal.aborted && isCurrent() && getCurrentUser()?.uid===user.uid;
    const assertCurrent=()=>{if(!current())throw controller.signal.reason || failure('cancelled');};
    try {
      return await withinDeadline(async()=>{
        assertCurrent();
        const identity=getCurrentUser();
        const [token,appCheckToken]=await Promise.all([identity.getIdToken(false),getAppCheckToken()]);
        assertCurrent();
        if(typeof token!=='string'||!token)throw failure('unauthenticated');
        const name=`projects/${projectId}/databases/(default)/documents/${collection}/${user.uid}`;
        const url=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(user.uid)}`;
        const headers={Authorization:'Bearer '+token,Accept:'application/json'};
        if(appCheckToken)headers['X-Firebase-AppCheck']=appCheckToken;
        const response=await fetchImpl(url,{method:'GET',headers,credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
        assertCurrent();
        if(response.status===404)return {exists:()=>false,data:()=>undefined};
        if(!response.ok){
          const codes={400:'invalid-argument',401:'unauthenticated',403:'permission-denied',408:'deadline-exceeded',429:'resource-exhausted',500:'unavailable',502:'unavailable',503:'unavailable',504:'deadline-exceeded'};
          throw failure(codes[response.status] || 'unknown');
        }
        const document=await response.json();assertCurrent();
        if(document.name!==name || !document.fields || typeof document.fields!=='object')throw failure('data-loss');
        const data=decode({mapValue:{fields:document.fields}});
        return {exists:()=>true,data:()=>data};
      },{timeoutMs,setTimer,clearTimer,onTimeout:error=>controller.abort(error)});
    } catch(error) {
      if(controller.signal.aborted)throw controller.signal.reason || failure('cancelled');
      if(['app-check/network-unavailable','app-check/token-request-timeout','app-check/fetch-network-error'].includes(error?.code))throw failure('unavailable');
      if(error instanceof TypeError || /failed to fetch|load failed|networkerror/i.test(error?.message || ''))throw failure('unavailable');
      throw error;
    } finally {signal?.removeEventListener('abort',cancel);}
  };
}
