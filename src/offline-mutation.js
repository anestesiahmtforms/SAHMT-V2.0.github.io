import {assertOnlineOperation, unconfirmedWrite} from './online-only.js';

export async function withOperationalDeadline(action, timeoutMs = 10000) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(action),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(Object.assign(new Error('O servidor ainda não confirmou o registro.'),{code:'deadline-exceeded'})),timeoutMs);
    })]);
  } finally {clearTimeout(timer);}
}

export async function persistOperationalMutation({id,online,sendRemote,onFailure=()=>{},timeoutMs}) {
  assertOnlineOperation({online});
  try {
    const result=await withOperationalDeadline(sendRemote,timeoutMs);
    if(result?.pendingFirestore)throw Object.assign(new Error('Resposta sem confirmação.'),{code:'unavailable'});
    return result;
  } catch(error) {
    await onFailure(error);
    throw unconfirmedWrite(error,id);
  }
}
