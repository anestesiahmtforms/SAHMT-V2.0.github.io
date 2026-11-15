import {deployment} from './deployment-context.js';
import {initialOperationalFolderPolicy,operationalFolderAllowed,operationalRouteFolder,operationalFolders} from './operational-folders.js';
import {governanceSessionReady} from './governance-access.js';

export const operationalFolderPolicyEnabled=['FA','FB'].includes(deployment.target)&&import.meta.env?.VITE_FOLDER_POLICY_ENABLED==='true';

let owner='',policy=null,dispose,epoch=0;
let administrator=false;
export function setOperationalFolderSession(session) {
 administrator=governanceSessionReady(session)&&session.accountMode!=='team'&&
  (session.profile.role==='administrador_app'||session.profile.permissions?.admin===true);
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
 // These centers are permanently exempt from folder availability. Access to
 // them remains governed by the role checks in the route and module ACLs.
 if(id==='comunicacao'||id==='fi-control')return true;
 return !operationalFolderPolicyEnabled||administrator||operationalFolderAllowed(policy,id);
}
export function operationalFolderNotice(id) {
 if(id==='comunicacao'||id==='fi-control')return '';
 if(!operationalFolderPolicyEnabled||!Object.hasOwn(operationalFolders,id))return '';
 if(!policy)return administrator?'':'<aside class="notice folder-inactive-notice" role="status">Atividades indisponíveis enquanto o servidor confirma a situação da pasta. A navegação continua disponível.</aside>';
 const blocker=id.split('/').map((_,index,parts)=>parts.slice(0,index+1).join('/')).find(folder=>policy.disabled.includes(folder));
 if(!blocker)return '';
 const label=blocker===id?(administrator?'Pasta inativa para os demais usuários.':'Pasta inativa.'):'Subpasta inativa por causa da pasta principal.';
 if(!administrator)return '<aside class="notice folder-inactive-notice" role="status"><strong>'+label+'</strong> Você pode navegar pelas subpastas. As atividades permanecem bloqueadas até a reativação.</aside>';
 return '<aside class="notice folder-inactive-notice"><strong>'+label+'</strong> <a href="'+(deployment.target==='FB'?deployment.faBase:'')+'#/fi-control/'+
  encodeURIComponent(blocker)+'">Reativar no Controle de Pastas</a></aside>';
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
