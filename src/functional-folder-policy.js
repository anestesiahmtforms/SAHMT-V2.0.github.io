import {doc,onSnapshot} from 'firebase/firestore';
import {functionalFolders,initialFunctionalFolderPolicy,functionalFolderAllowed,functionalFolderPolicyValid} from './operational-folders.js';
import {governanceSessionReady} from './governance-access.js';

let owner='',policy=null,dispose,epoch=0,administrator=false;
const subscribers=new Set();

export function setFunctionalFolderSession(session){
 administrator=governanceSessionReady(session)&&session.accountMode!=='team'&&
  (session.profile.role==='administrador_app'||session.profile.permissions?.admin===true);
}
export const functionalFolderPolicy=()=>policy;
export function functionalFolderContentAllowed(id){return administrator||functionalFolderAllowed(policy,id);}
export function subscribeFunctionalFolderPolicy(subscriber){subscribers.add(subscriber);subscriber(policy);return()=>subscribers.delete(subscriber);}
function update(next,onChange){
 if(JSON.stringify(policy)===JSON.stringify(next))return;
 policy=next;for(const subscriber of subscribers)subscriber(policy);onChange?.();
}
export function watchFunctionalFolderPolicy(uid,onChange){
 if(owner===uid)return;
 const generation=++epoch;owner=uid;dispose?.();dispose=null;update(null);
 if(!uid)return;
 const current=()=>generation===epoch&&owner===uid;
 const offline=()=>{if(current())update(null,onChange);};
 let unsubscribe;
 globalThis.addEventListener?.('offline',offline);
 dispose=()=>{unsubscribe?.();globalThis.removeEventListener?.('offline',offline);};
 void Promise.all([import('./functional-firebase.js')]).then(([{getFunctionalFirestore}])=>{
  if(!current())return;
  const db=getFunctionalFirestore();if(!db){offline();return;}
  unsubscribe=onSnapshot(doc(db,'runtimePolicy','folders'),{includeMetadataChanges:true},snapshot=>{
   if(!current())return;
   if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites||globalThis.navigator?.onLine===false){offline();return;}
   const next=snapshot.exists()?snapshot.data():initialFunctionalFolderPolicy;
   update(functionalFolderPolicyValid(next)?next:null,onChange);
  },offline);
 }).catch(offline);
}
export function functionalFolderNotice(id){
 if(!functionalFolders[id])return '';
 if(!policy)return administrator?'':'<aside class="notice folder-inactive-notice" role="status">Atividades do Funcional FK indisponíveis enquanto o servidor confirma a situação. A navegação continua disponível.</aside>';
 const blocker=id.split('/').map((_,index,parts)=>parts.slice(0,index+1).join('/')).find(folder=>policy.disabled.includes(folder));
 if(!blocker)return '';
 const label=blocker===id?(administrator?'Pasta inativa para os demais usuários.':'Pasta inativa.'):'Subpasta inativa por causa da pasta principal.';
 if(!administrator)return '<aside class="notice folder-inactive-notice" role="status"><strong>'+label+'</strong> Você pode navegar pelas subpastas. As atividades permanecem bloqueadas até a reativação.</aside>';
 return '<aside class="notice folder-inactive-notice"><strong>'+label+'</strong> <a href="#/fi-control/'+encodeURIComponent(blocker)+'">Reativar no Controle de Pastas FK</a></aside>';
}
