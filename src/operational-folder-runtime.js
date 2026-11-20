import {deployment} from './deployment-context.js';
import {initialOperationalFolderPolicy,operationalFolderAllowed,operationalRouteFolder} from './operational-folders.js';
import {governanceSessionReady} from './governance-access.js';
import {functionalFolderContentAllowed,functionalFolderInactive,setFunctionalFolderSession,watchFunctionalFolderPolicy} from './functional-folder-policy.js';

// Folder availability is a permanent governance rule for FA and FB. Keeping it
// behind a build flag silently re-enables every activity when CI omits that flag.
export const operationalFolderPolicyEnabled=['FA','FB'].includes(deployment.target);

let owner='',policy=null,dispose,epoch=0;
let administrator=false;
export function setOperationalFolderSession(session) {
 administrator=governanceSessionReady(session)&&session.accountMode!=='team'&&
  (session.profile.role==='administrador_app'||session.profile.permissions?.admin===true);
 setFunctionalFolderSession(session);
}
const subscribers=new Set();
export const operationalFolderPolicy=()=>policy;
// Folder availability controls activity; route/profile ACLs control navigation.
export function operationalFolderRouteAllowed() { return true; }
export function operationalRouteActivityAllowed(route) {
 const id=operationalRouteFolder(route);
 return !id||operationalContentAllowed(id);
}
export function operationalContentAllowed(id) {
 if(typeof id==='string'&&(id==='funcional'||id.startsWith('funcional/')))return functionalFolderContentAllowed(id);
 // These centers are permanently exempt from folder availability. Access to
 // them remains governed by the role checks in the route and module ACLs.
 if(id==='comunicacao'||id==='fi-control')return true;
 return !operationalFolderPolicyEnabled||administrator||operationalFolderAllowed(policy,id);
}
export function operationalFolderInactive(id) {
 if(typeof id==='string'&&(id==='funcional'||id.startsWith('funcional/')))return functionalFolderInactive(id);
 return Boolean(operationalFolderPolicyEnabled&&policy&&typeof id==='string'&&id!=='comunicacao'&&id!=='fi-control'&&!operationalFolderAllowed(policy,id));
}

export function assertOperationalContentAllowed(id) {
 if(!operationalContentAllowed(id))throw Object.assign(Error('Esta atividade está indisponível.'),{code:'FOLDER_DISABLED'});
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
 watchFunctionalFolderPolicy(uid,onChange);
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
