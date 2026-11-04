const incomplete = () => Object.assign(new Error('COMM_DIRECTORY_INCOMPLETE'), {code:'COMM_DIRECTORY_INCOMPLETE'});
const pause = (milliseconds, signal) => new Promise((resolve, reject) => {
 const abort = () => {clearTimeout(timer);signal?.removeEventListener('abort', abort);reject(signal.reason || new DOMException('Aborted', 'AbortError'));};
 const timer = setTimeout(() => {signal?.removeEventListener('abort', abort);resolve();}, milliseconds);
 signal?.addEventListener('abort', abort, {once:true});
 if(signal?.aborted)abort();
});

export async function loadCommunicationPushDirectory({request,isCurrent=()=>true,onProgress=()=>{},signal,wait=pause,now=Date.now}={}) {
 const users=new Map(),current=()=>!signal?.aborted&&isCurrent();
 async function collect(action,merge){
  let cursor='';
  const seen=new Set();
  do{
   if(!current())return false;
   let page;
   for(let retry=0;;retry++){
    try{page=await request(action,{cursor});break;}
    catch(error){
     if(!current())return false;
     if(error.code!=='COMM_RATE_LIMIT'||retry>=2)throw error;
     onProgress({waiting:true,count:users.size});
     try{await wait(60000-now()%60000+250,signal);}catch(error){if(!current())return false;throw error;}
     if(!current())return false;
    }
   }
   if(!current())return false;
   if(!Array.isArray(page?.items)||(page.cursor!=null&&typeof page.cursor!=='string'))throw incomplete();
   for(const user of page.items)merge(user);
   onProgress({waiting:false,count:users.size});
   cursor=page.cursor||'';
   if(cursor&&seen.has(cursor))throw incomplete();
   seen.add(cursor);
  }while(cursor);
  return true;
 }
 if(!await collect('DIRECTORY',user=>{
  const uid=user?.uid||user?.id;
  if(typeof uid!=='string'||!uid)return;
  const previous=users.get(uid);
  users.set(uid,{uid,displayName:String(user.displayName||previous?.displayName||''),email:String(user.email||previous?.email||''),sigla:String(user.sigla||previous?.sigla||''),devices:previous?.devices||[]});
 }))return null;
 if(users.size&&!await collect('PUSH_DEVICE_DIRECTORY',user=>{
  const previous=users.get(user?.uid);
  if(!previous)return;
  users.set(user.uid,{...previous,displayName:String(user.displayName||previous.displayName),email:String(user.email||previous.email),sigla:String(user.sigla||previous.sigla),devices:Array.isArray(user.devices)?user.devices:[]});
 }))return null;
 if(!current())return null;
 const activePush=device=>['ACTIVE','UNLINKED'].includes(device.pushStatus);
 const priority=user=>Number(user.devices.some(activePush));
 const label=user=>user.displayName||user.email||user.uid;
 return [...users.values()].map(user=>({...user,devices:[...user.devices].sort((a,b)=>Number(activePush(b))-Number(activePush(a)))})).sort((a,b)=>priority(b)-priority(a)||label(a).localeCompare(label(b),'pt-BR',{sensitivity:'base'})||a.uid.localeCompare(b.uid));
}
