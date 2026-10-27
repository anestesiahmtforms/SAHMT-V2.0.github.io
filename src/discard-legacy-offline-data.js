// Exact allowlist: Firebase Authentication databases and server documents are
// deliberately outside this migration. Run before installing session/UI hooks.
export const LEGACY_OPERATIONAL_DATABASES=Object.freeze([
  'sahmt-v2-local','sahmt-fb-independent-local-v1','sahmt-sheet-delivery',
  'sahmt-operational-channel','sahmt-fb-html-content-v2'
]);
export async function discardLegacyOfflineData({indexedDB=globalThis.indexedDB,storages,caches=globalThis.caches,timeoutMs=5000}={}) {
  if(indexedDB)await Promise.all(LEGACY_OPERATIONAL_DATABASES.map(name=>new Promise((resolve,reject)=>{
    const request=indexedDB.deleteDatabase(name);
    const timer=setTimeout(()=>reject(Object.assign(new Error('Feche outras abas do SAHMT e reabra para concluir a remoção das pendências antigas.'),{code:'legacy-cleanup-blocked'})),timeoutMs);
    request.onsuccess=()=>{clearTimeout(timer);resolve();};
    request.onerror=()=>{clearTimeout(timer);reject(request.error);};
    // Another old tab must release its connection. Never continue into startup
    // on blocked deletion, and never delete databases outside the allowlist.
  })));
  if(!storages){storages=[];for(const key of ['localStorage','sessionStorage'])try{if(globalThis[key])storages.push(globalThis[key]);}catch{}}
  for(const storage of storages){
    const keys=Array.from({length:storage.length},(_,i)=>storage.key(i));
    for(const key of keys)if(key?.startsWith('sahmt:qmentum:FC:')||key==='sahmt-fb-html-content-v1')storage.removeItem(key);
  }
  await caches?.delete('sahmt-v2-offline-schedule-v1');
}
