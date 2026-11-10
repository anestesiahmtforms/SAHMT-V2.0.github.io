import {deployment} from './deployment-context.js';
import {initialOperationalFolderPolicy,operationalFolderAllowed,operationalRouteFolder} from './operational-folders.js';

export const operationalFolderPolicyEnabled=['FA','FB'].includes(deployment.target)&&import.meta.env?.VITE_FOLDER_POLICY_ENABLED==='true';

let owner='',policy=null,dispose,epoch=0;
const subscribers=new Set();
export const operationalFolderPolicy=()=>policy;
export function operationalFolderRouteAllowed(route) {
 const id=operationalRouteFolder(route);
 return !operationalFolderPolicyEnabled||!id||operationalFolderAllowed(policy,id);
}
export function operationalContentAllowed(id) {
 return !operationalFolderPolicyEnabled||operationalFolderAllowed(policy,id);
}
export function assertOperationalContentAllowed(id) {
 if(!operationalContentAllowed(id))throw Object.assign(Error('Área desativada ou sem confirmação do servidor.'),{code:'FOLDER_DISABLED'});
}
export function subscribeOperationalFolderPolicy(subscriber) {
 subscribers.add(subscriber);
 subscriber(policy);
 return ()=>subscribers.delete(subscriber);
}
function update(next,onChange) {
 if(JSON.stringify(policy)===JSON.stringify(next))return;
 policy=next;
 for(const subscriber of subscribers)subscriber(policy);
 onChange?.();
}

export function watchOperationalFolderPolicy(uid,onChange) {
 if(!operationalFolderPolicyEnabled||owner===uid)return;
 const generation=++epoch;
 owner=uid;
 dispose?.();dispose=null;
 update(null);
 if(!uid)return;
 const current=()=>generation===epoch&&owner===uid;
 const offline=()=>{if(current())update(null,onChange);};
 let unsubscribe;
 globalThis.addEventListener?.('offline',offline);
 dispose=()=>{unsubscribe?.();globalThis.removeEventListener?.('offline',offline);};
 void Promise.all([import('./firebase.js'),import('firebase/firestore')]).then(([{db},{doc,onSnapshot}])=>{
  if(!current())return;
  unsubscribe=onSnapshot(doc(db,'runtimePolicy','folders'),{includeMetadataChanges:true},snapshot=>{
   if(!current())return;
   if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites||globalThis.navigator?.onLine===false)return offline();
   const next=snapshot.exists()?snapshot.data():initialOperationalFolderPolicy;
   update(operationalFolderAllowed(next,'policy-probe')?next:null,onChange);
  },offline);
 }).catch(offline);
}
