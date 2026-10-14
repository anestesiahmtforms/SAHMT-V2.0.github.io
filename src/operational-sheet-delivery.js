// Metadata only: no patient data, names, email addresses or tokens are persisted.
const COLLECTIONS=new Set(['events','labels','checklists']);
const flights=new Map(),volatileRecords=new Map();let dbPromise;
function endpoint() {
  const raw=import.meta.env?.VITE_OPERATIONAL_SHEETS_ENDPOINT;
  if(!raw)return null;
  try {const url=new URL(raw);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&
    url.pathname==='/v1/operational-sheets/notify'?url.href:null;}catch{return null;}
}
function database() {
  if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
    const request=indexedDB.open('sahmt-sheet-delivery',1);
    let settled=false;
    const timeout=setTimeout(()=>{settled=true;dbPromise=null;reject(Error('CONTROLE_FILA_INDISPONIVEL'));},2500);
    request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'key'}).createIndex('uid','uid');
    request.onsuccess=()=>{clearTimeout(timeout);if(settled){request.result.close();return;}settled=true;resolve(request.result);};
    request.onerror=()=>{clearTimeout(timeout);settled=true;dbPromise=null;reject(Error('CONTROLE_FILA_INDISPONIVEL'));};
  });return dbPromise;
}
async function transaction(mode,work) {
  const db=await database();return new Promise((resolve,reject)=>{
    const tx=db.transaction('pending',mode);let request;
    try {request=work(tx.objectStore('pending'));}catch{reject(Error('CONTROLE_FILA_INDISPONIVEL'));return;}
    tx.oncomplete=()=>resolve(request?.result);tx.onerror=()=>reject(Error('CONTROLE_FILA_INDISPONIVEL'));
    tx.onabort=tx.onerror;
  });
}
function metadata(collection,id,uid) {
  if(!endpoint()||!COLLECTIONS.has(collection)||!uid||! /^[A-Za-z0-9_-]{1,128}$/.test(id))return null;
  return {key:JSON.stringify([uid,collection,id]),uid,collection,id};
}
async function save(record) {
  // Reporting storage failures must never reject the primary Firestore write.
  volatileRecords.set(record.key,record);
  try {await transaction('readwrite',store=>store.put(record));
    if(volatileRecords.get(record.key)===record)volatileRecords.delete(record.key);
  }catch{/* Keep metadata in memory until the next delivery attempt. */}
}
async function forget(key) {
  volatileRecords.set(key,null);
  try {await transaction('readwrite',store=>store.delete(key));volatileRecords.delete(key);}catch{}
}
async function pending(uid) {
  let saved=[];
  try {saved=await transaction('readonly',store=>store.index('uid').getAll(IDBKeyRange.only(uid)));}catch{}
  const records=new Map(saved.map(record=>[record.key,record]));
  for(const [key,record] of volatileRecords) {
    if(record===null)records.delete(key);else if(record.uid===uid)records.set(key,record);
  }
  return [...records.values()].filter(record=>record.state==='ready');
}
export async function prepareOperationalSheetDelivery(collection,id,uid) {
  const record=metadata(collection,id,uid);if(!record)return;
  let previous=volatileRecords.get(record.key);
  if(!volatileRecords.has(record.key)) {
    try {previous=await transaction('readonly',store=>store.get(record.key));}catch{}
  }
  if(!previous)await save({...record,state:'prepared'});
}
export async function confirmOperationalSheetDelivery(collection,id,uid) {
  const record=metadata(collection,id,uid);if(record)await save({...record,state:'ready'});
}
export async function flushOperationalSheetDelivery(uid) {
  const url=endpoint();if(!url||!uid||!navigator.onLine)return;
  if(flights.has(uid)){flights.get(uid).again=true;return flights.get(uid).promise;}
  const flight={again:false,promise:null};flights.set(uid,flight);
  flight.promise=(async()=>{
    const {auth}=await import('./firebase-auth.js');const attempted=new Set();
    do {
      flight.again=false;
      const records=await pending(uid);
      for(const record of records) {
        if(attempted.has(record.key))continue;
        attempted.add(record.key);
        if(auth?.currentUser?.uid!==uid||!navigator.onLine)return;
        const user=auth.currentUser,token=await user.getIdToken();
        if(auth.currentUser!==user)return;
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
        try {
          const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
            body:JSON.stringify({collection:record.collection,id:record.id}),credentials:'omit',cache:'no-store',
            referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
          const text=await response.text();if(text.length>2048)throw Error('CONTROLE_RESPOSTA_INVALIDA');
          const value=JSON.parse(text);
          if((response.status===200&&['CONTROLE_REGISTRO_RECEBIDO','CONTROLE_REGISTRO_JA_RECEBIDO'].includes(value.code))||
            (response.status===409&&value.code==='CONTROLE_REGISTRO_REMOVIDO'))
            await forget(record.key);
          else if(response.status===503)return; // no timer or automatic retry loop
        }catch{return;}finally{clearTimeout(timer);}
      }
    }while(flight.again);
  })().catch(()=>{}).finally(()=>flights.delete(uid));
  return flight.promise;
}
