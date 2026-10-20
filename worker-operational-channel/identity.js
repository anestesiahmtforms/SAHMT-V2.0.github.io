import {channelError} from '../src/provisional-channel-contract.js';
export async function readChannelJson(message, maximum = 32768) {
  if(!message.body)throw channelError('CHANNEL_BODY_MISSING');
  const reader=message.body.getReader(),chunks=[];let size=0;
  try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>maximum)throw channelError('CHANNEL_BODY_TOO_LARGE',413);chunks.push(value);}}
  finally {await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw channelError('CHANNEL_JSON_INVALID');}
}
export function createChannelIdentityVerifier({fetchImpl=fetch,now=Date.now}={}) {
  return async function verify(token,apiKey,appCheckToken) {
    if(typeof apiKey!=='string'||!/^[A-Za-z0-9_-]{20,100}$/.test(apiKey)||typeof token!=='string'||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)||token.length>16000)throw channelError('CHANNEL_AUTH_INVALID',401);
    let response;
    try {response=await fetchImpl('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key='+apiKey,{method:'POST',headers:{'Content-Type':'application/json','Cache-Control':'no-store',...(appCheckToken?{'X-Firebase-AppCheck':appCheckToken}:{})},body:JSON.stringify({idToken:token}),redirect:'manual',signal:AbortSignal.timeout(5000)});}
    catch {throw channelError('CHANNEL_AUTH_UNAVAILABLE',503);}
    if(response.status!==200){await response.body?.cancel();throw channelError(response.status===429||response.status>=500?'CHANNEL_AUTH_UNAVAILABLE':'CHANNEL_AUTH_DENIED',response.status===429||response.status>=500?503:401);}
    // The FA API key selects the Firebase project. Auth validates the exact ID token
    // before any decoded claim can be used. No unverified JWT authorizes a request.
    const value=await readChannelJson(response,16384);let claims;
    try {const part=token.split('.')[1],raw=atob(part.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-part.length%4)%4));claims=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(raw,c=>c.charCodeAt(0))));}catch{throw channelError('CHANNEL_AUTH_INVALID',401);}
    const user=value.users?.length===1?value.users[0]:null,time=Math.floor(now()/1000);
    if(!user||claims.aud!=='sahmt-17a16'||claims.iss!=='https://securetoken.google.com/sahmt-17a16'||claims.sub!==user.localId||user.disabled===true||user.emailVerified!==true||
      claims.email_verified!==true||!Number.isSafeInteger(claims.exp)||claims.exp<=time||!Number.isSafeInteger(claims.iat)||claims.iat>time+60||claims.exp-claims.iat>3600||
      !Number.isSafeInteger(claims.auth_time)||claims.auth_time>claims.iat||claims.auth_time<Number(user.validSince||0)||claims.firebase?.sign_in_provider!=='google.com'||claims.firebase?.tenant||
      !user.providerUserInfo?.some(provider=>provider.providerId==='google.com'&&claims.firebase.identities?.['google.com']?.includes(provider.rawId)))throw channelError('CHANNEL_AUTH_DENIED',401);
    return {uid:user.localId};
  };
}
