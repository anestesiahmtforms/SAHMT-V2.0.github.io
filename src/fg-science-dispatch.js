import {sessionEndpoint} from './firebase-config-fg.js';
import {auth} from './firebase-auth.js';

export async function dispatchFgScience({day,uid}){
  const user=auth?.currentUser;
  if(!user||user.uid!==uid)return;
  const token=await user.getIdToken();
  if(auth.currentUser!==user)return;
  const endpoint=new URL('/v1/science/settle',sessionEndpoint);
  const response=await fetch(endpoint,{method:'POST',credentials:'omit',redirect:'error',keepalive:true,
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({day}),signal:AbortSignal.timeout(30000)});
  if(!response.ok){await response.body?.cancel();return;}
  const result=await response.json();
  if(auth.currentUser===user)return result.code;
}
