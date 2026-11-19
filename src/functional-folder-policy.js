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
 let unsubscribe,stopAuth,reconnect,reading=false,revision=0;
 const reset=()=>{
  revision++;reading=false;const stop=unsubscribe;unsubscribe=null;stop?.();
  if(current())update(null,onChange);
 };
 const recover=()=>reconnect?.();
 const visible=()=>{if(!globalThis.document?.hidden)recover();};
 const offline=()=>reset();
 globalThis.addEventListener?.('offline',offline);
 globalThis.addEventListener?.('online',recover);
 globalThis.addEventListener?.('pageshow',recover);
 globalThis.document?.addEventListener('visibilitychange',visible);
 dispose=()=>{
  stopAuth?.();reset();
  globalThis.removeEventListener?.('offline',offline);
  globalThis.removeEventListener?.('online',recover);
  globalThis.removeEventListener?.('pageshow',recover);
  globalThis.document?.removeEventListener('visibilitychange',visible);
 };
 void Promise.all([import('./functional-firebase.js'),import('./google-project-auth-runtime.js')]).then(([{getFunctionalFirestore},{googleProjectAuth,verifyGoogleProjectSession}])=>{
  if(!current())return;
  const ready=state=>current()&&state.uid===uid&&!state.signingOut&&state.targets.FK?.status==='ready';
  reconnect=async()=>{
   if(reading||globalThis.navigator?.onLine===false||!ready(googleProjectAuth.snapshot()))return;
   reading=true;
   const ticket=++revision;
   const valid=()=>ticket===revision&&ready(googleProjectAuth.snapshot());
   try{
    const authenticated=await verifyGoogleProjectSession('FK');
    if(!valid())return;
    const db=authenticated&&getFunctionalFirestore();
    if(!db){reset();return;}
    unsubscribe=onSnapshot(doc(db,'runtimePolicy','folders'),{includeMetadataChanges:true},snapshot=>{
     if(!valid())return;
     if(snapshot.metadata.fromCache||snapshot.metadata.hasPendingWrites){update(null,onChange);return;}
     const next=snapshot.exists()?snapshot.data():initialFunctionalFolderPolicy;
     update(functionalFolderPolicyValid(next)?next:null,onChange);
    },()=>{if(valid())reset();});
   }catch{if(valid())reset();}
  };
  let wasReady=false;
  stopAuth=googleProjectAuth.subscribe(state=>{
   const nowReady=ready(state);
   if(!nowReady&&wasReady)reset();
   if(nowReady&&!wasReady)void recover();
   wasReady=nowReady;
  });
 }).catch(()=>{if(current())reset();});
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
