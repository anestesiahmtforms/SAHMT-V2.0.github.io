import {qmentumCanonical} from './qmentum-write.js';
export function createQmentumCommandSender({db,auth,uid,ensure,firestore:api,endpoint,fetchImpl=globalThis.fetch}={}){
 const configured=endpoint||import.meta.env?.VITE_OPERATIONAL_SHEETS_ENDPOINT;
 return async(operation,payload)=>{
  ensure();let url;try{url=new URL(configured);if(url.protocol!=='https:'||url.username||url.password)throw Error();url.pathname='/v1/qmentum/write';url.search='';url.hash='';}catch{throw Error('QMENTUM_WRITE_CONFIG_REQUIRED');}
  const canonical=qmentumCanonical({operation,payload});if(new TextEncoder().encode(canonical).length>180000)throw Error('QMENTUM_DOCUMENT_TOO_LARGE');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))].map(x=>x.toString(16).padStart(2,'0')).join('');ensure();
  const id=uid+'_'+hash,target=api.doc(db,'qmentumWriteRequests',id);
  await api.runTransaction(db,async tx=>{const prior=await tx.get(target);ensure();if(prior.exists()){
   const old=prior.data();if(old.actorUid!==uid||old.payloadHash!==hash||old.operation!==operation||qmentumCanonical(old.payload)!==qmentumCanonical(payload))throw Error('QMENTUM_REQUEST_CONFLICT');return;
  }tx.set(target,{actorUid:uid,payloadHash:hash,operation,payload,status:'PENDING',createdAt:api.serverTimestamp()});});
  ensure();const token=await auth.currentUser.getIdToken();ensure();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
  let response,answer;try{response=await fetchImpl(url.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({id}),credentials:'omit',redirect:'error',signal:controller.signal,cache:'no-store'});answer=await response.json();}catch{throw Error('QMENTUM_WRITE_UNAVAILABLE');}finally{clearTimeout(timer);}
  ensure();if(!response.ok||answer?.code!=='QMENTUM_WRITE_CONFIRMED')throw Error(/^QMENTUM_[A-Z_]+$/.test(answer?.code||'')?answer.code:'QMENTUM_WRITE_UNAVAILABLE');
  if(!Number.isSafeInteger(answer.version)||answer.version<1)throw Error('QMENTUM_WRITE_RESPONSE_INVALID');
  return{version:answer.version};
 };
}
