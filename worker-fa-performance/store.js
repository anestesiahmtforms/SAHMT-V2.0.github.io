import {decodeFields,encodeFields} from '../worker-training/firestore.js';
export function createFaPerformanceStore({getAccessToken,fetchImpl=fetch}){
 const root='https://firestore.googleapis.com/v1/projects/sahmt-17a16/databases/(default)/documents';
 const allowed=new Set(['users','faPerformanceRuntime','faPerformanceReference','faPerformanceAwards','faPerformanceLedger','faPerformanceSummaries']);
 const check=c=>{if(!allowed.has(c))throw Error('FA_STORE_SCOPE_DENIED');};
 async function request(path,body){const r=await fetchImpl(root+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await getAccessToken(),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});if(r.status===404&&!body)return null;if(!r.ok)throw Error('FA_STORE_UNAVAILABLE');return r.json();}
 return {
  async get(c,id){check(c);if(!/^[A-Za-z0-9_-]{1,200}$/.test(id))throw Error('FA_STORE_ID_INVALID');const d=await request('/'+c+'/'+id);return d?decodeFields(d.fields||{}):null;},
  async list(c,uid){check(c);const ledger=c==='faPerformanceLedger';const q={from:[{collectionId:c}],...(uid?{where:{fieldFilter:{field:{fieldPath:'uid'},op:'EQUAL',value:encodeFields({uid}).uid}}}:{}),...(ledger?{orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'}]}:{}),limit:ledger?200:10001};const rows=await request(':runQuery',{structuredQuery:q});if(!Array.isArray(rows)||rows.some(r=>r.error))throw Error('FA_STORE_INCOMPLETE');const result=rows.filter(r=>r.document).map(r=>({...decodeFields(r.document.fields||{}),id:r.document.name.split('/').pop()}));if(!ledger&&result.length>=10001)throw Error('FA_STORE_INCOMPLETE');return result;}
 };
}
