const incomplete=()=>Object.assign(new Error('COMM_DIRECTORY_INCOMPLETE'),{code:'COMM_DIRECTORY_INCOMPLETE'});
const pause=(milliseconds,signal)=>new Promise((resolve,reject)=>{
 const abort=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason||new DOMException('Aborted','AbortError'));};
 const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},milliseconds);
 signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
});
export async function loadCommunicationPushDirectory({request,isCurrent=()=>true,onProgress=()=>{},signal,wait=pause,now=Date.now}={}){
 const users=new Map(),devices=new Map(),waitingStages=new Set(),controller=new AbortController(),cancel=()=>controller.abort();
 signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
 const current=()=>!controller.signal.aborted&&isCurrent(),activePush=device=>['ACTIVE','UNLINKED'].includes(device.pushStatus);
 const snapshot=(complete=false)=>[...users.values()].map(user=>({...user,pushPending:!complete&&user.pushPending!==false,devices:[...user.devices].sort((a,b)=>Number(activePush(b))-Number(activePush(a)))})).sort((a,b)=>Number(b.devices.some(activePush))-Number(a.devices.some(activePush))||(a.displayName||a.email||a.uid).localeCompare(b.displayName||b.email||b.uid,'pt-BR',{sensitivity:'base'})||a.uid.localeCompare(b.uid));
 const progress=(stage,waiting=false)=>{if(waiting)waitingStages.add(stage);else waitingStages.delete(stage);if(current())onProgress({stage,waiting:waitingStages.size>0,count:users.size,items:snapshot(),complete:false});};
 let pushTask;
 async function collect(action,merge,afterPage=()=>{}){
  let cursor='';const seen=new Set();
  do{
   if(!current())return false;let page;
   for(let retry=0;;retry++){
    try{page=await request(action,{cursor});break;}
    catch(error){
     if(!current())return false;if(error.code!=='COMM_RATE_LIMIT'||retry>=2)throw error;
     progress(action,true);
     try{await wait(60000-now()%60000+250,controller.signal);}catch(error){if(!current())return false;throw error;}
    }
   }
   if(!current())return false;
   if(!Array.isArray(page?.items)||(page.cursor!=null&&typeof page.cursor!=='string'))throw incomplete();
   for(const user of page.items)merge(user);
   progress(action);afterPage();
   cursor=page.cursor||'';if(cursor&&seen.has(cursor))throw incomplete();seen.add(cursor);
  }while(cursor);return true;
 }
 const startDevices=()=>{
  if(pushTask||!users.size)return;
  // Read the two directories concurrently; each directory still follows its own cursor.
  pushTask=collect('PUSH_DEVICE_DIRECTORY',user=>{
   if(typeof user?.uid!=='string')return;devices.set(user.uid,user);
   const previous=users.get(user.uid);if(previous)users.set(user.uid,{...previous,displayName:String(user.displayName||previous.displayName),email:String(user.email||previous.email),sigla:String(user.sigla||previous.sigla),devices:Array.isArray(user.devices)?user.devices:[],pushPending:false});
  }).then(done=>({done}),error=>({error}));
 };
 try{
  if(!await collect('DIRECTORY',user=>{
   const uid=user?.uid||user?.id;if(typeof uid!=='string'||!uid)return;
   const previous=users.get(uid),device=devices.get(uid);
   users.set(uid,{uid,displayName:String(user.displayName||device?.displayName||previous?.displayName||''),email:String(user.email||device?.email||previous?.email||''),sigla:String(device?.sigla||user.sigla||previous?.sigla||''),devices:Array.isArray(device?.devices)?device.devices:previous?.devices||[],pushPending:!device});
  },startDevices))return null;
  if(pushTask){const result=await pushTask;if(result.error)throw result.error;if(!result.done)return null;}
  if(!current())return null;
  const items=snapshot(true);onProgress({waiting:false,count:items.length,items,complete:true});return items;
 }finally{cancel();signal?.removeEventListener('abort',cancel);}
}
