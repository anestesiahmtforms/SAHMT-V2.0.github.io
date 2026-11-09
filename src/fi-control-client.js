export const FI_CONTROL_ENDPOINT='https://sahmt-fi-control.sahmt-fi-948f8565.workers.dev/v1/control';
const failure=code=>Object.assign(Error(code),{code});
export function createFiControlRequest({uid,isCurrent=()=>true,getIdToken,getAppCheckToken=async()=>null,fetchImpl=fetch,pilot=false}){
 let disposed=false;const active=()=>!disposed&&isCurrent(),controllers=new Set();
 const check=()=>{if(!active())throw failure('FI_SESSION_CHANGED');};
 async function send(action,input={},signal){
  check();if(!uid||typeof action!=='string'||!/^[a-z][A-Za-z0-9.]{0,80}$/.test(action)||!input||Array.isArray(input))throw failure('FI_INPUT_INVALID');
  const controller=new AbortController();controllers.add(controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{
   const token=await getIdToken();check();const appCheck=await getAppCheckToken();check();
   const endpoint=pilot?FI_CONTROL_ENDPOINT.replace(/control$/,'pilot'):FI_CONTROL_ENDPOINT;
   const response=await fetchImpl(endpoint,{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',...(appCheck?{'X-Firebase-AppCheck':appCheck}:{})},body:JSON.stringify({action,input})});check();
   if(!/^application\/json(?:;|$)/i.test(response.headers.get('Content-Type')||''))throw failure('FI_RESPONSE_INVALID');
   const reader=response.body?.getReader();if(!reader)throw failure('FI_RESPONSE_INVALID');let size=0;const parts=[];try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>3*1024*1024)throw failure('FI_RESPONSE_INVALID');parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
   check();const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}const body=JSON.parse(new TextDecoder().decode(bytes));
   if(!response.ok)throw failure(typeof body.code==='string'&&/^[A-Z0-9_]+$/.test(body.code)?body.code:'FI_UNAVAILABLE');return body;
  }finally{controllers.delete(controller);signal?.removeEventListener('abort',abort);}
 }
 send.dispose=()=>{disposed=true;for(const c of controllers)c.abort();controllers.clear();};return send;
}
export async function fiControlRequest(action,input,uid,{pilot=false}={}){
 const {auth}=await import('./firebase-auth.js'),user=auth?.currentUser;
 if(!uid||user?.uid!==uid)throw failure('FI_SESSION_CHANGED');
 const transport=createFiControlRequest({uid,pilot,isCurrent:()=>auth.currentUser===user,getIdToken:()=>user.getIdToken(),getAppCheckToken:async()=>{
  const {appCheckReady}=await import('./firebase-app.js');const appCheck=await appCheckReady;if(!appCheck)return null;const {getToken}=await import('firebase/app-check');return (await getToken(appCheck)).token;
 }});
 try{return await transport(action,input);}finally{transport.dispose();}
}
