import {fcIntegrationEndpoint} from './fc-integration-config.js';
export function createQmentumPrintClient({auth,uid,isCurrent=()=>true,endpoint,integrationEnv=import.meta.env||{},fetchImpl=globalThis.fetch}={}){
 const ensure=()=>{if(auth?.app?.options?.projectId!=='indicadores---sahmt')throw Error('QMENTUM_FC_REQUIRED');if(!uid||!isCurrent()||auth.currentUser?.uid!==uid)throw Error('QMENTUM_SESSION_CHANGED');};
 const call=async(operation,payload)=>{
  ensure();let url;try{url=new URL(endpoint||fcIntegrationEndpoint('/v1/qmentum/prints',{env:integrationEnv,fallback:integrationEnv.VITE_OPERATIONAL_SHEETS_ENDPOINT}));if(url.protocol!=='https:'||url.username||url.password)throw Error();url.pathname='/v1/qmentum/prints';url.search='';url.hash='';}catch{throw Error('QMENTUM_PRINT_CONFIG_REQUIRED');}
  const body=JSON.stringify({...payload,operation});if(new TextEncoder().encode(body).length>6000000)throw Error('QMENTUM_PRINT_IMAGE_LIMIT');
  const token=await auth.currentUser.getIdToken();ensure();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
  try{
   const r=await fetchImpl(url.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body,credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
   const text=await r.text();ensure();if(new TextEncoder().encode(text).length>350000)throw Error('QMENTUM_PRINT_RESPONSE_INVALID');
   let answer;try{answer=JSON.parse(text);}catch{throw Error('QMENTUM_PRINT_UNAVAILABLE');}
   const expected={SCAN:'QMENTUM_PRINT_SCAN',PREVIEW:'QMENTUM_PRINT_PREVIEW',APPLY:'QMENTUM_PRINT_APPLIED'}[operation];
   if(!r.ok||answer?.code!==expected||!answer.result)throw Error(/^QMENTUM_[A-Z_]+$/.test(answer?.code||'')?answer.code:'QMENTUM_PRINT_UNAVAILABLE');
   if(operation==='APPLY'&&(!['CONFIRMED','UNCHANGED'].includes(answer.result.status)||!Number.isSafeInteger(answer.result.version)||answer.result.version<1))throw Error('QMENTUM_PRINT_RESPONSE_INVALID');
   return answer.result;
  }catch(error){ensure();if(/^QMENTUM_[A-Z_]+$/.test(error?.message||''))throw error;throw Error('QMENTUM_PRINT_UNAVAILABLE');}finally{clearTimeout(timer);}
 };
 return{scan:payload=>call('SCAN',payload),preview:payload=>call('PREVIEW',payload),apply:payload=>call('APPLY',payload)};
}
