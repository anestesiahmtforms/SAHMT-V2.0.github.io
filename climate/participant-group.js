import {assignedInstitutionalGroup,institutionalAssignmentKey} from '../src/institutional-group.js';
import {GOOGLE_PROJECT_CONFIG} from '../src/google-project-auth-config.js';

// Authentication is used for this isolated registry read. No answer or submission
// identifier is passed here. The caller receives only one broad activity group.
export async function resolveParticipantGroup({user,readAssignment}) {
  if(!user?.uid || !user.emailVerified || !user.email || !user.providerData?.some(p=>p.providerId==='google.com')) throw Error('REGISTRY_UNAVAILABLE');
  const assignment=await readAssignment(await institutionalAssignmentKey(user.email));
  const group=assignedInstitutionalGroup(assignment,{uid:user.uid,email:user.email});
  if(!group)throw Error('REGISTRY_UNAVAILABLE');
  return group;
}
export async function identifyInstitutionalGroup() {
  const [{initializeApp,getApps},{getAuth,setPersistence,inMemoryPersistence,GoogleAuthProvider,signInWithPopup,signOut}]=await Promise.all([import('firebase/app'),import('firebase/auth')]);
  const name='institutional-category-only',app=getApps().find(a=>a.name===name)||initializeApp(GOOGLE_PROJECT_CONFIG.FE.config,name),auth=getAuth(app);
  await setPersistence(auth,inMemoryPersistence);
  let group;
  try {
    await signOut(auth);
    const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
    const {user}=await signInWithPopup(auth,provider);
    group=await resolveParticipantGroup({user,readAssignment:async key=>{
      const token=await user.getIdToken();
      const response=await fetch(`https://firestore.googleapis.com/v1/projects/outros-48120/databases/(default)/documents/userCategories/${key}`,{headers:{Authorization:`Bearer ${token}`},credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('REGISTRY_UNAVAILABLE');
      const {fields:f}=await response.json();
      return {schemaVersion:Number(f?.schemaVersion?.integerValue),identityStatus:f?.identityStatus?.stringValue,uid:f?.uid?.stringValue,email:f?.email?.stringValue,memberCategories:f?.memberCategories?.arrayValue?.values?.map(v=>v.stringValue)};
    }});
  } finally { await signOut(auth); }
  return group;
}
export function mountParticipantGate(host,form,onIdentified,{identify=identifyInstitutionalGroup}={}) {
  let pending=false,complete=false;form.hidden=true;
  host.innerHTML='<button type="button" class="primary" data-identify>Continuar com meu cadastro Google</button><p role="status" aria-live="polite" data-registry-status>O grupo será obtido do cadastro institucional, sem seleção manual.</p>';
  const button=host.querySelector('button'),status=host.querySelector('[data-registry-status]');
  button.onclick=async()=>{
    if(pending||complete)return;pending=true;button.disabled=true;status.textContent='Consultando seu vínculo institucional…';
    try {const group=await identify();if(!['team','resident','substitute'].includes(group))throw Error();if(!host.isConnected)return;onIdentified(group);complete=true;form.hidden=false;host.replaceChildren();}
    catch {if(host.isConnected)status.textContent='Não foi possível confirmar seu vínculo. Use a conta cadastrada ou solicite a revisão do cadastro ao administrador.';}
    finally {pending=false;if(!complete)button.disabled=false;}
  };
}
