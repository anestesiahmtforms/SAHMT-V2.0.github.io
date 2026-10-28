export const SURVEY_APP_ORIGIN='https://anestesiahmtforms.github.io';
export const SURVEY_FE_ORIGIN='https://outros-48120.web.app';
const REQUEST='SAHMT_SURVEY_REQUEST_V1',REPLY='SAHMT_SURVEY_REPLY_V1';
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const challengeValid=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
export function bindSurveySession(frame,{perform,isCurrent=()=>true,appWindow=window,feOrigin=SURVEY_FE_ORIGIN}={}){
 let disposed=false;const requests=new Map();
 const listener=async event=>{
  const d=event.data;
  if(disposed||!isCurrent()||event.origin!==feOrigin||event.source!==frame.contentWindow||!exact(d,['type','challenge','action','input'])||d.type!==REQUEST||!challengeValid(d.challenge)||!['BOOTSTRAP','SUBMIT'].includes(d.action)||(d.action==='BOOTSTRAP'&&d.input!==null))return;
  try{if(JSON.stringify(d).length>32768)return;}catch{return;}
  if(!requests.has(d.challenge)){if(requests.size>=16)return;requests.set(d.challenge,Promise.resolve().then(()=>perform(d.action,d.input)).then(result=>({result}),()=>({error:'SURVEY_UNAVAILABLE'})));}
  const target=event.source,reply=await requests.get(d.challenge);
  if(!disposed&&isCurrent()&&target===frame.contentWindow)target.postMessage({type:REPLY,challenge:d.challenge,...reply},feOrigin);
 };
 appWindow.addEventListener('message',listener);
 return()=>{disposed=true;requests.clear();appWindow.removeEventListener('message',listener);};
}
export function requestSurveySession({action,input=null,signal,appWindow=window,parentOrigin=SURVEY_APP_ORIGIN,timeoutMs=25000}={}){
 if(appWindow.parent===appWindow)return Promise.reject(Error('OPEN_FROM_APP'));
 const challenge=[...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');
 return new Promise((resolve,reject)=>{
  let timer,retry;
  const cleanup=()=>{clearTimeout(timer);clearInterval(retry);appWindow.removeEventListener('message',listener);signal?.removeEventListener('abort',abort);};
  const abort=()=>{cleanup();reject(Error('UNAVAILABLE'));};
  const listener=event=>{
   if(event.origin!==parentOrigin||event.source!==appWindow.parent||event.data?.type!==REPLY||event.data.challenge!==challenge)return;
   if(exact(event.data,['type','challenge','result'])){cleanup();resolve(event.data.result);}
   else if(exact(event.data,['type','challenge','error'])&&event.data.error==='SURVEY_UNAVAILABLE'){cleanup();reject(Error('UNAVAILABLE'));}
  };
  appWindow.addEventListener('message',listener);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted){abort();return;}
  const send=()=>appWindow.parent.postMessage({type:REQUEST,challenge,action,input},parentOrigin);
  retry=setInterval(send,3000);timer=setTimeout(abort,timeoutMs);send();
 });
}
