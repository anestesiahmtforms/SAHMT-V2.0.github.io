/** Account/version partitioned content only. Authorization must be checked before read(). */
export function createContentCache(storage,{indexedDB=globalThis.indexedDB}={}){
 const localKey='sahmt-fb-html-content-v1',memory=new Map();let database;
 const key=(uid,id,version)=>JSON.stringify([uid,id,version]);
 const local=()=>{try{const value=JSON.parse(storage?.getItem(localKey)||'[]');return Array.isArray(value)?value:[];}catch{return [];}};
 const clean=value=>({sections:(value.sections||[]).map(s=>({id:String(s.id||''),title:String(s.title||''),html:String(s.html||'')})),revision:value.revision});
 function open(){
  if(!indexedDB)return Promise.resolve(null);
  if(!database)database=new Promise(resolve=>{
   const request=indexedDB.open('sahmt-fb-html-content-v2',1);
   request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('content'))request.result.createObjectStore('content',{keyPath:'key'});};
   request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
   request.onerror=()=>resolve(null);request.onblocked=()=>resolve(null);
  });
  return database;
 }
 const cache={
  get(uid,id,version){return memory.get(key(uid,id,version))||local().find(e=>e.uid===uid&&e.id===id&&e.version===version)?.content||null;},
  async read(uid,id,version){
   const hit=cache.get(uid,id,version);if(hit)return hit;
   try{const db=await open();if(!db)return null;return await new Promise(resolve=>{const request=db.transaction('content').objectStore('content').get(key(uid,id,version));request.onsuccess=()=>{const value=request.result?.content||null;if(value)memory.set(key(uid,id,version),value);resolve(value);};request.onerror=()=>resolve(null);});}catch{return null;}
  },
  async put(uid,id,version,content){
   const value=clean({...content,revision:content.revision??version});const size=JSON.stringify(value).length;
   if(size>8000000)return;
   const idKey=key(uid,id,version);memory.set(idKey,value);
   if(size<=2000000){const entries=[{uid,id,version,content:value},...local().filter(e=>!(e.uid===uid&&e.id===id))].slice(0,8);while(JSON.stringify(entries).length>4000000)entries.pop();try{storage?.setItem(localKey,JSON.stringify(entries));}catch{}}
   try{
    const db=await open();if(!db)return;
    await new Promise(resolve=>{
     const tx=db.transaction('content','readwrite'),store=tx.objectStore('content');
     store.put({key:idKey,uid,id,version,content:value,bytes:size*2,at:Date.now()});
     const all=store.getAll();all.onsuccess=()=>{const entries=all.result.sort((a,b)=>b.at-a.at);let bytes=0;for(const [index,entry]of entries.entries()){bytes+=entry.bytes;if(index>=72||bytes>32000000)store.delete(entry.key);}};
     tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();tx.onabort=()=>resolve();
    });
   }catch{/* Optional cache failure never changes training state. */}
  }
 };
 return cache;
}
