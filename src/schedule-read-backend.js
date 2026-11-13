import {createOperationalBackend} from './operational-backend.js';

// FJ availability and quota do not describe the connection to the FA profile.
// The session is prepared before starting this circuit's Firestore read timer.
let storage;try{storage=globalThis.localStorage;}catch{}
export const scheduleReadBackend=createOperationalBackend({storage,storageKey:'sahmt-fj-firestore-read-backoff-v1'});
globalThis.addEventListener?.('pagehide',()=>scheduleReadBackend.interruptReads());
globalThis.document?.addEventListener('visibilitychange',()=>{
  if(globalThis.document.hidden)scheduleReadBackend.interruptReads();
});
