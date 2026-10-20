// Durable metadata only. Record contents stay in the existing operational outbox.
let opening;
function database(){
  if(!opening)opening=new Promise((resolve,reject)=>{
    const request=indexedDB.open('sahmt-operational-channel',1);let finished=false;
    const timer=setTimeout(()=>{finished=true;opening=null;reject(Error('CHANNEL_LOCAL_STORAGE_UNAVAILABLE'));},2500);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore('receipts',{keyPath:'key'});store.createIndex('uid','uid');};
    request.onsuccess=()=>{clearTimeout(timer);if(finished){request.result.close();return;}finished=true;request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
    request.onerror=()=>{clearTimeout(timer);opening=null;reject(Error('CHANNEL_LOCAL_STORAGE_UNAVAILABLE'));};
  });return opening;
}
export async function updateChannelReceipt(uid,id,patch){
  const db=await database();return new Promise((resolve,reject)=>{
    const tx=db.transaction('receipts','readwrite'),store=tx.objectStore('receipts'),key=JSON.stringify([uid,id]),read=store.get(key);let result;
    read.onsuccess=()=>{result={...read.result,...patch,key,uid,requestId:id};store.put(result);};
    tx.oncomplete=()=>resolve(result);tx.onerror=tx.onabort=()=>reject(Error('CHANNEL_LOCAL_STORAGE_UNAVAILABLE'));
  });
}
export async function listChannelReceipts(uid){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('receipts'),request=tx.objectStore('receipts').index('uid').getAll(IDBKeyRange.only(uid));tx.oncomplete=()=>resolve(request.result||[]);tx.onerror=()=>reject(Error('CHANNEL_LOCAL_STORAGE_UNAVAILABLE'));});}
export async function removeChannelReceipt(uid,id){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('receipts','readwrite');tx.objectStore('receipts').delete(JSON.stringify([uid,id]));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('CHANNEL_LOCAL_STORAGE_UNAVAILABLE'));});}
