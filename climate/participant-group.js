import {assignedInstitutionalGroup,institutionalAssignmentKey} from '../src/institutional-group.js';
import {googleIdentity,sameGoogleIdentity} from '../src/google-project-auth-core.js';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';

// Resolve the category from the authenticated institutional registry.
export async function resolveParticipantGroup({user,readAssignment}) {
  if(!user?.uid || !user.emailVerified || !user.email || !user.providerData?.some(p=>p.providerId==='google.com')) throw Error('REGISTRY_UNAVAILABLE');
  const assignment=await readAssignment(await institutionalAssignmentKey(user.email));
  const group=assignedInstitutionalGroup(assignment,{uid:user.uid,email:user.email});
  if(!group)throw Error('REGISTRY_UNAVAILABLE');
  return group;
}
export async function identifyInstitutionalGroup({sdk}={}) {
  const {initializeApp,getApps,getAuth}=sdk||Object.assign({},...await Promise.all([import('firebase/app'),import('firebase/auth')]));
  const restore=target=>{const entry=GOOGLE_PROJECT_CONFIG[target];return getAuth(getApps().find(a=>a.name===entry.appName)||initializeApp(entry.config,entry.appName));};
  // Same-origin survey pages reuse the sessions established by the app login.
  const source=restore('FA'),auth=restore('FE');
  await Promise.all([source.authStateReady(),auth.authStateReady()]);
  const primary=source.currentUser,user=auth.currentUser;
  const current=()=>primary&&user&&source.currentUser===primary&&auth.currentUser===user&&sameGoogleIdentity(user,googleIdentity(primary));
  if(!current())throw Error('SESSION_REQUIRED');
  const categoryKey=await institutionalAssignmentKey(user.email||'');
  const getToken=async()=>{
    if(!current())throw Error('SESSION_CHANGED');
    const token=await user.getIdToken();
    if(!current())throw Error('SESSION_CHANGED');
    return token;
  };
  const group=await resolveParticipantGroup({user,readAssignment:async key=>{
    const token=await getToken();
    const response=await fetch(`https://firestore.googleapis.com/v1/projects/outros-48120/databases/(default)/documents/userCategories/${key}`,{headers:{Authorization:`Bearer ${token}`},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('REGISTRY_UNAVAILABLE');
    const {fields:f}=await response.json();
    return {schemaVersion:Number(f?.schemaVersion?.integerValue),identityStatus:f?.identityStatus?.stringValue,uid:f?.uid?.stringValue,email:f?.email?.stringValue,memberCategories:f?.memberCategories?.arrayValue?.values?.map(v=>v.stringValue)};
  }});
  if(!current())throw Error('SESSION_CHANGED');
  return {group,uid:user.uid,categoryKey,getToken};
}
export function mountParticipantGate(host,form,onIdentified,{identify=identifyInstitutionalGroup}={}) {
  form.hidden=true;
  host.innerHTML='<p role="status" aria-live="polite" data-registry-status>Carregando seu cadastro e sua categoria…</p>';
  const status=host.querySelector('[data-registry-status]');
  void Promise.resolve().then(identify).then(participant=>{
    if(!host.isConnected)return;
    if(!['team','resident','substitute'].includes(participant?.group))throw Error('REGISTRY_UNAVAILABLE');
    onIdentified(participant.group,participant);form.hidden=false;host.replaceChildren();
  }).catch(()=>{if(host.isConnected)status.textContent='Não foi possível carregar sua sessão e categoria. Volte ao app para verificar sua conexão e seu cadastro.';});
}
