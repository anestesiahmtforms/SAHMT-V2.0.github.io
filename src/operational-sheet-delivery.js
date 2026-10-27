// A single best-effort notification after a confirmed Firestore write.
// No metadata queue, IndexedDB, retries or reconnect/startup drain.
export async function prepareOperationalSheetDelivery() {}
export async function flushOperationalSheetDelivery() {}
export async function confirmOperationalSheetDelivery(collection,id,uid) {
  if(!['events','labels','checklists'].includes(collection)||!uid||! /^[A-Za-z0-9_-]{1,128}$/.test(id)||globalThis.navigator?.onLine===false)return;
  const raw=import.meta.env?.VITE_OPERATIONAL_SHEETS_ENDPOINT;
  if(!raw)return;
  let url;try{url=new URL(raw);}catch{return;}
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/v1/operational-sheets/notify')return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try {
    const {auth}=await import('./firebase-auth.js');
    const user=auth?.currentUser;if(user?.uid!==uid)return;
    const token=await user.getIdToken();if(auth.currentUser!==user||globalThis.navigator?.onLine===false)return;
    await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({collection,id}),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error',signal:controller.signal});
  }catch{/* The confirmed Firestore write is independent of spreadsheet delivery. */}
  finally{clearTimeout(timer);}
}
